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
   * Telegram Bot API credentials used for push notifications.
   * Both `botToken` and `chatId` are required for Telegram alerts to work.
   */
  TELEGRAM: {
    /** Telegram Bot token obtained from @BotFather (e.g. `123456:ABC-DEF...`). */
    botToken: string | undefined;
    /** Telegram chat/channel ID where messages are delivered. */
    chatId: string | undefined;
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
// are optional — Telegram is the primary notification channel.
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
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PORT: smtpPort,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  SMTP_TO: process.env.SMTP_TO,
  TELEGRAM: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    chatId: requireEnv("TELEGRAM_BOT_MESSAGE_ID"),
  },
};

export default appConfig;
