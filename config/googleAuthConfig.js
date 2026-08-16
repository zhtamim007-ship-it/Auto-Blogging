// config/googleAuthConfig.js
// File-based persistent store for Google OAuth credentials.
// Similar to how db.js stores the MongoDB URI in data/db-config.json.
// This allows users to enter credentials in-app rather than only via env vars.

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'google-auth-config.json');

/**
 * Load saved Google OAuth config from the local file.
 * Returns null if no saved config exists.
 */
function loadConfig() {
    try {
        const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object') {
            return {
                clientId: typeof parsed.clientId === 'string' ? parsed.clientId.trim() : '',
                clientSecret: typeof parsed.clientSecret === 'string' ? parsed.clientSecret.trim() : '',
                callbackUrl: typeof parsed.callbackUrl === 'string' ? parsed.callbackUrl.trim() : '',
            };
        }
    } catch (err) {
        // No file yet or parse error — first run or corrupted file.
    }
    return null;
}

/**
 * Save Google OAuth config to the local file.
 */
function saveConfig({ clientId, clientSecret, callbackUrl }) {
    try {
        fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
        fs.writeFileSync(
            CONFIG_FILE,
            JSON.stringify({ clientId, clientSecret, callbackUrl }, null, 2),
            'utf8'
        );
        console.log('Google OAuth credentials saved to local config file (not committed to git).');
    } catch (err) {
        console.error('Could not persist Google OAuth config file:', err.message);
    }
}

/**
 * Delete the saved config file.
 */
function deleteConfig() {
    try {
        fs.unlinkSync(CONFIG_FILE);
        console.log('Google OAuth saved credentials removed.');
    } catch (err) {
        // Nothing to remove.
    }
}

/**
 * Return the current status of the in-app Google OAuth config
 * (safe for display — values are masked).
 */
function getConfigStatus() {
    const cfg = loadConfig();
    return {
        hasInAppConfig: cfg !== null && (!!cfg.clientId || !!cfg.clientSecret || !!cfg.callbackUrl),
        clientIdSet: cfg !== null && !!cfg.clientId,
        clientSecretSet: cfg !== null && !!cfg.clientSecret,
        callbackUrlSet: cfg !== null && !!cfg.callbackUrl,
        clientIdMasked: cfg && cfg.clientId
            ? cfg.clientId.length > 8
                ? cfg.clientId.substring(0, 4) + '...' + cfg.clientId.substring(cfg.clientId.length - 4)
                : '****'
            : null,
        clientSecretMasked: cfg && cfg.clientSecret
            ? cfg.clientSecret.length > 8
                ? cfg.clientSecret.substring(0, 4) + '...' + cfg.clientSecret.substring(cfg.clientSecret.length - 4)
                : '****'
            : null,
        callbackUrlMasked: cfg && cfg.callbackUrl
            ? cfg.callbackUrl.replace(/^https?:\/\//, '***://')
            : null,
    };
}

module.exports = {
    loadConfig,
    saveConfig,
    deleteConfig,
    getConfigStatus,
};