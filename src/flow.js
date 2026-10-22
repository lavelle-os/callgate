// callgate call flow. Pure functions: request fields in, Plivo XML out.
// No network, no state, so every branch is covered by test/flow.test.js.
//
// The path of a call:
//   caller -> your phone (you don't answer) -> carrier forwards -> your Plivo number -> /answer
//   /answer:  whitelisted -> press any key -> /whitelist-ok -> ring you
//             loop (our own number calling back) -> hang up busy
//             everyone else -> greeting + code prompt
//   /gate:    right code -> ring you         1, wrong code, or nothing -> voicemail
//   /dial-status: you didn't pick up -> voicemail
//   /recorded: a message was left -> goodbye. Silence after the tone -> ring you once, then goodbye.
//   /confirm: what you hear when the gate rings you: "Call from your gate. <your word>. Press 1."
//             The word proves the call came through the gate; press 1 keeps your own carrier
//             voicemail from taking the call for you.
//
// The server decides whether a ring is allowed (the ring budget) and passes
// { ringAllowed: false } when it is not; the flow then offers voicemail instead.

'use strict';

const { normalize } = require('./config');

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function speak(text, voice) {
  return `<Speak voice="${escapeXml(voice)}">${escapeXml(text)}</Speak>`;
}

function response(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

// Every callback URL carries the caller's digits and the hold count in its query string.
// The query string is inside Plivo's signature, so it cannot be forged, and it survives
// a redeploy, which the in-memory map does not.
function url(cfg, pathname, ctx) {
  const q = [];
  if (ctx && ctx.from) q.push('from=' + ctx.from);
  if (ctx && ctx.held) q.push('held=' + ctx.held);
  return escapeXml(cfg.baseUrl + pathname + (q.length ? '?' + q.join('&') : ''));
}

function context(fields) {
  return {
    from: normalize(fields.from || fields.From),
    held: Number(fields.held || 0) ? 1 : 0,
  };
}

// Plivo sends the end-of-call callback to the answer URL unless a Hangup URL is set.
function isHangupCallback(fields) {
  if (fields.HangupCause || fields.HangupSource) return true;
  const status = String(fields.CallStatus || '').toLowerCase();
  return ['completed', 'busy', 'failed', 'no-answer', 'cancel', 'timeout'].includes(status);
}

// True when this XML rings the owner. The server sends its "Ringing you" alert from this and
// nothing else, so an alert and a ring are always the same event.
function rings(xml) {
  return /<Dial /.test(String(xml));
}

// A whitelisted caller's entry, with its label and whether it may skip the key press.
function whitelistEntry(cfg, from) {
  if (!from || !cfg.whitelist || !cfg.whitelist.has(from)) return null;
  const info = (cfg.whitelistInfo && cfg.whitelistInfo.get(from)) || {};
  return { number: from, label: info.label || '', nokey: !!info.nokey };
}

// Ring the real phone, shown as the gate number (saved in the owner's contacts, so an
// iPhone set to silence unknown callers still rings). With screening on, the owner hears
// the confirm prompt and presses 1, so the owner's own carrier voicemail cannot take the
// call. If nobody presses 1 in time, /dial-status sends the caller to voicemail.
function ringOwner(cfg, ctx) {
  const confirm = cfg.screenOwnerRing
    ? ` confirmSound="${escapeXml(cfg.baseUrl + '/confirm')}" confirmKey="1"`
    : '';
  return (
    `<Dial callerId="${escapeXml(cfg.serviceNumberE164)}" timeout="${cfg.ringSeconds}" timeLimit="${cfg.maxCallSeconds}"` +
    ` action="${url(cfg, '/dial-status', ctx)}" method="POST" redirect="true"${confirm}>` +
    `<Number>${escapeXml(cfg.ownerPhoneE164)}</Number></Dial>`
  );
}

function voicemail(cfg, ctx, lead) {
  const intro = lead ? speak(lead, cfg.voice) : '';
  return (
    intro +
    speak('Your message will be recorded and transcribed. Please speak after the tone, or stay on the line.', cfg.voice) +
    `<Record action="${url(cfg, '/recorded', ctx)}" method="POST" ` +
    `callbackUrl="${url(cfg, '/recorded', ctx)}" callbackMethod="POST" ` +
    `maxLength="${cfg.maxMessageSeconds}" timeout="${cfg.silenceSeconds}" playBeep="true" finishOnKey="#" ` +
    `transcriptionType="auto" transcriptionUrl="${url(cfg, '/transcribed', ctx)}" ` +
    `transcriptionMethod="POST" redirect="true"/>`
    // After the recording Plivo fetches /recorded, which decides what happens next.
  );
}

const BUSY_LEAD = 'Sorry, they cannot take calls right now.';

// Plivo's Input element accepts 5 to 60 seconds for the keypad.
function inputTimeout(cfg) {
  return Math.min(60, Math.max(5, Number(cfg.promptSeconds) || 20));
}

function answer(fields, cfg, opts = {}) {
  if (isHangupCallback(fields)) return response('');
  const ctx = context(fields);

  // Loop guard. When we ring the owner and they don't answer, their carrier forwards OUR
  // call (shown as the gate number) back to us. Refusing it as busy ends that leg, and the
  // original caller's Dial reports a failure, so /dial-status sends them to voicemail.
  if (ctx.from && ctx.from === cfg.serviceNumber) {
    return response('<Hangup reason="busy"/>');
  }

  const known = whitelistEntry(cfg, ctx.from);
  if (known) {
    if (!cfg.whitelistPressKey || known.nokey) {
      return response(opts.ringAllowed === false ? voicemail(cfg, ctx, BUSY_LEAD) : ringOwner(cfg, ctx));
    }
    // A known number still presses one key. Caller ID can be spoofed; a recorded robocall
    // wearing a friend's number presses nothing and lands in voicemail. Any key counts, so
    // finishOnKey is off (a # would otherwise count as no key), and the wait is short.
    return response(
      `<GetInput action="${url(cfg, '/whitelist-ok', ctx)}" method="POST" inputType="dtmf" ` +
        `numDigits="1" finishOnKey="none" executionTimeout="5" retries="1" log="false" redirect="true">` +
        speak(`${cfg.greeting} Press any key.`, cfg.voice) +
        '</GetInput>' +
        voicemail(cfg, ctx)
    );
  }

  const prompt =
    `${cfg.greeting} This call may be recorded and transcribed. ` +
    'If you have the code, enter it now. To leave a message, press 1, or stay on the line.';

  return response(
    `<GetInput action="${url(cfg, '/gate', ctx)}" method="POST" inputType="dtmf" ` +
      `numDigits="${Math.max(cfg.code.length, 1)}" digitEndTimeout="5" executionTimeout="${inputTimeout(cfg)}" ` +
      `retries="1" log="false" redirect="true">` +
      speak(prompt, cfg.voice) +
      '</GetInput>' +
      // No keys pressed: Plivo continues here. The caller is offered voicemail, never a dead line.
      voicemail(cfg, ctx)
  );
}

function gate(fields, cfg, opts = {}) {
  const ctx = context(fields);
  const digits = String(fields.Digits || fields.digits || '').trim();
  if (cfg.code && digits === cfg.code) {
    if (opts.ringAllowed === false) return response(voicemail(cfg, ctx, BUSY_LEAD));
    return response(speak('Connecting you now.', cfg.voice) + ringOwner(cfg, ctx));
  }
  if (digits === '1' || digits === '') {
    return response(voicemail(cfg, ctx));
  }
  return response(voicemail(cfg, ctx, 'That code did not match.'));
}

// A whitelisted caller pressed a key (or did not).
function whitelistOk(fields, cfg, opts = {}) {
  const ctx = context(fields);
  const digits = String(fields.Digits || fields.digits || '').trim();
  if (digits && whitelistEntry(cfg, ctx.from)) {
    if (opts.ringAllowed === false) return response(voicemail(cfg, ctx, BUSY_LEAD));
    return response(speak('Connecting you now.', cfg.voice) + ringOwner(cfg, ctx));
  }
  return response(voicemail(cfg, ctx));
}

function dialStatus(fields, cfg) {
  const ctx = context(fields);
  const status = String(fields.DialStatus || '').toLowerCase();
  if (status === 'completed') {
    return response('<Hangup/>');
  }
  return response(voicemail(cfg, ctx, 'Sorry, they could not answer.'));
}

// What a finished recording means. Plivo's pages do not say whether an all-silent recording
// reports 0 ms or the length of the silence window, so both count as silent. A recording
// shorter than the window is a real message: someone said a few words and hung up. A caller
// whose call has already ended (CallStatus completed) cannot be rung.
function classifyRecording(fields, cfg) {
  const ms = Number(fields.RecordingDurationMs || 0);
  const pressed = String(fields.Digits || '').trim();
  const gone = String(fields.CallStatus || '').toLowerCase() === 'completed';
  const lo = Math.max(0, cfg.silenceSeconds - 1) * 1000;
  const hi = (cfg.silenceSeconds + 2) * 1000;
  const silent = !pressed && !gone && (ms === 0 || (ms >= lo && ms <= hi));
  return { ms, pressed, gone, silent };
}

// A recording is finished. A real message gets a goodbye. Silence after the tone means a
// person waited on the line (or a dispatcher is holding), so ring the owner once more
// before giving up. "held" stops that from looping; the server's ring budget caps it.
function recorded(fields, cfg, opts = {}) {
  const ctx = context(fields);
  const r = classifyRecording(fields, cfg);
  if (r.silent && !ctx.held && opts.ringAllowed !== false) {
    return response(speak('Connecting you now.', cfg.voice) + ringOwner(cfg, { from: ctx.from, held: 1 }));
  }
  if (r.silent) {
    return response(speak('Sorry, I could not reach them. I have sent them a note.', cfg.voice) + '<Hangup/>');
  }
  return response(speak('Thank you. Goodbye.', cfg.voice) + '<Hangup/>');
}

// Played to the owner when the gate rings them, before the call is bridged. The word is the
// proof: only Plivo can play it into a call that is really bridged through the gate.
function confirm(fields, cfg) {
  const word = cfg.ownerWord ? ` ${cfg.ownerWord}.` : '';
  return response(speak(`Call from your gate.${word} Press 1 to take it.`, cfg.voice));
}

// Too many calls this hour: say so and end it cheaply.
function overCap(cfg) {
  return response(speak('This line is busy. Please try again later.', cfg.voice) + '<Hangup/>');
}

module.exports = { normalize, escapeXml, isHangupCallback, context, rings, whitelistEntry, classifyRecording, answer, gate, whitelistOk, dialStatus, recorded, confirm, overCap };
