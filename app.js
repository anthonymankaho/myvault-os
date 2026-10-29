const API = "https://myvault-api.anthonym-354.workers.dev";
const CLIENT_ID = "Ov23liJh92zfUJkRnUX7";
const TOKEN_KEY = "myvault_token";
const STATE_KEY = "myvault_oauth_state";
const CACHE_KEY = "myvault_cache";
const DIRTY_KEY = "myvault_pending_changes";

const DEFAULT_VAULT = {
  skills: [],
  projects: [],
  docs: [],
  cards: [],
  chats: [],
  meta: {
    created: new Date().toISOString().slice(0, 10),
    owner: "anthonymankaho",
    version: 1,
  },
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
        options: ["Beginner", "Intermediate", "Advanced", "Expert"],
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
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
        options: ["Idea", "Active", "Paused", "Done", "Archived"],
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
  },
  docs: {
    title: "Documents",
    singular: "document",
    fields: [
      { key: "title", label: "Title", required: true },
      { key: "url", label: "Link", type: "url" },
      { key: "tags", label: "Tags (comma separated)" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
  },
  chats: {
    title: "Chats",
    singular: "chat",
    fields: [
      { key: "title", label: "Title", required: true },
      { key: "url", label: "Link", type: "url" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
  },
};

const VIEWS = {
  home: { title: "Home" },
  ...Object.fromEntries(
    Object.entries(COLLECTIONS).map(([key, config]) => [
      key,
      { title: config.title },
    ]),
  ),
  build: { title: "Build / Repair" },
  search: { title: "Search" },
};

const state = {
  vault: null,
  view: "home",
  dirty: false,
  savedAt: null,
  saving: false,
  revision: 0,
};

const ui = {
  queries: {},
  filters: {},
  sorts: {},
  globalQuery: "",
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
    value.toString(16).padStart(2, "0"),
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
  const vault = {
    ...DEFAULT_VAULT,
    ...(raw && typeof raw === "object" ? raw : {}),
  };
  for (const key of ["skills", "projects", "docs", "cards", "chats"]) {
    vault[key] = Array.isArray(vault[key])
      ? vault[key].map((item) =>
          item && typeof item === "object" ? item : { name: String(item) },
        )
      : [];
  }
  vault.meta =
    vault.meta && typeof vault.meta === "object" && !Array.isArray(vault.meta)
      ? vault.meta
      : { ...DEFAULT_VAULT.meta };
  return vault;
}

async function call(action, payload = {}, { signal } = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = { "Content-Type": "application/json" };

  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  const response = await fetch(API, {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify({ action, payload }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      result.error || `Request failed (${response.status})`,
    );
    error.code = result.code;
    error.status = response.status;
    error.retryAfter = Number(response.headers.get("Retry-After")) || 0;
    throw error;
  }

  return result;
}

function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state.vault));
    localStorage.setItem(DIRTY_KEY, state.dirty ? "1" : "0");
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
      state.savedAt
        ? `Vault loaded. Last saved ${state.savedAt.toLocaleString()}.`
        : "Vault loaded.",
      "success",
    );
  }
}

