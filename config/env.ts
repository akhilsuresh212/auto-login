import { config } from "@dotenvx/dotenvx";

config({ ignore: ["MISSING_ENV_FILE"] });

/**
 * Central configuration object shape for the entire application.
 *
 * All values are read from environment variables at startup (after dotenvx
 * decrypts any encrypted `.env` files). Required fields cause an immediate
 * `process.exit(1)` if absent; optional fields are `undefined` when unset.
 */
interface AppConfig {
  /** Full base URL of the GreytHR portal, e.g. `https://acme.greythr.com`. */
  GREYTHR_URL: string;

  /** GreytHR employee username (e.g. `CS-1093`). */
  GREYTHR_USERNAME: string;

  /**
   * GreytHR account password in plain text.
   * The browser's Angular app RSA-encrypts it before sending to `/uas/v1/login`,
   * so we supply the raw value here and let Playwright fill the password field.
   */
  GREYTHR_PASSWORD: string;

  /**
   * node-cron expression for the daily check-in run.
   * Example: `"0 9 * * 1-5"` → every weekday at 09:00 local time.
   * Only required in cron mode (`MODE=cron`).
   */
  LOGIN_TIME: string | undefined;

  /**
   * node-cron expression for the daily check-out run.
   * Example: `"0 18 * * 1-5"` → every weekday at 18:00 local time.
   * Only required in cron mode (`MODE=cron`).
   */
  LOGOUT_TIME: string | undefined;

  /**
   * Secret key for REST API authentication via the `x-api-key` header.
   * Only required in server mode (`MODE=server`).
   */
  API_KEY: string | undefined;

  /**
   * Port the Express server listens on in server mode.
   * Defaults to `8080` when unset (Cloud Run / ECS convention).
   */
  PORT: number;

  /**
   * Runtime mode.
   * - `"server"` → starts the Express REST API (stateless, cloud-friendly).
   * - `"cron"`   → starts the node-cron scheduler (stateful, self-hosted).
   * Defaults to `"cron"` when unset.
   */
  MODE: "server" | "cron";

  /**
   * Whether to launch Chromium in headless mode.
   * Set `HEADLESS=true` in `.env` for server/Docker deployments.
   * Defaults to `false` (headed) when the variable is absent or any other value.
   */
  HEADLESS: boolean;

  /**
   * Maximum random delay (in minutes) applied to scheduled login/logout runs
   * so executions do not fire at a fixed, predictable time every day.
   *
   * Parsed from the `USE_TIME_RANDOMIZATION` environment variable:
   * - unset / `"false"` / invalid → `0` (disabled — exact scheduled times).
   * - `"true"` → `15` (the default maximum window).
   * - a positive number (e.g. `"30"`) → that many minutes.
   *
   * Only consumed in cron mode; server mode relies on the external scheduler
   * for trigger timing.
   */
  TIME_RANDOMIZATION_MAX_MINUTES: number;

  /** SMTP server hostname used for failure email alerts (e.g. `smtp.gmail.com`). */
  SMTP_HOST: string | undefined;

  /** SMTP authentication username, typically the sender email address. */
  SMTP_USER: string | undefined;

  /**
   * SMTP server port.
   * Common values: `587` (STARTTLS), `465` (implicit TLS), `25` (unencrypted).
   * Parsed from `SMTP_PORT` env var; process exits if the value is not a valid integer.
   */
  SMTP_PORT: number | undefined;

  /** SMTP authentication password or app-specific password. */
  SMTP_PASS: string | undefined;

  /** "From" address shown in outgoing failure emails. */
  SMTP_FROM: string | undefined;

  /** Recipient address for failure email alerts. */
  SMTP_TO: string | undefined;

  /**
   * ntfy.sh push notification config.
   * `topic` is required for notifications to be delivered; omitting it disables
   * push alerts without crashing the app.
   * `url` defaults to the public ntfy.sh server but can point to a self-hosted
   * instance (e.g. `https://ntfy.example.com`).
   */
  NTFY: {
    /** ntfy topic name (e.g. `greythr-alerts-abc123`). */
    topic: string | undefined;
    /** Base URL of the ntfy server. Defaults to `https://ntfy.sh`. */
    url: string;
  };
}

/**
 * Reads a required environment variable by name and exits the process immediately
 * if the variable is absent or empty.
 *
 * This is intentionally a hard failure: missing credentials mean the automation
 * cannot function at all, so it is safer to abort startup than to run silently
 * with incomplete configuration.
 *
 * @param name - The environment variable key to look up in `process.env`.
 * @returns The non-empty string value of the variable.
 */
function requireEnv(name: keyof NodeJS.ProcessEnv): string {
  const value = process.env[name];

  if (!value) {
    console.error(
      `Error: Missing required environment variable ${name}. Please check your .env file.`,
    );
    process.exit(1);
  }

  return value;
}

