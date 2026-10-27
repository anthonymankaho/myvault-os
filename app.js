const API = "https://myvault-api.anthonymankaho.workers.dev";
const CLIENT_ID = "07d9227164fae9cb21baff428915cd9ccb46d20c";
const TOKEN_KEY = "myvault_token";
const STATE_KEY = "myvault_oauth_state";

const statusMessage = document.querySelector("#status");
const editor = document.querySelector("#vault-editor");
const counts = {
  skills: document.querySelector("#skills-count"),
  projects: document.querySelector("#projects-count"),
  docs: document.querySelector("#docs-count"),
  chats: document.querySelector("#chats-count")
};

function setStatus(message, kind = "") {
  statusMessage.textContent = message;
  statusMessage.dataset.kind = kind;
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

function updateCounts(vault) {
  for (const [key, element] of Object.entries(counts)) {
    element.textContent = Array.isArray(vault[key]) ? vault[key].length : 0;
  }
}

async function loadVault() {
  setStatus("Loading vault…");

  try {
    const result = await call("load");
    const vault = result.vault ?? result.data ?? result;
    editor.value = JSON.stringify(vault, null, 2);
    updateCounts(vault);
    setStatus("Vault loaded.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function saveVault() {
  let vault;

  try {
    vault = JSON.parse(editor.value);
  } catch {
    setStatus("Vault data must be valid JSON before it can be saved.", "error");
    return;
  }

  setStatus("Saving vault…");

  try {
    await call("save", { vault });
    updateCounts(vault);
    setStatus("Vault saved.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function startLogin() {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(24)), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
  authorizationUrl.searchParams.set("client_id", CLIENT_ID);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("scope", "repo");
  authorizationUrl.searchParams.set("state", state);
  localStorage.setItem(STATE_KEY, state);

  const popup = window.open(authorizationUrl, "myvault-oauth", "width=600,height=720");
  if (!popup) {
    setStatus("Allow popups to sign in with GitHub.", "error");
    return;
  }
  setStatus("Complete sign-in in the GitHub popup.");
}

async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code || !window.opener) {
    return;
  }

  const state = params.get("state");
  if (!state || state !== localStorage.getItem(STATE_KEY)) {
    window.opener.postMessage({ type: "myvault-oauth", error: "GitHub sign-in state did not match." }, window.location.origin);
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
    window.opener.postMessage({ type: "myvault-oauth", error: error.message }, window.location.origin);
  }

  window.close();
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
    const transcript = event.results[0][0].transcript;
    try {
      const vault = JSON.parse(editor.value);
      vault.meta = vault.meta && typeof vault.meta === "object" ? vault.meta : {};
      vault.meta.voiceNotes = Array.isArray(vault.meta.voiceNotes) ? vault.meta.voiceNotes : [];
      vault.meta.voiceNotes.push(transcript);
      editor.value = JSON.stringify(vault, null, 2);
      setStatus("Voice note added to the vault. Save to keep it.", "success");
    } catch {
      setStatus("Fix the vault JSON before adding a voice note.", "error");
    }
  };
  recognition.onerror = () => setStatus("Voice input could not be completed.", "error");
  recognition.start();
}

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.removeAttribute("aria-current"));
    link.setAttribute("aria-current", "page");
    document.querySelector("#view-title").textContent = link.dataset.view;
  });
});

document.querySelector("#login-button").addEventListener("click", startLogin);
document.querySelector("#load-button").addEventListener("click", loadVault);
document.querySelector("#save-button").addEventListener("click", saveVault);
document.querySelector("#voice-button").addEventListener("click", startVoiceInput);

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.data?.type !== "myvault-oauth") {
    return;
  }
  if (event.data.error) {
    setStatus(event.data.error, "error");
    return;
  }
  setStatus("Signed in with GitHub.", "success");
  loadVault();
});

handleOAuthCallback();

if (localStorage.getItem(TOKEN_KEY)) {
  document.querySelector("#login-button").textContent = "GitHub connected";
  loadVault();
}