async function loadVault({ silent = false } = {}) {
  if (silent && state.dirty) {
    setStatus("Local changes are ready. Save to sync them with GitHub.");
    return;
  }
  const revision = state.revision;
  if (!silent) {
    setStatus("Loading vault…");
  }

  try {
    const result = await call("load");
    if (state.revision !== revision) {
      setStatus(
        "Kept your newer local changes. Save when you’re ready to sync.",
      );
      return;
    }
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
  if (!state.vault || state.saving || !state.dirty) {
    return;
  }
  if (!localStorage.getItem(TOKEN_KEY)) {
    setStatus(
      "Changes are saved on this device. Sign in with GitHub to sync them.",
    );
    return;
  }
  const revision = state.revision;
  const snapshot = structuredClone(state.vault);
  state.saving = true;
  setStatus("Saving vault…");
  updateSaveButton();

  try {
    const result = await call("save", { vault: snapshot });
    state.dirty = state.revision !== revision;
    state.savedAt = new Date();
    writeCache();
    updateSaveButton();
    setStatus(
      state.dirty
        ? "Saved. Newer local changes are still waiting to sync."
        : result.created
          ? "Vault created in GitHub."
          : `Vault saved at ${state.savedAt.toLocaleString()}.`,
      "success",
    );
  } catch (error) {
    writeCache();
    setStatus(`${error.message} — changes kept in the local cache.`, "error");
  } finally {
    state.saving = false;
    updateSaveButton();
  }
}

function markDirty() {
  state.dirty = true;
  state.revision += 1;
  updateSaveButton();
  writeCache();
}

function updateSaveButton() {
  const signedIn = Boolean(localStorage.getItem(TOKEN_KEY));
  saveButton.disabled = state.saving || !state.dirty || !signedIn;
  saveButton.textContent = state.saving
    ? "Syncing…"
    : state.dirty && signedIn
      ? "Save changes"
      : signedIn
        ? "Synced"
        : "Saved locally";
  saveButton.classList.toggle("button-primary", state.dirty && signedIn);
  const indicator = document.querySelector("#sync-indicator");
  indicator.textContent = state.saving
    ? "Syncing to GitHub"
    : state.dirty
      ? "Local changes · not synced"
      : signedIn
        ? "Connected to GitHub"
        : "Local workspace";
  indicator.dataset.kind = state.dirty ? "pending" : "";
}

function startLogin() {
  const stateParam = Array.from(
    crypto.getRandomValues(new Uint8Array(24)),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
  authorizationUrl.searchParams.set("client_id", CLIENT_ID);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("scope", "repo");
  authorizationUrl.searchParams.set("state", stateParam);
  localStorage.setItem(STATE_KEY, stateParam);

  const popup = window.open(
    authorizationUrl,
    "myvault-oauth",
    "width=600,height=720",
  );
  if (!popup) {
    setStatus("Allow popups to sign in with GitHub.", "error");
    return;
  }
  setStatus("Complete sign-in in the GitHub popup.");
}

function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  loginButton.textContent = "Sign in with GitHub";
  updateSaveButton();
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
      window.location.origin,
    );
    window.close();
    return;
  }

  try {
    const result = await call("auth", {
      code,
      redirect_uri: `${window.location.origin}${window.location.pathname}`,
    });
    const token = result.token || result.access_token;
    if (!token) {
      throw new Error("The API did not return an access token.");
    }
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(STATE_KEY);
    window.opener.postMessage(
      { type: "myvault-oauth", success: true },
      window.location.origin,
    );
  } catch (error) {
    window.opener.postMessage(
      { type: "myvault-oauth", error: error.message },
      window.location.origin,
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
      ...(typeof note === "string" ? { text: note } : note),
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
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
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
  recognition.onerror = () =>
    setStatus("Voice input could not be completed.", "error");
  setStatus("Listening… speak now.");
  recognition.start();
}

function render() {
  if (!state.vault) {
    viewContainer.innerHTML = "";
    return;
  }
  updateConstellationBackground();
  updateSaveButton();
  document.querySelectorAll("[data-count]").forEach((el) => {
    el.textContent = state.vault[el.dataset.count].length;
  });

  switch (state.view) {
    case "home":
      renderHome();
      break;
    case "build":
      renderBuild();
      break;
    case "search":
      renderSearch();
      break;
    default:
      renderCollection(state.view);
  }
}

function navigate(view) {
  if (!VIEWS[view]) view = "home";
  if (view !== "search") {
    ui.globalQuery = "";
    document.querySelector("#global-search").value = "";
  }
  state.view = view;
  document
    .querySelectorAll(".nav-link")
    .forEach((item) => item.removeAttribute("aria-current"));
  document
    .querySelector(`.nav-link[data-view="${view}"]`)
    ?.setAttribute("aria-current", "page");
  viewTitle.textContent = VIEWS[view]?.title ?? "Home";
  document.title = `${VIEWS[view]?.title ?? "Home"} · MyVault OS`;
  history.replaceState(null, "", `#${view}`);
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
    .sort((a, b) =>
      String(b.item.created ?? "").localeCompare(String(a.item.created ?? "")),
    )
    .slice(0, 6);
}

const ICON_PATHS = {
  home: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  projects: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/>',
  skills: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  docs: '<path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h6"/>',
  chats:
    '<path d="M21 11a8 8 0 0 1-8 8H8l-5 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z"/><path d="M7 9h10M7 13h7"/>',
  build:
    '<path d="m14 6 4 4m-12 4 4 4M3 21l7-7m3-6L7 2 2 7l6 6m5 0 8 8m-4-8a6 6 0 0 0 5-8l-4 4-3-3 4-4a6 6 0 0 0-8 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
  voice:
    '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] ?? ICON_PATHS.docs}</svg>`;
}

function pageHeading(title, description, action = "") {
  return `<header class="page-heading"><div><p class="eyebrow">Your personal workspace</p><h1>${escapeHtml(title)}</h1><p class="subtitle">${escapeHtml(description)}</p></div>${action}</header>`;
}

function emptyState(kind, title, description, action = "") {
  return `<div class="empty-state">${icon(kind)}<strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p>${action}</div>`;
}

function openRecordButton(
  collection,
  index,
  item,
  detail,
  className = "recent-row",
) {
  return `<button class="${className}" data-open-collection="${collection}" data-open-index="${index}" type="button"><span class="row-icon">${icon(collection)}</span><span class="row-text"><span class="row-title">${escapeHtml(itemTitle(item))}</span><span class="row-detail">${escapeHtml(detail)}</span></span><span class="row-arrow" aria-hidden="true">↗</span></button>`;
}

function bindWorkspaceActions() {
  viewContainer.querySelectorAll("[data-navigate]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.navigate));
  });
  viewContainer.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => openItemDialog(button.dataset.add));
  });
  viewContainer.querySelectorAll("[data-open-collection]").forEach((button) => {
    button.addEventListener("click", () =>
      openItemDialog(
        button.dataset.openCollection,
        Number(button.dataset.openIndex),
      ),
    );
  });
}

