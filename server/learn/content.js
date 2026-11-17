const guides = require('./guides');
const terms = require('./terms');
const scanners = require('./scanners');
const sectors = require('./sectors');
const EN = require('./en');
const { TOOLS_EN } = require('./tools');

const CATEGORIES = Object.freeze({
  he: {
    guides: {
      title: 'מדריכים ומושגים',
      intro: 'נפח מסחר, ממוצעים נעים, מדדים פיננסיים ומדדי שוק — מוסברים בעברית פשוטה.',
    },
    scanners: {
      title: 'סורקים וכלים',
      intro: 'איך למצוא מניות לפי נפח חריג, ממוצעים נעים, מדד או סקטור — ומה לבדוק אחרי הסריקה.',
    },
    sectors: {
      title: 'סקטורים וענפים',
      intro: 'מה כולל כל סקטור בשוק האמריקאי, מה מזיז אותו ואיך עוקבים אחריו דרך קרן הסקטור.',
    },
  },
  en: {
    guides: {
      title: 'Guides and concepts',
      intro: 'Trading volume, moving averages, valuation ratios and market indexes, explained plainly.',
    },
    scanners: {
      title: 'Scanners and tools',
      intro: 'How to find stocks by unusual volume, moving averages, index or sector, and what to check after a scan.',
    },
    sectors: {
      title: 'Sectors and industries',
      intro: 'What each U.S. market sector holds, what moves it, and how to follow it through its sector ETF.',
    },
  },
});

const PAGES = Object.freeze([...guides, ...terms, ...scanners, ...sectors]);
const BY_SLUG = new Map(PAGES.map((page) => [page.slug, page]));

function hasEnglish(slug) {
  return Object.prototype.hasOwnProperty.call(EN, slug);
}

// English pages reuse the Hebrew page's structure (slug, category, related
// links, tool) and replace every piece of copy with the translation.
function getPage(slug, lang = 'he') {
  const page = BY_SLUG.get(slug);
  if (!page) return null;
  if (lang !== 'en') return page;
  if (!hasEnglish(slug)) return null;
  return { ...page, ...EN[slug], tool: TOOLS_EN[page.tool.href] };
}

module.exports = { PAGES, CATEGORIES, getPage, hasEnglish };
