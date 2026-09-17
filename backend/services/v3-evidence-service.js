const TTL_MS = Object.freeze({
  'SRS API': 5000,
  'Pull Worker + SRS API': 5000,
  'Push Worker heartbeat': 10000,
  'Transcode Worker heartbeat': 10000,
  'Wangsu API': 30000,
  filesystem: 5000,
  browser: 3000
});

function parseTime(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function ttlFor(source, explicitTtl = null) {
  if (explicitTtl !== null && explicitTtl !== undefined && explicitTtl !== '' && Number.isFinite(Number(explicitTtl)) && Number(explicitTtl) >= 0) return Number(explicitTtl);
  return TTL_MS[source] ?? null;
}

function freshnessFor(observedAt, { source = null, ttl_ms = null, now_ms = Date.now() } = {}) {
  const ts = parseTime(observedAt);
  if (ts === null) return { freshness: 'UNKNOWN', age_ms: null, ttl_ms: ttlFor(source, ttl_ms) };
  const ttl = ttlFor(source, ttl_ms);
  const age = Math.max(0, now_ms - ts);
  if (ttl === null) return { freshness: 'FRESH', age_ms: age, ttl_ms: null };
  return { freshness: age <= ttl ? 'FRESH' : 'STALE', age_ms: age, ttl_ms: ttl };
}

function normalize(evidence = {}, options = {}) {
  const source = evidence.source || options.source || null;
  const observedAt = evidence.observed_at || options.observed_at || null;
  const freshness = freshnessFor(observedAt, {
    source,
    ttl_ms: evidence.ttl_ms ?? options.ttl_ms,
    now_ms: options.now_ms ?? Date.now()
  });
  return {
    ...evidence,
    source,
    provenance: evidence.provenance || source,
    observed_at: observedAt,
    freshness: evidence.freshness === 'UNKNOWN' && !observedAt ? 'UNKNOWN' : freshness.freshness,
    age_ms: freshness.age_ms,
    ttl_ms: freshness.ttl_ms
  };
}

function configured(state = 'CONFIGURED', source = 'configuration') {
  return normalize({ level: 'CONFIGURED', state, source, observed_at: null, freshness: 'UNKNOWN' });
}

function runtime(state, source, observedAt) {
  return normalize({ level: 'RUNTIME', state, source, observed_at: observedAt });
}

function observed(state, source, observedAt) {
  return normalize({ level: 'OBSERVED', state, source, observed_at: observedAt });
}

function remoteVerified(state, source, observedAt) {
  return normalize({ level: 'REMOTE_VERIFIED', state, source, observed_at: observedAt });
}

module.exports = {
  TTL_MS,
  freshnessFor,
  normalize,
  configured,
  runtime,
  observed,
  remoteVerified
};
