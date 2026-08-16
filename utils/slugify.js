// utils/slugify.js
// Minimal dependency-free slug generator (replaces the missing `slugify` package).

function slugify(input, options = {}) {
    const { lower = true, strict = true, maxLength = 96 } = options;

    let slug = String(input || '')
        .normalize('NFKD')                  // Split accented chars into base + diacritic
        .replace(/[\u0300-\u036f]/g, '')    // Drop diacritics
        .trim();

    if (lower) slug = slug.toLowerCase();

    if (strict) {
        // Keep unicode letters/numbers (so Bangla titles survive), collapse the rest.
        slug = slug.replace(/[^\p{L}\p{N}]+/gu, '-');
    } else {
        slug = slug.replace(/\s+/g, '-');
    }

    slug = slug.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');

    if (maxLength && slug.length > maxLength) {
        slug = slug.slice(0, maxLength).replace(/-+$/g, '');
    }

    // Never return an empty slug — downstream code relies on uniqueness.
    return slug || `post-${Date.now()}`;
}

module.exports = slugify;
module.exports.default = slugify;
