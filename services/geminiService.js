// services/geminiService.js
const axios = require('axios');
const { logExecution, sendTelegramAlert } = require('./apiService');
const apiKeyService = require('./apiKeyService');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash'; // Using a latest available model

async function generateContent(settings, customApiKey = null) {
    const {
        category,
        postLength,
        language,
        writingTone,
        seoKeywords,
        ppcTargetLinks
    } = settings;

    let apiKey = customApiKey;

    // If no specific key provided, get the next available active Gemini key
    if (!apiKey) {
        try {
            const keyEntry = await apiKeyService.getNextAvailableKey('gemini');
            apiKey = keyEntry.key;
            console.log(`GeminiService: Using key "${keyEntry.label}"`);
        } catch (keyError) {
            const errorMsg = `No active Gemini API keys available. ${keyError.message}`;
            console.error(errorMsg);
            await logExecution('FAILED', 'Gemini API Key', errorMsg);
            await sendTelegramAlert(`🚨 *Gemini API Error* \n\nMessage: ${errorMsg}`);
            throw new Error(errorMsg);
        }
    }

    // Determine approximate word count for prompt
    let wordCountTarget = 600;
    if (postLength === 'short') wordCountTarget = 300;
    if (postLength === 'long') wordCountTarget = 1200;

    // Construct prompt similar to Grok's for consistency
    const prompt = `
    You are an expert blogger and content creator.
    Your task is to write a compelling and informative blog post.

    **Blog Post Requirements:**
    - **Topic/Category:** ${category}
    - **Approximate Word Count:** ${wordCountTarget} words.
    - **Language:** ${language}
    - **Writing Tone:** ${writingTone}
    - **SEO Keywords:** ${seoKeywords.join(', ') || 'N/A'}
    - **PPC/Monetization Links:** ${ppcTargetLinks.length > 0 ? ppcTargetLinks.join(', ') : 'N/A'}. Integrate naturally.

    **Content Guidelines:**
    - Synthesize information to create original content.
    - Ensure natural human-like flow, avoid robotic phrasing.
    - Structure with headings (<h1>, <h2>, <h3>), paragraphs, lists.
    - Output must be HTML format, ready to publish.
    - Include a captivating title.
    - Include meta description (~150 chars) and 3-4 tags/labels as HTML comments:
      <!-- Title: Your Title -->
      <!-- Meta Description: Your description -->
      <!-- Tags: tag1, tag2, tag3 -->

    Provide the full blog post in HTML.
    `;

    const url = `${GEMINI_API_BASE}/${DEFAULT_MODEL}:generateContent?key=${apiKey}`;

    try {
        console.log('Calling Gemini API for content generation...');

        const response = await axios.post(url, {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: postLength === 'long' ? 1500 : (postLength === 'medium' ? 900 : 500),
                topP: 0.95,
                topK: 40,
            },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ],
        }, {
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' },
        });

        if (!response.data || !response.data.candidates || response.data.candidates.length === 0) {
            throw new Error('Gemini API returned empty or unexpected response.');
        }

        const generatedText = response.data.candidates[0].content.parts[0].text;
        console.log('Content generated successfully from Gemini.');

        // Parse the generated HTML content using the same parser logic
        const articleData = parseGeneratedHtml(generatedText);

        await logExecution('SUCCESS', 'Gemini Content Generation', 'Content generated successfully.', null, {
            title: articleData.title,
            wordCount: articleData.htmlContent.length,
        });

        return articleData;

    } catch (error) {
        console.error('GeminiService: Failed to generate content:', error);
        let errorMessage = error.message;
        let details = { error: error.message, stack: error.stack };

        // Extract more specific Gemini API errors
        if (error.response?.data?.error) {
            errorMessage = error.response.data.error.message || errorMessage;
            details.geminiApiError = error.response.data.error;

            // Handle specific Gemini error codes
            if (error.response.status === 429 || error.response.data.error.code === 429) {
                errorMessage = `Gemini API rate limited: ${errorMessage}`;
                // Try to deactivate or mark the key as rate-limited for rotation
                try {
                    await apiKeyService.toggleKeyStatusForRateLimit('gemini', apiKey);
                } catch (toggleErr) {
                    // Non-critical
                }
            } else if (error.response.status === 403 || error.response.status === 401) {
                errorMessage = `Gemini API auth error: ${errorMessage}. Key may be invalid.`;
                // Consider deactivating the key
                try {
                    const keys = await apiKeyService.getAllKeys('gemini');
                    const badKey = keys.find(k => k.key === apiKey);
                    if (badKey) {
                        badKey.isActive = false;
                        await badKey.save();
                        console.log(`GeminiService: Deactivated invalid key "${badKey.label}"`);
                    }
                } catch (deactErr) {
                    // Non-critical
                }
            }
        }

        await logExecution('FAILED', 'Gemini Content Generation', errorMessage, null, details);
        await sendTelegramAlert(`🚨 *Gemini API Error*\n\nMessage: ${errorMessage}`);

        throw new Error(errorMessage);
    }
}

