import { Page } from "playwright";
import { logStatus, logError } from "./logService";
import { sendSummaryMessage } from "./notifier";

// ---------------------------------------------------------------------------
// API endpoints
//
// Step 1 (optional): GET /v3/api/dashboard/dashlet/wfreview
//   Returns action counts per process type, e.g.:
//   { data: [{ name: "leave", count: 1 }, { name: "attendanceRegularization", count: 1 }] }
//   Not used here — we fetch details directly.
//
// Step 2: POST /v3/api/workflow/my-process-info-list/attendanceRegularization
//   Body: { "state": 1, "pageNo": 1, "mode": 0 }
//   Returns pending regularization tasks assigned to the logged-in manager.
//
// Step 3: POST /v3/api/workflow/my-process-info-list/leave
//   Body: { "state": 1, "pageNo": 1, "mode": 0 }
//   Returns pending leave approval tasks assigned to the logged-in manager.
// ---------------------------------------------------------------------------

const WORKFLOW_BASE = "/v3/api/workflow/my-process-info-list";
const LEAVE_ACTIONS_URL = `${WORKFLOW_BASE}/leave`;
const REGULARIZATION_ACTIONS_URL = `${WORKFLOW_BASE}/attendanceRegularization`;

// ---------------------------------------------------------------------------
// Leave action interfaces
// ---------------------------------------------------------------------------

/**
 * The leave category type embedded in a leave transaction.
 * Identifies the kind of leave (Sick, Casual, Earned, etc.).
 */
interface LeaveCategoryType {
  /** Human-readable name, e.g. `"Sick Leave"`. */
  description: string;
  /** Short code, e.g. `"SL"`, `"CL"`, `"EL"`. */
  code: string;
}

/**
 * Transaction detail for a single leave application item.
 *
 * Dates (`fromDate`, `toDate`) arrive as portal display strings like
 * `"11 May 2026"`, not ISO 8601.
 * Sessions: `1.0` = morning (Session 1), `2.0` = afternoon (Session 2).
 * `days` is negative (a deduction), e.g. `-1.0` for one full day.
 */
interface LeaveActionTransaction {
  fromDate: string;
  toDate: string;
  /** Morning session = 1, Afternoon session = 2 (arrives as float from API). */
  fromSession: number;
  /** Morning session = 1, Afternoon session = 2 (arrives as float from API). */
  toSession: number;
  /** Negative day count, e.g. `-1.0` for a full day, `-0.5` for a half day. */
  days: number;
  leaveCategoryType: LeaveCategoryType;
}

/**
 * Process variables block for a leave workflow item.
 * Contains the employee, the leave transaction, and available workflow actions.
 */
interface LeaveActionVariables {
  employee: {
    name: string;
    employeeNo: string;
  };
  transaction: LeaveActionTransaction;
  /** Workflow actions the manager can take, e.g. Forward / Accept / Reject. */
  actions: Array<{ id: number; name: string }>;
}

/**
 * A single pending leave approval item returned by
 * `GET /v3/api/workflow/my-process-info-list/leave`.
 */
interface LeaveActionItem {
  processInstanceId: string;
  status: string;
  subjectEmployee: {
    id: number;
    name: string;
    employeeNo: string;
  };
  processVariables: LeaveActionVariables;
}

// ---------------------------------------------------------------------------
// Regularization action interfaces
// ---------------------------------------------------------------------------

/**
 * Process variables block for an attendance regularization workflow item.
 *
 * Unlike the leave workflow, regularization does not have a `transaction`
 * object. The applied dates are stored directly as an array of ISO 8601
 * date strings in `appliedDates`.
 */
interface RegularizationActionVariables {
  employee: {
    name: string;
    employeeNo: string;
  };
  /**
   * ISO 8601 dates being regularized, e.g. `["2026-05-06"]`.
   * Multiple entries appear when the employee applies for several days at once.
   */
  appliedDates: string[];
  days: number;
  actions: Array<{ id: number; name: string }>;
}

/**
 * A single pending regularization item returned by
 * `GET /v3/api/workflow/my-process-info-list/attendanceRegularization`.
 */
