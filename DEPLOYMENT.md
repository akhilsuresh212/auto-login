# Google Cloud Deployment Guide

Since your application uses an internal scheduler (`node-cron`) to run tasks at specific times, it needs to be running continuously. The most straightforward way to deploy this on Google Cloud is using **Google Compute Engine (GCE)** to run a small Virtual Machine (VM).

## Option 1: Google Compute Engine (VM) - Recommended for "As Is"

This method keeps your code exactly as it is. We will provision a small Linux VM, install Docker, and run your container.

### 1. Prerequisites
- A Google Cloud Project.
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) installed locally (optional, can use Cloud Console).

### 2. Create a VM Instance
You can use the **Free Tier eligible** `e2-micro` instance if available in your region (e.g., `us-central1`, `us-west1`, `us-east1`).

**Via Console:**
1.  Go to **Compute Engine** > **VM instances**.
2.  Click **Create Instance**.
3.  **Name**: `greyt-auto-login`.
4.  **Region**: `us-central1` (or your preferred).
5.  **Machine type**: `e2-micro` (2 vCPU, 1 GB memory).
6.  **Boot disk**: Select **Ubuntu 22.04 LTS** (Standard persistent disk, 10GB is fine).
7.  **Firewall**: No special HTTP access needed unless you want to expose logs remotely.
8.  Click **Create**.

### 3. Setup the VM
Once the VM is running, click **SSH** to connect to it.

**Inside the VM terminal:**

1.  **Install Docker & Docker Compose:**
    ```bash
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    
    echo \
      "deb [arch=\"$(dpkg --print-architecture)\" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
      
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    ```

2.  **Clone Your Repository** (or copy files):
    *   *Option A (Git)*:
        ```bash
        git clone <your-repo-url>
        cd auto-login
        ```
    *   *Option B (Manual Copy)*:
        Create the directory and copy `docker-compose.yml`, `Dockerfile`, `package.json`, `package-lock.json`, `index.js`, `services/`, `config/` using text editor or SCP.

3.  **Configure Environment**:
    Create your `.env` file on the server.
    ```bash
    nano .env
    ```
    Paste your encrypted/production values. Ensure `HEADLESS=true`.

4.  **Decrypt Keys (Important)**:
    If using `dotenvx`, make sure your `.env.keys` is present or set `DOTENV_PRIVATE_KEY` in your `.env`.

### 4. Run the Application
```bash
sudo docker compose up --build -d
```
Check status:
```bash
sudo docker compose logs -f
```

---

## Option 2: Cloud Run (Requires Code Changes)

Cloud Run is "Serverless" and scales to zero. It is cheaper but **doesn't support internal Cron** (like `node-cron`) naturally because it shuts down when not processing web requests.

**To use Cloud Run, you would need to:**
1.  Remove `node-cron` from `index.js`.
2.  Create an Express.js server in `index.js` that listens on `PORT`.
3.  Add endpoints like `POST /login` and `POST /logout` that trigger your functions.
4.  Deploy to **Cloud Run**.
5.  Use **Cloud Scheduler** to hit your `POST /login` URL at 9:00 AM and `POST /logout` at 6:00 PM.

*This path is more complex to set up initially but robust for production.*
