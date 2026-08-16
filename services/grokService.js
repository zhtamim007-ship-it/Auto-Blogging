// services/grokService.js
const axios = require('axios');
const apiConfig = require('../config/apiConfig');
const { logExecution, sendTelegramAlert } = require('./apiService');
const apiKeyService = require('./apiKeyService');

async function generateContent(settings, customApiKey = null) {
    const { category, postLength, language, writingTone, seoKeywords, ppcTargetLinks } = settings;

    let apiKey = customApiKey;

    // Try DB keys first
    if (!apiKey) {
        try {
            const keyEntry = await apiKeyService.getNextAvailableKey('grok');
            apiKey = keyEntry.key;
            console.log(`GrokService: Using key "${keyEntry.label}"`);
        } catch (keyError) {
            if (apiConfig.grok.apiKey) {
                apiKey = apiConfig.grok.apiKey;
                console.log('GrokService: Using env var fallback.');
            } else {
                const msg = `No active Grok keys. ${keyError.message}`;
                console.error(msg);
                await logExecution('FAILED', 'Grok API Key', msg);
                await sendTelegramAlert(`🚨 *Grok Key Error*\n${msg}`);
                throw new Error(msg);
            }
        }
    }
    if (!apiKey && apiConfig.grok.apiKey) {
        apiKey = apiConfig.grok.apiKey;
    }
    if (!apiKey) {
        const msg = 'No Grok API key configured.';
        console.error(msg);
        await logExecution('FAILED', 'Grok API Key', msg);
        await sendTelegramAlert(`🚨 *Grok Key Error*\n${msg}`);
        throw new Error(msg);
    }

    let wc = 600;
    if (postLength === 'short') wc = 300;
    if (postLength === 'long') wc = 1200;

    const prompt = `You are an expert blogger. Write a blog post.
Requirements:
- Topic: ${category}
- Word count: ~${wc}
- Language: ${language}
- Tone: ${writingTone}
- SEO Keywords: ${seoKeywords.join(', ') || 'N/A'}
- PPC Links: ${ppcTargetLinks.length > 0 ? ppcTargetLinks.join(', ') : 'N/A'}

Guidelines:
- Synthesize information, avoid copying.
- Natural human-like flow.
- Use &lt;h1&gt;, &lt;h2&gt;, &lt;h3&gt;, &lt;p&gt;, &lt;ul&gt; tags.
- Output pure HTML.
- Include a title.
- Include as HTML comments: &lt;!-- Title: ... --&gt;, &lt;!-- Meta Description: ... --&gt;, &lt;!-- Tags: tag1, tag2 --&gt;
Provide the full HTML.`;

    try {
        console.log('Calling Grok API...');
        const res = await axios.post(apiConfig.grok.apiUrl, {
            model: apiConfig.grok.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: postLength === 'long' ? 1500 : postLength === 'medium' ? 900 : 500,
        }, {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            timeout: 30000,
        });

        if (!res.data?.choices?.[0]?.message?.content) throw new Error('Empty Grok response.');

        const content = res.data.choices[0].message.content;
        console.log('Grok content generated.');

        const article = parseGeneratedHtml(content);

        await logExecution('SUCCESS', 'Grok Content Generation', 'OK', null, { title: article.title });
        return article;
    } catch (error) {
        console.error('GrokService error:', error.message);
        let msg = error.message;
        const det = { error: error.message, stack: error.stack };

        if (error.response) {
            const s = error.response.status;
            if (s === 429) {
                msg = 'Rate limited. Rotating key.';
                try {
                    const keys = await apiKeyService.getAllKeys('grok');
                    const bk = keys.find(k => k.key === apiKey);
                    if (bk) { bk.isActive = false; await bk.save(); }
                } catch (_) {}
            } else if (s === 401 || s === 403) {
                msg = 'Auth failed. Key deactivated.';
                try {
                    const keys = await apiKeyService.getAllKeys('grok');
                    const bk = keys.find(k => k.key === apiKey);
                    if (bk) { bk.isActive = false; await bk.save(); }
                } catch (_) {}
            }
            det.grokApiError = error.response.data;
        }

        await logExecution('FAILED', 'Grok Content Generation', msg, null, det);
        await sendTelegramAlert(`🚨 *Grok Error*\n${msg}`);
        throw new Error(msg);
    }
}

function parseGeneratedHtml(html) {
    let title = 'Untitled Post';
    let body = html;
    let meta = '';
    let tags = [];
    let summary = '';

    body = body.replace(/```html\n?/gi, '').replace(/```\n?/gi, '');

    const tm = body.match(/<!--\s*Title:\s*(.*?)\s*-->/i);
    if (tm?.[1]) { title = tm[1].trim(); body = body.replace(/<!--\s*Title:.*?-->/i, ''); }

    const mm = body.match(/<!--\s*Meta Description:\s*(.*?)\s*-->/i);
    if (mm?.[1]) { meta = mm[1].trim(); body = body.replace(/<!--\s*Meta Description:.*?-->/i, ''); }

    const tgm = body.match(/<!--\s*Tags:\s*(.*?)\s*-->/i);
    if (tgm?.[1]) { tags = tgm[1].split(',').map(t => t.trim()).filter(Boolean); body = body.replace(/<!--\s*Tags:.*?-->/i, ''); }

    const fp = body.match(/<p>(.*?)<\/p>/i);
    summary = fp?.[1]?.substring(0, 150) ?? body.substring(0, 150);
    if (summary.length >= 150) summary += '...';

    body = body.replace(/<!--.*?-->/gs, '');
    if (title === 'Untitled Post') { const h1 = body.match(/<h1>(.*?)<\/h1>/i); if (h1?.[1]) title = h1[1].trim(); }
    body = body.replace(/<[^>]+>\s*<\/[^>]+>/g, '').replace(/\s{2,}/g, ' ');

    return { title, htmlContent: body.trim(), metaDescription: meta, tags, contentSummary: summary };
}

module.exports = { generateContent };