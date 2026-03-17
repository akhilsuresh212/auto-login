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

    const todayStr = today.toDateString();
    const checkStr = checkDate.toDateString();

    return todayStr === checkStr;
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

async function checkLeave(page: Page): Promise<boolean> {
  logStatus("Checking leave status via API...");

  try {
    await page
      .waitForSelector("#mainSidebar", { state: "visible", timeout: 5000 })
      .catch(() => undefined);

    const sidebar = page.locator("#mainSidebar");
    const leaveApplyBtn = sidebar
      .locator("a.secondary-link")
      .filter({ hasText: "Leave Apply" })
      .first();

    if (!(await leaveApplyBtn.isVisible())) {
      logStatus("Expanding Leave menu...");
      await sidebar
        .locator("span.primary-title")
        .filter({ hasText: /^Leave$/ })
        .first()
        .click();
    }

    await leaveApplyBtn.waitFor({ state: "visible" });
    await leaveApplyBtn.click();
    await page.waitForLoadState("networkidle");
    logStatus("Navigated to Leave Apply page.");

    const checkTab = async (tabName: string): Promise<boolean> => {
      logStatus(`Checking ${tabName} tab...`);

      const responsePromise = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes("/v3/api/workflow/my-process-info-list/leave") &&
          response.request().method() === "POST" &&
          response.status() === 200,
      );

      const tabLocator = page.locator(`.leavewf-links button[title="${tabName}"]`);
      await tabLocator.waitFor({ state: "visible" });

      const isAlreadyActive = await tabLocator.evaluate(
        (element: Element): boolean =>
          element.classList.contains("btn-primary") ||
          element.classList.contains("active"),
      );

      if (isAlreadyActive) {
        logStatus(`Tab ${tabName} already active. Reloading list...`);
      }

      await tabLocator.click();

      try {
        logStatus(`Waiting for API response for ${tabName}...`);
        const response = await responsePromise;
        logStatus(`Captured URL: ${response.url()}`);

        const data = (await response.json()) as unknown;

        logStatus(`API response for ${tabName}: ${JSON.stringify(data)}`);

        return checkLeaveFromApiData(data);
      } catch (error: unknown) {
        logError(`Failed to intercept/parse data for ${tabName}.`, error);
        return false;
      }
    };

    if (await checkTab("Pending")) return true;
    if (await checkTab("History")) return true;

    logStatus("No active leave found for today after API check.");
    return false;
  } catch (error: unknown) {
    logError("Error checking leave status", error);
    return false;
  }
}

export { checkLeave };
