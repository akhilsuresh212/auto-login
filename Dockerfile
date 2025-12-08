# Use the official Playwright image which includes all system dependencies
# Using jammy (Ubuntu 22.04) as a stable base
FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# Copy package files first to leverage cache
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application code
COPY . .

# Set environment variable to ensure headless mode in Docker
ENV HEADLESS=true

# Expose the port the app runs on
EXPOSE 8080

# Start the application
CMD ["node", "index.js"]
