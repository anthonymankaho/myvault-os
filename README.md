# ⬡ MyVault OS — Personal OS

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://anthonymankaho.github.io/myvault-os)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

MyVault OS is a multi-platform AI personal operating system, with a lightweight web dashboard and a GitHub-backed personal vault.

## Features

- Personal dashboard for skills, projects, documents, and chats
- Games library with an isolated, playable Three.js arcade racer
- Responsive overview with active projects, recent items, and quick capture
- Search across the vault (`/` shortcut), filter projects and skills, and sort records
- Keyboard-accessible add/edit dialogs that preserve imported metadata and links
- Clear local/synced status with pending changes preserved across refreshes
- Structured views with add, edit, delete, and search — no JSON editing needed for day-to-day use
- Build/Repair view with raw JSON access, validation, and one-click shape repair
- GitHub OAuth popup sign-in, with API requests routed through the MyVault Worker
- Vault stored as `vault.json` in the `myvault-data` GitHub repo (created automatically on first save)
- Local cache in the browser — the app works offline and syncs when you save
- Voice notes with the browser Web Speech API
- Installable progressive web app for iPad and other devices
- Vanilla HTML, CSS, and JavaScript; no build step or framework
- Monthly Task workspace with date-safe Hong Kong scheduling, Excel preview/import, rollover, month-end recurring auto-generation (Hong Kong public-holiday aware), completion tracking, and local backup/restore

## Vault shape

```json
{
  "skills":   [{ "id", "name", "level", "notes", "created" }],
  "projects": [{ "id", "name", "status", "notes", "created" }],
  "docs":     [{ "id", "title", "url", "tags", "notes", "created" }],
  "cards":    [],
  "chats":    [{ "id", "title", "url", "notes", "created" }],
  "meta":     { "created", "owner", "version", "voiceNotes" }
}
```

## Project layout

- `index.html`, `app.js`, `manifest.json` — the PWA frontend (GitHub Pages)
- `styles.css` — responsive workspace styling and reduced-motion support
- `test/app.test.cjs` — frontend data and synchronization checks (`node --test test/app.test.cjs`)
- `worker/` — Cloudflare Worker that proxies GitHub OAuth, vault storage, and authenticated private GPL file access (`npm test` runs the vitest suite)

## Games

The **Games** view is a first-class workspace section alongside Projects, Skills, Documents, and Chats. Its built-in **Neon Apex** arcade racer runs in an isolated page, so game controls and saved lap times do not modify or sync with the personal vault. Use the arrow keys to steer and accelerate or brake, hold Shift for boost, and press Escape or P to pause. Touch controls are available on mobile. The best lap is stored in the current browser only.

The game source is `games/neon-apex.html`; it is served as a separate iframe page from the Games library.

## Live app

https://anthonymankaho.github.io/myvault-os

## Protected GPL system

The public `systems/GPL_System.html` URL is a sign-in page, not the GPL application source. It reads the existing MyVault GitHub OAuth session and asks the Cloudflare Worker to load the system from the private `anthonymankaho/GPL` repository. Access is granted only when GitHub authorizes that signed-in account to read the private file. The Worker returns the HTML with caching disabled; the full GPL system and its embedded workbook data are not stored in this public repository's current files.

## Screenshot

_Screenshot coming soon._

## Frontend validation

Run `node --check app.js` and `node --test test/app.test.cjs` with Node.js 18 or newer. Serve the repository with any static HTTP server to preview it. GitHub OAuth still uses the configured production callback and Worker; a local preview does not establish a production sign-in session.

The app opens on **Dashboard**. Choose **Constellation** to open the 3D view by default. A built-in, dependency-free SVG map is available as a fallback: projects sit at the heart and skills orbit around them. Every skill name is shown in full by default, including large vaults; long names wrap. Search names, notes, and status/level, filter by record type, browse a keyboard-accessible record index, inspect connected records, and pan or zoom with touch, mouse, or the toolbar. Add connections by entering an existing project or skill name per line in a record's **Connected projects or skills** field. Only explicit links form edges.

