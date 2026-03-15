const { chromium } = require("playwright");
const cron = require("node-cron");
const config = require("./config/env");
const authService = require("./services/auth");
const attendanceService = require("./services/attendance");
const { logStatus, logError } = require("./services/logService");
const leaveService = require("./services/leaveService");

async function healthCheck() {
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
  } catch (error) {
    console.error("Health check failed: Unable to reach GreytHR.", error);
    logError("Health check failed: Unable to reach GreytHR.", error);

    process.exit(1); // Exit with error code to indicate failure
  } finally {
    await page.close();
    await context.close();
    await browser.close();

    process.exit(0); // Exit with success code to indicate health check passed
  }
}

// Helper function for login flow
async function runLoginFlow() {
  console.log("Starting GreytHR login flow...");
  logStatus("Starting GreytHR login flow.");
  logStatus(`Target URL: ${config.GREYTHR_URL}`);

  const browser = await chromium.launch({
    headless: config.HEADLESS,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
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

    // Check for leave
    const isOnLeave = await leaveService.checkLeave(page);

    console.log({
      isOnLeave,
    });

    if (isOnLeave) {
      console.log("User is on leave today. Skipping attendance check-in.");
      logStatus("User is on leave today. SKIPPING check-in.");
    } else {
      // Utilize Attendance Service
      await attendanceService.checkIn(page);
      logStatus("Attendance check-in flow completed.");
    }
  } catch (error) {
    console.error("An error occurred during login flow:", error);
    logError("Login flow error occurred.", error);
    await page.screenshot({ path: "error_login_flow.png" });
  } finally {
    console.log("Login flow finished. Logging out and closing browser.");
    await authService.logout(page);
    await page.close();
    console.log("Page closed.");
    await context.close();
    console.log("Context closed.");
    await browser.close();
    console.log("Browser closed.");
  }
}

// Helper function for logout flow
async function runLogoutFlow() {
  console.log("Starting GreytHR logout flow...");
  logStatus("Starting GreytHR logout flow.");
  logStatus(`Target URL: ${config.GREYTHR_URL}`);

  const browser = await chromium.launch({
    headless: config.HEADLESS,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
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
  } catch (error) {
    console.error("An error occurred during logout flow:", error);
    logError("Logout flow error occurred.", error);
    await page.screenshot({ path: "error_logout_flow.png" });
  } finally {
    console.log("Logout flow finished. Logging out and closing browser.");
    await authService.logout(page);
    await page.close();
    console.log("Page closed.");
    await context.close();
    console.log("Context closed.");
    await browser.close();
    console.log("Browser closed.");
  }
}

const main = async () => {
  const args = process.argv.slice(2);

  if (args.includes("--health")) {
    await healthCheck();
  } else {
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

    console.log("Scheduler started. Waiting for cron triggers...");
    logStatus("Scheduler started. Waiting for cron triggers...");
  }
};

main().catch((err) => {
  console.error("An error occurred in the main function:", err);
  logError("Main function error occurred.", err);
});
