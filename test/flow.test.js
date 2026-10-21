'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const flow = require('../src/flow');
const { load } = require('../src/config');
const { build } = require('../src/server');

const cfg = {
  ownerPhone: '2055550100',
  serviceNumber: '2055550199',
  code: '4321',
  baseUrl: 'https://gate.example.com',
  greeting: 'You have reached Pat.',
  voice: 'WOMAN',
  ringSeconds: 18,
  promptSeconds: 30,
  maxMessageSeconds: 120,
  whitelist: new Set(['2055550111']),
};

test('numbers in different formats match', () => {
  assert.strictEqual(flow.normalize('+1 (205) 555-0100'), '2055550100');
  assert.strictEqual(flow.normalize('12055550100'), '2055550100');
  assert.strictEqual(flow.normalize('2055550100'), '2055550100');
});

test('a whitelisted caller rings straight through, shown as the service number', () => {
  const x = flow.answer({ From: '12055550111' }, cfg);
  assert.match(x, /<Dial callerId="2055550199"/);
  assert.match(x, /<Number>2055550100<\/Number>/);
  assert.doesNotMatch(x, /GetInput/);
});

test('an unknown caller hears the greeting and the code prompt', () => {
  const x = flow.answer({ From: '13125550123' }, cfg);
  assert.match(x, /<GetInput[^>]*action="https:\/\/gate.example.com\/gate"/);
  assert.match(x, /numDigits="4"/);
  assert.match(x, /You have reached Pat\. This call may be recorded\./);
});

test('an unknown caller who presses nothing is taken to voicemail, not hung up on', () => {
  const x = flow.answer({ From: '13125550123' }, cfg);
  const afterPrompt = x.split('</GetInput>')[1];
  assert.match(afterPrompt, /<Record /);
  assert.match(afterPrompt, /transcriptionUrl="https:\/\/gate.example.com\/transcribed"/);
});

test('our own forwarded call is hung up (loop guard)', () => {
  assert.match(flow.answer({ From: '12055550199' }, cfg), /<Hangup reason="busy"\/>/);
  assert.match(flow.answer({ From: '2055550100' }, cfg), /<Hangup reason="busy"\/>/);
});

test('the right code rings the owner', () => {
  const x = flow.gate({ Digits: '4321' }, cfg);
  assert.match(x, /Connecting you now/);
  assert.match(x, /<Dial /);
});

test('pressing 1 goes to voicemail', () => {
  const x = flow.gate({ Digits: '1' }, cfg);
  assert.match(x, /<Record /);
  assert.doesNotMatch(x, /<Dial /);
});

test('a wrong code goes to voicemail with a notice', () => {
  const x = flow.gate({ Digits: '9999' }, cfg);
  assert.match(x, /That code did not match/);
  assert.match(x, /<Record /);
  assert.doesNotMatch(x, /<Dial /);
});

test('if the owner answers, the call simply ends afterwards', () => {
  assert.match(flow.dialStatus({ DialStatus: 'completed' }, cfg), /<Hangup\/>/);
});

test('if the owner does not answer, the caller goes to voicemail', () => {
  for (const s of ['no-answer', 'busy', 'timeout', 'failed']) {
    const x = flow.dialStatus({ DialStatus: s }, cfg);
    assert.match(x, /<Record /, s);
  }
});

test('the input timeout stays inside the range Plivo accepts (5 to 60 seconds)', () => {
  assert.match(flow.answer({ From: '13125550123' }, { ...cfg, promptSeconds: 2 }), /executionTimeout="5"/);
  assert.match(flow.answer({ From: '13125550123' }, { ...cfg, promptSeconds: 500 }), /executionTimeout="60"/);
  assert.match(flow.answer({ From: '13125550123' }, { ...cfg, promptSeconds: 30 }), /executionTimeout="30"/);
});

test('after a voicemail is recorded, the caller hears goodbye and the call ends', () => {
  const x = flow.recorded({}, cfg);
  assert.match(x, /Thank you\. Goodbye\./);
  assert.match(x, /<Hangup\/>/);
});

test('greeting text is escaped so it cannot break the XML', () => {
  const x = flow.answer({ From: '13125550123' }, { ...cfg, greeting: 'Tom & Jerry <home>' });
  assert.match(x, /Tom &amp; Jerry &lt;home&gt;/);
});

test('settings: a bad code is refused', () => {
  assert.throws(() => load({ NODE_ENV: 'test', GATE_CODE: '12ab' }), /2 to 8 digits/);
});

test('server: an unsigned request is refused', async () => {
  const app = build({ ...cfg, authToken: 'secret', checkSignatures: true });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'From=13125550123',
    });
    assert.strictEqual(r.status, 403);
  } finally {
    server.close();
  }
});

test('server: with signature checks off (local testing), /answer returns call XML', async () => {
  const app = build({ ...cfg, checkSignatures: false });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'From=13125550123',
    });
    assert.strictEqual(r.status, 200);
    assert.match(r.headers.get('content-type'), /xml/);
    assert.match(await r.text(), /<GetInput/);
  } finally {
    server.close();
  }
});
