import { logStatus } from "./logService";

/**
 * Sends a formatted success notification.
 *
 * Currently logs to console and the status log file.
 * Replace the body of this function to integrate a push notification
 * service (e.g. email, webhook, SMS) when one is chosen.
 *
 * @param action  - Short label for the completed action (e.g. "Login Flow Success").
 * @param details - Optional additional context appended to the log line.
 */
export async function sendSuccessMessage(action: string, details: string = ""): Promise<void> {
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const msg = `[SUCCESS] ${action} | ${timestamp}${details ? ` | ${details}` : ""}`;
  logStatus(msg);
  console.log(msg);
}

/**
 * Sends a formatted failure notification.
 *
 * Currently logs to console and the status log file.
 * Replace the body of this function to integrate a push notification
 * service (e.g. email, webhook, SMS) when one is chosen.
 *
 * @param action - Short label for the failed action (e.g. "Login Flow Failed").
 * @param error  - Plain-text error description.
 */
export async function sendFailureMessage(action: string, error: string): Promise<void> {
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const msg = `[FAILURE] ${action} | ${timestamp} | Error: ${error}`;
  logStatus(msg);
  console.error(msg);
}
