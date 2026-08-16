// config/googleAuth.js
const { google } = require('googleapis');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
    console.error('FATAL ERROR: Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL) are not fully configured in .env file.');
    // In a real app, you might want to throw an error or handle this more gracefully
    // For now, we'll allow it to proceed but expect issues later.
}

const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL
);

// Scopes for Blogger API
const SCOPES = ['https://www.googleapis.com/auth/blogger'];

const googleAuth = {
    oauth2Client,
    SCOPES,
    generateAuthUrl: () => {
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: SCOPES.join(' '),
        });
        return authUrl;
    },
    getToken: async (code) => {
        try {
            const { tokens } = await oauth2Client.getToken(code);
            // Update tokens to the client so subsequent API calls are authorized
            oauth2Client.setCredentials(tokens);
            return tokens;
        } catch (error) {
            console.error('Error getting Google OAuth tokens:', error);
            throw error;
        }
    },
    setCredentials: (tokens) => {
        oauth2Client.setCredentials(tokens);
    },
    getCredentials: () => {
        return oauth2Client.credentials;
    }
};

module.exports = googleAuth;