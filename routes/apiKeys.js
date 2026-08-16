// routes/apiKeys.js
const express = require('express');
const router = express.Router();
const apiKeyService = require('../services/apiKeyService');
const { logExecution } = require('../services/apiService');

// GET /api-keys — Fetch all keys (optionally filter by provider)
router.get('/', async (req, res) => {
    try {
        const { provider } = req.query;
        const keys = await apiKeyService.getAllKeys(provider || null);
        res.json({ success: true, keys });
    } catch (error) {
        console.error('Error fetching API keys:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api-keys/add — Add a new API key
router.post('/add', async (req, res) => {
    try {
        const { provider, key, label } = req.body;
        if (!provider || !key) {
            return res.status(400).json({ success: false, message: 'Provider and key are required.' });
        }

        const newKey = await apiKeyService.addKey(provider, key, label || '');

        if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
            return res.json({ success: true, key: newKey });
        }
        res.redirect('/admin');
    } catch (error) {
        console.error('Error adding API key:', error);
        if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
            return res.status(500).json({ success: false, message: error.message });
        }
        res.redirect('/admin?error=' + encodeURIComponent(error.message));
    }
});

// POST /api-keys/remove/:id — Remove an API key
router.post('/remove/:id', async (req, res) => {
    try {
        await apiKeyService.removeKey(req.params.id);
        if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
            return res.json({ success: true });
        }
        res.redirect('/admin');
    } catch (error) {
        console.error('Error removing API key:', error);
        if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
            return res.status(500).json({ success: false, message: error.message });
        }
        res.redirect('/admin?error=' + encodeURIComponent(error.message));
    }
});

// POST /api-keys/toggle/:id — Toggle active/inactive
router.post('/toggle/:id', async (req, res) => {
    try {
        const key = await apiKeyService.toggleKeyStatus(req.params.id);
        if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
            return res.json({ success: true, key });
        }
        res.redirect('/admin');
    } catch (error) {
        console.error('Error toggling API key:', error);
        if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
            return res.status(500).json({ success: false, message: error.message });
        }
        res.redirect('/admin?error=' + encodeURIComponent(error.message));
    }
});

// POST /api-keys/update-label/:id — Update label for a key
router.post('/update-label/:id', async (req, res) => {
    try {
        const { label } = req.body;
        if (!label) {
            return res.status(400).json({ success: false, message: 'Label is required.' });
        }
        const key = await apiKeyService.updateKeyLabel(req.params.id, label);
        if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
            return res.json({ success: true, key });
        }
        res.redirect('/admin');
    } catch (error) {
        console.error('Error updating API key label:', error);
        if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
            return res.status(500).json({ success: false, message: error.message });
        }
        res.redirect('/admin?error=' + encodeURIComponent(error.message));
    }
});

module.exports = router;