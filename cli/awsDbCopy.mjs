#!/usr/bin/env node
import { copyDatabase, formatUsage, parseArgs } from "../src/PostgresCopy.mjs";

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
      console.log(formatUsage());
      return;
    }

    await copyDatabase(options);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    console.error(`\n${formatUsage()}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
