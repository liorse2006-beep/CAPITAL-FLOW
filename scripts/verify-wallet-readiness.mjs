#!/usr/bin/env node

const origin = (process.argv[2] || process.env.WALLET_TARGET_URL || '').replace(/\/+$/, '');

function assertTarget(value) {
  if (!value)
    throw new Error('Pass a target origin: node scripts/verify-wallet-readiness.mjs https://staging.example.com');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The wallet target must use HTTP or HTTPS.');
  return url.origin;
}

async function get(url) {
  const response = await fetch(url, {
    headers: { accept: 'text/html, text/plain, application/json', 'user-agent': 'CapitalFlow-wallet-readiness/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  return { response, body: await response.text() };
}

async function verifyWalletReadiness(target) {
  const checks = [];
  const verification = await get(`${target}/.well-known/apple-developer-merchantid-domain-association`);
  checks.push({
    name: 'Apple Pay domain verification file',
    passed: verification.response.ok && verification.body.trim().length > 0,
    evidence: { status: verification.response.status, contentType: verification.response.headers.get('content-type') },
  });

  const home = await get(`${target}/`);
  const csp = home.response.headers.get('content-security-policy') || '';
  checks.push({
    name: 'Production origin reachable',
    passed: home.response.ok,
    evidence: { status: home.response.status },
  });
  checks.push({
    name: 'Google Pay origin allowed by CSP',
    passed: csp.includes('https://pay.google.com'),
    evidence: { present: csp.includes('https://pay.google.com') },
  });
  checks.push({
    name: 'Whop checkout origins allowed by CSP',
    passed: csp.includes('https://whop.com') && csp.includes('https://*.whop.com'),
    evidence: { apex: csp.includes('https://whop.com'), wildcard: csp.includes('https://*.whop.com') },
  });

  const scanner = await get(`${target}/scanner`);
  checks.push({
    name: 'Scanner route reachable',
    passed: scanner.response.ok,
    evidence: { status: scanner.response.status },
  });

  return {
    target,
    checks,
    passed: checks.every((check) => check.passed),
    manualVerificationRequired: [
      'Apple Pay must be tested on a supported Apple device/browser with an eligible Wallet card.',
      'Google Pay must be tested in Chrome/Android with an eligible Google Wallet card.',
      'A sandbox or low-risk test transaction must be completed and its Whop webhook must upgrade the test account.',
    ],
  };
}

const target = assertTarget(origin);
verifyWalletReadiness(target)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  })
  .catch((error) => {
    console.error('[wallet-readiness] ' + error.message);
    process.exitCode = 1;
  });
