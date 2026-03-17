// send a mail using nodemailer when login/logout is failed

import nodemailer from "nodemailer";
import config from "../config/env";
import { logError, stringifyUnknown } from "./logService";

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
