// server.js
const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const methodOverride = require('method-override');
const morgan = require('morgan'); // For logging requests

// Load environment variables BEFORE any module that reads process.env
dotenv.config();

// Import database connection
const { connectDB, getDbStatus } = require('./db');

// Import routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');
const apiKeysRoutes = require('./routes/apiKeys');
const setupRoutes = require('./routes/setup');

// Import logging utility
const { logExecution } = require('./services/apiService');

// Scheduler (internal cron)
const { startScheduler } = require('./services/schedulerService');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // Render/containers require binding 0.0.0.0

// Middleware
app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded
app.use(methodOverride('_method')); // Allows using PUT, DELETE etc. in forms
app.use(morgan('dev')); // HTTP request logger middleware
app.set('view engine', 'ejs'); // Set EJS as templating engine
app.set('views', path.join(__dirname, 'views')); // Set views directory
app.set('trust proxy', 1); // Behind Render's proxy

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Health check — must answer even when MongoDB is unavailable
app.get('/healthz', (req, res) => {
    const db = getDbStatus();
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        dbState: db.state, // 1 = connected
        dbConnected: db.connected,
        mongodbUriSet: db.uriSet,
        dbError: db.lastError, // sanitized; null when connected or never failed
    });
});

// Routes
app.get('/', (req, res) => {
    res.redirect('/admin'); // Default to admin dashboard
});

app.use('/', setupRoutes); // /setup — reachable without the database
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);
app.use('/api-keys', apiKeysRoutes);

// Catch-all for 404 errors
app.use((req, res) => {
    const errorMsg = `404 - Not Found: ${req.originalUrl}`;
    console.error(errorMsg);
    logExecution('FAILED', 'Route Not Found', errorMsg, null, { path: req.originalUrl });
    res.status(404).send('Page Not Found.');
});

// Global error handler
app.use((err, req, res, next) => {
    const errorMsg = `Internal Server Error: ${err.message}`;
    console.error(errorMsg, err.stack);
    logExecution('FAILED', 'Global Error Handler', errorMsg, null, { stack: err.stack });
    res.status(err.status || 500).send(
        process.env.NODE_ENV === 'production' ? 'Internal Server Error.' : errorMsg
    );
});

// Never let an unexpected async error take the whole dyno down silently
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});

// Start the server first, then connect to the DB.
// Render marks a deploy live only once the port is bound, so binding must not
// depend on an external database being reachable.
const server = app.listen(PORT, HOST, async () => {
    console.log(`Server running on http://${HOST}:${PORT}`);

    try {
        await connectDB();
        await logExecution('SUCCESS', 'Server Start', `Server started on port ${PORT}`);
        startScheduler();
    } catch (err) {
        console.error('Startup completed with database errors:', err.message);
        console.error(
            'The app keeps retrying MongoDB in the background every 60s. ' +
            'Fix MONGODB_URI / Atlas network access and it will connect without a redeploy.'
        );
    }
});

// Graceful shutdown
['SIGTERM', 'SIGINT'].forEach((signal) => {
    process.on(signal, () => {
        console.log(`${signal} received. Shutting down gracefully...`);
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 10000).unref();
    });
});

module.exports = app;
