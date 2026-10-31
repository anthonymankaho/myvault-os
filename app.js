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
  tasks: [],
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
      { key: "links", label: "Connected projects or skills (one name per line)", type: "textarea" },
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
      { key: "links", label: "Connected projects or skills (one name per line)", type: "textarea" },
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
  home: { title: "Constellation" },
  control: { title: "Dashboard" },
  ...Object.fromEntries(
    Object.entries(COLLECTIONS).map(([key, config]) => [
      key,
      { title: config.title },
    ]),
  ),
  tasks: { title: "Monthly Task" },
  build: { title: "Build / Repair" },
  search: { title: "Search" },
};

const state = {
  vault: null,
  view: "control",
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

function normalizeTask(raw) {
  const task = raw && typeof raw === "object" ? { ...raw } : {};
  return {
    id: String(task.id || uid()),
    planningMonth: /^\d{4}-\d{2}$/.test(String(task.planningMonth || ""))
      ? String(task.planningMonth)
      : hkDateKey().slice(0, 7),
    company: String(task.company || "OTHER").trim(),
    description: String(task.description || ""),
    scheduledDate: /^\d{4}-\d{2}-\d{2}$/.test(String(task.scheduledDate || ""))
      ? String(task.scheduledDate)
      : hkDateKey(),
    status: task.status === "Completed" ? "Completed" : "Not Started",
    docResult: String(task.docResult || ""),
    completedAt: task.status === "Completed" ? task.completedAt || new Date().toISOString() : null,
    createdAt: task.createdAt || task.created || new Date().toISOString(),
    updatedAt: task.updatedAt || task.createdAt || task.created || new Date().toISOString(),
    source: task.source && typeof task.source === "object" ? { ...task.source } : undefined,
    carriedFromTaskId: task.carriedFromTaskId ? String(task.carriedFromTaskId) : undefined,
  };
}

function normalizeVault(raw) {
  const vault = {
    ...DEFAULT_VAULT,
    ...(raw && typeof raw === "object" ? raw : {}),
  };
  for (const key of ["skills", "projects", "docs", "cards", "chats", "tasks"]) {
    vault[key] = Array.isArray(vault[key])
      ? vault[key].map((item) =>
          item && typeof item === "object" ? item : { name: String(item) },
        )
      : [];
  }
  vault.tasks = vault.tasks.map(normalizeTask);
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
  const currentMonth = hkDateKey().slice(0, 7);
  const taskMonthsAvailable = [...new Set(state.vault.tasks.map((task) => task.planningMonth))]
    .filter(Boolean)
    .sort()
    .reverse();
  if (taskMonthsAvailable.length && !taskMonthsAvailable.includes(currentMonth)) {
    ui.taskMonth = taskMonthsAvailable[0];
    ui.taskScope = "monthly";
  }
  state.dirty = false;
  writeCache();
  updateSaveButton();
  render();
  refreshDailyReminder();
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
  document.body.classList.toggle("constellation-home", state.view === "home");
  const mapContainer = document.querySelector("#constellation-background");
  if (mapContainer) {
    mapContainer.inert = state.view !== "home";
    mapContainer.setAttribute("aria-hidden", String(state.view !== "home"));
  }
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
      viewContainer.innerHTML = "";
      break;
    case "control":
      renderHome();
      break;
    case "build":
      renderBuild();
      break;
    case "search":
      renderSearch();
      break;
    case "tasks":
      renderTasks();
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
  constellation:
    '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="4" r="2"/><circle cx="13" cy="17" r="3"/><path d="m7 6 10-2M6 8l5 7m8-9-5 8"/>',
  projects: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/>',
  skills: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  docs: '<path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h6"/>',
  chats:
    '<path d="M21 11a8 8 0 0 1-8 8H8l-5 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z"/><path d="M7 9h10M7 13h7"/>',
  tasks:
    '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/><path d="m5.5 8 .8.8L7.8 7"/>',
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
  return `<button class="${className}" data-open-collection="${collection}" data-open-index="${index}" type="button"><span class="row-icon">${icon(collection)}</span><span class="row-text"><span class="row-title">${escapeHtml(itemTitle(item))}</span><span class="row-detail">${escapeHtml(detail)}</span></span><span class="row-arrow">›</span></button>`;
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
    <section class="card-grid" aria-label="Vault overview">${["projects", "skills", "docs", "chats"].map((key) => `<button class="card" type="button" data-navigate="${key}"><span class="card-top"><span class="card-icon">${icon(key)}</span><span class="card-arrow">›</span></span><span class="card-label">${escapeHtml(captions[key])}</span><p class="card-value">${state.vault[key].length}</p><span class="card-caption">${escapeHtml(key === "projects" ? "active projects" : key)}</span></button>`).join("")}</section>
    <div class="dashboard-grid"><div>
      <section class="panel" aria-labelledby="projects-heading"><div class="panel-heading"><div><h2 id="projects-heading">In focus</h2><p class="section-caption">Your active projects, all in one place.</p></div></div>
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
      <section class="panel" aria-labelledby="recent-heading"><div class="panel-heading"><div><h2 id="recent-heading">Recently added</h2><p class="section-caption">Pick up a thread from your vault.</p></div></div>
        ${recent.length ? recent.map(({ collection, config, item }) => openRecordButton(collection, state.vault[collection].indexOf(item), item, `${config.title} · ${formatTime(item.created) || "just now"}`).replace(/\n/g, "")).join("") : emptyState("search", "Nothing new yet", "Add a skill, project, doc, or chat to begin.")}
      </section>
    </div><div>
      <section class="panel" aria-labelledby="capture-heading"><div class="panel-heading"><div><h2 id="capture-heading">Quick capture</h2><p class="section-caption">Give your next thought a home.</p></div></div>
        <div class="quick-actions">${["projects", "skills", "docs", "chats"].map((key) => `<button class="quick-action" type="button" data-add="${key}">${icon(key)}<span>${escapeHtml(COLLECTIONS[key].title)}</span></button>`).join("")}</div>
      </section>
      <section class="panel constellation-teaser" aria-labelledby="connect-heading"><div class="constellation-art" aria-hidden="true"><svg viewBox="0 0 280 110" fill="none"><path d="m25 70 55-40 28 18 40-32 45 22 30 25 18-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity=".65"/><g>${[[25, 70],[80, 30],[108, 48],[149, 16],[194, 38],[243, 48],[205, 93]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="currentColor" opacity=".12"/><circle cx="${x}" cy="${y}" r="2.5" fill="currentColor"/>`).join("")}</g></svg></div><p class="eyebrow">The bigger picture</p><h2 id="connect-heading">Connected thinking</h2><p>See how your projects connect with the skills you are growing. Select a star to explore its linked records.</p><button class="button button-primary" type="button" data-navigate="home">Open constellation</button></section>
      <section class="panel" aria-labelledby="voice-heading"><div class="panel-heading"><div><h2 id="voice-heading">Voice notes</h2></div><button class="text-button" id="voice-button" type="button">${icon("voice")} Capture</button></div>
        ${notes.length ? `<div class="item-list">${notes.map((note) => `<article class="item voice-note"><div class="item-top"><h3 class="item-name">${escapeHtml(note.text.slice(0, 50) || "Voice note")}</h3><button class="button button-danger" type="button" data-delete-voice="${note.rawIndex}">Delete</button></div><p class="item-notes">${escapeHtml(note.text)}</p><time>${escapeHtml(new Date(note.at || Date.now()).toLocaleString())}</time></article>`).join("")}</div>` : emptyState("voice", "Quiet for now", "Add a quick voice memo and it will stay with this workspace.")}
      </section>
    </div></div>`;
  bindWorkspaceActions();
  const dashboard = viewContainer.querySelector(".dashboard-grid");
  if (dashboard) {
    dashboard.insertAdjacentHTML("beforebegin", renderTaskHomeWidget());
    bindTaskHomeWidget();
  }
  viewContainer
    .querySelector("#voice-button")
    ?.addEventListener("click", startVoiceInput);
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
  const value = Array.isArray(raw) ? raw.join(field.key === "links" ? "\n" : ", ") : raw;
  const required = field.required ? " required autofocus" : "";
  const label = `<label for="field-${field.key}">${escapeHtml(field.label)}${field.required ? " *" : ""}</label>`;
  if (field.type === "textarea")
    return `<div class="field">${label}<textarea id="field-${field.key}" name="${field.key}">${escapeHtml(value)}</textarea></div>`;
  if (field.type === "select") {
    const options = ["", ...field.options];
    if (value && !options.includes(value)) options.push(value);
    return `<div class="field">${label}<select id="field-${field.key}" name="${field.key}">${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option || "—")}</option>`).join("")}</select></div>`;
  }
  return `<div class="field">${label}<input id="field-${field.key}" name="${field.key}" type="${field.type ?? "text"}" value="${escapeHtml(value)}"${required}${field.type === "url" ? ' placeholder="https://"' : ""}></div>`;
}

