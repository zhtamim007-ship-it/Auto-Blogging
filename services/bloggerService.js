// services/bloggerService.js
const { google } = require('googleapis');
const { Settings, AuthToken, ArticleIndex } = require('../db');
const apiConfig = require('../config/apiConfig');
const { makeApiRequest, logExecution } = require('./apiService');
const { v4: uuidv4 } = require('uuid');

// Helper to get authenticated blogger client
async function getAuthenticatedBloggerClient() {
    try {
        let authToken = await AuthToken.findOne({ userId: 'currentUser' });
        if (!authToken) {
            throw new Error('No authentication token found. Please re-authenticate.');
        }

        const googleAuth = require('../config/googleAuth'); // Import dynamically to use setCredentials

        googleAuth.setCredentials({
            access_token: authToken.accessToken,
            refresh_token: authToken.refreshToken,
            expiry_date: (new Date(authToken.tokenExpiry)).getTime(),
        });

        // Refresh token if it's expiring soon
        if (googleAuth.oauth2Client.isTokenExpiring()) {
            console.log('BloggerService: Token is expiring, refreshing...');
            try {
                const { credentials } = await googleAuth.oauth2Client.refreshAccessToken();
                authToken.accessToken = credentials.access_token;
                authToken.refreshToken = credentials.refresh_token;
                authToken.tokenExpiry = new Date(credentials.expiry_date);
                await authToken.save();
                googleAuth.setCredentials(credentials);
                console.log('BloggerService: Token refreshed and updated.');
            } catch (refreshError) {
                console.error('BloggerService: Failed to refresh Google OAuth token:', refreshError.message);
                throw new Error(`Failed to refresh Google OAuth token: ${refreshError.message}`);
            }
        }

        const blogger = google.blogger({ version: 'v3', auth: googleAuth.oauth2Client });
        return blogger;
    } catch (error) {
        console.error('BloggerService: Error getting authenticated client:', error);
        await logExecution('FAILED', 'Blogger Auth Client', `Failed to get authenticated blogger client: ${error.message}`, null, { error: error.message, stack: error.stack });
        throw error;
    }
}


// Fetch user's blogs (used during auth callback and resync)
async function listUserBlogs() {
    try {
        const blogger = await getAuthenticatedBloggerClient();
        const response = await makeApiRequest({
            apiName: 'Blogger',
            action: 'List Blogs',
            method: 'GET',
            // googleapis library handles auth, so direct method call is fine
            // The makeApiRequest wrapper is more for external HTTP APIs
            // For googleapis, we might call directly and handle errors manually,
            // or wrap the specific googleapis call within makeApiRequest if it uses standard HTTP interfaces.
            // For now, direct call to googleapis method:
            requestFn: () => blogger.blogs.listByUser({ userId: 'me' }),
            logSuccess: false // Don't log every blog list, usually too verbose
        });
        return response.data.items || [];
    } catch (error) {
        console.error('BloggerService: Failed to list blogs:', error);
        await logExecution('FAILED', 'List Blogs', `Failed to list user blogs: ${error.message}`, null, { error: error.message, stack: error.stack });
        throw error;
    }
}

// Insert a new blog post
async function insertPost(settings, postContent, postId) {
    const { selectedBlogId } = settings;
    if (!selectedBlogId) {
        throw new Error('No blog selected. Cannot insert post.');
    }

    try {
        const blogger = await getAuthenticatedBloggerClient();
        
        const postData = {
            kind: 'blogger#post',
            blog: { id: selectedBlogId },
            title: postContent.title,
            content: postContent.htmlContent,
            labels: postContent.tags,
            publication: settings.publishingMode === 'Direct' ? 'PUBLISH' : 'DRAFT',
            // For featured image, Blogger API doesn't directly support adding featured image via post insert.
            // It's usually done manually or via JSON-RPC/specific UI actions.
            // We'll inject it as an <img> tag within the content for now.
        };

        console.log(`Inserting post into blog ID: ${selectedBlogId}`);
        const response = await blogger.posts.insert({
            blogId: selectedBlogId,
            resource: postData,
        });

        const publishedUrl = response.data.url;
        const postId = response.data.id;
        console.log(`Post inserted successfully. URL: ${publishedUrl}, ID: ${postId}`);

        // Update ArticleIndex
        await updateArticleIndex({
            title: postContent.title,
            slug: postContent.slug,
            contentSummary: postContent.contentSummary,
            tags: postContent.tags,
            publishedAt: new Date(response.data.published),
            blogId: selectedBlogId,
            postId: postId, // Store post ID as well if useful
        });

        await logExecution('SUCCESS', 'Blogger Post Insert', null, publishedUrl, { postId: postId, blogId: selectedBlogId, status: settings.publishingMode });
        return { url: publishedUrl, id: postId };

    } catch (error) {
        console.error('BloggerService: Failed to insert post:', error);
        let errorMessage = error.message;
        let status = 'FAILED';
        let postUrl = null;
        let details = { error: error.message, stack: error.stack };

        // Attempt to extract more specific error info if available from Google API errors
        if (error.response?.data?.error) {
            errorMessage = error.response.data.error.message;
            details.googleApiError = error.response.data.error;
            if (error.response.data.error.code === 400 || error.response.data.error.code === 401 || error.response.data.error.code === 403) {
                status = 'FAILED'; // This might indicate auth issues or invalid data
                // If it's an auth error, user might need to re-authenticate
                if (error.response.data.error.code === 401 || error.response.data.error.code === 403) {
                    errorMessage = `Authentication/Authorization error: ${errorMessage}. Please re-authenticate your Google account.`;
                }
            } else if (error.response.data.error.code === 429) {
                errorMessage = `Rate limit exceeded for Blogger API: ${errorMessage}`;
            }
        }

        await logExecution('FAILED', 'Blogger Post Insert', errorMessage, postUrl, details);
        throw new Error(errorMessage); // Re-throw to be caught by pipelineService
    }
}

// Update the ArticleIndex with new post metadata
async function updateArticleIndex(postMetadata) {
    const { title, slug, contentSummary, tags, publishedAt, blogId, postId } = postMetadata;

    try {
        // Check if an article with the same slug/title already exists to avoid duplicates
        // For simplicity, we'll just insert; a more robust system would check and update.
        const existingArticle = await ArticleIndex.findOne({ slug });
        if (existingArticle) {
            console.log(`Article with slug "${slug}" already exists. Skipping re-indexing.`);
            // Optionally update if needed, e.g., if content changes significantly
            return;
        }

        const newIndexEntry = new ArticleIndex({
            title,
            slug,
            contentSummary,
            tags: tags || [],
            publishedAt,
            blogId,
            postId: postId // Include postId if available
        });
        await newIndexEntry.save();
        console.log(`Article indexed successfully: "${title}"`);
        await logExecution('SUCCESS', 'Article Index Update', null, null, { title: title, slug: slug });
    } catch (error) {
        console.error('BloggerService: Failed to update ArticleIndex:', error);
        await logExecution('FAILED', 'Article Index Update', `Failed to index article "${title}": ${error.message}`, null, { title: title, slug: slug, error: error.message, stack: error.stack });
        // Decide if this failure should halt the entire pipeline or just be logged
        // For now, we log and continue.
    }
}

module.exports = {
    listUserBlogs,
    insertPost,
    updateArticleIndex,
    getAuthenticatedBloggerClient, // Exported for potential direct use if needed
};