function renderHome() {
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? "Good morning."
      : hour < 18
        ? "Good afternoon."
        : "Good evening.";
  const active = state.vault.projects
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => String(item.status).toLowerCase() === "active");
  const captions = {
    projects: `${active.length} active right now`,
    skills: "Keep your curiosity growing",
    docs: "Knowledge, within reach",
    chats: "Conversations worth keeping",
  };
  const notes = voiceNotes();
  const recent = recentItems();
  viewContainer.innerHTML = `
    ${pageHeading(greeting, "A little clarity for everything you’re building.", `<div class="date-chip">${icon("calendar")}${escapeHtml(new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}</div>`)}
    <section class="card-grid" aria-label="Vault overview">${["projects", "skills", "docs", "chats"].map((key) => `<button class="card" type="button" data-navigate="${key}"><span class="card-top"><span class="card-icon">${icon(key)}</span><span class="card-arrow" aria-hidden="true">↗</span></span><p class="card-label">${COLLECTIONS[key].title}</p><p class="card-value">${state.vault[key].length}</p><span class="card-caption">${captions[key]}</span></button>`).join("")}</section>
    <div class="dashboard-grid"><div>
      <section class="panel" aria-labelledby="projects-heading"><div class="panel-heading"><div><h2 id="projects-heading">In focus</h2><p class="section-caption">Your active projects, all in one place</p></div><button class="text-button" type="button" data-navigate="projects">All projects ↗</button></div>
        ${
          active.length
            ? active
                .slice(0, 4)
                .map(({ item, index }) =>
                  openRecordButton(
                    "projects",
                    index,
                    item,
                    item.status,
                    "project-row",
                  ),
                )
                .join("")
            : emptyState(
                "projects",
                "Make room for your next idea",
                "Add a project and set it to Active to see it here.",
                `<button class="button" type="button" data-add="projects">${icon("plus")} New project</button>`,
              )
        }
      </section>
      <section class="panel" aria-labelledby="recent-heading"><div class="panel-heading"><div><h2 id="recent-heading">Recently added</h2><p class="section-caption">Pick up a thread from your vault</p></div><span class="item-meta">${recent.length} items</span></div><div class="recent-list">
        ${recent.length ? recent.map(({ collection, config, item }) => openRecordButton(collection, state.vault[collection].indexOf(item), item, `${config.title} · ${formatTime(item.created) || "Imported item"}`)).join("") : emptyState("docs", "Your workspace starts here", "Add your first skill, document, project, or chat using Quick capture.")}
      </div></section>
    </div><div>
      <section class="panel" aria-labelledby="capture-heading"><div class="panel-heading"><div><h2 id="capture-heading">Quick capture</h2><p class="section-caption">Give your next thought a home</p></div>${icon("plus")}</div><div class="quick-actions">${["projects", "skills", "docs", "chats"].map((key) => `<button class="quick-action" type="button" data-add="${key}">${icon(key)}<span>New ${COLLECTIONS[key].singular}</span></button>`).join("")}</div></section>
      <section class="panel constellation-teaser" aria-labelledby="connect-heading"><div class="constellation-art" aria-hidden="true"><svg viewBox="0 0 280 110" fill="none"><path d="m25 70 55-40 54 53 34-63 75 28-38 45-71-10L80 30l88-10M25 70l109 13 109-35" stroke="currentColor" opacity=".3"/>${[
        [25, 70],
        [80, 30],
        [134, 83],
        [168, 20],
        [243, 48],
        [205, 93],
      ]
        .map(
          ([x, y]) =>
            `<circle cx="${x}" cy="${y}" r="9" fill="currentColor" opacity=".06"/><circle cx="${x}" cy="${y}" r="2.5" fill="currentColor"/>`,
        )
        .join(
          "",
        )}<circle cx="50" cy="18" r="1" fill="currentColor"/><circle cx="224" cy="15" r="1" fill="currentColor"/></svg></div><p class="eyebrow">The bigger picture</p><h2 id="connect-heading">Connect the dots.</h2><p>Projects anchor a 65° orbit of skills and other records, visible as a quiet background throughout your workspace.</p><span class="constellation-background-badge">Live background</span></section>
      <section class="panel" aria-labelledby="voice-heading"><div class="panel-heading"><h2 id="voice-heading">Voice notes</h2><button class="text-button" id="voice-button" type="button">${icon("voice")} Capture</button></div>${notes.length ? `<div class="item-list">${notes.map((note) => `<div class="item voice-note"><p class="item-notes">${escapeHtml(note.text)}</p><div class="item-top">${note.at ? `<time>${escapeHtml(formatTime(note.at))}</time>` : ""}<button class="button-danger" type="button" data-delete-voice="${note.rawIndex}" aria-label="Delete voice note">Delete</button></div></div>`).join("")}</div>` : '<p class="voice-empty">A passing thought? Say it out loud.<br>Capture a note and come back to it later.</p>'}</section>
    </div></div>`;
  bindWorkspaceActions();
  viewContainer
    .querySelector("#voice-button")
    .addEventListener("click", startVoiceInput);
  viewContainer.querySelectorAll("[data-delete-voice]").forEach((button) =>
    button.addEventListener("click", () => {
      if (!window.confirm("Delete this voice note?")) return;
      state.vault.meta.voiceNotes.splice(Number(button.dataset.deleteVoice), 1);
      markDirty();
      render();
      setStatus("Voice note deleted. Changes saved on this device.", "success");
    }),
  );
}

