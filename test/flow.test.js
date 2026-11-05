'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const flow = require('../src/flow');
const { load, normalize, parseWhitelistEntry } = require('../src/config');
const { build, makeLimiter, makeRingBudget, asciiTitle, clean, mask } = require('../src/server');

const cfg = {
  ownerPhone: '2055550100',
  serviceNumber: '2055550199',
  ownerPhoneE164: '+12055550100',
  serviceNumberE164: '+12055550199',
  code: '4321',
  ownerWord: 'pelican',
  baseUrl: 'https://gate.example.com',
  greeting: 'You have reached Pat.',
  voice: 'WOMAN',
  ringSeconds: 15,
  promptSeconds: 20,
  silenceSeconds: 10,
  maxMessageSeconds: 120,
  maxCallSeconds: 1800,
  callsPerHourPerCaller: 3,
  callsPerHour: 100,
  ringsPerHour: 100,
  silentRingsPerDay: 1,
  screenOwnerRing: true,
  whitelistPressKey: true,
  ringAlert: true,
  alertOnCode: true,
  whitelist: new Set(['2055550111', '2055550122']),
  whitelistInfo: new Map([
    ['2055550111', { label: 'Mom', nokey: false }],
    ['2055550122', { label: 'Pharmacy', nokey: true }],
  ]),
  checkSignatures: false,
  testing: true,
};

const STRANGER = { From: '13125550123' };

// A complete production-style environment, for the settings tests.
const PROD = {
  OWNER_PHONE: '2055550100',
  SERVICE_NUMBER: '2055550199',
  BASE_URL: 'https://gate.example.com',
  PLIVO_AUTH_TOKEN: 'tok',
  GATE_CODE: '830571',
  OWNER_WORD: 'pelican',
  NTFY_URL: 'https://ntfy.sh/9f1c2b7e4d8a6c0b1e2f3a4b5c6d7e8f',
};

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
  const c = load({ NODE_ENV: 'test', OWNER_PHONE: '(205) 555-0100', SERVICE_NUMBER: '1-205-555-0199', GATE_CODE: '830571' });
  assert.strictEqual(c.ownerPhoneE164, '+12055550100');
  assert.strictEqual(c.serviceNumberE164, '+12055550199');
  assert.throws(() => load({ NODE_ENV: 'test', OWNER_PHONE: '555-0100' }), /10-digit/);
  assert.throws(() => load({ NODE_ENV: 'test', OWNER_PHONE: '2055550100', SERVICE_NUMBER: '2055550100' }), /different/);
});

test('settings: a bad code is refused, and a weak one outside tests', () => {
  assert.throws(() => load({ NODE_ENV: 'test', GATE_CODE: '12ab' }), /6 to 8 digits/);
  assert.throws(() => load({ NODE_ENV: 'test', GATE_CODE: '123' }), /6 to 8 digits/);
  assert.throws(() => load({ ...PROD, GATE_CODE: '123456789' }), /6 to 8 digits/);
  assert.doesNotThrow(() => load(PROD));
});

test('settings: startup refuses a code shorter than six digits, and an easy six-digit one', () => {
  for (const short of ['8305', '83057']) assert.throws(() => load({ ...PROD, GATE_CODE: short }), /6 to 8 digits/, short);
  for (const easy of ['123456', '654321', '111111', '000000', '121212', '123123', '890123', '1234567', '12341234']) {
    assert.throws(() => load({ ...PROD, GATE_CODE: easy }), /too easy/, easy);
  }
  for (const good of ['830571', '4096217', '29384756']) assert.strictEqual(load({ ...PROD, GATE_CODE: good }).code, good);
});

test('settings: the owner word is required with screening on, and must be plain words', () => {
  assert.throws(() => load({ ...PROD, OWNER_WORD: '' }), /OWNER_WORD/);
  assert.throws(() => load({ ...PROD, OWNER_WORD: 'choose-a-word' }), /OWNER_WORD/);
  assert.throws(() => load({ ...PROD, OWNER_WORD: 'p3lican' }), /OWNER_WORD/);
  assert.throws(() => load({ ...PROD, OWNER_WORD: 'ab' }), /OWNER_WORD/);
  assert.strictEqual(load({ ...PROD, OWNER_WORD: '  blue   heron ' }).ownerWord, 'blue heron');
  assert.doesNotThrow(() => load({ ...PROD, OWNER_WORD: '', SCREEN_OWNER_RING: 'false' }));
});

