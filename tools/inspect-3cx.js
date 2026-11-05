/*
 * Everon Call Dashboard — tools/inspect-3cx.js
 * Version: 1.1.0
 *
 * What this file does (v1.1.0):
 *   One-off check to run on your own machine before the first deploy. It uses
 *   the same API client as the Function and prints:
 *     - the field names 3CX returns from CallHistoryView on your PBX
 *     - the segments of the most recent call that touched the Support queue
 *     - the queue's agents and their QueueStatus
 *   so you can confirm the classification in api/src/lib/summary.js matches
 *   how your calls are recorded. Read-only. Prints phone numbers — don't paste
 *   the output anywhere public.
 *
 *   Usage (PowerShell):
 *     $env:THREECX_URL="https://yourpbx.3cx.co.uk"; $env:THREECX_CLIENT_ID="..."; $env:THREECX_CLIENT_SECRET="..."
 *     node tools/inspect-3cx.js
 */
'use strict';
const { xapi } = require('../api/src/lib/threecx');
const config = require('../api/src/lib/config');

(async () => {
  const hist = await xapi('CallHistoryView', { $orderby: 'SegmentId desc', $top: 500 });
  const rows = hist.value || [];
  if (!rows.length) return console.log('CallHistoryView returned no rows.');
  console.log('CallHistoryView fields:\n ', Object.keys(rows[0]).join(', '));

  const key = (r) => r.CallHistoryId ?? r.MainCallHistoryId ?? r.CallId;
  const q = new Set(config.queueNumbers);
  const hit = rows.find((r) => q.has(String(r.DstDn)));
  if (hit) {
    console.log(`\nSegments of the latest call to queue ${config.queueNumbers.join('/')} (group ${key(hit)}):`);
    console.table(rows.filter((r) => key(r) === key(hit)).sort((a, b) => a.SegmentId - b.SegmentId).map((r) => ({
      SegmentId: r.SegmentId, Start: r.SegmentStartTime, SrcDn: r.SrcDn, SrcExternal: r.SrcExternal,
      DstDn: r.DstDn, DstExternal: r.DstExternal, DstNumber: r.DstCallerNumber, Answered: r.CallAnswered,
    })));
  } else {
    console.log('\nNo call to the queue in the last 500 segments.');
  }

  const filter = config.queueNumbers.map((n) => `Number eq '${n}'`).join(' or ');
  const queues = await xapi('Queues', { $filter: filter, $expand: 'Agents' });
  const users = await xapi('Users', { $select: 'Number,FirstName,LastName,QueueStatus', $top: 2000 });
  const status = new Map((users.value || []).map((u) => [String(u.Number), u.QueueStatus]));
  for (const queue of queues.value || []) {
    console.log(`\nQueue ${queue.Number} ${queue.Name || ''} agents:`);
    console.table((queue.Agents || []).map((a) => ({ Number: a.Number, Name: a.Name, QueueStatus: status.get(String(a.Number)) })));
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
