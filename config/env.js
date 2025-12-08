require('@dotenvx/dotenvx').config();

const {
    GREYTHR_URL,
    GREYTHR_USERNAME,
    GREYTHR_PASSWORD,
    LOGIN_TIME,
    LOGOUT_TIME
} = process.env;

if (!GREYTHR_URL || !GREYTHR_USERNAME || !GREYTHR_PASSWORD || !LOGIN_TIME || !LOGOUT_TIME) {
    console.error('Error: Missing required environment variables. Please check your .env file.');
    process.exit(1);
}

module.exports = {
    GREYTHR_URL,
    GREYTHR_USERNAME,
    GREYTHR_PASSWORD,
    HEADLESS: process.env.HEADLESS === 'true'
};