interface RegularizationActionItem {
  processInstanceId: string;
  status: string;
  subjectEmployee: {
    id: number;
    name: string;
    employeeNo: string;
  };
  processVariables: RegularizationActionVariables;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Maps a numeric session value to its display label.
 * GreytHR encodes morning as `1` and afternoon as `2`.
 *
 * Sessions arrive as floats (`1.0`, `2.0`); `Math.round` is used on the
 * caller side to guard against floating-point drift before passing here.
 */
function sessionLabel(session: number): string {
  return session === 1 ? "Session 1" : "Session 2";
}

/**
 * Converts an ISO 8601 date string (`"2026-05-06"`) to the portal's display
 * format (`"06 May 2026"`), matching the style of `fromDate`/`toDate` in leave
 * transactions.
 *
 * Falls back to the raw input string if `Date` cannot parse it.
 */
function formatIsoDate(isoDate: string): string {
  try {
    const d = new Date(isoDate + "T00:00:00"); // Avoid timezone shift on date-only strings
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
}

/**
 * Formats a single pending leave item into the standardized display string.
 *
 * **Format rules:**
 * - **Full day** (single day, Session 1 → Session 2):
 *   `Name - Type - Date (Full Day)`
 * - **Half day** (single day, same session start and end):
 *   `Name - Type - Date (Session N)`
 * - **Multi-day** (different `fromDate` and `toDate`):
 *   `Name - Type - FromDate (Session X) - ToDate (Session Y) (N Days)`
 *
 * @param item - A single {@link LeaveActionItem} from the workflow API.
 */
function formatLeaveItem(item: LeaveActionItem): string {
  const name =
    item.processVariables.employee?.name ?? item.subjectEmployee.name;
  const leaveType =
    item.processVariables.transaction?.leaveCategoryType?.description ?? "Leave";

  const { fromDate, toDate, fromSession, toSession, days } =
    item.processVariables.transaction;

  const from = Math.round(fromSession);
  const to = Math.round(toSession);
  const isSingleDay = fromDate === toDate;
  const isFullDay = isSingleDay && from === 1 && to === 2;

  if (isFullDay) {
    return `${name} - ${leaveType} - ${fromDate} (Full Day)`;
  }

  if (isSingleDay) {
    return `${name} - ${leaveType} - ${fromDate} (${sessionLabel(from)})`;
  }

  // Multi-day — include both dates, sessions, and total duration.
  const totalDays = Math.round(Math.abs(days ?? 1));
  const dayLabel = totalDays === 1 ? "1 Day" : `${totalDays} Days`;
  return `${name} - ${leaveType} - ${fromDate} (${sessionLabel(from)}) - ${toDate} (${sessionLabel(to)}) (${dayLabel})`;
}

/**
 * Formats a single pending regularization item into a display string.
 *
 * Format: `Name - Date` for a single date, or `Name - Date, Date` for multiple
 * dates. Dates are converted from ISO 8601 to the portal display format via
 * {@link formatIsoDate}.
 *
 * @param item - A single {@link RegularizationActionItem} from the workflow API.
 */
function formatRegularizationItem(item: RegularizationActionItem): string {
  const name =
    item.processVariables.employee?.name ?? item.subjectEmployee.name;

  const appliedDates = item.processVariables.appliedDates ?? [];
  const dateStr =
    appliedDates.length > 0
      ? appliedDates.map(formatIsoDate).join(", ")
      : "Unknown Date";

  return `${name} - ${dateStr}`;
}

// ---------------------------------------------------------------------------
// API fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetches all pending leave approval tasks assigned to the logged-in manager.
 *
 * Uses `page.evaluate(fetch())` with a POST request to leverage the browser's
 * authenticated session cookies. GreytHR workflow list endpoints require POST
 * (the Angular app never GETs these — GET returns 404).
 *
 * **Endpoint:** `POST /v3/api/workflow/my-process-info-list/leave`
 *
 * @param page - The authenticated Playwright `Page`.
 * @returns An array of {@link LeaveActionItem} objects, or `[]` on any error.
 */
async function fetchPendingLeaveActions(page: Page): Promise<LeaveActionItem[]> {
  logStatus("Fetching pending leave approval actions...");

  try {
    const data = await page.evaluate(async (url: string): Promise<unknown> => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: 1, pageNo: 1, mode: 0 }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }, LEAVE_ACTIONS_URL);

    if (!Array.isArray(data)) {
      logStatus("Leave actions API returned a non-array response. Treating as empty.");
      return [];
    }

    logStatus(`Fetched ${data.length} pending leave action(s).`);
    return data as LeaveActionItem[];
  } catch (error: unknown) {
    logError("Failed to fetch pending leave actions.", error);
    return [];
  }
}

