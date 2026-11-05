/*
 * Everon Call Dashboard — api/src/lib/threecx.js
 * Version: 1.1.0
 *
 * What this file does (v1.1.0):
 *   Minimal 3CX V20 XAPI client. Authenticates with an API client ID + key
 *   (OAuth client_credentials at /connect/token), caches the bearer token until
 *   shortly before expiry, and retries once on 401. Read-only: GET requests only.
 */
'use strict';

const config = require('./config');

let token = null;
let tokenExpires = 0;

async function getToken(force = false) {
  if (!force && token && Date.now() < tokenExpires - 60000) return token;
  const res = await fetch(`${config.threecxUrl()}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.threecxClientId(),
      client_secret: config.threecxClientSecret(),
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`3CX sign-in failed (HTTP ${res.status})`);
  const body = await res.json();
  token = body.access_token;
  tokenExpires = Date.now() + (Number(body.expires_in) || 3600) * 1000;
  return token;
}

/**
 * GET /xapi/v1/<path>. `query` is an object of OData options, e.g.
 * { $filter: "Number eq '8006'", $top: 100 }. Values are URL-encoded; the
 * $-prefixed keys are left as-is because the 3CX OData parser expects them.
 */
async function xapi(path, query = {}) {
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = `${config.threecxUrl()}/xapi/v1/${path}${qs ? `?${qs}` : ''}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${await getToken(attempt > 0)}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(60000),
    });
    if (res.status === 401 && attempt === 0) continue;
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`3CX ${path} failed (HTTP ${res.status}) ${detail}`.trim());
    }
    return res.json();
  }
  throw new Error(`3CX ${path} failed (unauthorised)`);
}

module.exports = { xapi };
