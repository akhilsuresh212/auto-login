import { Page } from "playwright";
import { logStatus, logError } from "./logService";
import { sendFailureEmail } from "./mailer";

/**
 * A single work-location option returned by the `/v3/api/dashboard/dashlet/markAttendance`
 * endpoint. The user must choose one of these when marking attendance.
 *
 * Common examples observed in production:
 * - `{ id: 39, description: "Work from Home" }`
 * - `{ id: 40, description: "Office" }`
 * - `{ id: 41, description: "Client Location" }`
 * - `{ id: 42, description: "On-Duty" }`
 */
interface AttendanceLocation {
  /** Numeric identifier sent as `attLocation` in the mark-attendance POST body. */
  id: number;
  /** Human-readable label shown in the portal's attendance widget. */
  description: string;
}

/**
 * Swipe (punch) timestamps for the current working day, nested inside
 * `AttendanceInfo`. Both fields are `null` before the first sign-in of the day.
 */
interface SwipeInfo {
  /**
   * ISO 8601 timestamp of the employee's first sign-in of the day.
   * `null` means the employee has not signed in yet today.
   */
  firstInTime?: string | null;
  /**
   * ISO 8601 timestamp of the employee's last sign-out of the day.
   * `null` while the employee is currently signed in (no check-out yet).
   */
  lastOutTime?: string | null;
}

/**
 * Attendance metadata for the current day, part of the dashboard dashlet
 * response. Contains the nested {@link SwipeInfo} used to determine sign-in
 * / sign-out state.
 */
interface AttendanceInfo {
  /** Punch timestamps for today; `null` if the shift has not started. */
  swipeInfo?: SwipeInfo | null;
}

/**
 * Shape of the response from `GET /v3/api/dashboard/dashlet/markAttendance`.
 *
 * This endpoint is the source of truth for:
 * 1. The available work-location options (`attLocations`).
 * 2. Whether the employee is currently signed in or out (`attendanceInfo.swipeInfo`).
 */
interface AttendanceData {
  /** List of valid work locations the employee can check in/out from. */
  attLocations?: AttendanceLocation[];
  /** Today's attendance state, including punch timestamps. */
  attendanceInfo?: AttendanceInfo | null;
}

/**
 * Serialisable payload passed into the `page.evaluate()` call that posts to
 * `POST /v3/api/attendance/mark-attendance`.
 *
 * Playwright's `page.evaluate()` serialises arguments to JSON when crossing the
 * Node.js ↔ browser boundary, so all fields must be JSON-safe primitives.
 */
interface AttendanceActionPayload {
  /** The numeric work-location ID to record for this attendance event. */
  locationId: number;
  /** The action to perform: `"Signin"` for check-in, `"Signout"` for check-out. */
  act: "Signin" | "Signout";
}

/**
 * Fetches the current day's attendance data directly from the GreytHR dashboard
 * API using `page.evaluate(fetch())` inside the authenticated browser context.
 *
 * **Why `page.evaluate` instead of a Node.js `fetch`?**
 * The GreytHR API uses HttpOnly session cookies that are not accessible from
 * Node.js. By running the request inside the browser via `page.evaluate`, the
 * browser automatically attaches the correct session cookies, bypassing the
 * need to manage them manually in Node.js.
 *
 * **Endpoint:** `GET /v3/api/dashboard/dashlet/markAttendance`
 *
 * On success the response contains:
 * - `attLocations`: the array of available work-location choices.
 * - `attendanceInfo.swipeInfo.firstInTime`: non-null if the employee has
 *   already signed in today.
 * - `attendanceInfo.swipeInfo.lastOutTime`: non-null if the employee has
 *   already signed out today.
 *
 * On failure a screenshot is captured to `logs/ss/debug_status_<timestamp>.png`
 * before returning `null`, so the caller can skip the attendance action safely.
 *
 * @param page - The authenticated Playwright `Page`. Can be on any portal URL;
 *               the fetch runs in the browser context so session cookies apply.
 * @returns The parsed `AttendanceData` object, or `null` if the request failed.
 */
async function getAttendanceData(page: Page): Promise<AttendanceData | null> {
  logStatus("Fetching attendance data via API...");
  try {
    const data = await page.evaluate(async (): Promise<AttendanceData> => {
      const res = await fetch("/v3/api/dashboard/dashlet/markAttendance");
      if (!res.ok) throw new Error("HTTP " + res.status);
      return (await res.json()) as AttendanceData;
    });
    return data;
  } catch (error: unknown) {
    logError("Failed to fetch attendance data via API.", error);
    await page.screenshot({ path: `logs/ss/debug_status_${Date.now()}.png` });
    return null;
  }
}

