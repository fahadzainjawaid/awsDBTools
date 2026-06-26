import { $ } from "zx";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";

const OPTION_KEYS = {
  "source-host": "sourceHost",
  "source-port": "sourcePort",
  "source-user": "sourceUser",
  "source-password": "sourcePassword",
  "source-db": "sourceDatabase",
  "destination-host": "destinationHost",
  "destination-port": "destinationPort",
  "destination-user": "destinationUser",
  "destination-password": "destinationPassword",
  "destination-db": "destinationDatabase",
  "dest-host": "destinationHost",
  "dest-port": "destinationPort",
  "dest-user": "destinationUser",
  "dest-password": "destinationPassword",
  "dest-db": "destinationDatabase",
};

const REQUIRED_OPTIONS = [
  "sourceHost",
  "sourceUser",
  "sourcePassword",
  "sourceDatabase",
  "destinationHost",
  "destinationUser",
  "destinationPassword",
  "destinationDatabase",
];

export function formatUsage() {
  return `Usage:
  awsDbCopy --source-host <host> --source-user <user> --source-password <password> --source-db <database> \\
            --destination-host <host> --destination-user <user> --destination-password <password> --destination-db <database> \\
            [--source-port <port>] [--destination-port <port>]

Notes:
  - The destination database must already exist.
  - pg_dump and pg_restore must be available on your PATH.`;
}

export function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { help: true };
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

  return normalizeOptions(options);
}

export function normalizeOptions(options) {
  const normalized = {
    ...options,
    sourcePort: options.sourcePort || "5432",
    destinationPort: options.destinationPort || "5432",
  };

  const missingOptions = REQUIRED_OPTIONS.filter((key) => !normalized[key]);
  if (missingOptions.length > 0) {
    throw new Error(`Missing required options: ${missingOptions.join(", ")}`);
  }

  return normalized;
}

export function buildPgDumpArgs(options, dumpFile) {
  return [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    "--host",
    options.sourceHost,
    "--port",
    options.sourcePort,
    "--username",
    options.sourceUser,
    "--dbname",
    options.sourceDatabase,
    "--file",
    dumpFile,
  ];
}

export function buildPgRestoreArgs(options, dumpFile) {
  return [
    "--clean",
    "--if-exists",
    "--exit-on-error",
    "--no-owner",
    "--no-acl",
    "--host",
    options.destinationHost,
    "--port",
    options.destinationPort,
    "--username",
    options.destinationUser,
    "--dbname",
    options.destinationDatabase,
    dumpFile,
  ];
}

export async function copyDatabase(options, runner = $) {
  const normalized = normalizeOptions(options);
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "aws-db-tools-"));
  const dumpFile = path.join(tempDirectory, `${normalized.sourceDatabase}.dump`);

  try {
    console.log(
      `📥 Dumping ${normalized.sourceDatabase} from ${normalized.sourceHost}:${normalized.sourcePort}...`,
    );
    await runner({
      env: { ...process.env, PGPASSWORD: normalized.sourcePassword },
      stdio: "inherit",
    })`pg_dump ${buildPgDumpArgs(normalized, dumpFile)}`;

    console.log(
      `📤 Restoring into ${normalized.destinationDatabase} on ${normalized.destinationHost}:${normalized.destinationPort}...`,
    );
    await runner({
      env: { ...process.env, PGPASSWORD: normalized.destinationPassword },
      stdio: "inherit",
    })`pg_restore ${buildPgRestoreArgs(normalized, dumpFile)}`;

    console.log("✅ Database copy complete.");
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
