const TELEGRAM_API = "https://api.telegram.org";

import appConfig from '../config/env'

/**
 * Sends a raw HTML-formatted message to the configured Telegram chat via the
 * Bot API.
 *
 * **Parse mode:** `HTML` — callers may use tags like `<b>`, `<i>`, and
 * `<code>` in the `message` string. Unsupported tags are silently stripped by
 * Telegram.
 *
 * **Endpoint:** `POST https://api.telegram.org/bot{token}/sendMessage`
 *
 * The function performs a lightweight guard before making the HTTP request: if
 * either `botToken` or `chatId` is missing from `appConfig.TELEGRAM`, it logs
 * a warning to stdout and returns without throwing. This allows the application
 * to run in environments where Telegram is intentionally not configured (e.g.
 * local development with SMTP-only alerts).
 *
 * @param message - The HTML-formatted text to deliver. Keep messages concise;
 *                  Telegram enforces a 4096-character limit per message.
 * @throws {Error} If the Telegram API returns a non-2xx HTTP status. The error
 *                 message includes the raw response body for diagnostics.
 *                 Callers ({@link sendSuccessMessage}, {@link sendFailureMessage})
 *                 catch this and log it without rethrowing.
 */
export async function sendTelegramMessage(
    message: string
): Promise<void> {

    const { botToken, chatId } = appConfig.TELEGRAM;

    if (!botToken || !chatId) {
        console.error("Telegram bot token or chat ID is not configured. | Skipping Telegram notification");
        return;
    }

    const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: "HTML",
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Telegram API error: ${error}`);
    }
}

/**
 * Sends a formatted success notification to the configured Telegram chat.
 *
 * The message includes:
 * - A ✅ emoji and the action name as a bold heading.
 * - The current timestamp in the `Asia/Kolkata` timezone (IST), so the
 *   operator sees local time regardless of where the server runs.
 * - An optional details line, formatted in bold if provided.
 *
 * Example rendered output:
 * ```
 * ✅ Login Flow Success
 *
 * 🕒 Time: 03/04/2026, 9:02:15 am
 * 📝 Details: Attendance check-in completed successfully.
 * ```
 *
 * Errors from the underlying {@link sendTelegramMessage} call are caught and
 * logged to `console.error` without rethrowing, so a Telegram outage does not
 * crash the overall attendance flow.
 *
 * @param action  - A short label for the completed action, used as the message
 *                  heading (e.g. `"Login Flow Success"`, `"Login Flow (Skipped)"`).
 * @param details - Optional additional context appended below the timestamp line
 *                  (e.g. `"Attendance check-in completed successfully."`).
 *                  Omit or pass an empty string to send the heading and time only.
 */
export async function sendSuccessMessage(action: string, details: string = ""): Promise<void> {
    const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const message = `✅ <b>${action}</b>\n\n🕒 <b>Time:</b> ${timestamp}\n${details ? `📝 <b>Details:</b> ${details}` : ""}`;

    try {
        await sendTelegramMessage(message);
    } catch (e) {
        console.error("Telegram success notification failed:", e);
    }
}

/**
 * Sends a formatted failure notification to the configured Telegram chat.
 *
 * The message includes:
 * - A ❌ emoji and the action name as a bold heading.
 * - The current timestamp in `Asia/Kolkata` timezone.
 * - The error message wrapped in a `<code>` block for monospace rendering,
 *   making stack traces and HTTP status strings easier to read on mobile.
 *
 * Example rendered output:
 * ```
 * ❌ Login Flow Failed
 *
 * 🕒 Time: 03/04/2026, 9:02:15 am
 * ⚠️ Error: HTTP 503
 * ```
 *
 * Errors from the underlying {@link sendTelegramMessage} call are caught and
 * logged to `console.error` without rethrowing.
 *
 * @param action - A short label for the failed action (e.g. `"Login Flow Failed"`,
 *                 `"Signout API Failed for GreytHR Attendance"`).
 * @param error  - A plain-text error description to include in the notification.
 *                 Pass `error.message` for `Error` instances, or the raw string
 *                 for other error types.
 */
export async function sendFailureMessage(action: string, error: string): Promise<void> {
    const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const message = `❌ <b>${action}</b>\n\n🕒 <b>Time:</b> ${timestamp}\n⚠️ <b>Error:</b> <code>${error}</code>`;

    try {
        await sendTelegramMessage(message);
    } catch (e) {
        console.error("Telegram failure notification failed:", e);
    }
}
