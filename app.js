const API = "https://myvault-api.anthonym-354.workers.dev";
const CLIENT_ID = "Ov23liJh92zfUJkRnUX7";
const TOKEN_KEY = "myvault_token";
const STATE_KEY = "myvault_oauth_state";
const CACHE_KEY = "myvault_cache";

const DEFAULT_VAULT = {
  skills: [],
  projects: [],
  docs: [],
  cards: [],
  chats: [],
  meta: {
    created: new Date().toISOString().slice(0, 10),
    owner: "anthonymankaho",
    version: 1
  }
};

const COLLECTIONS = {
  skills: {
    title: "Skills",
    singular: "skill",
    fields: [
      { key: "name", label: "Name", required: true },
      {
        key: "level",
        label: "Level",
        type: "select",
        options: ["Beginner", "Intermediate", "Advanced", "Expert"]
      },
      { key: "notes", label: "Notes", type: "textarea" }
    ]
  },
  projects: {
    title: "Projects",
    singular: "project",
    fields: [
      { key: "name", label: "Name", required: true },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["Idea", "Active", "Paused", "Done", "Archived"]
      },
      { key: "notes", label: "Notes", type: "textarea" }
    ]
  },
  docs: {
    title: "Docs",
    singular: "document",
    fields: [
      { key: "title", label: "Title", required: true },
      { key: "url", label: "Link", type: "url" },
      { key: "tags", label: "Tags (comma separated)" },
      { key: "notes", label: "Notes", type: "textarea" }
    ]
  },
  chats: {
    title: "Chats",
    singular: "chat",
    fields: [
      { key: "title", label: "Title", required: true },
      { key: "url", label: "Link", type: "url" },
      { key: "notes", label: "Notes", type: "textarea" }
    ]
  }
};

const VIEWS = {
  home: { title: "Home" },
  ...Object.fromEntries(
    Object.entries(COLLECTIONS).map(([key, config]) => [key, { title: config.title }])
  ),
  constellation: { title: "Constellation" },
  build: { title: "Build/Repair" }
};

const state = {
  vault: null,
  view: "constellation",
  dirty: false,
  savedAt: null
};

const ui = {
  queries: {},
  editing: {}
};

const statusMessage = document.querySelector("#status");
const viewTitle = document.querySelector("#view-title");
const viewContainer = document.querySelector("#view");
const saveButton = document.querySelector("#save-button");
const loginButton = document.querySelector("#login-button");

function setStatus(message, kind = "") {
  statusMessage.textContent = message;
  statusMessage.dataset.kind = kind;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function uid() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function itemTitle(item) {
  return item?.name ?? item?.title ?? "Untitled";
}

function normalizeVault(raw) {
  const vault = { ...DEFAULT_VAULT, ...(raw && typeof raw === "object" ? raw : {}) };
  for (const key of ["skills", "projects", "docs", "cards", "chats"]) {
    vault[key] = Array.isArray(vault[key])
      ? vault[key].map((item) => (item && typeof item === "object" ? item : { name: String(item) }))
      : [];
  }
  vault.meta =
    vault.meta && typeof vault.meta === "object" && !Array.isArray(vault.meta)
      ? vault.meta
      : { ...DEFAULT_VAULT.meta };
  return vault;
}

async function call(action, payload = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = { "Content-Type": "application/json" };

  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  const response = await fetch(API, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, payload })
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || `Request failed (${response.status})`);
  }

  return result;
}

