// config/apiConfig.js
// Centralized configuration for external APIs

require('dotenv').config();

const apiConfig = {
    grok: {
        apiKey: process.env.GROK_API_KEY,
        apiUrl: process.env.GROK_API_URL || 'https://api.x.ai/v1/chat/completions', // Default if not set
        model: process.env.GROK_MODEL || 'grok-2-latest', // Must be a real model id accepted by the xAI API
        maxRetries: 3,
        retryDelay: 1000, // Initial delay in ms
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        apiUrl: process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/models',
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
        maxRetries: 3,
        retryDelay: 1000,
    },
    blogger: {
        // Note: API keys are not typically used for Google APIs directly here
        // Authentication is handled via OAuth2 tokens managed by googleapis library
    },
    image: {
        // Using Unsplash as a primary example, Pollinations.ai as fallback
        // Unsplash API requires access key
        unsplashApiUrl: 'https://api.unsplash.com/search/photos',
        unsplashApiKey: process.env.IMAGE_API_KEY,
        // Alias kept so generic lookups (apiConfig[name].apiKey) and views work.
        apiKey: process.env.IMAGE_API_KEY,
        // Pollinations.ai might use a key or be more open, adjust as needed
        pollinationsApiKey: process.env.POLLINATIONS_API_KEY, // Placeholder if needed
        pollinationsApiUrl: 'https://api.pollinations.ai/gpc/v1/jobs', // Example URL, adjust if necessary
        fallbackImageQuery: 'abstract background', // Default query if title-based fails
    },
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
        apiUrl: 'https://api.telegram.org/bot',
        maxRetries: 3,
        retryDelay: 500,
    },
    // Add other API configurations here
};

// Basic validation for required keys
if (!apiConfig.grok.apiKey) {
    console.warn('WARNING: GROK_API_KEY is not set in .env. AI content generation may fail.');
}
if (!apiConfig.image.unsplashApiKey) {
    console.warn('WARNING: IMAGE_API_KEY (Unsplash) is not set in .env. Image fetching may fail.');
}
if (!apiConfig.telegram.botToken || !apiConfig.telegram.chatId) {
    console.warn('WARNING: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set in .env. Telegram notifications will not be sent.');
}


module.exports = apiConfig;