/**
 * Posts a sign-in or sign-out event to the GreytHR attendance API.
 *
 * **Work-location resolution**
 * The function scans `workLocationData.attLocations` for an entry whose
 * `description` equals `"Work from Home"` and uses that entry's `id` as the
 * `attLocation` parameter. If no such entry is found, it falls back to the
 * hardcoded ID `39`, which is the observed production ID for "Work from Home"
 * at the target company.
 *
 * **Endpoint:** `POST /v3/api/attendance/mark-attendance?action={Signin|Signout}`
 *
 * **Request body:**
 * ```json
 * { "attLocation": <locationId>, "remarks": "" }
 * ```
 *
 * **Error handling**
 * If the API call fails (non-2xx status or network error), the function:
 * 1. Logs the error to `login-error.log`.
 * 2. Captures a screenshot to `logs/ss/api_<action>_failed_<timestamp>.png`.
 * 3. Sends a failure email via {@link sendFailureEmail} with the screenshot
 *    attached, so the operator is notified immediately.
 *
 * The function does **not** rethrow the error. Attendance failures are
 * surfaced through the email alert; the overall flow continues to the
 * `finally` logout/cleanup block.
 *
 * @param page             - The authenticated Playwright `Page`.
 * @param workLocationData - The {@link AttendanceData} previously fetched by
 *                           {@link getAttendanceData}, used to resolve the
 *                           correct work-location ID.
 * @param action           - `"Signin"` to record a check-in,
 *                           `"Signout"` to record a check-out.
 */
async function performAttendanceAction(
  page: Page,
  workLocationData: AttendanceData,
  action: "Signin" | "Signout",
): Promise<void> {
  let attLocationId = 39; // Default fallback: Work from Home
  if (workLocationData.attLocations && Array.isArray(workLocationData.attLocations)) {
    const wfhLocation = workLocationData.attLocations.find(
      (loc: AttendanceLocation) => loc.description === "Work from Home",
    );
    if (wfhLocation) {
      attLocationId = wfhLocation.id;
    }
  }

  try {
    const apiResponse = await page.evaluate(
      async ({ locationId, act }: AttendanceActionPayload): Promise<unknown> => {
        const res = await fetch(`/v3/api/attendance/mark-attendance?action=${act}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attLocation: locationId, remarks: "" }),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
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

    const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
    await sendFailureEmail(
      `${action} API Failed for GreytHR Attendance`,
      `An error occurred while performing ${action} via API in the GreytHR attendance automation.\n\nError Details: ${errorMessage}\n\nPlease check the attached screenshot for more details.`,
      screenshotPath,
    );
  }
}

/**
 * Checks the employee's current attendance state and marks a sign-in if they
 * have not already done so today.
 *
 * **Decision logic** (based on `swipeInfo` from the API):
 * - `firstInTime` is set **and** `lastOutTime` is `null` → already signed in,
 *   no action taken.
 * - Any other combination (neither signed in, or previously signed in and out
 *   again) → calls {@link performAttendanceAction} with `"Signin"`.
 *
 * This is the primary entry point called by `runLoginFlow` in `index.ts`
 * after confirming the day is not a public holiday or personal leave.
 *
 * @param page - The authenticated Playwright `Page`.
 */
async function checkIn(page: Page): Promise<void> {
  console.log("Checking login status...");
  logStatus("Checking login status for attendance.");

  const workLocationData = await getAttendanceData(page);
  if (!workLocationData) return;

  const swipeInfo = workLocationData.attendanceInfo?.swipeInfo;
  if (swipeInfo?.firstInTime && !swipeInfo.lastOutTime) {
    logStatus("User is already signed in; no attendance action taken.");
  } else {
    logStatus("User is not signed in. Attempting to sign in via API.");
    await performAttendanceAction(page, workLocationData, "Signin");
  }
}

/**
 * Checks the employee's current attendance state and marks a sign-out if they
 * are currently signed in.
 *
 * **Decision logic** (based on `swipeInfo` from the API):
 * - `firstInTime` is set **and** `lastOutTime` is `null` → currently signed in,
 *   calls {@link performAttendanceAction} with `"Signout"`.
 * - Any other combination (not signed in, or already signed out) → no action
 *   taken, state logged.
 *
 * This is the primary entry point called by `runLogoutFlow` in `index.ts`.
 *
 * @param page - The authenticated Playwright `Page`.
 */
async function checkOut(page: Page): Promise<void> {
  console.log("Checking checkout status...");
  logStatus("Checking checkout status for attendance.");

  const workLocationData = await getAttendanceData(page);
  if (!workLocationData) return;

  const swipeInfo = workLocationData.attendanceInfo?.swipeInfo;
  if (swipeInfo?.firstInTime && !swipeInfo.lastOutTime) {
    logStatus("User is signed in. Attempting to sign out via API.");
    await performAttendanceAction(page, workLocationData, "Signout");
  } else {
    logStatus("User is not signed in or already signed out; no checkout action taken.");
  }
}

export { checkIn, checkOut };
