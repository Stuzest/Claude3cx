/*
 * Everon Call Dashboard — dashboard.js
 * Version: 1.0.0
 *
 * What this file does (v1.0.0):
 *   Fetches the summary and draws the four views:
 *     1. Busiest hours   – Mon–Fri x hour squares, RAG by number of inbound calls
 *     2. Missed calls    – same grid, shows "missed/total", RAG by % missed
 *                          (answering service + missed in queue, split on hover)
 *     3. Daily           – one square per working day, total + missed, RAG by % missed
 *     4. Agents          – live queue login status and calls answered today
 *   Dashboard mode reads /api/data (Entra sign-in).
 *   Wallboard mode reads /api/wallboard with the key from the URL #fragment
 *   (the fragment is never sent to a server or written to logs).
 *   Refreshes every 60 seconds; keeps the last good data if a refresh fails.
 */
(function () {
  'use strict';
  const MODE = document.body.dataset.mode || 'dashboard';
  const REFRESH_MS = 60000;
  const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const hh = (h) => String(h).padStart(2, '0') + ':00';

  // ---------- RAG rules ----------
  function volumeClass(total, t) {
    if (!total) return 'empty';
    if (total >= t.volumeRed) return 'crit';
    if (total >= t.volumeAmber) return 'warn';
    return 'good';
  }
  function missedClass(row, t) {
    if (!row.total) return 'empty';
    if (row.missedPct > t.missedRedPct) return 'crit';
    if (row.missedPct >= t.missedAmberPct) return 'warn';
    return 'good';
  }
  const RAG_WORD = { good: 'Green', warn: 'Amber', crit: 'Red', empty: 'No calls' };

  // ---------- Tooltip ----------
  const tip = document.createElement('div');
  tip.id = 'tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  function showTip(el, x, y) {
    tip.innerHTML = el.dataset.tip;
    tip.classList.add('show');
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(x + 14, innerWidth - r.width - 8) + 'px';
    tip.style.top = (y + 14 + r.height > innerHeight ? y - r.height - 10 : y + 14) + 'px';
  }
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) showTip(el, e.clientX, e.clientY);
    else tip.classList.remove('show');
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) { const r = el.getBoundingClientRect(); showTip(el, r.right, r.top); }
  });
  document.addEventListener('focusout', () => tip.classList.remove('show'));

  // ---------- Views ----------
  function heatmap(el, data, kind) {
    const t = data.thresholds;
    const weeks = Math.max(1, Math.round(data.lookbackDays / 7));
    let html = `<div class="grid" style="grid-template-columns: 44px repeat(${data.hours.length}, minmax(44px, 1fr))"><div></div>`;
    html += data.hours.map((h) => `<div class="hlabel">${hh(h)}</div>`).join('');
    for (let dow = 1; dow <= 5; dow++) {
      html += `<div class="rlabel">${DAY_NAMES[dow]}</div>`;
      for (const h of data.hours) {
        const r = data.hourly.find((x) => x.dow === dow && x.hour === h) || { total: 0, missed: 0, missedPct: 0, answeringService: 0, queueMissed: 0 };
        const slot = `${DAY_NAMES[dow]} ${hh(h)}–${hh(h + 1)}`;
        if (kind === 'volume') {
          const cls = volumeClass(r.total, t);
          const avg = (r.total / weeks).toFixed(1);
          html += `<div class="cell ${cls}" tabindex="0" aria-label="${slot}: ${r.total} calls, ${RAG_WORD[cls]}"
            data-tip="<b>${slot}</b><br>${r.total} inbound calls in ${data.lookbackDays} days<br>≈ ${avg} per ${DAY_NAMES[dow]}<br>${RAG_WORD[cls]}">${r.total || '–'}</div>`;
        } else {
          const cls = missedClass(r, t);
          html += `<div class="cell ${cls}" tabindex="0" aria-label="${slot}: ${r.missed} of ${r.total} missed, ${r.missedPct}%"
            data-tip="<b>${slot}</b><br>${r.missed} missed of ${r.total} calls (${r.missedPct}%)<br>Answering service: ${r.answeringService}<br>Missed in queue: ${r.queueMissed}">${
              r.total ? `${r.missed}/${r.total}<small>${Math.round(r.missedPct)}%</small>` : '–'}</div>`;
        }
      }
    }
    el.innerHTML = html + '</div>';
  }

  function daily(el, data) {
    const t = data.thresholds;
    // Group days into Mon–Fri weeks
    const weeks = [];
    for (const d of data.daily) {
      if (!weeks.length || d.dow === 1 || d.dow <= weeks.at(-1).at(-1).dow) weeks.push([]);
      weeks.at(-1).push(d);
    }
    const fmt = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    let html = '<div class="days"><div></div>' + DAY_NAMES.slice(1).map((d) => `<div class="hlabel">${d}</div>`).join('');
    for (const w of weeks.slice(MODE === 'wallboard' ? -4 : -6)) {
      const monday = w[0];
      html += `<div class="rlabel">w/c ${fmt(monday.date)}</div>`;
      for (let dow = 1; dow <= 5; dow++) {
        const d = w.find((x) => x.dow === dow);
        if (!d) { html += '<div></div>'; continue; }
        const cls = missedClass(d, t);
        const today = d.date === data.today.date ? ' today' : '';
        html += `<div class="cell ${cls}${today}" tabindex="0" aria-label="${DAY_NAMES[dow]} ${fmt(d.date)}: ${d.total} calls, ${d.missed} missed"
          data-tip="<b>${DAY_NAMES[dow]} ${fmt(d.date)}${today ? ' (today)' : ''}</b><br>${d.total} inbound calls<br>${d.missed} missed (${d.missedPct}%)<br>Answering service: ${d.answeringService}<br>Missed in queue: ${d.queueMissed}">
          <span class="d">${fmt(d.date)}</span><span class="n">${d.total} calls</span><small>${d.total ? `${d.missed} missed · ${Math.round(d.missedPct)}%` : 'no calls'}</small></div>`;
      }
    }
    el.innerHTML = html + '</div>';
  }

  function agents(el, data) {
    if (data.agentsError && !data.agents.length) { el.innerHTML = `<p class="desc">${esc(data.agentsError)}</p>`; return; }
    el.innerHTML = '<ul class="agents">' + data.agents.map((a) => `
      <li class="${a.loggedIn ? 'in' : 'out'}">
        <span class="dot" aria-hidden="true"></span>
        <span class="name">${esc(a.name)}<span class="ext">${esc(a.number)}</span></span>
        <span class="status">${a.loggedIn ? 'Logged in' : 'Logged out'}</span>
        <span class="count">${a.answeredToday}<small>answered</small></span>
      </li>`).join('') + '</ul>';
  }

  function kpis(data) {
    const t = data.thresholds;
    const inCount = data.agents.filter((a) => a.loggedIn).length;
    const todayCls = missedClass(data.today, t);
    const periodCls = missedClass({ total: data.period.total, missedPct: data.period.missedPct }, t);
    const pill = (cls) => `<i class="legend-dot" style="width:10px;height:10px;border-radius:50%;display:inline-block;background:var(--${cls === 'crit' ? 'crit' : cls === 'warn' ? 'warn' : cls === 'good' ? 'good' : 'empty'})"></i>${RAG_WORD[cls]}`;
    $('#kpis').innerHTML = `
      <div class="kpi"><div class="label">Calls today</div><div class="value">${data.today.total}</div><div class="sub">inbound so far</div></div>
      <div class="kpi"><div class="label">Missed today</div><div class="value">${data.today.missed}</div><div class="sub">${pill(todayCls)} · ${data.today.missedPct}% · ${data.today.answeringService} answering service, ${data.today.queueMissed} queue</div></div>
      <div class="kpi"><div class="label">Agents logged in</div><div class="value">${inCount}<span style="font-size:0.5em;color:var(--ink-3)"> / ${data.agents.length}</span></div><div class="sub">Support queue, live</div></div>
      <div class="kpi"><div class="label">Missed, last ${data.lookbackDays} days</div><div class="value">${data.period.missedPct}%</div><div class="sub">${pill(periodCls)} · ${data.period.answeringService + data.period.queueMissed} of ${data.period.total} calls</div></div>`;
  }

  function legends(data) {
    const t = data.thresholds;
    $('#legend-volume').innerHTML = `<span><i class="good"></i>Green: under ${t.volumeAmber} calls</span><span><i class="warn"></i>Amber: ${t.volumeAmber}–${t.volumeRed - 1}</span><span><i class="crit"></i>Red: ${t.volumeRed}+</span><span><i class="empty"></i>No calls</span>`;
    const m = `<span><i class="good"></i>Green: under ${t.missedAmberPct}% missed</span><span><i class="warn"></i>Amber: ${t.missedAmberPct}–${t.missedRedPct}%</span><span><i class="crit"></i>Red: over ${t.missedRedPct}%</span><span><i class="empty"></i>No calls</span>`;
    $('#legend-missed').innerHTML = m;
    $('#legend-daily').innerHTML = m;
    $('#desc-volume').textContent = `Inbound calls in each hour slot over the last ${data.lookbackDays} days, Monday to Friday. Hover for the weekly average.`;
    $('#desc-missed').textContent = `Missed / total calls per hour slot over the last ${data.lookbackDays} days, coloured by % missed. Missed = went to the answering service or the caller was lost in the queue.`;
  }

  function render(data) {
    kpis(data);
    legends(data);
    heatmap($('#volume'), data, 'volume');
    heatmap($('#missed'), data, 'missed');
    daily($('#daily'), data);
    agents($('#agents'), data);
    const gen = new Date(data.generatedAt);
    $('#updated').textContent = `Call history updated ${gen.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · agents live · v${data.version}`;
    $('#banner').classList.remove('show');
  }

  // ---------- Data ----------
  async function load() {
    if (window.__DEMO_DATA__) return window.__DEMO_DATA__;
    const headers = {};
    let url = '/api/data';
    if (MODE === 'wallboard') {
      const key = new URLSearchParams(location.hash.slice(1)).get('key') || '';
      headers['X-Wallboard-Key'] = key;
      url = '/api/wallboard';
    }
    const res = await fetch(url, { headers, cache: 'no-store', credentials: 'same-origin' });
    if (res.status === 401 && MODE === 'dashboard') { location.href = '/.auth/login/aad?post_login_redirect_uri=/'; throw new Error('Signing in…'); }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return res.json();
  }

  async function tick() {
    try {
      render(await load());
    } catch (err) {
      const b = $('#banner');
      b.textContent = `Couldn't refresh: ${err.message}. Showing the last data received.`;
      b.classList.add('show');
    }
  }

  function clock() {
    const el = $('#clock');
    if (el) el.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  }

  clock();
  setInterval(clock, 10000);
  tick();
  if (!window.__DEMO_DATA__) setInterval(tick, REFRESH_MS);
})();

