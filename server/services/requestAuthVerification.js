const auth = require('./auth');

// Share signature verification only within this exact server request. This
// is not a session/entitlement cache: every paid gate still reads the DB.
// No client-settable property can forge this WeakMap entry, and expired or
// changed tokens must be verified again. Entries disappear with the request.
const verifiedRequests = new WeakMap();
function verifyRequestToken(request, token) {
  if (!request || typeof request !== 'object') return auth.verifyToken(token);
  const cached = verifiedRequests.get(request);
  if (cached?.token === token && Number.isFinite(cached.payload.exp) && cached.payload.exp > Date.now() / 1000)
    return cached.payload;
  verifiedRequests.delete(request);
  const payload = Object.freeze(auth.verifyToken(token));
  verifiedRequests.set(request, { token, payload });
  return payload;
}

module.exports = { verifyRequestToken };
