// Per-client rate limiting. Uses the socket address for direct (LAN)
// connections, but behind the Cloudflare Tunnel cloudflared dials in over
// loopback, so the real client is taken from CF-Connecting-IP. Forwarded
// headers are trusted ONLY from a loopback peer, so a LAN client cannot spoof
// them to dodge the limiter.

function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function clientIp(req) {
  const remote = (req.socket && req.socket.remoteAddress) || '';
  if (isLoopback(remote)) {
    const cf = req.headers && req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim().slice(0, 64);
    const xff = req.headers && req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim().slice(0, 64);
  }
  return remote || 'unknown';
}

// Returns a limiter: limiter(key) === true once the key is over budget.
// sweep() drops expired buckets so the map cannot grow without bound.
function makeLimiter(limit, windowMs) {
  const hits = new Map();
  const fn = (key) => {
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || now > rec.resetAt) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(key, rec);
    }
    rec.count += 1;
    return rec.count > limit;
  };
  fn.sweep = () => {
    const now = Date.now();
    for (const [key, rec] of hits) if (now > rec.resetAt) hits.delete(key);
  };
  return fn;
}

module.exports = { clientIp, makeLimiter };
