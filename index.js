const express = require('express');
const { chromium } = require('playwright');
const config = require('./config/env');
const authService = require('./services/auth');
const attendanceService = require('./services/attendance');
const { logStatus, logError } = require('./services/logService');

const app = express();
const PORT = process.env.PORT || 8080;

// Helper function for login flow
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

// Helper function for logout flow
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

// Endpoints

app.get('/health', (req, res) => {
    res.status(200).send({
        message: 'OK'
    });
});

app.post('/login', (req, res) => {
    console.log('Received login trigger.');
    res.status(200).send('Login flow triggered.');

    // Run asynchronously
    runLoginFlow().catch(err => console.error('Error in async login flow:', err));
});

app.post('/logout', (req, res) => {
    console.log('Received logout trigger.');
    res.status(200).send('Logout flow triggered.');

    // Run asynchronously
    runLogoutFlow().catch(err => console.error('Error in async logout flow:', err));
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    logStatus(`Server listening on port ${PORT}`);
});
