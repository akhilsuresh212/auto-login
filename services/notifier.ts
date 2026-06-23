import appConfig from "../config/env";
import { logStatus, logError } from "./logService";

// ntfy priority scale: 1=min 2=low 3=default 4=high 5=max
type NtfyPriority = 1 | 2 | 3 | 4 | 5;

/**
 * Publishes a message to the configured ntfy topic.
 *
 * Silently skips if `NTFY_TOPIC` is not set, so the app runs without push
 * notifications in environments where ntfy is intentionally unconfigured.
 *
 * @see https://docs.ntfy.sh/publish/
 */
async function publish(
  title: string,
  body: string,
  priority: NtfyPriority,
  tags: string[],
): Promise<void> {
  const { topic, url } = appConfig.NTFY;
  if (!topic) {
    logStatus("NTFY_TOPIC not configured — skipping push notification.");
    return;
  }

  try {
    const res = await fetch(`${url}/${topic}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Title": encodeURIComponent(title),
        "Priority": String(priority),
        "Tags": tags.join(","),
      },
      body,
    });

    if (!res.ok) {
      logError(`ntfy publish failed (HTTP ${res.status})`, await res.text());
    }
  } catch (error: unknown) {
    console.log(error)
    logError("ntfy publish error", error);
  }
}

function istTimestamp(): string {
  return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

/**
 * Sends a success or skip notification via ntfy.
 *
 * Actions whose name contains "Skipped" are sent at low priority with a
 * calendar tag (informational). All other successes use default priority
 * and a green check tag.
 */
export async function sendSuccessMessage(
  action: string,
  details: string = "",
): Promise<void> {
  const ts = istTimestamp();
  const isSkipped = action.includes("Skipped");

  const body = [
    details || "Completed successfully.",
    "",
    `Time: ${ts} IST`,
  ].join("\n");

  await publish(
    `${isSkipped ? "⏭️" : "✅"} ${action}`,
    body,
    isSkipped ? 2 : 3,
    isSkipped ? ["calendar"] : ["white_check_mark"],
  );

  logStatus(`[SUCCESS] ${action} | ${ts}${details ? ` | ${details}` : ""}`);
  console.log(`[SUCCESS] ${action}`);
}

/**
 * Sends a failure notification via ntfy at high priority.
 *
 * The error message is included in the body so the recipient can triage
 * without opening logs. Also logs to the status log file and stderr.
 */
export async function sendFailureMessage(
  action: string,
  error: string,
): Promise<void> {
  const ts = istTimestamp();

  const body = [
    "An error occurred. Immediate attention may be required.",
    "",
    `Error: ${error}`,
    "",
    `Time: ${ts} IST`,
  ].join("\n");

  await publish(
    `❌ ${action}`,
    body,
    4,
    ["x", "rotating_light"],
  );

  logStatus(`[FAILURE] ${action} | ${ts} | Error: ${error}`);
  console.error(`[FAILURE] ${action} | ${ts} | Error: ${error}`);
}

/**
 * Sends an informational summary notification via ntfy at default priority.
 *
 * Used for daily action summaries (pending leave approvals, regularizations).
 * The IST timestamp is appended automatically.
 */
export async function sendSummaryMessage(
  title: string,
  body: string,
): Promise<void> {
  const ts = istTimestamp();

  await publish(
    title,
    `${body}\n\nTime: ${ts} IST`,
    3,
    ["clipboard"],
  );

  logStatus(`[SUMMARY] ${title}`);
}

/**
 * Sends a startup notification via ntfy confirming the scheduler is live.
 *
 * Published once during application boot in cron mode, so you can verify that
 * the process started successfully and confirm the scheduled times at a glance.
 *
 * @param loginCron  - Raw cron expression for the check-in job.
 * @param logoutCron - Raw cron expression for the check-out job.
 */
export async function sendStartupMessage(
  loginCron: string,
  logoutCron: string,
): Promise<void> {
  const ts = istTimestamp();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const body = [
    "Scheduler is running. Attendance flows are active.",
    "",
    `Login:    ${loginCron}`,
    `Logout:   ${logoutCron}`,
    `Timezone: ${tz}`,
    "",
    `Started: ${ts} IST`,
  ].join("\n");

  await publish("🟢 Auto-Login Scheduler Started", body, 3, ["white_check_mark"]);
  logStatus(`[STARTUP] Login: ${loginCron} | Logout: ${logoutCron} | TZ: ${tz}`);
  console.log(`[STARTUP] Login: ${loginCron} | Logout: ${logoutCron} | TZ: ${tz}`);
}