function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state.vault));
  } catch {
    setStatus("Vault is too large to cache locally.", "error");
  }
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? normalizeVault(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function applyVault(vault, { fromCache = false } = {}) {
  state.vault = normalizeVault(vault);
  state.dirty = false;
  writeCache();
  updateSaveButton();
  render();
  if (fromCache) {
    setStatus("Loaded from local cache.", "success");
  } else {
    setStatus(
      state.savedAt ? `Vault loaded. Last saved ${state.savedAt.toLocaleString()}.` : "Vault loaded.",
      "success"
    );
  }
}

async function loadVault({ silent = false } = {}) {
  if (!silent) {
    setStatus("Loading vault…");
  }

  try {
    const result = await call("load");
    state.savedAt = new Date();
    applyVault(result.vault ?? result.data ?? result);
  } catch (error) {
    if (state.vault) {
      setStatus(`${error.message} — showing your local copy.`, "error");
    } else {
      setStatus(error.message, "error");
    }
  }
}

async function saveVault() {
  if (!state.vault) {
    return;
  }

  setStatus("Saving vault…");
  saveButton.disabled = true;

  try {
    const result = await call("save", { vault: state.vault });
    state.dirty = false;
    state.savedAt = new Date();
    writeCache();
    updateSaveButton();
    setStatus(
      result.created ? "Vault created in GitHub. 🎉" : `Vault saved at ${state.savedAt.toLocaleString()}.`,
      "success"
    );
  } catch (error) {
    writeCache();
    setStatus(`${error.message} — changes kept in the local cache.`, "error");
  }
}

function markDirty() {
  state.dirty = true;
  updateSaveButton();
  writeCache();
}

function updateSaveButton() {
  saveButton.disabled = !state.dirty;
  saveButton.textContent = state.dirty ? "Save changes" : "Saved";
}

function startLogin() {
  const stateParam = Array.from(crypto.getRandomValues(new Uint8Array(24)), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
  authorizationUrl.searchParams.set("client_id", CLIENT_ID);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("scope", "repo");
  authorizationUrl.searchParams.set("state", stateParam);
  localStorage.setItem(STATE_KEY, stateParam);

  const popup = window.open(authorizationUrl, "myvault-oauth", "width=600,height=720");
  if (!popup) {
    setStatus("Allow popups to sign in with GitHub.", "error");
    return;
  }
  setStatus("Complete sign-in in the GitHub popup.");
}

function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  loginButton.textContent = "Sign in with GitHub";
  setStatus("Signed out. Your local copy is still available offline.");
}

async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code || !window.opener) {
    return;
  }

  const stateParam = params.get("state");
  if (!stateParam || stateParam !== localStorage.getItem(STATE_KEY)) {
    window.opener.postMessage(
      { type: "myvault-oauth", error: "GitHub sign-in state did not match." },
      window.location.origin
    );
    window.close();
    return;
  }

  try {
    const result = await call("auth", {
      code,
      redirect_uri: `${window.location.origin}${window.location.pathname}`
    });
    const token = result.token || result.access_token;
    if (!token) {
      throw new Error("The API did not return an access token.");
    }
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(STATE_KEY);
    window.opener.postMessage({ type: "myvault-oauth", success: true }, window.location.origin);
  } catch (error) {
    window.opener.postMessage(
      { type: "myvault-oauth", error: error.message },
      window.location.origin
    );
  }

  window.close();
}

function voiceNotes() {
  const meta = state.vault?.meta;
  if (!meta || !Array.isArray(meta.voiceNotes)) {
    return [];
  }
  return meta.voiceNotes
    .map((note, rawIndex) => ({
      rawIndex,
      ...(typeof note === "string" ? { text: note } : note)
    }))
    .filter((note) => note && typeof note.text === "string");
}

function addVoiceNote(text) {
  const meta = state.vault.meta;
  meta.voiceNotes = Array.isArray(meta.voiceNotes) ? meta.voiceNotes : [];
  meta.voiceNotes.push({ id: uid(), text, at: new Date().toISOString() });
  markDirty();
  render();
  setStatus("Voice note added. Save to sync it to GitHub.", "success");
}

function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("Voice input is not supported in this browser.", "error");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    addVoiceNote(event.results[0][0].transcript);
  };
  recognition.onerror = () => setStatus("Voice input could not be completed.", "error");
  setStatus("Listening… speak now.");
  recognition.start();
}

function render() {
  if (constellationCleanup) {
    constellationCleanup();
    constellationCleanup = null;
  }

  if (!state.vault) {
    viewContainer.innerHTML = "";
    return;
  }

  switch (state.view) {
    case "home":
      renderHome();
      break;
    case "constellation":
      renderConstellation();
      break;
    case "build":
      renderBuild();
      break;
    default:
      renderCollection(state.view);
  }
}

function navigate(view) {
  state.view = view;
  document.body.classList.toggle("constellation-mode", view === "constellation");
  document.querySelectorAll(".nav-link").forEach((item) => item.removeAttribute("aria-current"));
  document
    .querySelector(`.nav-link[data-view="${view}"]`)
    ?.setAttribute("aria-current", "page");
  viewTitle.textContent = VIEWS[view]?.title ?? "Home";
  render();
}

