'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const flow = require('../src/flow');
const { load, normalize } = require('../src/config');
const { build, makeLimiter, asciiTitle } = require('../src/server');

const cfg = {
  ownerPhone: '2055550100',
  serviceNumber: '2055550199',
  ownerPhoneE164: '+12055550100',
  serviceNumberE164: '+12055550199',
  code: '4321',
  baseUrl: 'https://gate.example.com',
  greeting: 'You have reached Pat.',
  voice: 'WOMAN',
  ringSeconds: 15,
  promptSeconds: 10,
  silenceSeconds: 10,
  maxMessageSeconds: 120,
  maxCallSeconds: 1800,
  callsPerHourPerCaller: 3,
  callsPerHour: 100,
  screenOwnerRing: true,
  alertOnCode: true,
  whitelist: new Set(['2055550111']),
  checkSignatures: false,
  testing: true,
};

const STRANGER = { From: '13125550123' };

// Mirrors plivo-node's V3 scheme for a POST with no query string:
// base = url + '?' + sorted key+value pairs joined, then '.' + nonce, HMAC-SHA256, base64.
function signPost(url, params, nonce, token) {
  const sorted = Object.keys(params).sort().map((k) => k + params[k]).join('');
  const base = `${url}?${sorted}.${nonce}`;
  return crypto.createHmac('sha256', token).update(base).digest('base64');
}

test('numbers in different formats match, and 11-digit forms drop the leading 1', () => {
  assert.strictEqual(normalize('+1 (205) 555-0100'), '2055550100');
  assert.strictEqual(normalize('12055550100'), '2055550100');
  assert.strictEqual(normalize('2055550100'), '2055550100');
});

test('settings: phone numbers are checked and turned into E.164 for Plivo', () => {
  const c = load({ NODE_ENV: 'test', OWNER_PHONE: '(205) 555-0100', SERVICE_NUMBER: '1-205-555-0199', GATE_CODE: '4321' });
  assert.strictEqual(c.ownerPhoneE164, '+12055550100');
  assert.strictEqual(c.serviceNumberE164, '+12055550199');
  assert.throws(() => load({ NODE_ENV: 'test', OWNER_PHONE: '555-0100' }), /10-digit/);
  assert.throws(() => load({ NODE_ENV: 'test', OWNER_PHONE: '2055550100', SERVICE_NUMBER: '2055550100' }), /different/);
});

test('settings: a bad code is refused, and a weak one outside tests', () => {
  assert.throws(() => load({ NODE_ENV: 'test', GATE_CODE: '12ab' }), /4 to 8 digits/);
  assert.throws(() => load({ NODE_ENV: 'test', GATE_CODE: '123' }), /4 to 8 digits/);
  const prod = { OWNER_PHONE: '2055550100', SERVICE_NUMBER: '2055550199', BASE_URL: 'https://gate.example.com', PLIVO_AUTH_TOKEN: 'tok' };
  assert.throws(() => load({ ...prod, GATE_CODE: '1234' }), /too easy/);
  assert.throws(() => load({ ...prod, GATE_CODE: '7777' }), /too easy/);
  assert.doesNotThrow(() => load({ ...prod, GATE_CODE: '8305' }));
});

test('settings: timing values must be whole numbers in range', () => {
  assert.throws(() => load({ NODE_ENV: 'test', RING_SECONDS: 'abc' }), /RING_SECONDS/);
  assert.throws(() => load({ NODE_ENV: 'test', MAX_MESSAGE_SECONDS: '0' }), /MAX_MESSAGE_SECONDS/);
  assert.strictEqual(load({ NODE_ENV: 'test', RING_SECONDS: '12' }).ringSeconds, 12);
});

