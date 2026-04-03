import { chromium, Browser, BrowserContext, Page } from "playwright";
import cron from "node-cron";
import fs from "fs";
import config from "./config/env";
import * as authService from "./services/auth";
import * as attendanceService from "./services/attendance";
import { logStatus, logError } from "./services/logService";
import * as leaveService from "./services/leaveService";
import { sendSuccessMessage, sendFailureMessage } from "./services/telegram";

const HEARTBEAT_FILE = "/tmp/heartbeat";

function writeHeartbeat(): void {
  try {
    fs.writeFileSync(HEARTBEAT_FILE, new Date().toISOString());
  } catch {
    // ignore — heartbeat is best-effort
  }
}

// Prevent unexpected process exits from unhandled async errors.
// Node.js v15+ exits by default on unhandledRejection; these handlers keep
// the scheduler alive and log the problem instead.
process.on("unhandledRejection", (reason: unknown) => {
  console.error("Unhandled promise rejection:", reason);
  logError("Unhandled promise rejection", reason);
});

process.on("uncaughtException", (error: Error) => {
  console.error("Uncaught exception:", error);
  logError("Uncaught exception", error);
});

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

// Concurrent-execution guards: prevent a second run from starting if the
// previous one hasn't finished yet (e.g. slow network or site outage).
let loginRunning = false;
let logoutRunning = false;

// Helper function for login flow
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

// Helper function for logout flow
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