function recentItems() {
  const entries = [];
  for (const [key, config] of Object.entries(COLLECTIONS)) {
    for (const item of state.vault[key]) {
      entries.push({ collection: key, config, item });
    }
  }
  return entries
    .sort((a, b) => String(b.item.created ?? "").localeCompare(String(a.item.created ?? "")))
    .slice(0, 6);
}

function renderHome() {
  const cards = Object.entries(COLLECTIONS)
    .map(
      ([key, config]) => `
        <button class="card" type="button" data-navigate="${key}">
          <p class="card-label">${config.title}</p>
          <p class="card-value">${state.vault[key].length}</p>
        </button>`
    )
    .join("");

  const notes = voiceNotes();
  const recent = recentItems();

  viewContainer.innerHTML = `
    <section class="card-grid" aria-label="Vault overview">${cards}</section>
    <section class="panel" aria-labelledby="recent-heading">
      <div class="panel-heading">
        <h2 id="recent-heading">Recent items</h2>
        <div class="actions"><button class="button" id="voice-button" type="button">🎙 Voice note</button></div>
      </div>
      ${
        recent.length
          ? `<div class="item-list">${recent
              .map(
                ({ collection, config, item }) => `
          <div class="item">
            <div class="item-top">
              <p class="item-name">${escapeHtml(itemTitle(item))}</p>
              <span class="badge">${config.title} · ${formatTime(item.created) || "no date"}</span>
            </div>
            ${item.notes ? `<p class="item-notes">${escapeHtml(item.notes)}</p>` : ""}
          </div>`
              )
              .join("")}</div>`
          : `<div class="empty-state">Nothing here yet — add your first skill, project, doc, or chat below.</div>`
      }
    </section>
    <section class="panel" aria-labelledby="voice-heading">
      <div class="panel-heading"><h2 id="voice-heading">Voice notes</h2></div>
      ${
        notes.length
          ? `<div class="item-list">${notes
              .map(
                (note) => `
          <div class="item voice-note">
            <div class="item-top">
              <p class="item-notes">${escapeHtml(note.text)}</p>
              <span class="item-actions">
                ${note.at ? `<time>${formatTime(note.at)}</time>` : ""}
                <button class="button-danger" type="button" data-delete-voice="${note.rawIndex}">Delete</button>
              </span>
            </div>
          </div>`
              )
              .join("")}</div>`
          : `<div class="empty-state">No voice notes yet. Tap 🎙 and speak to capture a thought.</div>`
      }
    </section>`;

  viewContainer.querySelectorAll("[data-navigate]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.navigate));
  });
  viewContainer.querySelector("#voice-button")?.addEventListener("click", startVoiceInput);
  viewContainer.querySelectorAll("[data-delete-voice]").forEach((button) => {
    button.addEventListener("click", () => {
      state.vault.meta.voiceNotes.splice(Number(button.dataset.deleteVoice), 1);
      markDirty();
      render();
    });
  });
}

function fieldHtml(field, item = {}) {
  const value = item[field.key] ?? "";
  if (field.type === "textarea") {
    return `<div class="field"><label for="field-${field.key}">${escapeHtml(field.label)}</label>
      <textarea id="field-${field.key}" name="${field.key}">${escapeHtml(value)}</textarea></div>`;
  }
  if (field.type === "select") {
    const options = ["", ...field.options];
    return `<div class="field"><label for="field-${field.key}">${escapeHtml(field.label)}</label>
      <select id="field-${field.key}" name="${field.key}">
        ${options
          .map(
            (option) =>
              `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${
                option || "—"
              }</option>`
          )
          .join("")}
      </select></div>`;
  }
  return `<div class="field"><label for="field-${field.key}">${escapeHtml(field.label)}</label>
    <input id="field-${field.key}" name="${field.key}" type="${field.type ?? "text"}" value="${escapeHtml(value)}"></div>`;
}

function itemMatches(item, query) {
  return JSON.stringify(item).toLowerCase().includes(query);
}

