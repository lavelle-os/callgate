// callgate web server. Plivo calls these URLs during a phone call.
'use strict';

const express = require('express');
const { validateV3Signature } = require('./signature');
const flow = require('./flow');
const { load } = require('./config');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const RECENT_LIMIT = 200;
const ALERT_WAIT_MS = 2000;

function field(body, ...names) {
  for (const n of names) {
    if (body[n] !== undefined && body[n] !== '') return String(body[n]);
  }
  return '';
}

// Printable ASCII only, for alert titles and log lines: ntfy rejects anything else in a
// title, and a caller's name field must not be able to fake a log line.
function clean(text, max = 80) {
  return String(text).replace(/[^\x20-\x7e]/g, '').slice(0, max);
}

function asciiTitle(text) {
  return clean(text, 120) || 'callgate';
}

// One line per webhook with the fields the first live tests need. Never the digits typed.
function logCall(route, b) {
  const keep = ['CallUUID', 'From', 'To', 'ForwardedFrom', 'CallerName', 'CallStatus', 'Direction', 'StirVerification', 'STIRVerification', 'StirAttestation', 'STIRAttestation', 'DialStatus', 'DialHangupCause', 'DialRingStatus', 'HangupCause', 'HangupSource', 'RecordingID', 'RecordingDurationMs', 'call_uuid', 'recording_id', 'error'];
  const out = {};
  for (const k of keep) if (b[k] !== undefined) out[k] = clean(b[k]);
  console.log(`[call] ${route} ${JSON.stringify(out)}`);
}

function prune(arr, now, window) {
  while (arr.length && now - arr[0] > window) arr.shift();
}

// Counts call starts per caller and overall for the last hour. In memory: it resets on
// restart, which is fine for a speed bump. A withheld caller ID counts as one shared caller.
// Known callers are counted per number but not against the overall total, so a flood of
// strangers cannot lock family out.
function makeLimiter(cfg) {
  const perCaller = new Map();
  const all = [];
  return {
    allow(from, now = Date.now(), opts = {}) {
      const key = from || 'unknown';
      prune(all, now, HOUR);
      if (!opts.skipGlobal && cfg.callsPerHour && all.length >= cfg.callsPerHour) return false;
      let mine = perCaller.get(key);
      if (!mine) {
        mine = [];
        perCaller.set(key, mine);
        if (perCaller.size > 5000) perCaller.delete(perCaller.keys().next().value);
      }
      prune(mine, now, HOUR);
      if (cfg.callsPerHourPerCaller && mine.length >= cfg.callsPerHourPerCaller) return false;
      mine.push(now);
      if (!opts.skipGlobal) all.push(now);
      return true;
    },
    count(now = Date.now()) {
      prune(all, now, HOUR);
      return all.length;
    },
  };
}

// Counts the times the gate rings the owner: a budget per hour on every path together, and
// for the silent-line path (which needs no code and no whitelist) one ring per caller per day.
function makeRingBudget(cfg) {
  const rings = [];
  const silentByCaller = new Map();
  return {
    allow(kind, from, now = Date.now()) {
      prune(rings, now, HOUR);
      if (cfg.ringsPerHour && rings.length >= cfg.ringsPerHour) return false;
      if (kind === 'silent' && cfg.silentRingsPerDay) {
        const key = from || 'unknown';
        let mine = silentByCaller.get(key);
        if (!mine) {
          mine = [];
          silentByCaller.set(key, mine);
          if (silentByCaller.size > 5000) silentByCaller.delete(silentByCaller.keys().next().value);
        }
        prune(mine, now, DAY);
        if (mine.length >= cfg.silentRingsPerDay) return false;
        mine.push(now);
      }
      rings.push(now);
      return true;
    },
    count(now = Date.now()) {
      prune(rings, now, HOUR);
      return rings.length;
    },
  };
}

