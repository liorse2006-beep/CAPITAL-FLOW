// Provider/source diagnostics stay available to server-side monitoring, but
// they are never part of the customer-facing JSON contract.
function stripPublicProvenance(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => stripPublicProvenance(item, seen));
    return value;
  }

  Object.keys(value).forEach((key) => {
    if (key === 'dataProvenance') {
      delete value[key];
      return;
    }
    stripPublicProvenance(value[key], seen);
  });

  return value;
}

function publicResponseSanitizer(req, res, next) {
  const json = res.json.bind(res);
  res.json = (payload) => json(stripPublicProvenance(payload));
  next();
}

module.exports = { publicResponseSanitizer, stripPublicProvenance };
