// config/googleAuth.js
require('dotenv').config();
const { google } = require('googleapis');
const googleAuthConfig = require('./googleAuthConfig');

const DEFAULT_CALLBACK_PATH = '/auth/callback';

const clean = (value) => (typeof value === 'string' ? value.trim().replace(/^['"]|['"]$/g, '') : '');

/**
 * Resolve Google OAuth credentials with the following priority:
 * 1. In-app saved config (from the Google Setup page) - highest priority
 * 2. Environment variables (e.g., Render dashboard)
 */
function resolveCredentials() {
    const inApp = googleAuthConfig.loadConfig();

    const clientId =
        clean(inApp && inApp.clientId) ||
        clean(process.env.GOOGLE_CLIENT_ID);

    const clientSecret =
        clean(inApp && inApp.clientSecret) ||
        clean(process.env.GOOGLE_CLIENT_SECRET);

    return { clientId: clientId, clientSecret: clientSecret };
}

/**
 * Resolve the callback URL with priority:
 * 1. In-app saved config (from the Google Setup page)
 * 2. Environment variable GOOGLE_CALLBACK_URL
 */
function resolveCallbackUrl() {
    const inApp = googleAuthConfig.loadConfig();
    return (
        clean(inApp && inApp.callbackUrl) ||
        clean(process.env.GOOGLE_CALLBACK_URL) ||
        null
    );
}

/**
 * Normalise whatever the operator put in GOOGLE_CALLBACK_URL / RENDER_EXTERNAL_URL
 * into a full, absolute redirect URI ending in the callback path.
 *
 *   https://app.onrender.com              -> https://app.onrender.com/auth/callback
 *   https://app.onrender.com/             -> https://app.onrender.com/auth/callback
 *   app.onrender.com/auth/callback        -> https://app.onrender.com/auth/callback
 *   https://app.onrender.com/auth/callback-> unchanged
 *
 * Returns null when the value is empty or unparseable, so callers can fall back.
 */
function normalizeRedirectUri(rawValue) {
    const raw = clean(rawValue);
    if (!raw) return null;

    // Reject obvious placeholders copied from .env.example
    if (/your-app-name|YOUR_|example\.com/i.test(raw)) return null;

    const withScheme = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;

    let url;
    try {
        url = new URL(withScheme);
    } catch (_) {
        return null;
    }

    if (!url.hostname) return null;

    // Google forbids query strings and fragments on redirect URIs.
    url.search = '';
    url.hash = '';

    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path === '' ? DEFAULT_CALLBACK_PATH : path;

    return url.toString();
}

/**
 * Build the redirect URI from the incoming request. This is the last-resort
 * fallback so the app still works when GOOGLE_CALLBACK_URL was never set -
 * it produces exactly the URL the browser is already talking to.
 */
function redirectUriFromRequest(req) {
    if (!req) return null;
    const host = (typeof req.get === 'function' && req.get('x-forwarded-host')) ||
        (typeof req.get === 'function' && req.get('host')) ||
        (req.headers && req.headers.host);
    if (!host) return null;

    const forwardedProto = (typeof req.get === 'function' && req.get('x-forwarded-proto')) || '';
    const proto = forwardedProto.split(',')[0].trim() ||
        req.protocol ||
        (/^localhost(:\d+)?$|^127\.0\.0\.1(:\d+)?$/.test(host) ? 'http' : 'https');

    return normalizeRedirectUri(proto + '://' + host + DEFAULT_CALLBACK_PATH);
}

/**
 * Resolve the redirect URI to use for this OAuth exchange.
 * Priority: in-app saved callback -> GOOGLE_CALLBACK_URL -> RENDER_EXTERNAL_URL -> current request host.
 */
function resolveRedirectUri(req) {
    return (
        normalizeRedirectUri(resolveCallbackUrl()) ||
        normalizeRedirectUri(process.env.RENDER_EXTERNAL_URL) ||
        redirectUriFromRequest(req) ||
        null
    );
}

/** Where the resolved value came from - used by the diagnostics page. */
function redirectUriSource(req) {
    const inApp = googleAuthConfig.loadConfig();
    if (inApp && inApp.callbackUrl && normalizeRedirectUri(inApp.callbackUrl)) return 'in-app saved (Google Setup page)';
    if (normalizeRedirectUri(process.env.GOOGLE_CALLBACK_URL)) return 'GOOGLE_CALLBACK_URL';
    if (normalizeRedirectUri(process.env.RENDER_EXTERNAL_URL)) return 'RENDER_EXTERNAL_URL';
    if (redirectUriFromRequest(req)) return 'request host (auto-detected)';
    return 'unresolved';
}

// Create the initial OAuth2 client. This may be updated later via refreshClient().
var oauth2Client = new google.auth.OAuth2(
    resolveCredentials().clientId,
    resolveCredentials().clientSecret,
    resolveRedirectUri() || undefined
);

// Scopes for Blogger API
const SCOPES = ['https://www.googleapis.com/auth/blogger'];

/**
 * Rebuild the OAuth2 client with fresh credentials from config/env.
 * Call this after the user saves new Google OAuth credentials in-app.
 */
function refreshClient() {
    const creds = resolveCredentials();
    oauth2Client = new google.auth.OAuth2(
        creds.clientId,
        creds.clientSecret,
        resolveRedirectUri() || undefined
    );
    // If we had set credentials (tokens) before, re-apply them
    // (tokens are stored in the database, not here, so this is safe)
    return oauth2Client;
}

/**
 * Report exactly what is missing/misconfigured instead of sending the user to a
 * broken Google consent screen (that is what produced
 * "Error 400: invalid_request - Missing required parameter: redirect_uri").
 *
 * This function dynamically resolves credentials at call time so that
 * in-app saved values are reflected immediately (no server restart needed).
 */
function getConfigStatus(req) {
    const creds = resolveCredentials();
    const redirectUri = resolveRedirectUri(req);
    const missing = [];
    if (!creds.clientId) missing.push('GOOGLE_CLIENT_ID');
    if (!creds.clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
    if (!redirectUri) missing.push('GOOGLE_CALLBACK_URL');

    return {
        clientIdSet: Boolean(creds.clientId),
        clientSecretSet: Boolean(creds.clientSecret),
        callbackUrlEnvSet: Boolean(normalizeRedirectUri(process.env.GOOGLE_CALLBACK_URL)),
        redirectUri: redirectUri,
        redirectUriSource: redirectUriSource(req),
        missing: missing,
        ready: missing.length === 0,
    };
}

// Log warnings at startup
(function checkStartupConfig() {
    const creds = resolveCredentials();
    if (!creds.clientId || !creds.clientSecret) {
        console.warn(
            'WARNING: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not fully configured. ' +
            'Google sign-in will fail until they are set. ' +
            'You can enter them via the in-app Google Setup page (/auth/google-setup) or via environment variables.'
        );
    }
    if (!normalizeRedirectUri(resolveCallbackUrl()) && !normalizeRedirectUri(process.env.RENDER_EXTERNAL_URL)) {
        console.warn(
            'WARNING: GOOGLE_CALLBACK_URL is not set (or is still a placeholder). ' +
            'The redirect URI will be auto-detected from the incoming request. ' +
            'Make sure the exact URL is registered in Google Cloud Console / Credentials / Authorised redirect URIs.'
        );
    }
})();

const googleAuth = {
    get oauth2Client() { return oauth2Client; },
    SCOPES: SCOPES,
    DEFAULT_CALLBACK_PATH: DEFAULT_CALLBACK_PATH,
    normalizeRedirectUri: normalizeRedirectUri,
    resolveRedirectUri: resolveRedirectUri,
    getConfigStatus: getConfigStatus,
    refreshClient: refreshClient,

    /**
     * Build the Google consent URL.
     * @param {import('express').Request} req used to auto-detect the redirect URI.
     * @param {{state?: string}} options
     */
    generateAuthUrl: (req, options) => {
        if (!options) options = {};
        const status = getConfigStatus(req);
        if (!status.ready) {
            const err = new Error(
                'Google OAuth is not configured. Missing: ' + status.missing.join(', ') + '.'
            );
            err.code = 'GOOGLE_OAUTH_NOT_CONFIGURED';
            err.status = status;
            throw err;
        }

        // Keep the shared client in sync so the token exchange uses the same URI.
        // Also ensure client credentials are current.
        const creds = resolveCredentials();
        oauth2Client._clientId = creds.clientId;
        oauth2Client._clientSecret = creds.clientSecret;
        oauth2Client.redirectUri = status.redirectUri;

        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            include_granted_scopes: true,
            scope: SCOPES,
            redirect_uri: status.redirectUri,
            state: options.state
        });
    },

    /**
     * Exchange the authorization code for tokens.
     * The redirect_uri MUST be byte-identical to the one used for the consent URL.
     */
    getToken: async (code, req) => {
        const status = getConfigStatus(req);
        if (!status.ready) {
            const err = new Error(
                'Google OAuth is not configured. Missing: ' + status.missing.join(', ') + '.'
            );
            err.code = 'GOOGLE_OAUTH_NOT_CONFIGURED';
            err.status = status;
            throw err;
        }

        try {
            // Sync credentials before token exchange
            const creds = resolveCredentials();
            oauth2Client._clientId = creds.clientId;
            oauth2Client._clientSecret = creds.clientSecret;
            oauth2Client.redirectUri = status.redirectUri;

            const { tokens } = await oauth2Client.getToken({
                code: code,
                redirect_uri: status.redirectUri,
            });
            // Update tokens to the client so subsequent API calls are authorized
            oauth2Client.setCredentials(tokens);
            return tokens;
        } catch (error) {
            console.error('Error getting Google OAuth tokens:', error.message);
            throw error;
        }
    },

    setCredentials: function(tokens) {
        oauth2Client.setCredentials(tokens);
    },

    getCredentials: function() {
        return oauth2Client.credentials;
    },
};

module.exports = googleAuth;