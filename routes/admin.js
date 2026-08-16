// routes/admin.js
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { Settings, AuthToken, ExecutionLog, getDbStatus } = require('../db');
const googleAuth = require('../config/googleAuth');
const { google } = require('googleapis');
const apiConfig = require('../config/apiConfig');
const { logExecution } = require('../services/apiService');
const pipelineService = require('../services/pipelineService');
const apiKeyService = require('../services/apiKeyService');
const { isTokenExpiring } = require('../services/apiService');

// Normalises the settings document so EJS never blows up on undefined arrays.
const DEFAULT_SETTINGS = {
    selectedBlogId: null,
    category: 'Technology',
    frequencyHours: 24,
    postLength: 'medium',
    language: 'English',
    publishingMode: 'Draft',
    writingTone: 'Professional',
    seoKeywords: [],
    ppcTargetLinks: [],
    preferredAiProvider: 'grok',
    autoRotateKeys: true,
};

function withDefaults(settings) {
    const plain = settings && typeof settings.toObject === 'function' ? settings.toObject() : (settings || {});
    return {
        ...DEFAULT_SETTINGS,
        ...plain,
        seoKeywords: Array.isArray(plain.seoKeywords) ? plain.seoKeywords : [],
        ppcTargetLinks: Array.isArray(plain.ppcTargetLinks) ? plain.ppcTargetLinks : [],
    };
}

const isAuthenticated = async (req, res, next) => {
    // Fail fast (and readably) when the database is unreachable instead of
    // letting every query hang on Mongoose's 10s command buffer.
    if (mongoose.connection.readyState !== 1) {
        const db = getDbStatus();
        let hint;
        if (!db.uriSet) {
            hint =
                'No connection string is configured. Paste your MongoDB Atlas connection string on the in-app Database Setup page (https://' +
                req.get('host') +
                '/setup), or set MONGODB_URI in the Render dashboard (Service → Environment).';
        } else if (db.lastError) {
            hint =
                `Last MongoDB error: ${db.lastError}. ` +
                'Check that the connection string credentials are correct and that this host is allowed in your MongoDB Atlas network access list (add 0.0.0.0/0 to allow any host). ' +
                'You can update the connection string on the Database Setup page (/setup). ' +
                'The app keeps retrying automatically — no redeploy needed once it is fixed.';
        } else {
            hint = 'MongoDB is still connecting — the app retries automatically.';
        }
        return res.status(503).send(`Database unavailable. ${hint}`);
    }

    try {
        const authToken = await AuthToken.findOne({ userId: 'currentUser' });
        if (!authToken) return res.redirect('/auth/login');
        googleAuth.setCredentials({
            access_token: authToken.accessToken,
            refresh_token: authToken.refreshToken,
            expiry_date: new Date(authToken.tokenExpiry).getTime(),
        });
        if (isTokenExpiring(googleAuth.oauth2Client)) {
            const { credentials } = await googleAuth.oauth2Client.refreshAccessToken();
            authToken.accessToken = credentials.access_token;
            if (credentials.refresh_token) authToken.refreshToken = credentials.refresh_token;
            authToken.tokenExpiry = new Date(credentials.expiry_date);
            await authToken.save();
            googleAuth.setCredentials(credentials);
        }
        req.blogger = google.blogger({ version: 'v3', auth: googleAuth.oauth2Client });
        const settings = withDefaults(await Settings.findOne({}));
        if (!settings.selectedBlogId && !req.path.includes('/auth')) {
            return res.render('select-blog', { message: 'Select a blog.', error: true, blogs: authToken.blogsList || [], settings });
        }
        req.settings = settings;
        req.blogs = authToken.blogsList || [];
        req.selectedBlogDetails = req.blogs.find(b => b.id === settings.selectedBlogId);
        next();
    } catch (error) {
        console.error('Auth middleware:', error.message);
        logExecution('FAILED', 'Auth Middleware', error.message);
        if (error.message.includes('invalid_grant')) {
            await AuthToken.deleteOne({ userId: 'currentUser' });
            return res.redirect('/auth/login');
        }
        res.status(500).send('Auth error.');
    }
};

