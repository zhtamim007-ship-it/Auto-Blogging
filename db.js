// db.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('FATAL ERROR: MONGODB_URI is not defined in .env file.');
    process.exit(1);
}

const connectDB = async () => {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('MongoDB Connected successfully.');
    } catch (err) {
        console.error('MongoDB Connection Error:', err.message);
        process.exit(1);
    }
};

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
    blogId: { type: String, required: true, index: true }
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