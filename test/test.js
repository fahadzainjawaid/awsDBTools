import assert from "assert/strict";
import {
  DEFAULT_REGION,
  assertAwsAuthenticated,
  dbConfigFromSecret,
  getSecretJson,
} from "../src/aws.mjs";
import {
  buildPgDumpArgs,
  buildPgRestoreArgs,
  copyDatabase,
  parsePostgresCopyArgs,
} from "../src/PostgresCopy.mjs";

// --- parsePostgresCopyArgs -------------------------------------------------

const parsed = parsePostgresCopyArgs([
  "--source",
  "prod/db/source",
  "--destination",
  "staging/db/destination",
]);
assert.equal(parsed.source, "prod/db/source");
assert.equal(parsed.destination, "staging/db/destination");
assert.equal(parsed.assumeYes, false);

const parsedAliases = parsePostgresCopyArgs([
  "--src=prod/db/source",
  "--dest=staging/db/destination",
  "-y",
]);
assert.equal(parsedAliases.source, "prod/db/source");
assert.equal(parsedAliases.destination, "staging/db/destination");
assert.equal(parsedAliases.assumeYes, true);

assert.throws(
  () => parsePostgresCopyArgs(["--source", "only-source"]),
  /Missing required options/,
);

// Region is optional; when omitted callers fall back to DEFAULT_REGION.
assert.equal(parsed.region, undefined);
const parsedRegion = parsePostgresCopyArgs([
  "--source",
  "s",
  "--destination",
  "d",
  "--region",
  "us-east-1",
]);
assert.equal(parsedRegion.region, "us-east-1");

// --- region threading into AWS CLI calls -----------------------------------

function captureRunner() {
  const commands = [];
  const runner = () => (strings, ...values) => {
    commands.push(
      strings.reduce(
        (acc, str, i) =>
          acc + str + (i < values.length ? String(values[i] ?? "") : ""),
        "",
      ),
    );
    return Promise.resolve({ stdout: '{"Arn":"arn:aws:iam::123:user/test"}' });
  };
  return { commands, runner };
}

{
  const { commands, runner } = captureRunner();
  await assertAwsAuthenticated(undefined, runner);
  assert.match(commands[0], new RegExp(`--region ${DEFAULT_REGION}\\b`));
}

{
  const { commands, runner } = captureRunner();
  await assertAwsAuthenticated("eu-west-2", runner);
  assert.match(commands[0], /--region eu-west-2\b/);
}

{
  const { commands, runner } = captureRunner();
  // getSecretJson will throw parsing the stub JSON as a secret payload, but the
  // command string is recorded before that — which is what we assert on.
  await getSecretJson("my/secret", "ap-south-1", runner).catch(() => {});
  assert.match(commands[0], /secretsmanager get-secret-value/);
  assert.match(commands[0], /--secret-id my\/secret\b/);
  assert.match(commands[0], /--region ap-south-1\b/);
}

// --- dbConfigFromSecret ----------------------------------------------------

const sourceConfig = dbConfigFromSecret(
  {
    DB_HOSTNAME: "source.example.com",
    DB_USER: "source_user",
    DB_PORT: "5432",
    DB_NAME: "source_db",
    DB_PASS: "source_password",
  },
  "Source",
);
assert.deepEqual(sourceConfig, {
  host: "source.example.com",
  user: "source_user",
  port: "5432",
  database: "source_db",
  password: "source_password",
});

// Port defaults to 5432 when absent.
const noPortConfig = dbConfigFromSecret({
  DB_HOSTNAME: "h",
  DB_USER: "u",
  DB_NAME: "d",
  DB_PASS: "p",
});
assert.equal(noPortConfig.port, "5432");

// Missing required keys raise a helpful error.
assert.throws(
  () => dbConfigFromSecret({ DB_HOSTNAME: "h" }, "Destination"),
  /Destination secret is missing required keys: DB_USER, DB_NAME, DB_PASS/,
);

// --- buildPgDumpArgs / buildPgRestoreArgs ----------------------------------

const destinationConfig = {
  host: "destination.example.com",
  user: "destination_user",
  port: "5432",
  database: "destination_db",
  password: "destination_password",
};

assert.deepEqual(buildPgDumpArgs(sourceConfig, "/tmp/source.dump"), [
  "--format=custom",
  "--no-owner",
  "--no-acl",
  "--host",
  "source.example.com",
  "--port",
  "5432",
  "--username",
  "source_user",
  "--dbname",
  "source_db",
  "--file",
  "/tmp/source.dump",
]);

assert.deepEqual(buildPgRestoreArgs(destinationConfig, "/tmp/source.dump"), [
  "--clean",
  "--if-exists",
  "--exit-on-error",
  "--no-owner",
  "--no-acl",
  "--host",
  "destination.example.com",
  "--port",
  "5432",
  "--username",
  "destination_user",
  "--dbname",
  "destination_db",
  "/tmp/source.dump",
]);

// --- copyDatabase orchestration -------------------------------------------

function makeDeps(overrides = {}) {
  const calls = [];
  const record = (name) => async (...args) => {
    calls.push({ name, args });
    if (name === "checkExists") return overrides.exists ?? false;
    return undefined;
  };
  return {
    calls,
    deps: {
      checkExists: record("checkExists"),
      recreate: record("recreate"),
      create: record("create"),
      dump: record("dump"),
      restore: record("restore"),
      promptConfirm: overrides.promptConfirm ?? record("promptConfirm"),
    },
  };
}

// Destination does NOT exist -> create then dump+restore (no prompt).
{
  const { calls, deps } = makeDeps({ exists: false });
  await copyDatabase({ source: sourceConfig, destination: destinationConfig }, deps);
  const order = calls.map((c) => c.name);
  assert.deepEqual(order, ["checkExists", "create", "dump", "restore"]);
}

// Destination exists, user confirms -> recreate then dump+restore.
{
  let prompted = false;
  const { calls, deps } = makeDeps({
    exists: true,
    promptConfirm: async () => {
      prompted = true;
      return true;
    },
  });
  await copyDatabase({ source: sourceConfig, destination: destinationConfig }, deps);
  assert.equal(prompted, true);
  const order = calls.map((c) => c.name);
  assert.deepEqual(order, ["checkExists", "recreate", "dump", "restore"]);
}

// Destination exists, user declines -> abort without dumping.
{
  const { calls, deps } = makeDeps({
    exists: true,
    promptConfirm: async () => false,
  });
  await assert.rejects(
    () => copyDatabase({ source: sourceConfig, destination: destinationConfig }, deps),
    /already exists/,
  );
  const order = calls.map((c) => c.name);
  assert.deepEqual(order, ["checkExists"]);
}

// --yes skips the prompt entirely even when the destination exists.
{
  let prompted = false;
  const { calls, deps } = makeDeps({
    exists: true,
    promptConfirm: async () => {
      prompted = true;
      return false;
    },
  });
  await copyDatabase(
    { source: sourceConfig, destination: destinationConfig, assumeYes: true },
    deps,
  );
  assert.equal(prompted, false);
  const order = calls.map((c) => c.name);
  assert.deepEqual(order, ["checkExists", "recreate", "dump", "restore"]);
}

console.log("All tests passed.");
