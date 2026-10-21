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

function readWhitelist(file, envList) {
  const out = new Set();
  const add = (line) => {
    const n = normalize(line.replace(/#.*/, '').trim());
    if (n.length === 10) out.add(n);
  };
  if (file && fs.existsSync(file)) fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(add);
  if (envList) String(envList).split(/[,\n;]/).forEach(add);
  return out;
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

  const ntfyUrl = env.NTFY_URL || '';
  if (ntfyUrl && !testing) {
    const topic = ntfyUrl.replace(/\/+$/, '').split('/').pop() || '';
    if (/replace/i.test(topic) || (/ntfy\.sh/i.test(ntfyUrl) && topic.length < 16)) {
      throw new Error('NTFY_URL topic is a placeholder or too short. On ntfy.sh the topic name is the only secret: use at least 16 random characters (openssl rand -hex 16).');
    }
  }

  const checkSignatures = env.CHECK_SIGNATURES !== 'false';

  return {
    ownerPhone,
    serviceNumber,
    ownerPhoneE164: ownerPhone ? e164(ownerPhone) : '',
    serviceNumberE164: serviceNumber ? e164(serviceNumber) : '',
    code,
    baseUrl,
    authToken,
    greeting: env.GREETING || 'You have reached a screened line.',
    voice: env.VOICE === 'MAN' ? 'MAN' : 'WOMAN',
    ringSeconds: intSetting(env, 'RING_SECONDS', 15, 5, 120),
    promptSeconds: intSetting(env, 'PROMPT_SECONDS', 10, 5, 60),
    silenceSeconds: intSetting(env, 'SILENCE_SECONDS', 10, 2, 60),
    maxMessageSeconds: intSetting(env, 'MAX_MESSAGE_SECONDS', 120, 2, 600),
    maxCallSeconds: intSetting(env, 'MAX_CALL_SECONDS', 1800, 60, 14400),
    callsPerHourPerCaller: intSetting(env, 'CALLS_PER_HOUR_PER_CALLER', 6, 0, 1000),
    callsPerHour: intSetting(env, 'CALLS_PER_HOUR', 60, 0, 10000),
    screenOwnerRing: env.SCREEN_OWNER_RING !== 'false',
    alertOnCode: env.ALERT_ON_CODE !== 'false',
    startupAlert: env.STARTUP_ALERT !== 'false',
    ntfyUrl,
    ntfyToken: env.NTFY_TOKEN || '',
    whitelist: readWhitelist(env.WHITELIST_FILE || path.join(__dirname, '..', 'whitelist.txt'), env.WHITELIST),
    checkSignatures,
    port: intSetting(env, 'PORT', 3000, 1, 65535),
    testing,
  };
}

module.exports = { load, readWhitelist, normalize, e164 };
