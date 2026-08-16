// db.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

let connectionPromise = null;
let lastConnectionError = null;
let retryTimer = null;

// Number of fast retries attempted by connectDB() before falling back to the
// slow background loop (every 60s). Overridable for tests.
const MAX_INITIAL_RETRIES = Math.max(1, parseInt(process.env.MONGODB_INITIAL_RETRIES || '5', 10));
const INITIAL_RETRY_BASE_DELAY_MS = 2000; // doubles per attempt, capped at 30s
const MAX_INITIAL_RETRY_DELAY_MS = 30000;
const BACKGROUND_RETRY_INTERVAL_MS = 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Strip anything that looks like a password inside a connection string so
// error messages and logs never leak credentials.
function sanitizeErrorMessage(message) {
    if (typeof message !== 'string') return String(message || 'Unknown error');
    return message.replace(/(mongodb(\+srv)?:\/\/[^:@/]+:)[^@/]+(@)/gi, '$1***$3');
}

// Current database status, safe to expose (no credentials, no URI).
const getDbStatus = () => ({
    state: mongoose.connection.readyState, // 0 disconnected, 1 connected, 2 connecting, 3 disconnecting
    connected: mongoose.connection.readyState === 1,
    uriSet: Boolean(MONGODB_URI),
    lastError: lastConnectionError ? sanitizeErrorMessage(lastConnectionError.message) : null,
});

const attemptConnect = async () => {
    if (mongoose.connection.readyState === 1) return mongoose.connection;

    if (!MONGODB_URI) {
        // Do not kill the process: the HTTP server must stay up so the platform
        // health check passes and the misconfiguration is visible in the logs.
        const msg = 'MONGODB_URI is not defined. Set it in your environment variables.';
        console.error(`CONFIG ERROR: ${msg}`);
        lastConnectionError = new Error(msg);
        throw new Error(msg);
    }

    try {
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
        });
        lastConnectionError = null;
        console.log('MongoDB Connected successfully.');
        return mongoose.connection;
    } catch (err) {
        lastConnectionError = err;
        console.error('MongoDB Connection Error:', sanitizeErrorMessage(err.message));
        throw err;
    }
};

// Once the initial retries are exhausted (e.g. the URI was set or the Atlas
// network access list was fixed after deploy), keep trying in the background
// so the app recovers without a redeploy. Mongoose only auto-reconnects after
// a first successful connection, so this loop is what bridges that gap.
const scheduleBackgroundRetry = () => {
    if (retryTimer) return;
    if (!MONGODB_URI || mongoose.connection.readyState === 1) return;

    retryTimer = setInterval(async () => {
        if (mongoose.connection.readyState === 1) {
            clearInterval(retryTimer);
            retryTimer = null;
            return;
        }
        try {
            await attemptConnect();
            clearInterval(retryTimer);
            retryTimer = null;
        } catch (err) {
            console.warn(
                `MongoDB still unreachable, retrying every ${BACKGROUND_RETRY_INTERVAL_MS / 1000}s:`,
                sanitizeErrorMessage(err.message)
            );
        }
    }, BACKGROUND_RETRY_INTERVAL_MS);
    retryTimer.unref(); // never keep the process alive just for the retry loop
};

const connectDB = async () => {
    if (mongoose.connection.readyState === 1) return mongoose.connection;
    if (connectionPromise) return connectionPromise;

    connectionPromise = (async () => {
        for (let attempt = 1; attempt <= MAX_INITIAL_RETRIES; attempt++) {
            try {
                const conn = await attemptConnect();
                connectionPromise = null;
                return conn;
            } catch (err) {
                if (attempt < MAX_INITIAL_RETRIES) {
                    const delay = Math.min(
                        MAX_INITIAL_RETRY_DELAY_MS,
                        INITIAL_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
                    );
                    console.warn(`MongoDB retry ${attempt}/${MAX_INITIAL_RETRIES} in ${delay / 1000}s...`);
                    await sleep(delay);
                }
            }
        }
        connectionPromise = null;
        scheduleBackgroundRetry();
        throw lastConnectionError || new Error('MongoDB connection failed after retries.');
    })();

    return connectionPromise;
};

mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected. Mongoose will attempt to reconnect.');
});
mongoose.connection.on('error', (err) => {
    console.error('MongoDB runtime error:', err.message);
});

// --- Schemas Definition ---

// Settings Schema
const settingsSchema = new mongoose.Schema({
    selectedBlogId: { type: String, required: false, index: true },
    category: { type: String, required: false, default: 'Technology' },
    frequencyHours: { type: Number, required: false, default: 24 },
    postLength: { type: String, required: false, enum: ['short', 'medium', 'long'], default: 'medium' },
    language: { type: String, required: false, enum: ['English', 'Bangla'], default: 'English' },
    publishingMode: { type: String, required: false, enum: ['Direct', 'Draft'], default: 'Draft' },
    writingTone: { type: String, required: false, default: 'Professional' },
    seoKeywords: { type: [String], required: false, default: [] },
    ppcTargetLinks: { type: [String], required: false, default: [] },
    // Preferred AI provider for content generation
    preferredAiProvider: { type: String, required: false, enum: ['grok', 'gemini'], default: 'grok' },
    // Auto-rotate API keys across providers if multiple are available
    autoRotateKeys: { type: Boolean, required: false, default: true },
}, { timestamps: true });

// AuthToken Schema
const authTokenSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    tokenExpiry: { type: Date, required: true },
    blogsList: [{
        id: String,
        name: String,
        url: String,
    }],
}, { timestamps: true });

// ExecutionLog Schema
const executionLogSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    status: { type: String, required: true, enum: ['SUCCESS', 'FAILED'] },
    action: { type: String, required: true },
    errorMessage: { type: String, required: false },
    blogPostUrl: { type: String, required: false },
    details: { type: mongoose.Schema.Types.Mixed, required: false }
}, { timestamps: true });

// ArticleIndex Schema
const articleIndexSchema = new mongoose.Schema({
    title: { type: String, required: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    contentSummary: { type: String, required: true },
    tags: { type: [String], required: false, index: true },
    publishedAt: { type: Date, required: true, index: true },
    blogId: { type: String, required: true, index: true },
    postId: { type: String, required: false, index: true }
}, { timestamps: true });

// ApiKey Schema for managing multiple API keys per provider
const apiKeySchema = new mongoose.Schema({
    provider: {
        type: String,
        required: true,
        enum: ['grok', 'gemini'],
        index: true,
    },
    key: {
        type: String,
        required: true,
    },
    label: {
        type: String,
        default: 'My Key',
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    usageCount: {
        type: Number,
        default: 0,
    },
    lastUsed: {
        type: Date,
        default: null,
    },
}, { timestamps: true });

// --- Models ---
const Settings = mongoose.model('Settings', settingsSchema);
const AuthToken = mongoose.model('AuthToken', authTokenSchema);
const ExecutionLog = mongoose.model('ExecutionLog', executionLogSchema);
const ArticleIndex = mongoose.model('ArticleIndex', articleIndexSchema);
const ApiKey = mongoose.model('ApiKey', apiKeySchema);

module.exports = {
    connectDB,
    getDbStatus,
    Settings,
    AuthToken,
    ExecutionLog,
    ArticleIndex,
    ApiKey,
};