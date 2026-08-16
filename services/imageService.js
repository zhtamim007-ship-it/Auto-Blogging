// services/imageService.js
const axios = require('axios');
const apiConfig = require('../config/apiConfig');
const { makeApiRequest, logExecution, sendTelegramAlert } = require('./apiService');

async function fetchFeaturedImage(articleTitle) {
    const { unsplashApiKey, unsplashApiUrl, fallbackImageQuery } = apiConfig.image;

    if (!unsplashApiKey) {
        const errorMsg = 'Unsplash API Key not configured. Cannot fetch featured image.';
        console.error(errorMsg);
        await logExecution('FAILED', 'Image API Config', errorMsg);
        await sendTelegramAlert(`🚨 *Image API Configuration Error* \n\nMessage: ${errorMsg}`);
        return null; // Return null if API key is missing
    }

    // Use article title for search query, sanitize it
    const query = articleTitle.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 50); // Basic sanitization

    try {
        console.log(`Fetching featured image for article: "${articleTitle}"`);
        const response = await makeApiRequest({
            method: 'GET',
            url: unsplashApiUrl,
            queryParams: {
                query: query || fallbackImageQuery,
                per_page: 1,
                client_id: unsplashApiKey, // Unsplash uses client_id
            },
            headers: {
                // Unsplash uses Client-ID in headers for authentication as well, but query param is common.
                // 'Authorization': `Client-ID ${unsplashApiKey}`,
            },
            apiName: 'Image', // Use a generic name for logging
            action: 'Fetch Featured Image',
            logSuccess: true,
        });

        if (response && response.results && response.results.length > 0 && response.results[0].urls) {
            const imageUrl = response.results[0].urls.regular; // 'regular' provides a good resolution
            console.log(`Featured image fetched: ${imageUrl}`);
            // Return an HTML img tag for easy injection
            return `<img src="${imageUrl}" alt="${articleTitle} featured image" style="width:100%; max-width:600px; height:auto; margin-bottom: 20px;">`;
        } else {
            console.warn(`No image found for query "${query}". Falling back to default.`);
            // Attempt to fetch a fallback image if the primary search fails
            return await fetchFallbackImage(fallbackImageQuery);
        }
    } catch (error) {
        console.error('ImageService: Failed to fetch featured image:', error);
        await logExecution('FAILED', 'Image Fetch', `Failed to fetch featured image for "${articleTitle}": ${error.message}`, null, { query: query, error: error.message, stack: error.stack });
        // sendTelegramAlert is handled by makeApiRequest
        // Fallback to default image if primary fails
        return await fetchFallbackImage(fallbackImageQuery);
    }
}

// Fetch a fallback image if primary fetch fails
async function fetchFallbackImage(query = 'abstract background') {
    const { unsplashApiKey, unsplashApiUrl } = apiConfig.image;
     if (!unsplashApiKey) {
        console.warn('Unsplash API Key not configured. Cannot fetch fallback image.');
        return null;
    }
    try {
        console.log(`Fetching fallback image with query: "${query}"`);
        const response = await makeApiRequest({
            method: 'GET',
            url: unsplashApiUrl,
            queryParams: {
                query: query,
                per_page: 1,
                client_id: unsplashApiKey,
            },
            apiName: 'Image',
            action: 'Fetch Fallback Image',
            logSuccess: false, // Avoid logging every fallback image fetch
        });

        if (response && response.results && response.results.length > 0 && response.results[0].urls) {
            const imageUrl = response.results[0].urls.regular;
            console.log(`Fallback image fetched: ${imageUrl}`);
            return `<img src="${imageUrl}" alt="Default featured image" style="width:100%; max-width:600px; height:auto; margin-bottom: 20px;">`;
        } else {
            console.warn('Could not fetch a fallback image.');
            return null;
        }
    } catch (error) {
        console.error('ImageService: Failed to fetch fallback image:', error);
        await logExecution('FAILED', 'Image Fetch (Fallback)', `Failed to fetch fallback image: ${error.message}`, null, { query: query, error: error.message, stack: error.stack });
        return null;
    }
}

module.exports = {
    fetchFeaturedImage,
};