// --- SMTP_PORT validation ---
// Parse and validate before building the config object so we fail fast with
// a clear message rather than a cryptic Nodemailer error at send time.
const smtpPortValue = process.env.SMTP_PORT?.trim();
const smtpPort = smtpPortValue ? Number.parseInt(smtpPortValue, 10) : undefined;

if (smtpPortValue && Number.isNaN(smtpPort)) {
  console.error("Error: SMTP_PORT must be a valid number.");
  process.exit(1);
}

// Warn (but do not exit) when SMTP is partially configured, as email alerts
// are optional and may not be configured in all environments.
if (
  !process.env.SMTP_HOST ||
  !process.env.SMTP_USER ||
  !process.env.SMTP_PORT ||
  !process.env.SMTP_PASS ||
  !process.env.SMTP_FROM ||
  !process.env.SMTP_TO
) {
  console.error(
    "Error: Missing required SMTP environment variables. Email will not be sent. Please check your .env file.",
  );
}

/**
 * Validated, application-wide configuration object.
 *
 * Imported by every service that needs environment values. All required fields
 * are guaranteed to be non-empty strings at runtime (the process exits during
 * module evaluation otherwise). Optional SMTP fields may be `undefined`.
 *
 * @example
 * ```ts
 * import config from "./config/env";
 * await page.goto(config.GREYTHR_URL);
 * ```
 */
// --- USE_TIME_RANDOMIZATION parsing ---

/** Default maximum random delay (in minutes) when `USE_TIME_RANDOMIZATION=true`. */
const DEFAULT_RANDOMIZATION_MAX_MINUTES = 15;

/**
 * Parses the `USE_TIME_RANDOMIZATION` environment variable into a maximum
 * random delay window in minutes.
 *
 * Accepted values (case-insensitive, whitespace-trimmed):
 * - `"true"` → {@link DEFAULT_RANDOMIZATION_MAX_MINUTES} (15 minutes).
 * - a positive number (e.g. `"10"`, `"30"`) → that number of minutes.
 * - `"false"`, unset, or empty → `0` (feature disabled).
 * - anything else (zero, negative, non-numeric) → `0`, with a warning.
 *
 * Invalid values warn instead of exiting the process because randomization is
 * an optional enhancement — the scheduler can safely fall back to running at
 * the exact scheduled times.
 *
 * @param rawValue - The raw `USE_TIME_RANDOMIZATION` value from `process.env`.
 * @returns The maximum random delay in minutes; `0` means disabled.
 */
function parseTimeRandomization(rawValue: string | undefined): number {
  const value = rawValue?.trim().toLowerCase();

  // Unset, empty, or explicitly disabled → exact scheduled times.
  if (!value || value === "false") {
    return 0;
  }

  // Explicitly enabled without a custom limit → default window.
  if (value === "true") {
    return DEFAULT_RANDOMIZATION_MAX_MINUTES;
  }

  // Numeric value → custom maximum delay window in minutes. Number() (rather
  // than parseInt) rejects trailing garbage like "10abc" instead of silently
  // truncating it to 10.
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  console.error(
    `Warning: USE_TIME_RANDOMIZATION has invalid value "${rawValue}". ` +
      'Expected "true", "false", or a positive number of minutes. ' +
      "Time randomization is disabled.",
  );
  return 0;
}

// --- PORT validation ---
const portValue = process.env.PORT?.trim();
const port = portValue ? Number.parseInt(portValue, 10) : 8080;

if (portValue && Number.isNaN(port)) {
  console.error("Error: PORT must be a valid number.");
  process.exit(1);
}

// --- MODE validation ---
const rawMode = process.env.MODE?.trim();
if (rawMode && rawMode !== "server" && rawMode !== "cron") {
  console.error('Error: MODE must be "server" or "cron".');
  process.exit(1);
}
const appMode = (rawMode as "server" | "cron" | undefined) ?? "cron";

const appConfig: AppConfig = {
  GREYTHR_URL: requireEnv("GREYTHR_URL"),
  GREYTHR_USERNAME: requireEnv("GREYTHR_USERNAME"),
  GREYTHR_PASSWORD: requireEnv("GREYTHR_PASSWORD"),
  LOGIN_TIME: process.env.LOGIN_TIME || undefined,
  LOGOUT_TIME: process.env.LOGOUT_TIME || undefined,
  API_KEY: process.env.API_KEY || undefined,
  PORT: port,
  MODE: appMode,
  HEADLESS: process.env.HEADLESS === "true",
  TIME_RANDOMIZATION_MAX_MINUTES: parseTimeRandomization(
    process.env.USE_TIME_RANDOMIZATION,
  ),
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PORT: smtpPort,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  SMTP_TO: process.env.SMTP_TO,
  NTFY: {
    topic: process.env.NTFY_TOPIC || undefined,
    url: process.env.NTFY_URL?.replace(/\/$/, "") ?? "https://ntfy.sh",
  },
};

export default appConfig;
