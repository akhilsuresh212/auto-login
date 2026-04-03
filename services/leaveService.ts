import { Page } from "playwright";
import { logStatus, logError } from "./logService";

// ---------------------------------------------------------------------------
// Leave-check interfaces
// ---------------------------------------------------------------------------

/**
 * Represents a single day within a multi-day leave transaction.
 * The `leaveDate` field holds an ISO 8601 date string (e.g. `"2026-04-03"`)
 * or a display-format string (e.g. `"03 Apr 2026"`).
 */
interface LeaveTransactionChild {
  /** The specific calendar date of this leave day. */
  leaveDate?: string;
}

/**
 * The transaction detail block embedded in each leave workflow item.
 *
 * For half-day or multi-day leaves, the individual dates are listed in
 * `children`. For leaves stored as a simple date range, only `fromDate`
 * and `toDate` are present (no `children` array).
 */
interface LeaveTransaction {
  /**
   * `true` if this transaction has been cancelled at the transaction level
   * (distinct from the outer `status` field). Items with this flag set are
   * always skipped.
   */
  cancelled?: boolean;
  /**
   * Per-day breakdown of the leave. Present for granular (half-day or
   * multi-day) leaves. When present, individual `leaveDate` values are used
   * for today-matching instead of `fromDate`/`toDate`.
   */
  children?: LeaveTransactionChild[];
  /** Start date of the leave range (ISO 8601 or display format). */
  fromDate?: string;
  /** End date of the leave range (ISO 8601 or display format). */
  toDate?: string;
}

/**
 * A single leave application item from the workflow API response
 * (`POST /v3/api/workflow/my-process-info-list/leave`).
 *
 * The `status` field drives the filtering logic in
 * {@link checkLeaveFromApiData}: items with a terminal negative status
 * (Withdrawn, Rejected, etc.) are excluded from the today-check.
 */
interface LeaveItem {
  /**
   * Approval/workflow status of the leave application.
   * Examples: `"Pending"`, `"Approved"`, `"Withdrawn"`, `"Rejected"`,
   * `"Cancelled"`, `"Revoked"`.
   */
  status?: string;
  /** Detailed transaction data including individual leave dates. */
  transaction?: LeaveTransaction;
}

// ---------------------------------------------------------------------------
// Holiday-check interfaces
// ---------------------------------------------------------------------------

/**
 * Shape of the `GET /v3/api/leave/years` response (only the fields we use).
 *
 * GreytHR uses a fiscal year model: years run April → March.
 * `currentYear` is the year in which the current fiscal year **started**
 * (e.g. `2026` for the period 2026-04-01 → 2027-03-31).
 */
interface LeaveYearsResponse {
  /**
   * The fiscal year that contains today's date.
   * Used as the path parameter for `GET /v3/api/leave/holidays/{year}`.
   */
  currentYear: number;
}

/**
 * A single entry from the `GET /v3/api/leave/holidays/{year}` response.
 */
interface Holiday {
  /**
   * The calendar date of the holiday in `YYYY-MM-DD` format
   * (e.g. `"2026-04-03"` for Good Friday).
   */
  holidayDate: string;
  /** Human-readable holiday name shown in the portal (e.g. `"Good Friday"`). */
  description: string;
  /**
   * When `false` the portal hides this holiday from employees.
   * Only holidays with `showHoliday: true` are considered.
   */
  showHoliday: boolean;
  /**
   * `false`  → Mandatory public holiday: the office is closed for all employees.
   *             Attendance is skipped automatically.
   * `true`   → Restricted (optional) holiday: employees may choose to take it.
   *             If taken, it appears as an approved leave in the workflow API
   *             and is caught by {@link checkLeave} instead.
   */
  restricted: boolean;
}

/**
 * Shape of the `GET /v3/api/leave/holidays/{year}` response (only the fields
 * we use).
 */
