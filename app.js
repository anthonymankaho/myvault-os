const API = "https://myvault-api.anthonymankaho.workers.dev";
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
  build: { title: "Build/Repair" }
};

const state = {
  vault: null,
  view: "home",
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
  if (!state.vault) {
    viewContainer.innerHTML = "";
    return;
  }

  switch (state.view) {
    case "home":
      renderHome();
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