test('settings: alerts are required outside tests, and the topic must travel over https', () => {
  assert.throws(() => load({ ...PROD, NTFY_URL: '' }), /NTFY_URL is missing/);
  assert.throws(() => load({ ...PROD, NTFY_URL: 'http://ntfy.sh/9f1c2b7e4d8a6c0b1e2f3a4b5c6d7e8f' }), /https/);
  assert.doesNotThrow(() => load({ ...PROD, NTFY_URL: 'http://localhost:2586/9f1c2b7e4d8a6c0b1e2f3a4b5c6d7e8f' }));
  assert.throws(() => load({ ...PROD, NTFY_URL: 'https://ntfy.sh/replace-with-a-long-random-topic' }), /placeholder/);
  assert.throws(() => load({ ...PROD, NTFY_URL: 'https://ntfy.sh/short' }), /too short/);
  assert.strictEqual(load({ ...PROD, NTFY_URL: PROD.NTFY_URL + '/' }).ntfyUrl, PROD.NTFY_URL);
});

test('settings: timing values must be whole numbers in range, and the prompt wait leaves room for the prompt', () => {
  assert.throws(() => load({ NODE_ENV: 'test', RING_SECONDS: 'abc' }), /RING_SECONDS/);
  assert.throws(() => load({ NODE_ENV: 'test', MAX_MESSAGE_SECONDS: '0' }), /MAX_MESSAGE_SECONDS/);
  assert.strictEqual(load({ NODE_ENV: 'test', RING_SECONDS: '12' }).ringSeconds, 12);
  assert.strictEqual(load({ NODE_ENV: 'test' }).promptSeconds, 20);
  assert.strictEqual(load({ NODE_ENV: 'test' }).ringsPerHour, 10);
  assert.strictEqual(load({ NODE_ENV: 'test' }).silentRingsPerDay, 1);
});

test('settings: whitelist entries carry a label and a no-key mark, from the variable as well as the file', () => {
  const c = load({ NODE_ENV: 'test', WHITELIST: '(205) 555-0111=Mom, 12055550122=Pharmacy!\n2055550133', WHITELIST_FILE: '/nonexistent' });
  assert.deepStrictEqual([...c.whitelist].sort(), ['2055550111', '2055550122', '2055550133']);
  assert.deepStrictEqual(c.whitelistInfo.get('2055550111'), { label: 'Mom', nokey: false });
  assert.deepStrictEqual(c.whitelistInfo.get('2055550122'), { label: 'Pharmacy', nokey: true });
  assert.deepStrictEqual(c.whitelistInfo.get('2055550133'), { label: '', nokey: false });
  assert.strictEqual(parseWhitelistEntry('# a comment'), null);
  assert.strictEqual(parseWhitelistEntry('555-0111=Short'), null);
  assert.deepStrictEqual(parseWhitelistEntry('2055550144=Dr Lee ☃!'), { number: '2055550144', label: 'Dr Lee', nokey: true });
});

test('a whitelisted caller is asked for one key press (any key, short wait), because caller ID can be spoofed', () => {
  const x = flow.answer({ From: '12055550111' }, cfg);
  assert.match(x, /<GetInput action="https:\/\/gate.example.com\/whitelist-ok\?from=2055550111"[^>]*numDigits="1" finishOnKey="none" executionTimeout="5"[^>]*log="false"/);
  assert.match(x, /You have reached Pat\. Press any key\./);
  assert.match(x.split('</GetInput>')[1], /<Record /);
  assert.doesNotMatch(x, /<Dial /);
});

test('a whitelisted caller who presses a key rings through, in E.164, shown as the gate number, with screening', () => {
  const x = flow.whitelistOk({ Digits: '5', from: '2055550111' }, cfg);
  assert.match(x, /Connecting you now/);
  assert.match(x, /<Dial callerId="\+12055550199" timeout="15" timeLimit="1800"/);
  assert.match(x, /confirmSound="https:\/\/gate.example.com\/confirm" confirmKey="1"/);
  assert.match(x, /<Number>\+12055550100<\/Number>/);
  assert.match(x, /action="https:\/\/gate.example.com\/dial-status\?from=2055550111"/);
  assert.ok(flow.rings(x));
});

test('a whitelisted caller who presses nothing, or a forged whitelist callback, goes to voicemail', () => {
  assert.match(flow.whitelistOk({ Digits: '', from: '2055550111' }, cfg), /<Record /);
  const forged = flow.whitelistOk({ Digits: '5', from: '3125550123' }, cfg);
  assert.match(forged, /<Record /);
  assert.doesNotMatch(forged, /<Dial /);
  assert.ok(!flow.rings(forged));
});

