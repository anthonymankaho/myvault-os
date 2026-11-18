# ⬡ MyVault OS — Personal OS

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://anthonymankaho.github.io/myvault-os)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Office Qwen (myoffice):** start with [`HANDOFF.md`](HANDOFF.md) — consolidated handoff (auditor portal, Owner Console codes, galaxy constellation, environment gotchas, standing conventions), then the dated `Processing status · 處理狀態` entries below.

MyVault OS is a multi-platform AI personal operating system, with a lightweight web dashboard and a GitHub-backed personal vault.

## Features

- Personal dashboard for skills, projects, documents, and chats
- **Report** register: a first-class section (same level as Skills) for monthly, quarterly and one-off reports — name, company/entity, period, status, link, tags and notes, with search, company filter, sort, a Dashboard count and its own solar system in the galaxy
- **Galaxy constellation**: every item in MyVault OS is a star — projects, skills, documents, chats, reports, monthly tasks, the three accounting systems and the game — and every section is its own solar system with a glowing sun, orbiting stars, orbit rings and cross-system link lines. Animated 3D (Three.js, vendored locally so it works offline) with a dependency-free 2D solar-system map as fallback
- Accounting System section launching the GPL, EIC, and MPL company systems from private repos via GitHub access — the signed-in owner and team open each system directly, no access code — plus a one-way **Auditor Access Portal** link and an owner-only console for the auditors' portal codes
- Owner **system-file upload**: publish the latest local GPL/EIC/MPL HTML straight to its private GitHub repo from the Accounting page (owner-only, GitHub-verified write access, conflict + shrink guards), so the website always serves the newest local version
- Games library with an isolated, playable Three.js arcade racer
- Responsive overview with active projects, recent items, and quick capture
- Search across the vault (`/` shortcut), filter projects, skills and reports, and sort records
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
  "reports":  [{ "id", "name", "company", "period", "status", "url", "tags", "notes", "created" }],
  "meta":     { "created", "owner", "version", "voiceNotes" }
}
```

## Project layout

- `index.html`, `app.js`, `manifest.json` — the PWA frontend (GitHub Pages)
- `styles.css` — responsive workspace styling and reduced-motion support
- `test/app.test.cjs` — frontend data and synchronization checks (`node --test test/app.test.cjs`)
- `worker/` — Cloudflare Worker that proxies GitHub OAuth, vault storage, and authenticated private accounting-system file access (`npm test` runs the vitest suite)

## Report

The **Report** view is a first-class workspace section at the same level as Skills, Projects, Documents and Chats. It is a register for the reports you produce — monthly, quarterly and one-off — so every deliverable has a home. Each report records a **name**, **company/entity** (GPL, EIC, MPL, MTC, ALUM, GPR, Personal, Other), **period** (e.g. `2026-11`), **status** (Draft, In review, Final, Archived), an optional **link**, **tags** and **notes**. Reports support the same add/edit/delete dialogs, full-text search, company filter and name/recent sort as the other collections, show a live count in the sidebar and a card on the Dashboard, appear in global search and "Recently added", sync with the vault, and form their own gold solar system in the galaxy constellation.

### Processing status · 處理狀態 (2026-11-13, office Qwen — Report section)

- Shipped (local commit; push gated on Anthony): added the **Report** collection end-to-end — `COLLECTIONS.reports`, `DEFAULT_VAULT.reports`, `normalizeVault`/`validateVaultJson`, sidebar nav + count, Dashboard overview card, collection search/company-filter/sort, global search, "Recently added", and a gold **Report 報告** solar system in both the 2D map and 3D galaxy (`SECTION_ORDER`/`SECTION_META`, `CONSTELLATION_COLLECTIONS`, `buildConstellationModel`). Cache busters bumped (`app.js`/`styles.css` → `report-1`, constellation modules → `v=6`).
- **Bug fix included:** `renderSearch()` called `.join("")` inside the `.map()` callback (`openRecordButton(...).join`), which threw `TypeError` whenever a global search returned any match. Moved `.join("")` outside the callback so search results render. This was a pre-existing defect exposed by the Report search test.
- **Worker unchanged** — `handleSave` stores the vault verbatim, so `reports` syncs without any Worker change or deploy.
- Verified on the office PC: `node --check app.js` clean; frontend Node suites **72/72** (incl. 2 new Report tests + 8-section constellation tests); Worker vitest **75/75**; headless Chromium (loopback, signed-out) **28/28** — nav/count, create/edit/delete, company filter, search, sort, Dashboard card, global search, Report solar-system chip, mobile 390×844, zero page errors. Screenshots inspected (mobile register + 3D galaxy): `.qwen\tmp\shots\myvault-report-*.png`.

## Games

The **Games** view is a first-class workspace section alongside Projects, Skills, Documents, and Chats. Its built-in **Neon Apex** arcade racer runs in an isolated page, so game controls and saved lap times do not modify or sync with the personal vault. The player drives an original classic coupe with sloped windows, two-tone trim, animated wheels, brake lights, and tire smoke during drifts. A race rolls from the back of a four-car grid after a 3-2-1 start. Mira, Kai, and Sol each hold a pace, slow for the tightest bends, and defend their line when you close up. Tuck in behind a car to draft — a higher speed cap, faster boost refill, and a DRAFT marker — then pull out to pass. Contact or leaving the tarmac gives the place back. Use the arrow keys to steer and accelerate or brake, hold Shift for boost, hold Space while steering above 95 km/h to drift, and press Escape or P to pause. On touch devices, hold brake while steering above 95 km/h to drift. Touch steering, gas, brake, and nitro appear when the device can touch, and the Auto / Touch / Keyboard control can force them on. Fullscreen expands the whole game, with a viewport-filling fallback where the Fullscreen API is unavailable. A track map shows every car during the race, and the finish screen lists the order with gaps. The synthesized engine has a Sound / Muted toggle saved in this browser. Pick one of three maps before a race: Night Circuit (the original oval), Harbour Lights (long waterfront straights and tight hairpins), or Dusk Ridge (uneven canyon sweepers). Each map keeps its own best lap, stored in the current browser only.

The game source is `games/neon-apex.html`, with the grid, rival pace, draft, and results in `games/neon-apex-race.mjs`. It is served as a separate iframe page from the Games library. It is also a standalone, installable web app with its own manifest and icon. On iPad, open the standalone game URL in Safari, tap Share → Add to Home Screen, enable Open as Web App, and tap Add. The game files and a pinned local Three.js module are cached by `games/sw.js` for offline use after the first online launch. When changing the game assets, update the cache name in `games/sw.js` so installed copies receive a fresh asset set. Three.js retains its MIT license in `games/vendor/THREE-LICENSE.txt`.

The Games view also hosts **春秋戰國 Warring States**, an original turn-based grand-strategy game (`games/warring-states.html` + `games/ws-*.mjs`). Five historical scenarios (506–238 BC) on a schematic 40-city strategic map: govern cities (agriculture/commerce/defense/order/training/recruit/relief), command ~150 officers with five attributes plus loyalty/ambition/traits, recruit six troop types (infantry/cavalry/crossbow/chariot/navy/elite) whose attack/defense/terrain stats weight battle damage, move and supply armies, fight calculated turn-based battles (tactics, terrain, morale, wall, weather, duels), conduct diplomacy (alliance/trade/coalition/surrender…), run intelligence stratagems, and face score-based AI rivals. Recruitment is capped at 20% of city population (a recruitment limit, not a garrison limit). Historical events are provenance-tagged 史實 / 演義 (《東周列國志》) / 待考; officer stats are game-design estimates and the map is schematic. Progress saves to browser localStorage (3 slots + autosave, JSON export/import). Full design, sources and testing notes: `games/WARRING-STATES.md`. Logic is unit-tested (`test/ws-*.test.mjs`) and browser-verified headlessly.

## Live app

https://anthonymankaho.github.io/myvault-os

## Accounting System

The **Accounting System** view is a first-class workspace section alongside Documents and Chats. It is organized into three owner-separated branches: **MEYER** (GPL, EIC and MPL group companies), **SAL** (independent owner), and **MINGS** (MINGS’ EDUCATION COMPANY LIMITED / 明詩教育有限公司, system code MEL; independent owner). MEYER systems open using GitHub repository permissions. SAL and MINGS open in separate tabs through their own code-gated shells and private repositories; their visitors do not enter the MyVault workspace. The owner-only access-code console manages the standalone codes.

Each public `systems/<Company>_System.html` URL is a **shell**, not the application source. The MEYER shells use the signed-in MyVault GitHub session and the Cloudflare Worker (`accounting-system`, system key `gpl` / `eic` / `mpl`) to read their private repositories. SAL and MINGS each have a standalone shell with no MyVault navigation or GitHub sign-in; the Worker verifies that company’s separate access code before streaming its private system. No company records are stored in these public shell files.

| System | Private source | Shell access |
| --- | --- | --- |
| GPL | `anthonymankaho/GPL` → `GPL-System/GPL_System.html` | GitHub session (auditors: portal code) |
| EIC | `anthonymankaho/EIC` → `EIC-System/EIC_System.html` | GitHub session (auditors: portal code) |
| MPL | `anthonymankaho/MPL` → `MPL_System.html` | GitHub session (auditors: portal code) |
| SAL | `anthonymankaho/SAL` → `SAL-System/SAL_System.html` | Access code only (independent users) |
| MINGS / MEL | `anthonymankaho/MEL` → `MEL_System.html` | Access code only (independent users) |

MEYER access requires GitHub authorization to read each private file. SAL and MINGS access requires a valid standalone code and a configured server-side read token. The Worker returns HTML with caching disabled; private system source and company records are not stored in this public repository. When a shell is embedded in the Accounting view it hides its standalone back link — the workspace provides **Back to Accounting**, **Full screen**, and Escape-to-exit.

### Auditor and standalone access codes

Auditor codes are entered at the Auditor Access Portal for GPL, EIC and MPL. SAL and MINGS users enter their own independent company code in each standalone system shell. The Worker stores codes in the `QWEN_USAGE` KV namespace under `auditor-code:<system>`; optional legacy environment fallbacks include `GPL_STANDALONE_CODE`, `EIC_STANDALONE_CODE`, `MPL_STANDALONE_CODE`, `SAL_STANDALONE_CODE`, and `MEL_STANDALONE_CODE`. For a valid standalone code it reads the matching private repo using the **server-side read-only token** (`GH_REPO_READ_TOKEN`), never a visitor token. A standalone system stays disabled until its code and read token are configured (fail-closed, 503).

**The owner sets the codes in the app, not on the command line:** sign in with GitHub, open **Accounting System** → **Auditor Access**, and use the **Owner Console / 管理員** panel (visible only to the signed-in owner) to type a new code per company and press **Save code**. Press **Show code / 顯示** to retrieve the current code (with a **Copy** button) — e.g. to hand it to the auditor; **Hide** clears it from view, and saving a new code hides any stale revealed value. The Worker actions `set-standalone-code`, `standalone-code-status` and `reveal-standalone-code` verify the caller's GitHub identity against `QWEN_ALLOWED_GITHUB_USER` server-side; the status response reports only configured/not-set, and reveal returns the code only to the verified owner. `GH_REPO_READ_TOKEN` is still set with `wrangler secret put GH_REPO_READ_TOKEN` from `worker/`; it should be a fine-grained GitHub PAT with **Contents: read** on the private repos only.

### Auditor Access Portal (MEYER companies only)

The Accounting view's **Auditor Access** section carries a banner link to the independent **Auditor Access Portal** at <https://anthonymankaho.github.io/auditor-portal/> (repo `anthonymankaho/auditor-portal`). The link is one-way: the portal shows only the three companies and never links back to MyVault or exposes any vault content. The portal handles auditor access to the MEYER companies only. The standalone SAL and MINGS shells use their separate codes. Auditors enter the per-company code at the portal; it then opens each system in a full-screen viewer and provisions a dedicated read-only `auditor` session through the system's own account machinery (MPL in review mode, external FINSYS tile hidden), so no second username/password login is needed. An existing session in the same browser (e.g. the owner's master account) is never replaced.

### Processing status · MINGS branch and MEL website (2026-11-16)

- Added the separate **MINGS** branch to Accounting System and the **MEL Accounting System** vault record with `level: MINGS` and tags `Accounting System`, `MINGS`, `MEL`.
- Private application source: `anthonymankaho/MEL`. Public standalone entry shell: `systems/MINGS_System.html`. The shell asks the Worker for `system: "mings"`; the Worker streams `MEL_System.html` only after the separate MINGS code is configured and verified.
- The MEL source repository contains application files and setup notes only. Source statements, receipts, student/payroll data, credentials, and opening balances are excluded. Accounting module data remains in each user browser's localStorage until exported and stored privately.
- Initial in-system login: `MEL / MEL`; change it during first setup. It is a workflow gate and does not replace the standalone access code.
- Entity name follows the 2026 shareholder resolution: MINGS’ EDUCATION COMPANY LIMITED / 明詩教育有限公司. Confirm against the current Companies Registry record before statutory use.

### Processing status · 處理狀態 (2026-11-15, SAL branch + standalone website)

- **Two branches** in the Accounting view: MEYER (GPL · EIC · MPL, unchanged behaviour) and SAL (Strategic Alliance Limited 卓域聯盟有限公司 — independent owner). `ACCOUNTING_COMPANIES` gained a `branch` field + `ACCOUNTING_BRANCHES`; the SAL card is external and opens `systems/SAL_System.html` in a **new tab**.
- **`systems/SAL_System.html`**: standalone teal shell — access-code gate (bilingual), loading panel, sign-out & lock; **zero links back to MyVault** (verified live: 0 anchors). Streams `SAL-System/SAL_System.html` from the private `anthonymankaho/SAL` repo via the Worker `accounting-system` action with `payload.system = "sal"` + `payload.code`. No company data sits in this public repo.
- **Worker**: `sal` added to `ACCOUNTING_SYSTEMS` (`SAL_STANDALONE_CODE` env fallback, KV `auditor-code:sal`). Deployed version `5abf9b3c`; live-probed: no code → 401, wrong code → 503 "not configured" (fail-closed until the owner sets a code).
- **Owner console**: SAL row added automatically (iterates `ACCOUNTING_COMPANIES`); heading now "Access codes 存取碼" covering auditor portal codes (MEYER) and the standalone SAL code.
- **OWNER ACTION 待業主**: sign in → Accounting → OWNER CONSOLE → **SAL row → Save code**, then share the code with SAL users. Until then the standalone site shows "Access is not configured yet 尚未設定存取碼".
- Verified live (headless Chrome against github.io): two branches render (MEYER: GPL·EIC·MPL; SAL: SAL), SAL card `target=_blank`, shell gate visible, no MyVault links. SAL system itself: 34/34 template tests + smoke + real-data + docs checks PASS (see `anthonymankaho/SAL` STATUS.md).

### System file upload (owner)

The Accounting view's **Owner · System files 管理員・系統檔案** panel lets the signed-in owner publish the latest local HTML file for each company straight to its private GitHub repository — `anthonymankaho/GPL` (`GPL-System/GPL_System.html`), `anthonymankaho/EIC` (`EIC-System/EIC_System.html`), `anthonymankaho/MPL` (`MPL_System.html`). Because the website streams the GitHub `main` version, an upload updates what the owner, team and auditor see immediately. Each row shows the current GitHub size and last-commit date; the owner chooses a local `.html` file, sees the size delta, confirms, and the file is base64-encoded in the browser and PUT to the GitHub Contents API with the owner's existing OAuth token (scope `repo`). GitHub enforces write access server-side. Guards: non-HTML / empty / >100 MB files are rejected; a file much smaller than the current GitHub version triggers an explicit "much smaller" warning (to avoid publishing an empty shell over the full system); a concurrent change returns a conflict message asking to refresh. Every upload is a git commit, reversible in GitHub history. **Frontend-only — no Worker change or deploy.**

### Processing status · 處理狀態 (2026-11-13, office Qwen — system upload)

- Shipped (local commit; push gated on Anthony): added the owner **System file upload** panel to the Accounting view — per-company GitHub status (size + last commit via the Git Trees/Commits API), local `.html` picker, size-delta + shrink warning, confirm dialog, browser-side base64 + GitHub Contents API PUT (owner OAuth token, `repo` scope), conflict/permission/expiry error handling, success with commit short-SHA. New helpers `formatBytes`, `fileToBase64`, `ghRequest`; `ACCOUNTING_COMPANIES` gained `repo`/`repoPath`. Cache busters bumped (`app.js`/`styles.css` → `upload-1`).
- **Worker unchanged / no deploy** — the upload talks to `api.github.com` directly from the browser using the owner's token; GitHub enforces write access.
- Verified on the office PC: `node --check app.js` clean; frontend Node suites **72/72**; headless Chromium (loopback, GitHub API + Worker stubbed, fake token) **21/21** — owner-only panel, remote status, pick → PUT (correct repo/path/sha/branch/content/message), success + refresh, shrink warning, 409 conflict, guest sees no panel, mobile 390×844 upload, zero page errors. Screenshots inspected: `.qwen\tmp\shots\myvault-upload-*.png`.
- Context: answers Anthony's "upload the latest local version of the 3 company systems" request, and follows the data-integrity check confirming GPL/EIC/MPL are byte-identical across LOCAL = GITHUB = WEBSITE (MPL is smaller by design — compact HTML sub-apps with JSON seeds, no large XLSX workbook; `tools/build_payloads.js --check` passes).

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

## MOMO assistant

Use **Ask MOMO** in the utility bar after signing in with GitHub. MOMO is the Monthly Task assistant. She calls Grok (`grok-4.7` on `https://api.x.ai/v1`) through the Worker. The browser never receives `XAI_API_KEY`. She sees Monthly Tasks only: description, company, planning month, scheduled date, status, result notes, and completion time. Chats, documents, projects, and skills are not sent.

