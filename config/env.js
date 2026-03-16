require("@dotenvx/dotenvx").config();

const {
  GREYTHR_URL,
  GREYTHR_USERNAME,
  GREYTHR_PASSWORD,
  LOGIN_TIME,
  LOGOUT_TIME,
  SMTP_HOST,
  SMTP_USER,
  SMTP_PORT,
  SMTP_PASS,
  SMTP_FROM,
  SMTP_TO,
} = process.env;

if (
  !GREYTHR_URL ||
  !GREYTHR_USERNAME ||
  !GREYTHR_PASSWORD ||
  !LOGIN_TIME ||
  !LOGOUT_TIME
) {
  console.error(
    "Error: Missing required environment variables. Please check your .env file.",
  );
  process.exit(1);
}

if (
  !SMTP_HOST ||
  !SMTP_USER ||
  !SMTP_PORT ||
  !SMTP_PASS ||
  !SMTP_FROM ||
  !SMTP_TO
) {
  console.error(
    "Error: Missing required SMTP environment variables. Email will not be sent. Please check your .env file.",
  );
}

module.exports = {
  GREYTHR_URL,
  GREYTHR_USERNAME,
  GREYTHR_PASSWORD,
  LOGIN_TIME,
  LOGOUT_TIME,
  HEADLESS: process.env.HEADLESS === "true",
  SMTP_HOST,
  SMTP_USER,
  SMTP_PORT,
  SMTP_PASS,
  SMTP_FROM,
  SMTP_TO,
};
