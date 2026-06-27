# awsDBTools

Command-line tools for fast and repeated AWS database operations, exposed as a
single `awsDBTools` CLI with subcommands.

## Commands

### `postgresCopy`

Copies a PostgreSQL database from a **source** to a **destination**, where both
endpoints are described by [AWS Secrets Manager](https://aws.amazon.com/secrets-manager/)
secrets. It orchestrates `pg_dump`, `pg_restore`, and `psql` through `zx`.

Each secret must contain the following JSON keys:

| Secret key    | Used as                |
| ------------- | ---------------------- |
| `DB_HOSTNAME` | host                   |
| `DB_USER`     | user                   |
| `DB_PORT`     | port (defaults `5432`) |
| `DB_NAME`     | database name          |
| `DB_PASS`     | password               |

## Prerequisites

- Node.js
- npm
- The **AWS CLI**, installed and authenticated. Before doing anything the tool
  runs `aws sts get-caller-identity`; if that fails it stops with a clear error
  telling you to log in (e.g. `aws sso login`, `aws configure`, or by setting
  `AWS_PROFILE` / `AWS_ACCESS_KEY_ID`).
- PostgreSQL client tools on your `PATH`
  - `pg_dump`
  - `pg_restore`
  - `psql`

## Installation

```bash
npm install
npm run compile
```

This produces the bundled executable at `dist/awsDBTools.cjs`. To install it on
your `PATH` as `awsDBTools`, run `npm run setup` (compile + `npm link`).

## Usage

```bash
awsDBTools postgresCopy \
  --source <source-secret-id-or-arn> \
  --destination <destination-secret-id-or-arn> \
  [--region <aws-region>] \
  [--yes]
```

You can also run it directly from source without installing:

```bash
node cli/awsDBTools.mjs postgresCopy --source <source-secret> --destination <destination-secret>
```

Options:

- `--source`, `--src` — AWS secret id/ARN for the **source** database.
- `--destination`, `--dest` — AWS secret id/ARN for the **destination** database.
- `--region` — AWS region used for all AWS CLI calls. Optional; defaults to
  `ca-central-1`.
- `--yes`, `-y` — skip the confirmation prompt and recreate the destination if
  it already exists.

## Behaviour

1. Confirms AWS credentials with `aws sts get-caller-identity`.
2. Reads the source and destination secrets and extracts the connection details.
3. Checks whether the destination database exists:
   - If it **exists**, you are asked whether to delete it so a fresh copy can be
     taken. Answering yes drops and recreates the database; answering no aborts.
     Pass `--yes` to skip the prompt.
   - If it does **not** exist, it is created.
4. Dumps the source with `pg_dump` and restores it into the destination with
   `pg_restore`, using a temporary dump file that is removed afterwards.