She can list tasks due today and tasks that are overtime, and she can propose creates and updates. A completion must include `completedAt` at the Hong Kong time you name, such as yesterday 09:16. She cannot delete tasks or change the monthly-recurring flag. Proposals stay unapplied until you tick the confirmation and press **Apply selected**. GitHub still updates only when you press **Save changes**, using the GitHub sign-in already in this page. **Discard** changes nothing. **Undo last MOMO apply** is available until a newer vault edit.

Set the Worker secret and deploy before the live site can answer:

```
cd worker
npx wrangler secret put XAI_API_KEY
npx wrangler deploy
```

The monthly cap is **1,000,000 tokens** (`XAI_MONTHLY_TOKEN_QUOTA`), stored in the existing `QWEN_USAGE` KV under `momo-usage:{login}:{YYYY-MM}`, separate from the Qwen counter.

## Grok bot MCP

The phone and iPad Grok bot reaches MyVault through a separate MCP endpoint:

`https://myvault-api.anthonym-354.workers.dev/mcp`

The connector uses a bearer token stored as the Worker secret `MYVAULT_MCP_TOKEN`. The token is not in this repository. Tools are `list_monthly_tasks`, `complete_monthly_task`, and `reopen_monthly_task`. A completion requires `completed_at` at the Hong Kong time you stated. The Worker writes `vault.json` with `MYVAULT_DATA_TOKEN` and does not return chat notes.

