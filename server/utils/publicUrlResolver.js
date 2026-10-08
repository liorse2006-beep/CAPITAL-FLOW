const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');
const ipaddr = require('ipaddr.js');

const MAX_HOPS = 4;
const MAX_CONCURRENT = 4;
const TOTAL_TIMEOUT_MS = 5000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
let active = 0;

function publicAddress(address) {
  try {
    const ip = ipaddr.process(address);
    if (ip.range() !== 'unicast') return false;
    if (ip.kind() === 'ipv4') return !ip.match(ipaddr.parse('198.18.0.0'), 15);
    // Only globally routable IPv6 unicast; mapped IPv4 is checked above.
    return (
      ip.match(ipaddr.parse('2000::'), 3) &&
      !ip.match(ipaddr.parse('2001:10::'), 28) &&
      !ip.match(ipaddr.parse('2001:20::'), 28)
    );
  } catch {
    return false;
  }
}

function parsedPublicUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid article URL');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new Error('Unsupported article URL');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || (net.isIP(host) && !publicAddress(host)))
    throw new Error('Article destination is not public');
  url.hash = '';
  return url;
}

function isPublicHttpUrl(value) {
  try {
    parsedPublicUrl(value);
    return true;
  } catch {
    return false;
  }
}

async function publicRecords(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const records = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.length > 16 || records.some((record) => !publicAddress(record.address)))
    throw new Error('Article DNS is not exclusively public');
  return records;
}

function headAtValidatedAddress(url, record, timeoutMs) {
  return new Promise((resolve, reject) => {
    let request;
    let finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      request?.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Article resolution timed out')), timeoutMs);
    timer.unref();
    try {
      request = (url.protocol === 'https:' ? https : http).request(
        url,
        {
          method: 'HEAD',
          agent: false,
          autoSelectFamily: false,
          maxHeaderSize: 8192,
          headers: { 'User-Agent': 'CapitalFlow-ArticleResolver/1.0' },
          // Keep the URL hostname for TLS/certificate checks, but do not let
          // a second DNS lookup replace the address validated for this hop.
          lookup: (_host, options, callback) => {
            if (options.all) callback(null, [record]);
            else callback(null, record.address, record.family);
          },
        },
        (response) => {
          finish(null, { status: response.statusCode, location: response.headers.location });
          response.destroy();
        }
      );
      request.on('error', (error) => finish(error));
      request.end();
    } catch (error) {
      finish(error);
    }
  });
}

async function resolveChain(original, expiresAt) {
  let url = parsedPublicUrl(original);
  const visited = new Set();
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (visited.has(url.href)) throw new Error('Article redirect loop');
    visited.add(url.href);
    const records = await publicRecords(url);
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) throw new Error('Article resolution timed out');
    const response = await headAtValidatedAddress(url, records[0], remaining);
    if (!REDIRECTS.has(response.status)) {
      if (response.status < 200 || response.status >= 400) throw new Error('Article destination failed');
      return url.href;
    }
    if (!response.location || hop === MAX_HOPS) throw new Error('Article redirect limit');
    // Validate BEFORE another DNS lookup or request, not after fetching it.
    url = parsedPublicUrl(new URL(response.location, url).href);
  }
  throw new Error('Article redirect limit');
}

async function resolvePublicUrl(original) {
  if (active >= MAX_CONCURRENT) return original;
  active++;
  // Retain admission until the underlying DNS work finishes even if the
  // caller's deadline expires; a slow resolver cannot create an unbounded queue.
  const task = resolveChain(original, Date.now() + TOTAL_TIMEOUT_MS).finally(() => {
    active--;
  });
  let timer;
  try {
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Article resolution timed out')), TOTAL_TIMEOUT_MS);
      timer.unref();
    });
    return await Promise.race([task, timeout]);
  } catch {
    return original;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { resolvePublicUrl, isPublicHttpUrl };