function fieldHtml(field, item = {}) {
  const raw = item[field.key] ?? "";
  const value = Array.isArray(raw) ? raw.join(", ") : raw;
  const required = field.required ? " required autofocus" : "";
  const label = `<label for="field-${field.key}">${escapeHtml(field.label)}${field.required ? " *" : ""}</label>`;
  if (field.type === "textarea")
    return `<div class="field">${label}<textarea id="field-${field.key}" name="${field.key}">${escapeHtml(value)}</textarea></div>`;
  if (field.type === "select") {
    const options = ["", ...field.options];
    if (value && !options.includes(value)) options.push(value);
    return `<div class="field">${label}<select id="field-${field.key}" name="${field.key}">${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option || "Choose…")}</option>`).join("")}</select></div>`;
  }
  return `<div class="field">${label}<input id="field-${field.key}" name="${field.key}" type="${field.type ?? "text"}" value="${escapeHtml(value)}"${required}${field.type === "url" ? ' placeholder="https://…"' : ""}></div>`;
}

function openItemDialog(key, index = null) {
  const config = COLLECTIONS[key];
  const editingItem = index === null ? null : state.vault[key][index];
  const dialog = document.querySelector("#item-dialog");
  const content = document.querySelector("#dialog-content");
  content.innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">${config.title}</p><h2 id="dialog-title">${editingItem ? "Edit" : "New"} ${config.singular}</h2><p>Saved on this device. Sync to GitHub when you’re ready.</p></div><button class="dialog-close" type="button" aria-label="Close dialog">×</button></div><form class="item-form" id="item-form"><div class="form-row">${config.fields.map((field) => fieldHtml(field, editingItem ?? {})).join("")}</div><p class="form-help" id="form-feedback" role="status">* Required field</p><div class="form-footer"><button class="button" type="button" id="cancel-edit">Cancel</button><button class="button button-primary" type="submit">${editingItem ? "Save changes" : `Add ${config.singular}`}</button></div></form>`;
  const form = content.querySelector("form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const titleKey = config.fields[0].key;
    if (!String(data[titleKey] ?? "").trim()) {
      const feedback = content.querySelector("#form-feedback");
      feedback.textContent = `${config.fields[0].label} is required.`;
      feedback.dataset.kind = "error";
      form.elements[titleKey].focus();
      return;
    }
    for (const field of config.fields) {
      if (typeof data[field.key] === "string")
        data[field.key] = data[field.key].trim();
    }
    if (key === "docs")
      data.tags = data.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    if (editingItem) {
      // Replace editable fields only, preserving import metadata and links.
      for (const field of config.fields) {
        delete editingItem[field.key];
        if (data[field.key] !== "") editingItem[field.key] = data[field.key];
      }
    } else {
      for (const field of config.fields)
        if (data[field.key] === "") delete data[field.key];
      state.vault[key].unshift({
        id: uid(),
        created: new Date().toISOString(),
        ...data,
      });
    }
    markDirty();
    dialog.close();
    render();
    setStatus(
      `${config.singular[0].toUpperCase() + config.singular.slice(1)} ${editingItem ? "updated" : "added"}. Saved on this device${localStorage.getItem(TOKEN_KEY) ? "; save changes to sync with GitHub." : ". Sign in to sync with GitHub."}`,
      "success",
    );
  });
  content
    .querySelector(".dialog-close")
    .addEventListener("click", () => dialog.close());
  content
    .querySelector("#cancel-edit")
    .addEventListener("click", () => dialog.close());
  dialog.showModal();
}

function itemMatches(item, query) {
  return JSON.stringify(item).toLowerCase().includes(query);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function filteredItems(key) {
  const query = (ui.queries[key] ?? "").trim().toLowerCase();
  const filterField = key === "projects" ? "status" : "level";
  const items = state.vault[key]
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        (!query || itemMatches(item, query)) &&
        (!ui.filters[key] || item[filterField] === ui.filters[key]),
    );
  return items.sort((a, b) =>
    ui.sorts[key] === "name"
      ? itemTitle(a.item).localeCompare(itemTitle(b.item))
      : String(b.item.created ?? "").localeCompare(
          String(a.item.created ?? ""),
        ),
  );
}