The Grok bot form asks for OAuth. Use client ID `momo-grok-bot`, leave the client secret empty, and keep token authentication on **none (PKCE)**. Authorization endpoint: `https://myvault-api.anthonym-354.workers.dev/oauth/authorize`. Token endpoint: `https://myvault-api.anthonym-354.workers.dev/oauth/token`. Scope: `tasks`. The browser page then asks for the connector password in `worker/.mcp-connector.txt`. Do not paste that password into the token endpoint.

### Processing status · 處理狀態 (2026-11-18)

- Ask MOMO on the website is deployed. It still needs the Worker secret `XAI_API_KEY` before it can call Grok. The phone connector does not use that key.
- The phone connector uses OAuth on the Worker. The connector password stays in `worker/.mcp-connector.txt` and is not committed.

## AI Group

Open **AI Group** in the sidebar, then press **New tab**. The group chat opens on its own page, the same way an accounting system opens with **New tab**. Tick the members, type at the bottom, and press **Send**. **Attach** adds up to 8 files. Text is sent with the message. PNG, JPEG, GIF, and WebP are sent as pictures, together under about 1 MB. Other files, such as PDF or Excel, are sent by name and size only. Your message sits on the right. Grok, Qwen, DeepSeek, and NVIDIA reply in that same thread. Each member receives the earlier messages. After the first replies to a new message, the members who answered read one another's replies and answer again. A member that fails leaves a note there, and the others still reply. Files and answers stay in the tab. Nothing is written to the vault. Sign in on MyVault OS first. The new tab uses that same GitHub session.

