import { chromium, Browser, BrowserContext, Page } from "playwright";
import cron from "node-cron";
import fs from "fs";
import config from "./config/env";
import * as authService from "./services/auth";
import * as attendanceService from "./services/attendance";
import { logStatus, logError } from "./services/logService";
import * as leaveService from "./services/leaveService";
import { sendSuccessMessage, sendFailureMessage } from "./services/telegram";

/** Absolute path to the heartbeat file written every 60 seconds. */
const HEARTBEAT_FILE = "/tmp/heartbeat";

/**
 * Writes the current UTC timestamp to `/tmp/heartbeat`.
 *
 * The Docker `HEALTHCHECK` instruction reads this file to confirm the
 * scheduler process is still alive. Writing a file avoids launching a full
 * Chromium browser (the only other way to prove liveness), which would be
 * wasteful and slow.
 *
 * Errors are silently swallowed — heartbeat writes are best-effort and must
 * never crash the main process or interfere with the cron scheduler.
 */
function writeHeartbeat(): void {
  try {
    fs.writeFileSync(HEARTBEAT_FILE, new Date().toISOString());
  } catch {
    // ignore — heartbeat is best-effort
  }
}

// ---------------------------------------------------------------------------
// Global error handlers
// ---------------------------------------------------------------------------
// Node.js v15+ terminates the process on unhandled promise rejections by
// default. These handlers log the problem and keep the scheduler alive instead,
// which is the correct behaviour for a long-running background service.

process.on("unhandledRejection", (reason: unknown) => {
  console.error("Unhandled promise rejection:", reason);
  logError("Unhandled promise rejection", reason);
});

process.on("uncaughtException", (error: Error) => {
  console.error("Uncaught exception:", error);
  logError("Uncaught exception", error);
});

// ---------------------------------------------------------------------------
// healthCheck
// ---------------------------------------------------------------------------

/**
 * Performs a basic reachability check against the GreytHR portal.
 *
 * Invoked when the application is started with the `--health` CLI flag.
 * Useful for Docker `HEALTHCHECK` commands, CI smoke tests, or manual
 * verification after a deployment.
 *
 * The check launches a Chromium browser, navigates to `config.GREYTHR_URL`,
 * and waits for the page to reach `networkidle` state. It does **not** attempt
 * to log in — a successful page load is sufficient to confirm the portal is
 * reachable and returning valid HTML.
 *
 * Browser resources are always closed in the `finally` block, even on failure,
 * so there is no risk of a zombie Chromium process from a health check.
 */