function renderItems(key) {
  const config = COLLECTIONS[key];
  const query = (ui.queries[key] ?? "").toLowerCase();
  const items = state.vault[key].filter((item) => !query || itemMatches(item, query));

  if (!items.length) {
    return `<div class="empty-state">${
      query ? "No matches — try a different search." : `No ${config.title.toLowerCase()} yet. Add one above.`
    }</div>`;
  }

  return `<div class="item-list">${items
    .map((item) => {
      const extra = config.fields
        .filter((field) => field.key !== "name" && field.key !== "title" && item[field.key])
        .map((field) => {
          const value = item[field.key];
          const display = Array.isArray(value) ? value.join(", ") : String(value);
          return `<span class="badge">${escapeHtml(display)}</span>`;
        })
        .join(" ");
      const name = item.url
        ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(itemTitle(item))}</a>`
        : escapeHtml(itemTitle(item));
      return `
        <div class="item">
          <div class="item-top">
            <p class="item-name">${name}</p>
            <span class="item-actions">
              ${extra ? `<span class="item-meta">${extra}</span>` : ""}
              <button class="button" type="button" data-edit="${escapeHtml(item.id ?? "")}">Edit</button>
              <button class="button-danger" type="button" data-delete="${escapeHtml(item.id ?? "")}">Delete</button>
            </span>
          </div>
          ${item.notes ? `<p class="item-notes">${escapeHtml(item.notes)}</p>` : ""}
        </div>`;
    })
    .join("")}</div>`;
}

function renderCollection(key) {
  const config = COLLECTIONS[key];
  const editingId = ui.editing[key];
  const editingItem = editingId
    ? state.vault[key].find((item) => item.id === editingId)
    : null;

  viewContainer.innerHTML = `
    <section class="panel" aria-labelledby="collection-heading">
      <div class="panel-heading">
        <h2 id="collection-heading">${editingItem ? `Edit ${config.singular}` : `Add a ${config.singular}`}</h2>
      </div>
      <form class="item-form" id="item-form">
        <div class="form-row">
          ${config.fields.map((field) => fieldHtml(field, editingItem)).join("")}
        </div>
        <div class="actions">
          <button class="button button-primary" type="submit">${editingItem ? "Update" : "Add"}</button>
          ${
            editingItem
              ? `<button class="button" type="button" id="cancel-edit">Cancel</button>`
              : ""
          }
        </div>
      </form>
      <input class="search-input" id="collection-search" type="search" placeholder="Search ${config.title.toLowerCase()}…" value="${escapeHtml(ui.queries[key] ?? "")}">
      <div id="collection-items">${renderItems(key)}</div>
    </section>`;

  const form = viewContainer.querySelector("#item-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const titleKey = config.fields[0].key;

    if (!String(data[titleKey] ?? "").trim()) {
      setStatus(`${config.fields[0].label} is required.`, "error");
      return;
    }

    for (const field of config.fields) {
      if (field.type === "select" && !data[field.key]) {
        delete data[field.key];
      }
    }
    if (key === "docs" && typeof data.tags === "string") {
      data.tags = data.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    }
    for (const field of config.fields) {
      if (typeof data[field.key] === "string") {
        data[field.key] = data[field.key].trim();
        if (!data[field.key]) {
          delete data[field.key];
        }
      }
    }

    if (editingItem) {
      Object.assign(editingItem, data);
      setStatus(`${config.singular} updated. Save to sync.`, "success");
    } else {
      state.vault[key].unshift({ id: uid(), created: new Date().toISOString(), ...data });
      setStatus(`${config.singular} added. Save to sync.`, "success");
    }

    ui.editing[key] = null;
    markDirty();
    renderCollection(key);
  });

  viewContainer.querySelector("#cancel-edit")?.addEventListener("click", () => {
    ui.editing[key] = null;
    renderCollection(key);
  });

  viewContainer.querySelector("#collection-search").addEventListener("input", (event) => {
    ui.queries[key] = event.target.value;
    viewContainer.querySelector("#collection-items").innerHTML = renderItems(key);
    bindItemButtons(key);
  });

  bindItemButtons(key);
}

function bindItemButtons(key) {
  const config = COLLECTIONS[key];
  viewContainer.querySelectorAll(`#collection-items [data-edit]`).forEach((button) => {
    button.addEventListener("click", () => {
      ui.editing[key] = button.dataset.edit;
      renderCollection(key);
      viewContainer.querySelector("#item-form")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
  viewContainer.querySelectorAll(`#collection-items [data-delete]`).forEach((button) => {
    button.addEventListener("click", () => {
      const index = state.vault[key].findIndex((item) => item.id === button.dataset.delete);
      if (index >= 0 && window.confirm(`Delete this ${config.singular}?`)) {
        state.vault[key].splice(index, 1);
        if (ui.editing[key] === button.dataset.delete) {
          ui.editing[key] = null;
        }
        markDirty();
        renderCollection(key);
        setStatus(`${config.singular} deleted. Save to sync.`, "success");
      }
    });
  });
}

function validateVaultJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`Invalid JSON: ${error.message}`] };
  }

  const errors = [];
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    errors.push("Vault must be a JSON object.");
    return { ok: false, errors, parsed };
  }
  for (const key of ["skills", "projects", "docs", "cards", "chats"]) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
      errors.push(`"${key}" should be an array.`);
    }
  }
  if (parsed.meta !== undefined && (typeof parsed.meta !== "object" || Array.isArray(parsed.meta))) {
    errors.push('"meta" should be an object.');
  }
  return { ok: errors.length === 0, errors, parsed };
}

