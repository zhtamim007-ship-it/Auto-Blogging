// db.js
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

// Connection string precedence: in-app saved config (most recent explicit
// user action) -> MONGODB_URI environment variable -> not set.
const DB_CONFIG_FILE = path.join(__dirname, 'data', 'db-config.json');

function loadUriFromFile() {
    try {
        const parsed = JSON.parse(fs.readFileSync(DB_CONFIG_FILE, 'utf8'));
        if (parsed && typeof parsed.mongodbUri === 'string' && parsed.mongodbUri.trim()) {
            return parsed.mongodbUri.trim();
        }
    } catch (err) {
        // No file yet — first run.
    }
    return null;
}

function saveUriToFile(uri) {
    try {
        fs.mkdirSync(path.dirname(DB_CONFIG_FILE), { recursive: true });
        fs.writeFileSync(DB_CONFIG_FILE, JSON.stringify({ mongodbUri: uri }, null, 2), 'utf8');
        console.log('Database connection string saved to local config file (not committed to git).');
    } catch (err) {
        console.error('Could not persist database config file:', err.message);
    }
}

function deleteUriFile() {
    try {
        fs.unlinkSync(DB_CONFIG_FILE);
    } catch (err) {
        // Nothing to remove.
    }
}

let MONGODB_URI = loadUriFromFile() || process.env.MONGODB_URI || null;

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

// Mask the credentials portion of a connection string for display.
// "mongodb+srv://user:pw@host/db" -> "mongodb+srv://user:***@host/db"
function maskUri(uri) {
    if (typeof uri !== 'string' || !uri) return null;
    return uri.replace(
        /^(mongodb(\+srv)?:\/\/)([^:@/]+)(?::([^@/]+))?@/i,
        (m, scheme, srv, user, pass) => (pass !== undefined ? `${scheme}${user}:***@` : `${scheme}***@`)
    );
}

// Current database status, safe to expose (no credentials, no URI).
const getDbStatus = () => {
    const envUri = process.env.MONGODB_URI || null;
    return {
        state: mongoose.connection.readyState, // 0 disconnected, 1 connected, 2 connecting, 3 disconnecting
        connected: mongoose.connection.readyState === 1,
        uriSet: Boolean(MONGODB_URI),
        uriSource: MONGODB_URI ? (envUri && MONGODB_URI === envUri ? 'env' : 'in-app') : 'none',
        uriMasked: maskUri(MONGODB_URI),
        lastError: lastConnectionError ? sanitizeErrorMessage(lastConnectionError.message) : null,
    };
};

// Set the connection string from the in-app Database Setup page. Persists it
// to a local file, aborts any in-flight connection, and kicks off a fresh
// connect (with the automatic retry loop) in the background.
const setMongoUri = async (uri) => {
    const trimmed = (uri || '').trim();
    if (!trimmed) throw new Error('Connection string is required.');
    if (!/^mongodb(\+srv)?:\/\//i.test(trimmed)) {
        throw new Error('Invalid connection string — it must start with mongodb:// or mongodb+srv://');
    }

    // Let any in-flight connect attempt settle first so two connects never race.
    if (connectionPromise) {
        try { await connectionPromise; } catch (err) { /* failed attempt — expected */ }
        connectionPromise = null;
    }
    try {
        if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    } catch (err) {
        console.error('Error disconnecting before reconnect:', err.message);
    }

    MONGODB_URI = trimmed;
    lastConnectionError = null;
    saveUriToFile(trimmed);

    if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
    // Fire-and-forget: returns immediately, connection proceeds in background
    // and the retry loop keeps trying until it succeeds.
    connectDB().catch((err) => {
        console.error('Background reconnect using saved connection string failed:', sanitizeErrorMessage(err.message));
    });
};

// Remove the in-app saved connection string and fall back to MONGODB_URI.
const clearMongoUri = async () => {
    if (connectionPromise) {
        try { await connectionPromise; } catch (err) { /* expected */ }
        connectionPromise = null;
    }
    deleteUriFile();
    MONGODB_URI = process.env.MONGODB_URI || null;
    lastConnectionError = null;
    if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
    console.log('In-app database connection string cleared.');
};

const attemptConnect = async () => {
    if (mongoose.connection.readyState === 1) return mongoose.connection;

    if (!MONGODB_URI) {
        // Do not kill the process: the HTTP server must stay up so the platform
        // health check passes and the misconfiguration is visible in the logs.
        const msg =
            'MONGODB_URI is not defined. Set it in your environment variables or paste your connection string on the in-app Database Setup page (/setup).';
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
    setMongoUri,
    clearMongoUri,
    Settings,
    AuthToken,
    ExecutionLog,
    ArticleIndex,
    ApiKey,
};