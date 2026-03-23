'use strict';

/**
 * Simple in-memory sliding-window rate limiter.
 * Two tiers per IP:
 *   - Burst:    max 2 builds per 60 seconds
 *   - Sustained: max 120 builds per hour
 *
 * Legitimate users doing active development rarely exceed 1 build / 30s.
 * These limits only trigger under bot-like or abusive patterns.
 */

const BURST_WINDOW_MS  = 60 * 1000;       // 1 minute
const BURST_MAX        = 20;

const SUSTAINED_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const SUSTAINED_MAX       = 120;

// Map<ip, number[]>  — timestamps of recent build requests
const hits = new Map();

// Periodic cleanup: drop IPs with no activity in the last hour
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - SUSTAINED_WINDOW_MS;
  for (const [ip, timestamps] of hits) {
    // Remove expired entries
    while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
    if (!timestamps.length) hits.delete(ip);
  }
}, CLEANUP_INTERVAL_MS).unref();

/**
 * Express middleware — attach to POST /build only.
 * Returns 429 if either limit is exceeded.
 */
function buildRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();

  if (!hits.has(ip)) hits.set(ip, []);
  const timestamps = hits.get(ip);

  // Prune entries older than the sustained window
  while (timestamps.length && timestamps[0] < now - SUSTAINED_WINDOW_MS) {
    timestamps.shift();
  }

  // Count hits in burst window
  const burstCutoff = now - BURST_WINDOW_MS;
  const burstCount  = timestamps.filter(t => t >= burstCutoff).length;

  if (burstCount >= BURST_MAX) {
    return res.status(429).json({
      ok: false,
      error: `Rate limit exceeded — max ${BURST_MAX} builds per minute. Please wait a moment.`,
    });
  }

  if (timestamps.length >= SUSTAINED_MAX) {
    return res.status(429).json({
      ok: false,
      error: `Rate limit exceeded — max ${SUSTAINED_MAX} builds per hour. Please try again later.`,
    });
  }

  timestamps.push(now);
  next();
}

module.exports = { buildRateLimit };
