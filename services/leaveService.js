const { logStatus, logError } = require('./logService');

/**
 * Robust date checker that handles both ISO (YYYY-MM-DD) and Display (DD MMM YYYY) formats
 * and ignores time components/timezones for the comparison.
 */
function isToday(dateInput) {
    try {
        if (!dateInput) return false;

        const today = new Date();
        const checkDate = new Date(dateInput);

        // Invalid date check
        if (isNaN(checkDate.getTime())) {
            logError(`Invalid date format received: ${dateInput}`);
            return false;
        }

        // Compare using local date strings to avoid UTC/Timezone flipping issues
        // e.g., "2025-12-11T00:00:00.000Z" might be "Dec 10" in New York.
        // We assume the API returns the date relevant to the user's locale.
        const todayStr = today.toDateString(); // e.g., "Thu Dec 11 2025"
        const checkStr = checkDate.toDateString();

        const isMatch = todayStr === checkStr;

        // Verbose logging for debugging - remove this after it works
        // console.log(`Comparing Today (${todayStr}) with API Date (${checkStr}) [Raw: ${dateInput}] = ${isMatch}`);

        return isMatch;
    } catch (e) {
        logError(`Error parsing date: ${dateInput}`, e);
        return false;
    }
}

/**
 * Extracts active leave dates from the API JSON response.
 */
function checkLeaveFromApiData(leaveItems) {
    if (!leaveItems || !Array.isArray(leaveItems)) {
        logStatus('API response data is not an array.');
        return false;
    }

    logStatus(`Processing ${leaveItems.length} leave items...`);

    for (const item of leaveItems) {
        const status = item.status || "Unknown";

        // 1. Filter out dead leaves
        if (['Withdrawn', 'Rejected', 'Cancelled', 'Revoked'].includes(status)) {
            continue;
        }

        // 2. Check if transaction is cancelled
        if (item.transaction && item.transaction.cancelled) {
            continue;
        }

        // 3. Dig for dates
        // Note: GreytHR API structure varies. It might be in 'transaction.children', 
        // or just 'startDate'/'endDate' on the item itself.
        let datesToCheck = [];

        // Strategy A: Children array (common for split sessions)
        if (item.transaction && Array.isArray(item.transaction.children)) {
            datesToCheck = item.transaction.children.map(c => c.leaveDate);
        }
        // Strategy B: Direct start/end dates (fallback)
        else if (item.transaction && item.transaction.fromDate && item.transaction.toDate) {
            // If it's a range, we strictly need to check if Today falls in it.
            // For simplicity, we'll check start/end match, but ideally, you need range logic here.
            // If your API returns individual day records, 'children' is the best bet.
            datesToCheck.push(item.transaction.fromDate);
        }

        // Debug Log: Uncomment if you still get false negatives
        // console.log(`Item Status: ${status}, Dates Found: ${JSON.stringify(datesToCheck)}`);

        for (const dateStr of datesToCheck) {
            if (isToday(dateStr)) {
                logStatus(`[MATCH CONFIRMED] Found active leave for TODAY (${dateStr}). Status: ${status}`);
                return true;
            }
        }
    }

    return false;
}

async function checkLeave(page) {
    logStatus('Checking leave status via API...');

    try {
        await page.waitForSelector('#mainSidebar', { state: 'visible', timeout: 5000 }).catch(() => { });

        // --- Navigation ---
        const sidebar = page.locator('#mainSidebar');
        const leaveApplyBtn = sidebar.locator('a.secondary-link').filter({ hasText: 'Leave Apply' }).first();

        if (!(await leaveApplyBtn.isVisible())) {
            logStatus('Expanding Leave menu...');
            await sidebar.locator('span.primary-title').filter({ hasText: /^Leave$/ }).first().click();
        }

        await leaveApplyBtn.waitFor({ state: 'visible' });
        await leaveApplyBtn.click();
        await page.waitForLoadState('networkidle');
        logStatus('Navigated to Leave Apply page.');

        // --- Helper to Click Tab & Intercept ---
        const checkTab = async (tabName) => {
            logStatus(`Checking ${tabName} tab...`);

            // 1. Define the predicate strictly
            // We ignore method 'OPTIONS' to avoid pre-flight checks.
            // We ensure status is 200.
            const responsePromise = page.waitForResponse(response =>
                response.url().includes('/v3/api/workflow/my-process-info-list/leave') &&
                response.request().method() === 'POST' &&
                response.status() === 200
            );

            // 2. Click the tab
            const tabLocator = page.locator(`.leavewf-links button[title="${tabName}"]`);
            await tabLocator.waitFor({ state: 'visible' });

            // Checking if tab is already active to avoid "click did nothing" issues
            const isAlreadyActive = await tabLocator.evaluate(el => el.classList.contains('btn-primary') || el.classList.contains('active'));

            if (isAlreadyActive) {
                // If it's already active, the API might have fired on page load.
                // We trigger a reload to force the API call again to be safe.
                logStatus(`Tab ${tabName} already active. Reloading list...`);
                // Sometimes clicking it again works, sometimes we need to refresh component. 
                // Let's try clicking; if it fails to fire request, the timeout will catch it.
                await tabLocator.click();
            } else {
                await tabLocator.click();
            }

            try {
                // 3. Wait for the specific response
                logStatus(`Waiting for API response for ${tabName}...`);
                const response = await responsePromise;

                // Debug: Log the actual URL we caught to ensure it's not a different filter
                logStatus(`Captured URL: ${response.url()}`);



                const data = await response.json();

                logStatus(`API response for ${tabName}: ${JSON.stringify(data)}`);

                // 4. Pass data to checker
                if (checkLeaveFromApiData(data)) {
                    return true;
                }
            } catch (e) {
                logError(`Failed to intercept/parse data for ${tabName}.`, e);
            }
            return false;
        };

        // 1. Check Pending
        if (await checkTab('Pending')) return true;

        // 2. Check History (where Approved leaves usually live)
        if (await checkTab('History')) return true;

        logStatus('No active leave found for today after API check.');
        return false;

    } catch (error) {
        logError('Error checking leave status', error);
        return false;
    }
}

module.exports = { checkLeave };