# ---- Build Stage ----
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Run Stage ----
FROM node:20-slim

ENV HEADLESS=true
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
# Default to REST server mode for cloud deployments (Cloud Run, ECS).
# Override with MODE=cron for self-hosted / persistent VM deployments.
ENV MODE=server
# Cloud Run injects PORT automatically; 8080 is the standard fallback.
ENV PORT=8080

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Install only Chromium and its system deps (using the exact playwright version installed above)
RUN npx playwright install --with-deps chromium

COPY --from=builder /app/dist ./dist

# Copy env files if they exist
COPY --from=builder /app/.env* ./

EXPOSE 8080

CMD ["node", "dist/index.js"]