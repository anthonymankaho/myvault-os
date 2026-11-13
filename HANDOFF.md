# Handoff → Office Qwen (myoffice)

**From:** Qwen on `Anthony-Surface-book` · **Date:** 2026-11-14 · **Repo HEAD:** `1e40802`
**Purpose:** consolidated context for the office-PC Qwen session to continue this work without re-deriving it. Read this together with the dated `Processing status · 處理狀態` entries in `README.md`.

> **2026-11-13 update (office Qwen):** the standalone access-code gate was **removed from the MyVault shells** — they are GitHub-only and the signed-in owner opens each system directly. Auditor codes are now **portal-only**; §1.D below is superseded. See README → Processing status (2026-11-13, office Qwen — owner direct access).

---

## 1. What was built (all live & verified)

### A. Auditor Access Portal — independent entry for the external auditor
- **Live:** https://anthonymankaho.github.io/auditor-portal/ · **Repo:** `anthonymankaho/auditor-portal` (public, single-file `index.html`, source also at `Desktop\auditor-portal`).
- Shows **only** Gold Plume Limited (GPL), Essential Investment Consultants Limited (EIC), Meyer Properties Limited (MPL). **Zero MyVault content, zero links back** — the link from MyVault `#accounting` to the portal is **one-way**.
- Per-company access code → Worker verifies → streams the private system HTML → portal injects a head script that **pre-seeds a read-only `auditor` session** (`<co>_hub_accounts` + `<co>_hub_current_session`) BEFORE the system's own scripts run (their helpers are closed-scope, not on `window`). MPL opens in **review** mode, FINSYS/paymentReq tile hidden. **The owner's existing master session is never replaced.**
- `"auditor"` is the auto-created **account name, NOT a code**. Off-origin (e.g. `file://` preview) shows a design-preview banner and blocks unlock.
- Codes live in `sessionStorage` only (per tab). Wrong code: 5 attempts → 30s client pause; server is authoritative.

### B. Worker `myvault-api` (Cloudflare, account `anthonym-354`)
- **Endpoint:** https://myvault-api.anthonym-354.workers.dev · **Source:** `worker/src/index.js` (+ `qwen.js`).
- `accounting-system` — origin-locked to `https://anthonymankaho.github.io`; accepts a GitHub Bearer **or** a standalone `code`. Code checked constant-time against **KV first** (`QWEN_USAGE`, key `auditor-code:<system>`, JSON `{code,updatedAt}`), env secret fallback. On match, reads the private repo with server-side `GH_REPO_READ_TOKEN`. Fail-closed 503 when no code/token.
- `set-standalone-code` / `standalone-code-status` / `reveal-standalone-code` — **owner-only**, GitHub identity verified server-side against `QWEN_ALLOWED_GITHUB_USER` (`anthonymankaho`). Status returns configured/source/updatedAt only; **reveal returns the code to the verified owner only** (401 no auth, 403 non-owner, 404 unset).
- Private repo paths: `GPL-System/GPL_System.html`, `EIC-System/EIC_System.html`, `MPL_System.html` (repos `GPL`, `EIC`, `MPL`, branch `main`).

### C. Owner Console (MyVault OS → Accounting System)
- **Live:** https://anthonymankaho.github.io/myvault-os/#accounting → **OWNER CONSOLE · 管理員** (visible only after GitHub sign-in).
- Per company: type 4–128 chars → **Save code 儲存** (immediate). **Show code 顯示** reveals the current code + **Copy 複製**; **Hide** clears; saving a new code hides any stale revealed value.
- This is where Anthony **sets, replaces, and retrieves** the standalone codes. No local code generation anymore.

### D. Standalone shells (`systems/GPL_System.html`, `EIC_…`, `MPL_…`)
- Each "Unlock" screen now carries a **bilingual hint** linking to `../index.html#accounting` (Owner Console). The code entered here is the **same** code as the portal/Owner Console.

