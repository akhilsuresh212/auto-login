const { chromium } = require('playwright');
const cron = require('node-cron');
const config = require('./config/env');
const authService = require('./services/auth');
const attendanceService = require('./services/attendance');
const { logStatus, logError } = require('./services/logService');

async function runLoginFlow() {
    console.log('Starting GreytHR login flow...');
    logStatus('Starting GreytHR login flow.');
    logStatus(`Target URL: ${config.GREYTHR_URL}`);

    const browser = await chromium.launch({
        headless: config.HEADLESS,
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log('Navigating to login page...');
        logStatus('Navigating to login page.');
        await page.goto(config.GREYTHR_URL);

        // Utilize Auth Service
        await authService.login(page, config.GREYTHR_USERNAME, config.GREYTHR_PASSWORD);

        // Wait for dashboard loading after login
        await page.waitForLoadState('networkidle');
        logStatus('Dashboard load after login completed.');

        // Utilize Attendance Service
        await attendanceService.checkIn(page);
        logStatus('Attendance check-in flow completed.');

    } catch (error) {
        console.error('An error occurred during login flow:', error);
        logError('Login flow error occurred.', error);
        await page.screenshot({ path: 'error_login_flow.png' });
    } finally {
        console.log('Login flow finished. Logging out and closing browser.');
        await authService.logout(page);
        await page.close();
        console.log('Page closed.');
        await context.close();
        console.log('Context closed.');
        await browser.close();
        console.log('Browser closed.');
    }
}

async function runLogoutFlow() {
    console.log('Starting GreytHR logout flow...');
    logStatus('Starting GreytHR logout flow.');
    logStatus(`Target URL: ${config.GREYTHR_URL}`);

    const browser = await chromium.launch({
        headless: config.HEADLESS,
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log('Navigating to login page for logout flow...');
        logStatus('Navigating to login page for logout flow.');
        await page.goto(config.GREYTHR_URL);

        // Reuse login to ensure we are authenticated before performing any logout-related actions
        await authService.login(page, config.GREYTHR_USERNAME, config.GREYTHR_PASSWORD);

        // Wait for dashboard loading after login
        await page.waitForLoadState('networkidle');
        logStatus('Dashboard load before logout completed.');

        // Utilize Attendance Service
        await attendanceService.checkOut(page);
        logStatus('Attendance check-out flow completed.');

    } catch (error) {
        console.error('An error occurred during logout flow:', error);
        logError('Logout flow error occurred.', error);
        await page.screenshot({ path: 'error_logout_flow.png' });
    } finally {
        console.log('Logout flow finished. Logging out and closing browser.');
        await authService.logout(page);
        await page.close();
        console.log('Page closed.');
        await context.close();
        console.log('Context closed.');
        await browser.close();
        console.log('Browser closed.');
    }
}

console.log('Scheduling login and logout flows with node-cron...');
logStatus('Scheduling login and logout flows with node-cron.');
logStatus(`LOGIN_TIME (cron): ${config.LOGIN_TIME}, LOGOUT_TIME (cron): ${config.LOGOUT_TIME}`);

console.log(`LOGIN_TIME (cron): ${config.LOGIN_TIME}, LOGOUT_TIME (cron): ${config.LOGOUT_TIME}`);

cron.schedule(config.LOGIN_TIME, () => {
    logStatus('Cron trigger fired for login-flow.');
    console.log('Cron trigger fired for login-flow.');
    runLoginFlow();
});

cron.schedule(config.LOGOUT_TIME, () => {
    logStatus('Cron trigger fired for logout-flow.');
    console.log('Cron trigger fired for logout-flow.');
    runLogoutFlow();
});
