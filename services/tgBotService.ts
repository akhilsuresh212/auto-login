import { Bot, InlineKeyboard } from "grammy";
import appConfig from "../config/env";
import { logStatus } from "./logService";

// ---------------------------------------------------------------------------
// Skip flag
// ---------------------------------------------------------------------------

/**
 * Stores the ISO date string (YYYY-MM-DD) for which all scheduled flows
 * should be skipped. `null` means no skip is active.
 *
 * The check is always against today's date, so the flag resets automatically
 * on the next calendar day without any explicit cleanup.
 */
let skipDate: string | null = null;

/**
 * Returns `true` if all attendance flows should be skipped for today.
 *
 * Called by `runLoginFlow` and `runLogoutFlow` in `index.ts` before launching
 * a browser. If a Telegram user sent "skip" (or pressed the Skip button) today,
 * this returns `true` and the flow exits early without opening Chromium.
 */
export function isSkippedToday(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return skipDate === today;
}

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

/**
 * The main inline keyboard shown alongside every bot reply.
 *
 * Buttons map 1-to-1 with callback data strings handled in
 * {@link registerCallbacks}.
 */
function buildKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⏭️ Skip Today", "skip")
    .text("↩️ Cancel Skip", "unskip")
    .row()
    .text("▶️ Login Now", "login")
    .text("⏹️ Logout Now", "logout");
}

/** Plain-text help shown when an unrecognised message arrives. */
const HELP_TEXT =
  "🤖 <b>Available commands:</b>\n\n" +
  "• <b>skip</b> — Skip today's login and logout flows\n" +
  "• <b>unskip</b> — Cancel today's skip (re-enable flows)\n" +
  "• <b>login</b> — Trigger check-in now\n" +
  "• <b>logout</b> — Trigger check-out now\n\n" +
  "Or use the buttons below:";

// ---------------------------------------------------------------------------
// Bot factory
// ---------------------------------------------------------------------------

/**
 * Creates and configures the Grammy Telegram bot with text commands and
 * inline keyboard button handlers.
 *
 * **Text commands (case-insensitive, spaces stripped):**
 *
 * | Message   | Action |
 * |-----------|--------|
 * | `skip`    | Sets the skip flag for today; both flows will be skipped at their scheduled times. |
 * | `unskip`  | Clears the skip flag so flows run normally for the rest of the day. |
 * | `login`   | Immediately triggers `runLoginFlow`. |
 * | `logout`  | Immediately triggers `runLogoutFlow`. |
 *
 * Each text command also has a matching **inline keyboard button** so the user
 * can tap rather than type.
 *
 * The bot is **not started here** — call the returned instance's `.start()`
 * in `index.ts`. Do NOT `await` that call; `bot.start()` is a blocking
 * long-poll loop and must run concurrently alongside the cron scheduler.
 *
 * @param onLogin  - Reference to `runLoginFlow` from `index.ts`.
 * @param onLogout - Reference to `runLogoutFlow` from `index.ts`.
 * @returns A configured (but not yet started) Grammy `Bot` instance.
 */
export function initBot(
  onLogin: () => Promise<void>,
  onLogout: () => Promise<void>,
): Bot {
  const bot = new Bot(appConfig.TELEGRAM.botToken || "");

  // -------------------------------------------------------------------------
  // Action handlers (shared between text commands and callback buttons)
  // -------------------------------------------------------------------------

  async function handleSkip(reply: (text: string) => Promise<unknown>): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    skipDate = today;
    logStatus(`Skip flag set for ${today}. Login and logout flows will be skipped today.`);
    await reply(
      `⏭️ <b>Skip set for today (${today}).</b>\n` +
        "Both the login and logout flows will be skipped at their scheduled times.\n\n" +
        "Send <b>unskip</b> or press ↩️ Cancel Skip to re-enable them.",
    );
  }

  async function handleUnskip(reply: (text: string) => Promise<unknown>): Promise<void> {
    if (skipDate === null) {
      await reply("ℹ️ No skip is currently active — flows are already enabled.");
      return;
    }
    const cleared = skipDate;
    skipDate = null;
    logStatus(`Skip flag cleared (was set for ${cleared}). Flows re-enabled.`);
    await reply(
      `↩️ <b>Skip cancelled.</b>\n` +
        `The skip set for ${cleared} has been removed.\n` +
        "Login and logout flows will run at their scheduled times.",
    );
  }

  async function handleLogin(reply: (text: string) => Promise<unknown>): Promise<void> {
    logStatus("Manual login triggered via Telegram.");
    await reply("▶️ Triggering login flow now...");
    onLogin().catch((err) => {
      logStatus(`Manual login via Telegram failed: ${err}`);
      console.error("Manual login via Telegram failed:", err);
    });
  }

  async function handleLogout(reply: (text: string) => Promise<unknown>): Promise<void> {
    logStatus("Manual logout triggered via Telegram.");
    await reply("⏹️ Triggering logout flow now...");
    onLogout().catch((err) => {
      logStatus(`Manual logout via Telegram failed: ${err}`);
      console.error("Manual logout via Telegram failed:", err);
    });
  }

  // -------------------------------------------------------------------------
  // Text message handler
  // -------------------------------------------------------------------------

  bot.on("message:text", async (ctx) => {
    const message = ctx.message.text.trim().toLowerCase();
    logStatus(`Telegram text command received: "${message}"`);
    console.log(`Telegram text command received: "${message}"`);

    const keyboard = buildKeyboard();

    const reply = (text: string) =>
      ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });

    if (message === "skip") {
      await handleSkip(reply);
    } else if (message === "unskip") {
      await handleUnskip(reply);
    } else if (message === "login") {
      await handleLogin(reply);
    } else if (message === "logout") {
      await handleLogout(reply);
    } else {
      await reply(HELP_TEXT);
    }
  });

  // -------------------------------------------------------------------------
  // Inline keyboard callback handlers
  // -------------------------------------------------------------------------

  /**
   * Registers handlers for each inline button's callback data.
   * `ctx.answerCallbackQuery()` must be called to dismiss the loading spinner
   * on the Telegram client side.
   */
  function registerCallbacks(): void {
    bot.callbackQuery("skip", async (ctx) => {
      await ctx.answerCallbackQuery();
      logStatus("Telegram inline button pressed: skip");
      await handleSkip((text) =>
        ctx.editMessageText(text, {
          parse_mode: "HTML",
          reply_markup: buildKeyboard(),
        }),
      );
    });

    bot.callbackQuery("unskip", async (ctx) => {
      await ctx.answerCallbackQuery();
      logStatus("Telegram inline button pressed: unskip");
      await handleUnskip((text) =>
        ctx.editMessageText(text, {
          parse_mode: "HTML",
          reply_markup: buildKeyboard(),
        }),
      );
    });

    bot.callbackQuery("login", async (ctx) => {
      await ctx.answerCallbackQuery();
      logStatus("Telegram inline button pressed: login");
      await handleLogin((text) =>
        ctx.editMessageText(text, {
          parse_mode: "HTML",
          reply_markup: buildKeyboard(),
        }),
      );
    });

    bot.callbackQuery("logout", async (ctx) => {
      await ctx.answerCallbackQuery();
      logStatus("Telegram inline button pressed: logout");
      await handleLogout((text) =>
        ctx.editMessageText(text, {
          parse_mode: "HTML",
          reply_markup: buildKeyboard(),
        }),
      );
    });
  }

  registerCallbacks();

  return bot;
}
