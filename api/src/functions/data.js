/*
 * Everon Call Dashboard — api/src/functions/data.js
 * Version: 1.1.0
 *
 * What this file does (v1.1.0):
 *   GET /api/data — summary for the signed-in dashboard. Static Web Apps
 *   already blocks anonymous callers on this route; the Function checks the
 *   signed-in principal again (and the email domain, if configured) so it is
 *   never open even if the route config changes.
 */
'use strict';

const { app } = require('@azure/functions');
const { buildSummary } = require('../lib/summary');
const { signedInUser } = require('../lib/security');

const noStore = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };

app.http('data', {
  route: 'data',
  methods: ['GET'],
  authLevel: 'anonymous', // access is enforced by SWA auth + signedInUser()
  handler: async (request, context) => {
    if (!signedInUser(request)) return { status: 401, headers: noStore, jsonBody: { error: 'Sign-in required' } };
    try {
      return { status: 200, headers: noStore, jsonBody: await buildSummary() };
    } catch (err) {
      context.error('data: summary failed', err);
      return { status: 502, headers: noStore, jsonBody: { error: 'Could not read call data from 3CX' } };
    }
  },
});
