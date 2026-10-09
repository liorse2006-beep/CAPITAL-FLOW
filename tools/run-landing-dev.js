// Plain static file server for LANDING PAGE/ (no build step — the site is
// hand-written HTML/CSS/JS). Serves from disk on every request and disables
// caching so the preview always reflects the latest edit.
const http = require('http');
const fs = require('fs');
const path = require('path');

const defaultRoot = path.join(__dirname, '..', 'LANDING PAGE');
const port = 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function isInside(root, filePath) {
  const relative = path.relative(root, filePath);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

function createLandingServer({ root = defaultRoot } = {}) {
  const resolvedRoot = path.resolve(root);
  return http.createServer(async (req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath.includes('\0')) throw new Error('Invalid path');
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    if (urlPath === '/') urlPath = '/index.html';
    // Normalize both separator representations before applying the boundary.
    const filePath = path.join(resolvedRoot, urlPath.replaceAll('\\', '/'));
    if (!isInside(resolvedRoot, filePath)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    try {
      const [canonicalRoot, canonicalFile] = await Promise.all([
        fs.promises.realpath(resolvedRoot),
        fs.promises.realpath(filePath),
      ]);
      if (!isInside(canonicalRoot, canonicalFile)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const data = await fs.promises.readFile(canonicalFile);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(canonicalFile).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });
}

if (require.main === module) {
  createLandingServer().listen(port, '127.0.0.1', () => {
    console.log(`Landing page dev server: http://localhost:${port}`);
  });
}

module.exports = { createLandingServer };
