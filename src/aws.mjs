import { $ } from "zx";

/**
 * Maps the database connection fields used by this tool to the JSON keys that
 * are expected to live inside an AWS Secrets Manager secret.
 */
export const SECRET_FIELD_MAP = {
  host: "DB_HOSTNAME",
  user: "DB_USER",
  port: "DB_PORT",
  database: "DB_NAME",
  password: "DB_PASS",
};

const REQUIRED_SECRET_FIELDS = ["host", "user", "database", "password"];
const DEFAULT_PORT = "5432";

export const DEFAULT_REGION = "ca-central-1";

/**
 * Confirms the AWS CLI is installed and the caller has valid credentials by
 * running `aws sts get-caller-identity`. Returns the parsed identity on success
 * and throws a meaningful error otherwise.
 */
export async function assertAwsAuthenticated(region = DEFAULT_REGION, runner = $) {
  let result;
  try {
    result = await runner({
      quiet: true,
    })`aws sts get-caller-identity --region ${region} --output json`;
  } catch (error) {
    const detail = (error.stderr || error.message || "").trim();
    throw new Error(
      "AWS authentication check failed. Make sure the AWS CLI is installed and you are " +
        "logged in (e.g. `aws sso login`, `aws configure`, or set AWS_PROFILE/AWS_ACCESS_KEY_ID).\n" +
        "`aws sts get-caller-identity` reported:\n" +
        (detail || "command could not be executed (is the AWS CLI on your PATH?)"),
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Unable to parse the response from `aws sts get-caller-identity`.");
  }
}

/**
 * Reads a secret value from AWS Secrets Manager and parses it as JSON.
 */
export async function getSecretJson(secretId, region = DEFAULT_REGION, runner = $) {
  let result;
  try {
    result = await runner({
      quiet: true,
    })`aws secretsmanager get-secret-value --secret-id ${secretId} --region ${region} --query SecretString --output text`;
  } catch (error) {
    const detail = (error.stderr || error.message || "").trim();
    throw new Error(`Failed to read AWS secret "${secretId}": ${detail || "unknown error"}`);
  }

  const raw = result.stdout.trim();
  if (!raw || raw === "None") {
    throw new Error(`AWS secret "${secretId}" has no SecretString value.`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`AWS secret "${secretId}" does not contain valid JSON.`);
  }
}

/**
 * Translates the JSON stored in a secret into a database connection config.
 */
export function dbConfigFromSecret(secret, label = "Secret") {
  const config = {};
  const missing = [];

  for (const [key, secretKey] of Object.entries(SECRET_FIELD_MAP)) {
    const value = secret[secretKey];
    if (value === undefined || value === null || value === "") {
      if (REQUIRED_SECRET_FIELDS.includes(key)) {
        missing.push(secretKey);
      }
      continue;
    }
    config[key] = String(value);
  }

  if (missing.length > 0) {
    throw new Error(`${label} secret is missing required keys: ${missing.join(", ")}`);
  }

  config.port = config.port || DEFAULT_PORT;
  return config;
}

/**
 * Convenience helper: read a secret and turn it into a connection config.
 */
export async function loadDbConfig(secretId, label, region = DEFAULT_REGION, runner = $) {
  const secret = await getSecretJson(secretId, region, runner);
  return dbConfigFromSecret(secret, label);
}
