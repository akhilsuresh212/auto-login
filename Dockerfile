# ---- Build Stage ----
FROM mcr.microsoft.com/playwright:v1.57.0-jammy AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN mkdir -p /tmp/runtime-config \
  && if [ -f .env ]; then cp .env /tmp/runtime-config/.env; fi \
  && if [ -f .env.keys ]; then cp .env.keys /tmp/runtime-config/.env.keys; fi

# ---- Run Stage ----
FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /tmp/runtime-config/ ./

ENV HEADLESS=true

EXPOSE 8000

CMD ["node", "dist/index.js"]
