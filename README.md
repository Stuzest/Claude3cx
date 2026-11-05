# Everon Call Dashboard

Live 3CX (V20) call dashboard for the Everon helpdesk, hosted on Azure Static Web Apps with a managed Azure Functions API.

## Versions
**1.1.0** — Backend added.
- `api/` Azure Functions (Node 20): `/api/data` (Entra sign-in) and `/api/wallboard` (secret key + office IP). They read 3CX through the XAPI with an API client ID/key.
- `frontend/wallboard.html` TV page and `frontend/staticwebapp.config.json` (single-tenant Entra sign-in, routes, security headers).
- GitHub Actions workflow: runs the API tests, then deploys on every push to `main`.
- `tools/inspect-3cx.js` lets you check how your PBX records calls before the first deploy.
- Fixes: wallboard text was unreadable (dark on dark). The dashboard now sends you to sign in again when your session expires.

**1.0.0** — Dashboard frontend:
- **Busiest hours**: Mon–Fri × hour grid, RAG by inbound calls per hour (red 20+, amber 10–19, green under 10).
- **Missed calls**: missed/total per hour, RAG by % missed (green under 5%, amber 5–15%, red over 15%). Hover shows the split.
- **Daily**: one square per working day (Mon–Fri), total and missed.
- **Agents**: live queue login status and calls answered today.

## How calls are counted
A call is counted if the caller was **external** and the call **reached a Support queue** (`QUEUE_NUMBERS`, default `8006`). Each counted call is then:
- **Answered**: an extension picked it up.
- **Answering service**: not answered, and the PBX sent it out to an external number. To count only calls to a specific number, set `ANSWERING_SERVICE_NUMBERS`.
- **Missed in queue**: not answered and not sent out (abandoned, timed out, voicemail).

Call history is cached and refreshed every 15 minutes. Agent status is refreshed every 60 seconds. 3CX only exposes one overall `QueueStatus` per user, so "Logged in" means logged into the user's queues generally, not specifically into 8006.

## Setup
1. **3CX**: in the Admin console, go to Integrations › API and add a client with read access. Note the client ID and API key. Then run the inspect tool locally to check the output against the rules above:
   ```powershell
   $env:THREECX_URL="https://yourpbx.3cx.co.uk"; $env:THREECX_CLIENT_ID="..."; $env:THREECX_CLIENT_SECRET="..."
   cd api; npm install; cd ..; node tools/inspect-3cx.js
   ```
2. **Entra**: create an app registration (single tenant). Set the redirect URI to `https://<site>/.auth/login/aad/callback` and create a client secret. Put the tenant ID into `frontend/staticwebapp.config.json` in place of `<TENANT_ID>`.
3. **Azure Static Web App**: use the **Standard** plan, which custom Entra auth requires. Copy its deployment token into the GitHub repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN`.
4. **App settings** (Static Web App › Environment variables):

| Setting | Value |
|---|---|
| `THREECX_URL` | `https://yourpbx.3cx.co.uk` (no trailing slash) |
| `THREECX_CLIENT_ID` / `THREECX_CLIENT_SECRET` | 3CX API client |
| `AAD_CLIENT_ID` / `AAD_CLIENT_SECRET` | Entra app registration |
| `ALLOWED_EMAIL_DOMAINS` | `everon.co.uk` |
| `QUEUE_NUMBERS` | `8006` |
| `ANSWERING_SERVICE_NUMBERS` | optional, comma-separated |
| `WALLBOARD_KEY` | 32+ random characters |
| `WALLBOARD_ALLOWED_IPS` | office public IP(s), e.g. `203.0.113.10/32` |
| Optional | `LOOKBACK_DAYS` (30), `FIRST_HOUR` (7), `LAST_HOUR` (18), `HISTORY_REFRESH_MINUTES` (15), `AGENTS_REFRESH_SECONDS` (60), `VOLUME_RED`/`VOLUME_AMBER`, `MISSED_AMBER_PCT`/`MISSED_RED_PCT` |

5. Push to `main`. The workflow tests the API and deploys it.

## Wallboard
Open `https://<site>/wallboard.html#key=<WALLBOARD_KEY>` on the TV. The key stays in the `#fragment`, so it is never sent in a URL or written to logs. The API only answers requests from `WALLBOARD_ALLOWED_IPS`, and refusals return a generic 403. To revoke access, change `WALLBOARD_KEY`.

## Development
`cd api && npm test` runs the classification and wallboard-security tests against a fake 3CX.

This repo is **public**. Keep every key, secret and call export out of it. `local.settings.json` is git-ignored; copy `api/local.settings.sample.json` to create it.