function openItemDialog(key, index = null) {
  const config = COLLECTIONS[key];
  const editingItem = index === null ? null : state.vault[key][index];
  const dialog = document.querySelector("#item-dialog");
  const content = document.querySelector("#dialog-content");
  content.innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">${config.title}</p><h2 id="dialog-title">${editingItem ? "Edit" : "New"} ${config.singular}</h2><p>Saved on this device. Sync when ready.</p></div><button class="dialog-close" type="button" aria-label="Close dialog">×</button></div><form class="item-form" novalidate><div class="form-row">${config.fields.map((field) => fieldHtml(field, editingItem ?? {})).join("")}</div><p class="form-help" id="form-feedback"></p><div class="form-footer"><button class="button button-quiet" id="cancel-edit" type="button">Cancel</button><button class="button button-primary" type="submit">${editingItem ? "Save" : "Create"}</button></div></form>`;
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
    if (key === "projects" || key === "skills")
      data.links = String(data.links || "").split(/\n/).map((link) => link.trim()).filter(Boolean);
    if (key === "docs")
      data.tags = data.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    if (editingItem) {
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
      `${config.singular[0].toUpperCase() + config.singular.slice(1)} ${editingItem ? "updated" : "added"}. Saved on this device${localStorage.getItem(TOKEN_KEY) ? "; save changes to sync with GitHub" : ""}.`,
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
      return `<article class="item"><div class="item-top"><h2 class="item-name">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(itemTitle(item))} ↗</a>` : escapeHtml(itemTitle(item))}</h2><div class="item-actions"><button class="button button-quiet" type="button" data-edit="${index}">Edit</button><button class="button button-danger" type="button" data-delete="${index}">Delete</button></div></div><div class="item-meta">${escapeHtml(item.created ? new Date(item.created).toLocaleDateString() : "")}${badges.length ? `<span>•</span>${badges.map((badge) => `<span class="badge" data-value="${escapeHtml(badge)}">${escapeHtml(badge)}</span>`).join("")}` : ""}</div>${item.notes ? `<p class="item-notes">${escapeHtml(item.notes)}</p>` : ""}</article>`;
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
  viewContainer.innerHTML = `${pageHeading(config.title, descriptions[key], `<button class="button button-primary" type="button" data-add="${key}">${icon("plus")} New ${config.singular}</button>`)}` + `<section class="panel"><div class="collection-toolbar"><input class="search-input" id="collection-search" type="search" placeholder="Search ${config.title.toLowerCase()}" value="${escapeHtml(ui.queries[key] ?? "")}"><select id="collection-filter"><option value="">All ${config.title.toLowerCase()}</option>${filterValues.map((option) => `<option value="${escapeHtml(option)}" ${ui.filters[key] === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select><select id="collection-sort"><option value="recent" ${ui.sorts[key] === "recent" || !ui.sorts[key] ? "selected" : ""}>Most recent</option><option value="name" ${ui.sorts[key] === "name" ? "selected" : ""}>Name</option></select></div><p class="results-count" id="results-count"></p><div id="collection-items"></div></section>`;
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
  viewContainer.innerHTML = `${pageHeading("Find your next thread.", "Search across your projects, skills, documents, and chats.")}<section class="panel" aria-label="Search results"><div class="panel-heading"><div><h2>Results</h2><p class="section-caption">${matches.length} match${matches.length === 1 ? "" : "es"}</p></div></div>${matches.length ? matches.map(({ key, config, item, index }) => openRecordButton(key, index, item, `${config.title} · ${formatTime(item.created) || "recent"}`)).join("") : emptyState("search", "No matches found", "Try another query or add something new.")}</section>`;
  bindWorkspaceActions();
}

const TASK_STATUS = ["Not Started", "Completed"];
const TASK_SCOPES = [
  ["today", "Today / 今日"],
  ["overdue", "Overdue / 逾期"],
  ["upcoming", "Upcoming / 即將到期"],
  ["monthly", "Monthly / 每月"],
  ["completed", "Completed / 已完成"],
];
ui.taskScope = ui.taskScope || "today";
ui.taskMonth = ui.taskMonth || hkDateKey().slice(0, 7);
ui.taskCompany = ui.taskCompany || "";
ui.taskStatus = ui.taskStatus || "";
ui.taskQuery = ui.taskQuery || "";

function hkDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftMonth(month, delta) {
  const [year, value] = String(month).split("-").map(Number);
  const date = new Date(Date.UTC(year || 2000, (value || 1) - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function addDateDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function taskMonths() {
  return [...new Set([hkDateKey().slice(0, 7), ...state.vault.tasks.map((task) => task.planningMonth)])]
    .filter(Boolean)
    .sort()
    .reverse();
}

function taskCounts() {
  const today = hkDateKey();
  const next = addDateDays(today, 7);
  const incomplete = state.vault.tasks.filter((task) => task.status !== "Completed");
  const monthTasks = state.vault.tasks.filter((task) => task.planningMonth === ui.taskMonth);
  return {
    today: incomplete.filter((task) => task.scheduledDate === today).length,
    overdue: incomplete.filter((task) => task.scheduledDate < today).length,
    upcoming: incomplete.filter((task) => task.scheduledDate > today && task.scheduledDate <= next).length,
    completed: monthTasks.filter((task) => task.status === "Completed").length,
    monthly: monthTasks.length,
  };
}

let lastReminderDate = "";
function refreshDailyReminder() {
  if (!state.vault) return;
  const today = hkDateKey();
  if (lastReminderDate === today) return;
  lastReminderDate = today;
  const counts = taskCounts();
  if (counts.today || counts.overdue) {
    setStatus(`Daily reminder / 每日提醒: ${counts.today} due today, ${counts.overdue} overdue.`, "warning");
  }
}

function renderTaskHomeWidget() {
  const today = hkDateKey();
  const incomplete = state.vault.tasks.filter((task) => task.status !== "Completed");
  const overdue = incomplete.filter((task) => task.scheduledDate < today).sort(taskSort).slice(0, 3);
  const dueToday = incomplete.filter((task) => task.scheduledDate === today).sort(taskSort).slice(0, 3);
  const items = [...overdue, ...dueToday];
  const label = overdue.length ? `${overdue.length} overdue · ${dueToday.length} due today` : `${dueToday.length} due today`;
  return `<section class="panel monthly-task-widget" aria-labelledby="monthly-task-widget-heading"><div class="panel-heading"><div><p class="eyebrow">DAILY WORKFLOW / 每日工作</p><h2 id="monthly-task-widget-heading">Monthly Task</h2><p class="section-caption">${escapeHtml(label)} · Asia/Hong_Kong</p></div><button class="text-button" type="button" data-task-home-scope="today">Open tasks ↗</button></div>${items.length ? `<div class="task-home-list">${items.map((task) => `<button class="task-home-row" type="button" data-task-home-id="${escapeHtml(task.id)}"><span class="task-status-dot ${task.scheduledDate < today ? "is-overdue" : ""}"></span><span>${escapeHtml(task.description)}</span><time>${escapeHtml(task.scheduledDate)}</time></button>`).join("")}</div>` : '<p class="voice-empty">No incomplete tasks due today or overdue.</p>'}</section>`;
}

function bindTaskHomeWidget() {
  viewContainer.querySelector("[data-task-home-scope]")?.addEventListener("click", () => {
    ui.taskScope = "today";
    navigate("tasks");
  });
  viewContainer.querySelectorAll("[data-task-home-id]").forEach((button) =>
    button.addEventListener("click", () => {
      const index = state.vault.tasks.findIndex((task) => task.id === button.dataset.taskHomeId);
      if (index >= 0) openTaskDialog(index);
    }),
  );
}

function taskSort(a, b) {
  return String(a.scheduledDate).localeCompare(String(b.scheduledDate)) ||
    String(a.company).localeCompare(String(b.company)) ||
    String(a.createdAt).localeCompare(String(b.createdAt)) ||
    String(a.id).localeCompare(String(b.id));
}

function filteredTasks() {
  const today = hkDateKey();
  const next = addDateDays(today, 7);
  const query = ui.taskQuery.trim().toLowerCase();
  return state.vault.tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => {
      if (ui.taskScope === "today" && !(task.status !== "Completed" && task.scheduledDate === today)) return false;
      if (ui.taskScope === "overdue" && !(task.status !== "Completed" && task.scheduledDate < today)) return false;
      if (ui.taskScope === "upcoming" && !(task.status !== "Completed" && task.scheduledDate > today && task.scheduledDate <= next)) return false;
      if (ui.taskScope === "monthly" && task.planningMonth !== ui.taskMonth) return false;
      if (ui.taskScope === "completed" && task.status !== "Completed") return false;
      if (ui.taskCompany && task.company !== ui.taskCompany) return false;
      if (ui.taskStatus && task.status !== ui.taskStatus) return false;
      if (query && !`${task.company} ${task.description} ${task.docResult}`.toLowerCase().includes(query)) return false;
      return true;
    })
    .sort(({ task: a }, { task: b }) => taskSort(a, b));
}

function taskRowHtml(task, today) {
  const overdue = task.status !== "Completed" && task.scheduledDate < today;
  const action = task.status === "Completed"
    ? `<button class="button button-quiet" type="button" data-task-reopen="${escapeHtml(task.id)}">Reopen / 重開</button>`
    : `<button class="button button-primary" type="button" data-task-complete="${escapeHtml(task.id)}">Complete / 完成</button>`;
  return `<article class="item task-row ${overdue ? "is-overdue" : ""} ${task.status === "Completed" ? "is-completed" : ""}"><div class="item-top"><div><p class="task-company">${escapeHtml(task.company)} · ${escapeHtml(task.planningMonth)}</p><h2 class="item-name">${escapeHtml(task.description)}</h2></div><div class="item-actions"><span class="badge task-date-badge">${overdue ? "Overdue / 逾期 · " : ""}${escapeHtml(task.scheduledDate)}</span><button class="button button-quiet" type="button" data-task-edit="${escapeHtml(task.id)}">Edit / 編輯</button></div></div><p class="task-status-text"><span class="task-status-dot ${overdue ? "is-overdue" : ""}"></span>${escapeHtml(task.status === "Completed" ? "Completed / 已完成" : "Not Started / 未開始")}${task.completedAt ? ` · ${escapeHtml(hkDateKey(task.completedAt))}` : ""}</p>${task.docResult ? `<p class="item-notes"><strong>Doc / Result:</strong><br>${escapeHtml(task.docResult).replaceAll("\n", "<br>")}</p>` : ""}<div class="task-row-actions">${action}<button class="button button-danger" type="button" data-task-delete="${escapeHtml(task.id)}">Delete / 刪除</button></div></article>`;
}

function renderTasks() {
  const counts = taskCounts();
  const companies = [...new Set(state.vault.tasks.map((task) => task.company).filter(Boolean))].sort();
  const today = hkDateKey();
  const rows = filteredTasks();
  viewContainer.innerHTML = `${pageHeading("Monthly Task / 工作任務", "Keep monthly work visible, date-safe, and easy to complete.", `<div class="task-header-actions"><button class="button button-primary" type="button" id="add-task">${icon("plus")} Add Task / 新增</button><button class="button" type="button" id="import-task">Import Excel / 匯入</button><input id="task-file" type="file" accept=".xlsx,.xls" hidden><button class="button" type="button" id="rollover-task">Create Next Month / 建立下月</button></div>`)}<section class="task-summary" aria-label="Task counts"><button type="button" data-task-scope="today"><strong>${counts.today}</strong><span>Today outstanding / 今日未完成</span></button><button type="button" data-task-scope="overdue"><strong>${counts.overdue}</strong><span>Overdue / 逾期</span></button><button type="button" data-task-scope="monthly"><strong>${counts.completed} / ${counts.monthly}</strong><span>Monthly completed / total</span></button></section><section class="panel task-panel"><div class="task-tabs" role="tablist" aria-label="Task views">${TASK_SCOPES.map(([key, label]) => `<button type="button" role="tab" aria-selected="${ui.taskScope === key}" class="${ui.taskScope === key ? "is-active" : ""}" data-task-scope="${key}">${label}</button>`).join("")}</div><div class="task-filters"><label>Month / 月<select id="task-month">${taskMonths().map((month) => `<option value="${month}" ${month === ui.taskMonth ? "selected" : ""}>${month}</option>`).join("")}</select></label><label>Company / 公司<select id="task-company"><option value="">All / 全部</option>${companies.map((company) => `<option value="${escapeHtml(company)}" ${company === ui.taskCompany ? "selected" : ""}>${escapeHtml(company)}</option>`).join("")}</select></label><label>Status / 狀態<select id="task-status"><option value="">All / 全部</option>${TASK_STATUS.map((status) => `<option value="${status}" ${status === ui.taskStatus ? "selected" : ""}>${status === "Completed" ? "Completed / 已完成" : "Not Started / 未開始"}</option>`).join("")}</select></label><label class="task-keyword">Keyword / 關鍵字<input id="task-query" type="search" placeholder="Search tasks…" value="${escapeHtml(ui.taskQuery)}"></label><div class="task-file-actions"><button class="button button-quiet" type="button" id="export-task-csv">Export CSV</button><button class="button button-quiet" type="button" id="backup-task-json">Backup JSON</button><button class="button button-quiet" type="button" id="restore-task-json">Restore JSON</button><input id="task-json-file" type="file" accept=".json" hidden></div></div><p class="results-count" role="status">${rows.length} task${rows.length === 1 ? "" : "s"} · ${escapeHtml(ui.taskScope)} · ${escapeHtml(today)} Hong Kong time</p><div class="task-list">${rows.length ? rows.map(({ task }) => taskRowHtml(task, today)).join("") : emptyState("tasks", "No tasks in this view", "Try another filter or import the NOV2026 workbook.")}</div></section>`;
  bindTaskActions();
}

function bindTaskActions() {
  viewContainer.querySelectorAll("[data-task-scope]").forEach((button) => button.addEventListener("click", () => { ui.taskScope = button.dataset.taskScope; renderTasks(); }));
  viewContainer.querySelector("#task-month")?.addEventListener("change", (event) => { ui.taskMonth = event.target.value; renderTasks(); });
  viewContainer.querySelector("#task-company")?.addEventListener("change", (event) => { ui.taskCompany = event.target.value; renderTasks(); });
  viewContainer.querySelector("#task-status")?.addEventListener("change", (event) => { ui.taskStatus = event.target.value; renderTasks(); });
  viewContainer.querySelector("#task-query")?.addEventListener("input", (event) => { ui.taskQuery = event.target.value; renderTasks(); });
  viewContainer.querySelector("#add-task")?.addEventListener("click", () => openTaskDialog());
  viewContainer.querySelector("#import-task")?.addEventListener("click", () => viewContainer.querySelector("#task-file").click());
  viewContainer.querySelector("#task-file")?.addEventListener("change", (event) => { const file = event.target.files?.[0]; if (file) importTaskWorkbook(file); event.target.value = ""; });
  viewContainer.querySelector("#rollover-task")?.addEventListener("click", openTaskRolloverPreview);
  viewContainer.querySelector("#export-task-csv")?.addEventListener("click", exportTasksCsv);
  viewContainer.querySelector("#backup-task-json")?.addEventListener("click", backupTasksJson);
  viewContainer.querySelector("#restore-task-json")?.addEventListener("click", () => viewContainer.querySelector("#task-json-file").click());
  viewContainer.querySelector("#task-json-file")?.addEventListener("change", (event) => { const file = event.target.files?.[0]; if (file) restoreTasksJson(file); event.target.value = ""; });
  viewContainer.querySelectorAll("[data-task-edit]").forEach((button) => button.addEventListener("click", () => openTaskDialog(state.vault.tasks.findIndex((task) => task.id === button.dataset.taskEdit))));
  viewContainer.querySelectorAll("[data-task-complete], [data-task-reopen]").forEach((button) => button.addEventListener("click", () => updateTaskStatus(button.dataset.taskComplete || button.dataset.taskReopen, Boolean(button.dataset.taskComplete))));
  viewContainer.querySelectorAll("[data-task-delete]").forEach((button) => button.addEventListener("click", () => deleteTask(button.dataset.taskDelete)));
}

function openTaskDialog(index = null, defaults = {}) {
  const editing = index !== null && index >= 0 ? state.vault.tasks[index] : null;
  const task = editing || { planningMonth: ui.taskMonth, scheduledDate: hkDateKey(), company: "OTHER", status: "Not Started", ...defaults };
  const dialog = document.querySelector("#item-dialog");
  const content = document.querySelector("#dialog-content");
  content.innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">MONTHLY TASK / 工作任務</p><h2 id="dialog-title">${editing ? "Edit task / 編輯任務" : "Add task / 新增任務"}</h2><p>Dates are date-only and calculated in Asia/Hong_Kong.</p></div><button class="dialog-close" type="button" aria-label="Close dialog">×</button></div><form class="item-form task-form"><div class="form-row"><div class="field"><label for="task-planning-month">Planning month / 計劃月份 *</label><input id="task-planning-month" name="planningMonth" type="month" value="${escapeHtml(task.planningMonth)}" required></div><div class="field"><label for="task-company-field">Company / 公司 *</label><input id="task-company-field" name="company" value="${escapeHtml(task.company)}" required></div><div class="field"><label for="task-date-field">Scheduled date / 排程日期 *</label><input id="task-date-field" name="scheduledDate" type="date" value="${escapeHtml(task.scheduledDate)}" required></div><div class="field"><label for="task-status-field">Status / 狀態</label><select id="task-status-field" name="status">${TASK_STATUS.map((status) => `<option value="${status}" ${task.status === status ? "selected" : ""}>${status === "Completed" ? "Completed / 已完成" : "Not Started / 未開始"}</option>`).join("")}</select></div><div class="field field-wide"><label for="task-description-field">Description / 任務描述 *</label><textarea id="task-description-field" name="description" required>${escapeHtml(task.description)}</textarea></div><div class="field field-wide"><label for="task-result-field">Doc / Result / 文件或結果</label><textarea id="task-result-field" name="docResult" placeholder="Files, references, amounts, notes, or results…">${escapeHtml(task.docResult)}</textarea></div></div><p class="form-help" id="task-form-feedback">Completion does not require an attachment.</p><div class="form-footer"><button class="button button-quiet" type="button" id="cancel-edit">Cancel / 取消</button><button class="button button-primary" type="submit">${editing ? "Save changes / 儲存" : "Create task / 建立"}</button></div></form>`;
  const form = content.querySelector("form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const feedback = content.querySelector("#task-form-feedback");
    data.company = String(data.company || "").trim();
    data.description = String(data.description || "").trim();
    if (!data.company || !data.description || !/^\d{4}-\d{2}$/.test(data.planningMonth) || !/^\d{4}-\d{2}-\d{2}$/.test(data.scheduledDate)) {
      feedback.textContent = "Company, description, planning month, and date are required.";
      feedback.dataset.kind = "error";
      return;
    }
    const now = new Date().toISOString();
    if (editing) {
      Object.assign(editing, data, { updatedAt: now });
      editing.completedAt = data.status === "Completed" ? editing.completedAt || now : null;
    } else {
      state.vault.tasks.push(normalizeTask({ ...data, id: uid(), createdAt: now, updatedAt: now, completedAt: data.status === "Completed" ? now : null }));
    }
    markDirty();
    dialog.close();
    render();
    setStatus(`Task ${editing ? "updated" : "created"}. Saved on this device.`, "success");
  });
  content.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  content.querySelector("#cancel-edit").addEventListener("click", () => dialog.close());
  dialog.showModal();
}

function updateTaskStatus(id, complete) {
  const task = state.vault.tasks.find((item) => item.id === id);
  if (!task) return;
  task.status = complete ? "Completed" : "Not Started";
  task.completedAt = complete ? new Date().toISOString() : null;
  task.updatedAt = new Date().toISOString();
  markDirty();
  render();
  setStatus(complete ? "Task completed locally." : "Task reopened locally; Doc / Result preserved.", "success");
}

function deleteTask(id) {
  const index = state.vault.tasks.findIndex((task) => task.id === id);
  if (index < 0) return;
  const task = state.vault.tasks[index];
  if (!window.confirm(`Delete “${task.description}”?`)) return;
  state.vault.tasks.splice(index, 1);
  markDirty();
  render();
  setStatus("Task deleted locally.", "success");
}

function parseTaskDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return hkDateKey(value);
  if (typeof value === "number" && Number.isFinite(value)) return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  const match = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/.exec(text);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function parsePlanningMonth(value, fallback = "") {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})[\/-](\d{1,2})$/.exec(text);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}` : fallback;
}

function importFingerprint(task) {
  const source = task.source || {};
  return [source.workbook, source.worksheet, source.row, task.company, task.description, task.scheduledDate].map((value) => String(value ?? "").trim().toLowerCase()).join("|");
}

async function importTaskWorkbook(file) {
  if (!globalThis.XLSX) {
    setStatus("Excel importer is unavailable. Reload the page and try again.", "error");
    return;
  }
  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true, cellNF: false, cellText: false });
    const worksheetName = "NOV2026";
    const sheet = workbook.Sheets[worksheetName];
    if (!sheet) throw new Error(`Worksheet ${worksheetName} was not found.`);
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
    const planningMonth = parsePlanningMonth(rows[0]?.[0], "2026-11");
    const batch = uid();
    const imported = [];
    const invalid = [];
    const ambiguous = [];
    for (let rowIndex = 1; rowIndex < Math.min(rows.length, 47); rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const company = String(row[0] ?? "").trim();
      const description = String(row[1] ?? "").trim();
      const scheduledDate = parseTaskDate(row[2]);
      const historicalStatus = String(row[3] ?? "").trim();
      if (!company && !description && !row[2] && !historicalStatus) continue;
      if (!company || !description || !scheduledDate) {
        invalid.push({ row: rowIndex + 1, reason: "Missing company, description, or valid date." });
        continue;
      }
      let status = "Not Started";
      let docResult = "";
      if (/^completed\b/i.test(historicalStatus)) status = "Completed";
      else if (/^(not\s*started|pending)\b/i.test(historicalStatus)) status = "Not Started";
      else if (historicalStatus) {
        ambiguous.push({ row: rowIndex + 1, value: historicalStatus });
        docResult = historicalStatus;
      }
      imported.push(normalizeTask({ id: uid(), planningMonth, company, description, scheduledDate, status, docResult, completedAt: status === "Completed" ? new Date().toISOString() : null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: { workbook: file.name, worksheet: worksheetName, row: rowIndex + 1, importBatch: batch } }));
    }
    const existing = new Map(state.vault.tasks.map((task) => [importFingerprint(task), task]));
    const duplicates = imported.filter((task) => existing.has(importFingerprint(task)) && JSON.stringify({ company: existing.get(importFingerprint(task)).company, description: existing.get(importFingerprint(task)).description, scheduledDate: existing.get(importFingerprint(task)).scheduledDate }) === JSON.stringify({ company: task.company, description: task.description, scheduledDate: task.scheduledDate }));
    const conflicts = imported.filter((task) => existing.has(importFingerprint(task)) && !duplicates.includes(task));
    openTaskImportPreview({ file, planningMonth, imported, duplicates, conflicts, invalid, ambiguous });
  } catch (error) {
    setStatus(`Excel import failed: ${error.message}`, "error");
  }
}

function openTaskImportPreview(result) {
  const dialog = document.querySelector("#item-dialog");
  const content = document.querySelector("#dialog-content");
  const previewRows = result.imported.slice(0, 12).map((task) => `<tr><td>${escapeHtml(task.company)}</td><td>${escapeHtml(task.description)}</td><td>${escapeHtml(task.scheduledDate)}</td><td>${escapeHtml(task.status)}</td></tr>`).join("");
  content.innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">IMPORT PREVIEW / 匯入預覽</p><h2 id="dialog-title">${escapeHtml(result.file.name)}</h2><p>${result.imported.length} rows mapped from NOV2026. Rows 50–55 are not imported.</p></div><button class="dialog-close" type="button" aria-label="Close dialog">×</button></div><div class="import-summary"><span>New: <strong>${result.imported.length - result.duplicates.length}</strong></span><span>Exact duplicates: <strong>${result.duplicates.length}</strong></span><span>Invalid: <strong>${result.invalid.length}</strong></span><span>Ambiguous status: <strong>${result.ambiguous.length}</strong></span></div>${result.ambiguous.length ? `<p class="form-help" data-kind="warning">Ambiguous status text is preserved in Doc / Result and imported as Not Started for review.</p>` : ""}${result.invalid.length ? `<p class="form-help" data-kind="error">Skipped rows: ${result.invalid.map((item) => `${item.row} (${escapeHtml(item.reason)})`).join(", ")}</p>` : ""}<div class="import-table-wrap"><table class="import-table"><thead><tr><th>Company</th><th>Description</th><th>Date</th><th>Status</th></tr></thead><tbody>${previewRows}</tbody></table></div><p class="form-help">Exact re-imports will not duplicate tasks. Existing saved results and completion statuses are never overwritten.</p><div class="form-footer"><button class="button button-quiet" type="button" id="cancel-edit">Cancel / 取消</button><button class="button button-primary" type="button" id="confirm-task-import">Import ${result.imported.length - result.duplicates.length} new tasks</button></div>`;
  content.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  content.querySelector("#cancel-edit").addEventListener("click", () => dialog.close());
  content.querySelector("#confirm-task-import").addEventListener("click", () => {
    const duplicateFingerprints = new Set(result.duplicates.map(importFingerprint));
    const existingFingerprints = new Set(state.vault.tasks.map(importFingerprint));
    const toAdd = result.imported.filter((task) => !duplicateFingerprints.has(importFingerprint(task)) && !existingFingerprints.has(importFingerprint(task)));
    state.vault.tasks.push(...toAdd);
    if (toAdd.length) markDirty();
    ui.taskMonth = result.planningMonth;
    ui.taskScope = "monthly";
    dialog.close();
    render();
    setStatus(`${toAdd.length} tasks imported locally. Review them before saving to GitHub.`, "success");
  });
  dialog.showModal();
}

