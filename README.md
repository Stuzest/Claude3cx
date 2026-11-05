# Everon Call Dashboard

Live 3CX (V20) call dashboard for the Everon helpdesk.

## Version 1.0.0 — what this version does
- **Busiest hours**: Mon–Fri × hour grid, RAG by inbound calls per hour (red 20+, amber 10–19, green under 10).
- **Missed calls**: same grid showing missed/total, RAG by % missed (green under 5%, amber 5–15%, red over 15%). Missed = forwarded to the answering service + missed/abandoned in queue; split shown on hover.
- **Daily**: one square per working day (Mon–Fri), total and missed calls.
- **Agents**: live queue login status and calls answered today.
- **Wallboard mode**: view-only, auto-refresh, reads `/api/wallboard` with a secret key in the URL `#fragment`.

## Layout
- `frontend/` — `index.html`, `dashboard.css`, `dashboard.js` (signed-in dashboard; reads `/api/data`).
- `api/` — Azure Function backend (`/api/data`, `/api/wallboard`) — **not yet committed**.
- `staticwebapp.config.json` — Entra sign-in enforcement — **not yet committed**.

Secrets (3CX API key, wallboard key) belong in Function app settings, never in this repo — it is public.
