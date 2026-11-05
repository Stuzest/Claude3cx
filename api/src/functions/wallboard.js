/*
 * Everon Call Dashboard — api/src/functions/wallboard.js
 * Version: 1.1.0
 *
 * What this file does (v1.1.0):
 *   GET /api/wallboard — same summary as /api/data for the TV wallboard.
 *   No sign-in; instead needs the secret key (X-Wallboard-Key header, taken by
 *   the page from its URL #fragment) and an office IP. View-only: GET only.
 *   Refusals return 403 with a generic message; the reason is only logged.
 */
'use strict';

const { app } = require('@azure/functions');
const { buildSummary } = require('../lib/summary');
const { wallboardCheck } = require('../lib/security');

const noStore = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };

app.http('wallboard', {
  route: 'wallboard',
  methods: ['GET'],
  authLevel: 'anonymous', // access is enforced by wallboardCheck()
  handler: async (request, context) => {
    const refused = wallboardCheck(request);
    if (refused) {
      context.warn(`wallboard: refused — ${refused}`);
      return { status: 403, headers: noStore, jsonBody: { error: 'Wallboard access not allowed from here' } };
    }
    try {
      return { status: 200, headers: noStore, jsonBody: await buildSummary() };
    } catch (err) {
      context.error('wallboard: summary failed', err);
      return { status: 502, headers: noStore, jsonBody: { error: 'Could not read call data from 3CX' } };
    }
  },
});
