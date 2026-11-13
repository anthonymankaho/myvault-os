# ⬡ MyVault OS — Personal OS

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://anthonymankaho.github.io/myvault-os)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Office Qwen (myoffice):** start with [`HANDOFF.md`](HANDOFF.md) — consolidated handoff (auditor portal, Owner Console codes, galaxy constellation, environment gotchas, standing conventions), then the dated `Processing status · 處理狀態` entries below.

MyVault OS is a multi-platform AI personal operating system, with a lightweight web dashboard and a GitHub-backed personal vault.

## Features

- Personal dashboard for skills, projects, documents, and chats
- **Galaxy constellation**: every item in MyVault OS is a star — projects, skills, documents, chats, monthly tasks, the three accounting systems and the game — and every section is its own solar system with a glowing sun, orbiting stars, orbit rings and cross-system link lines. Animated 3D (Three.js, vendored locally so it works offline) with a dependency-free 2D solar-system map as fallback
- Accounting System section launching the GPL, EIC, and MPL company systems from private repos via GitHub access — the signed-in owner and team open each system directly, no access code — plus a one-way **Auditor Access Portal** link and an owner-only console for the auditors' portal codes
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
- `worker/` — Cloudflare Worker that proxies GitHub OAuth, vault storage, and authenticated private accounting-system file access (`npm test` runs the vitest suite)

## Games

The **Games** view is a first-class workspace section alongside Projects, Skills, Documents, and Chats. Its built-in **Neon Apex** arcade racer runs in an isolated page, so game controls and saved lap times do not modify or sync with the personal vault. The player drives an original classic coupe with sloped windows, two-tone trim, animated wheels, brake lights, and tire smoke during drifts. A race rolls from the back of a four-car grid after a 3-2-1 start. The coupe turns with its tires: speed sets how tight a corner it can hold, so the tight end of the oval needs a brake, and holding Space while steering (or brake and steer on touch) breaks the rear loose. Mira, Kai, and Sol each hold a pace, slow for the same bends, and defend their line when you close up. Tuck in behind a car to draft — a higher speed cap, faster boost refill, and a DRAFT marker — then pull out to pass. Contact or leaving the tarmac gives the place back. Use the arrow keys to steer and accelerate or brake, hold Shift for boost, hold Space while steering above 95 km/h to drift, and press Escape or P to pause. On touch devices, hold brake while steering above 95 km/h to drift. Touch steering, gas, brake, and nitro appear when the device can touch, and the Auto / Touch / Keyboard control can force them on. Fullscreen expands the whole game, with a viewport-filling fallback where the Fullscreen API is unavailable. A track map shows every car during the race, and the finish screen lists the order with gaps. The synthesized engine has a Sound / Muted toggle saved in this browser. Pick one of three maps before a race: Night Circuit (the original oval), Harbour Lights (long waterfront straights and tight hairpins), or Dusk Ridge (uneven canyon sweepers). Each map keeps its own best lap, stored in the current browser only.

The game source is `games/neon-apex.html`, with the grip model in `games/neon-apex-drive.mjs` and the grid, rival pace, draft, and results in `games/neon-apex-race.mjs`. It is served as a separate iframe page from the Games library. It is also a standalone, installable web app with its own manifest and icon. On iPad, open the standalone game URL in Safari, tap Share → Add to Home Screen, enable Open as Web App, and tap Add. The game files and a pinned local Three.js module are cached by `games/sw.js` for offline use after the first online launch. When changing the game assets, update the cache name in `games/sw.js` so installed copies receive a fresh asset set. Three.js retains its MIT license in `games/vendor/THREE-LICENSE.txt`.

## Live app

https://anthonymankaho.github.io/myvault-os

## Accounting System

