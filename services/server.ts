import express, { Request, Response, NextFunction } from "express";
import config from "../config/env";
import { logStatus, logError } from "./logService";

/**
 * Creates and configures the Express application.
 *
 * Endpoints:
 * - `GET  /health`  — liveness check, no authentication required.
 * - `POST /login`   — triggers the check-in flow (fire-and-forget, 202).
 * - `POST /logout`  — triggers the check-out flow (fire-and-forget, 202).
 *
 * All mutating endpoints require a valid `x-api-key` header that matches
 * `API_KEY` from the environment. Requests with a missing or wrong key
 * receive a 401 response before any flow is triggered.
 *
 * Fire-and-forget pattern: the HTTP response is sent immediately with 202
 * Accepted, and the Playwright workflow runs asynchronously in the background.
 * This keeps request latency under any cloud service timeout (Cloud Run: 60 s,
 * ECS ALB: 60 s) regardless of how long the browser session takes.
 */
export function createServer(
  runLoginFlow: () => Promise<void>,
  runLogoutFlow: () => Promise<void>,
): express.Application {
  const app = express();
  app.use(express.json());

  // ---------------------------------------------------------------------------
  // x-api-key authentication middleware
  // ---------------------------------------------------------------------------
  const authenticate = (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    const key = req.headers["x-api-key"];
    if (!key || key !== config.API_KEY) {
      logStatus(`Unauthorized request to ${req.method} ${req.path}`);
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };

  // ---------------------------------------------------------------------------
  // GET /health — no auth, used by Cloud Run / ECS health checks
  // ---------------------------------------------------------------------------
  app.get("/health", (_req: Request, res: Response): void => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ---------------------------------------------------------------------------
  // POST /login — fire-and-forget check-in
  // ---------------------------------------------------------------------------
  app.post("/login", authenticate, (_req: Request, res: Response): void => {
    logStatus("REST: POST /login received — dispatching login flow.");
    res.status(202).json({ message: "Login flow started." });
    runLoginFlow().catch((err) =>
      logError("REST /login: unhandled error in login flow", err),
    );
  });

  // ---------------------------------------------------------------------------
  // POST /logout — fire-and-forget check-out
  // ---------------------------------------------------------------------------
  app.post("/logout", authenticate, (_req: Request, res: Response): void => {
    logStatus("REST: POST /logout received — dispatching logout flow.");
    res.status(202).json({ message: "Logout flow started." });
    runLogoutFlow().catch((err) =>
      logError("REST /logout: unhandled error in logout flow", err),
    );
  });

  return app;
}

/**
 * Starts the Express server on `config.PORT`.
 *
 * Validates that `API_KEY` is set before binding — a server without an API key
 * would be open to anyone, so we fail fast rather than run insecurely.
 */
export function startServer(
  runLoginFlow: () => Promise<void>,
  runLogoutFlow: () => Promise<void>,
): void {
  if (!config.API_KEY) {
    console.error(
      "Error: API_KEY is required in server mode. Set it in your .env file.",
    );
    process.exit(1);
  }

  const app = createServer(runLoginFlow, runLogoutFlow);

  app.listen(config.PORT, () => {
    console.log(`REST server listening on port ${config.PORT}`);
    logStatus(`REST server started on port ${config.PORT}`);
  });
}
