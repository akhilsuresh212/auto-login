const TELEGRAM_API = "https://api.telegram.org";

import appConfig from '../config/env'

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

export async function sendSuccessMessage(action: string, details: string = ""): Promise<void> {
    const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const message = `✅ <b>${action}</b>\n\n🕒 <b>Time:</b> ${timestamp}\n${details ? `📝 <b>Details:</b> ${details}` : ""}`;

    try {
        await sendTelegramMessage(message);
    } catch (e) {
        console.error("Telegram success notification failed:", e);
    }
}

export async function sendFailureMessage(action: string, error: string): Promise<void> {
    const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const message = `❌ <b>${action}</b>\n\n🕒 <b>Time:</b> ${timestamp}\n⚠️ <b>Error:</b> <code>${error}</code>`;

    try {
        await sendTelegramMessage(message);
    } catch (e) {
        console.error("Telegram failure notification failed:", e);
    }
}