function renderBuild() {
  viewContainer.innerHTML = `
    <section class="vault-panel" aria-labelledby="vault-heading">
      <div class="panel-heading">
        <h2 id="vault-heading">Vault data (raw JSON)</h2>
        <div class="actions">
          <button class="button" id="validate-button" type="button">Validate</button>
          <button class="button" id="repair-button" type="button">Repair</button>
          <button class="button" id="reload-button" type="button">Reload from GitHub</button>
        </div>
      </div>
      <textarea id="vault-editor" aria-label="Vault data JSON" spellcheck="false">${escapeHtml(
        JSON.stringify(state.vault, null, 2)
      )}</textarea>
      <p class="diagnostics" id="diagnostics" data-kind="ok"></p>
    </section>`;

  const editor = viewContainer.querySelector("#vault-editor");
  const diagnostics = viewContainer.querySelector("#diagnostics");

  viewContainer.querySelector("#validate-button").addEventListener("click", () => {
    const { ok, errors } = validateVaultJson(editor.value);
    diagnostics.dataset.kind = ok ? "ok" : "error";
    diagnostics.textContent = ok
      ? "JSON is valid and matches the vault shape."
      : errors.join("\n");
  });

  viewContainer.querySelector("#repair-button").addEventListener("click", () => {
    const { parsed } = validateVaultJson(editor.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      diagnostics.dataset.kind = "error";
      diagnostics.textContent = "Cannot repair: JSON must be an object. Fix it manually or reload from GitHub.";
      return;
    }
    const repaired = normalizeVault(parsed);
    state.vault = repaired;
    markDirty();
    render();
    setStatus("Vault repaired into the standard shape. Review it, then save.", "success");
  });

  viewContainer.querySelector("#reload-button").addEventListener("click", () => {
    if (state.dirty && !window.confirm("Reloading discards unsaved changes. Continue?")) {
      return;
    }
    loadVault();
  });
}

let constellationCleanup = null;

function normalizeTags(value) {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((tag) => tag.trim());
  return list.filter(Boolean).map((tag) => String(tag).toLowerCase());
}

