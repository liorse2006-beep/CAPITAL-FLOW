const path = require('node:path');

// sendFile also ignores dotfiles by default. Allow only this exact committed
// public file, never an arbitrary request path or the complete dot-directory.
const contactPath = path.join(__dirname, '../../public/.well-known/security.txt');

module.exports = function serveSecurityContact(_req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').sendFile(contactPath, { dotfiles: 'allow' }, (error) => {
    if (!error || res.headersSent) return;
    res
      .status(error.status === 404 ? 404 : 503)
      .type('text/plain')
      .send('Not found');
  });
};
