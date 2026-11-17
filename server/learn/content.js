const guides = require('./guides');
const scanners = require('./scanners');
const sectors = require('./sectors');

const CATEGORIES = Object.freeze({
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
});

const PAGES = Object.freeze([...guides, ...scanners, ...sectors]);
const BY_SLUG = new Map(PAGES.map((page) => [page.slug, page]));

function getPage(slug) {
  return BY_SLUG.get(slug) || null;
}

module.exports = { PAGES, CATEGORIES, getPage };
