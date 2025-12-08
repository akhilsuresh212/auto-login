# Auto Login Automation

This project automates the login and logout process for the GreytHR portal using Playwright and Node.js. It supports scheduling via cron expressions and can be run locally or within a Docker container.

## Features

- **Automated Login/Logout**: Automatically logs in and out of the GreytHR portal.
- **Attendance Check-in/out**: Handles check-in and check-out workflows.
- **Scheduling**: configurable schedules using cron expressions.
- **Headless Mode**: Supports running in headless mode (default for Docker) or headed mode for debugging.
- **Secure Configuration**: Uses `@dotenvx/dotenvx` for encrypted environment variable management.

## Prerequisites

- Node.js (v18 or higher)
- Docker & Docker Compose (optional, for containerized execution)

## Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository_url>
    cd auto-login
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    Copy the example environment file or create a new `.env` file:
    ```bash
    cp .env.example .env
    ```

    Fill in the following details in your `.env` file:

    | Variable | Description | Example |
    | :--- | :--- | :--- |
    | `GREYTHR_URL` | URL of your GreytHR portal | `https://example.greythr.com/` |
    | `GREYTHR_USERNAME` | Your login username | `EMP123` |
    | `GREYTHR_PASSWORD` | Your login password | `password123` |
    | `LOGIN_TIME` | Cron expression for login time | `0 9 * * 1-5` (9:00 AM Mon-Fri) |
    | `LOGOUT_TIME` | Cron expression for logout time | `0 18 * * 1-5` (6:00 PM Mon-Fri) |
    | `HEADLESS` | Run in headless mode (true/false) | `true` |

## Encryption with Dotenvx

This project uses [dotenvx](https://dotenvx.com/) to encrypt sensitive environment variables.

### Encrypting your .env file
To encrypt your environment variables, run:
```bash
npx dotenvx encrypt
```
This will generate an encrypted `.env` file and a `.env.keys` file containing your decryption keys.

### Decrypting your .env file
To view or edit the decrypted values locally:
```bash
npx dotenvx get GREYTHR_PASSWORD
# OR to expose all locally for editing (be careful not to commit unencrypted .env if configured to ignore)
npx dotenvx decrypt
```

### Running with Encrypted Env
The application is configured to automatically load encrypted values using the keys present in `.env.keys` or via the `DOTENV_PRIVATE_KEY` environment variable (useful for CI/CD or Docker production).

## Usage

### Local Execution

To run the application locally:
```bash
node index.js
```

### Docker Execution

To run the application in a Docker container:

1.  **Build and Start:**
    ```bash
    docker-compose up --build -d
    ```

2.  **View Logs:**
    ```bash
    docker-compose logs -f
    ```

3.  **Stop Container:**
    ```bash
    docker-compose down
    ```

## Development

- **Headless Mode**: Set `HEADLESS=false` in your `.env` file to see the browser UI during development/debugging.
- **Logs**: Application logs are output to the console and can be persisted if volume mapping is configured.
