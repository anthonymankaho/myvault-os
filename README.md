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