// Alerts go to the ntfy app on your phone. No SMS registration needed.
function defaultAlert(cfg) {
  return async (title, body, opts = {}) => {
    if (!cfg.ntfyUrl) return;
    const headers = { Title: asciiTitle(title) };
    if (opts.priority) headers.Priority = String(opts.priority);
    if (cfg.ntfyToken) headers.Authorization = 'Bearer ' + cfg.ntfyToken;
    try {
      const res = await fetch(cfg.ntfyUrl, { method: 'POST', headers, body: String(body).slice(0, 4000), signal: AbortSignal.timeout(5000) });
      if (!res.ok) console.error(`[alert] ntfy answered ${res.status}`);
    } catch (e) {
      console.error('[alert] could not send:', e.message);
    }
  };
}

function build(cfg, deps = {}) {
  const sendAlert = deps.sendAlert || defaultAlert(cfg);
  const limiter = deps.limiter || makeLimiter(cfg);
  const budget = deps.ringBudget || makeRingBudget(cfg);
  const recent = new Map(); // RecordingID -> { from, link }
  const seen = new Set(); // RecordingID + route, so a repeated callback sends one alert
  const keysLogged = new Set();
  let lastWarn = 0;
  let capAlertAt = 0;
  let budgetAlertAt = 0;

  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));

  // Every Plivo request is signed with your auth token. Reject anything that isn't,
  // so nobody else can ring your phone or send you fake voicemail alerts.
  function signed(req, res, next) {
    if (!cfg.checkSignatures) return next();
    const signature = req.get('X-Plivo-Signature-V3');
    const nonce = req.get('X-Plivo-Signature-V3-Nonce');
    const fullUrl = cfg.baseUrl + req.originalUrl;
    let ok = false;
    try {
      ok = validateV3Signature(req.method, fullUrl, nonce, cfg.authToken, signature, req.method === 'POST' ? req.body || {} : {});
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      const now = Date.now();
      if (now - lastWarn > 60000) {
        lastWarn = now;
        console.warn(`[signature] rejected ${req.method} ${req.path}. The server compared against ${fullUrl}. If this is Plivo, BASE_URL must match the console answer URL exactly, and the token must be the one for the account or subaccount that owns the number.`);
      }
      return res.status(403).type('text').send('Signature check failed');
    }
    return next();
  }

  const fields = (req) => ({ ...req.query, ...req.body });
  const xml = (res, body) => res.type('application/xml').send(body);

  // The names of the fields Plivo sends, once per route, so the first live call shows which
  // STIR/SHAKEN field (if any) arrives. Names only, never values.
  function logKeysOnce(route, b) {
    if (keysLogged.has(route)) return;
    keysLogged.add(route);
    console.log(`[keys] ${route}: ${Object.keys(b).sort().map((k) => clean(k, 40)).join(',')}`);
  }

  // A "Ringing you" alert is sent BEFORE the Dial XML goes back, and waited for up to two
  // seconds, so it is on its way before the phone rings. It fails open: a dead ntfy must not
  // stop a real caller from reaching the owner. The proof of a ring is the word in the call.
  async function ringAlert(body) {
    if (!cfg.ringAlert) return;
    let timer;
    const wait = new Promise((resolve) => {
      timer = setTimeout(resolve, ALERT_WAIT_MS);
      if (timer.unref) timer.unref();
    });
    try {
      await Promise.race([sendAlert('Ringing you', body, { priority: 'high' }), wait]);
    } catch (e) {
      console.error('[alert] ring alert failed:', e.message);
    } finally {
      clearTimeout(timer);
    }
  }

  // One alert per hour when the cap or the ring budget starts refusing, so a flood is seen.
  function capAlert() {
    const now = Date.now();
    if (now - capAlertAt < HOUR) return;
    capAlertAt = now;
    const until = new Date(now + HOUR).toISOString().slice(11, 16);
    sendAlert('Call cap reached', `${limiter.count(now)} calls this hour. New callers are refused until about ${until} UTC. Known callers are not counted against the total.`);
  }
  function budgetAlert() {
    const now = Date.now();
    if (now - budgetAlertAt < HOUR) return;
    budgetAlertAt = now;
    const until = new Date(now + HOUR).toISOString().slice(11, 16);
    sendAlert('Ring budget reached', `The gate has rung you ${budget.count(now)} times this hour. Further callers go to voicemail until about ${until} UTC.`);
  }

  const callerName = (from) => {
    const known = flow.whitelistEntry(cfg, from);
    if (known && known.label) return `${known.label} (${known.number})`;
    return from || 'unknown caller';
  };

  app.get('/', (req, res) => {
    res.type('text').send(
      `callgate is running.\nAnswer URL for the Plivo application: ${cfg.baseUrl}/answer\nHangup URL: ${cfg.baseUrl}/hangup\n` +
        `Whitelist: ${cfg.whitelist.size} numbers.\nSignature checks: ${cfg.checkSignatures ? 'on' : 'OFF'}\nRing alerts: ${cfg.ringAlert ? 'on' : 'OFF'}\n`
    );
  });

  app.post('/answer', signed, async (req, res) => {
    const f = fields(req);
    logCall('answer', f);
    logKeysOnce('answer', f);
    if (flow.isHangupCallback(f)) return xml(res, flow.answer(f, cfg));
    const from = flow.normalize(f.From);
    // The loop guard comes before the caps, so the gate's own ring coming back never counts.
    if (from && from === cfg.serviceNumber) return xml(res, flow.answer(f, cfg));
    const known = flow.whitelistEntry(cfg, from);
    if (!limiter.allow(from, Date.now(), { skipGlobal: !!known })) {
      console.warn(`[cap] call refused, hourly cap reached (${from ? 'caller ' + from : 'unknown caller'})`);
      capAlert();
      return xml(res, flow.overCap(cfg));
    }
    const direct = known && (!cfg.whitelistPressKey || known.nokey);
    const ringAllowed = direct ? budget.allow('known', from) : true;
    const out = flow.answer(f, cfg, { ringAllowed });
    if (flow.rings(out)) await ringAlert(`Known caller ${callerName(from)}, straight through.`);
    else if (direct && !ringAllowed) budgetAlert();
    return xml(res, out);
  });

  // A known caller pressed a key: connect, and tell the owner the ring is coming.
  app.post('/whitelist-ok', signed, async (req, res) => {
    const f = fields(req);
    logCall('whitelist-ok', f);
    const digits = String(f.Digits || '').trim();
    const from = flow.context(f).from;
    const willRing = !!digits && !!flow.whitelistEntry(cfg, from);
    const ringAllowed = willRing ? budget.allow('known', from) : true;
    const out = flow.whitelistOk(f, cfg, { ringAllowed });
    if (flow.rings(out)) await ringAlert(`Known caller ${callerName(from)} pressed a key.`);
    else if (willRing && !ringAllowed) budgetAlert();
    return xml(res, out);
  });

  app.post('/gate', signed, async (req, res) => {
    const f = fields(req);
    logCall('gate', f);
    const digits = String(f.Digits || '').trim();
    const from = flow.context(f).from;
    const willRing = !!cfg.code && digits === cfg.code;
    if (digits && digits !== '1' && !willRing) {
      console.warn(`[gate] wrong code from ${from || 'unknown caller'}`);
      if (cfg.alertOnCode) sendAlert('Wrong code', `${from || 'unknown caller'} tried a wrong code.`);
    }
    const ringAllowed = willRing ? budget.allow('code', from) : true;
    const out = flow.gate(f, cfg, { ringAllowed });
    if (flow.rings(out)) {
      console.log(`[gate] right code from ${from || 'unknown caller'}`);
      await ringAlert(`${from || 'unknown caller'} entered the code.`);
    } else if (willRing && !ringAllowed) budgetAlert();
    return xml(res, out);
  });

  app.post('/dial-status', signed, (req, res) => {
    const f = fields(req);
    logCall('dial-status', f);
    return xml(res, flow.dialStatus(f, cfg));
  });

  // The recording is finished (action URL) or ready (callbackUrl). Both land here. The ring
  // decision and the alert come from the same classification, so they cannot disagree.
  app.post('/recorded', signed, async (req, res) => {
    const f = fields(req);
    logCall('recorded', f);
    const ctx = flow.context(f);
    const from = ctx.from || flow.normalize(f.From) || 'unknown caller';
    const r = flow.classifyRecording(f, cfg);
    const willRing = r.silent && !ctx.held;
    const ringAllowed = willRing ? budget.allow('silent', ctx.from) : true;
    const out = flow.recorded(f, cfg, { ringAllowed });

    const id = field(f, 'RecordingID', 'recording_id') || field(f, 'CallUUID');
    const link = field(f, 'RecordUrl', 'recording_url');
    let first = true;
    if (id) {
      recent.set(id, { from, link });
      if (recent.size > RECENT_LIMIT) recent.delete(recent.keys().next().value);
      first = !seen.has('r:' + id);
      seen.add('r:' + id);
      if (seen.size > RECENT_LIMIT * 4) seen.delete(seen.values().next().value);
    }

    if (flow.rings(out)) {
      await ringAlert(`${from} stayed on the line without speaking.`);
      return xml(res, out);
    }
    xml(res, out);
    if (!first) return;
    if (r.silent && ctx.held) sendAlert('Silent caller', `${from} waited on the line without speaking, twice. Ended.`);
    else if (r.silent) budgetAlert();
    else sendAlert(`Voicemail from ${from}`, `${r.ms ? Math.round(r.ms / 1000) + ' seconds. ' : ''}${link || '(no recording link)'}`);
  });

  // The transcript arrives later. Plivo sends: transcription, recording_id, call_uuid, duration, error.
  app.post('/transcribed', signed, (req, res) => {
    const f = fields(req);
    logCall('transcribed', f);
    res.sendStatus(200);
    const id = field(f, 'recording_id', 'RecordingID');
    if (id) {
      if (seen.has('t:' + id)) return;
      seen.add('t:' + id);
    }
    const known = (id && recent.get(id)) || {};
    const from = flow.context(f).from || known.from || 'unknown caller';
    const err = field(f, 'error');
    const text = field(f, 'transcription') || (err ? 'Transcription failed: ' + err : '(empty transcript)');
    sendAlert(`Transcript, ${from}`, known.link ? `${text}\n\n${known.link}` : text);
  });

  // Set as the Plivo application's Hangup URL so end-of-call callbacks stay out of /answer.
  app.post('/hangup', signed, (req, res) => {
    logCall('hangup', fields(req));
    res.sendStatus(200);
  });

  // Played to the owner before a bridged call connects. Carries the owner's word.
  const confirmHandler = (req, res) => xml(res, flow.confirm(fields(req), cfg));
  app.get('/confirm', signed, confirmHandler);
  app.post('/confirm', signed, confirmHandler);

  // Plain-text errors, no stack traces to strangers.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err.message);
    res.status(err.status || 500).type('text').send('callgate error');
  });

  return app;
}

if (require.main === module) {
  const cfg = load();
  const app = build(cfg);
  const host = !cfg.checkSignatures && !cfg.testing ? '127.0.0.1' : undefined;
  if (host) console.warn('[start] CHECK_SIGNATURES=false, so the server listens on 127.0.0.1 only. Never run a public server this way.');
  if (!cfg.ringAlert) console.warn('[start] RING_ALERT=false: no heads-up when the gate rings you. The word in the confirm prompt is still the proof.');
  app.listen(cfg.port, host, () => {
    console.log(`[start] callgate listening on ${cfg.port}; whitelist: ${cfg.whitelist.size} numbers; answer URL ${cfg.baseUrl}/answer`);
    if (cfg.startupAlert) defaultAlert(cfg)('callgate started', `Answer URL ${cfg.baseUrl}/answer. Whitelist: ${cfg.whitelist.size} numbers.`);
  });
}

module.exports = { build, field, makeLimiter, makeRingBudget, asciiTitle, clean };
