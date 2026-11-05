/*
 * Everon Call Dashboard — api/src/lib/security.js
 * Version: 1.1.0
 *
 * What this file does (v1.1.0):
 *   signedInUser()   – reads the Static Web Apps x-ms-client-principal header
 *                      (set by the platform after Entra sign-in) and, if
 *                      ALLOWED_EMAIL_DOMAINS is set, checks the user's domain.
 *   wallboardCheck() – view-only wallboard access: the secret key (compared in
 *                      constant time) AND the caller's IP must be in
 *                      WALLBOARD_ALLOWED_IPS. Fails closed if either setting
 *                      is missing.
 */
'use strict';

const crypto = require('crypto');
const config = require('./config');

function signedInUser(request) {
  const raw = request.headers.get('x-ms-client-principal');
  if (!raw) return null;
  let p;
  try { p = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch { return null; }
  if (!p || !Array.isArray(p.userRoles) || !p.userRoles.includes('authenticated')) return null;
  const email = String(p.userDetails || '').toLowerCase();
  if (config.allowedEmailDomains.length && !config.allowedEmailDomains.some((d) => email.endsWith(`@${d}`))) return null;
  return { email, provider: p.identityProvider };
}

function clientIp(request) {
  const h = request.headers.get('x-azure-clientip') || (request.headers.get('x-forwarded-for') || '').split(',')[0];
  let ip = String(h || '').trim();
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.split(':')[0];   // IPv4 with port
  if (ip.startsWith('[')) ip = ip.slice(1, ip.indexOf(']'));        // [IPv6]:port
  return ip.replace(/^::ffff:/, '');
}

function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function ipAllowed(ip, rules) {
  const ipInt = ipv4ToInt(ip);
  return rules.some((rule) => {
    const [base, bitsRaw] = rule.split('/');
    if (ipInt === null || ipv4ToInt(base) === null) return rule.toLowerCase() === ip.toLowerCase();
    const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((ipInt & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
  });
}

function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Returns null if allowed, otherwise a short reason (logged, not shown). */
function wallboardCheck(request) {
  const key = config.wallboardKey();
  const rules = config.wallboardAllowedIps();
  if (key.length < 32) return 'WALLBOARD_KEY not set (or shorter than 32 characters)';
  if (!rules.length) return 'WALLBOARD_ALLOWED_IPS not set';
  const ip = clientIp(request);
  if (!ipAllowed(ip, rules)) return `IP ${ip || 'unknown'} not in WALLBOARD_ALLOWED_IPS`;
  if (!sameSecret(request.headers.get('x-wallboard-key') || '', key)) return `wrong key from ${ip}`;
  return null;
}

module.exports = { signedInUser, wallboardCheck, clientIp, ipAllowed };
