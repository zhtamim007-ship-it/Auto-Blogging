# Blogger Autonomous AI Powerhouse

An AI-powered Node.js/Express application for autonomous blog post generation, optimized for Render free tier.

## Features

*   **Autonomous Content Creation**: Generates blog posts based on configured topics, tone, and length.
*   **Multi-Blog Management**: Supports targeting multiple blogs via Google OAuth.
*   **AI Integration**: Leverages Grok (or similar LLM) for content generation.
*   **SEO Optimization**: Automatic meta descriptions, keywords, tags, and internal linking.
*   **Media Integration**: Fetches featured images automatically.
*   **Persistent Storage**: Uses MongoDB for settings, auth tokens, execution logs, and article indexing.
*   **Error Handling & Monitoring**: Robust retry mechanisms, fallback strategies, and Telegram alerts.
*   **Admin Dashboard**: UI for configuration and monitoring.

## Tech Stack

*   Node.js
*   Express.js
*   EJS
*   Axios
*   Googleapis
*   Mongoose
*   dotenv
*   Node-Cron (for fallback/testing)
*   Method-Override
*   Morgan (for logging)

## Setup Instructions

### 1. Prerequisites

*   Node.js (v16 or higher recommended)
*   npm or yarn
*   MongoDB instance (local or cloud like MongoDB Atlas)
*   Google Cloud Project with Blogger API enabled
*   LLM API Key (e.g., Grok, or placeholder for OpenAI/other)
*   Image API Key (e.g., Unsplash)
*   Telegram Bot and Chat ID

### 2. Local Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd blogger-autonomous-ai-powerhouse
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Create `.env` file:**
    Copy `.env.example` to `.env` and fill in your credentials:
    ```bash
    cp .env.example .env
    ```
    Edit `.env` with your:
    *   `PORT`: (e.g., 3000)
    *   `GOOGLE_CLIENT_ID`: (From Google Cloud Console)
    *   `GOOGLE_CLIENT_SECRET`: (From Google Cloud Console)
    *   `GOOGLE_CALLBACK_URL`: (e.g., `http://localhost:3000/auth/callback`)
    *   `MONGODB_URI`: (Your MongoDB connection string, e.g., `mongodb://localhost:27017/bloggerAI`)
    *   `GROK_API_KEY`: (Your LLM API key)
    *   `GROK_API_URL`: (The LLM API endpoint, e.g., `https://api.x.ai/v1/chat/completions`)
    *   `IMAGE_API_KEY`: (Your Image API key, e.g., Unsplash)
    *   `IMAGE_API_URL`: (Optional, if using an API that needs it explicitly configured, Unsplash uses `unsplashApiUrl` in code)
    *   `TELEGRAM_BOT_TOKEN`: (From Telegram BotFather)
    *   `TELEGRAM_CHAT_ID`: (Your Telegram chat ID)
    *   `RENDER_EXTERNAL_URL`: (Optional, for local testing of external trigger URL)

