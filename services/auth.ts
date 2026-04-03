import { Page } from "playwright";
import { logStatus, logError } from "./logService";

/**
 * Logs in to the GreytHR portal by filling the username/password fields and
 * submitting the login form via Playwright UI interactions.
 *
 * **Why UI instead of a direct API call?**
 * The GreytHR login endpoint (`POST /uas/v1/login`) requires the password to
 * be RSA-encrypted on the client side using a public key that is fetched
 * dynamically during the OAuth challenge flow. Replicating that handshake in
 * Node.js would be fragile and could break silently if the key rotates. Using
 * Playwright to drive the real browser form keeps the encryption handled by
 * the Angular app itself, exactly as a human would.
 *
 * **Locator strategy**
 * Multiple CSS selectors are combined with a comma so the locator matches
 * whichever attribute is present in the current version of the portal's DOM.
 * This makes the function resilient to minor markup changes.
 *
 * After clicking submit, the function waits for `networkidle` so that
 * subsequent callers can safely assume the dashboard SPA has fully loaded.
 * Timeout errors from `waitForLoadState` are caught and logged rather than
 * thrown, because a slow network should not abort an otherwise successful login.
 *
 * @param page     - The active Playwright `Page` to interact with. The page
 *                   must already be navigated to the GreytHR login URL before
 *                   calling this function.
 * @param username - GreytHR employee username (e.g. `"CS-1093"`).
 * @param password - Plain-text password. Playwright types it into the password
 *                   field; the Angular app encrypts it before the HTTP request.
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

/**
 * Logs out of the GreytHR portal by clicking the logout anchor in the top
 * navigation bar.
 *
 * **Why UI instead of a direct API call?**
 * No dedicated logout API endpoint was observed in the HTTP archive of the
 * application. The Angular SPA handles session termination entirely through
 * the logout link, so UI interaction is the only reliable approach.
 *
 * The function waits for `networkidle` after clicking so the session cookie
 * is fully invalidated before the browser context is closed by the caller.
 * Timeout errors are caught and logged rather than thrown, because a slow
 * redirect should not prevent the `finally` cleanup in the calling flow from
 * completing.
 *
 * This function is always called inside the `finally` block of
 * `runLoginFlow` and `runLogoutFlow` in `index.ts`, guaranteeing that the
 * session is closed even when an earlier step throws.
 *
 * @param page - The active Playwright `Page`. Must be the same page on which
 *               `login()` was called; the session cookie lives in its context.
 */
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
