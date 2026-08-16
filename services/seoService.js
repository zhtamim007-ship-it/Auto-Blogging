// services/seoService.js
const { ExecutionLog, ArticleIndex } = require('../db');
const { makeApiRequest, logExecution, sendTelegramAlert } = require('./apiService');
const slugify = require('../utils/slugify'); // Dependency-free slug generator

// Placeholder for semantic search of existing articles
async function findRelatedArticles(querySummary, currentBlogId, limit = 3) {
    try {
        // This is a simplified search. A real implementation would use vector embeddings,
        // full-text search, or a dedicated search engine.
        console.log(`Searching for related articles for query: "${querySummary.substring(0, 50)}..."`);
        const relatedArticles = await ArticleIndex.find({
            blogId: currentBlogId, // Filter by the current blog
            // Add more sophisticated search logic here, e.g., text search on title/contentSummary
            // For now, just returning recent articles by this blog.
        })
        .sort({ publishedAt: -1 })
        .limit(limit)
        .exec();

        console.log(`Found ${relatedArticles.length} related articles.`);
        return relatedArticles.map(article => ({
            title: article.title,
            url: `/blog/${article.slug}` // Assuming your blog has a /blog/:slug route
        }));
    } catch (error) {
        console.error('SEOService: Error finding related articles:', error);
        await logExecution('FAILED', 'Semantic Search', `Error finding related articles: ${error.message}`, null, { query: querySummary, error: error.message, stack: error.stack });
        return []; // Return empty array on error
    }
}

// Helper to inject PPC links
function injectPpcLinks(htmlContent, ppcLinks) {
    if (!ppcLinks || ppcLinks.length === 0) {
        return htmlContent;
    }

    let modifiedHtml = htmlContent;
    const linkCount = ppcLinks.length;
    const paragraphs = modifiedHtml.split(/<p\b[^>]*>.*?<\/p>/gi); // Split by paragraphs

    // Simple strategy: inject links into some paragraphs
    // More sophisticated: analyze text for optimal insertion points
    const insertionPoints = Math.max(1, Math.floor(paragraphs.length / (linkCount + 1))); // Distribute links (never 0 -> avoids % 0 = NaN)

    let linkIndex = 0;
    const newParagraphs = [];

    for (let i = 0; i < paragraphs.length; i++) {
        newParagraphs.push(paragraphs[i]);
        // Insert a link roughly every N paragraphs, ensuring not to insert after the last paragraph
        if (i > 0 && i % insertionPoints === 0 && linkIndex < linkCount) {
            // Create a simple anchor tag for the PPC link
            const pLink = ppcLinks[linkIndex];
            const linkHtml = `<p style="text-align:center; font-style:italic; margin: 20px 0;"><strong>Check out our special offer:</strong> <a href="${pLink}" target="_blank">${pLink.replace('https://', '').split('/')[0]}</a></p>`;
            newParagraphs.push(linkHtml);
            linkIndex++;
        }
    }

    // If there are still links left (e.g., few paragraphs), append them at the end
    while (linkIndex < linkCount) {
         const pLink = ppcLinks[linkIndex];
         const linkHtml = `<p style="text-align:center; font-style:italic; margin: 20px 0;"><strong>Special Offer:</strong> <a href="${pLink}" target="_blank">${pLink.replace('https://', '').split('/')[0]}</a></p>`;
         newParagraphs.push(linkHtml);
         linkIndex++;
    }


    modifiedHtml = newParagraphs.join(''); // Re-join paragraphs
    return modifiedHtml;
}


async function optimizeContent(generatedArticleData, settings, bloggerClient) {
    let { title, htmlContent, metaDescription, tags, contentSummary } = generatedArticleData;
    const selectedBlogId = settings.selectedBlogId;
    const seoKeywords = Array.isArray(settings.seoKeywords) ? settings.seoKeywords : [];
    const ppcTargetLinks = Array.isArray(settings.ppcTargetLinks) ? settings.ppcTargetLinks : [];

    let optimizedHtmlContent = htmlContent;

    // 1. SEO & HTML Validation (basic)
    console.log('Performing SEO & HTML validation...');
    // Simple check: ensure basic structure exists. Robust validation might involve an HTML parser.
    if (!optimizedHtmlContent.includes('<h1>') && !optimizedHtmlContent.includes('<h2>')) {
        optimizedHtmlContent = `<h1>${title}</h1>\n` + optimizedHtmlContent;
        console.log('Added H1 title to content.');
    }
    // Add other checks as needed (e.g., presence of paragraphs, lists)

    // 2. Generate/Refine Meta Description and Tags
    console.log('Generating meta description and tags...');
    let finalMetaDescription = metaDescription;
    let finalTags = tags;

    if (!finalMetaDescription) {
        // Generate meta description from content summary and keywords
        finalMetaDescription = `${(contentSummary || title).substring(0, 120)}... Keywords: ${seoKeywords.join(', ')}`;
        console.log('Generated meta description.');
    }
    if (!finalTags || finalTags.length === 0) {
        // Use SEO keywords as tags if none were generated by LLM
        finalTags = seoKeywords.slice(0, 4); // Take up to 4 keywords
        console.log('Used SEO keywords as tags.');
    } else {
        // Merge LLM tags with SEO keywords if desired, or prioritize LLM tags
        const combinedTags = [...new Set([...seoKeywords, ...finalTags])]; // Unique tags
        finalTags = combinedTags.slice(0, 5); // Limit to 5 tags
    }

    // 3. Inject PPC Monetization Links
    console.log('Injecting PPC links...');
    optimizedHtmlContent = injectPpcLinks(optimizedHtmlContent, ppcTargetLinks);
    console.log(`Injected ${ppcTargetLinks.length} PPC links.`);

    // 4. Inject Contextual Internal Links
    console.log('Injecting internal links...');
    try {
        const relatedArticles = await findRelatedArticles(contentSummary, selectedBlogId, 3);
        if (relatedArticles.length > 0) {
            let linkInjectionCount = 0;
            // Simple injection: find a suitable paragraph and insert a link.
            // A more advanced strategy would target specific keywords.
            const paragraphs = optimizedHtmlContent.split(/<p\b[^>]*>.*?<\/p>/gi);
            const paragraphsWithLinks = paragraphs.map((p, index) => {
                if (index > 0 && index % 2 === 0 && linkInjectionCount < relatedArticles.length) { // Inject every ~2 paragraphs
                    const related = relatedArticles[linkInjectionCount];
                    const linkHtml = `<p style="font-style:italic; margin-top:15px;"><strong>Related:</strong> <a href="${related.url}" target="_blank">${related.title}</a></p>`;
                    linkInjectionCount++;
                    return p + linkHtml; // Append link to the paragraph
                }
                return p;
            });
            optimizedHtmlContent = paragraphsWithLinks.join('');
            console.log(`Injected ${linkInjectionCount} internal links.`);
        }
    } catch (error) {
        console.error('SEOService: Failed to inject internal links.', error);
        // Log and continue, as this is not critical for publishing
    }

    // 5. Generate Slug
    const slug = slugify(title, { lower: true, strict: true });
    console.log(`Generated slug: ${slug}`);

    return {
        title,
        htmlContent: optimizedHtmlContent,
        metaDescription: finalMetaDescription,
        tags: finalTags,
        contentSummary: contentSummary, // Keep original summary
        slug: slug,
    };
}

module.exports = {
    optimizeContent,
    // Export findRelatedArticles and injectPpcLinks if they need to be tested or used elsewhere
    findRelatedArticles,
    injectPpcLinks,
};