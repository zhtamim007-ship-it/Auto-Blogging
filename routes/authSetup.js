// routes/authSetup.js
// Google OAuth credentials setup page — works without the database so users
// can configure Google sign-in credentials from the UI.
const express = require('express');
const router = express.Router();
const googleAuth = require('../config/googleAuth');
const googleAuthConfig = require('../config/googleAuthConfig');

/**
 * GET /auth/google-setup
 * Shows the Google OAuth credentials setup page with current status
 * and step-by-step instructions.
 */
router.get('/google-setup', (req, res) => {
    const authStatus = googleAuth.getConfigStatus(req);
    const inAppStatus = googleAuthConfig.getConfigStatus();

    // Build a suggested callback URL from the incoming request
    const host = req.get('x-forwarded-host') || req.get('host') || '';
    const proto = (req.get('x-forwarded-proto') || '').split(',')[0].trim() || req.protocol || 'https';
    const suggestedCallbackUrl = host
        ? `${proto}://${host}/auth/callback`
        : null;

    res.render('google-setup', {
        pageTitle: 'Google OAuth Setup',
        message: req.query.message || null,
        error: req.query.error === 'true',
        authStatus,
        inAppStatus,
        suggestedCallbackUrl,
    });
});

/**
 * POST /auth/google-setup/save
 * Saves the Google OAuth credentials to the in-app config file.
 */
router.post('/google-setup/save', async (req, res) => {
    try {
        const clientId = (req.body.clientId || '').trim();
        const clientSecret = (req.body.clientSecret || '').trim();
        const callbackUrl = (req.body.callbackUrl || '').trim();

        if (!clientId && !clientSecret && !callbackUrl) {
            return res.redirect(
                '/auth/google-setup?error=true&message=' +
                encodeURIComponent('Please fill in at least one field.')
            );
        }

        // Validate Client ID format (Google Client IDs look like: xxx.apps.googleusercontent.com)
        if (clientId && !/\.apps\.googleusercontent\.com$/.test(clientId)) {
            return res.redirect(
                '/auth/google-setup?error=true&message=' +
                encodeURIComponent('Client ID should end with .apps.googleusercontent.com — check you copied the full value.')
            );
        }

        // Validate callback URL format if provided
        if (callbackUrl) {
            try {
                const url = new URL(callbackUrl);
                if (url.protocol !== 'https:' && url.hostname !== 'localhost' && !url.hostname.startsWith('127.')) {
                    return res.redirect(
                        '/auth/google-setup?error=true&message=' +
                        encodeURIComponent('Callback URL must use https:// for production (or http://localhost for local dev).')
                    );
                }
                if (!url.pathname.endsWith('/auth/callback')) {
                    // Not a hard error but warn them
                    console.warn('GOOGLE CALLBACK URL does not end with /auth/callback:', callbackUrl);
                }
            } catch (e) {
                return res.redirect(
                    '/auth/google-setup?error=true&message=' +
                    encodeURIComponent('Callback URL is not a valid URL. Please enter a full URL like https://your-app.onrender.com/auth/callback.')
                );
            }
        }

        googleAuthConfig.saveConfig({ clientId, clientSecret, callbackUrl });

        res.redirect(
            '/auth/google-setup?message=' +
            encodeURIComponent('Google OAuth credentials saved successfully! You can now try signing in.')
        );
    } catch (err) {
        console.error('Error saving Google OAuth config:', err.message);
        res.redirect(
            '/auth/google-setup?error=true&message=' +
            encodeURIComponent('Failed to save: ' + err.message)
        );
    }
});

/**
 * POST /auth/google-setup/clear
 * Clears the in-app saved Google OAuth credentials.
 */
router.post('/google-setup/clear', async (req, res) => {
    try {
        googleAuthConfig.deleteConfig();
        res.redirect(
            '/auth/google-setup?message=' +
            encodeURIComponent('Saved Google OAuth credentials removed. Falling back to environment variables.')
        );
    } catch (err) {
        console.error('Error clearing Google OAuth config:', err.message);
        res.redirect(
            '/auth/google-setup?error=true&message=' +
            encodeURIComponent('Failed to clear: ' + err.message)
        );
    }
});

module.exports = router;