test('a no-key whitelist entry rings straight through, and the key press can be turned off for everyone', () => {
  const pharmacy = flow.answer({ From: '12055550122' }, cfg);
  assert.match(pharmacy, /<Dial callerId="\+12055550199"/);
  assert.doesNotMatch(pharmacy, /GetInput/);
  const x = flow.answer({ From: '12055550111' }, { ...cfg, whitelistPressKey: false });
  assert.match(x, /<Dial callerId="\+12055550199"/);
  assert.doesNotMatch(x, /GetInput/);
});

test('when the ring budget is spent, every path offers voicemail instead of ringing', () => {
  const blocked = { ringAllowed: false };
  for (const x of [
    flow.answer({ From: '12055550122' }, cfg, blocked),
    flow.whitelistOk({ Digits: '5', from: '2055550111' }, cfg, blocked),
    flow.gate({ Digits: '4321', from: '3125550123' }, cfg, blocked),
  ]) {
    assert.match(x, /cannot take calls right now/);
    assert.match(x, /<Record /);
    assert.doesNotMatch(x, /<Dial /);
  }
  const silent = flow.recorded({ RecordingDurationMs: '10500', from: '3125550123' }, cfg, blocked);
  assert.match(silent, /could not reach them/);
  assert.doesNotMatch(silent, /<Dial /);
});

test('screening can be turned off', () => {
  const x = flow.answer({ From: '12055550122' }, { ...cfg, screenOwnerRing: false });
  assert.doesNotMatch(x, /confirmKey/);
});

test('an unknown caller hears the greeting and the code prompt, and the digits are not logged', () => {
  const x = flow.answer(STRANGER, cfg);
  assert.match(x, /<GetInput action="https:\/\/gate.example.com\/gate\?from=3125550123"/);
  assert.match(x, /numDigits="4"/);
  assert.match(x, /executionTimeout="20"/);
  assert.match(x, /retries="1" log="false"/);
  assert.match(x, /You have reached Pat\. This call may be recorded and transcribed\./);
});