The page does not accept or store API keys. Set them on the Worker, from `worker/`, without pasting them into chat:

```
npx wrangler secret put XAI_API_KEY
npx wrangler secret put DASHSCOPE_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put NVIDIA_API_KEY
```

Model menus are fixed: `grok-4.7`, `qwen3.8-flash`, `qwen3.8-max`, `deepseek-flash`, `deepseek-v4-pro`, `nvidia/nemotron-3.5-lightning-30b-a3b`, and `nvidia/nemotron-3-ultra-550b-a55b`. The monthly cap is 1,000,000 tokens in `QWEN_USAGE` under `ai-group-usage:{login}:{YYYY-MM}`, separate from Ask Qwen and Ask MOMO.

## Monthly Task

The **Monthly Task / 工作任務** view keeps recurring work in a separate task collection. It supports Today, Overdue, Upcoming, Monthly, and Completed views; company/status/keyword filters; date-only Hong Kong scheduling; an in-app daily reminder; completion and reopen actions; a completion time in Hong Kong that can be an earlier morning; CSV export; JSON backup/restore; and a rollover preview for incomplete work. Use **Import Excel** to preview and confirm the `NOV2026` sheet from the monthly workbook. Rows 2–47 are mapped as tasks, while planning notes outside the task range are excluded. Exact duplicate imports are skipped, ambiguous status text is retained in Doc/Result, and imported source metadata stays local to the vault.

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
