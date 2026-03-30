# Claude Code Agent Skills & Context: Auto-Login Automation

## 1. Project Identity & Purpose
You are an expert AI developer assistant managing the `auto-login` repository. 
- **Core Function**: An automated Node.js application that handles login, logout, and attendance workflows for the GreytHR portal.
- **Key Mechanisms**: Uses Playwright for UI automation/authentication, native `fetch` via page evaluation for API-level attendance marking, and `node-cron` for scheduling. 
- **Notification System**: Integrates with Telegram for success/failure alerts and SMTP for email fallbacks on API errors.

## 2. Tech Stack & Environment
- **Language**: TypeScript (Node.js v18/v20 target).
- **Core Libraries**: `playwright` (browser automation), `node-cron` (scheduling).
- **Security**: `@dotenvx/dotenvx` for encrypted environment variable management.
- **Build Tool**: `esbuild` for bundling into a single optimized `dist/index.js` file.
- **Runtime Environment**: Designed to run locally, via Docker (headless), or deployed on Google Compute Engine (GCE).

## 3. Architectural Rules & Coding Standards
When writing, modifying, or refactoring code in this repository, strictly adhere to the following principles:

- **Clean Architecture & Modularity**: Maintain strict separation of concerns. UI automation (`auth.ts`), API requests (`attendance.ts`), configuration (`env.ts`), and side-effects (`telegram.ts`, `logService.ts`) must remain isolated in their respective domains.
- **Strict Typing & Validations**: Utilize TypeScript interfaces for all data structures (e.g., `AttendanceLocation`, `AttendanceData`). Ensure explicit return types for all functions.
- **Consistent Logging**: Never use standard `console.log` for critical state changes alone. Always pair it with the internal logging services (`logStatus`, `logError`) to ensure uniform trace tracking.
- **Communication Style**: Explanations and documentation should be highly structured, practical, and direct. Avoid verbosity; focus on the "how" and "why" concisely.
- **Error Handling**: Implement robust `try/catch/finally` blocks, especially for Playwright browser context management. Always ensure `browser`, `context`, and `page` instances are cleanly closed in `finally` blocks to prevent memory leaks.

## 4. Codebase Navigation & Workflows

### Directory Structure Awareness
- `/config/env.ts`: Centralized, validated environment configuration. Exits process immediately if critical variables are missing.
- `/services/auth.ts`: Handles UI interactions for login and logout using Playwright locators.
- `/services/attendance.ts`: Intercepts the GreytHR dashboard API (`/v3/api/dashboard/dashlet/markAttendance`) to retrieve state, and uses `fetch` to POST attendance actions (`/v3/api/attendance/mark-attendance?action=Signin/Signout`).
- `/services/leaveService.ts`: Evaluates if the user is on leave to conditionally skip attendance workflows.
- `/index.ts`: The main entry point handling CLI arguments and initializing cron schedulers.

### Core CLI Commands (Agent Execution Skills)
When asked to test or run specific workflows, use these commands:
- **Health Check**: `npx ts-node index.ts --health` (Validates portal reachability).
- **Manual Login**: `npx ts-node index.ts --login` (Triggers auth + check-in flow).
- **Manual Logout**: `npx ts-node index.ts --logout` (Triggers auth + check-out flow).
- **Production Build**: `npm run build` (Clears dist, type-checks, and bundles via esbuild).
- **Run Bundled Output**: `node dist/index.js`

## 5. Security & Secrets Management (dotenvx)
- Recognize that `.env` files might be encrypted. 
- The application automatically decrypts values at runtime using keys in `.env.keys` or the `DOTENV_PRIVATE_KEY` environment variable.
- Do not commit unencrypted `.env` files. If instructed to add new variables, ensure they are added to the validation interface in `config/env.ts`.

## 6. Deployment Context
- **Current Strategy (Stateful)**: The system relies on `node-cron`, requiring a persistent runtime like a Google Compute Engine VM or a local Docker container running 24/7.
- **Future/Alternative Strategy (Stateless)**: If migrating to serverless (e.g., Google Cloud Run), be prepared to refactor `index.ts` to remove `node-cron`, expose an Express server with POST routes (`/login`, `/logout`), and rely on external triggers (Cloud Scheduler).

## 7. Troubleshooting Guidelines
- **Playwright Timeouts**: If UI interactions fail, default to capturing a screenshot and triggering the Telegram/Mailer failure functions before closing the browser context.
- **API Interception Fallbacks**: If the `markAttendance` network request isn't intercepted on load, the system falls back to a manual `page.evaluate()` fetch. Keep this redundancy intact during refactors.
