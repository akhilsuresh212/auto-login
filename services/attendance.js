const { logStatus, logError } = require("./logService");

/**
 * Navigates to the Home Dashboard.
 * @param {import('playwright').Page} page
 */
async function navigateToHome(page) {
  try {
    console.log("Navigating to Attendance Page (Home)...");
    logStatus("Navigating to Attendance Page (Home)...");

    // Selector based on the provided structure: nav -> ... -> a.primary-link -> span.primary-title "Home"
    const homeLink = page
      .locator("nav a.primary-link")
      .filter({ hasText: "Home" })
      .first();

    if (await homeLink.isVisible()) {
      await homeLink.click();
      await page.waitForLoadState("networkidle");
      logStatus("Navigated to Home.");
    } else {
      logError("Home link not visible. Unable to navigate to Attendance page.");
    }
  } catch (error) {
    logError("Error navigating to Attendance Page:", error);
  }
}

/**
 * Common logic to fetch attendance data.
 * @param {import('playwright').Page} page
 */
async function getAttendanceData(page) {
  // Set up response promise before navigating to trigger the request
  const workLocationListingResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/v3/api/dashboard/dashlet/markAttendance") &&
      response.request().method() === "GET" &&
      response.status() === 200,
    { timeout: 15000 }
  ).catch(() => null);

  // Ensure we are on the Home Dashboard (this may trigger the GET request)
  await navigateToHome(page);

  let workLocationData;
  const workLocationListingResponse = await workLocationListingResponsePromise;

  if (workLocationListingResponse) {
    workLocationData = await workLocationListingResponse.json();
  } else {
    logStatus("Timeout waiting for markAttendance GET API via interception, falling back to manual fetch.");
    try {
      workLocationData = await page.evaluate(async () => {
        const res = await fetch('/v3/api/dashboard/dashlet/markAttendance');
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      });
    } catch (error) {
      logError("Failed to fetch markAttendance GET request manually.");
      await page.screenshot({ path: `logs/ss/debug_status_${Date.now()}.png` });
      return null;
    }
  }
  return workLocationData;
}

/**
 * Performs the actual API call for Signin or Signout
 * @param {import('playwright').Page} page
 * @param {Object} workLocationData
 * @param {string} action - 'Signin' or 'Signout'
 */
async function performAttendanceAction(page, workLocationData, action) {
  // Find 'Work from Home' location ID
  let attLocationId = 39; // Default fallback if not found
  if (workLocationData.attLocations && Array.isArray(workLocationData.attLocations)) {
    const wfhLocation = workLocationData.attLocations.find(loc => loc.description === "Work from Home");
    if (wfhLocation) {
      attLocationId = wfhLocation.id;
    }
  }

  try {
    const apiResponse = await page.evaluate(async ({ locationId, act }) => {
      const res = await fetch(`/v3/api/attendance/mark-attendance?action=${act}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          attLocation: locationId,
          remarks: ""
        })
      });
      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }
      return res.json();
    }, { locationId: attLocationId, act: action });

    console.log(`${action} API Response:`, apiResponse);
    logStatus(`${action} action performed from attendance service via API.`);
  } catch (apiError) {
    logError(`Failed to perform ${action} via API:`, apiError);
    await page.screenshot({ path: `logs/ss/api_${action.toLowerCase()}_failed_${Date.now()}.png` });
  }
}

/**
 * Checks in the user if not already checked in.
 * @param {import('playwright').Page} page
 */
async function checkIn(page) {
  console.log("Checking login status...");
  logStatus("Checking login status for attendance.");

  const workLocationData = await getAttendanceData(page);
  if (!workLocationData) return;

  const attendanceInfo = workLocationData.attendanceInfo;
  const swipeInfo = attendanceInfo && attendanceInfo.swipeInfo;

  if (swipeInfo && swipeInfo.firstInTime && !swipeInfo.lastOutTime) {
    logStatus("User is already signed in; no attendance action taken.");
  } else {
    logStatus("User is not signed in. Attempting to sign in via API.");
    await performAttendanceAction(page, workLocationData, 'Signin');
  }
}

/**
 * Checks out the user if currently checked in.
 * @param {import('playwright').Page} page
 */
async function checkOut(page) {
  console.log("Checking checkout status...");
  logStatus("Checking checkout status for attendance.");

  const workLocationData = await getAttendanceData(page);
  if (!workLocationData) return;

  const attendanceInfo = workLocationData.attendanceInfo;
  const swipeInfo = attendanceInfo && attendanceInfo.swipeInfo;

  if (swipeInfo && swipeInfo.firstInTime && !swipeInfo.lastOutTime) {
    logStatus("User is signed in. Attempting to sign out via API.");
    await performAttendanceAction(page, workLocationData, 'Signout');
  } else {
    logStatus("User is not signed in or already signed out; no checkout action taken.");
  }
}

module.exports = { checkIn, checkOut, navigateToHome };