test('settings: placeholder or short ntfy topics are refused outside tests', () => {
  const prod = { OWNER_PHONE: '2055550100', SERVICE_NUMBER: '2055550199', BASE_URL: 'https://gate.example.com', PLIVO_AUTH_TOKEN: 'tok', GATE_CODE: '8305' };
  assert.throws(() => load({ ...prod, NTFY_URL: 'https://ntfy.sh/replace-with-a-long-random-topic' }), /placeholder/);
  assert.throws(() => load({ ...prod, NTFY_URL: 'https://ntfy.sh/short' }), /too short/);
  assert.doesNotThrow(() => load({ ...prod, NTFY_URL: 'https://ntfy.sh/9f1c2b7e4d8a6c0b1e2f3a4b5c6d7e8f' }));
});

test('settings: whitelist comes from the WHITELIST variable as well as the file', () => {
  const c = load({ NODE_ENV: 'test', WHITELIST: '(205) 555-0111, 12055550122\n2055550133', WHITELIST_FILE: '/nonexistent' });
  assert.deepStrictEqual([...c.whitelist].sort(), ['2055550111', '2055550122', '2055550133']);
});

test('a whitelisted caller rings straight through, in E.164, shown as the gate number, with screening', () => {
  const x = flow.answer({ From: '12055550111' }, cfg);
  assert.match(x, /<Dial callerId="\+12055550199" timeout="15" timeLimit="1800"/);
  assert.match(x, /confirmSound="https:\/\/gate.example.com\/confirm" confirmKey="1"/);
  assert.match(x, /<Number>\+12055550100<\/Number>/);
  assert.match(x, /action="https:\/\/gate.example.com\/dial-status\?from=2055550111"/);
  assert.doesNotMatch(x, /GetInput/);
});

test('screening can be turned off', () => {
  const x = flow.answer({ From: '12055550111' }, { ...cfg, screenOwnerRing: false });
  assert.doesNotMatch(x, /confirmKey/);
});

test('an unknown caller hears the greeting and the code prompt, and the digits are not logged', () => {
  const x = flow.answer(STRANGER, cfg);
  assert.match(x, /<GetInput action="https:\/\/gate.example.com\/gate\?from=3125550123"/);
  assert.match(x, /numDigits="4"/);
  assert.match(x, /retries="1" log="false"/);
  assert.match(x, /You have reached Pat\. This call may be recorded and transcribed\./);
});

test('an unknown caller who presses nothing is offered voicemail with the recording notice', () => {
  const x = flow.answer(STRANGER, cfg);
  const afterPrompt = x.split('</GetInput>')[1];
  assert.match(afterPrompt, /recorded and transcribed/);
  assert.match(afterPrompt, /<Record action="https:\/\/gate.example.com\/recorded\?from=3125550123"/);
  assert.match(afterPrompt, /callbackUrl="https:\/\/gate.example.com\/recorded\?from=3125550123"/);
  assert.match(afterPrompt, /timeout="10" playBeep="true"/);
  assert.match(afterPrompt, /transcriptionUrl="https:\/\/gate.example.com\/transcribed\?from=3125550123"/);
});

test('every voicemail carries the recording notice, including after a failed ring', () => {
  for (const x of [flow.gate({ Digits: '1' }, cfg), flow.dialStatus({ DialStatus: 'no-answer' }, cfg), flow.gate({ Digits: '9999' }, cfg)]) {
    assert.match(x, /recorded and transcribed[^<]*<\/Speak><Record /);
  }
});

test('our own gate number calling back is refused as busy (loop guard), but the owner is not', () => {
  assert.match(flow.answer({ From: '12055550199' }, cfg), /<Hangup reason="busy"\/>/);
  assert.match(flow.answer({ From: '2055550100' }, cfg), /<GetInput/);
});