// Helper function to parse the HTML content (shared logic with grokService)
function parseGeneratedHtml(htmlContent) {
    let title = 'Untitled Post';
    let htmlContentBody = htmlContent;
    let metaDescription = '';
    let tags = [];
    let contentSummary = '';

    // Remove markdown code blocks if any
    htmlContentBody = htmlContentBody.replace(/```html\n?/gi, '').replace(/```\n?/gi, '');

    const titleMatch = htmlContentBody.match(/<!--\s*Title:\s*(.*?)\s*-->/i);
    if (titleMatch && titleMatch[1]) {
        title = titleMatch[1].trim();
        htmlContentBody = htmlContentBody.replace(/<!--\s*Title:.*?-->/i, '');
    }

    const metaMatch = htmlContentBody.match(/<!--\s*Meta Description:\s*(.*?)\s*-->/i);
    if (metaMatch && metaMatch[1]) {
        metaDescription = metaMatch[1].trim();
        htmlContentBody = htmlContentBody.replace(/<!--\s*Meta Description:.*?-->/i, '');
    }

    const tagsMatch = htmlContentBody.match(/<!--\s*Tags:\s*(.*?)\s*-->/i);
    if (tagsMatch && tagsMatch[1]) {
        tags = tagsMatch[1].split(',').map(tag => tag.trim()).filter(Boolean);
        htmlContentBody = htmlContentBody.replace(/<!--\s*Tags:.*?-->/i, '');
    }

    // Extract content summary
    const firstParagraphMatch = htmlContentBody.match(/<p>(.*?)<\/p>/i);
    if (firstParagraphMatch && firstParagraphMatch[1]) {
        contentSummary = firstParagraphMatch[1].substring(0, 150) + (firstParagraphMatch[1].length > 150 ? '...' : '');
    } else {
        contentSummary = htmlContentBody.substring(0, 150) + (htmlContentBody.length > 150 ? '...' : '');
    }

    // Remove lingering comments
    htmlContentBody = htmlContentBody.replace(/<!--.*?-->/gs, '');

    // Get title from H1 if not found in comments
    if (title === 'Untitled Post') {
        const h1Match = htmlContentBody.match(/<h1>(.*?)<\/h1>/i);
        if (h1Match && h1Match[1]) {
            title = h1Match[1].trim();
        }
    }

    // Clean up empty tags and excessive whitespace
    htmlContentBody = htmlContentBody.replace(/<[^>]+>\s*<\/[^>]+>/g, '');
    htmlContentBody = htmlContentBody.replace(/\s{2,}/g, ' ');

    return {
        title,
        htmlContent: htmlContentBody.trim(),
        metaDescription,
        tags,
        contentSummary,
    };
}

module.exports = {
    generateContent,
};