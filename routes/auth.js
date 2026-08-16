// routes/auth.js
const express = require('express');
const router = express.Router();
const googleAuth = require('../config/googleAuth');
const { AuthToken, Settings } = require('../db');
const { google } = require('googleapis');
const { logExecution } = require('../services/apiService'); // Import logging utility

// Route to initiate Google OAuth login
router.get('/login', async (req, res) => {
    const authUrl = googleAuth.generateAuthUrl();
    console.log('Redirecting to Google OAuth:', authUrl);
    res.redirect(authUrl);
});

// Callback route to handle Google's response
router.get('/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        const errorMsg = 'Authorization code not received.';
        console.error(errorMsg);
        logExecution('FAILED', 'Google Auth Callback', errorMsg);
        return res.status(400).render('select-blog', { message: errorMsg, error: true, blogs: [], settings: {} });
    }

    try {
        // 1. Exchange authorization code for tokens
        const { tokens } = await googleAuth.getToken(code);
        console.log('Received OAuth tokens.');

        // 2. Save/Update AuthToken in the database
        // For simplicity, assuming one user setup. In a multi-user app, this would be user-specific.
        const userId = 'currentUser'; // Placeholder for a real user ID
        let authToken = await AuthToken.findOne({ userId });

        if (authToken) {
            // Update existing token
            authToken.accessToken = tokens.access_token;
            authToken.refreshToken = tokens.refresh_token;
            authToken.tokenExpiry = new Date(tokens.expiry_date);
            await authToken.save();
            console.log('AuthToken updated successfully.');
        } else {
            // Create new token entry
            authToken = new AuthToken({
                userId: userId,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                tokenExpiry: new Date(tokens.expiry_date),
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
        let authToken = await AuthToken.findOne({ userId: 'currentUser' }); // Assuming 'currentUser'
        if (!authToken) {
            return res.redirect('/auth/login'); // Not authenticated
        }

        // Re-authenticate to get a fresh token if needed and set credentials
        googleAuth.setCredentials({
            access_token: authToken.accessToken,
            refresh_token: authToken.refreshToken,
            expiry_date: (new Date(authToken.tokenExpiry)).getTime(),
        });

        // Ensure the client is valid
        const blogger = google.blogger({ version: 'v3', auth: googleAuth.oauth2Client });

        console.log('Resyncing blogs...');
        const blogsResponse = await blogger.blogs.listByUser({ userId: 'me' });
        const blogs = blogsResponse.data.items || [];

        if (blogs.length === 0) {
            authToken.blogsList = [];
            await authToken.save();
            return res.status(400).render('admin', {
                pageTitle: 'Admin Dashboard',
                settings: {}, // Fetch settings to show partial state
                blogs: [],
                selectedBlogDetails: null,
                message: 'No blogs found. Blog list cleared.',
                error: true,
                apiConfig: require('../config/apiConfig'), // Pass apiConfig to view
                executionLogs: [] // Fetch logs
            });
        }

        authToken.blogsList = blogs.map(blog => ({
            id: blog.id,
            name: blog.name,
            url: blog.url,
        }));
        await authToken.save();
        console.log(`Resynced and saved ${blogs.length} blogs.`);

        // Fetch current settings to re-render admin page
        const settings = await Settings.findOne({}) || {}; // Assuming single settings document
        const selectedBlogDetails = blogs.find(b => b.id === settings.selectedBlogId);

        res.render('admin', {
            pageTitle: 'Admin Dashboard',
            settings: settings,
            blogs: authToken.blogsList,
            selectedBlogDetails: selectedBlogDetails,
            message: 'Blogs re-synced successfully!',
            error: false,
            apiConfig: require('../config/apiConfig'),
            executionLogs: [] // Fetch logs
        });

    } catch (error) {
        console.error('Error resyncing blogs:', error);
        logExecution('FAILED', 'Resync Blogs', `Error resyncing blogs: ${error.message}`, null, { error: error.message, stack: error.stack });
        // Handle token expiry/invalidity
        if (error.message.includes('invalid_grant') || error.message.includes('invalid_request')) {
            return res.redirect('/auth/login'); // Prompt to re-authenticate
        }
        // Render admin page with error message
        const settings = await Settings.findOne({}) || {};
        const authToken = await AuthToken.findOne({ userId: 'currentUser' });
        const blogs = authToken ? authToken.blogsList : [];
        const selectedBlogDetails = blogs.find(b => b.id === settings.selectedBlogId);

        res.render('admin', {
            pageTitle: 'Admin Dashboard',
            settings: settings,
            blogs: blogs,
            selectedBlogDetails: selectedBlogDetails,
            message: `Failed to resync blogs: ${error.message}`,
            error: true,
            apiConfig: require('../config/apiConfig'),
            executionLogs: [] // Fetch logs
        });
    }
});


module.exports = router;