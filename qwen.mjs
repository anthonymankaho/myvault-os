import {
  COLLECTION_FIELDS,
  compactVault,
  validateReply,
  previewOperations,
  applySelectedOperations,
} from "./qwen-contract.mjs";

export function createQwenController(app) {
  const memory = {
    history: [],
    busy: false,
    pending: null,
    baseline: null,
    selected: new Set(),
    confirmed: false,
    error: null,
    notice: "",
    lastPrompt: "",
    undo: null,
  };
  return {
    memory,
    async send(message, { retry = false } = {}) {
      if (memory.busy) return;
      if (!app.isSignedIn()) throw Error("Sign in with GitHub to use Qwen.");
      memory.pending = null;
      memory.confirmed = false;
      memory.lastPrompt = message;
      const baseline = structuredClone(app.getVault());
      const vault = compactVault(baseline);
      const replacing =
        retry &&
        memory.history.at(-1)?.role === "user" &&
        memory.history.at(-1)?.content === message;
      const prior = (replacing ? memory.history.slice(0, -1) : memory.history)
        .slice(-6)
        .map((turn) => ({
          role: turn.role,
          content: turn.content.slice(0, 2000),
        }));
      if (!replacing) memory.history.push({ role: "user", content: message });
      memory.history = memory.history.slice(-24);
      memory.busy = true;
      memory.error = null;
      memory.notice = "";
      memory.pending = null;
      memory.confirmed = false;
      memory.lastPrompt = message;
      const request = new AbortController();
      const timeout = setTimeout(() => request.abort(), 35000);
      try {
        const result = validateReply(
          await app.call(
            "qwen",
            { message, history: prior, vault },
            { signal: request.signal },
          ),
          baseline,
        );
        memory.history.push({ role: "assistant", content: result.message });
        memory.pending = result.operations.length ? result.operations : null;
        memory.baseline = baseline;
        memory.selected = new Set(result.operations.map((_, index) => index));
        return result;
      } catch (error) {
        memory.error = {
          message: request.signal.aborted ? "Qwen timed out. Please retry." : error.message || "Qwen could not complete this request.",
          code: request.signal.aborted ? "AI_TIMEOUT" : error.code,
          status: error.status,
          retryAfter: error.retryAfter || 0,
        };
        throw error;
      } finally {
        clearTimeout(timeout);
        memory.busy = false;
      }
    },
    discard() {
      memory.pending = null;
      memory.selected.clear();
      memory.confirmed = false;
      memory.notice = "Suggestions discarded. No changes were made.";
    },
    apply() {
      if (!memory.confirmed || !memory.pending)
        throw Error("Confirm the selected local changes first.");
      const before = structuredClone(app.getVault());
      const next = applySelectedOperations(
        before,
        memory.pending,
        [...memory.selected],
        { uid: app.uid, baseline: memory.baseline },
      );
      app.applyLocalVault(
        next,
        "AI changes applied locally. Save changes to sync with GitHub.",
      );
      memory.undo = {
        before,
        after: JSON.stringify(app.getVault()),
        revision: app.getRevision(),
      };
      memory.pending = null;
      memory.selected.clear();
      memory.confirmed = false;
      memory.notice =
        "AI changes applied locally. Save changes to sync with GitHub.";
    },
    undo() {
      if (!memory.undo) throw Error("There are no AI changes to undo.");
      if (
        app.getRevision() !== memory.undo.revision ||
        JSON.stringify(app.getVault()) !== memory.undo.after
      )
        throw Error(
          "The vault changed after Apply. Undo is unavailable to protect newer edits.",
        );
      app.applyLocalVault(
        structuredClone(memory.undo.before),
        "AI changes undone locally. Save changes to sync with GitHub.",
      );
      memory.undo = null;
      memory.notice =
        "AI changes undone locally. Save changes to sync with GitHub.";
    },
  };
}