async function renderConstellation() {
  const token = {};
  constellationCleanup = () => {
    token.cancelled = true;
  };

  viewContainer.innerHTML = `
    <section class="panel constellation-panel" aria-labelledby="constellation-heading">
      <div class="constellation-controls">
        <h2 id="constellation-heading" class="visually-hidden">Constellation Finder</h2>
        <button class="button" id="constellation-menu" type="button">☰ Views</button>
        <button class="button" id="constellation-names" type="button" aria-pressed="true">Hide names</button>
      </div>
      <div id="constellation-canvas" class="constellation-canvas" role="img"
        aria-label="Star chart of skills and projects"></div>
      <p class="diagnostics constellation-stats" id="constellation-stats" data-kind="ok">Loading 3D engine…</p>
    </section>`;

  const container = viewContainer.querySelector("#constellation-canvas");
  const stats = viewContainer.querySelector("#constellation-stats");

  let THREE;
  let OrbitControls;
  try {
    THREE = await import("three");
    ({ OrbitControls } = await import("three/addons/controls/OrbitControls.js"));
  } catch {
    stats.dataset.kind = "error";
    stats.textContent = "The 3D engine could not be loaded. Check your internet connection, then switch views and back to retry.";
    return;
  }
  if (token.cancelled) {
    return;
  }

  const KIND_COLOR = { skill: "#cfe8ff", project: "#ffe3b3" };
  const nodes = [
    ...state.vault.skills.map((item) => ({ item, kind: "skill" })),
    ...state.vault.projects.map((item) => ({ item, kind: "project" }))
  ].map((node) => ({
    ...node,
    label: itemTitle(node.item),
    tags: normalizeTags(node.item.tags)
  }));

  const labelIndex = new Map();
  nodes.forEach((node, index) => {
    const key = node.label.toLowerCase();
    if (!labelIndex.has(key)) {
      labelIndex.set(key, index);
    }
  });
  const linkTarget = (value) => {
    const name = String(value)
      .split("|")[0]
      .split("/")
      .pop()
      .split("#")[0]
      .replace(/\.md$/i, "")
      .trim()
      .toLowerCase();
    return labelIndex.get(name);
  };
  const edges = [];
  const hasEdge = new Set();
  const addEdge = (a, b) => {
    if (a === b || hasEdge.has(`${a}-${b}`)) {
      return;
    }
    hasEdge.add(`${a}-${b}`);
    edges.push([a, b]);
  };
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].tags.some((tag) => nodes[j].tags.includes(tag))) {
        addEdge(i, j);
      }
    }
  }
  nodes.forEach((node, index) => {
    for (const link of node.item.links ?? []) {
      const target = linkTarget(link);
      if (target !== undefined) {
        addEdge(index, target);
      }
    }
  });

  // Layout: golden-spiral seed, then simple repulsion + spring relaxation.
  const count = nodes.length;
  const positions = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = golden * i;
    positions[i * 3] = Math.cos(theta) * radius * 16;
    positions[i * 3 + 1] = y * 16;
    positions[i * 3 + 2] = Math.sin(theta) * radius * 16;
  }
  for (let iter = 0; iter < 220; iter++) {
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        let dx = positions[i * 3] - positions[j * 3];
        let dy = positions[i * 3 + 1] - positions[j * 3 + 1];
        let dz = positions[i * 3 + 2] - positions[j * 3 + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
        const push = 26 / (dist * dist);
        dx /= dist;
        dy /= dist;
        dz /= dist;
        positions[i * 3] += dx * push;
        positions[i * 3 + 1] += dy * push;
        positions[i * 3 + 2] += dz * push;
        positions[j * 3] -= dx * push;
        positions[j * 3 + 1] -= dy * push;
        positions[j * 3 + 2] -= dz * push;
      }
    }
    for (const [a, b] of edges) {
      for (let axis = 0; axis < 3; axis++) {
        const diff = positions[b * 3 + axis] - positions[a * 3 + axis];
        const pull = diff * 0.018;
        positions[a * 3 + axis] += pull;
        positions[b * 3 + axis] -= pull;
      }
    }
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 600);
  camera.position.set(0, 6, 56);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;

  // Star textures: soft glow for named stars, tiny dot for background sky.
  const glowTexture = (() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.3, "rgba(255,255,255,0.85)");
    gradient.addColorStop(0.6, "rgba(255,255,255,0.25)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  })();
  const dotTexture = (() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(255,255,255,0.9)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(canvas);
  })();

  // Background sky: ~350 faint anonymous stars on a larger sphere.
  {
    const skyCount = 350;
    const skyPositions = new Float32Array(skyCount * 3);
    const sky = new THREE.Spherical(30 + Math.random() * 6, 0, 0);
    for (let i = 0; i < skyCount; i++) {
      sky.phi = Math.acos(2 * Math.random() - 1);
      sky.theta = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3().setFromSpherical(sky);
      skyPositions[i * 3] = v.x;
      skyPositions[i * 3 + 1] = v.y;
      skyPositions[i * 3 + 2] = v.z;
    }
    const skyGeometry = new THREE.BufferGeometry();
    skyGeometry.setAttribute("position", new THREE.BufferAttribute(skyPositions, 3));
    scene.add(
      new THREE.Points(
        skyGeometry,
        new THREE.PointsMaterial({
          size: 0.55,
          map: dotTexture,
          color: 0x93a7c9,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      )
    );
  }

  // Named stars, bucketed into three magnitudes by tag count.
  const magnitudeOf = (node) => {
    if (node.tags.length >= 3) return 0;
    if (node.tags.length >= 1) return 1;
    return 2;
  };
  const magnitudeSize = [3.4, 2.3, 1.5];
  const pointLayers = [];
  const pointGeometries = [];
  for (let mag = 0; mag < 3; mag++) {
    const indexes = nodes
      .map((node, index) => (magnitudeOf(node) === mag ? index : -1))
      .filter((index) => index >= 0);
    if (!indexes.length) continue;
    const layerPositions = new Float32Array(indexes.length * 3);
    const layerColors = new Float32Array(indexes.length * 3);
    indexes.forEach((nodeIndex, slot) => {
      layerPositions.set(positions.slice(nodeIndex * 3, nodeIndex * 3 + 3), slot * 3);
      layerColors.set(new THREE.Color(KIND_COLOR[nodes[nodeIndex].kind]).toArray(), slot * 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(layerPositions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(layerColors, 3));
    geometry.userData.nodeIndexes = indexes;
    pointGeometries.push(geometry);
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: magnitudeSize[mag],
        map: glowTexture,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    scene.add(points);
    pointLayers.push(points);
  }

  // Constellation lines.
  const linePositions = new Float32Array(edges.length * 6);
  edges.forEach(([a, b], index) => {
    linePositions.set(positions.slice(a * 3, a * 3 + 3), index * 6);
    linePositions.set(positions.slice(b * 3, b * 3 + 3), index * 6 + 3);
  });
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
  scene.add(
    new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({
        color: 0x9db9e8,
        transparent: true,
        opacity: 0.32
      })
    )
  );

  // Celestial graticule: meridian + parallel rings, like a real star chart.
  const gridMaterial = new THREE.LineBasicMaterial({
    color: 0x4a6491,
    transparent: true,
    opacity: 0.16
  });
  const gridGeometries = [];
  {
    const ringRadius = 22;
    const makeRing = (plane) => {
      const segments = 96;
      const ring = new Float32Array(segments * 3);
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const [x, y, z] =
          plane === "xy"
            ? [Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, 0]
            : plane === "xz"
              ? [Math.cos(angle) * ringRadius, 0, Math.sin(angle) * ringRadius]
              : [0, Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius];
        ring[i * 3] = x;
        ring[i * 3 + 1] = y;
        ring[i * 3 + 2] = z;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(ring, 3));
      return geometry;
    };
    // Equator + tropics-style parallels.
    for (const plane of ["xz", "tilt1", "tilt2", "xy"]) {
      const geometry = makeRing(plane === "xy" ? "xy" : "xz");
      if (plane === "tilt1") geometry.rotateX(Math.PI / 3);
      if (plane === "tilt2") geometry.rotateX(-Math.PI / 3);
      if (plane === "xy") geometry.rotateY(Math.PI / 2.6);
      gridGeometries.push(geometry);
      scene.add(new THREE.LineLoop(geometry, gridMaterial));
    }
    // Meridians.
    for (let m = 0; m < 4; m++) {
      const geometry = makeRing("xy");
      geometry.rotateY((m / 4) * Math.PI);
      gridGeometries.push(geometry);
      scene.add(new THREE.LineLoop(geometry, gridMaterial));
    }
  }

  // Name labels beside stars, toggleable like a planetarium.
  const labelSprites = nodes.map((node, nodeIndex) => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 72;
    const ctx = canvas.getContext("2d");
    ctx.font = "400 30px Georgia, 'Times New Roman', serif";
    ctx.textAlign = "left";
    ctx.fillStyle = node.kind === "skill" ? "#9fc6ee" : "#e8c795";
    ctx.shadowColor = "rgba(2,6,18,0.95)";
    ctx.shadowBlur = 8;
    ctx.fillText(node.label.slice(0, 30), 8, 46);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        opacity: 0.92,
        depthTest: false
      })
    );
    sprite.scale.set(9.5, 1.35, 1);
    sprite.position.set(
      positions[nodeIndex * 3] + 1.6,
      positions[nodeIndex * 3 + 1] + 1.1,
      positions[nodeIndex * 3 + 2]
    );
    scene.add(sprite);
    return sprite;
  });
  let namesVisible = true;
  viewContainer.querySelector("#constellation-names").addEventListener("click", (event) => {
    namesVisible = !namesVisible;
    labelSprites.forEach((sprite) => {
      sprite.visible = namesVisible;
    });
    event.currentTarget.textContent = namesVisible ? "Hide names" : "Show names";
    event.currentTarget.setAttribute("aria-pressed", String(namesVisible));
  });

  const panel = viewContainer.querySelector(".constellation-panel");
  viewContainer.querySelector("#constellation-menu").addEventListener("click", () => {
    document.body.classList.toggle("constellation-mode");
    resize();
  });

  function resize() {
    const full = document.body.classList.contains("constellation-mode");
    const width = full ? window.innerWidth : container.clientWidth || 600;
    const height = full
      ? window.innerHeight
      : Math.max(340, Math.min(600, window.innerHeight * 0.6));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 1.5 };
  const pointer = new THREE.Vector2(-10, -10);
  renderer.domElement.addEventListener("pointermove", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  });

  stats.dataset.kind = "ok";
  stats.textContent =
    `${nodes.filter((n) => n.kind === "skill").length} skills · ` +
    `${nodes.filter((n) => n.kind === "project").length} projects · ` +
    `${edges.length} constellation lines — drag to orbit, scroll to zoom, hover a star.`;

  let frame = 0;
  function animate() {
    if (token.cancelled) {
      return;
    }
    frame = requestAnimationFrame(animate);
    controls.update();
    raycaster.setFromCamera(pointer, camera);
    for (const layer of pointLayers) {
      const hit = raycaster.intersectObject(layer)[0];
      if (hit) {
        const nodeIndex = layer.geometry.userData.nodeIndexes[hit.index];
        const node = nodes[nodeIndex];
        const shared = edges.filter(([a, b]) => a === nodeIndex || b === nodeIndex).length;
        stats.textContent = `✦ ${node.label} (${node.kind}) — ${node.tags.length} tags · ${shared} lines`;
        break;
      }
    }
    renderer.render(scene, camera);
  }
  animate();

  constellationCleanup = () => {
    token.cancelled = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    controls.dispose();
    pointGeometries.forEach((geometry) => geometry.dispose());
    lineGeometry.dispose();
    gridGeometries.forEach((geometry) => geometry.dispose());
    gridMaterial.dispose();
    labelSprites.forEach((sprite) => {
      sprite.material.map.dispose();
      sprite.material.dispose();
    });
    renderer.dispose();
    renderer.domElement.remove();
  };
}

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => navigate(link.dataset.view));
});

