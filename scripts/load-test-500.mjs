#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const DEFAULT_USERS = 500;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ERROR_RATE = 0.01;
const DEFAULT_MAX_P95_MS = 2_000;

function envNumber(name, fallback, minimum = 0) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)] * 100) / 100;
}

function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function assertSafeTarget(targetUrl) {
  const parsed = new URL(targetUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('LOAD_TEST_TARGET_URL must use HTTP or HTTPS.');
  if (isLocalHost(parsed.hostname)) return parsed;
  if (process.env.LOAD_TEST_CONFIRM !== 'staging') {
    throw new Error(
      'Refusing a non-local load test. Set LOAD_TEST_CONFIRM=staging only for an explicitly approved staging target.'
    );
  }
  if (/(^|\.)capitalflow\.vip$/i.test(parsed.hostname)) {
    throw new Error(
      'Production load testing is blocked by default. Run this harness against a staging host or use a dedicated capacity-test environment.'
    );
  }
  return parsed;
}

async function requestOnce(baseUrl, path, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetchImpl(new URL(path, baseUrl), {
      method: 'GET',
      headers: { accept: 'application/json, text/plain;q=0.9', 'user-agent': 'CapitalFlow-load-test/1.0' },
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: performance.now() - started,
      error: null,
    };
  } catch (error) {
    const cause = error?.cause;
    return {
      ok: false,
      status: null,
      latencyMs: performance.now() - started,
      error:
        error?.name === 'AbortError'
          ? 'timeout'
          : String(cause?.code ? `${error?.message || error} (${cause.code})` : error?.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runLoadTest({
  targetUrl = process.env.LOAD_TEST_TARGET_URL,
  users = envNumber('LOAD_TEST_USERS', DEFAULT_USERS, 1),
  paths = (process.env.LOAD_TEST_PATHS || '/health')
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean),
  timeoutMs = envNumber('LOAD_TEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 100),
  maxErrorRate = envNumber('LOAD_TEST_MAX_ERROR_RATE', DEFAULT_MAX_ERROR_RATE, 0),
  maxP95Ms = envNumber('LOAD_TEST_MAX_P95_MS', DEFAULT_MAX_P95_MS, 0),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!targetUrl) throw new Error('Set LOAD_TEST_TARGET_URL to a staging or local target before running the test.');
  if (typeof fetchImpl !== 'function') throw new Error('This load-test harness requires a fetch implementation.');
  if (!paths.length) throw new Error('Configure at least one read-only path in LOAD_TEST_PATHS.');
  const baseUrl = assertSafeTarget(targetUrl);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: Math.floor(users) }, (_, index) =>
      requestOnce(baseUrl, paths[index % paths.length], timeoutMs, fetchImpl)
    )
  );
  const durationMs = performance.now() - started;
  const latencies = results.map((result) => result.latencyMs);
  const failures = results.filter((result) => !result.ok);
  const statusCounts = {};
  for (const result of results) {
    const key = result.status == null ? 'network_error' : String(result.status);
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  }
  const errorRate = results.length ? failures.length / results.length : 1;
  const p95Ms = percentile(latencies, 0.95);
  return {
    target: baseUrl.origin,
    paths,
    virtualUsers: results.length,
    requests: results.length,
    failures: failures.length,
    errorRate: Math.round(errorRate * 10_000) / 10_000,
    statusCounts,
    durationMs: Math.round(durationMs * 100) / 100,
    requestsPerSecond: durationMs ? Math.round((results.length / durationMs) * 100_000) / 100 : null,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: p95Ms,
      p99: percentile(latencies, 0.99),
      max: latencies.length ? Math.round(Math.max(...latencies) * 100) / 100 : null,
    },
    failureSamples: failures.slice(0, 10).map(({ status, error, latencyMs }) => ({
      status,
      error,
      latencyMs: Math.round(latencyMs * 100) / 100,
    })),
    thresholds: { maxErrorRate, maxP95Ms },
    passed: errorRate <= maxErrorRate && (p95Ms == null || p95Ms <= maxP95Ms),
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runLoadTest()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.passed) process.exitCode = 1;
    })
    .catch((error) => {
      console.error('[load-test] ' + error.message);
      process.exitCode = 1;
    });
}
