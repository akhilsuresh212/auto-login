import fs from "fs";
import path from "path";

const logsDir = path.join(__dirname, "..", "logs");

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function getTimestamp(): string {
  return new Date().toISOString();
}

function stringifyUnknown(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  return String(value);
}

function logStatus(message: string): void {
  const line = `[${getTimestamp()}] ${message}\n`;
  const filePath = path.join(logsDir, "login-status.log");
  fs.appendFileSync(filePath, line, { encoding: "utf8" });
}

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
