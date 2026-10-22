// Reads settings from environment variables (see .env.example) and refuses to start on bad ones.
'use strict';

const fs = require('fs');
const path = require('path');

// Keep the last 10 digits so +1 (205) 555-0100, 12055550100 and 2055550100 all match.
function normalize(number) {
  const digits = String(number || '').replace(/\D/g, '');
  return digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
}

// Plivo wants numbers with the country code (E.164). US only for now.
function e164(digits) {
  return '+1' + digits;
}

const WEAK_CODES = new Set(['1234', '4321', '0123', '12345', '54321', '123456', '654321', '1234567', '12345678', '87654321']);

// One whitelist entry: a number, an optional label after "=", and an optional "!" at the end
// for callers that cannot press a key (a pharmacy's automated call, an alarm company), who ring
// straight through:
//   2055550111             rings you after one key press; alerts show the number
//   2055550111=Mom         same, and alerts say Mom
//   2055550122=Pharmacy!   no key press, rings straight through
function parseWhitelistEntry(text) {
  const line = String(text).replace(/#.*/, '').trim();
  if (!line) return null;
  const nokey = line.endsWith('!');
  const body = nokey ? line.slice(0, -1) : line;
  const eq = body.indexOf('=');
  const number = normalize(eq < 0 ? body : body.slice(0, eq));
  if (number.length !== 10) return null;
  const label = (eq < 0 ? '' : body.slice(eq + 1)).replace(/[^\x20-\x7e]/g, '').trim().slice(0, 40);
  return { number, label, nokey };
}

function readWhitelist(file, envList) {
  const set = new Set();
  const info = new Map();
  const add = (line) => {
    const entry = parseWhitelistEntry(line);
    if (!entry) return;
    set.add(entry.number);
    info.set(entry.number, { label: entry.label, nokey: entry.nokey });
  };
  if (file && fs.existsSync(file)) fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(add);
  if (envList) String(envList).split(/[,\n;]/).forEach(add);
  return { set, info };
}

function intSetting(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max} (got "${raw}").`);
  }
  return n;
}

function phoneSetting(env, name, required) {
  const raw = env[name] || '';
  if (!raw) {
    if (required) throw new Error(`${name} is missing. Copy .env.example and fill it in.`);
    return '';
  }
  const digits = normalize(raw);
  if (digits.length !== 10) throw new Error(`${name} must be a 10-digit US number, for example 2055550100 (got "${raw}").`);
  return digits;
}

function load(env = process.env) {
  const testing = env.NODE_ENV === 'test';

  const ownerPhone = phoneSetting(env, 'OWNER_PHONE', !testing);
  const serviceNumber = phoneSetting(env, 'SERVICE_NUMBER', !testing);
  if (ownerPhone && ownerPhone === serviceNumber) throw new Error('OWNER_PHONE and SERVICE_NUMBER must be different numbers.');

  const code = String(env.GATE_CODE || '').trim();
  if (!testing || code) {
    if (!/^\d{4,8}$/.test(code)) throw new Error('GATE_CODE must be 4 to 8 digits.');
    if (!testing && (WEAK_CODES.has(code) || /^(\d)\1+$/.test(code))) {
      throw new Error('GATE_CODE is too easy to guess. Pick 4 to 8 digits that are not a run or a repeat.');
    }
  }

  const baseUrl = String(env.BASE_URL || '').replace(/\/+$/, '');
  if (!testing && !/^https:\/\/[^/\s]+$/.test(baseUrl)) {
    throw new Error('BASE_URL must be the https address of this server with nothing after the host, for example https://callgate-production.up.railway.app');
  }

  const authToken = env.PLIVO_AUTH_TOKEN || '';
  if (!testing && (!authToken || /replace/i.test(authToken))) throw new Error('PLIVO_AUTH_TOKEN is missing. Copy it from the Plivo console overview page.');

  // The word the gate says to you, and only you, when it rings you. It lives here and in
  // the confirm prompt. It never goes in an alert, a log or a URL. A call from the gate
  // contact that does not open with this word did not come from the gate.
  const screenOwnerRing = env.SCREEN_OWNER_RING !== 'false';
  const ownerWord = String(env.OWNER_WORD || '').trim().replace(/\s+/g, ' ');
  if (!testing && screenOwnerRing) {
    const plain = /^[A-Za-z]+( [A-Za-z]+)?$/.test(ownerWord) && ownerWord.length >= 3 && ownerWord.length <= 24;
    if (!plain || /replace|choose|yourword/i.test(ownerWord)) {
      throw new Error('OWNER_WORD is missing or not a plain word. Pick one or two words, letters only, 3 to 24 characters, that the gate will say to you when it rings you. Not a word you use anywhere else.');
    }
  }

  const ringAlert = env.RING_ALERT !== 'false';
  const ntfyUrl = String(env.NTFY_URL || '').trim().replace(/\/+$/, '');
  if (!testing) {
    if (!ntfyUrl) throw new Error('NTFY_URL is missing. The alerts are the only way you learn that a voicemail arrived. Create a topic (see .env.example) and subscribe to it in the ntfy app.');
    const https = /^https:\/\/[^/\s]+\/[^/\s]+$/.test(ntfyUrl);
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^/\s]+$/.test(ntfyUrl);
    if (!https && !local) throw new Error('NTFY_URL must be https://host/topic (http:// only for localhost). The topic name is a secret and must not travel in the clear.');
    const topic = ntfyUrl.split('/').pop() || '';
    if (/replace/i.test(topic) || (/ntfy\.sh/i.test(ntfyUrl) && topic.length < 16)) {
      throw new Error('NTFY_URL topic is a placeholder or too short. On ntfy.sh the topic name is the only secret: use at least 16 random characters (openssl rand -hex 16).');
    }
  }

  const checkSignatures = env.CHECK_SIGNATURES !== 'false';
  const wl = readWhitelist(env.WHITELIST_FILE || path.join(__dirname, '..', 'whitelist.txt'), env.WHITELIST);

  return {
    ownerPhone,
    serviceNumber,
    ownerPhoneE164: ownerPhone ? e164(ownerPhone) : '',
    serviceNumberE164: serviceNumber ? e164(serviceNumber) : '',
    code,
    ownerWord,
    baseUrl,
    authToken,
    greeting: env.GREETING || 'You have reached a screened line.',
    voice: env.VOICE === 'MAN' ? 'MAN' : 'WOMAN',
    ringSeconds: intSetting(env, 'RING_SECONDS', 15, 5, 120),
    // Plivo's pages do not say whether this timer starts when the prompt starts or when it
    // ends, so the default leaves room for the prompt itself. Test 2 in the README measures it.
    promptSeconds: intSetting(env, 'PROMPT_SECONDS', 20, 5, 60),
    silenceSeconds: intSetting(env, 'SILENCE_SECONDS', 10, 2, 60),
    maxMessageSeconds: intSetting(env, 'MAX_MESSAGE_SECONDS', 120, 2, 600),
    maxCallSeconds: intSetting(env, 'MAX_CALL_SECONDS', 1800, 60, 14400),
    callsPerHourPerCaller: intSetting(env, 'CALLS_PER_HOUR_PER_CALLER', 6, 0, 1000),
    callsPerHour: intSetting(env, 'CALLS_PER_HOUR', 60, 0, 10000),
    // How many times the gate may ring you in an hour, on every path together, and how many
    // times a day one number may ring you by staying silent (the path that needs no code).
    ringsPerHour: intSetting(env, 'RINGS_PER_HOUR', 10, 0, 1000),
    silentRingsPerDay: intSetting(env, 'SILENT_RINGS_PER_DAY', 1, 0, 100),
    screenOwnerRing,
    // A whitelisted number still presses one key, because caller ID can be spoofed. The key
    // stops recorded robocalls that send no tones; it does not stop a person.
    whitelistPressKey: env.WHITELIST_PRESS_KEY !== 'false',
    // A heads-up every time the gate rings you. The proof is the word inside the call.
    ringAlert,
    alertOnCode: env.ALERT_ON_CODE !== 'false',
    startupAlert: env.STARTUP_ALERT !== 'false',
    ntfyUrl,
    ntfyToken: env.NTFY_TOKEN || '',
    whitelist: wl.set,
    whitelistInfo: wl.info,
    checkSignatures,
    port: intSetting(env, 'PORT', 3000, 1, 65535),
    testing,
  };
}

module.exports = { load, readWhitelist, parseWhitelistEntry, normalize, e164 };
