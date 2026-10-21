// callgate web server. Plivo calls these URLs during a phone call.
'use strict';

const express = require('express');
const plivo = require('plivo');
const flow = require('./flow');
const { load } = require('./config');

// Plivo sends the recording link to /recorded and the transcript to /transcribed
// a minute or two later, matched only by call id. Keep the last few recordings
// in memory so the transcript alert can carry the caller and the link.
const RECENT_LIMIT = 200;

function field(body, ...names) {
  for (const n of names) {
    if (body[n] !== undefined && body[n] !== '') return String(body[n]);
  }
  return '';
}

function build(cfg, deps = {}) {
  const sendAlert = deps.sendAlert || defaultAlert(cfg);
  const recent = new Map();

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // Every Plivo request is signed with your auth token. Reject anything that isn't,
  // so nobody else can ring your phone or send you fake voicemail alerts.
  function signed(req, res, next) {
    if (!cfg.checkSignatures) return next();
    const signature = req.get('X-Plivo-Signature-V3');
    const nonce = req.get('X-Plivo-Signature-V3-Nonce');
    const url = cfg.baseUrl + req.originalUrl;
    let ok = false;
    try {
      ok = Boolean(signature && nonce) && plivo.validateV3Signature(req.method, url, nonce, cfg.authToken, signature, req.body || {});
    } catch (e) {
      ok = false;
    }
    if (!ok) return res.status(403).send('Signature check failed');
    return next();
  }

  const xml = (handler) => (req, res) => {
    res.type('application/xml').send(handler({ ...req.query, ...req.body }, cfg));
  };

  app.get('/', (req, res) => res.send('callgate is running'));
  app.post('/answer', signed, xml(flow.answer));
  app.post('/gate', signed, xml(flow.gate));
  app.post('/dial-status', signed, xml(flow.dialStatus));

  // The recording is finished. Alert the owner right away with the link.
  app.post('/recorded', signed, (req, res) => {
    res.type('application/xml').send(flow.recorded(req.body || {}, cfg));
    const b = req.body || {};
    const callId = field(b, 'CallUUID', 'call_uuid');
    const from = field(b, 'From', 'from') || 'unknown caller';
    const link = field(b, 'RecordUrl', 'recording_url');
    const seconds = Math.round(Number(field(b, 'RecordingDurationMs') || 0) / 1000);
    if (callId) {
      recent.set(callId, { from, link });
      if (recent.size > RECENT_LIMIT) recent.delete(recent.keys().next().value);
    }
    sendAlert(`Voicemail from ${from}`, `${seconds ? seconds + ' seconds. ' : ''}${link || '(no recording link)'}`);
  });

  // The transcript arrives later. Plivo sends: transcription, call_uuid, duration, error.
  app.post('/transcribed', signed, (req, res) => {
    res.sendStatus(200);
    const b = req.body || {};
    const callId = field(b, 'call_uuid', 'CallUUID');
    const known = recent.get(callId) || {};
    const text = field(b, 'transcription') || (field(b, 'error') ? 'Transcription failed: ' + field(b, 'error') : '(empty transcript)');
    sendAlert(`Transcript, ${known.from || 'unknown caller'}`, known.link ? `${text}\n\n${known.link}` : text);
  });

  return app;
}

// Voicemail alerts go to the free ntfy app on your phone. No SMS registration needed.
function defaultAlert(cfg) {
  return async (title, body) => {
    if (!cfg.ntfyUrl) return;
    try {
      await fetch(cfg.ntfyUrl, { method: 'POST', headers: { Title: title }, body });
    } catch (e) {
      console.error('Could not send the alert:', e.message);
    }
  };
}

if (require.main === module) {
  const cfg = load();
  build(cfg).listen(cfg.port, () => console.log(`callgate listening on ${cfg.port}`));
}

module.exports = { build, field };