### E. Galaxy constellation (MyVault OS → Constellation)
- **Every item is a star; every section is a solar system.** 7 systems: projects (amber), skills (teal), docs (violet), chats (blue), tasks (rose), accounting (acid-green, 3 company stars), games (magenta, Neon Apex).
- Suns = shader spheres + corona sprites + orbit rings; stars orbit per-star speed/phase; link lines follow moving stars across systems; twinkling starfield + nebulae; bilingual sun labels.
- **Single source of truth:** `constellation-systems.mjs` (`SECTION_META`, `layoutSolarSystems` for 3D, `layoutSystemMap` for 2D — pure, unit-tested). Consumed by `constellation-3d.mjs` (Three.js) and `constellation.mjs` (SVG fallback).
- `app.js`: `CONSTELLATION_COLLECTIONS = [projects, skills, docs, chats, tasks]` + virtual accounting/games nodes; `onOpen` routes tasks→`openTaskDialog`, virtual kinds→`navigate`.
- **Three.js is vendored** at `games/vendor/three.module.js` (r160) via the import map → **3D works offline, no CDN**.
- Permanent control region: Labels / Links / Motion / Rotate toggles, Glow + Speed sliders, zoom −/%/+, Reset, per-system camera chips. Search (`/`) covers all kinds. 2D fallback mirrors grouping with per-section filters.
- To add a section/item type: extend `SECTION_ORDER` + `SECTION_META` + `buildConstellationModel` only; both renderers inherit.

---

## 2. Current state
- **All three codes are configured** (set 2026-11-12 ~16:08 UTC via the Owner Console, 7 chars each) and owner-retrievable. Portal + shells are ready; Anthony only needs to **hand the codes to the auditors**.
- Owner master session preserved (portal never replaces it); a **fresh browser** entering a code gets the read-only `auditor` account. To see the auditor view: Private/Incognito window → portal → enter code.
- Empty Draft/Posted lines in a system are per-browser state; books populate from the system's own embedded/imported data (Anthony's existing workflow) — unchanged by this work.

## 3. Pending / owner-only actions
- Anthony to distribute the codes to auditors (Owner Console → Show code → Copy).
- **Optional hardening:** `GH_REPO_READ_TOKEN` currently reuses Anthony's **gh OAuth token (broad repo scope)** as an interim measure. Replace with a **fine-grained PAT, Contents: read-only on GPL/EIC/MPL only** (`wrangler secret put GH_REPO_READ_TOKEN`). Not blocking.

## 4. Environment gotchas (this Surface Book)
- **`Desktop\myvault-os` clone is diverged (ahead 54 / behind 75).** NEVER deploy/commit from it. Always `git worktree add` from a fresh `origin/main`, commit there, push `<branch>:main`.
- **Local workerd / vitest / `wrangler dev` are blocked** on this PC (`CreateDirectory #5 access denied` for miniflare storage; not Defender CFA). Verify Worker changes by **deploying and probing the live endpoint** with `Origin: https://anthonymankaho.github.io`. Frontend tests run fine via Playwright (`GitHub-Repos\hktax-studyhub\node_modules\playwright`, `channel:"chrome"`, WebGL args `--enable-unsafe-swiftshader --use-angle=swiftshader`).
- `gh` is pre-authenticated as `anthonymankaho` (keyring, `repo` scope) — API/search/push need no login. Wrangler pre-authenticated (account `354034418f9d4e8f5eb142c16cdb8789`).

## 5. Standing conventions (do not break)
- **Bilingual replies** (English + 繁體中文) to Anthony; `AskUserQuestion` fields Traditional-Chinese-only.
- **Task completion workflow:** update README + write a dated `Processing status · 處理狀態 (for office Qwen)` entry, then commit & push.
- **Credentials:** DPAPI-encrypted, machine-bound; **never paste key/code values into chat/logs/new files**; `Desktop` is a OneDrive→GitHub leak path — keep secret-bearing files outside it. Verify codes with **masked output** (status + length only).
- **`myvault-data` public repo has exposed Qwen/NVIDIA/Kimi keys in the "API" note — Anthony said 「不用理會」 (leave it alone).** Do NOT rotate, delete, rewrite history, or re-warn unless he asks.
- **Verify in a real engine** (headless Chrome/WebKit render + independent check), not code review alone.

## 6. Verification already done (Surface Book)
- Node: app 16, constellation 5, constellation-systems 8, game 12, Qwen 29 → **70/70**.
- Real-Chrome: galaxy **37/37** (render, controls, search→task dialog, drag orbit, 3× enter/leave leak-free, blocked-3D fallback, 390px mobile, zero errors); reveal console + shells **27/27**.
- Live probes: reveal 401 without auth / 200 owner-only for gpl/eic/mpl (values never logged); all three codes unlock the real systems; Pages serves the latest `app.js`, shells, and `constellation-systems.mjs`.

## 7. Key URLs (verified live)
- MyVault OS: https://anthonymankaho.github.io/myvault-os/
- Accounting / Owner Console: https://anthonymankaho.github.io/myvault-os/#accounting
- Auditor portal: https://anthonymankaho.github.io/auditor-portal/
- Worker: https://myvault-api.anthonym-354.workers.dev