The **Accounting System** view is a first-class workspace section alongside Documents and Chats. It launches the three company accounting systems — **GPL** (Gold Plume Limited), **EIC**, and **MPL** (Meyer Properties Limited) — online, either embedded in the workspace (with a full-screen mode) or in a new tab. A status strip shows whether a GitHub session is detected: signed in, each system opens **directly** with your repository access (the owner never enters an access code); signed out, it points to the GitHub sign-in. Below the systems, a dedicated **Auditor Access · 審計員入口** section groups the one-way portal link and the owner-only code console.

Each public `systems/<Company>_System.html` URL is a **GitHub-only sign-in shell**, not the application source. It reads the existing MyVault GitHub OAuth session and asks the Cloudflare Worker (`accounting-system` action with `payload.system` = `gpl` / `eic` / `mpl`; the legacy `gpl-system` action still works) to load the system from its private repository. A signed-in session with repository access loads the system automatically — there is no access-code field on the shell. Visitors without a session see the sign-in gate plus a bilingual **External auditor? 外聘審計員？** hint pointing to the Auditor Access Portal:

| System | Private source |
| --- | --- |
| GPL | `anthonymankaho/GPL` → `GPL-System/GPL_System.html` |
| EIC | `anthonymankaho/EIC` → `EIC-System/EIC_System.html` |
| MPL | `anthonymankaho/MPL` → `MPL_System.html` |

Access is granted only when GitHub authorizes that signed-in account to read the private file. The Worker returns the HTML with caching disabled; the full systems and their embedded workbook data are not stored in this public repository's current files. When a shell is embedded in the Accounting view it hides its standalone back link — the workspace provides **Back to Accounting**, **Full screen**, and Escape-to-exit.

### Auditor access codes (portal only)

Access codes are entered **only at the Auditor Access Portal** — the MyVault OS shells are GitHub-only and no longer accept codes. The Worker checks a portal code (constant-time) against the code stored in the `QWEN_USAGE` KV namespace under `auditor-code:<system>`, falling back to the `GPL_STANDALONE_CODE` / `EIC_STANDALONE_CODE` / `MPL_STANDALONE_CODE` env secret, and on a match reads the private repo with a **server-side read-only token** (`GH_REPO_READ_TOKEN`) instead of a visitor's token. The data is never served without a valid code. A system's code path stays disabled until a code and `GH_REPO_READ_TOKEN` are both configured (fail-closed, 503).

**The owner sets the codes in the app, not on the command line:** sign in with GitHub, open **Accounting System** → **Auditor Access**, and use the **Owner Console / 管理員** panel (visible only to the signed-in owner) to type a new code per company and press **Save code**. Press **Show code / 顯示** to retrieve the current code (with a **Copy** button) — e.g. to hand it to the auditor; **Hide** clears it from view, and saving a new code hides any stale revealed value. The Worker actions `set-standalone-code`, `standalone-code-status` and `reveal-standalone-code` verify the caller's GitHub identity against `QWEN_ALLOWED_GITHUB_USER` server-side; the status response reports only configured/not-set, and reveal returns the code only to the verified owner. `GH_REPO_READ_TOKEN` is still set with `wrangler secret put GH_REPO_READ_TOKEN` from `worker/`; it should be a fine-grained GitHub PAT with **Contents: read** on the private repos only.

### Auditor Access Portal (one-way link)

