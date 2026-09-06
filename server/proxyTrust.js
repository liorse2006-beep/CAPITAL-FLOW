'use strict';

const proxyaddr = require('proxy-addr');

// Render documents that public web-service traffic reaches the container
// through Cloudflare and Render's load balancer. Keep this platform-specific
// fallback narrow: never use `true`, and never trust an arbitrary forwarding
// header. Deployments on other hosts must provide their actual ingress CIDRs.
const RENDER_PROXY_HOPS = 2;

function resolveTrustedProxy({ cidrs = [], isRender = process.env.RENDER === 'true' } = {}) {
  if (cidrs.length) return proxyaddr.compile(cidrs);
  return isRender ? RENDER_PROXY_HOPS : false;
}

module.exports = { RENDER_PROXY_HOPS, resolveTrustedProxy };
