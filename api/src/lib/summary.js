/*
 * Everon Call Dashboard — api/src/lib/summary.js
 * Version: 1.1.0
 *
 * What this file does (v1.1.0):
 *   Builds the JSON the dashboard draws (same shape for /api/data and
 *   /api/wallboard).
 *
 *   Call history  – pulled from XAPI CallHistoryView (one row per call
 *                   segment), cached in memory and refreshed every 15 minutes.
 *                   The first load pages back 30 days; later loads fetch only
 *                   new segments (filtering on SegmentId, because 3CX rejects
 *                   date filters on this view) plus the last 2 hours again so
 *                   calls still in progress are updated.
 *   Classifying   – segments are grouped into calls. A call counts if the
 *                   caller was external and it reached a Support queue. Then:
 *                     answered          – an agent extension picked it up
 *                     answering service – not answered, and the PBX sent it
 *                                         out to an external number
 *                     missed in queue   – not answered, and not sent out
 *                                         (abandoned, timed out, voicemail)
 *   Agents        – Support queue members from Queues/$expand=Agents, with
 *                   Users.QueueStatus for logged in/out, refreshed every 60s.
 *                   Note: 3CX only exposes an overall QueueStatus per user, not
 *                   a per-queue one.
 *   If a refresh fails the last good data is served and the error is logged.
 */
'use strict';

const config = require('./config');
const { xapi } = require('./threecx');

const PAGE = 1000;
const MAX_PAGES = 60;
const REWIND_MS = 2 * 3600 * 1000;
const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// ---------- time helpers (Europe/London) ----------
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23', weekday: 'short',
});
function london(date) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), dow: DOW[p.weekday] };
}
const pct = (missed, total) => (total ? Math.round((missed / total) * 1000) / 10 : 0);
const digits = (s) => String(s || '').replace(/\D/g, '');

// ---------- call history cache ----------
const segments = new Map(); // SegmentId -> row
let historyAt = 0;
let historyPromise = null;

function groupKey(r) {
  return r.CallHistoryId ?? r.MainCallHistoryId ?? r.CallId ?? null;
}

async function fetchPagesDesc(stopBefore) {
  // Newest first until we pass the cutoff.
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await xapi('CallHistoryView', { $orderby: 'SegmentId desc', $top: PAGE, $skip: page * PAGE });
    const rows = body.value || [];
    for (const r of rows) segments.set(r.SegmentId, r);
    const oldest = rows.at(-1);
    if (rows.length < PAGE || !oldest || new Date(oldest.SegmentStartTime).getTime() < stopBefore) return;
  }
}

async function fetchSince(fromId) {
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await xapi('CallHistoryView', {
      $filter: `SegmentId gt ${Number(fromId)}`, $orderby: 'SegmentId asc', $top: PAGE, $skip: page * PAGE,
    });
    const rows = body.value || [];
    for (const r of rows) segments.set(r.SegmentId, r);
    if (rows.length < PAGE) return;
  }
}

async function refreshHistory() {
  const cutoff = Date.now() - (config.lookbackDays + 1) * 86400000;
  if (!segments.size) {
    await fetchPagesDesc(cutoff);
  } else {
    // Re-read anything that started in the last 2 hours (calls in progress).
    const recent = Date.now() - REWIND_MS;
    let rewindId = Infinity;
    let maxId = 0;
    for (const r of segments.values()) {
      maxId = Math.max(maxId, r.SegmentId);
      if (new Date(r.SegmentStartTime).getTime() >= recent) rewindId = Math.min(rewindId, r.SegmentId);
    }
    await fetchSince((rewindId === Infinity ? maxId : rewindId) - 1);
  }
  for (const [id, r] of segments) if (new Date(r.SegmentStartTime).getTime() < cutoff) segments.delete(id);

  const sample = segments.values().next().value;
  if (sample && groupKey(sample) === null) {
    throw new Error(`CallHistoryView has no call grouping field. Fields seen: ${Object.keys(sample).join(', ')}`);
  }
  historyAt = Date.now();
}

async function ensureHistory() {
  if (Date.now() - historyAt < config.historyRefreshMs && segments.size) return;
  historyPromise ??= refreshHistory().finally(() => { historyPromise = null; });
  try {
    await historyPromise;
  } catch (err) {
    if (!segments.size) throw err; // nothing to fall back on
    console.error('Call history refresh failed, serving cached data:', err.message);
    historyAt = Date.now() - config.historyRefreshMs + 60000; // retry in a minute
  }
}

// ---------- agents cache ----------
let agentsCache = { at: 0, agents: [], extensions: new Set(), error: null };
let agentsPromise = null;

async function refreshAgents() {
  const qFilter = config.queueNumbers.map((n) => `Number eq '${n.replace(/'/g, '')}'`).join(' or ');
  const [queues, users] = await Promise.all([
    xapi('Queues', { $filter: qFilter, $expand: 'Agents' }),
    xapi('Users', { $select: 'Id,Number,FirstName,LastName,QueueStatus', $top: 2000 }),
  ]);
  const byNumber = new Map((users.value || []).map((u) => [String(u.Number), u]));
  const members = new Map();
  for (const q of queues.value || []) {
    for (const a of q.Agents || []) {
      const n = String(a.Number);
      const u = byNumber.get(n);
      const name = a.Name || (u ? `${u.FirstName || ''} ${u.LastName || ''}`.trim() : '') || n;
      members.set(n, { number: n, name, loggedIn: u ? u.QueueStatus === 'LoggedIn' : false });
    }
  }
  agentsCache = { at: Date.now(), agents: [...members.values()], extensions: new Set(byNumber.keys()), error: null };
}

