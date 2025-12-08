const { logStatus, logError } = require('./logService');

/**
 * Checks in the user if not already checked in.
 * @param {import('playwright').Page} page
 */
async function checkIn(page) {
    console.log('Checking login status...');
    logStatus('Checking login status for attendance.');


    // Small delay to ensure dynamic content loads (e.g. if dashboard is fetching status)
    // A robust app might wait for a specific dashboard element instead, but 3s is a decent heuristic for now
    await page.waitForTimeout(3000);

    // Potential selectors
    const signInButton = page.locator('button:has-text("Sign In"), button:has-text("Web Check-in")').first();
    const signOutButton = page.locator('button:has-text("Sign Out"), button:has-text("Web Check-out")').first();



    if (await signInButton.isVisible()) {
        console.log('User is not signed in. Attempting to sign in...');
        logStatus('User is not signed in. Attempting to sign in.');
        await signInButton.click();

        await handleLocationModal(page, 'Sign In');

        console.log('Sign in action performed.');
        logStatus('Sign in action performed from attendance service.');
    } else if (await signOutButton.isVisible()) {
        console.log('User is already signed in.');
        logStatus('User is already signed in; no attendance action taken.');
    } else {
        console.log('Could not determine sign-in status. Dashboard might have changed or login failed.');
        logError('Could not determine sign-in status. Dashboard might have changed or login failed.');
        await page.screenshot({ path: 'debug_status.png' });
    }
}

async function checkOut(page) {
    console.log('Checking login status (Check Out)...');
    logStatus('Checking login status for attendance (Check Out).');

    // Small delay to ensure dynamic content loads
    await page.waitForTimeout(3000);

    const signOutButton = page.locator('button:has-text("Sign Out"), button:has-text("Web Check-out")').first();
    if (await signOutButton.isVisible()) {
        console.log('User is signed in. Attempting to sign out...');
        logStatus('User is signed in. Attempting to sign out.');
        await signOutButton.click();

        await handleLocationModal(page, 'Sign Out');

        console.log('Sign out action performed.');
        logStatus('Sign out action performed from attendance service.');
    } else {
        console.log('User is not signed in or Sign Out button not found.');
        logStatus('User is not signed in or Sign Out button not found; cannot check out.');
    }
}

/**
 * Handles "Work from Home" or Location selection if needed for both Sign In and Sign Out.
 * @param {import('playwright').Page} page
 * @param {string} actionButtonText - The text on the button to click inside the modal (e.g., "Sign In" or "Sign Out")
 */
async function handleLocationModal(page, actionButtonText) {
    try {
        // Wait for the modal header to confirm we are in the flow
        const modalHeader = page.locator('text="Tell us your work location."');
        await modalHeader.waitFor({ state: 'visible', timeout: 5000 });
        console.log(`Work from Home modal detected for ${actionButtonText}.`);
        logStatus(`Work from Home modal detected for ${actionButtonText}.`);

        // Click the dropdown trigger
        // Using locator that pierces shadow DOM automatically in Playwright for open shadow roots
        const dropdownTrigger = page.locator('gt-dropdown .dropdown-button');
        await dropdownTrigger.click();

        // Select the "Work from Home" option
        // Assuming the list renders with standard text elements or list items
        // Wait for dropdown options to appear
        const dropdownBody = page.locator('.dropdown-body');
        await dropdownBody.waitFor({ state: 'visible', timeout: 5000 });

        // Select the "Work from Home" option
        // Using specific selector based on user provided HTML structure
        const wfhOption = page.locator('.dropdown-item .item-label', { hasText: 'Work from Home' });
        await wfhOption.click();

        // Click the action button inside the modal (Sign In or Sign Out)
        const actionButton = page.locator(`button:has-text("${actionButtonText}")`);
        // Ensure we are clicking the enabled one in the modal, not the one that triggered it (if still visible)
        // Usually the modal button is distinct. We can filter by visibility.
        await actionButton.filter({ hasText: actionButtonText }).last().click();

        console.log(`Selected "Work from Home" and clicked ${actionButtonText}.`);
        logStatus(`Selected "Work from Home" and clicked ${actionButtonText}.`);

    } catch (e) {
        console.log('No location selection required, modal not found, or interaction failed.');
        logStatus('No location selection required, modal not found, or interaction failed while handling Work from Home.');
        // If it was just not found, that's fine (maybe not first login of day), but if found and failed, we log it.
        if (e && e.message && e.message.includes('Tell us your work location')) {
            console.log('Modal check skipped (not visible).');
            logStatus('Work from Home modal not visible; skipping.');
        } else {
            console.error('Error handling Work from Home:', e);
            logError('Error handling Work from Home.', e);
            await page.screenshot({ path: 'wfh_error.png' });
        }
    }
}

module.exports = { checkIn, checkOut };
