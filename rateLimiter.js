/**
 * middleware/rateLimiter.js — lightweight in-memory sliding-window limiter
 * to blunt spam / brute-force / basic DoS traffic. Zero external deps.
 * (For multi-instance deployments put a real limiter / WAF in front.)
 */
function makeRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const hits = new Map(); // ip -> [timestamps]

  // Periodic cleanup so the map cannot grow forever
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, times] of hits) {
      const alive = times.filter((t) => t > cutoff);
      if (alive.length) hits.set(ip, alive);
      else hits.delete(ip);
    }
  }, windowMs).unref();

  return function rateLimiter(req, res, next) {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    const now = Date.now();
    const times = (hits.get(ip) || []).filter((t) => t > now - windowMs);
    if (times.length >= max) {
      res.set('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: 'Too many requests, slow down' });
    }
    times.push(now);
    hits.set(ip, times);
    next();
  };
}

module.exports = { makeRateLimiter };
