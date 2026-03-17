import { Page } from "playwright";
import { logStatus, logError } from "./logService";
import { sendFailureEmail } from "./mailer";

interface AttendanceLocation {
  id: number;
  description: string;
}

interface SwipeInfo {
  firstInTime?: string | null;
  lastOutTime?: string | null;
}

interface AttendanceInfo {
  swipeInfo?: SwipeInfo | null;
}

interface AttendanceData {
  attLocations?: AttendanceLocation[];
  attendanceInfo?: AttendanceInfo | null;
}

interface AttendanceActionPayload {
  locationId: number;
  act: "Signin" | "Signout";
}

async function navigateToHome(page: Page): Promise<void> {
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
  } catch (error: unknown) {
    logError("Error navigating to Attendance Page:", error);
  }
}

async function getAttendanceData(page: Page): Promise<AttendanceData | null> {
  // Set up response promise before navigating to trigger the request
  const workLocationListingResponsePromise = page
    .waitForResponse(
      (response) =>
        response.url().includes("/v3/api/dashboard/dashlet/markAttendance") &&
        response.request().method() === "GET" &&
        response.status() === 200,
      { timeout: 15000 },
    )
    .catch(() => null);

  // Ensure we are on the Home Dashboard (this may trigger the GET request)
  await navigateToHome(page);

  let workLocationData: AttendanceData;
  const workLocationListingResponse = await workLocationListingResponsePromise;

  if (workLocationListingResponse) {
    workLocationData =
      (await workLocationListingResponse.json()) as AttendanceData;
  } else {
    logStatus(
      "Timeout waiting for markAttendance GET API via interception, falling back to manual fetch.",
    );
    try {
      workLocationData = await page.evaluate(async (): Promise<AttendanceData> => {
        const res = await fetch("/v3/api/dashboard/dashlet/markAttendance");
        if (!res.ok) throw new Error("HTTP " + res.status);
        return (await res.json()) as AttendanceData;
      });
    } catch (error: unknown) {
      logError("Failed to fetch markAttendance GET request manually.");
      await page.screenshot({ path: `logs/ss/debug_status_${Date.now()}.png` });
      return null;
    }
  }
  return workLocationData;
}

async function performAttendanceAction(
  page: Page,
  workLocationData: AttendanceData,
  action: "Signin" | "Signout",
): Promise<void> {
  let attLocationId = 39; // Default fallback if not found
  if (
    workLocationData.attLocations &&
    Array.isArray(workLocationData.attLocations)
  ) {
    const wfhLocation = workLocationData.attLocations.find(
      (loc: AttendanceLocation) => loc.description === "Work from Home",
    );
    if (wfhLocation) {
      attLocationId = wfhLocation.id;
    }
  }

  try {
    const apiResponse = await page.evaluate(
      async ({
        locationId,
        act,
      }: AttendanceActionPayload): Promise<unknown> => {
        const res = await fetch(
          `/v3/api/attendance/mark-attendance?action=${act}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              attLocation: locationId,
              remarks: "",
            }),
          },
        );
        if (!res.ok) {
          throw new Error("HTTP " + res.status);
        }
        return res.json();
      },
      { locationId: attLocationId, act: action },
    );

    console.log(`${action} API Response:`, apiResponse);
    logStatus(`${action} action performed from attendance service via API.`);
  } catch (apiError: unknown) {
    logError(`Failed to perform ${action} via API:`, apiError);

    const screenshotPath = `logs/ss/api_${action.toLowerCase()}_failed_${Date.now()}.png`;

    await page.screenshot({ path: screenshotPath });
    logError(`API ${action} failed. Screenshot captured at ${screenshotPath}`);

    const errorMessage =
      apiError instanceof Error ? apiError.message : String(apiError);

    await sendFailureEmail(
      `${action} API Failed for GreytHR Attendance`,
      `An error occurred while performing ${action} via API in the GreytHR attendance automation.\n\nError Details: ${errorMessage}\n\nPlease check the attached screenshot for more details.`,
      screenshotPath,
    );
  }
}

async function checkIn(page: Page): Promise<void> {
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
    await performAttendanceAction(page, workLocationData, "Signin");
  }
}

async function checkOut(page: Page): Promise<void> {
  console.log("Checking checkout status...");
  logStatus("Checking checkout status for attendance.");

  const workLocationData = await getAttendanceData(page);
  if (!workLocationData) return;

  const attendanceInfo = workLocationData.attendanceInfo;
  const swipeInfo = attendanceInfo && attendanceInfo.swipeInfo;

  if (swipeInfo && swipeInfo.firstInTime && !swipeInfo.lastOutTime) {
    logStatus("User is signed in. Attempting to sign out via API.");
    await performAttendanceAction(page, workLocationData, "Signout");
  } else {
    logStatus(
      "User is not signed in or already signed out; no checkout action taken.",
    );
  }
}

export { checkIn, checkOut, navigateToHome };
