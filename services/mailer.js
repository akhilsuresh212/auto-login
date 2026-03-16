// send a mail using nodemailer when login/logout is failed

const nodemailer = require("nodemailer");
const config = require("../config/env");
const { logError } = require("./logService");

async function sendFailureEmail(subject, message, screenshotPath) {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
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
  } catch (error) {
    console.error("Error sending failure email:", error);
    logError("Error sending failure email.", error);
  }
}

module.exports = {
  sendFailureEmail,
};
