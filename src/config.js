// Reads settings from environment variables (see .env.example).
'use strict';

const fs = require('fs');
const path = require('path');
const { normalize } = require('./flow');

function readWhitelist(file) {
  if (!file || !fs.existsSync(file)) return new Set();
  return new Set(
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*/, '').trim())
      .filter(Boolean)
      .map(normalize)
      .filter((n) => n.length === 10)
  );
}

function load(env = process.env) {
  const required = ['OWNER_PHONE', 'SERVICE_NUMBER', 'GATE_CODE', 'BASE_URL', 'PLIVO_AUTH_TOKEN'];
  const missing = required.filter((k) => !env[k]);
  if (missing.length && env.NODE_ENV !== 'test') {
    throw new Error(`Missing settings: ${missing.join(', ')}. Copy .env.example and fill them in.`);
  }
  const code = String(env.GATE_CODE || '').trim();
  if (code && !/^\d{2,8}$/.test(code)) {
    throw new Error('GATE_CODE must be 2 to 8 digits.');
  }
  return {
    ownerPhone: env.OWNER_PHONE || '',
    serviceNumber: env.SERVICE_NUMBER || '',
    code,
    baseUrl: String(env.BASE_URL || '').replace(/\/+$/, ''),
    authToken: env.PLIVO_AUTH_TOKEN || '',
    greeting: env.GREETING || 'You have reached a screened line.',
    voice: env.VOICE || 'WOMAN',
    ringSeconds: Number(env.RING_SECONDS || 18),
    promptSeconds: Number(env.PROMPT_SECONDS || 30),
    maxMessageSeconds: Number(env.MAX_MESSAGE_SECONDS || 120),
    ntfyUrl: env.NTFY_URL || '',
    whitelist: readWhitelist(env.WHITELIST_FILE || path.join(__dirname, '..', 'whitelist.txt')),
    checkSignatures: env.CHECK_SIGNATURES !== 'false',
    port: Number(env.PORT || 3000),
  };
}

module.exports = { load, readWhitelist };
