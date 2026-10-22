// callgate web server. Plivo calls these URLs during a phone call.
'use strict';

const express = require('express');
const { validateV3Signature } = require('./signature');
const flow = require('./flow');
const { load } = require('./config');

const HOUR = 3600 * 1000;
const RECENT_LIMIT = 200;

function field(body, ...names) {
  for (const n of names) {
    if (body[n] !== undefined && body[n] !== '') return String(body[n]);
  }
  return '';
}

// Only printable ASCII goes in an alert title; ntfy rejects anything else.
function asciiTitle(text) {
  return String(text).replace(/[^\x20-\x7e]/g, '').slice(0, 120) || 'callgate';
}

// One line per webhook with the fields the first live tests need. Never the digits typed.
function logCall(route, b) {
  const keep = ['CallUUID', 'From', 'To', 'ForwardedFrom', 'CallerName', 'CallStatus', 'Direction', 'StirVerification', 'STIRVerification', 'StirAttestation', 'STIRAttestation', 'DialStatus', 'DialHangupCause', 'DialRingStatus', 'HangupCause', 'HangupSource', 'RecordingID', 'RecordingDurationMs', 'call_uuid', 'recording_id', 'error'];
  const out = {};
  for (const k of keep) if (b[k] !== undefined) out[k] = String(b[k]).slice(0, 80);
  console.log(`[call] ${route} ${JSON.stringify(out)}`);
}

// Counts call starts per caller and overall for the last hour. In memory: it resets on
// restart, which is fine for a speed bump.
function makeLimiter(cfg) {
  const perCaller = new Map();
  const all = [];
  const prune = (arr, now) => {
    while (arr.length && now - arr[0] > HOUR) arr.shift();
  };
  return {
    allow(from, now = Date.now()) {
      prune(all, now);
      if (cfg.callsPerHour && all.length >= cfg.callsPerHour) return false;
      let mine = perCaller.get(from);
      if (!mine) {
        mine = [];
        perCaller.set(from, mine);
        if (perCaller.size > 5000) perCaller.delete(perCaller.keys().next().value);
      }
      prune(mine, now);
      if (cfg.callsPerHourPerCaller && from && mine.length >= cfg.callsPerHourPerCaller) return false;
      mine.push(now);
      all.push(now);
      return true;
    },
  };
}

// Voicemail alerts go to the ntfy app on your phone. No SMS registration needed.
function defaultAlert(cfg) {
  return async (title, body) => {
    if (!cfg.ntfyUrl) return;
    const headers = { Title: asciiTitle(title) };
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
  const recent = new Map(); // RecordingID -> { from, link }
  const seen = new Set(); // RecordingID + route, so a repeated callback sends one alert
  let lastWarn = 0;

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

  app.get('/', (req, res) => {
    res.type('text').send(`callgate is running.\nAnswer URL for the Plivo application: ${cfg.baseUrl}/answer\nHangup URL: ${cfg.baseUrl}/hangup\nWhitelist: ${cfg.whitelist.size} numbers.\nSignature checks: ${cfg.checkSignatures ? 'on' : 'OFF'}\n`);
  });

  app.post('/answer', signed, (req, res) => {
    const f = fields(req);
    logCall('answer', f);
    if (flow.isHangupCallback(f)) return xml(res, flow.answer(f, cfg));
    const from = flow.normalize(f.From);
    if (!limiter.allow(from)) {
      console.warn(`[cap] call refused, hourly cap reached (${from ? 'caller ' + from : 'unknown caller'})`);
      return xml(res, flow.overCap(cfg));
    }
    if (from && cfg.whitelist.has(from) && !cfg.whitelistPressKey && cfg.ringAlert) {
      sendAlert('Ringing you', `Known caller ${from}, straight through.`);
    }
    return xml(res, flow.answer(f, cfg));
  });

  // A known caller pressed a key: connect, and tell the owner the ring is real.
  app.post('/whitelist-ok', signed, (req, res) => {
    const f = fields(req);
    logCall('whitelist-ok', f);
    const digits = String(f.Digits || '').trim();
    const from = flow.context(f).from || 'unknown caller';
    if (digits && cfg.ringAlert) sendAlert('Ringing you', `Known caller ${from} pressed a key.`);
    return xml(res, flow.whitelistOk(f, cfg));
  });

  app.post('/gate', signed, (req, res) => {
    const f = fields(req);
    logCall('gate', f);
    const digits = String(f.Digits || '').trim();
    const from = flow.context(f).from || 'unknown caller';
    if (digits && digits !== '1') {
      if (digits === cfg.code) {
        console.log(`[gate] right code from ${from}`);
        if (cfg.ringAlert) sendAlert('Ringing you', `${from} entered the code.`);
      } else {
        console.warn(`[gate] wrong code from ${from}`);
        if (cfg.alertOnCode) sendAlert('Wrong code', `${from} tried a wrong code.`);
      }
    }
    return xml(res, flow.gate(f, cfg));
  });

  app.post('/dial-status', signed, (req, res) => {
    const f = fields(req);
    logCall('dial-status', f);
    return xml(res, flow.dialStatus(f, cfg));
  });

  // The recording is finished (action URL) or ready (callbackUrl). Both land here; one alert.
  app.post('/recorded', signed, (req, res) => {
    const f = fields(req);
    logCall('recorded', f);
    xml(res, flow.recorded(f, cfg));
    const id = field(f, 'RecordingID', 'recording_id') || field(f, 'CallUUID');
    const from = flow.context(f).from || flow.normalize(f.From) || 'unknown caller';
    const link = field(f, 'RecordUrl', 'recording_url');
    const ms = Number(field(f, 'RecordingDurationMs') || 0);
    const silent = ms > 0 && ms <= (cfg.silenceSeconds + 2) * 1000 && !String(f.Digits || '').trim();
    if (id) {
      recent.set(id, { from, link });
      if (recent.size > RECENT_LIMIT) recent.delete(recent.keys().next().value);
      if (seen.has('r:' + id)) return;
      seen.add('r:' + id);
      if (seen.size > RECENT_LIMIT * 4) seen.delete(seen.values().next().value);
    }
    if (silent) {
      if (flow.context(f).held) sendAlert('Silent caller', `${from} waited on the line without speaking, twice. Ended.`);
      else if (cfg.ringAlert) sendAlert('Ringing you', `${from} stayed on the line without speaking.`);
      return;
    }
    sendAlert(`Voicemail from ${from}`, `${ms ? Math.round(ms / 1000) + ' seconds. ' : ''}${link || '(no recording link)'}`);
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

  // Played to the owner before a bridged call connects.
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
  app.listen(cfg.port, host, () => {
    console.log(`[start] callgate listening on ${cfg.port}; whitelist: ${cfg.whitelist.size} numbers; answer URL ${cfg.baseUrl}/answer`);
    if (cfg.startupAlert) defaultAlert(cfg)('callgate started', `Answer URL ${cfg.baseUrl}/answer. Whitelist: ${cfg.whitelist.size} numbers.`);
  });
}

module.exports = { build, field, makeLimiter, asciiTitle };
