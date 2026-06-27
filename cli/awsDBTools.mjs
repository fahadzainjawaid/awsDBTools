#!/usr/bin/env node
import { createInterface } from "readline";
import { DEFAULT_REGION, assertAwsAuthenticated, loadDbConfig } from "../src/aws.mjs";
import {
  copyDatabase,
  formatPostgresCopyUsage,
  parsePostgresCopyArgs,
} from "../src/PostgresCopy.mjs";

function formatRootUsage() {
  return `awsDBTools — command-line tools for AWS database operations.

Usage:
  awsDBTools <command> [options]

Commands:
  postgresCopy   Copy a PostgreSQL database between two AWS Secrets Manager-defined instances.

Run "awsDBTools <command> --help" for command-specific options.`;
}

async function promptYesNo(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function runPostgresCopy(argv) {
  const options = parsePostgresCopyArgs(argv);

  if (options.help) {
    console.log(formatPostgresCopyUsage());
    return;
  }

  const region = options.region || DEFAULT_REGION;

  const identity = await assertAwsAuthenticated(region);
  console.log(`🔐 Authenticated with AWS as ${identity.Arn} (region ${region})`);

  const [source, destination] = await Promise.all([
    loadDbConfig(options.source, "Source", region),
    loadDbConfig(options.destination, "Destination", region),
  ]);

  await copyDatabase(
    { source, destination, assumeYes: options.assumeYes },
    {
      promptConfirm: (dest) =>
        promptYesNo(
          `⚠️  Destination database "${dest.database}" on ${dest.host} already exists.\n` +
            "   Delete it and take a fresh copy? [y/N] ",
        ),
    },
  );
}

const COMMANDS = {
  postgresCopy: runPostgresCopy,
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(formatRootUsage());
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`❌ Unknown command: ${command}\n`);
    console.error(formatRootUsage());
    process.exitCode = 1;
    return;
  }

  await handler(rest);
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