The Accounting view's **Auditor Access** section carries a banner link to the independent **Auditor Access Portal** at <https://anthonymankaho.github.io/auditor-portal/> (repo `anthonymankaho/auditor-portal`). The link is one-way: the portal shows only the three companies and never links back to MyVault or exposes any vault content. The portal is the **only** place an access code is entered; the MyVault shells point auditors there instead of accepting codes. Auditors enter the per-company code at the portal; it then opens each system in a full-screen viewer and provisions a dedicated read-only `auditor` session through the system's own account machinery (MPL in review mode, external FINSYS tile hidden), so no second username/password login is needed. An existing session in the same browser (e.g. the owner's master account) is never replaced.

### Processing status · 處理狀態 (2026-11-13, office Qwen — owner direct access)

- Shipped (local commit; push gated on Anthony): **removed the standalone access-code gate from all three MyVault shells** (`systems/*.html`). The shells are GitHub-only: a signed-in MyVault session with repository access loads each system directly — the owner never sees a code field. Each shell now carries a bilingual **External auditor? 外聘審計員？** hint linking to the Auditor Access Portal (replaces the old Owner Console hint).
- **Accounting page improved:** owner status strip (signed-in → direct access, signed-out → sign-in prompt), card tags switch to `SIGNED IN · DIRECT ACCESS`, "Standalone ↗" renamed **New tab ↗**, and the portal banner + Owner Console are grouped into one **Auditor Access · 審計員入口** section ("Third-party review 第三方審計") below the systems. Owner Console copy now says codes are portal-only. Embedded-shell cache buster bumped to `?v=accounting-2`.
- **Loading state (commit `76a6441`):** signed-in owners no longer see the sign-in card while a system loads — the shells show a dedicated bilingual **Opening … System 開啟中** panel with a spinner (reduced-motion aware); the sign-in gate appears only when signed out or access is denied.
- **Kept unchanged:** the Auditor Access Portal, the Owner Console (set/show/copy), and the Worker (`accounting-system` code path + `set-standalone-code` / `standalone-code-status` / `reveal-standalone-code`) — the portal still needs them. **No Worker deploy required.**
- Verified on the office PC: `node --check app.js` clean; frontend Node suites **70/70**; Worker vitest **75/75**; headless Chromium (local static server, Worker stubbed, fake token — no real credentials) **94/94**: guest + owner desktop flows, all three shells (no code field, auditor hint, embedded back-link hidden), owner straight-in load via Bearer (no `payload.code`), loading panel shown during a delayed response then cleared (gate stays hidden), reveal/hide/copy/save console regression, 403 denial + clear, full screen/Escape/back, mobile 390×844, zero page errors. Screenshots: `.qwen\tmp\shots\myvault-owner-direct-*.png`.
- Supersedes the shell "Unlock" path in the 2026-11-14 entry below and HANDOFF.md §1.D. Codes remain configured and owner-retrievable; auditors use the portal only.

### Processing status · 處理狀態 (2026-11-14, for office Qwen)

- Shipped: owner-only **Show code / Copy** reveal in the Accounting Owner Console (Worker action `reveal-standalone-code`, GitHub identity verified server-side; 404 when unset, 401/403 otherwise), plus a bilingual hint on all three standalone shells pointing to the Owner Console. This answers "where do I find the standalone access code": Accounting System → Owner Console → Show code.
- All three codes are configured (set 2026-11-12 via the console) and retrievable by the owner; the auditor portal and the shells' Unlock screens accept them.
- Verified: 29/29 Node tests, 27/27 real-Chrome UI checks (reveal/hide/copy/save-stale-clear/unset-error, mobile, all three shell hints + unlock flow), live reveal probes (401 without auth, 200 owner-only for gpl/eic/mpl, values never logged). Worker deployed (version 025f5798).
- Supersedes the 2026-11-12 "no codes configured" note below.

### Processing status · 處理狀態 (2026-11-12, for office Qwen)

- Deployed: Worker `myvault-api` now supports owner-managed auditor codes (`set-standalone-code`, `standalone-code-status`, KV-backed with env-secret fallback) and the Accounting view shows the auditor portal banner + Owner Console. Frontend tests 16/16 (`node --test test/app.test.cjs`), accounting UI 21/21 in real Chrome, owner code cycle verified live (set → status → portal unlock → cleanup).
- The previously generated `*_STANDALONE_CODE` env secrets were **deleted**; no codes are configured right now. **Owner action pending:** sign in at <https://anthonymankaho.github.io/myvault-os/#accounting> and set one code per company in the Owner Console. Until then the auditor portal fails closed with "Service not ready" (503).
- `GH_REPO_READ_TOKEN` currently reuses the owner's gh OAuth token (broad repo scope) as an interim measure; replace it with a fine-grained Contents-read-only PAT on GPL/EIC/MPL when convenient.
- Local note: workerd/vitest cannot run on the Surface Book (directory-creation blocked); Worker changes are verified by deploying and probing the live endpoint. The desktop `myvault-os` clone is diverged (ahead 54 / behind 75) — deploy from a fresh `origin/main` worktree, never from that clone.

## Screenshot

_Screenshot coming soon._

## Frontend validation

Run `node --check app.js` and `node --test test/app.test.cjs` with Node.js 18 or newer. Serve the repository with any static HTTP server to preview it. GitHub OAuth still uses the configured production callback and Worker; a local preview does not establish a production sign-in session.

The app opens on **Dashboard**. Choose **Constellation** to open the **galaxy**: every item in the workspace is a star and every section is its own solar system. Projects, skills, documents, chats and monthly tasks each orbit a glowing section sun; the three accounting systems (GPL/EIC/MPL) and the Neon Apex game form their own systems too. Each section has a distinct sun/star hue, orbit rings, animated orbits, twinkling starfield, drifting nebulae, and glowing link lines that follow the moving stars — including links that cross between systems. Section suns carry bilingual labels (English + 繁體中文).

The 3D view offers a permanent control region: **Labels**, **Links**, **Motion** (orbit animation), **Rotate** (auto-orbit), **Glow** and **Speed** sliders, zoom −/%/+, and **Reset**, plus one chip per solar system that flies the camera to that system. Click a sun or its chip to visit a system; click a star to inspect it and open its record (tasks open the task dialog, accounting/game stars open their sections). Search (`/`) matches every item across all sections. Drag to orbit, scroll or pinch to zoom; rendering pauses off the constellation page and honours `prefers-reduced-motion`.

Three.js is vendored at `games/vendor/three.module.js` and resolved through the import map, so the 3D galaxy works **offline** with no CDN. A dependency-free SVG map is the fallback and mirrors the same solar-system grouping: section suns with orbit guides, every item as a labelled star, per-section filters, a keyboard-accessible record index, and pan/zoom. **Back to 2D map** switches views; **Try 3D** retries 3D. If WebGL or loading fails, the 2D map remains available. An empty vault offers **Create a project** and a clearly labelled **Explore a sample** preview; sample records never enter the vault, storage, or GitHub sync. Add connections by entering an existing record name per line in a project/skill's **Connected projects or skills** field — only explicit links form edges. Build / Repair retains explicit **Apply changes** before syncing.

Section colours, solar-system layout and orbit maths live in one shared module, `constellation-systems.mjs`, used by both renderers. Run `node --test test/app.test.cjs test/constellation.test.mjs test/constellation-systems.test.mjs` for data/sync, 2D layout/search/link/wrapping, and solar-system layout checks; `node --test test/*.test.*` also covers the game and AI contract.

### Processing status · 處理狀態 (2026-11-13, for office Qwen)

- Shipped: galaxy constellation upgrade — all items (projects/skills/docs/chats/tasks + accounting systems + game) are stars; each section is a solar system in both 3D and the 2D fallback; new shared layout module `constellation-systems.mjs`; offline vendored Three.js via import map; bilingual sun labels; permanent control region (Labels/Links/Motion/Rotate/Glow/Speed/zoom/Reset + per-system camera chips).
- Verified: 70/70 Node tests (app 16, constellation 5, systems 8, game 12, Qwen 29) and 37/37 real-Chrome WebGL checks (render, controls, search→task dialog end-to-end, drag orbit, 3× enter/leave without leaks, 2D fallback when 3D blocked, mobile 390px, zero runtime errors). Screenshots inspected for desktop overview, focused systems and mobile.
- No owner action required. The auditor-code owner console and portal from 2026-11-12 are unchanged; codes are still set at `#accounting` → Owner Console.

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
