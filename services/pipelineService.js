// services/pipelineService.js
const { google } = require('googleapis');
const grokService = require('./grokService');
const geminiService = require('./geminiService');
const bloggerService = require('./bloggerService');
const imageService = require('./imageService');
const seoService = require('./seoService');
const apiKeyService = require('./apiKeyService');
const { logExecution, sendTelegramAlert } = require('./apiService');

// -- Main pipeline orchestrator --
async function runPipeline(settings, authTokens, bloggerClient) {
    let status = 'SUCCESS';
    let errorMessage = null;
    let blogPostUrl = null;
    let postId = null;
    const start = Date.now();

    try {
        // 1. Agent 1 – Context & Topic Researcher (prompt engineering, embedded in AI calls)
        console.log('Pipeline: Agent 1 – Research phase...');

        // 2. Agent 2 – Content Synthesizer (choose provider)
        console.log('Pipeline: Agent 2 – Content generation...');
        const provider = settings.preferredAiProvider || 'grok';
        console.log(`Using AI provider: ${provider}`);

        let generatedArticle;
        if (provider === 'gemini') {
            // Try Gemini first with key rotation
            generatedArticle = await generateWithProvider('gemini', geminiService.generateContent, settings);
        } else {
            // Default to Grok
            generatedArticle = await generateWithProvider('grok', grokService.generateContent, settings);
        }
        console.log('Agent 2: Content generated.');

        // 3. Agent 3 – SEO & HTML Auditor
        console.log('Pipeline: Agent 3 – SEO auditing...');
        const seoArticle = await seoService.optimizeContent(generatedArticle, settings, bloggerClient);
        console.log('Agent 3: SEO complete.');

        // 4. Agent 4 – Publisher & Media Injector
        console.log('Pipeline: Agent 4 – Publishing...');
        const imgHtml = await imageService.fetchFeaturedImage(seoArticle.title);
        let finalHtml = seoArticle.htmlContent;
        if (imgHtml) finalHtml = imgHtml + '\n' + finalHtml;

        const pubResult = await bloggerService.insertPost(settings, {
            title: seoArticle.title,
            htmlContent: finalHtml,
            tags: seoArticle.tags,
            contentSummary: seoArticle.contentSummary,
            slug: seoArticle.slug,
        });
        blogPostUrl = pubResult.url;
        postId = pubResult.id;
        console.log(`Published: ${blogPostUrl}`);

    } catch (error) {
        status = 'FAILED';
        errorMessage = `Pipeline failed: ${error.message}`;
        console.error(errorMessage, error.stack);
        await logExecution('FAILED', 'Pipeline Execution', errorMessage, null, { error: error.message, duration: Date.now() - start });
        await sendTelegramAlert(`🚨 *Pipeline Failed*\n${error.message}\nBlog: ${settings.selectedBlogId || 'N/A'}`);
        throw error;
    } finally {
        if (status === 'SUCCESS') {
            await logExecution('SUCCESS', 'Pipeline Execution', 'Complete', blogPostUrl, { postId, blogId: settings.selectedBlogId, provider: settings.preferredAiProvider, duration: Date.now() - start });
        }
    }
}

// Helper: try primary provider first, fallback to the other on failure
async function generateWithProvider(primaryProvider, generateFn, settings) {
    try {
        return await generateFn(settings);
    } catch (primaryError) {
        console.error(`Primary provider "${primaryProvider}" failed: ${primaryError.message}`);
        // If auto-rotate is enabled and the other provider has active keys, try fallback
        if (settings.autoRotateKeys) {
            const fallbackProvider = primaryProvider === 'grok' ? 'gemini' : 'grok';
            console.log(`Attempting fallback to "${fallbackProvider}"...`);
            const fallbackService = fallbackProvider === 'gemini' ? geminiService : grokService;
            try {
                const article = await fallbackService.generateContent(settings);
                await logExecution('SUCCESS', `Provider Fallback`, `Fell back to ${fallbackProvider} after ${primaryProvider} failure.`);
                return article;
            } catch (fallbackError) {
                const msg = `Both providers failed. Primary (${primaryProvider}): ${primaryError.message} | Fallback (${fallbackProvider}): ${fallbackError.message}`;
                console.error(msg);
                throw new Error(msg);
            }
        }
        throw primaryError; // No fallback, propagate
    }
}

module.exports = { runPipeline };