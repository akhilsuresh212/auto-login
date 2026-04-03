import fs from "fs";
import path from "path";

/** Absolute path to the `logs/` directory, one level above this file. */
const logsDir = path.join(__dirname, "..", "logs");

// Ensure the logs directory exists at module load time so that every
// subsequent appendFileSync call can succeed without extra guards.
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Returns the current date and time as an ISO 8601 string.
 *
 * Used as a prefix for every log line so entries are sortable and unambiguous
 * regardless of the system locale.
 *
 * @returns ISO 8601 timestamp, e.g. `"2026-04-03T09:00:00.000Z"`.
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Converts an unknown thrown value into a human-readable string suitable for
 * inclusion in a log line.
 *
 * - `Error` instances → full stack trace (falls back to `message` if the
 *   stack is unavailable, e.g. in stripped production builds).
 * - Plain strings → returned as-is.
 * - Anything else → coerced via `String()`, which handles numbers, booleans,
 *   objects, `null`, and `undefined` gracefully.
 *
 * @param value - The caught value from a `catch` block or rejection handler.
 * @returns A string representation of the value.
 */
function stringifyUnknown(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  return String(value);
}

/**
 * Appends an informational message to `logs/login-status.log`.
 *
 * Use this for every meaningful state transition: navigation steps, API call
 * outcomes, attendance decisions, leave/holiday skip reasons, and cron triggers.
 * Keeping a dense status trail makes post-mortem debugging significantly easier.
 *
 * Each line is written synchronously to guarantee ordering and to avoid losing
 * entries if the process terminates unexpectedly.
 *
 * @param message - A plain-text description of the current state or event.
 *
 * @example
 * logStatus("Attendance check-in completed successfully.");
 */
function logStatus(message: string): void {
  const line = `[${getTimestamp()}] ${message}\n`;
  const filePath = path.join(logsDir, "login-status.log");
  fs.appendFileSync(filePath, line, { encoding: "utf8" });
}

/**
 * Appends an error message (with optional error detail) to `logs/login-error.log`.
 *
 * The optional `error` argument is serialised by {@link stringifyUnknown} and
 * appended after a pipe separator so the log line stays a single line (stack
 * traces included).
 *
 * Like `logStatus`, writes are synchronous to prevent log loss on process exit.
 *
 * @param message - Human-readable description of what operation failed.
 * @param error   - The caught error value; accepts `Error`, strings, or any
 *                  unknown thrown value. Omit when there is no associated error
 *                  object (e.g. a pre-condition violation you detected yourself).
 *
 * @example
 * logError("Failed to fetch attendance data.", err);
 * logError("SMTP configuration is incomplete."); // no error object
 */
function logError(message: string, error?: unknown): void {
  let line = `[${getTimestamp()}] ${message}`;

  if (error !== undefined) {
    line += ` | ${stringifyUnknown(error)}`;
  }

  line += "\n";

  const filePath = path.join(logsDir, "login-error.log");
  fs.appendFileSync(filePath, line, { encoding: "utf8" });
}

export { logStatus, logError, stringifyUnknown };
