// services/telegramService.js
const apiConfig = require('../config/apiConfig');
const { makeApiRequest, logExecution } = require('./apiService');

// This service is now largely integrated into apiService.js for sendTelegramAlert.
// However, it can be kept separate for more complex Telegram interactions if needed.

async function sendAlert(message) {
    if (!apiConfig.telegram.botToken || !apiConfig.telegram.chatId) {
        console.warn('Telegram Bot Token or Chat ID not configured. Skipping alert.');
        return;
    }

    const telegramUrl = `${apiConfig.telegram.apiUrl}${apiConfig.telegram.botToken}/sendMessage`;
    const payload = {
        chat_id: apiConfig.telegram.chatId,
        text: message,
        parse_mode: 'Markdown',
    };

    try {
        await makeApiRequest({
            method: 'POST',
            url: telegramUrl,
            data: payload,
            headers: { 'Content-Type': 'application/json' },
            apiName: 'Telegram',
            action: 'Send Alert',
            isAuthRequired: false, // Telegram API uses token in URL, not typical auth header
            logSuccess: false, // Avoid logging every alert sent
        });
        console.log('Telegram alert sent successfully.');
    } catch (error) {
        console.error('TelegramService: Failed to send alert:', error.message);
        // Note: makeApiRequest already logs errors.
        // No need to log again here unless there's specific Telegram error handling.
    }
}

module.exports = {
    sendAlert,
};