function openTaskRolloverPreview() {
  const sourceMonth = ui.taskMonth;
  const targetMonth = shiftMonth(sourceMonth, 1);
  const candidates = state.vault.tasks.filter((task) => task.planningMonth === sourceMonth && task.status !== "Completed");
  const dialog = document.querySelector("#item-dialog");
  const content = document.querySelector("#dialog-content");
  content.innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">MONTHLY ROLLOVER / 每月延續</p><h2 id="dialog-title">${escapeHtml(sourceMonth)} → ${escapeHtml(targetMonth)}</h2><p>Select recurring unfinished tasks. New tasks reset to Not Started and clear Doc / Result. Weekend dates move forward; Hong Kong holiday coverage is not verified.</p></div><button class="dialog-close" type="button" aria-label="Close dialog">×</button></div><div class="rollover-list">${candidates.length ? candidates.map((task) => `<label><input type="checkbox" name="rollover" value="${escapeHtml(task.id)}" checked><span><strong>${escapeHtml(task.company)}</strong> ${escapeHtml(task.description)}<small>${escapeHtml(task.scheduledDate)} → ${escapeHtml(rolloverDate(task.scheduledDate, targetMonth))}</small></span></label>`).join("") : '<p class="voice-empty">No unfinished tasks are available for rollover.</p>'}</div><div class="form-footer"><button class="button button-quiet" type="button" id="cancel-edit">Cancel / 取消</button><button class="button button-primary" type="button" id="confirm-rollover" ${candidates.length ? "" : "disabled"}>Create selected tasks</button></div>`;
  content.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  content.querySelector("#cancel-edit").addEventListener("click", () => dialog.close());
  content.querySelector("#confirm-rollover").addEventListener("click", () => {
    const selected = [...content.querySelectorAll("input[name=rollover]:checked")].map((input) => input.value);
    const existingCarry = new Set(state.vault.tasks.map((task) => `${task.carriedFromTaskId || ""}|${task.planningMonth}`));
    const now = new Date().toISOString();
    const additions = candidates.filter((task) => selected.includes(task.id) && !existingCarry.has(`${task.id}|${targetMonth}`)).map((task) => normalizeTask({ id: uid(), planningMonth: targetMonth, company: task.company, description: task.description, scheduledDate: rolloverDate(task.scheduledDate, targetMonth), status: "Not Started", docResult: "", createdAt: now, updatedAt: now, carriedFromTaskId: task.id, source: { rolloverFrom: sourceMonth, rolloverTo: targetMonth, holidayCoverage: "unverified" } }));
    state.vault.tasks.push(...additions);
    if (additions.length) markDirty();
    dialog.close();
    render();
    setStatus(`${additions.length} next-month tasks created locally. Review dates before saving.`, "success");
  });
  dialog.showModal();
}

