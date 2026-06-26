# awsDBTools

Command-line tools for fast and repeated AWS database operations.

## Included CLI

### `awsDbCopy`

Copies a PostgreSQL database from a Lightsail source instance into an existing destination database by orchestrating `pg_dump` and `pg_restore` through `zx`.

## Prerequisites

- Node.js
- npm
- PostgreSQL client tools available on your `PATH`
  - `pg_dump`
  - `pg_restore`

## Installation

```bash
npm install
npm run compile
```

## Usage

```bash
node cli/awsDbCopy.mjs \
  --source-host <source-host> \
  --source-user <source-user> \
  --source-password <source-password> \
  --source-db <source-database> \
  --destination-host <destination-host> \
  --destination-user <destination-user> \
  --destination-password <destination-password> \
  --destination-db <destination-database> \
  [--source-port 5432] \
  [--destination-port 5432]
```

After compiling, the bundled executable is available at `dist/awsDbCopy.cjs`.

## Notes

- The destination database must already exist.
- The tool uses a temporary dump file and removes it after the restore completes.
