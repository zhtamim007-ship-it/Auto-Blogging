// utils/settingsUtils.js
// This file might contain utility functions related to managing settings,
// like fetching them, validating them, or applying defaults.
// For now, it's a placeholder.

async function getDefaultSettings() {
    // This function would return a default settings object if no settings are found in DB.
    // However, the db.js schema already defines defaults.
    // If you need a function to initialize settings if they don't exist, it would go here.
    return {
        selectedBlogId: null,
        category: 'Technology',
        frequencyHours: 24,
        postLength: 'medium',
        language: 'English',
        publishingMode: 'Draft',
        writingTone: 'Professional',
        seoKeywords: [],
        ppcTargetLinks: [],
    };
}

module.exports = {
    getDefaultSettings,
};