interface HolidaysResponse {
  /** Array of all holidays configured for the fiscal year. */
  holidays: Holiday[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determines whether a given date string represents today, ignoring time
 * components and timezone offsets.
 *
 * **Why compare via `toDateString()` rather than raw strings?**
 * The GreytHR API can return dates in multiple formats:
 * - ISO 8601: `"2026-04-03"` or `"2026-04-03T00:00:00"`
 * - Display format: `"03 Apr 2026"`
 *
 * `new Date(dateInput).toDateString()` normalises both formats to the same
 * locale-neutral representation (`"Fri Apr 03 2026"`) so they can be compared
 * with the same call on `new Date()`. Time and timezone components are
 * discarded because attendance relevance is day-level, not hour-level.
 *
 * @param dateInput - A date string in any format recognised by `new Date()`.
 * @returns `true` if `dateInput` refers to the current calendar day,
 *          `false` for any other date, invalid input, or parsing errors.
 */
function isToday(dateInput: string): boolean {
  try {
    if (!dateInput) return false;

    const today = new Date();
    const checkDate = new Date(dateInput);

    if (Number.isNaN(checkDate.getTime())) {
      logError(`Invalid date format received: ${dateInput}`);
      return false;
    }

    return today.toDateString() === checkDate.toDateString();
  } catch (error: unknown) {
    logError(`Error parsing date: ${dateInput}`, error);
    return false;
  }
}

/**
 * Scans a raw leave-workflow API response array and returns `true` if any
 * active leave item covers today's date.
 *
 * **Filtering rules (items that are skipped):**
 * - `status` is one of `"Withdrawn"`, `"Rejected"`, `"Cancelled"`, `"Revoked"`.
 * - `transaction.cancelled` is `true` (transaction-level cancellation flag).
 *
 * **Date matching strategy:**
 * 1. If `transaction.children` is present and non-empty, each child's
 *    `leaveDate` is individually tested with {@link isToday}. This handles
 *    half-day and non-contiguous multi-day leaves correctly.
 * 2. Otherwise, if `transaction.fromDate` (and `toDate`) is present, only
 *    `fromDate` is tested. This is intentionally conservative: single-day
 *    leaves always have `fromDate === toDate`, and for multi-day leaves the
 *    API normally populates `children` instead.
 *
 * @param leaveItems - The raw value from the API response body. Expected to
 *                     be an array of {@link LeaveItem} objects; returns `false`
 *                     immediately if it is not an array.
 * @returns `true` if at least one active leave covers today, `false` otherwise.
 */
function checkLeaveFromApiData(leaveItems: unknown): boolean {
  if (!Array.isArray(leaveItems)) {
    logStatus("API response data is not an array.");
    return false;
  }

  const typedItems = leaveItems as LeaveItem[];
  logStatus(`Processing ${typedItems.length} leave items...`);

  for (const item of typedItems) {
    const status = item.status ?? "Unknown";

    if (["Withdrawn", "Rejected", "Cancelled", "Revoked"].includes(status)) {
      continue;
    }

    if (item.transaction?.cancelled) {
      continue;
    }

    const datesToCheck: string[] = [];

    if (Array.isArray(item.transaction?.children)) {
      datesToCheck.push(
        ...item.transaction.children.flatMap(
          (child: LeaveTransactionChild): string[] =>
            child.leaveDate ? [child.leaveDate] : [],
        ),
      );
    } else if (item.transaction?.fromDate && item.transaction.toDate) {
      datesToCheck.push(item.transaction.fromDate);
    }

    for (const dateStr of datesToCheck) {
      if (isToday(dateStr)) {
        logStatus(
          `[MATCH CONFIRMED] Found active leave for TODAY (${dateStr}). Status: ${status}`,
        );
        return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

/**
 * Checks whether today is a mandatory public holiday by querying the GreytHR
 * leave API.
 *
 * **Flow:**
 * 1. `GET /v3/api/leave/years` → extracts `currentYear` (the starting year of
 *    the current fiscal year, e.g. `2026` for April 2026 – March 2027).
 * 2. `GET /v3/api/leave/holidays/{currentYear}` → fetches all holidays
 *    configured for that fiscal year.
 * 3. Searches the list for a holiday where:
 *    - `showHoliday` is `true` (holiday is visible/active), **and**
 *    - `restricted` is `false` (mandatory for all employees — not an optional
 *      restricted holiday), **and**
 *    - `holidayDate` matches today via a locale-neutral date comparison.
 *
 * **Restricted vs. non-restricted holidays:**
 * A `restricted: true` holiday (e.g. Maundy Thursday) is optional — employees
 * choose whether to take it, and if they do it shows up as an approved leave in
 * the workflow API. That case is handled by {@link checkLeave}. This function
 * only skips attendance for `restricted: false` mandatory holidays.
 *
 * **Error handling:**
 * Any fetch failure (network error, non-2xx status) is logged and the function
 * returns `{ isHoliday: false }` as a safe default — it is better to mark
 * attendance on a holiday than to silently skip it on a working day due to a
 * transient API error.
 *
 * @param page - The authenticated Playwright `Page`. Both API calls are made
 *               via `page.evaluate(fetch())` to leverage the browser's session
 *               cookies.
 * @returns An object with `isHoliday: true` and the holiday `description`
 *          (e.g. `"Good Friday"`) if today is a public holiday, or
 *          `{ isHoliday: false, description: "" }` otherwise.
 */
async function checkHoliday(page: Page): Promise<{ isHoliday: boolean; description: string }> {
  logStatus("Checking if today is a public holiday...");

  try {
    const yearsData = await page.evaluate(async (): Promise<LeaveYearsResponse> => {
      const res = await fetch("/v3/api/leave/years");
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json() as Promise<LeaveYearsResponse>;
    });

    const currentYear = yearsData.currentYear;
    logStatus(`Current fiscal year: ${currentYear}`);

    const holidaysData = await page.evaluate(
      async (year: number): Promise<HolidaysResponse> => {
        const res = await fetch(`/v3/api/leave/holidays/${year}`);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json() as Promise<HolidaysResponse>;
      },
      currentYear,
    );

    const todayStr = new Date().toDateString();

    const todayHoliday = holidaysData.holidays.find(
      (h) => h.showHoliday && !h.restricted && new Date(h.holidayDate).toDateString() === todayStr,
    );

    if (todayHoliday) {
      logStatus(`Today is a public holiday: ${todayHoliday.description}. Skipping attendance.`);
      return { isHoliday: true, description: todayHoliday.description };
    }

    logStatus("Today is not a public holiday.");
    return { isHoliday: false, description: "" };
  } catch (error: unknown) {
    logError("Error checking holiday status.", error);
    return { isHoliday: false, description: "" };
  }
}

/** API path for the leave workflow list endpoint, used in response interception. */
const LEAVE_API_URL = "/v3/api/workflow/my-process-info-list/leave";

/**
 * Clicks a named tab on the Leave Apply page and intercepts the corresponding
 * `POST /v3/api/workflow/my-process-info-list/leave` API response.
 *
 * This helper is called by {@link checkLeave} for the `"Pending"` tab (fallback
 * path when the auto-load response is not captured) and for the `"History"` tab.
 *
 * **Why intercept instead of calling the API directly?**
 * The POST body sent by the Angular app when a tab is clicked is not
 * documented and was not captured in the HTTP archive. Intercepting the
 * browser-generated request is the only reliable way to get the response
 * without reverse-engineering the payload format.
 *
 * The `waitForResponse` promise is registered **before** the click so that
 * the response is captured even if the network round-trip completes before
 * the `await` on the promise is reached.
 *
 * @param page    - The authenticated Playwright `Page`, currently on the Leave
 *                  Apply page (`/v3/portal/ess/leave/apply`).
 * @param tabName - The `title` attribute of the tab button to click,
 *                  e.g. `"Pending"` or `"History"`.
 * @returns `true` if the intercepted response data contains an active leave
 *          for today, `false` otherwise or on any error.
 */
async function interceptLeaveTab(page: Page, tabName: string): Promise<boolean> {
  logStatus(`Checking ${tabName} tab...`);

  const responsePromise = page
    .waitForResponse(
      (response) =>
        response.url().includes(LEAVE_API_URL) &&
        response.request().method() === "POST" &&
        response.status() === 200,
      { timeout: 10000 },
    )
    .catch(() => null);

  const tabLocator = page.locator(`.leavewf-links button[title="${tabName}"]`);
  await tabLocator.waitFor({ state: "visible" });
  await tabLocator.click();

  try {
    const response = await responsePromise;
    if (!response) {
      logError(`No API response captured for ${tabName} tab.`);
      return false;
    }
    logStatus(`Captured response for ${tabName} tab: ${response.url()}`);
    const data = (await response.json()) as unknown;
    logStatus(`API response for ${tabName}: ${JSON.stringify(data)}`);
    return checkLeaveFromApiData(data);
  } catch (error: unknown) {
    logError(`Failed to intercept/parse data for ${tabName}.`, error);
    return false;
  }
}

/**
 * Determines whether the employee has an active personal leave today by
 * navigating to the Leave Apply page and checking both the `"Pending"` and
 * `"History"` workflow tabs.
 *
 * **Why check both tabs?**
 * - `"Pending"` tab: leave applications awaiting manager approval. An employee
 *   may have submitted a last-minute leave that has not been approved yet;
 *   attendance should still be skipped.
 * - `"History"` tab: previously approved, completed, or processed leaves.
 *   A leave approved earlier in the week would appear here, not in Pending.
 *
 * **Navigation strategy (API-first):**
 * Instead of clicking through the sidebar navigation (Leave menu → Leave Apply
 * link), this function navigates directly to the Angular route URL
 * (`/v3/portal/ess/leave/apply`). This eliminates several fragile DOM
 * interactions and is faster and more reliable.
 *
 * **Pending tab — auto-load optimisation:**
 * A `waitForResponse` promise is registered *before* `page.goto()`. When the
 * Leave Apply page loads, the Angular component typically auto-fires the POST
 * for the default (Pending) tab. If this auto-triggered response is captured,
 * the tab does not need to be clicked explicitly — saving one round-trip.
 * If no response is captured within 15 seconds (e.g. if the default tab
 * differs in a future portal update), the function falls back to clicking the
 * Pending tab via {@link interceptLeaveTab}.
 *
 * **Error handling:**
 * Any exception (navigation failure, selector not found, API error) is caught
 * and logged. The function returns `false` as a safe default so that
 * attendance is marked on a day where the leave status cannot be confirmed —
 * it is better to over-mark than to permanently miss a check-in.
 *
 * @param page - The authenticated Playwright `Page`. The page URL is used to
 *               derive the portal origin for the navigation target.
 * @returns `true` if an active leave covers today (across Pending or History
 *          tabs), `false` if no leave is found or an error occurs.
 */
async function checkLeave(page: Page): Promise<boolean> {
  logStatus("Checking leave status via API...");

  try {
    // Derive the leave apply URL from the current page's origin — avoids importing config.
    const origin = new URL(page.url()).origin;
    const leaveApplyUrl = `${origin}/v3/portal/ess/leave/apply`;

    // Set up interception before navigation so we capture the auto-triggered
    // Pending tab request that fires when the leave apply page loads.
    const pendingResponsePromise = page
      .waitForResponse(
        (response) =>
          response.url().includes(LEAVE_API_URL) &&
          response.request().method() === "POST" &&
          response.status() === 200,
        { timeout: 15000 },
      )
      .catch(() => null);

    await page.goto(leaveApplyUrl);
    await page.waitForLoadState("networkidle");
    logStatus("Navigated to Leave Apply page.");

    const pendingResponse = await pendingResponsePromise;

    if (pendingResponse) {
      logStatus(`Captured auto-triggered Pending response: ${pendingResponse.url()}`);
      const data = (await pendingResponse.json()) as unknown;
      logStatus(`API response for Pending: ${JSON.stringify(data)}`);
      if (checkLeaveFromApiData(data)) return true;
    } else {
      // Auto-load didn't fire — manually click the Pending tab.
      logStatus("Auto-load not detected for Pending tab, clicking explicitly...");
      if (await interceptLeaveTab(page, "Pending")) return true;
    }

    if (await interceptLeaveTab(page, "History")) return true;

    logStatus("No active leave found for today after API check.");
    return false;
  } catch (error: unknown) {
    logError("Error checking leave status", error);
    return false;
  }
}

export { checkHoliday, checkLeave };
