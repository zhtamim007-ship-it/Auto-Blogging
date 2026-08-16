// routes/auth.js
const express = require('express');
const router = express.Router();
const googleAuth = require('../config/googleAuth');
const { AuthToken, Settings } = require('../db');
const { google } = require('googleapis');
const { logExecution, isTokenExpiring } = require('../services/apiService'); // Import logging utility

// Diagnostics: shows the exact redirect URI this deployment will send to Google,
// so it can be pasted into Google Cloud Console → Authorised redirect URIs.
router.get('/status', (req, res) => {
    res.json(googleAuth.getConfigStatus(req));
});

// Route to initiate Google OAuth login
router.get('/login', async (req, res) => {
    const status = googleAuth.getConfigStatus(req);

    if (!status.ready) {
        const msg =
            'Google sign-in is not configured yet. Missing: ' + status.missing.join(', ') + '. ' +
            'Set these environment variables (Render → Environment) and redeploy.';
        console.error(msg);
        logExecution('FAILED', 'Google Auth Login', msg);
        return res.status(500).render('oauth-error', {
            pageTitle: 'Google Sign-in Not Configured',
            message: msg,
            status,
            suggestedRedirectUri:
                status.redirectUri ||
                googleAuth.normalizeRedirectUri(`${req.protocol}://${req.get('host')}`) ||
                'https://your-app-name.onrender.com/auth/callback',
        });
    }

    try {
        const authUrl = googleAuth.generateAuthUrl(req);
        console.log('Redirecting to Google OAuth with redirect_uri:', status.redirectUri);
        res.redirect(authUrl);
    } catch (error) {
        console.error('Failed to build Google OAuth URL:', error.message);
        logExecution('FAILED', 'Google Auth Login', error.message);
        res.status(500).render('oauth-error', {
            pageTitle: 'Google Sign-in Error',
            message: error.message,
            status,
            suggestedRedirectUri: status.redirectUri || '',
        });
    }
});

// Callback route to handle Google's response
router.get('/callback', async (req, res) => {
    const { code, error: googleError } = req.query;

    // Google can return ?error=access_denied etc. instead of a code.
    if (googleError) {
        const errorMsg = `Google returned an authorization error: ${googleError}`;
        console.error(errorMsg);
        logExecution('FAILED', 'Google Auth Callback', errorMsg);
        return res.status(400).render('select-blog', { message: errorMsg, error: true, blogs: [], settings: {} });
    }

    if (!code) {
        const errorMsg = 'Authorization code not received.';
        console.error(errorMsg);
        logExecution('FAILED', 'Google Auth Callback', errorMsg);
        return res.status(400).render('select-blog', { message: errorMsg, error: true, blogs: [], settings: {} });
    }

    try {
        // 1. Exchange authorization code for tokens using the SAME redirect_uri
        // that was sent to the consent screen (Google rejects any mismatch).
        const tokens = await googleAuth.getToken(code, req);
        console.log('Received OAuth tokens.');

        // 2. Save/Update AuthToken in the database
        // For simplicity, assuming one user setup. In a multi-user app, this would be user-specific.
        const userId = 'currentUser'; // Placeholder for a real user ID
        let authToken = await AuthToken.findOne({ userId });

        if (authToken) {
            // Update existing token
            authToken.accessToken = tokens.access_token;
            // Google only returns a refresh token on first consent — keep the old one.
            if (tokens.refresh_token) authToken.refreshToken = tokens.refresh_token;
            authToken.tokenExpiry = new Date(tokens.expiry_date || Date.now() + 3600 * 1000);
            await authToken.save();
            console.log('AuthToken updated successfully.');
        } else {
            // Create new token entry
            authToken = new AuthToken({
                userId: userId,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token || '',
                tokenExpiry: new Date(tokens.expiry_date || Date.now() + 3600 * 1000),
                blogsList: [], // Will be populated next
            });
            await authToken.save();
            console.log('AuthToken created successfully.');
        }

        // 3. Initialize Blogger API client with the obtained tokens
        googleAuth.setCredentials(tokens); // Set credentials for the global client
        const blogger = google.blogger({ version: 'v3', auth: googleAuth.oauth2Client });

        // 4. Fetch all available blogs
        console.log('Fetching blogs...');
        const blogsResponse = await blogger.blogs.listByUser({ userId: 'me' });
        const blogs = blogsResponse.data.items || [];

        if (blogs.length === 0) {
            console.warn('No blogs found for the authenticated user.');
            // Update the auth token with empty list, as it's the current state
            authToken.blogsList = [];
            await authToken.save();
            return res.render('select-blog', {
                message: 'No blogs found for this account. Please ensure you have created at least one blog.',
                error: true,
                blogs: [],
                settings: {} // Pass empty settings if no blogs
            });
        }

        // Store blog list in AuthToken document
        authToken.blogsList = blogs.map(blog => ({
            id: blog.id,
            name: blog.name,
            url: blog.url,
        }));
        await authToken.save();
        console.log(`Fetched and saved ${blogs.length} blogs.`);

        // Render the blog selection interface
        res.render('select-blog', {
            message: 'Google account connected successfully. Please select your target blog.',
            error: false,
            blogs: authToken.blogsList, // Pass the fetched blogs to the view
            settings: {} // Pass empty settings for now, will be fetched in admin route
        });

    } catch (error) {
        const errorMsg = `Error during Google OAuth callback: ${error.message}`;
        console.error(errorMsg, error.stack);
        logExecution('FAILED', 'Google Auth Callback', errorMsg, null, { error: error.message, stack: error.stack });

        if (error.code === 'GOOGLE_OAUTH_NOT_CONFIGURED' || /redirect_uri/i.test(error.message)) {
            const status = googleAuth.getConfigStatus(req);
            return res.status(500).render('oauth-error', {
                pageTitle: 'Google Sign-in Configuration Error',
                message: error.message,
                status,
                suggestedRedirectUri: status.redirectUri || '',
            });
        }

        // Handle token refresh issues or other errors
        if (error.message.includes('invalid_grant') || error.message.includes('invalid_request')) {
            // If the token is invalid or expired, prompt user to re-authenticate
            return res.render('select-blog', { message: 'Authentication error. Please re-authenticate.', error: true, blogs: [], settings: {} });
        }
        res.render('select-blog', { message: `An error occurred: ${error.message}`, error: true, blogs: [], settings: {} });
    }
});