saveButton.addEventListener("click", saveVault);
loginButton.addEventListener("click", () => {
  if (localStorage.getItem(TOKEN_KEY)) {
    signOut();
  } else {
    startLogin();
  }
});

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.data?.type !== "myvault-oauth") {
    return;
  }
  if (event.data.error) {
    setStatus(event.data.error, "error");
    return;
  }
  loginButton.textContent = "Sign out";
  setStatus("Signed in with GitHub.", "success");
  loadVault();
});

handleOAuthCallback();

document.body.classList.toggle("constellation-mode", state.view === "constellation");
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("constellation-mode")) {
    document.querySelector("#constellation-menu")?.click();
  }
});

if (localStorage.getItem(TOKEN_KEY)) {
  loginButton.textContent = "Sign out";
}

const cached = readCache();
if (cached) {
  state.vault = cached;
  render();
  if (localStorage.getItem(TOKEN_KEY)) {
    setStatus("Loaded from local cache. Refreshing from GitHub…");
    loadVault({ silent: true });
  } else {
    setStatus("Loaded from local cache. Sign in to sync with GitHub.");
  }
} else if (localStorage.getItem(TOKEN_KEY)) {
  loadVault();
} else {
  state.vault = structuredClone(DEFAULT_VAULT);
  render();
  setStatus("New local vault started. Sign in with GitHub to sync it to your myvault-data repo.");
}
