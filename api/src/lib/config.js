/*
 * Everon Call Dashboard — api/src/lib/config.js
 * Version: 1.1.0
 *
 * What this file does (v1.1.0):
 *   Reads every setting from the Function app's application settings (never
 *   from the repo — it is public). Defaults match the agreed spec:
 *   Support queue 8006, 07:00–19:00 grid, 30-day lookback, RAG thresholds
 *   volume red 20+/amber 10–19, missed amber 5–15%/red over 15%.
 */
'use strict';

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing app setting ${name}`);
  return v;
}

const config = {
  version: '1.1.0',
  timezone: 'Europe/London',

  // 3CX V20 XAPI (Admin console > Integrations > API: client ID + API key)
  threecxUrl: () => required('THREECX_URL').replace(/\/+$/, ''),
  threecxClientId: () => required('THREECX_CLIENT_ID'),
  threecxClientSecret: () => required('THREECX_CLIENT_SECRET'),

  queueNumbers: list(process.env.QUEUE_NUMBERS || '8006'),
  // Optional: the answering service's phone number. If blank, any call the
  // queue sends out to an external number counts as "answering service".
  answeringServiceNumbers: list(process.env.ANSWERING_SERVICE_NUMBERS).map((n) => n.replace(/\D/g, '')),

  lookbackDays: num(process.env.LOOKBACK_DAYS, 30),
  firstHour: num(process.env.FIRST_HOUR, 7),
  lastHour: num(process.env.LAST_HOUR, 18), // last grid column (18:00–19:00)
  historyRefreshMs: num(process.env.HISTORY_REFRESH_MINUTES, 15) * 60000,
  agentsRefreshMs: num(process.env.AGENTS_REFRESH_SECONDS, 60) * 1000,

  thresholds: {
    volumeRed: num(process.env.VOLUME_RED, 20),
    volumeAmber: num(process.env.VOLUME_AMBER, 10),
    missedAmberPct: num(process.env.MISSED_AMBER_PCT, 5),
    missedRedPct: num(process.env.MISSED_RED_PCT, 15),
  },

  // Signed-in dashboard: optional extra check on the signed-in user's domain
  allowedEmailDomains: list(process.env.ALLOWED_EMAIL_DOMAINS).map((d) => d.toLowerCase()),

  // Wallboard
  wallboardKey: () => process.env.WALLBOARD_KEY || '',
  wallboardAllowedIps: () => list(process.env.WALLBOARD_ALLOWED_IPS),
};

module.exports = config;
