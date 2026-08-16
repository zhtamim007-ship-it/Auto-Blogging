// routes/setup.js
// In-app Database Setup — reachable WITHOUT the database so the connection
// string can be provided even when MongoDB is unreachable. Once the database
// is connected this page redirects to the admin dashboard.
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { getDbStatus, setMongoUri, clearMongoUri } = require('../db');

router.get('/setup', (req, res) => {
    if (mongoose.connection.readyState === 1) return res.redirect('/admin');
    res.render('db-setup', {
        pageTitle: 'Database Setup',
        db: getDbStatus(),
        message: req.query.message || null,
        error: req.query.error === 'true',
    });
});

router.post('/setup/save', async (req, res) => {
    const uri = (req.body.mongodbUri || '').trim();
    try {
        if (mongoose.connection.readyState === 1) return res.redirect('/admin');
        await setMongoUri(uri);
        res.redirect('/setup?message=' + encodeURIComponent('Connection string saved. Connecting to MongoDB…'));
    } catch (err) {
        res.redirect('/setup?error=true&message=' + encodeURIComponent(err.message));
    }
});

router.post('/setup/clear', async (req, res) => {
    try {
        await clearMongoUri();
        res.redirect('/setup?message=' + encodeURIComponent('Saved connection string removed.'));
    } catch (err) {
        res.redirect('/setup?error=true&message=' + encodeURIComponent(err.message));
    }
});

module.exports = router;
