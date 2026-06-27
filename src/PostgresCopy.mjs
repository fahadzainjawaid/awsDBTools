import { $ } from "zx";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";

const OPTION_KEYS = {
  source: "source",
  src: "source",
  destination: "destination",
  dest: "destination",
  region: "region",
};

export function formatPostgresCopyUsage() {
  return `Usage:
  awsDBTools postgresCopy --source <source-secret> --destination <destination-secret> [--region <region>] [--yes]

Options:
  --source, --src         AWS Secrets Manager secret id/ARN for the SOURCE database.
  --destination, --dest   AWS Secrets Manager secret id/ARN for the DESTINATION database.
  --region                AWS region used for all AWS CLI calls (default: ca-central-1).
  --yes, -y               Skip the confirmation prompt and recreate the destination if it exists.
  --help, -h              Show this help.

Each secret must contain the following JSON keys:
  DB_HOSTNAME, DB_USER, DB_PORT, DB_NAME, DB_PASS

Notes:
  - Requires the AWS CLI installed and authenticated (aws sts get-caller-identity).
  - Requires pg_dump, pg_restore, and psql on your PATH.
  - If the destination database already exists you will be asked to delete it
    so a fresh copy can be taken.`;
}

export function parsePostgresCopyArgs(argv) {
  const options = { assumeYes: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }

    if (arg === "--yes" || arg === "-y") {
      options.assumeYes = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = OPTION_KEYS[rawKey];

    if (!key) {
      throw new Error(`Unknown option: --${rawKey}`);
    }

    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${rawKey}`);
    }

    options[key] = value;
    if (inlineValue === undefined) {
      index += 1;
    }
  }

  const missing = ["source", "destination"].filter((key) => !options[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required options: ${missing.map((key) => `--${key}`).join(", ")}`);
  }

  return options;
}

export function buildPgDumpArgs(source, dumpFile) {
  return [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    "--host",
    source.host,
    "--port",
    source.port,
    "--username",
    source.user,
    "--dbname",
    source.database,
    "--file",
    dumpFile,
  ];
}

export function buildPgRestoreArgs(destination, dumpFile) {
  return [
    "--clean",
    "--if-exists",
    "--exit-on-error",
    "--no-owner",
    "--no-acl",
    "--host",
    destination.host,
    "--port",
    destination.port,
    "--username",
    destination.user,
    "--dbname",
    destination.database,
    dumpFile,
  ];
}

function maintenancePsql(destination, runner, command, extraFlags = []) {
  return runner({
    env: { ...process.env, PGPASSWORD: destination.password },
    quiet: true,
  })`psql --host ${destination.host} --port ${destination.port} --username ${destination.user} --dbname postgres --no-psqlrc ${extraFlags} --command ${command}`;
}

export async function destinationDatabaseExists(destination, runner = $) {
  const result = await maintenancePsql(
    destination,
    runner,
    `SELECT 1 FROM pg_database WHERE datname = '${destination.database}'`,
    ["--tuples-only", "--no-align"],
  );
  return result.stdout.trim() === "1";
}

export async function recreateDestinationDatabase(destination, runner = $) {
  // Drop any lingering connections so DROP DATABASE can succeed.
  await maintenancePsql(
    destination,
    runner,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${destination.database}' AND pid <> pg_backend_pid()`,
    ["--tuples-only", "--no-align"],
  );
  await maintenancePsql(destination, runner, `DROP DATABASE IF EXISTS "${destination.database}"`);
  await maintenancePsql(destination, runner, `CREATE DATABASE "${destination.database}"`);
}

export async function createDestinationDatabase(destination, runner = $) {
  await maintenancePsql(destination, runner, `CREATE DATABASE "${destination.database}"`);
}

export async function dumpSource(source, dumpFile, runner = $) {
  await runner({
    env: { ...process.env, PGPASSWORD: source.password },
    stdio: "inherit",
  })`pg_dump ${buildPgDumpArgs(source, dumpFile)}`;
}

export async function restoreDestination(destination, dumpFile, runner = $) {
  await runner({
    env: { ...process.env, PGPASSWORD: destination.password },
    stdio: "inherit",
  })`pg_restore ${buildPgRestoreArgs(destination, dumpFile)}`;
}

export async function copyDatabase(options, deps = {}) {
  const {
    runner = $,
    promptConfirm = async () => false,
    checkExists = destinationDatabaseExists,
    recreate = recreateDestinationDatabase,
    create = createDestinationDatabase,
    dump = dumpSource,
    restore = restoreDestination,
  } = deps;

  const { source, destination } = options;
  const assumeYes = options.assumeYes ?? false;

  console.log(
    `🔎 Checking destination database "${destination.database}" on ${destination.host}:${destination.port}...`,
  );
  const exists = await checkExists(destination, runner);

  if (exists) {
    const confirmed = assumeYes || (await promptConfirm(destination));
    if (!confirmed) {
      throw new Error(
        `Destination database "${destination.database}" already exists. ` +
          "Delete it (or re-run with --yes) to take a fresh copy.",
      );
    }
    console.log(`🗑️  Dropping and recreating "${destination.database}" for a fresh copy...`);
    await recreate(destination, runner);
  } else {
    console.log(`🆕 Creating destination database "${destination.database}"...`);
    await create(destination, runner);
  }

  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "aws-db-tools-"));
  const dumpFile = path.join(tempDirectory, `${source.database}.dump`);

  try {
    console.log(`📥 Dumping ${source.database} from ${source.host}:${source.port}...`);
    await dump(source, dumpFile, runner);

    console.log(
      `📤 Restoring into ${destination.database} on ${destination.host}:${destination.port}...`,
    );
    await restore(destination, dumpFile, runner);

    console.log("✅ Database copy complete.");
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