test('an unknown caller who presses nothing is offered voicemail with the recording notice', () => {
  const x = flow.answer(STRANGER, cfg);
  const afterPrompt = x.split('</GetInput>')[1];
  assert.match(afterPrompt, /recorded and transcribed/);
  assert.match(afterPrompt, /<Record action="https:\/\/gate.example.com\/recorded\?from=3125550123"/);
  assert.match(afterPrompt, /callbackUrl="https:\/\/gate.example.com\/recorded\?from=3125550123&amp;ready=1"/);
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
  assert.ok(flow.rings(x));
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

test('a recording is classified once: silent means the silence window or nothing at all, a short message is a message, a finished call cannot be rung', () => {
  const c = (f) => flow.classifyRecording(f, cfg).silent;
  assert.ok(c({ RecordingDurationMs: '10500' }), 'the silence window');
  assert.ok(c({ RecordingDurationMs: '9000' }), 'window minus one second');
  assert.ok(c({ RecordingDurationMs: '12000' }), 'window plus two');
  assert.ok(c({ RecordingDurationMs: '0' }), 'zero: Plivo may trim silence');
  assert.ok(c({}), 'missing duration');
  assert.ok(!c({ RecordingDurationMs: '5000' }), 'five seconds of talk is a message');
  assert.ok(!c({ RecordingDurationMs: '34000' }), 'a long message');
  assert.ok(!c({ RecordingDurationMs: '10500', Digits: '#' }), 'a key ended it');
  assert.ok(!c({ RecordingDurationMs: '10500', CallStatus: 'completed' }), 'the caller is gone');
});

test('a real message ends with goodbye, including a short one', () => {
  for (const ms of ['34000', '5000']) {
    const x = flow.recorded({ RecordingDurationMs: ms, from: '3125550123' }, cfg);
    assert.match(x, /Thank you\. Goodbye\./);
    assert.match(x, /<Hangup\/>/);
    assert.doesNotMatch(x, /<Dial /);
  }
});

test('silence after the tone rings the owner once, then says so and ends', () => {
  const first = flow.recorded({ RecordingDurationMs: '10500', from: '3125550123' }, cfg);
  assert.match(first, /Connecting you now/);
  assert.match(first, /<Dial [^>]*action="https:\/\/gate.example.com\/dial-status\?from=3125550123&amp;held=1"/);
  const second = flow.recorded({ RecordingDurationMs: '10500', from: '3125550123', held: '1' }, cfg);
  assert.match(second, /could not reach them/);
  assert.doesNotMatch(second, /<Dial /);
  const unknownLength = flow.recorded({ from: '3125550123' }, cfg);
  assert.match(unknownLength, /<Dial /, 'a missing duration counts as silence, not as a message');
});

test('the owner hears the word and a press-1 prompt before a bridged call connects, and the word appears nowhere else', () => {
  assert.match(flow.confirm({}, cfg), /Call from your gate\. pelican\. Press 1 to take it/);
  assert.match(flow.confirm({}, { ...cfg, ownerWord: '' }), /Call from your gate\. Press 1 to take it/);
  for (const x of [flow.answer(STRANGER, cfg), flow.answer({ From: '12055550111' }, cfg), flow.gate({ Digits: '4321', from: '3125550123' }, cfg), flow.whitelistOk({ Digits: '5', from: '2055550111' }, cfg)]) {
    assert.doesNotMatch(x, /pelican/);
  }
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

test('the hourly caps count call starts per caller and overall; known callers skip the overall count; withheld IDs share one bucket', () => {
  const lim = makeLimiter({ callsPerHourPerCaller: 2, callsPerHour: 3 });
  const t = 1_000_000_000_000;
  assert.ok(lim.allow('3125550123', t));
  assert.ok(lim.allow('3125550123', t + 1));
  assert.ok(!lim.allow('3125550123', t + 2));
  assert.ok(lim.allow('3125550124', t + 3));
  assert.ok(!lim.allow('3125550125', t + 4), 'the overall cap');
  assert.ok(lim.allow('2055550111', t + 5, { skipGlobal: true }), 'a known caller is not blocked by the overall cap');
  assert.ok(lim.allow('2055550111', t + 6, { skipGlobal: true }));
  assert.ok(!lim.allow('2055550111', t + 7, { skipGlobal: true }), 'but keeps the per-caller cap');
  assert.strictEqual(lim.count(t + 8), 3, 'known callers are not in the total');
  assert.ok(lim.allow('3125550125', t + 3600 * 1000 + 10));
  const lim2 = makeLimiter({ callsPerHourPerCaller: 2, callsPerHour: 0 });
  assert.ok(lim2.allow('', t));
  assert.ok(lim2.allow(undefined, t + 1));
  assert.ok(!lim2.allow('', t + 2), 'withheld caller IDs count as one caller');
});

test('the ring budget caps rings per hour on every path, and silent rings per caller per day', () => {
  const b = makeRingBudget({ ringsPerHour: 3, silentRingsPerDay: 1 });
  const t = 1_000_000_000_000;
  assert.ok(b.allow('silent', '3125550123', t));
  assert.ok(!b.allow('silent', '3125550123', t + 1), 'one silent ring a day per number');
  assert.ok(b.allow('silent', '3125550124', t + 2));
  assert.ok(b.allow('code', '3125550125', t + 3));
  assert.ok(!b.allow('code', '3125550126', t + 4), 'three rings this hour, all paths together');
  assert.ok(!b.allow('known', '2055550111', t + 5));
  assert.strictEqual(b.count(t + 6), 3);
  assert.ok(b.allow('code', '3125550126', t + 3600 * 1000 + 10));
  assert.ok(!b.allow('silent', '3125550123', t + 3600 * 1000 + 11), 'the daily silent count outlives the hour');
  assert.ok(b.allow('silent', '3125550123', t + 24 * 3600 * 1000 + 12));
  const off = makeRingBudget({ ringsPerHour: 0, silentRingsPerDay: 0 });
  for (let i = 0; i < 20; i++) assert.ok(off.allow('silent', '3125550123', t + i));
});

test('the local signature check agrees with the Plivo SDK on every URL shape', () => {
  const sdk = require('plivo');
  const local = require('../src/signature');
  const token = 'dummy-token-for-tests';
  const cases = [
    ['POST', 'https://gate.example.com/answer', { From: '+13125550123', To: '+12055550199', CallUUID: 'abc' }],
    ['POST', 'https://gate.example.com/gate?from=3125550123&held=1', { Digits: '4321', From: '+13125550123' }],
    ['POST', 'https://gate.example.com:8443/recorded?from=3125550123', {}],
    ['GET', 'https://gate.example.com/confirm', {}],
    ['GET', 'https://gate.example.com/confirm?x=2&a=1', {}],
    ['POST', 'https://gate.example.com/transcribed?from=3125550123', { transcription: 'Call me back', recording_id: 'r1' }],
  ];
  for (const [method, url, params] of cases) {
    const nonce = 'n' + Math.random().toString(36).slice(2);
    const sig = local.sign(method, url, nonce, token, params);
    assert.ok(sdk.validateV3Signature(method, url, nonce, token, sig, params), `SDK accepts local signature for ${method} ${url}`);
    assert.ok(local.validateV3Signature(method, url, nonce, token, sig, params), `local accepts its own for ${method} ${url}`);
    assert.ok(!local.validateV3Signature(method, url, nonce, token, sig + 'x', params));
    assert.ok(!local.validateV3Signature(method, url, nonce + 'x', token, sig, params));
    assert.ok(!local.validateV3Signature(method, url, nonce, token + 'x', sig, params));
    assert.ok(local.validateV3Signature(method, url, nonce, token, 'bogus,' + sig, params), 'comma-separated list, as the SDK allows');
  }
  assert.ok(!local.validateV3Signature('PUT', 'https://gate.example.com/x', 'n', token, 'sig', {}));
});

test('alert titles and log values are plain ASCII, so a caller name cannot fake a log line', () => {
  assert.strictEqual(asciiTitle('Voicemail from 3125550123 ☃'), 'Voicemail from 3125550123 ');
  assert.strictEqual(clean('Pat\n[call] forged\x1b[31m x\x7f'), 'Pat[call] forged[31mx');
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

test('server: with checks off (local testing) /answer returns call XML and the caps apply, with one cap alert an hour', async () => {
  const alerts = [];
  const sendAlert = async (title, body) => alerts.push(title + ' | ' + body);
  await withServer({ ...cfg, callsPerHourPerCaller: 2 }, { sendAlert }, async (origin) => {
    for (let i = 0; i < 2; i++) {
      const r = await post(`${origin}/answer`, 'From=13125550123');
      assert.strictEqual(r.status, 200);
      assert.match(await r.text(), /<GetInput/);
    }
    for (let i = 0; i < 2; i++) {
      const capped = await post(`${origin}/answer`, 'From=13125550123');
      assert.match(await capped.text(), /This line is busy/);
    }
    const hang = await post(`${origin}/answer`, 'From=13125550123&CallStatus=completed&HangupCause=NORMAL_CLEARING');
    assert.match(await hang.text(), /<Response><\/Response>/);
  });
  assert.strictEqual(alerts.length, 1);
  assert.match(alerts[0], /^Call cap reached \| 2 calls this hour/);
});

test('server: the gate ringing itself back never counts against the caps, and a flood of strangers does not lock out a known caller', async () => {
  const alerts = [];
  const sendAlert = async (title, body) => alerts.push(title + ' | ' + body);
  await withServer({ ...cfg, callsPerHourPerCaller: 2, callsPerHour: 3 }, { sendAlert }, async (origin) => {
    for (let i = 0; i < 7; i++) {
      const r = await post(`${origin}/answer`, 'From=12055550199');
      assert.match(await r.text(), /<Hangup reason="busy"\/>/, `loop-back ${i + 1}`);
    }
    for (const from of ['13125550123', '13125550124', '13125550125']) await post(`${origin}/answer`, `From=${from}`);
    const stranger = await post(`${origin}/answer`, 'From=13125550126');
    assert.match(await stranger.text(), /This line is busy/);
    const mom = await post(`${origin}/answer`, 'From=12055550111');
    assert.match(await mom.text(), /Press any key/);
  });
});

test('server: ring alerts are sent only when a Dial goes out, before it goes out, at high priority; other alerts stay as they were', async () => {
  const alerts = [];
  const sendAlert = async (title, body, opts) => alerts.push(title + ' | ' + body + (opts && opts.priority ? ' [' + opts.priority + ']' : ''));
  await withServer(cfg, { sendAlert }, async (origin) => {
    assert.match(await (await post(`${origin}/whitelist-ok?from=2055550111`, 'Digits=7')).text(), /<Dial /);
    assert.match(await (await post(`${origin}/whitelist-ok?from=3125550199`, 'Digits=7')).text(), /<Record /, 'a forged whitelist callback');
    await post(`${origin}/gate?from=3125550123`, 'Digits=9999');
    assert.match(await (await post(`${origin}/gate?from=3125550123`, 'Digits=4321')).text(), /<Dial /);
    assert.match(await (await post(`${origin}/answer`, 'From=12055550122')).text(), /<Dial /, 'a no-key entry');
    await post(`${origin}/recorded?from=3125550123`, 'RecordingID=rec1&RecordUrl=https://media.example.com/rec1.mp3&RecordingDurationMs=34000');
    await post(`${origin}/recorded?from=3125550123`, 'RecordingID=rec1&RecordUrl=https://media.example.com/rec1.mp3&RecordingDurationMs=34000');
    await post(`${origin}/recorded?from=3125550124`, 'RecordingID=rec2&RecordUrl=https://media.example.com/rec2.mp3&RecordingDurationMs=5000');
    assert.match(await (await post(`${origin}/recorded?from=3125550125`, 'RecordingID=rec3&RecordingDurationMs=10500')).text(), /<Dial /, 'silent, rung once');
    await post(`${origin}/recorded?from=3125550125&held=1`, 'RecordingID=rec4&RecordingDurationMs=10500');
    await post(`${origin}/transcribed?from=3125550123`, 'recording_id=rec1&transcription=Call+me+back');
    const hang = await post(`${origin}/hangup`, 'CallUUID=x&HangupCause=NORMAL_CLEARING');
    assert.strictEqual(hang.status, 200);
  });
  assert.deepStrictEqual(alerts, [
    'Ringing you | Known caller Mom (2055550111) pressed a key. [high]',
    'Wrong code | 3125550123 tried a wrong code.',
    'Ringing you | 3125550123 entered the code. [high]',
    'Ringing you | Known caller Pharmacy (2055550122), straight through. [high]',
    'Voicemail from 3125550123 | 34 seconds. https://media.example.com/rec1.mp3',
    'Voicemail from 3125550124 | 5 seconds. https://media.example.com/rec2.mp3',
    'Ringing you | 3125550125 stayed on the line without speaking. [high]',
    'Silent caller | 3125550125 waited on the line without speaking, twice. Ended.',
    'Transcript, 3125550123 | Call me back\n\nhttps://media.example.com/rec1.mp3',
  ]);
});

test('server: a ring alert that hangs or fails does not stop the ring (fail open, two-second cap)', async () => {
  const hung = () => new Promise(() => {});
  await withServer(cfg, { sendAlert: hung }, async (origin) => {
    const t0 = Date.now();
    const r = await post(`${origin}/gate?from=3125550123`, 'Digits=4321');
    assert.match(await r.text(), /<Dial /);
    const took = Date.now() - t0;
    assert.ok(took >= 1800 && took < 4000, `waited about two seconds for the alert, took ${took} ms`);
  });
  const failing = async () => { throw new Error('ntfy down'); };
  await withServer(cfg, { sendAlert: failing }, async (origin) => {
    const r = await post(`${origin}/gate?from=3125550123`, 'Digits=4321');
    assert.match(await r.text(), /<Dial /);
  });
});

test('logs: a full caller number never appears in a log line, on any route; alerts keep the full number', async () => {
  assert.strictEqual(mask('+1 (312) 555-0123'), '***-***-0123');
  assert.strictEqual(mask('WIRELESS 13125550123'), 'WIRELESS ***-***-0123');
  assert.strictEqual(mask('10500'), '10500', 'short values such as durations are left alone');
  const lines = [];
  const alerts = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(saved)) console[k] = (...a) => lines.push(a.join(' '));
  try {
    const sendAlert = async (title, body) => alerts.push(title + ' | ' + body);
    const caller = 'From=%2B13125550123&To=%2B12055550199&ForwardedFrom=%2B12055550100&CallerName=%2B1+312+555+0123&CallUUID=c1';
    await withServer({ ...cfg, callsPerHourPerCaller: 1 }, { sendAlert }, async (origin) => {
      await post(`${origin}/answer`, caller);
      await post(`${origin}/answer`, caller);
      await post(`${origin}/answer`, 'From=12055550111&CallerName=Mom+2055550111');
      await post(`${origin}/answer`, 'From=%2B13125550177&CallerName=JANE+EXAMPLE&CallUUID=c2');
      await post(`${origin}/whitelist-ok?from=2055550111`, 'Digits=7&From=%2B12055550111');
      await post(`${origin}/gate?from=3125550123`, 'Digits=9999&From=%2B13125550123');
      await post(`${origin}/gate?from=3125550123`, 'Digits=4321&From=%2B13125550123');
      await post(`${origin}/dial-status?from=3125550123`, 'DialStatus=no-answer&From=%2B13125550123');
      await post(`${origin}/recorded?from=3125550123`, 'RecordingID=m1&RecordingDurationMs=34000&From=%2B13125550123');
      await post(`${origin}/transcribed?from=3125550123`, 'recording_id=m1&transcription=Call+me+back');
      await post(`${origin}/hangup`, 'CallUUID=c1&From=%2B13125550123&HangupCause=NORMAL_CLEARING');
    });
    const signedCfg = { ...cfg, authToken: 'secret-token', checkSignatures: true };
    await withServer(signedCfg, {}, async (origin) => {
      assert.strictEqual((await post(`${origin}/recorded?from=3125550123`, 'From=%2B13125550123')).status, 403);
    });
  } finally {
    Object.assign(console, saved);
  }
  assert.ok(lines.some((l) => l.startsWith('[signature]')), 'the signature warning was logged');
  assert.ok(lines.some((l) => l.startsWith('[cap]')) && lines.some((l) => l.startsWith('[gate] wrong')) && lines.some((l) => l.startsWith('[gate] right')));
  for (const l of lines) assert.doesNotMatch(l, /(\d[ ().+-]*){7}/, `a log line carries a full number: ${l}`);
  assert.ok(lines.some((l) => l.includes('***-***-0123')), 'the last four digits are logged');
  for (const l of lines) assert.doesNotMatch(l, /JANE|\bMom\b/, `a log line carries a caller ID name: ${l}`);
  assert.ok(lines.some((l) => l.includes('"CallerName":"(withheld)"')), 'the log says a caller ID name came');
  assert.ok(alerts.includes('Wrong code | 3125550123 tried a wrong code.'), 'alerts are unchanged');
});

test('server: over the ring budget, callers get voicemail and the owner gets one alert an hour', async () => {
  const alerts = [];
  const sendAlert = async (title, body) => alerts.push(title + ' | ' + body);
  await withServer({ ...cfg, ringsPerHour: 1 }, { sendAlert }, async (origin) => {
    assert.match(await (await post(`${origin}/gate?from=3125550123`, 'Digits=4321')).text(), /<Dial /);
    assert.match(await (await post(`${origin}/gate?from=3125550124`, 'Digits=4321')).text(), /cannot take calls right now/);
    assert.match(await (await post(`${origin}/whitelist-ok?from=2055550111`, 'Digits=7')).text(), /cannot take calls right now/);
    assert.match(await (await post(`${origin}/recorded?from=3125550125`, 'RecordingID=rec9&RecordingDurationMs=10500')).text(), /could not reach them/);
  });
  assert.deepStrictEqual(alerts, [
    'Ringing you | 3125550123 entered the code.',
    'Ring budget reached | The gate has rung you 1 times this hour. Further callers go to voicemail until about ' + alerts[1].split('until about ')[1],
  ]);
  const silentTwice = [];
  await withServer(cfg, { sendAlert: async (t, b) => silentTwice.push(t) }, async (origin) => {
    assert.match(await (await post(`${origin}/recorded?from=3125550125`, 'RecordingID=s1&RecordingDurationMs=10500')).text(), /<Dial /);
    assert.match(await (await post(`${origin}/recorded?from=3125550125`, 'RecordingID=s2&RecordingDurationMs=10500')).text(), /could not reach them/, 'one silent ring per number per day');
  });
  assert.deepStrictEqual(silentTwice, ['Ringing you', 'Ring budget reached']);
});

test('server: a silent call\'s two recording requests, in either order, spend one ring and send one alert; a repeat changes nothing', async () => {
  const action = 'RecordingID=s7&RecordUrl=https://media.example.com/s7.mp3&RecordingDurationMs=10500';
  // The "file ready" callback carries no keys and no call status, so on its own it looks silent.
  const ready = 'RecordingID=s7&RecordUrl=https://media.example.com/s7.mp3&RecordingDurationMs=10500';
  for (const silentRingsPerDay of [1, 2]) {
    for (const order of ['action first', 'ready first']) {
      const alerts = [];
      const budget = makeRingBudget({ ringsPerHour: 100, silentRingsPerDay });
      const sendAlert = async (title) => alerts.push(title);
      await withServer({ ...cfg, silentRingsPerDay }, { sendAlert, ringBudget: budget }, async (origin) => {
        const sendReady = async () => {
          const r = await post(`${origin}/recorded?from=3125550125&ready=1`, ready);
          assert.strictEqual(r.status, 200);
          assert.doesNotMatch(await r.text(), /<Dial /, 'the ready callback never rings');
        };
        if (order === 'ready first') await sendReady();
        const first = await (await post(`${origin}/recorded?from=3125550125`, action)).text();
        assert.match(first, /<Dial /, `${order}: the caller who waited is rung`);
        if (order === 'action first') await sendReady();
        const again = await (await post(`${origin}/recorded?from=3125550125`, action)).text();
        assert.strictEqual(again, first, `${order}: a repeated action gets the same answer`);
        await sendReady();
        assert.strictEqual(budget.count(), 1, `${order}, ${silentRingsPerDay} a day: one ring spent`);
      });
      assert.deepStrictEqual(alerts, ['Ringing you'], `${order}, ${silentRingsPerDay} a day: one alert`);
    }
  }
});

test('server: a voicemail\'s two recording requests send one alert, with the link from either', async () => {
  const alerts = [];
  const sendAlert = async (title, body) => alerts.push(title + ' | ' + body);
  await withServer(cfg, { sendAlert }, async (origin) => {
    await post(`${origin}/recorded?from=3125550123&ready=1`, 'RecordingID=v1&RecordUrl=https://media.example.com/v1.mp3&RecordingDurationMs=34000');
    assert.match(await (await post(`${origin}/recorded?from=3125550123`, 'RecordingID=v1&RecordingDurationMs=34000')).text(), /Thank you\. Goodbye\./);
    await post(`${origin}/recorded?from=3125550123`, 'RecordingID=v1&RecordingDurationMs=34000');
  });
  assert.deepStrictEqual(alerts, ['Voicemail from 3125550123 | 34 seconds. https://media.example.com/v1.mp3']);
});

test('server: if the end-of-recording request never comes, the ready request still sends one voicemail alert and rings nothing', async () => {
  const alerts = [];
  const budget = makeRingBudget({ ringsPerHour: 100, silentRingsPerDay: 2 });
  const sendAlert = async (title, body) => alerts.push(title + ' | ' + body);
  await withServer(cfg, { sendAlert, ringBudget: budget, readyWaitMs: 30 }, async (origin) => {
    const r = await post(`${origin}/recorded?from=3125550123&ready=1`, 'RecordingID=h1&RecordUrl=https://media.example.com/h1.mp3&RecordingDurationMs=21000');
    assert.strictEqual(r.status, 200);
    await post(`${origin}/recorded?from=3125550123&ready=1`, 'RecordingID=h1&RecordUrl=https://media.example.com/h1.mp3&RecordingDurationMs=21000');
    await new Promise((done) => setTimeout(done, 80));
    // A late action after the backstop is a repeat: no second alert, no ring.
    assert.doesNotMatch(await (await post(`${origin}/recorded?from=3125550123`, 'RecordingID=h1&RecordingDurationMs=21000')).text(), /<Dial /);
  });
  assert.strictEqual(budget.count(), 0, 'no ring spent');
  assert.deepStrictEqual(alerts, ['Voicemail from 3125550123 | 21 seconds. https://media.example.com/h1.mp3 (sent from the recording-ready request; the end-of-recording request never came)']);
});

test('server: when the end-of-recording request does come, the backstop stays quiet', async () => {
  const alerts = [];
  const sendAlert = async (title) => alerts.push(title);
  await withServer(cfg, { sendAlert, readyWaitMs: 30 }, async (origin) => {
    await post(`${origin}/recorded?from=3125550123&ready=1`, 'RecordingID=h2&RecordUrl=https://media.example.com/h2.mp3&RecordingDurationMs=34000');
    await post(`${origin}/recorded?from=3125550123`, 'RecordingID=h2&RecordingDurationMs=34000');
    await new Promise((done) => setTimeout(done, 80));
  });
  assert.deepStrictEqual(alerts, ['Voicemail from 3125550123']);
});

test('server: the front page names the answer URL and never a secret', async () => {
  await withServer({ ...cfg, authToken: 'secret-token' }, {}, async (origin) => {
    const r = await fetch(origin + '/');
    const text = await r.text();
    assert.match(text, /Answer URL for the Plivo application: https:\/\/gate.example.com\/answer/);
    assert.match(text, /Ring alerts: on/);
    assert.doesNotMatch(text, /secret-token|4321|pelican/);
  });
});