function renderItems(key) {
  const config = COLLECTIONS[key];
  const items = filteredItems(key);
  if (!items.length)
    return state.vault[key].length
      ? emptyState(
          "search",
          "No matching items",
          "Try another search or reset your filters.",
          '<button class="button" type="button" id="clear-filters">Clear filters</button>',
        )
      : emptyState(
          key,
          `A home for your ${config.title.toLowerCase()}`,
          `Add your first ${config.singular} to get started.`,
          `<button class="button" type="button" data-add="${key}">${icon("plus")} New ${config.singular}</button>`,
        );
  return `<div class="item-list">${items
    .map(({ item, index }) => {
      const badges = [
        item.status,
        item.level,
        ...(Array.isArray(item.tags) ? item.tags : normalizeTags(item.tags)),
      ].filter(Boolean);
      const url = safeUrl(item.url);
      return `<article class="item"><div class="item-top"><h2 class="item-name">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(itemTitle(item))} ↗</a>` : escapeHtml(itemTitle(item))}</h2><div class="item-actions"><button class="button" type="button" data-edit="${index}" aria-label="Edit ${escapeHtml(itemTitle(item))}">Edit</button><button class="button-danger" type="button" data-delete="${index}" aria-label="Delete ${escapeHtml(itemTitle(item))}">Delete</button></div></div><div class="record-badges">${badges.map((value) => `<span class="badge" data-value="${escapeHtml(value)}">${escapeHtml(value)}</span>`).join("")}</div>${item.notes ? `<p class="item-notes">${escapeHtml(item.notes)}</p>` : ""}${item.sourcePath ? `<p class="row-detail">${escapeHtml(item.sourcePath)}</p>` : ""}</article>`;
    })
    .join("")}</div>`;
}

function renderCollection(key) {
  const config = COLLECTIONS[key];
  const descriptions = {
    projects: "From first idea to finished work. Keep things moving.",
    skills: "Everything you know, and everything you’re learning.",
    docs: "Keep useful knowledge close at hand.",
    chats: "Good conversations deserve a place to live.",
  };
  const field = config.fields.find((field) => field.type === "select");
  const filterValues = field
    ? [
        ...new Set([
          ...field.options,
          ...state.vault[key].map((item) => item[field.key]).filter(Boolean),
        ]),
      ]
    : [];
  viewContainer.innerHTML = `${pageHeading(config.title, descriptions[key], `<button class="button button-primary" type="button" data-add="${key}">${icon("plus")} New ${config.singular}</button>`)}<section class="panel" aria-label="${config.title}"><div class="collection-toolbar"><label class="visually-hidden" for="collection-search">Search ${config.title.toLowerCase()}</label><input class="search-input" id="collection-search" type="search" placeholder="Search ${config.title.toLowerCase()}…" value="${escapeHtml(ui.queries[key] ?? "")}">${field ? `<label class="visually-hidden" for="collection-filter">Filter by ${field.label.toLowerCase()}</label><select id="collection-filter"><option value="">All ${field.label === "Status" ? "statuses" : "levels"}</option>${filterValues.map((value) => `<option value="${escapeHtml(value)}" ${ui.filters[key] === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>` : ""}<label class="visually-hidden" for="collection-sort">Sort items</label><select id="collection-sort"><option value="newest">Newest first</option><option value="name" ${ui.sorts[key] === "name" ? "selected" : ""}>Name A–Z</option></select></div><p class="results-count" id="results-count" role="status"></p><div id="collection-items"></div></section>`;
  refreshCollectionItems(key);
  viewContainer
    .querySelector("#collection-search")
    .addEventListener("input", (event) => {
      ui.queries[key] = event.target.value;
      refreshCollectionItems(key);
    });
  viewContainer
    .querySelector("#collection-filter")
    ?.addEventListener("change", (event) => {
      ui.filters[key] = event.target.value;
      refreshCollectionItems(key);
    });
  viewContainer
    .querySelector("#collection-sort")
    .addEventListener("change", (event) => {
      ui.sorts[key] = event.target.value;
      refreshCollectionItems(key);
    });
  viewContainer
    .querySelector(".page-heading [data-add]")
    .addEventListener("click", () => openItemDialog(key));
}

function refreshCollectionItems(key) {
  const container = viewContainer.querySelector("#collection-items");
  container.innerHTML = renderItems(key);
  viewContainer.querySelector("#results-count").textContent =
    `${filteredItems(key).length} of ${state.vault[key].length} ${COLLECTIONS[key].title.toLowerCase()}`;
  container
    .querySelectorAll("[data-add]")
    .forEach((button) =>
      button.addEventListener("click", () => openItemDialog(key)),
    );
  container.querySelector("#clear-filters")?.addEventListener("click", () => {
    ui.queries[key] = "";
    ui.filters[key] = "";
    renderCollection(key);
  });
  container
    .querySelectorAll("[data-edit]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        openItemDialog(key, Number(button.dataset.edit)),
      ),
    );
  container.querySelectorAll("[data-delete]").forEach((button) =>
    button.addEventListener("click", () => {
      const index = Number(button.dataset.delete);
      if (!window.confirm(`Delete “${itemTitle(state.vault[key][index])}”?`))
        return;
      state.vault[key].splice(index, 1);
      markDirty();
      render();
      setStatus(
        `${COLLECTIONS[key].singular} deleted. Saved on this device.`,
        "success",
      );
    }),
  );
}