function rolloverDate(dateKey, targetMonth) {
  const [, month, day] = String(dateKey).split("-").map(Number);
  const [year, target] = targetMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, target, 0)).getUTCDate();
  const date = new Date(Date.UTC(year, target - 1, Math.min(day || 1, lastDay)));
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function downloadText(filename, text, type = "text/plain") {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function exportTasksCsv() {
  const headers = ["id", "planningMonth", "company", "description", "scheduledDate", "status", "docResult", "completedAt", "createdAt", "updatedAt"];
  const csv = [headers, ...state.vault.tasks.map((task) => headers.map((header) => `"${String(task[header] ?? "").replaceAll('"', '""')}"`))].map((row) => row.join(",")).join("\r\n");
  downloadText(`myvault-monthly-tasks-${hkDateKey()}.csv`, csv, "text/csv;charset=utf-8");
}

function backupTasksJson() {
  downloadText(`myvault-tasks-backup-${hkDateKey()}.json`, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tasks: state.vault.tasks }, null, 2), "application/json");
}

async function restoreTasksJson(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const tasks = Array.isArray(parsed) ? parsed : parsed.tasks;
    if (!Array.isArray(tasks)) throw new Error("Backup does not contain a tasks array.");
    if (!window.confirm(`Restore ${tasks.length} tasks? Existing task records will be replaced.`)) return;
    state.vault.tasks = tasks.map(normalizeTask);
    markDirty();
    render();
    setStatus(`${tasks.length} tasks restored locally.`, "success");
  } catch (error) {
    setStatus(`Task restore failed: ${error.message}`, "error");
  }
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
  for (const key of ["skills", "projects", "docs", "cards", "chats", "tasks"]) {
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
let constellationRequest = 0;
const CONSTELLATION_COLLECTIONS = ["projects", "skills"];

function normalizeTags(value) {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((tag) => tag.trim());
  return list.filter(Boolean).map((tag) => String(tag).toLowerCase());
}

function constellationAlias(value) {
  return String(value ?? "")
    .split("|")[0]
    .split("/")
    .pop()
    .split("#")[0]
    .replace(/\.md$/i, "")
    .replace(/^(skill|project|reference)\s*[:\-–—]\s*/i, "")
    .normalize("NFKD")
    .replace(/[^a-z0-9\p{L}]+/giu, " ")
    .trim()
    .toLowerCase();
}

function buildConstellationModel() {
  const nodes = CONSTELLATION_COLLECTIONS.flatMap((kind) =>
    state.vault[kind].map((item, index) => {
      const name = itemTitle(item);
      const id = String(item.id || `missing-${index}`);
      const description = String(item.notes ?? "").replace(/^#+\s*/gm, "").trim();
      const meta = kind === "projects"
        ? String(item.status || "Project")
        : String(item.level || "Skill");
      return {
        key: `${kind === "projects" ? "project" : "skill"}:${id}`,
        id,
        kind,
        name,
        meta,
        description: description.slice(0, 320),
        links: Array.isArray(item.links) ? item.links : [],
        safeName: escapeHtml(name),
        safeMeta: escapeHtml(meta),
        safeDescription: escapeHtml(description.slice(0, 320)),
      };
    }),
  );
  const aliases = new Map();
  nodes.forEach((node, index) => {
    const values = [node.name, constellationAlias(node.name)];
    values.forEach((value) => {
      const alias = constellationAlias(value);
      if (alias && !aliases.has(alias)) aliases.set(alias, index);
    });
  });
  const edges = [];
  const edgeKeys = new Set();
  nodes.forEach((node, source) => {
    node.links.forEach((link) => {
      const target = aliases.get(constellationAlias(link));
      if (target === undefined || target === source) return;
      const edgeKey = `${Math.min(source, target)}:${Math.max(source, target)}`;
      if (edgeKeys.has(edgeKey)) return;
      edgeKeys.add(edgeKey);
      edges.push({ source, target });
    });
  });
  return { nodes, edges };
}

async function updateConstellationBackground() {
  const container = document.querySelector("#constellation-background");
  if (!container || !state.vault) return;
  const dataKey = JSON.stringify(
    CONSTELLATION_COLLECTIONS.flatMap((kind) =>
      state.vault[kind].map((item) => [
        kind,
        item.id ?? "",
        itemTitle(item),
        item.status ?? item.level ?? "",
        item.notes ?? "",
        item.links ?? [],
      ]),
    ),
  );
  if (dataKey === constellationDataKey) return;
  constellationDataKey = dataKey;
  constellationCleanup?.();
  constellationCleanup = null;
  const request = ++constellationRequest;
  const model = buildConstellationModel();
  try {
    const { createMyVaultConstellation } = await import("./constellation.mjs?v=3");
    if (request !== constellationRequest) return;
    const constellation = createMyVaultConstellation({
      container,
      ...model,
      onNavigate: navigate,
      onCreate(kind) {
        navigate(kind);
        openItemDialog(kind);
      },
      onOpen(node) {
        const index = state.vault[node.kind].findIndex(
          (item) => String(item.id || "") === node.id,
        );
        if (index < 0) {
          setStatus("That vault record is no longer available.", "error");
          return;
        }
        navigate(node.kind);
        openItemDialog(node.kind, index);
      },
    });
    constellationCleanup = () => constellation.dispose();
  } catch (error) {
    console.error("Constellation could not start", error);
    container.innerHTML = '<p class="constellation-load-error">The interactive constellation is unavailable. Open Projects or Skills from the side control.</p>';
  }
}

async function updateLegacyConstellationBackground() {
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
    skills: "#cfe6ff",
    projects: "#ffd9a8",
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
  renderer.domElement.classList.add("constellation-canvas");
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const starSystem = new THREE.Group();
  scene.add(starSystem);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 600);
  camera.position.set(0, 6, 56);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;

  const glowTexture = (() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.3, "rgba(255,255,255,1)");
    gradient.addColorStop(0.6, "rgba(255,255,255,0.55)");
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
          size: 0.7,
          map: dotTexture,
          color: 0x93a7c9,
          transparent: true,
          opacity: 0.65,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
  }

  const magnitudeOf = (node) => {
    if (node.tags.length >= 3) return 0;
    if (node.tags.length >= 1) return 1;
    return 2;
  };
  const magnitudeSize = [6.5, 4.5, 3.0];
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
        color: 0xbdd6ff,
        transparent: true,
        opacity: 0.6,
      }),
    ),
  );

  const gridMaterial = new THREE.LineBasicMaterial({
    color: 0x5d7cae,
    transparent: true,
    opacity: 0.3,
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
    for (const plane of ["xz", "tilt1", "tilt2", "xy"]) {
      const geometry = makeRing(plane === "xy" ? "xy" : "xz");
      if (plane === "tilt1") geometry.rotateX(Math.PI / 3);
      if (plane === "tilt2") geometry.rotateX(-Math.PI / 3);
      if (plane === "xy") geometry.rotateY(Math.PI / 2.6);
      gridGeometries.push(geometry);
      starSystem.add(new THREE.LineLoop(geometry, gridMaterial));
    }
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

  const labelSprites = nodes.map((node, nodeIndex) => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 80;
    const ctx = canvas.getContext("2d");
    ctx.font = "600 34px Georgia, 'Times New Roman', serif";
    ctx.textAlign = "left";
    ctx.fillStyle = KIND_LABEL_COLOR[node.kind];
    ctx.shadowColor = "rgba(2,6,18,0.95)";
    ctx.shadowBlur = 8;
    ctx.fillText(node.label.slice(0, 30), 8, 52);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        opacity: 1,
        depthTest: false,
      }),
    );
    sprite.scale.set(11, 1.6, 1);
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
window.addEventListener("focus", () => {
  if (!state.vault) return;
  const before = lastReminderDate;
  refreshDailyReminder();
  if (before && before !== lastReminderDate) render();
});

if (localStorage.getItem(TOKEN_KEY)) {
  loginButton.textContent = "Sign out";
}

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
  refreshDailyReminder();
} else if (localStorage.getItem(TOKEN_KEY)) {
  loadVault();
} else {
  state.vault = structuredClone(DEFAULT_VAULT);
  render();
  setStatus(
    "New local vault started. Sign in with GitHub to sync it to your myvault-data repo.",
  );
  refreshDailyReminder();
}