export function mountQwenPanel(app, document) {
  const trigger = document.querySelector("#ask-qwen");
  if (!trigger) return;
  const panel = document.createElement("dialog");
  panel.id = "qwen-panel";
  panel.className = "qwen-panel";
  panel.setAttribute("aria-labelledby", "qwen-title");
  panel.setAttribute("aria-modal", "true");
  panel.innerHTML = `<div class="qwen-shell"><header class="qwen-heading"><div><p class="eyebrow">Your workspace assistant</p><h2 id="qwen-title">Ask Qwen</h2></div><button class="dialog-close" id="qwen-close" type="button" aria-label="Close Qwen">×</button></header><p class="qwen-intro">Uses a compact copy of your current local vault, including unsaved changes. Review suggestions before applying. Changes sync only when you save.</p><div class="qwen-scroll" id="qwen-scroll"><div id="qwen-conversation" role="log" aria-label="Qwen conversation" aria-live="polite" aria-relevant="additions text"></div><div id="qwen-feedback" role="status" aria-live="polite"></div><div id="qwen-proposals"></div></div><form class="qwen-composer" id="qwen-form"><label for="qwen-message">Message Qwen</label><textarea id="qwen-message" rows="3" maxlength="4000" placeholder="Help me plan a project, organize notes, or update a skill…" required></textarea><div class="qwen-composer-actions"><span>Conversation stays in memory.</span><button class="button button-primary" type="submit" id="qwen-send">Send</button></div></form></div>`;
  document.body.append(panel);
  const controller = createQwenController(app),
    memory = controller.memory;
  const escape = app.escapeHtml;
  const history = panel.querySelector("#qwen-conversation");
  const feedback = panel.querySelector("#qwen-feedback");
  const proposals = panel.querySelector("#qwen-proposals");
  const input = panel.querySelector("#qwen-message");
  const send = panel.querySelector("#qwen-send");
  const form = panel.querySelector("#qwen-form");
  const displayValue = (value) =>
    value === null || value === undefined
      ? "(not set)"
      : typeof value === "string"
        ? value || "(empty)"
        : JSON.stringify(value);
  let retryReadyAt = 0;
  let retryTimer;

  function renderPanel() {
    const available = app.isSignedIn() && Boolean(app.getVault());
    history.innerHTML = memory.history.length
      ? memory.history
          .map(
            (turn) =>
              `<article class="qwen-turn" data-role="${turn.role}"><h3>${turn.role === "user" ? "You" : "Qwen"}</h3><p>${escape(turn.content)}</p></article>`,
          )
          .join("")
      : `<div class="empty-state"><strong>A second pair of eyes for your vault</strong><p>Ask a question or describe a change. Qwen will propose it for your review.</p></div>`;
    history.setAttribute("aria-busy", String(memory.busy));
    send.disabled = memory.busy || !available || Date.now() < retryReadyAt;
    input.disabled = memory.busy || !available;
    send.textContent = memory.busy ? "Thinking…" : Date.now() < retryReadyAt ? "Wait to retry" : "Send";
    feedback.dataset.kind = memory.error ? "error" : "";
    const unavailable = [
      "AI_UNAVAILABLE",
      "AI_FORBIDDEN",
      "AI_AUTH_REQUIRED",
    ].includes(memory.error?.code);
    feedback.innerHTML = !available
      ? `<p>Qwen is unavailable until you sign in with GitHub and load your vault.</p>`
      : memory.busy
        ? `<p>Qwen is thinking. Your vault is unchanged.</p>`
        : memory.error
          ? `<p>${unavailable ? "Assistant unavailable. " : ""}${escape(memory.error.message)}</p><button class="button" id="qwen-retry" type="button" ${Date.now() < retryReadyAt ? "disabled" : ""}>Retry</button>`
          : memory.notice
            ? `<p>${escape(memory.notice)}</p>`
            : "";
    proposals.innerHTML = "";
    if (memory.pending) {
      let previews;
      try {
        previews = previewOperations(memory.pending, memory.baseline);
      } catch {
        memory.pending = null;
        feedback.textContent =
          "This proposal is no longer valid. Ask Qwen again.";
        return;
      }
      proposals.innerHTML = `<section aria-labelledby="qwen-proposal-title"><h3 id="qwen-proposal-title">Proposed changes</h3><p class="form-help">Nothing has changed yet. Choose the operations to apply.</p>${previews.map((operation, index) => `<article class="qwen-operation"><label class="qwen-choice"><input type="checkbox" data-operation="${index}" ${memory.selected.has(index) ? "checked" : ""}><strong>${operation.type === "create" ? "Create" : "Update"} ${escape(operation.collection)}</strong></label>${operation.id ? `<p class="form-help">ID: ${escape(operation.id)}</p>` : '<p class="form-help">ID and creation time will be assigned locally on Apply.</p>'}<dl class="qwen-diff">${(operation.type === "create" ? COLLECTION_FIELDS[operation.collection].map((field) => ({ field, after: operation.fields[field] })) : operation.changes).map((change) => `<div><dt>${escape(change.field)}</dt>${operation.type === "update" ? `<dd class="qwen-before"><span>Before</span><pre>${escape(displayValue(change.before))}</pre></dd>` : ""}<dd class="qwen-after">${operation.type === "update" ? "<span>After</span>" : ""}<pre>${escape(displayValue(change.after))}</pre></dd></div>`).join("")}</dl></article>`).join("")}<label class="qwen-confirm"><input id="qwen-confirm" type="checkbox" ${memory.confirmed ? "checked" : ""}>I confirm applying the selected changes to my local vault.</label><div class="actions"><button class="button button-primary" type="button" id="qwen-apply" ${!memory.confirmed || !memory.selected.size ? "disabled" : ""}>Apply selected</button><button class="button" type="button" id="qwen-discard">Discard</button></div></section>`;
    }
    if (memory.undo)
      proposals.insertAdjacentHTML(
        "beforeend",
        '<button class="button qwen-undo" id="qwen-undo" type="button">Undo last AI apply</button>',
      );
    panel.querySelectorAll("[data-operation]").forEach((box) =>
      box.addEventListener("change", () => {
        const index = Number(box.dataset.operation);
        box.checked
          ? memory.selected.add(index)
          : memory.selected.delete(index);
        memory.confirmed = false;
        panel.querySelector("#qwen-confirm").checked = false;
        panel.querySelector("#qwen-apply").disabled = true;
      }),
    );
    panel
      .querySelector("#qwen-confirm")
      ?.addEventListener("change", (event) => {
        memory.confirmed = event.target.checked;
        panel.querySelector("#qwen-apply").disabled =
          !memory.confirmed || !memory.selected.size;
      });
    for (const [id, action] of [
      ["qwen-apply", () => controller.apply()],
      ["qwen-discard", () => controller.discard()],
      ["qwen-undo", () => controller.undo()],
    ])
      panel.querySelector(`#${id}`)?.addEventListener("click", () => {
        try {
          action();
          memory.error = null;
        } catch (error) {
          memory.error = { message: error.message };
        }
        renderPanel();
        if (!input.disabled) input.focus();
      });
    panel
      .querySelector("#qwen-retry")
      ?.addEventListener("click", () => submit(memory.lastPrompt, true));
  }

  async function submit(message, retry = false) {
    if (memory.busy || !message.trim() || Date.now() < retryReadyAt) return;
    let pending;
    memory.lastPrompt = message;
    try {
      pending = controller.send(message, { retry });
    } catch (error) {
      memory.error = { message: error.message };
      renderPanel();
      return;
    }
    renderPanel();
    try {
      await pending;
      input.value = "";
    } catch (error) {
      if (!memory.error) memory.error = { message: error.message };
      retryReadyAt =
        Date.now() + Math.min(300, Math.max(0, error.retryAfter || 0)) * 1000;
      clearTimeout(retryTimer);
      if (retryReadyAt > Date.now())
        retryTimer = setTimeout(renderPanel, retryReadyAt - Date.now());
    }
    renderPanel();
    if (panel.open && !input.disabled) input.focus();
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(input.value.trim());
  });
  trigger.addEventListener("click", () => {
    renderPanel();
    panel.showModal();
    if (!input.disabled) input.focus();
  });
  panel
    .querySelector("#qwen-close")
    .addEventListener("click", () => panel.close());
  panel.addEventListener("close", () => trigger.focus());
  return controller;
}

if (typeof document !== "undefined" && globalThis.myVaultAIBridge)
  mountQwenPanel(globalThis.myVaultAIBridge, document);
