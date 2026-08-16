// config/googleAuth.js
require('dotenv').config();
const { google } = require('googleapis');

const DEFAULT_CALLBACK_PATH = '/auth/callback';

const clean = (value) => (typeof value === 'string' ? value.trim().replace(/^['"]|['"]$/g, '') : '');

const GOOGLE_CLIENT_ID = clean(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_SECRET = clean(process.env.GOOGLE_CLIENT_SECRET);

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

    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

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
 * fallback so the app still works when GOOGLE_CALLBACK_URL was never set —
 * it produces exactly the URL the browser is already talking to.
 */
function redirectUriFromRequest(req) {
    if (!req) return null;
    const host = (typeof req.get === 'function' && req.get('x-forwarded-host')) ||
        (typeof req.get === 'function' && req.get('host')) ||
        req.headers?.host;
    if (!host) return null;

    const forwardedProto = (typeof req.get === 'function' && req.get('x-forwarded-proto')) || '';
    const proto = forwardedProto.split(',')[0].trim() ||
        req.protocol ||
        (/^localhost(:\d+)?$|^127\.0\.0\.1(:\d+)?$/.test(host) ? 'http' : 'https');

    return normalizeRedirectUri(`${proto}://${host}${DEFAULT_CALLBACK_PATH}`);
}

/**
 * Resolve the redirect URI to use for this OAuth exchange.
 * Priority: GOOGLE_CALLBACK_URL -> RENDER_EXTERNAL_URL -> current request host.
 */
function resolveRedirectUri(req) {
    return (
        normalizeRedirectUri(process.env.GOOGLE_CALLBACK_URL) ||
        normalizeRedirectUri(process.env.RENDER_EXTERNAL_URL) ||
        redirectUriFromRequest(req) ||
        null
    );
}

/** Where the resolved value came from — used by the diagnostics page. */
function redirectUriSource(req) {
    if (normalizeRedirectUri(process.env.GOOGLE_CALLBACK_URL)) return 'GOOGLE_CALLBACK_URL';
    if (normalizeRedirectUri(process.env.RENDER_EXTERNAL_URL)) return 'RENDER_EXTERNAL_URL';
    if (redirectUriFromRequest(req)) return 'request host (auto-detected)';
    return 'unresolved';
}

const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    resolveRedirectUri() || undefined
);

// Scopes for Blogger API
const SCOPES = ['https://www.googleapis.com/auth/blogger'];

/**
 * Report exactly what is missing/misconfigured instead of sending the user to a
 * broken Google consent screen (that is what produced
 * "Error 400: invalid_request — Missing required parameter: redirect_uri").
 */
function getConfigStatus(req) {
    const redirectUri = resolveRedirectUri(req);
    const missing = [];
    if (!GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
    if (!GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
    if (!redirectUri) missing.push('GOOGLE_CALLBACK_URL');

    return {
        clientIdSet: Boolean(GOOGLE_CLIENT_ID),
        clientSecretSet: Boolean(GOOGLE_CLIENT_SECRET),
        callbackUrlEnvSet: Boolean(normalizeRedirectUri(process.env.GOOGLE_CALLBACK_URL)),
        redirectUri,
        redirectUriSource: redirectUriSource(req),
        missing,
        ready: missing.length === 0,
    };
}

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn(
        'WARNING: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not fully configured. ' +
        'Google sign-in will fail until they are set.'
    );
}
if (!normalizeRedirectUri(process.env.GOOGLE_CALLBACK_URL)) {
    console.warn(
        'WARNING: GOOGLE_CALLBACK_URL is not set (or is still a placeholder). ' +
        'The redirect URI will be auto-detected from RENDER_EXTERNAL_URL or the incoming request. ' +
        `Make sure the exact URL is registered in Google Cloud Console → Credentials → Authorised redirect URIs${
            normalizeRedirectUri(process.env.RENDER_EXTERNAL_URL)
                ? ` (currently: ${normalizeRedirectUri(process.env.RENDER_EXTERNAL_URL)})`
                : ''
        }.`
    );
}

const googleAuth = {
    oauth2Client,
    SCOPES,
    DEFAULT_CALLBACK_PATH,
    normalizeRedirectUri,
    resolveRedirectUri,
    getConfigStatus,

    /**
     * Build the Google consent URL.
     * @param {import('express').Request} [req] used to auto-detect the redirect URI.
     * @param {{state?: string}} [options]
     */
    generateAuthUrl: (req, options = {}) => {
        const status = getConfigStatus(req);
        if (!status.ready) {
            const err = new Error(
                `Google OAuth is not configured. Missing: ${status.missing.join(', ')}.`
            );
            err.code = 'GOOGLE_OAUTH_NOT_CONFIGURED';
            err.status = status;
            throw err;
        }

        // Keep the shared client in sync so the token exchange uses the same URI.
        oauth2Client.redirectUri = status.redirectUri;

        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            include_granted_scopes: true,
            scope: SCOPES,
            // Passed explicitly: googleapis omits nothing here, and an empty value
            // is what triggers Google's "Missing required parameter: redirect_uri".
            redirect_uri: status.redirectUri,
            ...options,
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
                `Google OAuth is not configured. Missing: ${status.missing.join(', ')}.`
            );
            err.code = 'GOOGLE_OAUTH_NOT_CONFIGURED';
            err.status = status;
            throw err;
        }

        try {
            oauth2Client.redirectUri = status.redirectUri;
            const { tokens } = await oauth2Client.getToken({
                code,
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

    setCredentials: (tokens) => {
        oauth2Client.setCredentials(tokens);
    },

    getCredentials: () => oauth2Client.credentials,
};

module.exports = googleAuth;