test('an end-of-call callback that lands on /answer gets an empty response', () => {
  assert.strictEqual(flow.answer({ From: '13125550123', CallStatus: 'completed', HangupCause: 'NORMAL_CLEARING' }, cfg), '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  assert.ok(flow.isHangupCallback({ CallStatus: 'busy' }));
  assert.ok(!flow.isHangupCallback({ CallStatus: 'ringing' }));
});

test('the right code rings the owner', () => {
  const x = flow.gate({ Digits: '4321', from: '3125550123' }, cfg);
  assert.match(x, /Connecting you now/);
  assert.match(x, /<Dial [^>]*action="https:\/\/gate.example.com\/dial-status\?from=3125550123"/);
});

test('pressing 1, nothing, or a wrong code goes to voicemail', () => {
  assert.match(flow.gate({ Digits: '1' }, cfg), /<Record /);
  assert.match(flow.gate({ Digits: '' }, cfg), /<Record /);
  const wrong = flow.gate({ Digits: '9999' }, cfg);
  assert.match(wrong, /That code did not match/);
  assert.match(wrong, /<Record /);
  assert.doesNotMatch(wrong, /<Dial /);
});

test('if the owner takes the call, it ends afterwards; otherwise the caller goes to voicemail', () => {
  assert.match(flow.dialStatus({ DialStatus: 'completed' }, cfg), /<Hangup\/>/);
  for (const s of ['no-answer', 'busy', 'timeout', 'failed', 'cancel']) {
    assert.match(flow.dialStatus({ DialStatus: s, from: '3125550123' }, cfg), /<Record action="https:\/\/gate.example.com\/recorded\?from=3125550123"/, s);
  }
});

test('a real message ends with goodbye', () => {
  const x = flow.recorded({ RecordingDurationMs: '34000', from: '3125550123' }, cfg);
  assert.match(x, /Thank you\. Goodbye\./);
  assert.match(x, /<Hangup\/>/);
  assert.doesNotMatch(x, /<Dial /);
});

test('silence after the tone rings the owner once, then ends', () => {
  const first = flow.recorded({ RecordingDurationMs: '10500', from: '3125550123' }, cfg);
  assert.match(first, /Connecting you now/);
  assert.match(first, /<Dial [^>]*action="https:\/\/gate.example.com\/dial-status\?from=3125550123&amp;held=1"/);
  const second = flow.recorded({ RecordingDurationMs: '10500', from: '3125550123', held: '1' }, cfg);
  assert.match(second, /Goodbye/);
  assert.doesNotMatch(second, /<Dial /);
  const unknownLength = flow.recorded({ from: '3125550123' }, cfg);
  assert.doesNotMatch(unknownLength, /<Dial /);
});

test('the owner hears a press-1 prompt before a bridged call connects', () => {
  assert.match(flow.confirm({}, cfg), /Press 1 to take it/);
});

test('the input timeout stays inside the range Plivo accepts (5 to 60 seconds)', () => {
  assert.match(flow.answer(STRANGER, { ...cfg, promptSeconds: 2 }), /executionTimeout="5"/);
  assert.match(flow.answer(STRANGER, { ...cfg, promptSeconds: 500 }), /executionTimeout="60"/);
  assert.match(flow.answer(STRANGER, { ...cfg, promptSeconds: 10 }), /executionTimeout="10"/);
});

test('greeting text is escaped so it cannot break the XML', () => {
  const x = flow.answer(STRANGER, { ...cfg, greeting: 'Tom & Jerry <home>' });
  assert.match(x, /Tom &amp; Jerry &lt;home&gt;/);
});

test('the hourly caps count call starts per caller and overall', () => {
  const lim = makeLimiter({ callsPerHourPerCaller: 2, callsPerHour: 3 });
  const t = 1_000_000_000_000;
  assert.ok(lim.allow('3125550123', t));
  assert.ok(lim.allow('3125550123', t + 1));
  assert.ok(!lim.allow('3125550123', t + 2));
  assert.ok(lim.allow('3125550124', t + 3));
  assert.ok(!lim.allow('3125550125', t + 4));
  assert.ok(lim.allow('3125550125', t + 3600 * 1000 + 10));
});

test('alert titles are plain ASCII', () => {
  assert.strictEqual(asciiTitle('Voicemail from 3125550123 ☃'), 'Voicemail from 3125550123 ');
});

async function withServer(c, deps, fn) {
  const server = build(c, deps).listen(0);
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

const post = (url, body, headers = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body });

test('server: an unsigned request is refused, a correctly signed one is answered', async () => {
  const token = 'secret-token';
  // The server signs over BASE_URL + path, so BASE_URL has to be this server's own address.
  const c = { ...cfg, authToken: token, checkSignatures: true };
  const server = build(c).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  c.baseUrl = base;
  try {
    const bad = await post(`${base}/answer`, 'From=13125550123');
    assert.strictEqual(bad.status, 403);
    const nonce = 'abc123';
    const sig = signPost(`${base}/answer`, { From: '13125550123' }, nonce, token);
    const good = await post(`${base}/answer`, 'From=13125550123', { 'X-Plivo-Signature-V3': sig, 'X-Plivo-Signature-V3-Nonce': nonce });
    assert.strictEqual(good.status, 200);
    assert.match(await good.text(), /<GetInput/);
    const forged = await post(`${base}/answer`, 'From=13125550123', { 'X-Plivo-Signature-V3': sig + 'x', 'X-Plivo-Signature-V3-Nonce': nonce });
    assert.strictEqual(forged.status, 403);
    const wrongPath = await post(`${base}/gate`, 'From=13125550123', { 'X-Plivo-Signature-V3': sig, 'X-Plivo-Signature-V3-Nonce': nonce });
    assert.strictEqual(wrongPath.status, 403);
  } finally {
    server.close();
  }
});

test('server: with checks off (local testing) /answer returns call XML and the caps apply', async () => {
  await withServer({ ...cfg, callsPerHourPerCaller: 2 }, {}, async (origin) => {
    for (let i = 0; i < 2; i++) {
      const r = await post(`${origin}/answer`, 'From=13125550123');
      assert.strictEqual(r.status, 200);
      assert.match(await r.text(), /<GetInput/);
    }
    const capped = await post(`${origin}/answer`, 'From=13125550123');
    assert.match(await capped.text(), /This line is busy/);
    const hang = await post(`${origin}/answer`, 'From=13125550123&CallStatus=completed&HangupCause=NORMAL_CLEARING');
    assert.match(await hang.text(), /<Response><\/Response>/);
  });
});

test('server: wrong and right codes send alerts, a recording sends one alert even if Plivo calls twice', async () => {
  const alerts = [];
  const sendAlert = async (title, body) => alerts.push(title + ' | ' + body);
  await withServer(cfg, { sendAlert }, async (origin) => {
    await post(`${origin}/gate?from=3125550123`, 'Digits=9999');
    await post(`${origin}/gate?from=3125550123`, 'Digits=4321');
    await post(`${origin}/recorded?from=3125550123`, 'RecordingID=rec1&RecordUrl=https://media.example.com/rec1.mp3&RecordingDurationMs=34000');
    await post(`${origin}/recorded?from=3125550123`, 'RecordingID=rec1&RecordUrl=https://media.example.com/rec1.mp3&RecordingDurationMs=34000');
    await post(`${origin}/transcribed?from=3125550123`, 'recording_id=rec1&transcription=Call+me+back');
    const hang = await post(`${origin}/hangup`, 'CallUUID=x&HangupCause=NORMAL_CLEARING');
    assert.strictEqual(hang.status, 200);
  });
  assert.deepStrictEqual(alerts, [
    'Wrong code | 3125550123 tried a wrong code.',
    'Gate opened | 3125550123 entered the code and is ringing you.',
    'Voicemail from 3125550123 | 34 seconds. https://media.example.com/rec1.mp3',
    'Transcript, 3125550123 | Call me back\n\nhttps://media.example.com/rec1.mp3',
  ]);
});

test('server: the front page names the answer URL and never a secret', async () => {
  await withServer({ ...cfg, authToken: 'secret-token' }, {}, async (origin) => {
    const r = await fetch(origin + '/');
    const text = await r.text();
    assert.match(text, /Answer URL for the Plivo application: https:\/\/gate.example.com\/answer/);
    assert.doesNotMatch(text, /secret-token|4321/);
  });
});
