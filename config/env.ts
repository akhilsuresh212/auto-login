import { config } from "@dotenvx/dotenvx";

config({ ignore: ["MISSING_ENV_FILE"] });

interface AppConfig {
  GREYTHR_URL: string;
  GREYTHR_USERNAME: string;
  GREYTHR_PASSWORD: string;
  LOGIN_TIME: string;
  LOGOUT_TIME: string;
  HEADLESS: boolean;
  SMTP_HOST: string | undefined;
  SMTP_USER: string | undefined;
  SMTP_PORT: number | undefined;
  SMTP_PASS: string | undefined;
  SMTP_FROM: string | undefined;
  SMTP_TO: string | undefined;
  TELEGRAM: {
    botToken: string | undefined;
    chatId: string | undefined;
  }
}

function requireEnv(name: keyof NodeJS.ProcessEnv): string {
  const value = process.env[name];

  if (!value) {
    console.error(
      `Error: Missing required environment variable ${name}. Please check your .env file.`,
    );
    process.exit(1);
  }

  return value;
}

const smtpPortValue = process.env.SMTP_PORT?.trim();
const smtpPort =
  smtpPortValue ? Number.parseInt(smtpPortValue, 10) : undefined;

if (smtpPortValue && Number.isNaN(smtpPort)) {
  console.error("Error: SMTP_PORT must be a valid number.");
  process.exit(1);
}

if (
  !process.env.SMTP_HOST ||
  !process.env.SMTP_USER ||
  !process.env.SMTP_PORT ||
  !process.env.SMTP_PASS ||
  !process.env.SMTP_FROM ||
  !process.env.SMTP_TO
) {
  console.error(
    "Error: Missing required SMTP environment variables. Email will not be sent. Please check your .env file.",
  );
}

const appConfig: AppConfig = {
  GREYTHR_URL: requireEnv("GREYTHR_URL"),
  GREYTHR_USERNAME: requireEnv("GREYTHR_USERNAME"),
  GREYTHR_PASSWORD: requireEnv("GREYTHR_PASSWORD"),
  LOGIN_TIME: requireEnv("LOGIN_TIME"),
  LOGOUT_TIME: requireEnv("LOGOUT_TIME"),
  HEADLESS: process.env.HEADLESS === "true",
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PORT: smtpPort,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  SMTP_TO: process.env.SMTP_TO,
  TELEGRAM: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    chatId: requireEnv("TELEGRAM_BOT_MESSAGE_ID"),
  }
};

export default appConfig;
