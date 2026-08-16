// services/apiService.js
const axios = require('axios');
const apiConfig = require('../config/apiConfig');
const { ExecutionLog } = require('../db');
const { v4: uuidv4 } = require('uuid'); // For unique request IDs

// --- Logging Utility ---
async function logExecution(status, action, errorMessage = null, blogPostUrl = null, details = {}) {
    try {
        const newLog = new ExecutionLog({
            status,
            action,
            errorMessage,
            blogPostUrl,
            details: { ...details, timestamp: new Date().toISOString() }, // Add timestamp to details for consistency
        });
        await newLog.save();
        console.log(`[${status}] ${action}: ${errorMessage || blogPostUrl || JSON.stringify(details)}`);
    } catch (logError) {
        console.error('Failed to save execution log:', logError);
    }
}

// --- Telegram Notification Service ---
async function sendTelegramAlert(message) {
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

    // Basic retry logic for Telegram
    let retries = apiConfig.telegram.maxRetries;
    let delay = apiConfig.telegram.retryDelay;

    while (retries > 0) {
        try {
            await axios.post(telegramUrl, payload, { timeout: 5000 });
            console.log('Telegram alert sent successfully.');
            return; // Success
        } catch (error) {
            console.error(`Telegram alert failed (Attempt ${apiConfig.telegram.maxRetries - retries + 1}/${apiConfig.telegram.maxRetries}):`, error.message);
            retries--;
            if (retries === 0) {
                console.error('Max retries reached for Telegram alert. Giving up.');
                break; // Exit loop if max retries reached
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff
        }
    }
}

// --- Generic API Call with Retry Logic ---
async function makeApiRequest(options) {
    const {
        method = 'GET',
        url,
        data = null,
        headers = {},
        apiName, // e.g., 'Grok', 'Blogger', 'Image'
        action,  // e.g., 'Content Generation', 'Fetch Image'
        logSuccess = true, // Whether to log successful API calls
        logError = true,   // Whether to log failed API calls
        isAuthRequired = false // If true, will try to use Google OAuth tokens
    } = options;

    const maxRetries = apiConfig[apiName.toLowerCase()]?.maxRetries || 3;
    let retryDelay = apiConfig[apiName.toLowerCase()]?.retryDelay || 1000; // Initial delay in ms
    const apiKey = apiConfig[apiName.toLowerCase()]?.apiKey; // Generic API key for non-Google APIs
    const apiUrl = apiConfig[apiName.toLowerCase()]?.apiUrl || url; // Use specific API URL if provided

    let retries = maxRetries;
    let attempt = 0;
    const requestId = uuidv4(); // Unique ID for this request attempt

    // Construct headers
    const requestHeaders = { ...headers };

    if (apiKey && !isAuthRequired) {
        // Add API key for services like Grok, Image (if not using OAuth)
        // This depends on how the API expects the key (e.g., Authorization header, query param)
        // Example for a common Bearer token setup:
        requestHeaders['Authorization'] = `Bearer ${apiKey}`;
        // Example for a query parameter:
        // requestUrl = `${apiUrl}?apiKey=${apiKey}`;
    }

    let googleAuthTokens = null;
    if (isAuthRequired) {
        try {
            // Fetch or refresh Google Auth tokens if needed
            // This logic should ideally be managed by the caller or a dedicated auth service
            // For now, assuming tokens are set globally or passed in.
            // If not passed, we'd need to retrieve them from DB and ensure they are fresh.
            // For simplicity, let's assume googleAuth.oauth2Client is already configured.
             if (!googleAuth.oauth2Client.credentials || googleAuth.oauth2Client.isTokenExpiring()) {
                 // Attempt to refresh if not set or expiring (requires a valid refresh token in oauth2Client)
                 // This part is crucial and assumes oauth2Client has a valid refresh token set.
                 // In a real scenario, you'd retrieve from DB and set it.
                 // For this example, we'll assume it's handled by the caller or `admin.js` middleware.
                 console.warn(`Google auth client credentials missing or expiring for ${apiName}. Attempting to use current. Ensure refresh is handled.`);
             }
             // Googleapis library automatically attaches auth tokens when calling methods like blogger.posts.insert
             // No need to manually add Authorization header for googleapis
        } catch (authError) {
            const errorMsg = `Google authentication failed for ${apiName}: ${authError.message}`;
            console.error(errorMsg);
            if (logError) {
                await logExecution('FAILED', `${apiName} Auth`, errorMsg, null, { action, apiName, url, error: authError.message });
            }
            // Propagate the error to be handled by the caller
            throw new Error(errorMsg);
        }
    }


    let finalUrl = apiUrl; // Start with the base API URL

    while (retries > 0) {
        attempt++;
        try {
            // Dynamically construct URL if query parameters are needed (like for Unsplash)
            let currentUrl = finalUrl;
            if (options.queryParams) {
                const queryParams = new URLSearchParams(options.queryParams).toString();
                currentUrl = `${finalUrl}?${queryParams}`;
            }

            const response = await axios({
                method,
                url: currentUrl,
                data,
                headers: requestHeaders,
                timeout: 15000, // 15-second timeout for API requests
            });

            if (logSuccess) {
                await logExecution('SUCCESS', `${apiName} - ${action}`, null, response.data?.url || response.data?.postUrl || null, { responseStatus: response.status, url: currentUrl });
            }
            return response.data; // Return the data part of the response

        } catch (error) {
            const errorCode = error.response?.status;
            const errorMessage = error.message || 'Unknown error';
            const errorDetails = error.response?.data || error.toJSON();
            const logMessage = `API Error: ${action} (${apiName}) - ${errorMessage} ${errorCode ? `[${errorCode}]` : ''}`;

            console.error(logMessage, errorDetails);

            // Specific handling for common API errors
            if (errorCode === 401) { // Unauthorized
                // Potentially refresh token for Google APIs or handle API key issues
                if (isAuthRequired && googleAuth.oauth2Client.isTokenExpiring()) {
                     console.log('Attempting to refresh Google token after 401...');
                     try {
                         const { credentials } = await googleAuth.oauth2Client.refreshAccessToken();
                         // Need to update the stored token in DB if this is critical
                         // For now, just set credentials for the current session
                         googleAuth.setCredentials(credentials);
                         console.log('Token refreshed, retrying request.');
                         retries++; // Give an extra attempt for the refresh
                         await new Promise(resolve => setTimeout(resolve, retryDelay)); // Wait before retrying
                         retryDelay *= 1.5; // Slightly increase delay for next potential retry
                         continue; // Skip to next iteration to retry
                     } catch (refreshError) {
                         console.error('Failed to refresh Google token after 401:', refreshError.message);
                         // If token refresh fails, we can't proceed.
                         // Log and break to signal failure.
                         if (logError) {
                             await logExecution('FAILED', `${apiName} - ${action}`, `Authentication failed and token refresh failed: ${refreshError.message}`, null, { url: currentUrl, attempt, error: error.message, response: errorDetails, stack: error.stack });
                         }
                         // Send Telegram alert for critical failures
                         await sendTelegramAlert(`🚨 *${apiName} API Error* \n\nAction: ${action}\nError: Authentication failed and token refresh failed.\nDetails: ${error.message}`);
                         throw new Error(`Authentication failed for ${apiName}. Please re-authenticate.`);
                     }
                }
                // If not Google auth or refresh didn't help, this is a hard failure for this attempt.
                if (logError) {
                    await logExecution('FAILED', `${apiName} - ${action}`, `Authentication failed: ${errorMessage}`, null, { url: currentUrl, attempt, error: error.message, response: errorDetails, stack: error.stack });
                }
                 await sendTelegramAlert(`🚨 *${apiName} API Error* \n\nAction: ${action}\nError: Unauthorized (401).\nURL: \`${url}\`\nDetails: ${errorMessage}`);
                 // For 401, it's often an invalid API key or expired token that can't be refreshed, so stop retrying.
                 break; 
            } else if (errorCode === 404) { // Not Found
                if (logError) {
                    await logExecution('FAILED', `${apiName} - ${action}`, `Resource not found (404): ${errorMessage}`, null, { url: currentUrl, attempt, error: error.message, response: errorDetails, stack: error.stack });
                }
                await sendTelegramAlert(`🚨 *${apiName} API Error* \n\nAction: ${action}\nError: Not Found (404).\nURL: \`${url}\`\nDetails: ${errorMessage}`);
                break; // Stop retrying for 404
            } else if (errorCode >= 500 || errorCode === 429) { // Server Error or Rate Limit
                // These are retryable errors
                if (retries === 1) {
                    console.error(`Max retries reached for ${apiName} - ${action}. Last error: ${errorMessage}`);
                    if (logError) {
                        await logExecution('FAILED', `${apiName} - ${action}`, `Max retries reached. Last error: ${errorMessage}`, null, { url: currentUrl, attempt, error: error.message, response: errorDetails, stack: error.stack });
                    }
                    await sendTelegramAlert(`🚨 *${apiName} API Error* \n\nAction: ${action}\nError: Max retries reached (${maxRetries}). Last error: ${errorMessage}\nURL: \`${url}\``);
                    break; // Exit loop if max retries reached
                }
                console.log(`Retrying ${apiName} - ${action} in ${retryDelay / 1000}s... (${retries - 1} retries left)`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                retryDelay *= 1.5; // Exponential backoff
            } else { // Other client errors (4xx) or unexpected errors
                if (logError) {
                    await logExecution('FAILED', `${apiName} - ${action}`, `Client error or unexpected error: ${errorMessage}`, null, { url: currentUrl, attempt, error: error.message, response: errorDetails, stack: error.stack });
                }
                await sendTelegramAlert(`🚨 *${apiName} API Error* \n\nAction: ${action}\nError: Client error or unexpected.\nURL: \`${url}\`\nDetails: ${errorMessage}`);
                break; // Do not retry for other client errors
            }
        }
    }

    // If loop finishes without returning, it means max retries were reached or a non-retryable error occurred.
    throw new Error(`Failed to complete API request for ${apiName} - ${action} after ${maxRetries} attempts. See logs for details.`);
}

module.exports = {
    makeApiRequest,
    logExecution,
    sendTelegramAlert,
};