function renderSearch() {
  const query = ui.globalQuery.trim().toLowerCase();
  const matches = Object.entries(COLLECTIONS).flatMap(([key, config]) =>
    state.vault[key]
      .map((item, index) => ({ key, config, item, index }))
      .filter(({ item }) => itemMatches(item, query)),
  );
  viewContainer.innerHTML = `${pageHeading("Find your next thread.", `Search across your projects, skills, documents, and chats.`)}<section class="panel" aria-label="Search results"><div class="panel-heading"><h2>${matches.length} ${matches.length === 1 ? "result" : "results"} for “${escapeHtml(ui.globalQuery.trim())}”</h2></div>${matches.length ? matches.map(({ key, config, item, index }) => openRecordButton(key, index, item, config.title, "result-row")).join("") : emptyState("search", "Nothing found yet", "Try a name, a tag, or a word from your notes.")}</section>`;
  bindWorkspaceActions();
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
  if (
    parsed.meta !== undefined &&
    (!parsed.meta ||
      typeof parsed.meta !== "object" ||
      Array.isArray(parsed.meta))
  ) {
    errors.push('"meta" should be an object.');
  }
  return { ok: errors.length === 0, errors, parsed };
}

function renderBuild() {
  viewContainer.innerHTML = `
    ${pageHeading("Build / Repair", "Inspect your vault, validate changes, and keep your workspace healthy.")}
    <section class="vault-panel" aria-labelledby="vault-heading">
      <div class="panel-heading">
        <h2 id="vault-heading">Vault data (raw JSON)</h2>
        <div class="actions">
          <button class="button" id="validate-button" type="button">Validate</button>
          <button class="button" id="repair-button" type="button">Repair</button>
          <button class="button button-primary" id="apply-json" type="button">Apply changes</button>
          <button class="button" id="reload-button" type="button" ${!localStorage.getItem(TOKEN_KEY) ? "disabled" : ""}>Reload from GitHub</button>
        </div>
      </div>
      <textarea id="vault-editor" aria-label="Vault data JSON" spellcheck="false">${escapeHtml(
        JSON.stringify(state.vault, null, 2),
      )}</textarea>
      <p class="diagnostics" id="diagnostics" data-kind="ok"></p>
    </section>`;

  const editor = viewContainer.querySelector("#vault-editor");
  const diagnostics = viewContainer.querySelector("#diagnostics");

  viewContainer.querySelector("#apply-json").addEventListener("click", () => {
    const { ok, errors, parsed } = validateVaultJson(editor.value);
    if (!ok) {
      diagnostics.dataset.kind = "error";
      diagnostics.textContent = errors.join("\n");
      return;
    }
    state.vault = normalizeVault(parsed);
    markDirty();
    render();
    setStatus(
      "JSON changes applied and saved on this device. Save to sync with GitHub.",
      "success",
    );
  });

  viewContainer
    .querySelector("#validate-button")
    .addEventListener("click", () => {
      const { ok, errors } = validateVaultJson(editor.value);
      diagnostics.dataset.kind = ok ? "ok" : "error";
      diagnostics.textContent = ok
        ? "JSON is valid and matches the vault shape."
        : errors.join("\n");
    });

  viewContainer
    .querySelector("#repair-button")
    .addEventListener("click", () => {
      const { parsed } = validateVaultJson(editor.value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        diagnostics.dataset.kind = "error";
        diagnostics.textContent =
          "Cannot repair: JSON must be an object. Fix it manually or reload from GitHub.";
        return;
      }
      const repaired = normalizeVault(parsed);
      state.vault = repaired;
      markDirty();
      render();
      setStatus(
        "Vault repaired into the standard shape. Review it, then save.",
        "success",
      );
    });

  viewContainer
    .querySelector("#reload-button")
    .addEventListener("click", () => {
      if (
        state.dirty &&
        !window.confirm("Reloading discards unsaved changes. Continue?")
      ) {
        return;
      }
      loadVault();
    });
}

let constellationCleanup = null;
let constellationDataKey = "";
const CONSTELLATION_COLLECTIONS = ["projects", "skills", "docs", "chats", "cards"];

function normalizeTags(value) {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((tag) => tag.trim());
  return list.filter(Boolean).map((tag) => String(tag).toLowerCase());
}