async function ensureAgents() {
  if (Date.now() - agentsCache.at < config.agentsRefreshMs) return;
  agentsPromise ??= refreshAgents().finally(() => { agentsPromise = null; });
  try {
    await agentsPromise;
  } catch (err) {
    console.error('Agent refresh failed:', err.message);
    agentsCache = { ...agentsCache, at: Date.now() - config.agentsRefreshMs + 15000, error: "Couldn't read queue status from 3CX." };
  }
}

// ---------- classification ----------
function classify(rows, extensions) {
  rows.sort((a, b) => a.SegmentId - b.SegmentId);
  const queues = new Set(config.queueNumbers);
  const first = rows[0];
  const inbound = first.SrcExternal === true;
  const reachedQueue = rows.some((r) => queues.has(String(r.DstDn)) || queues.has(String(r.SrcDn)));
  if (!inbound || !reachedQueue) return null;

  const answered = rows.find((r) => r.CallAnswered === true && r.DstExternal !== true
    && !queues.has(String(r.DstDn)) && extensions.has(String(r.DstDn)));

  let outcome = 'answered';
  if (!answered) {
    const sentOut = rows.some((r) => r.DstExternal === true && (!config.answeringServiceNumbers.length
      || config.answeringServiceNumbers.some((n) => digits(r.DstCallerNumber).endsWith(n.slice(-9)))));
    outcome = sentOut ? 'answeringService' : 'queueMissed';
  }
  return { start: new Date(first.SegmentStartTime), outcome, agent: answered ? String(answered.DstDn) : null };
}

function blank() { return { total: 0, answeringService: 0, queueMissed: 0 }; }
function finish(o) { const missed = o.answeringService + o.queueMissed; return { ...o, missed, missedPct: pct(missed, o.total) }; }
function add(o, call) { o.total++; if (call.outcome !== 'answered') o[call.outcome]++; }

async function buildSummary() {
  await Promise.all([ensureHistory(), ensureAgents()]);
  const now = new Date();
  const today = london(now).date;
  const hours = [];
  for (let h = config.firstHour; h <= config.lastHour; h++) hours.push(h);

  // Dates in the lookback window
  const dates = new Set();
  for (let i = config.lookbackDays - 1; i >= 0; i--) dates.add(london(new Date(now.getTime() - i * 86400000)).date);

  // Group segments into calls
  const groups = new Map();
  for (const r of segments.values()) {
    const k = groupKey(r);
    if (k === null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const hourly = new Map();
  const daily = new Map();
  const period = blank();
  const todayTotals = blank();
  const ooh = blank();
  const answeredToday = new Map();
  const extensions = agentsCache.extensions.size ? agentsCache.extensions : new Set(agentsCache.agents.map((a) => a.number));

  for (const rows of groups.values()) {
    const call = classify(rows, extensions);
    if (!call) continue;
    const t = london(call.start);
    if (!dates.has(t.date)) continue;
    add(period, call);
    if (t.date === today) {
      add(todayTotals, call);
      if (call.agent) answeredToday.set(call.agent, (answeredToday.get(call.agent) || 0) + 1);
    }
    if (t.dow <= 5) {
      if (!daily.has(t.date)) daily.set(t.date, blank());
      add(daily.get(t.date), call);
    }
    if (t.dow <= 5 && t.hour >= config.firstHour && t.hour <= config.lastHour) {
      const k = `${t.dow}-${t.hour}`;
      if (!hourly.has(k)) hourly.set(k, blank());
      add(hourly.get(k), call);
    } else {
      add(ooh, call);
    }
  }

  const hourlyOut = [];
  for (let dow = 1; dow <= 5; dow++) for (const hour of hours) hourlyOut.push({ dow, hour, ...finish(hourly.get(`${dow}-${hour}`) || blank()) });

  const dailyOut = [...dates]
    .map((date) => ({ date, dow: ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1 }))
    .filter((d) => d.dow <= 5)
    .map((d) => ({ ...d, ...finish(daily.get(d.date) || blank()) }));

  const agents = agentsCache.agents
    .map((a) => ({ ...a, answeredToday: answeredToday.get(a.number) || 0 }))
    .sort((a, b) => (b.loggedIn - a.loggedIn) || (b.answeredToday - a.answeredToday) || a.name.localeCompare(b.name));

  const oohOut = finish(ooh);
  return {
    version: config.version,
    generatedAt: new Date(historyAt).toISOString(),
    timezone: config.timezone,
    lookbackDays: config.lookbackDays,
    hours,
    thresholds: config.thresholds,
    period: finish(period),
    hourly: hourlyOut,
    daily: dailyOut,
    outOfHours: { total: oohOut.total, missed: oohOut.missed },
    today: { date: today, ...finish(todayTotals) },
    agents,
    agentsError: agentsCache.error,
  };
}

module.exports = { buildSummary, classify, london };