// Route to resync blogs if user wants to update their blog list
router.post('/resync-blogs', async (req, res) => {
    try {
        const authToken = await AuthToken.findOne({ userId: 'currentUser' });
        if (!authToken) {
            return res.redirect('/auth/login'); // Not authenticated
        }

        googleAuth.setCredentials({
            access_token: authToken.accessToken,
            refresh_token: authToken.refreshToken,
            expiry_date: (new Date(authToken.tokenExpiry)).getTime(),
        });

        if (isTokenExpiring(googleAuth.oauth2Client)) {
            const { credentials } = await googleAuth.oauth2Client.refreshAccessToken();
            authToken.accessToken = credentials.access_token;
            if (credentials.refresh_token) authToken.refreshToken = credentials.refresh_token;
            authToken.tokenExpiry = new Date(credentials.expiry_date);
            googleAuth.setCredentials(credentials);
        }

        const blogger = google.blogger({ version: 'v3', auth: googleAuth.oauth2Client });

        console.log('Resyncing blogs...');
        const blogsResponse = await blogger.blogs.listByUser({ userId: 'me' });
        const blogs = blogsResponse.data.items || [];

        authToken.blogsList = blogs.map(blog => ({
            id: blog.id,
            name: blog.name,
            url: blog.url,
        }));
        await authToken.save();

        if (blogs.length === 0) {
            await logExecution('FAILED', 'Resync Blogs', 'No blogs found for this Google account.');
            return res.redirect('/admin?error=true&message=' + encodeURIComponent('No blogs found for this Google account.'));
        }

        await logExecution('SUCCESS', 'Resync Blogs', null, null, { count: blogs.length });
        // Redirect instead of rendering: the admin view needs locals (logs, API keys)
        // that only the /admin route assembles.
        res.redirect('/admin?message=' + encodeURIComponent(`Re-synced ${blogs.length} blog(s).`));

    } catch (error) {
        console.error('Error resyncing blogs:', error.message);
        logExecution('FAILED', 'Resync Blogs', `Error resyncing blogs: ${error.message}`, null, { error: error.message });
        if (error.message.includes('invalid_grant') || error.message.includes('invalid_request')) {
            return res.redirect('/auth/login'); // Prompt to re-authenticate
        }
        res.redirect('/admin?error=true&message=' + encodeURIComponent(`Failed to resync blogs: ${error.message}`));
    }
});

module.exports = router;