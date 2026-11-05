// Everon Call Dashboard — api/test/summary.test.js (v1.1.0)
// Runs buildSummary() against a fake 3CX XAPI to check classification,
// the response shape the frontend expects, and the wallboard checks.
'use strict';
const test = require('node:test');
const assert = require('node:assert');

Object.assign(process.env, {
  THREECX_URL: 'https://pbx.example', THREECX_CLIENT_ID: 'id', THREECX_CLIENT_SECRET: 'secret',
  QUEUE_NUMBERS: '8006', WALLBOARD_KEY: 'k'.repeat(40), WALLBOARD_ALLOWED_IPS: '203.0.113.0/28,2001:db8::1',
});

const now = Date.now();
const at = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();
let id = 100;
const seg = (call, o) => ({ SegmentId: id++, CallHistoryId: call, SegmentStartTime: o.t, SrcDn: o.src ?? '', SrcExternal: !!o.srcExt,
  DstDn: o.dst ?? '', DstExternal: !!o.dstExt, DstCallerNumber: o.num ?? '', CallAnswered: !!o.ans });
const rows = [
  // A: answered by 7504
  seg('A', { t: at(30), src: '10000', srcExt: true, dst: '8006' }), seg('A', { t: at(30), src: '10000', srcExt: true, dst: '7504', ans: true }),
  // B: sent to answering service
  seg('B', { t: at(20), src: '10000', srcExt: true, dst: '8006' }), seg('B', { t: at(19), src: '8006', dst: '10000', dstExt: true, num: '01234567890', ans: true }),
  // C: abandoned in queue
  seg('C', { t: at(10), src: '10000', srcExt: true, dst: '8006' }),
  // D: outbound call — ignored
  seg('D', { t: at(5), src: '7504', dst: '10000', dstExt: true, ans: true }),
  // E: inbound to a direct extension, never hit the queue — ignored
  seg('E', { t: at(4), src: '10000', srcExt: true, dst: '7506', ans: true }),
];

global.fetch = async (url) => {
  const u = new URL(url);
  const json = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
  if (u.pathname === '/connect/token') return json({ access_token: 't', expires_in: 3600 });
  if (u.pathname.endsWith('/Queues')) return json({ value: [{ Number: '8006', Agents: [{ Number: '7504', Name: 'Agent One' }, { Number: '7506', Name: 'Agent Two' }] }] });
  if (u.pathname.endsWith('/Users')) return json({ value: [{ Number: '7504', QueueStatus: 'LoggedIn' }, { Number: '7506', QueueStatus: 'LoggedOut' }] });
  if (u.pathname.endsWith('/CallHistoryView')) {
    const skip = Number(u.searchParams.get('$skip') || 0);
    return json({ value: skip ? [] : [...rows].reverse() });
  }
  return { ok: false, status: 404, text: async () => 'nope' };
};

const { buildSummary, london } = require('../src/lib/summary');
const { wallboardCheck, ipAllowed } = require('../src/lib/security');

test('summary counts only inbound queue calls and splits missed', async () => {
  const s = await buildSummary();
  const t = london(new Date(now - 30 * 60000));
  if (t.date === s.today.date) {
    assert.deepStrictEqual({ total: s.today.total, as: s.today.answeringService, q: s.today.queueMissed, m: s.today.missed },
      { total: 3, as: 1, q: 1, m: 2 });
    assert.strictEqual(s.today.missedPct, 66.7);
  }
  assert.strictEqual(s.period.total, 3);
  assert.strictEqual(s.hourly.length, 5 * s.hours.length);
  assert.ok(s.daily.every((d) => d.dow >= 1 && d.dow <= 5));
  const one = s.agents.find((a) => a.number === '7504');
  assert.strictEqual(one.loggedIn, true);
  assert.strictEqual(s.agents[0].number, '7504'); // logged-in first
  assert.strictEqual(s.agents.find((a) => a.number === '7506').loggedIn, false);
  for (const k of ['version', 'generatedAt', 'timezone', 'lookbackDays', 'thresholds', 'outOfHours', 'agentsError']) assert.ok(k in s, k);
});

test('wallboard needs key and allowed IP', () => {
  const req = (ip, key) => ({ headers: new Map([['x-forwarded-for', ip], ['x-wallboard-key', key]]) });
  assert.strictEqual(wallboardCheck(req('203.0.113.5:51234', 'k'.repeat(40))), null);
  assert.match(wallboardCheck(req('198.51.100.1', 'k'.repeat(40))), /not in/);
  assert.match(wallboardCheck(req('203.0.113.5', 'wrong')), /wrong key/);
  assert.ok(ipAllowed('2001:db8::1', ['2001:db8::1']));
  assert.ok(!ipAllowed('203.0.113.16', ['203.0.113.0/28']));
});