async function updateConstellationBackground() {
  const container = document.querySelector("#constellation-background");
  if (!container) return;
  const dataKey = JSON.stringify(
    CONSTELLATION_COLLECTIONS.flatMap((kind) =>
      state.vault[kind].map((item) => [
        kind,
        item.id ?? "",
        itemTitle(item),
        normalizeTags(item.tags),
        item.links ?? [],
      ]),
    ),
  );
  if (dataKey === constellationDataKey) return;
  constellationDataKey = dataKey;
  constellationCleanup?.();
  container.replaceChildren();
  const token = { cancelled: false };
  let disposeResources = () => {};
  constellationCleanup = () => {
    token.cancelled = true;
    disposeResources();
  };

  let THREE;
  try {
    THREE = await import("three");
  } catch {
    return;
  }
  if (token.cancelled) {
    return;
  }

  const KIND_COLOR = {
    skills: "#cfe8ff",
    projects: "#ffe3b3",
    docs: "#d7c8ff",
    chats: "#a8e8d7",
    cards: "#ffcdb9",
  };
  const KIND_LABEL_COLOR = {
    skills: "#9fc6ee",
    projects: "#e8c795",
    docs: "#bdabf3",
    chats: "#8ed0bc",
    cards: "#e6a98e",
  };
  const nodes = CONSTELLATION_COLLECTIONS.flatMap((kind) =>
    state.vault[kind].map((item) => ({ item, kind })),
  ).map((node) => ({
    ...node,
    label: itemTitle(node.item),
    tags: normalizeTags(node.item.tags),
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
    const edgeKey = `${Math.min(a, b)}-${Math.max(a, b)}`;
    if (a === b || hasEdge.has(edgeKey)) {
      return;
    }
    hasEdge.add(edgeKey);
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

  // Projects form the compact center. Skills and all other known records
  // share an inclined orbital ring around the project core.
  const count = nodes.length;
  const positions = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const centerIndexes = [];
  const ringIndexes = [];
  nodes.forEach((node, index) =>
    (node.kind === "projects" ? centerIndexes : ringIndexes).push(index),
  );
  const projectRadius = Math.min(8, Math.max(3.5, Math.sqrt(centerIndexes.length) * 1.15));
  centerIndexes.forEach((nodeIndex, slot) => {
    const y = 1 - (2 * (slot + 0.5)) / centerIndexes.length;
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    const radius = centerIndexes.length === 1
      ? 0
      : projectRadius * Math.cbrt((slot + 0.5) / centerIndexes.length);
    const angle = golden * slot;
    positions[nodeIndex * 3] = Math.cos(angle) * horizontal * radius;
    positions[nodeIndex * 3 + 1] = y * radius;
    positions[nodeIndex * 3 + 2] = Math.sin(angle) * horizontal * radius;
  });
  const ringRadius = 22;
  const ringTilt = (65 * Math.PI) / 180;
  ringIndexes.forEach((nodeIndex, slot) => {
    const angle = golden * slot;
    const radius = ringRadius + ((slot % 5) - 2) * 0.35;
    const normalOffset = Math.sin(slot * 2.17) * 0.7;
    positions[nodeIndex * 3] = Math.cos(angle) * radius;
    positions[nodeIndex * 3 + 1] =
      -Math.sin(angle) * radius * Math.sin(ringTilt) + normalOffset * Math.cos(ringTilt);
    positions[nodeIndex * 3 + 2] =
      Math.sin(angle) * radius * Math.cos(ringTilt) + normalOffset * Math.sin(ringTilt);
  });

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const starSystem = new THREE.Group();
  scene.add(starSystem);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 600);
  camera.position.set(0, 6, 56);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;

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
    skyGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(skyPositions, 3),
    );
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
          blending: THREE.AdditiveBlending,
        }),
      ),
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
      layerPositions.set(
        positions.slice(nodeIndex * 3, nodeIndex * 3 + 3),
        slot * 3,
      );
      layerColors.set(
        new THREE.Color(KIND_COLOR[nodes[nodeIndex].kind]).toArray(),
        slot * 3,
      );
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(layerPositions, 3),
    );
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
        blending: THREE.AdditiveBlending,
      }),
    );
    starSystem.add(points);
    pointLayers.push(points);
  }

  // Constellation lines.
  const linePositions = new Float32Array(edges.length * 6);
  edges.forEach(([a, b], index) => {
    linePositions.set(positions.slice(a * 3, a * 3 + 3), index * 6);
    linePositions.set(positions.slice(b * 3, b * 3 + 3), index * 6 + 3);
  });
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(linePositions, 3),
  );
  starSystem.add(
    new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({
        color: 0x9db9e8,
        transparent: true,
        opacity: 0.32,
      }),
    ),
  );

  // Celestial graticule: meridian + parallel rings, like a real star chart.
  const gridMaterial = new THREE.LineBasicMaterial({
    color: 0x4a6491,
    transparent: true,
    opacity: 0.16,
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
      starSystem.add(new THREE.LineLoop(geometry, gridMaterial));
    }
    // Meridians.
    for (let m = 0; m < 4; m++) {
      const geometry = makeRing("xy");
      geometry.rotateY((m / 4) * Math.PI);
      gridGeometries.push(geometry);
      starSystem.add(new THREE.LineLoop(geometry, gridMaterial));
    }
    const orbitGeometry = makeRing("xz");
    orbitGeometry.rotateX((65 * Math.PI) / 180);
    gridGeometries.push(orbitGeometry);
    starSystem.add(
      new THREE.LineLoop(
        orbitGeometry,
        new THREE.LineBasicMaterial({
          color: 0x71b49d,
          transparent: true,
          opacity: 0.38,
        }),
      ),
    );
  }

  // Name labels beside stars, toggleable like a planetarium.
  const labelSprites = nodes.map((node, nodeIndex) => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 72;
    const ctx = canvas.getContext("2d");
    ctx.font = "400 30px Georgia, 'Times New Roman', serif";
    ctx.textAlign = "left";
    ctx.fillStyle = KIND_LABEL_COLOR[node.kind];
    ctx.shadowColor = "rgba(2,6,18,0.95)";
    ctx.shadowBlur = 8;
    ctx.fillText(node.label.slice(0, 30), 8, 46);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        opacity: 0.58,
        depthTest: false,
      }),
    );
    sprite.scale.set(9.5, 1.35, 1);
    sprite.position.set(
      positions[nodeIndex * 3] + 1.6,
      positions[nodeIndex * 3 + 1] + 1.1,
      positions[nodeIndex * 3 + 2],
    );
    starSystem.add(sprite);
    return sprite;
  });

  function resize() {
    const width = window.innerWidth || 600;
    const height = window.innerHeight || 560;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (reducedMotion) renderer.render(scene, camera);
  }
  resize();
  window.addEventListener("resize", resize);

  let frame = 0;
  function animate() {
    if (token.cancelled) {
      return;
    }
    if (!document.hidden && !reducedMotion) starSystem.rotation.y += 0.00035;
    renderer.render(scene, camera);
    if (!reducedMotion) frame = requestAnimationFrame(animate);
  }
  animate();

  disposeResources = () => {
    token.cancelled = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    pointGeometries.forEach((geometry) => geometry.dispose());
    lineGeometry.dispose();
    gridGeometries.forEach((geometry) => geometry.dispose());
    gridMaterial.dispose();
    labelSprites.forEach((sprite) => {
      sprite.material.map.dispose();
      sprite.material.dispose();
    });
    scene.traverse((object) => {
      object.geometry?.dispose();
      if (object.material && !Array.isArray(object.material))
        object.material.dispose();
    });
    glowTexture.dispose();
    dotTexture.dispose();
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
  if (
    event.origin !== window.location.origin ||
    event.data?.type !== "myvault-oauth"
  ) {
    return;
  }
  if (event.data.error) {
    setStatus(event.data.error, "error");
    return;
  }
  loginButton.textContent = "Sign out";
  setStatus("Signed in with GitHub.", "success");
  updateSaveButton();
  loadVault({ silent: true });
});

