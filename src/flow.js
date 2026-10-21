// callgate call flow. Pure functions: request fields in, Plivo XML out.
// No network, no secrets, so every branch is covered by test/flow.test.js.
//
// The path of a call:
//   caller -> your phone (you don't answer) -> carrier forwards -> your Plivo number -> /answer
//   /answer:  whitelisted -> ring you        loop (our own number) -> hang up
//             everyone else -> greeting + code prompt
//   /gate:    right code -> ring you         1, wrong code, or nothing -> voicemail
//   /dial-status: you didn't pick up -> voicemail
//   /recorded: voicemail saved; the transcript arrives later at /transcribed

'use strict';

// Keep the last 10 digits so +1 (205) 555-0100, 12055550100 and 2055550100 all match.
function normalize(number) {
  const digits = String(number || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

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

// Ring the real phone, showing the service number as the caller.
// The service number is saved in the owner's contacts, so an iPhone set to
// silence unknown callers still rings. If nobody answers, /dial-status sends
// the caller to voicemail.
function ringOwner(cfg) {
  return (
    `<Dial callerId="${escapeXml(cfg.serviceNumber)}" timeout="${cfg.ringSeconds}" ` +
    `action="${escapeXml(cfg.baseUrl)}/dial-status" method="POST" redirect="true">` +
    `<Number>${escapeXml(cfg.ownerPhone)}</Number></Dial>`
  );
}

function voicemail(cfg, lead) {
  const intro = lead ? speak(lead, cfg.voice) : '';
  return (
    intro +
    speak('Please leave a message after the tone.', cfg.voice) +
    `<Record action="${escapeXml(cfg.baseUrl)}/recorded" method="POST" ` +
    `maxLength="${cfg.maxMessageSeconds}" timeout="10" playBeep="true" finishOnKey="#" ` +
    `transcriptionType="auto" transcriptionUrl="${escapeXml(cfg.baseUrl)}/transcribed" ` +
    `transcriptionMethod="POST" redirect="true"/>`
    // After the recording Plivo fetches /recorded, which says goodbye and hangs up.
  );
}

// Plivo's Input element waits at most 5 to 60 seconds, and the docs do not say
// whether the clock starts before or after the prompt plays, so leave room for both.
function inputTimeout(cfg) {
  return Math.min(60, Math.max(5, Number(cfg.promptSeconds) || 30));
}

function answer(fields, cfg) {
  const from = normalize(fields.From);

  // Loop guard. When we ring the owner and they don't answer, their carrier
  // forwards OUR call back to us. Hanging up ends that leg; the original
  // caller's Dial then times out and /dial-status sends them to voicemail.
  if (from && (from === normalize(cfg.serviceNumber) || from === normalize(cfg.ownerPhone))) {
    return response('<Hangup reason="busy"/>');
  }

  if (from && cfg.whitelist.has(from)) {
    return response(ringOwner(cfg));
  }

  const prompt =
    `${cfg.greeting} This call may be recorded. ` +
    'If you have the code, enter it now. To leave a message, press 1, or just stay on the line.';

  return response(
    `<GetInput action="${escapeXml(cfg.baseUrl)}/gate" method="POST" inputType="dtmf" ` +
      `numDigits="${Math.max(cfg.code.length, 1)}" digitEndTimeout="5" executionTimeout="${inputTimeout(cfg)}" redirect="true">` +
      speak(prompt, cfg.voice) +
      '</GetInput>' +
      // No keys pressed: the caller stayed on the line. Take a message rather
      // than hang up, so a missed 911 call-back or a real person is never dropped.
      voicemail(cfg)
  );
}

function gate(fields, cfg) {
  const digits = String(fields.Digits || fields.digits || '').trim();
  if (cfg.code && digits === cfg.code) {
    return response(speak('Connecting you now.', cfg.voice) + ringOwner(cfg));
  }
  if (digits === '1' || digits === '') {
    return response(voicemail(cfg));
  }
  return response(voicemail(cfg, 'That code did not match.'));
}

function dialStatus(fields, cfg) {
  const status = String(fields.DialStatus || '').toLowerCase();
  if (status === 'completed') {
    return response('<Hangup/>');
  }
  return response(voicemail(cfg, 'Sorry, they could not answer.'));
}

function recorded(fields, cfg) {
  return response(speak('Thank you. Goodbye.', cfg.voice) + '<Hangup/>');
}

module.exports = { normalize, escapeXml, answer, gate, dialStatus, recorded };
