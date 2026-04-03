import nodemailer from "nodemailer";
import config from "../config/env";
import { logError, stringifyUnknown } from "./logService";

/**
 * Sends a failure notification email with an optional screenshot attachment
 * via Nodemailer over SMTP.
 *
 * This function is the **secondary** notification channel — it is called
 * alongside {@link sendFailureMessage} (Telegram) when an attendance API
 * action fails. The screenshot attachment provides visual context that is not
 * possible to convey over Telegram.
 *
 * **Pre-condition guard:**
 * If any of the six required SMTP config values (`SMTP_HOST`, `SMTP_PORT`,
 * `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_TO`) is absent, the function
 * logs the skip reason and returns immediately without throwing. This allows
 * deployments that rely solely on Telegram notifications to omit SMTP
 * configuration without breaking the flow.
 *
 * **Transport configuration:**
 * - `secure: false` — uses STARTTLS upgrade on port 587 (or whichever port is
 *   configured). Change to `true` and use port 465 for implicit TLS if your
 *   SMTP provider requires it.
 * - The transporter is created fresh on each call to avoid holding a persistent
 *   SMTP connection that could time out between the infrequent failure events.
 *
 * **Email structure:**
 * - From:    `Auto Login <{SMTP_FROM}>`
 * - To:      `{SMTP_TO}`
 * - Subject: `subject` parameter (falls back to `"Login/Logout failed"` if empty).
 * - Body:    Plain-text `message`.
 * - Attachment: The file at `screenshotPath` sent as `screenshot.png`.
 *
 * Errors from `transporter.sendMail()` are caught, logged to both `console.error`
 * and `login-error.log`, but **not rethrown** — a mailer failure must not
 * prevent the `finally` cleanup block in `index.ts` from running.
 *
 * @param subject        - Email subject line. Defaults to `"Login/Logout failed"`
 *                         if falsy.
 * @param message        - Plain-text email body describing the failure and including
 *                         any relevant error details.
 * @param screenshotPath - Absolute or relative file-system path to the Playwright
 *                         screenshot PNG captured just before the failure.
 *                         Passed directly to Nodemailer as an attachment path.
 */
async function sendFailureEmail(
  subject: string,
  message: string,
  screenshotPath: string,
): Promise<void> {
  if (
    !config.SMTP_HOST ||
    !config.SMTP_PORT ||
    !config.SMTP_USER ||
    !config.SMTP_PASS ||
    !config.SMTP_FROM ||
    !config.SMTP_TO
  ) {
    logError("Skipping failure email because SMTP configuration is incomplete.");
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: false, // true for 465, false for other ports
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: `Auto Login <${config.SMTP_FROM}>`,
      to: config.SMTP_TO,
      subject: subject || "Login/Logout failed",
      text: message,
      attachments: [
        {
          filename: "screenshot.png",
          path: screenshotPath,
        },
      ],
    };

    await transporter.sendMail(mailOptions);
    console.log("Failure email sent successfully.");
  } catch (error: unknown) {
    console.error("Error sending failure email:", error);
    logError(
      `Error sending failure email. ${stringifyUnknown(error)}`,
      error,
    );
  }
}

export { sendFailureEmail };