handleOAuthCallback();

const SIDEBAR_KEY = "myvault_sidebar_collapsed";
const sidebarCollapseButton = document.querySelector("#sidebar-collapse");
function applySidebarState() {
  const collapsed = localStorage.getItem(SIDEBAR_KEY) === "1";
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  if (sidebarCollapseButton) {
    sidebarCollapseButton.innerHTML = collapsed
      ? "→"
      : "← <span>Collapse sidebar</span>";
    sidebarCollapseButton.setAttribute(
      "aria-label",
      collapsed ? "Expand sidebar" : "Collapse sidebar",
    );
    sidebarCollapseButton.setAttribute("aria-expanded", String(!collapsed));
  }
  return collapsed;
}
applySidebarState();
sidebarCollapseButton?.addEventListener("click", () => {
  const collapsed = document.body.classList.toggle("sidebar-collapsed");
  localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  applySidebarState();
  window.dispatchEvent(new Event("resize"));
});

document.querySelectorAll("[data-icon]").forEach((el) => {
  el.innerHTML = icon(el.dataset.icon);
});
document.querySelectorAll(".nav-link").forEach((el) => {
  el.setAttribute("aria-label", VIEWS[el.dataset.view].title);
  el.title = VIEWS[el.dataset.view].title;
});
document
  .querySelector(".brand")
  .addEventListener("click", () => navigate("home"));
document.querySelector("#workspace-date").textContent =
  new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
document.querySelector("#global-search").addEventListener("input", (event) => {
  ui.globalQuery = event.target.value;
  navigate(ui.globalQuery.trim() ? "search" : "home");
});
window.addEventListener("hashchange", () => {
  const view = location.hash.slice(1);
  if (VIEWS[view] && view !== "search") navigate(view);
});
window.addEventListener("keydown", (event) => {
  const editing = event.target.closest(
    "input, textarea, select, [contenteditable], dialog",
  );
  if (
    event.key === "/" &&
    !editing &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    document.querySelector("#global-search").focus();
  }
});

if (localStorage.getItem(TOKEN_KEY)) {
  loginButton.textContent = "Sign out";
}

// Narrow bridge for the optional AI panel. It never exposes credentials.
globalThis.myVaultAIBridge = Object.freeze({
  getVault: () => state.vault,
  isSignedIn: () => Boolean(localStorage.getItem(TOKEN_KEY)),
  getRevision: () => state.revision,
  uid,
  call,
  escapeHtml,
  applyLocalVault(nextVault, message) {
    state.vault = normalizeVault(nextVault);
    markDirty();
    render();
    setStatus(message, "success");
  },
});

const cached = readCache();
const initialView = location.hash.slice(1);
if (VIEWS[initialView] && initialView !== "search") state.view = initialView;
else if (initialView === "constellation") history.replaceState(null, "", "#home");
viewTitle.textContent = VIEWS[state.view].title;
document.title = `${VIEWS[state.view].title} · MyVault OS`;
document.querySelectorAll(".nav-link").forEach((el) => {
  if (el.dataset.view === state.view) el.setAttribute("aria-current", "page");
  else el.removeAttribute("aria-current");
});
if (cached) {
  state.vault = cached;
  state.dirty = localStorage.getItem(DIRTY_KEY) === "1";
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
  setStatus(
    "New local vault started. Sign in with GitHub to sync it to your myvault-data repo.",
  );
}
