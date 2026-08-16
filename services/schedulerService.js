// services/schedulerService.js
// Internal cron scheduler. Runs the autonomous pipeline according to the
// `frequencyHours` value stored in Settings, without needing an external cron.
const cron = require('node-cron');
const { google } = require('googleapis');
const { Settings, AuthToken, ExecutionLog } = require('../db');
const googleAuth = require('../config/googleAuth');
const pipelineService = require('./pipelineService');
const { logExecution, isTokenExpiring } = require('./apiService');

let task = null;
let running = false;

async function isDue(frequencyHours) {
    const lastRun = await ExecutionLog.findOne({ action: 'Pipeline Execution', status: 'SUCCESS' })
        .sort({ timestamp: -1 })
        .lean();

    if (!lastRun) return true; // Never ran before
    const elapsedHours = (Date.now() - new Date(lastRun.timestamp).getTime()) / 36e5;
    return elapsedHours >= frequencyHours;
}

async function runIfDue() {
    if (running) {
        console.log('Scheduler: previous run still in progress, skipping tick.');
        return;
    }

    running = true;
    try {
        const settings = await Settings.findOne({});
        if (!settings || !settings.selectedBlogId) {
            return; // Not configured yet — stay quiet, the dashboard shows the state.
        }

        const frequencyHours = settings.frequencyHours || 24;
        if (!(await isDue(frequencyHours))) return;

        const authToken = await AuthToken.findOne({ userId: 'currentUser' });
        if (!authToken) {
            await logExecution('FAILED', 'Scheduled Pipeline', 'No Google auth token found. Please connect an account.');
            return;
        }

        googleAuth.setCredentials({
            access_token: authToken.accessToken,
            refresh_token: authToken.refreshToken,
            expiry_date: new Date(authToken.tokenExpiry).getTime(),
        });

        if (isTokenExpiring(googleAuth.oauth2Client)) {
            const { credentials } = await googleAuth.oauth2Client.refreshAccessToken();
            authToken.accessToken = credentials.access_token;
            if (credentials.refresh_token) authToken.refreshToken = credentials.refresh_token;
            authToken.tokenExpiry = new Date(credentials.expiry_date);
            await authToken.save();
            googleAuth.setCredentials(credentials);
        }

        const blogger = google.blogger({ version: 'v3', auth: googleAuth.oauth2Client });

        console.log('Scheduler: running autonomous pipeline...');
        await pipelineService.runPipeline(settings, {}, blogger);
    } catch (error) {
        console.error('Scheduler: pipeline run failed:', error.message);
        // pipelineService already logs the failure details.
    } finally {
        running = false;
    }
}

function startScheduler() {
    if (process.env.DISABLE_SCHEDULER === 'true') {
        console.log('Scheduler disabled via DISABLE_SCHEDULER=true.');
        return null;
    }
    if (task) return task;

    // Tick hourly; runIfDue() decides whether the configured interval elapsed.
    task = cron.schedule('0 * * * *', runIfDue, { scheduled: true });
    console.log('Scheduler started (hourly check against frequencyHours setting).');
    return task;
}

function stopScheduler() {
    if (task) {
        task.stop();
        task = null;
    }
}

module.exports = { startScheduler, stopScheduler, runIfDue };
