// services/apiKeyService.js
const { ApiKey } = require('../db');
const { logExecution, sendTelegramAlert } = require('./apiService');

async function getAllKeys(provider = null) {
    try {
        const filter = provider ? { provider } : {};
        return await ApiKey.find(filter).sort({ createdAt: -1 });
    } catch (error) {
        console.error('ApiKeyService: Error fetching keys:', error);
        await logExecution('FAILED', 'Fetch API Keys', error.message);
        throw error;
    }
}

async function getActiveKeys(provider) {
    try {
        return await ApiKey.find({ provider, isActive: true }).sort({ usageCount: 1, lastUsed: 1 });
    } catch (error) {
        console.error('ApiKeyService: Error fetching active keys:', error);
        await logExecution('FAILED', 'Fetch Active API Keys', error.message);
        throw error;
    }
}

async function getNextAvailableKey(provider) {
    try {
        // Get active keys sorted by usage count ascending, then last used ascending
        const keys = await ApiKey.find({ provider, isActive: true })
            .sort({ usageCount: 1, lastUsed: 1 });

        if (keys.length === 0) {
            throw new Error(`No active API keys found for provider: ${provider}`);
        }

        // Pick the least-used key
        const selectedKey = keys[0];

        // Update usage stats
        selectedKey.usageCount += 1;
        selectedKey.lastUsed = new Date();
        await selectedKey.save();

        console.log(`ApiKeyService: Selected key "${selectedKey.label}" (usage: ${selectedKey.usageCount})`);
        return selectedKey;
    } catch (error) {
        console.error('ApiKeyService: Error getting next available key:', error);
        await logExecution('FAILED', 'Get Next API Key', error.message);
        throw error;
    }
}

async function addKey(provider, key, label = '') {
    try {
        if (!provider || !key) {
            throw new Error('Provider and key are required.');
        }

        const validProviders = ['grok', 'gemini'];
        if (!validProviders.includes(provider.toLowerCase())) {
            throw new Error(`Invalid provider. Must be one of: ${validProviders.join(', ')}`);
        }

        const existing = await ApiKey.findOne({ provider: provider.toLowerCase(), key });
        if (existing) {
            throw new Error('This API key already exists for the given provider.');
        }

        const newKey = new ApiKey({
            provider: provider.toLowerCase(),
            key,
            label: label || `${provider} Key ${Date.now()}`,
            isActive: true,
            usageCount: 0,
            lastUsed: null,
        });

        await newKey.save();
        await logExecution('SUCCESS', 'Add API Key', `Added ${provider} key: ${newKey.label}`);
        return newKey;
    } catch (error) {
        console.error('ApiKeyService: Error adding key:', error);
        await logExecution('FAILED', 'Add API Key', error.message);
        throw error;
    }
}

async function removeKey(keyId) {
    try {
        const key = await ApiKey.findByIdAndDelete(keyId);
        if (!key) {
            throw new Error('API Key not found.');
        }
        await logExecution('SUCCESS', 'Remove API Key', `Removed ${key.provider} key: ${key.label}`);
        return key;
    } catch (error) {
        console.error('ApiKeyService: Error removing key:', error);
        await logExecution('FAILED', 'Remove API Key', error.message);
        throw error;
    }
}

async function toggleKeyStatus(keyId) {
    try {
        const key = await ApiKey.findById(keyId);
        if (!key) {
            throw new Error('API Key not found.');
        }
        key.isActive = !key.isActive;
        await key.save();
        await logExecution('SUCCESS', 'Toggle API Key', `${key.isActive ? 'Activated' : 'Deactivated'} ${key.provider} key: ${key.label}`);
        return key;
    } catch (error) {
        console.error('ApiKeyService: Error toggling key status:', error);
        await logExecution('FAILED', 'Toggle API Key', error.message);
        throw error;
    }
}

async function updateKeyLabel(keyId, label) {
    try {
        const key = await ApiKey.findById(keyId);
        if (!key) {
            throw new Error('API Key not found.');
        }
        key.label = label;
        await key.save();
        await logExecution('SUCCESS', 'Update API Key Label', `Updated label for ${key.provider} key to: ${label}`);
        return key;
    } catch (error) {
        console.error('ApiKeyService: Error updating key label:', error);
        await logExecution('FAILED', 'Update API Key Label', error.message);
        throw error;
    }
}

// Temporarily deactivate a key that hit a provider rate limit so rotation
// picks a different one on the next run.
async function toggleKeyStatusForRateLimit(provider, keyValue) {
    try {
        const key = await ApiKey.findOne({ provider, key: keyValue });
        if (!key) return null;
        key.isActive = false;
        await key.save();
        await logExecution('SUCCESS', 'Rate Limit Key Rotation', `Deactivated rate-limited ${provider} key: ${key.label}`);
        return key;
    } catch (error) {
        console.error('ApiKeyService: Error handling rate-limited key:', error);
        return null;
    }
}

async function getKeyCountByProvider() {
    try {
        const grokKeys = await ApiKey.countDocuments({ provider: 'grok', isActive: true });
        const geminiKeys = await ApiKey.countDocuments({ provider: 'gemini', isActive: true });
        return { grok: grokKeys, gemini: geminiKeys };
    } catch (error) {
        console.error('ApiKeyService: Error counting keys:', error);
        return { grok: 0, gemini: 0 };
    }
}

module.exports = {
    getAllKeys,
    getActiveKeys,
    getNextAvailableKey,
    addKey,
    removeKey,
    toggleKeyStatus,
    updateKeyLabel,
    toggleKeyStatusForRateLimit,
    getKeyCountByProvider,
};