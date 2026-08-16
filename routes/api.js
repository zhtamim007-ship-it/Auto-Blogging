// routes/api.js
const express = require('express');
const router = express.Router();
const { Settings, AuthToken, ExecutionLog } = require('../db');
const pipelineService = require('../services/pipelineService');
const apiConfig = require('../config/apiConfig');
const { google } = require('googleapis');
const googleAuth = require('../config/googleAuth');

// Endpoint to be triggered by external cron jobs
router.get('/trigger-autopost', async (req, res) => {
    console.log('Received request to trigger autopost.');

    try {
        const settings = await Settings.findOne({});
        if (!settings || !settings.selectedBlogId) {
            const errorMsg = 'Configuration error: Blog not selected or settings not found. Please configure in admin dashboard.';
            console.error(errorMsg);
            await logExecution('FAILED', 'API Trigger', errorMsg);
            return res.status(500).json({ success: false, message: errorMsg });
        }

        const authToken = await AuthToken.findOne({ userId: 'currentUser' }); // Assuming 'currentUser'
        if (!authToken) {
            const errorMsg = 'Authentication error: No valid auth token found. Please re-authenticate.';
            console.error(errorMsg);
            await logExecution('FAILED', 'API Trigger', errorMsg);
            // Optionally, try to refresh token here if it's just expired
            // If token is truly invalid, user must re-authenticate via admin dashboard.
            return res.status(401).json({ success: false, message: errorMsg });
        }

        // Prepare Google API client
        googleAuth.setCredentials({
            access_token: authToken.accessToken,
            refresh_token: authToken.refreshToken,
            expiry_date: (new Date(authToken.tokenExpiry)).getTime(),
        });

        // Refresh token if it's expiring soon
        if (googleAuth.oauth2Client.isTokenExpiring()) {
            console.log('Token is expiring, refreshing...');
            try {
                const { credentials } = await googleAuth.oauth2Client.refreshAccessToken();
                authToken.accessToken = credentials.access_token;
                authToken.refreshToken = credentials.refresh_token; // Refresh token might also be refreshed
                authToken.tokenExpiry = new Date(credentials.expiry_date);
                await authToken.save();
                googleAuth.setCredentials(credentials);
                console.log('Token refreshed and updated.');
            } catch (refreshError) {
                const errorMsg = `Failed to refresh Google OAuth token: ${refreshError.message}`;
                console.error(errorMsg);
                await logExecution('FAILED', 'API Trigger - Token Refresh', errorMsg, null, { error: refreshError.message, stack: refreshError.stack });
                // If refresh fails, we cannot proceed
                return res.status(401).json({ success: false, message: errorMsg });
            }
        }
        
        const blogger = google.blogger({ version: 'v3', auth: googleAuth.oauth2Client });

        // Execute the pipeline
        await pipelineService.runPipeline(settings, {
            access_token: authToken.accessToken,
            refresh_token: authToken.refreshToken,
            expiry_date: (new Date(authToken.tokenExpiry)).getTime(),
        }, blogger);

        console.log('Autopost pipeline triggered and executed successfully.');
        res.status(200).json({ success: true, message: 'Blog post generation pipeline triggered and executed.' });

    } catch (error) {
        const errorMsg = `Error in /api/trigger-autopost: ${error.message}`;
        console.error(errorMsg, error.stack);
        // Log the error, but don't necessarily send the full stack to the external caller
        await logExecution('FAILED', 'API Trigger', errorMsg, null, { error: error.message, stack: error.stack });
        res.status(500).json({ success: false, message: 'An internal error occurred while processing the request. Please check server logs.' });
    }
});

module.exports = router;