import { Page } from "playwright";
import { logStatus, logError } from "./logService";

/**
 * Logs in to the GreytHR portal.
 * @param {Page} page
 * @param {string} username
 * @param {string} password
 */
async function login(page: Page, username: string, password: string) {
  console.log("Attempting login...");
  logStatus("Attempting login.");

  const usernameInput = page.locator(
    'input[name="username"], input[id="username"]',
  );
  const passwordInput = page.locator(
    'input[name="password"], input[id="password"]',
  );
  const loginButton = page.locator(
    'button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")',
  );

  await usernameInput.fill(username);
  await passwordInput.fill(password);

  await loginButton.click();

  await page.waitForLoadState("networkidle").catch((error: unknown) => {
    logError("Error while waiting for network idle after login.", error);
  });

  console.log("Login attempt completed.");
  logStatus("Login attempt completed.");
}

async function logout(page: Page): Promise<void> {
  const logoutButton = page.locator('a[title="Logout"]');
  console.log("Attempting logout...");
  logStatus("Attempting logout.");
  await logoutButton.click();

  await page.waitForLoadState("networkidle").catch((error: unknown) => {
    logError("Error while waiting for network idle after logout.", error);
  });

  console.log("Logout attempt completed.");
  logStatus("Logout attempt completed.");
}

export { login, logout };
