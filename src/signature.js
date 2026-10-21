// Plivo's V3 request signature, implemented locally so the runtime does not need the Plivo SDK
// (whose own dependencies carry old, unrelated vulnerabilities). The scheme, read from the
// SDK's v3Security.js and Plivo's signature-validation page:
//   base = scheme://host[:port]/path
//   GET:  if any query params: base + '?' + sorted "k=v&k=v"
//   POST: if query or body params: base + '?' + sorted query; if both: + '.'; then sorted "k" + "v" joined
//   signature = base64( HMAC-SHA256(auth token, base + '.' + nonce) )
// test/flow.test.js checks this against the SDK's own validator.
'use strict';

const crypto = require('crypto');

function toMap(entries) {
  const map = {};
  for (const [k, v] of entries) {
    const vals = Array.isArray(v) ? v.map(String) : [String(v)];
    map[k] = (map[k] || []).concat(vals);
  }
  return map;
}

function sortedQuery(map) {
  return Object.keys(map)
    .sort()
    .flatMap((k) => [...map[k]].sort().map((v) => `${k}=${v}`))
    .join('&');
}

function sortedParams(map) {
  return Object.keys(map)
    .sort()
    .flatMap((k) => [...map[k]].sort().map((v) => `${k}${v}`))
    .join('');
}

function baseString(method, uri, params) {
  const u = new URL(uri);
  const base = `${u.protocol}//${u.host}${u.pathname}`;
  const query = toMap([...u.searchParams.entries()]);
  const body = toMap(Object.entries(params || {}));
  if (method === 'GET') {
    const merged = toMap([...u.searchParams.entries(), ...Object.entries(params || {})]);
    const q = sortedQuery(merged);
    return q ? `${base}?${q}` : base;
  }
  if (method === 'POST') {
    const q = sortedQuery(query);
    const empty = Object.keys(body).length === 0;
    let out = base;
    if (q || !empty) out += '?' + q;
    if (q && !empty) out += '.';
    return out + sortedParams(body);
  }
  throw new Error('Only GET and POST are signed');
}

function sign(method, uri, nonce, authToken, params) {
  return crypto.createHmac('sha256', authToken).update(baseString(method, uri, params) + '.' + nonce).digest('base64');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function validateV3Signature(method, uri, nonce, authToken, signature, params = {}) {
  if (!signature || !nonce || !authToken) return false;
  let expected;
  try {
    expected = sign(method, uri, nonce, authToken, params);
  } catch (e) {
    return false;
  }
  return String(signature)
    .split(',')
    .some((s) => safeEqual(s, expected));
}

module.exports = { validateV3Signature, sign, baseString };