/**
 * Fetches all pending attendance regularization tasks assigned to the
 * logged-in manager.
 *
 * **Endpoint:** `POST /v3/api/workflow/my-process-info-list/attendanceRegularization`
 *
 * @param page - The authenticated Playwright `Page`.
 * @returns An array of {@link RegularizationActionItem} objects, or `[]` on error.
 */
async function fetchPendingRegularizationActions(
  page: Page,
): Promise<RegularizationActionItem[]> {
  logStatus("Fetching pending regularization actions...");

  try {
    const data = await page.evaluate(async (url: string): Promise<unknown> => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: 1, pageNo: 1, mode: 0 }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }, REGULARIZATION_ACTIONS_URL);

    if (!Array.isArray(data)) {
      logStatus("Regularization actions API returned a non-array response. Treating as empty.");
      return [];
    }

    logStatus(`Fetched ${data.length} pending regularization action(s).`);
    return data as RegularizationActionItem[];
  } catch (error: unknown) {
    logError("Failed to fetch pending regularization actions.", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

/**
 * Returns a numbered plain-text list of pending leave items for use as an
 * ntfy notification body.
 */
function buildLeaveBody(items: LeaveActionItem[]): string {
  return items.map((item, idx) => `${idx + 1}. ${formatLeaveItem(item)}`).join("\n");
}

/**
 * Returns a numbered plain-text list of pending regularization items for use
 * as an ntfy notification body.
 */
function buildRegularizationBody(items: RegularizationActionItem[]): string {
  return items.map((item, idx) => `${idx + 1}. ${formatRegularizationItem(item)}`).join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches all pending leave and regularization approval tasks, then sends a
 * push notification per category via ntfy (only when items are present) and
 * logs the results.
 *
 * Both API calls are issued in parallel to minimise latency. A failure in
 * either fetch returns an empty list (already logged) so the other summary
 * is still delivered.
 *
 * Called by `runLoginFlow` in `index.ts` immediately after a successful portal
 * login and dashboard load, before the attendance check-in step.
 *
 * @param page - The authenticated Playwright `Page`. Can be on any portal URL;
 *               the fetch calls run inside the browser context via
 *               `page.evaluate` and rely on session cookies, not the current URL.
 */
export async function sendActionsSummary(page: Page): Promise<void> {
  logStatus("Building daily actions summary...");

  try {
    const [leaveItems, regularizationItems] = await Promise.all([
      fetchPendingLeaveActions(page),
      fetchPendingRegularizationActions(page),
    ]);

    if (leaveItems.length > 0) {
      const body = buildLeaveBody(leaveItems);
      logStatus(`Pending leave approvals (${leaveItems.length}):\n${body}`);
      await sendSummaryMessage(`📋 Pending Leave Approvals (${leaveItems.length})`, body);
    } else {
      logStatus("No pending leave approvals.");
    }

    if (regularizationItems.length > 0) {
      const body = buildRegularizationBody(regularizationItems);
      logStatus(`Pending regularizations (${regularizationItems.length}):\n${body}`);
      await sendSummaryMessage(`🕐 Pending Regularizations (${regularizationItems.length})`, body);
    } else {
      logStatus("No pending regularizations.");
    }
  } catch (error: unknown) {
    logError("Failed to build actions summary.", error);
  }
}
