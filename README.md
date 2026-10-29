# ⬡ MyVault OS — Personal OS

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://anthonymankaho.github.io/myvault-os)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

MyVault OS is a multi-platform AI personal operating system, with a lightweight web dashboard and a GitHub-backed personal vault.

## Features

- Personal dashboard for skills, projects, documents, and chats
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
- `worker/` — Cloudflare Worker that proxies GitHub OAuth and the Contents API (`npm test` runs the vitest suite)

## Live app

https://anthonymankaho.github.io/myvault-os

## Screenshot

_Screenshot coming soon._

## Frontend validation

Run `node --check app.js` and `node --test test/app.test.cjs` with Node.js 18 or newer. Serve the repository with any static HTTP server to preview it. GitHub OAuth still uses the configured production callback and Worker; a local preview does not establish a production sign-in session.

The app opens on the overview by default. The constellation remains available in navigation, with persistent access to other views and a rotation toggle. Build / Repair includes an explicit **Apply changes** action for raw JSON edits before syncing.

Built with Kimi + Qwen AI.

## Qwen assistant

Use **Ask Qwen** in the utility bar after signing in with GitHub. The assistant receives a compact snapshot of the current local vault, including unsaved changes. It can answer questions or propose creates and updates for projects, skills, documents, and chats. Each proposal shows its fields or old/new differences. Choose operations, check the confirmation box, and press **Apply selected**. **Discard** changes nothing. **Undo last AI apply** is available while no newer vault edits have been made. Applying updates the local cache once; GitHub synchronization still requires the existing **Save changes** button.

Conversation history is held in memory only and disappears on page reload. Context excludes vault metadata, cards, imported source paths, and unknown fields; note context is capped at 1,200 characters per item. Replies and operations are validated on the server and again before Apply. Updates use IDs and preserve creation times and fields outside the proposal. The assistant cannot delete records.

### Worker configuration

The checked-in `worker/wrangler.jsonc` uses the Token Plan endpoint and model requested for this installation:

| Setting | Value / purpose |
| --- | --- |
| `QWEN_BASE_URL` | `https://token-plan.maas.qwencloudapi.com/compatible-mode/v1` |
| `QWEN_MODEL` | `qwen3.8-flash`; the code falls back to `qwen-plus` when unset |
| `QWEN_ALLOWED_GITHUB_USER` | `anthonymankaho`; Qwen requests verify this identity with GitHub |
| `DASHSCOPE_API_KEY` | Worker **secret**, configured using `wrangler secret put DASHSCOPE_API_KEY` from the `worker` directory; never put its value in source, `.env`, logs, or frontend assets |

The original Singapore workspace endpoint format, `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`, is also supported. Only the configured approved hosts are accepted. Credentials and endpoints must belong to the same provider plan. The existing `GITHUB_CLIENT_SECRET` remains required for GitHub sign-in; GitHub tokens are used only for GitHub and are never sent to Qwen.

Requests use the OpenAI-compatible `/chat/completions` endpoint with JSON responses. Limits: 4,000-character messages, 12 history turns / 12,000 history characters, 200 context items per collection, 120 KB AI request, 12 operations, 8,000-character proposed notes, 128 KiB upstream responses, and a 25-second provider timeout. The frontend sends at most six previous turns and also times out requests. Provider quota, authentication, configuration, malformed-response, and timeout failures return safe messages without upstream bodies or credentials.

After changing Worker bindings, run `npx wrangler types --include-runtime=false`. Deploy from `worker` using `npm run deploy`. The frontend remains buildless.

### Qwen validation

Run `node --test test/*.test.*` in the root and `npm test -- --run` in `worker`. Tests cover all four create types, ID-based updates, invalid operations, stale previews, selection/confirmation, Discard, Undo, local cache persistence, unchanged manual GitHub saving, authentication, bounded inputs, quota handling, timeout, and credential isolation. The dock is a native keyboard-accessible dialog; at phone widths it fills the screen. Escape closes it and restores focus to **Ask Qwen**.
