import { Page } from "playwright";
import { logStatus, logError } from "./logService";

interface LeaveTransactionChild {
  leaveDate?: string;
}

interface LeaveTransaction {
  cancelled?: boolean;
  children?: LeaveTransactionChild[];
  fromDate?: string;
  toDate?: string;
}

interface LeaveItem {
  status?: string;
  transaction?: LeaveTransaction;
}

/**
 * Robust date checker that handles both ISO (YYYY-MM-DD) and Display (DD MMM YYYY) formats
 * and ignores time components/timezones for the comparison.
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
 * Extracts active leave dates from the API JSON response.
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

interface LeaveYearsResponse {
  currentYear: number;
}

interface Holiday {
  holidayDate: string;
  description: string;
  showHoliday: boolean;
  restricted: boolean;
}

interface HolidaysResponse {
  holidays: Holiday[];
}

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

const LEAVE_API_URL = "/v3/api/workflow/my-process-info-list/leave";

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