router.get('/', isAuthenticated, async (req, res) => {
    try {
        const logs = await ExecutionLog.find().sort({ timestamp: -1 }).limit(50);
        const apiKeys = await apiKeyService.getAllKeys();
        const keyCounts = await apiKeyService.getKeyCountByProvider();
        res.render('admin', {
            pageTitle: 'Admin Dashboard',
            settings: req.settings,
            blogs: req.blogs,
            selectedBlogDetails: req.selectedBlogDetails,
            message: req.query.message || null,
            error: req.query.error === 'true',
            blogSelectionMessage: null,
            apiConfig,
            executionLogs: logs,
            apiKeys,
            keyCounts,
        });
    } catch (error) {
        console.error('Admin render:', error);
        res.status(500).send('Error loading dashboard.');
    }
});

// Backwards-compatible alias: the canonical implementation lives in /auth.
router.post('/resync-blogs', (req, res) => res.redirect(307, '/auth/resync-blogs'));

router.put('/save-settings', isAuthenticated, async (req, res) => {
    const { selectedBlogId, category, frequencyHours, postLength, language, publishingMode, writingTone, seoKeywords, ppcTargetLinks, preferredAiProvider, autoRotateKeys } = req.body;
    try {
        let settings = await Settings.findOne({});
        if (!settings) settings = new Settings();
        if (selectedBlogId) settings.selectedBlogId = selectedBlogId;
        if (category) settings.category = category;
        if (frequencyHours) settings.frequencyHours = parseInt(frequencyHours, 10);
        if (postLength) settings.postLength = postLength;
        if (language) settings.language = language;
        if (publishingMode) settings.publishingMode = publishingMode;
        if (writingTone) settings.writingTone = writingTone;
        if (preferredAiProvider) settings.preferredAiProvider = preferredAiProvider;
        settings.autoRotateKeys = autoRotateKeys === 'on' || autoRotateKeys === true;
        if (seoKeywords) settings.seoKeywords = seoKeywords.split(',').map(k => k.trim()).filter(Boolean);
        if (ppcTargetLinks) settings.ppcTargetLinks = ppcTargetLinks.split('\n').map(l => l.trim()).filter(Boolean);
        await settings.save();
        logExecution('SUCCESS', 'Save Settings', null, null, { saved: true });
        res.redirect('/admin?message=' + encodeURIComponent('Settings saved!'));
    } catch (error) {
        console.error('Save settings:', error);
        res.redirect('/admin?error=true&message=' + encodeURIComponent(error.message));
    }
});

router.post('/save-blog', isAuthenticated, async (req, res) => {
    const { blogId } = req.body;
    if (!blogId) return res.status(400).render('select-blog', { message: 'Blog ID required.', error: true, blogs: req.blogs, settings: req.settings });
    try {
        let settings = await Settings.findOne({});
        if (!settings) settings = new Settings();
        settings.selectedBlogId = blogId;
        await settings.save();
        logExecution('SUCCESS', 'Select Blog', null, null, { blogId });
        res.redirect('/admin?message=' + encodeURIComponent('Blog selected!'));
    } catch (error) {
        res.redirect('/admin?error=true&message=' + encodeURIComponent(error.message));
    }
});

router.post('/trigger-pipeline', isAuthenticated, async (req, res) => {
    try {
        if (!req.blogger) throw new Error('Blogger client not initialized.');
        const settings = await Settings.findOne({});
        if (!settings?.selectedBlogId) throw new Error('No blog selected.');
        await pipelineService.runPipeline(settings, {}, req.blogger);
        res.redirect('/admin?message=' + encodeURIComponent('Pipeline executed!'));
    } catch (error) {
        console.error('Pipeline trigger:', error.message);
        logExecution('FAILED', 'Manual Pipeline', error.message);
        res.redirect('/admin?error=true&message=' + encodeURIComponent(error.message));
    }
});

module.exports = router;