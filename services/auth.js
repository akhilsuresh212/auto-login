const { logStatus, logError } = require('./logService');

/**
 * Logs in to the GreytHR portal.
 * @param {import('playwright').Page} page
 * @param {string} username
 * @param {string} password
 */
async function login(page, username, password) {
    console.log('Attempting login...');
    logStatus('Attempting login.');

    // Selectors
    const usernameInput = page.locator('input[name="username"], input[id="username"]');
    const passwordInput = page.locator('input[name="password"], input[id="password"]');
    const loginButton = page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")');

    await usernameInput.fill(username);
    await passwordInput.fill(password);

    await loginButton.click();

    // Wait for the network to be idle after login, which implies navigation/loading finished
    await page.waitForLoadState('networkidle').catch((error) => {
        logError('Error while waiting for network idle after login.', error);
    });

    console.log('Login attempt completed.');
    logStatus('Login attempt completed.');
}

async function logout(page) {

    // select an anchor tag with title "Logout"
    const logoutButton = page.locator('a[title="Logout"]');
    console.log('Attempting logout...');
    logStatus('Attempting logout.');
    await logoutButton.click();

    // Wait for the network to be idle after logout, which implies navigation/loading finished
    await page.waitForLoadState('networkidle').catch((error) => {
        logError('Error while waiting for network idle after logout.', error);
    });

    console.log('Logout attempt completed.');
    logStatus('Logout attempt completed.');
}

module.exports = { login, logout };