async function healthCheck(): Promise<void> {
  console.log("Performing health check...");
  logStatus("Performing health check...");

  const browser = await chromium.launch({
    headless: config.HEADLESS,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(config.GREYTHR_URL);
    await page.waitForLoadState("networkidle");
    console.log("Health check successful: GreytHR is reachable.");
    logStatus("Health check successful: GreytHR is reachable.");
  } catch (error: unknown) {
    console.error("Health check failed: Unable to reach GreytHR.", error);
    logError("Health check failed: Unable to reach GreytHR.", error);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Concurrency guards
// ---------------------------------------------------------------------------

/**
 * Guards `runLoginFlow` against overlapping executions.
 *
 * Set to `true` at the start of a run and reset to `false` in the `finally`
 * block. If the cron trigger fires again while the previous run is still in
 * progress (e.g. due to a slow network or portal outage), the new invocation
 * returns early without launching a second browser.
 */
let loginRunning = false;

/**
 * Guards `runLogoutFlow` against overlapping executions.
 * Same semantics as {@link loginRunning}.
 */
let logoutRunning = false;

// ---------------------------------------------------------------------------
// runLoginFlow
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full morning attendance check-in workflow.
 *
 * **Execution order:**
 * 1. **Concurrency guard** — exits immediately if a previous run is still
 *    active (prevents overlapping browser sessions).
 * 2. **Browser launch** — opens a headless (or headed) Chromium instance.
 * 3. **Navigation + login** — navigates to the portal and authenticates via
 *    {@link authService.login}.
 * 4. **Public holiday check** — calls {@link leaveService.checkHoliday} to
 *    query `GET /v3/api/leave/years` and `GET /v3/api/leave/holidays/{year}`.
 *    If today is a mandatory (non-restricted) public holiday, attendance is
 *    skipped and a Telegram notification is sent with the holiday name.
 * 5. **Personal leave check** (only if not a public holiday) — calls
 *    {@link leaveService.checkLeave} to navigate to the Leave Apply page and
 *    inspect the Pending and History workflow tabs. If the employee has an
 *    active leave today, attendance is skipped and a notification is sent.
 * 6. **Check-in** (only if neither holiday nor leave) — calls
 *    {@link attendanceService.checkIn}, which posts to
 *    `POST /v3/api/attendance/mark-attendance?action=Signin`.
 * 7. **Success notification** — sends a Telegram message on successful check-in.
 *
 * **Error handling:**
 * Any exception thrown in steps 3–6 is caught, logged, and reported to
 * Telegram as a failure. A screenshot is also captured to assist diagnostics.
 *
 * **Resource cleanup (always runs):**
 * The `finally` block calls {@link authService.logout} to invalidate the
 * portal session, then closes the page, browser context, and browser instance
 * — in that order. This is the strict garbage-collection rule: no Chromium
 * process ever survives past the end of a flow. The `loginRunning` flag is
 * also reset here so future cron triggers are not permanently blocked.
 */
async function runLoginFlow(): Promise<void> {
  if (loginRunning) {
    logStatus("Login flow already running. Skipping this trigger.");
    console.log("Login flow already running. Skipping this trigger.");
    return;
  }
  loginRunning = true;

  console.log("Starting GreytHR login flow...");
  logStatus("Starting GreytHR login flow.");
  logStatus(`Target URL: ${config.GREYTHR_URL}`);

  // Declare outside try so finally can always clean up, even if launch fails.
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ headless: config.HEADLESS });
    context = await browser.newContext();
    page = await context.newPage();

    console.log("Navigating to login page...");
    logStatus("Navigating to login page.");
    await page.goto(config.GREYTHR_URL);

    // Utilize Auth Service
    await authService.login(
      page,
      config.GREYTHR_USERNAME,
      config.GREYTHR_PASSWORD,
    );

    // Wait for dashboard loading after login
    await page.waitForLoadState("networkidle");
    logStatus("Dashboard load after login completed.");

    // Check for public holiday
    const { isHoliday, description: holidayName } = await leaveService.checkHoliday(page);
    console.log({ isHoliday, holidayName });

    if (isHoliday) {
      console.log(`Today is a public holiday (${holidayName}). Skipping attendance check-in.`);
      logStatus(`Today is a public holiday (${holidayName}). SKIPPING check-in.`);
      await sendSuccessMessage("Login Flow (Skipped)", `Today is a public holiday: ${holidayName}. Skipped attendance check-in.`);
    } else {
      // Check for leave
      const isOnLeave = await leaveService.checkLeave(page);
      console.log({ isOnLeave });

      if (isOnLeave) {
        console.log("User is on leave today. Skipping attendance check-in.");
        logStatus("User is on leave today. SKIPPING check-in.");
        await sendSuccessMessage("Login Flow (Skipped)", "User is on leave today. Skipped attendance check-in.");
      } else {
        // Utilize Attendance Service
        await attendanceService.checkIn(page);
        logStatus("Attendance check-in flow completed.");
        await sendSuccessMessage("Login Flow Success", "Attendance check-in completed successfully.");
      }
    }
  } catch (error: unknown) {
    console.error("An error occurred during login flow:", error);
    logError("Login flow error occurred.", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendFailureMessage("Login Flow Failed", errorMessage);
    if (page && !page.isClosed()) {
      await page.screenshot({ path: "error_login_flow.png" }).catch(() => {});
    }
  } finally {
    console.log("Login flow finished. Logging out and closing browser.");
    try {
      if (page && !page.isClosed()) {
        await authService.logout(page);
      }
    } catch (logoutError) {
      console.error("Logout failed during cleanup:", logoutError);
      logError("Logout failed during cleanup.", logoutError);
    } finally {
      await page?.close().catch(() => {});
      console.log("Page closed.");
      await context?.close().catch(() => {});
      console.log("Context closed.");
      await browser?.close().catch(() => {});
      console.log("Browser closed.");
      loginRunning = false;
    }
  }
}

// ---------------------------------------------------------------------------
// runLogoutFlow
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full evening attendance check-out workflow.
 *
 * **Execution order:**
 * 1. **Concurrency guard** — exits immediately if a previous run is still
 *    active.
 * 2. **Browser launch** — opens a Chromium instance.
 * 3. **Navigation + login** — re-authenticates via {@link authService.login}.
 *    A fresh login is required because the application does not persist session
 *    cookies between runs — each flow starts with a clean browser context.
 * 4. **Check-out** — calls {@link attendanceService.checkOut}, which posts to
 *    `POST /v3/api/attendance/mark-attendance?action=Signout` only if the
 *    employee is currently signed in (guards against double sign-out).
 * 5. **Success notification** — sends a Telegram message on successful
 *    check-out.
 *
 * **Note:** The logout flow does **not** perform public holiday or personal
 * leave checks. If the morning flow was skipped (holiday/leave), the employee
 * was never signed in, so `checkOut` will find no active session and do
 * nothing — no special guard is needed here.
 *
 * **Error handling and cleanup:** Same pattern as {@link runLoginFlow}. Errors
 * are caught, logged, and reported via Telegram. The `finally` block always
 * runs {@link authService.logout} and closes all browser resources.
 */
async function runLogoutFlow(): Promise<void> {
  if (logoutRunning) {
    logStatus("Logout flow already running. Skipping this trigger.");
    console.log("Logout flow already running. Skipping this trigger.");
    return;
  }
  logoutRunning = true;

  console.log("Starting GreytHR logout flow...");
  logStatus("Starting GreytHR logout flow.");
  logStatus(`Target URL: ${config.GREYTHR_URL}`);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ headless: config.HEADLESS });
    context = await browser.newContext();
    page = await context.newPage();

    console.log("Navigating to login page for logout flow...");
    logStatus("Navigating to login page for logout flow.");
    await page.goto(config.GREYTHR_URL);

    // Reuse login to ensure we are authenticated before performing any logout-related actions
    await authService.login(
      page,
      config.GREYTHR_USERNAME,
      config.GREYTHR_PASSWORD,
    );

    // Wait for dashboard loading after login
    await page.waitForLoadState("networkidle");
    logStatus("Dashboard load before logout completed.");

    // Utilize Attendance Service
    await attendanceService.checkOut(page);
    logStatus("Attendance check-out flow completed.");
    await sendSuccessMessage("Logout Flow Success", "Attendance check-out completed successfully.");
  } catch (error: unknown) {
    console.error("An error occurred during logout flow:", error);
    logError("Logout flow error occurred.", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendFailureMessage("Logout Flow Failed", errorMessage);
    if (page && !page.isClosed()) {
      await page.screenshot({ path: "error_logout_flow.png" }).catch(() => {});
    }
  } finally {
    console.log("Logout flow finished. Logging out and closing browser.");
    try {
      if (page && !page.isClosed()) {
        await authService.logout(page);
      }
    } catch (logoutError) {
      console.error("Logout failed during cleanup:", logoutError);
      logError("Logout failed during cleanup.", logoutError);
    } finally {
      await page?.close().catch(() => {});
      console.log("Page closed.");
      await context?.close().catch(() => {});
      console.log("Context closed.");
      await browser?.close().catch(() => {});
      console.log("Browser closed.");
      logoutRunning = false;
    }
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/**
 * Application entry point. Parses CLI arguments and dispatches to the
 * appropriate mode.
 *
 * **CLI modes:**
 *
 * | Flag        | Behaviour |
 * |-------------|-----------|
 * | `--health`  | Runs {@link healthCheck} once and exits. Used by Docker's `HEALTHCHECK` and manual verification. |
 * | `--login`   | Runs {@link runLoginFlow} once and exits. Useful for manual check-in or local testing. |
 * | `--logout`  | Runs {@link runLogoutFlow} once and exits. Useful for manual check-out or local testing. |
 * | _(none)_    | Starts the persistent scheduler (see below). |
 *
 * **Scheduler mode (no flags):**
 * - Registers two `node-cron` jobs using the cron expressions from
 *   `config.LOGIN_TIME` and `config.LOGOUT_TIME` (sourced from `.env`).
 * - Starts writing a heartbeat file every 60 seconds via
 *   {@link writeHeartbeat} so Docker's `HEALTHCHECK` can verify the process
 *   is alive without launching Chromium.
 * - The process runs indefinitely; cron manages all future invocations.
 *
 * Top-level errors (e.g. config validation failure at import time) are caught
 * by the `.catch()` handler attached to the `main()` call and logged before
 * the process exits.
 */
const main = async (): Promise<void> => {
  const args = process.argv.slice(2);

  if (args.includes("--health")) {
    await healthCheck();
  } else if (args.includes("--login")) {
    await runLoginFlow();
  } else if (args.includes("--logout")) {
    await runLogoutFlow();
  } else {
    console.log(`Starting automation for ${config.GREYTHR_USERNAME}`);

    // Schedule Login Flow
    console.log(`Scheduling Login Flow for: ${config.LOGIN_TIME}`);
    logStatus(`Scheduling Login Flow for: ${config.LOGIN_TIME}`);
    cron.schedule(config.LOGIN_TIME, () => {
      logStatus("Triggering scheduled Login Flow...");
      runLoginFlow().catch((err) =>
        logError("Error in scheduled Login Flow", err),
      );
    });

    // Schedule Logout Flow
    console.log(`Scheduling Logout Flow for: ${config.LOGOUT_TIME}`);
    logStatus(`Scheduling Logout Flow for: ${config.LOGOUT_TIME}`);
    cron.schedule(config.LOGOUT_TIME, () => {
      logStatus("Triggering scheduled Logout Flow...");
      runLogoutFlow().catch((err) =>
        logError("Error in scheduled Logout Flow", err),
      );
    });

    // Write a heartbeat file every minute so the Docker healthcheck can verify
    // the scheduler is alive without launching a full Chromium browser.
    writeHeartbeat();
    setInterval(writeHeartbeat, 60_000);

    console.log("Scheduler started. Waiting for cron triggers...");
    logStatus("Scheduler started. Waiting for cron triggers...");
  }
};

main().catch((err) => {
  console.error("An error occurred in the main function:", err);
  logError("Main function error occurred.", err);
});
