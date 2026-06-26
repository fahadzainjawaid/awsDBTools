import assert from "assert/strict";
import {
  buildPgDumpArgs,
  buildPgRestoreArgs,
  copyDatabase,
  parseArgs,
} from "../src/PostgresCopy.mjs";

const parsed = parseArgs([
  "--source-host",
  "source.example.com",
  "--source-user",
  "source_user",
  "--source-password",
  "source_password",
  "--source-db",
  "source_db",
  "--destination-host",
  "destination.example.com",
  "--destination-user",
  "destination_user",
  "--destination-password",
  "destination_password",
  "--destination-db",
  "destination_db",
]);

assert.equal(parsed.sourcePort, "5432");
assert.equal(parsed.destinationPort, "5432");
assert.equal(parsed.sourceHost, "source.example.com");
assert.equal(parsed.destinationDatabase, "destination_db");

assert.throws(
  () => parseArgs(["--source-host", "source.example.com"]),
  /Missing required options/,
);

assert.deepEqual(buildPgDumpArgs(parsed, "/tmp/source.dump"), [
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

assert.deepEqual(buildPgRestoreArgs(parsed, "/tmp/source.dump"), [
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

const invocations = [];
const mockRunner = (options) => (strings, ...values) => {
  invocations.push({
    envPassword: options.env.PGPASSWORD,
    command: String.raw({ raw: strings }, ...values.map((value) => Array.isArray(value) ? value.join(" ") : value)),
  });
  return Promise.resolve();
};

await copyDatabase(parsed, mockRunner);

assert.equal(invocations.length, 2);
assert.equal(invocations[0].envPassword, "source_password");
assert.match(invocations[0].command, /^pg_dump /);
assert.equal(invocations[1].envPassword, "destination_password");
assert.match(invocations[1].command, /^pg_restore /);

console.log("All tests passed.");