4.  **Configure Google Cloud Project:**
    *   Go to the Google Cloud Console: [https://console.cloud.google.com/](https://console.cloud.google.com/)
    *   Create a new project or select an existing one.
    *   Enable the **Blogger API**.
    *   Go to "APIs & Services" > "Credentials".
    *   Create an "OAuth client ID".
        *   Choose "Web application" as the application type.
        *   Add `http://localhost:3000/auth/callback` to "Authorized redirect URIs".
        *   Note down your "Client ID" and "Client Secret".

5.  **Start MongoDB:**
    Ensure your MongoDB server is running.

6.  **Run the application:**
    ```bash
    npm run dev
    ```
    The application should be running at `http://localhost:3000`.

### 3. Deployment to Render

1.  **Sign up for Render:** [https://render.com/](https://render.com/)
2.  **Create a new Web Service:**
    *   Connect your Git repository.
    *   Configure Build command: `npm install`
    *   Configure Start command: `node server.js`
    *   Select a Node.js runtime (e.g., Node.js 20).
    *   **Environment Variables**: Add all the variables from your `.env` file into Render's environment variable settings.
        *   `PORT`: Render assigns this dynamically, usually 8080. Your `GOOGLE_CALLBACK_URL` should match your Render service URL (e.g., `https://your-app-name.onrender.com/auth/callback`).
        *   `MONGODB_URI`: Use your MongoDB Atlas connection string.
        *   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, etc.
    *   **Redirect URIs**: In your Google Cloud Console, update "Authorized redirect URIs" to include your Render service URL's callback endpoint (e.g., `https://your-app-name.onrender.com/auth/callback`).
    *   **Database**: Render offers a free MongoDB service or you can connect your existing MongoDB Atlas.

3.  **Cron Triggers (External Requirement):**
    *   Render's free tier does *not* support internal background processes that need to run on a schedule when the server is asleep.
    *   You **must** use an **external cron job service** to trigger the pipeline. The endpoint to trigger is:
        `https://your-app-name.onrender.com/api/trigger-autopost`
    *   **Recommended External Cron Services**:
        *   **cron-job.org**: Free, simple to set up for basic HTTP triggers.
        *   **Healthchecks.io + External Trigger**: Use Healthchecks.io to monitor your service and trigger an external cron job when it pings.
        *   **AWS Lambda + EventBridge**: For more robust scheduling and integration.
        *   **Google Cloud Scheduler**: If using Google Cloud for other parts of your infrastructure.
    *   **Configuration**: Set up your chosen external cron service to make a GET or POST request to the `https://your-app-name.onrender.com/api/trigger-autopost` URL at your desired frequency.

### 4. Setting up Telegram Alerts

1.  **Create a Telegram Bot:**
    *   Search for the "BotFather" on Telegram.
    *   Start a chat with BotFather and use the `/newbot` command to create a new bot.
    *   BotFather will provide you with an **API Token**. Save this as `TELEGRAM_BOT_TOKEN` in your `.env` file.
2.  **Get your Chat ID:**
    *   Start a chat with your newly created bot.
    *   Send any message to the bot.
    *   You can then use a tool like `api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` in your browser (replace `<YOUR_BOT_TOKEN>` with your bot's token) to find your `chat_id`. The `chat_id` will be a number. Save this as `TELEGRAM_CHAT_ID` in your `.env` file.
3.  **Ensure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are correctly set in your environment.**

### 5. Initial Setup Steps (Post-Deployment)

1.  Access the Admin Dashboard at `https://your-app-name.onrender.com/admin`.
2.  Click the "Connect Google Account" button to initiate the OAuth flow.
3.  Follow the prompts to authorize the application and select your target blog.
4.  Configure your desired settings (category, tone, frequency, etc.) in the dashboard.
5.  Set up your external cron job to trigger the `/api/trigger-autopost` endpoint.

---

### **Core Logic Implementation Notes**

*   **`services/apiService.js`**: Implements the retry logic with exponential backoff and jitter for all external API calls. Includes logging and Telegram alerts on failure.
*   **`services/grokService.js`**: Contains a placeholder for the Grok API call, respecting the specified endpoint and model. The prompt engineering is designed to incorporate all required settings and historical data for context.
*   **`services/bloggerService.js`**: Handles authentication setup using `googleapis`, fetching blogs, inserting posts (with draft/publish logic), and updating the article index.
*   **`services/imageService.js`**: Implements fetching featured images, with a fallback between Unsplash and Pollinations.
*   **`services/seoService.js`**: Contains logic for basic HTML validation, generating meta descriptions, managing tags, injecting internal links (using a placeholder semantic search), and injecting PPC links.
*   **`services/pipelineService.js`**: Orchestrates the 4-stage agent pipeline, calling other services in sequence and handling overall error management and logging.
*   **`routes/auth.js`**: Manages the Google OAuth flow, token exchange, and saving credentials.
*   **`routes/admin.js`**: Provides the admin dashboard UI, handles saving settings, manual pipeline triggers, and authentication checks.
*   **`routes/api.js`**: Exposes the `/api/trigger-autopost` endpoint for external cron jobs.

**Important:**
*   Actual API keys and endpoints for Grok and image services should be configured in `.env` and `config/apiConfig.js`.
*   The "semantic" internal linking in `seoService.js` is a placeholder and would require integration with a vector database or embedding models for true semantic search.
*   The prompt engineering for Grok is a starting point and may require tuning.
*   Error handling and logging are implemented throughout, but extensive monitoring and alerting setup is crucial for production.
*   Tailwind CSS is assumed for styling `admin.ejs`, but the setup for its compilation/inclusion is outside the scope of this code generation and would need to be handled in the `public/css` directory. Basic inline styles are provided for immediate use.

This comprehensive solution provides the structure, logic, and configuration necessary to build the "Blogger Autonomous AI Powerhouse."