An empty vault offers **Create a project** and a clearly labelled **Explore a sample** preview. Sample records never enter the vault, storage, or GitHub sync. The Three.js renderer loads automatically on the first visit to Constellation. **Back to 2D map** switches to the SVG view; **Try 3D** retries 3D there. If its CDN, WebGL, or loading timeout fails, the working 2D map remains available. Empty 3D vaults offer direct project and skill creation. In 3D, all skill labels remain visible by default, rotation starts paused, a star tap inspects before opening, and rendering pauses off the constellation page. Documents and chats stay in their existing views and do not become stars. Build / Repair retains explicit **Apply changes** before syncing.

Run `node --test test/*.test.*` for frontend, AI-contract, and constellation layout/search/link/wrapping checks.

Built with Kimi + Qwen AI.

## Qwen assistant

Use **Ask Qwen** in the utility bar after signing in with GitHub. The assistant receives a compact snapshot of the current local vault, including unsaved changes, and runs as a bounded agent: before its final answer it may issue up to **6 read-only `vault_search` calls** (matched against names/titles, statuses/levels, tags, URLs, notes, and IDs; at most 10 matches each with notes truncated to 300 characters), executed locally in the Worker and shown in the panel as search steps. The whole loop shares one **28-second budget** so it always finishes before the frontend aborts. It can answer questions or propose creates and updates for projects, skills, documents, and chats. Each proposal shows its fields or old/new differences. Choose operations, check the confirmation box, and press **Apply selected**. **Discard** changes nothing. **Undo last AI apply** is available while no newer vault edits have been made. Applying updates the local cache once; GitHub synchronization still requires the existing **Save changes** button.

Conversation history is held in memory only and disappears on page reload. Context excludes vault metadata, cards, imported source paths, and unknown fields; note context is capped at 1,200 characters per item. Replies and operations are validated on the server and again before Apply. Updates use IDs and preserve creation times and fields outside the proposal. The assistant cannot delete records.

### Monthly token quota

Every provider call's `usage` (prompt + completion tokens) is counted against a per-account quota of **5,000,000 tokens per calendar month (UTC)** — configurable with the `QWEN_MONTHLY_TOKEN_QUOTA` var. Counts persist in the `QWEN_USAGE` KV binding per GitHub login and month, the panel shows "Tokens this month: used / limit" (amber once usage passes 80%), and once the quota is spent the Worker fails closed with a safe message until the first day of the next month without calling Qwen. The production `QWEN_USAGE` namespace is already wired in `worker/wrangler.jsonc`, so accounting and enforcement start on the next deploy. A separate preview namespace for `wrangler dev` is optional:

```
cd worker
npx wrangler kv namespace create QWEN_USAGE --preview   # optional
```

Paste the preview ID as `preview_id` next to the production `id` if you create one. Without any binding the Worker skips accounting and enforcement, so the assistant keeps working (and tests need no KV).

## Monthly Task

The **Monthly Task / 工作任務** view keeps recurring work in a separate task collection. It supports Today, Overdue, Upcoming, Monthly, and Completed views; company/status/keyword filters; date-only Hong Kong scheduling; an in-app daily reminder; completion and reopen actions; CSV export; JSON backup/restore; and a rollover preview for incomplete work. Use **Import Excel** to preview and confirm the `NOV2026` sheet from the monthly workbook. Rows 2–47 are mapped as tasks, while planning notes outside the task range are excluded. Exact duplicate imports are skipped, ambiguous status text is retained in Doc/Result, and imported source metadata stays local to the vault.

The browser parses Excel locally with SheetJS; workbook contents are not sent to the parser service. Reminders are in-app only (there are no closed-tab push notifications).

### Monthly recurring auto-generation

Any task can be flagged **Monthly recurring / 每月重複** in the Add/Edit dialog (shown with a `↻ monthly` badge in the list). On app open near a month boundary — the last 2 days of a month plus the first 3 days of the next, Hong Kong time — the app automatically creates the next month's instance for each recurring task lineage:

