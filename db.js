// db.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

let connectionPromise = null;

const connectDB = async () => {
    if (!MONGODB_URI) {
        // Do not kill the process: the HTTP server must stay up so the platform
        // health check passes and the misconfiguration is visible in the logs.
        const msg = 'MONGODB_URI is not defined. Set it in your environment variables.';
        console.error(`CONFIG ERROR: ${msg}`);
        throw new Error(msg);
    }

    if (connectionPromise) return connectionPromise;

    mongoose.set('strictQuery', true);

    connectionPromise = mongoose
        .connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
        })
        .then((conn) => {
            console.log('MongoDB Connected successfully.');
            return conn;
        })
        .catch((err) => {
            connectionPromise = null;
            console.error('MongoDB Connection Error:', err.message);
            throw err;
        });

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
    Settings,
    AuthToken,
    ExecutionLog,
    ArticleIndex,
    ApiKey,
};