- The description's month tokens are rewritten from the source month to the target month (`11/2026` → `12/2026`, `2026-11` → `2026-12`, `NOV2026` → `DEC 2026`; embedded full dates like `2026-11-02` are left untouched).
- The new date keeps the original day-of-month, clamped to the target month's length, then rolls forward to the next Hong Kong workday (Monday–Friday excluding public holidays, e.g. a day-6 anchor targeting February 2027 becomes `2027-02-10` because 6–7 February are the weekend and 8–9 February are Lunar New Year holidays).
- The new task is `Not Started` with an empty Doc/Result, is itself flagged recurring so the chain continues, and carries `carriedFromTaskId` plus an `autoRecurring` source marker.

Generation is idempotent: an existing instance of the same lineage in the target month prevents duplicates, so opening the app repeatedly in the window never creates copies. New tasks are local until you save, and a status-line notice reports how many tasks were created. The holiday table covers 2026 and 2027 (gazetted, gov.hk) and 2028 (estimate until gazetted — verify when published). The manual **Create Next Month / 建立下月** rollover uses the same workday logic.

### Worker configuration

The checked-in `worker/wrangler.jsonc` uses the Token Plan endpoint and model requested for this installation:

| Setting | Value / purpose |
| --- | --- |
| `QWEN_BASE_URL` | `https://token-plan.maas.qwencloudapi.com/compatible-mode/v1` |
| `QWEN_MODEL` | `qwen3.8-flash`; the code falls back to `qwen-plus` when unset |
| `QWEN_ALLOWED_GITHUB_USER` | `anthonymankaho`; Qwen requests verify this identity with GitHub |
| `QWEN_MONTHLY_TOKEN_QUOTA` | `5000000`; per-account monthly token budget counted from provider `usage` (prompt + completion tokens) |
| `QWEN_USAGE` | KV namespace binding that persists per-account monthly token counts (production ID wired in `wrangler.jsonc`) |
| `DASHSCOPE_API_KEY` | Worker **secret**, configured using `wrangler secret put DASHSCOPE_API_KEY` from the `worker` directory; never put its value in source, `.env`, logs, or frontend assets |

The original Singapore workspace endpoint format, `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`, is also supported. Only the configured approved hosts are accepted. Credentials and endpoints must belong to the same provider plan. The existing `GITHUB_CLIENT_SECRET` remains required for GitHub sign-in; GitHub tokens are used only for GitHub and are never sent to Qwen. Provider requests use manual redirect handling to avoid forwarding credentials. Qwen3 models use direct-answer mode, and the Worker includes exact collection counts alongside the compact records.

Requests use the OpenAI-compatible `/chat/completions` endpoint with JSON responses. Limits: 4,000-character messages, 12 history turns / 12,000 history characters, 200 context items per collection, 120 KB AI request, 12 operations, 8,000-character proposed notes, 128 KiB upstream responses, at most 6 `vault_search` tool calls per request, and a 28-second agent-loop budget (each provider call individually capped at 25 seconds). The frontend sends at most six previous turns and also times out requests. Provider quota, authentication, configuration, malformed-response, and timeout failures return safe messages without upstream bodies or credentials.

After changing Worker bindings, run `npx wrangler types --include-runtime=false`. Deploy from `worker` using `npm run deploy`. The frontend remains buildless.

### Qwen validation

Run `node --test test/*.test.*` in the root and `npm test -- --run` in `worker`. Tests cover all four create types, ID-based updates, invalid operations, stale previews, selection/confirmation, Discard, Undo, local cache persistence, unchanged manual GitHub saving, authentication, bounded inputs, quota handling, timeout, and credential isolation. Agent-loop tests cover tool execution and result feedback, the tool step budget with forced final answers, and rejection of unknown tools or oversized queries. Quota tests cover per-call token accounting, accumulation across the loop and across requests, fail-closed behavior when the monthly quota is spent (Qwen is never called), per-account/per-month keying, and the no-KV degradation path. The dock is a native keyboard-accessible dialog; at phone widths it fills the screen. Escape closes it and restores focus to **Ask Qwen**.
