import {
  TASK_FIELDS,
  previewOperations,
  applySelectedOperations,
  validateReply,
} from "./momo-contract.mjs";

const DUE_PROMPT =
  "List the Monthly Tasks due today and the ones that are overtime. Do not change anything.";

function hongKongLabel(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} HKT`;
}

export function createMomoController(app) {
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
    steps: [],
    quota: null,
    undo: null,
  };
  return {
    memory,
    async send(message, { retry = false } = {}) {
      if (memory.busy) return;
      if (!app.isSignedIn()) throw Error("Sign in with GitHub to use MOMO.");
      const baseline = structuredClone(app.getVault());
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
      memory.steps = [];
      const request = new AbortController();
      const timeout = setTimeout(() => request.abort(), 35000);
      try {
        const result = validateReply(
          await app.call(
            "momo",
            { message, history: prior, vault: { tasks: baseline.tasks ?? [] } },
            { signal: request.signal },
          ),
          baseline,
        );
        memory.history.push({ role: "assistant", content: result.message });
        memory.steps = result.steps;
        memory.quota = result.quota ?? null;
        memory.pending = result.operations.length ? result.operations : null;
        memory.baseline = baseline;
        memory.selected = new Set(result.operations.map((_, index) => index));
        return result;
      } catch (error) {
        memory.error = {
          message: request.signal.aborted
            ? "MOMO timed out. Please retry."
            : error.message || "MOMO could not complete this request.",
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
        "MOMO changes applied locally. Save changes to sync with GitHub.",
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
        "MOMO changes applied locally. Save changes to sync with GitHub.";
    },
    undo() {
      if (!memory.undo) throw Error("There are no MOMO changes to undo.");
      if (
        app.getRevision() !== memory.undo.revision ||
        JSON.stringify(app.getVault()) !== memory.undo.after
      )
        throw Error(
          "The vault changed after Apply. Undo is unavailable to protect newer edits.",
        );
      app.applyLocalVault(
        structuredClone(memory.undo.before),
        "MOMO changes undone locally. Save changes to sync with GitHub.",
      );
      memory.undo = null;
      memory.notice =
        "MOMO changes undone locally. Save changes to sync with GitHub.";
    },
  };
}

export function mountMomoPanel(app, document) {
  const trigger = document.querySelector("#ask-momo");
  if (!trigger) return;
  const panel = document.createElement("dialog");
  panel.id = "momo-panel";
  panel.className = "qwen-panel";
  panel.setAttribute("aria-labelledby", "momo-title");
  panel.setAttribute("aria-modal", "true");
  panel.innerHTML = `<div class="qwen-shell"><header class="qwen-heading"><div><p class="eyebrow">Monthly Task assistant</p><h2 id="momo-title">Ask MOMO</h2></div><button class="dialog-close" id="momo-close" type="button" aria-label="Close MOMO">×</button></header><p class="qwen-intro">MOMO reads your Monthly Tasks only, including unsaved changes. She can list what is due and what is overtime, then propose a completion at the Hong Kong time you name. Nothing changes until you confirm. Press Save changes to sync with GitHub. MOMO 只讀取 Monthly Task。她可列出今日與逾期，並按你說的香港時間提出完成。確認後按 Save changes 才會同步 GitHub。</p><div class="qwen-scroll" id="momo-scroll"><div id="momo-conversation" role="log" aria-label="MOMO conversation" aria-live="polite" aria-relevant="additions text"></div><div id="momo-feedback" role="status" aria-live="polite"></div><div id="momo-quota" role="status"></div><div id="momo-proposals"></div></div><form class="qwen-composer" id="momo-form"><label for="momo-message">Message MOMO</label><textarea id="momo-message" rows="3" maxlength="4000" placeholder="Mark Weekly Exchange Report completed yesterday at 9:16am…" required></textarea><div class="qwen-composer-actions"><button class="button" id="momo-due" type="button">Due and overdue / 今日與逾期</button><span>Conversation stays in memory.</span><button class="button button-primary" type="submit" id="momo-send">Send</button></div></form></div>`;
  document.body.append(panel);
  const controller = createMomoController(app);
  const memory = controller.memory;
  const escape = app.escapeHtml;
  const history = panel.querySelector("#momo-conversation");
  const feedback = panel.querySelector("#momo-feedback");
  const quota = panel.querySelector("#momo-quota");
  const proposals = panel.querySelector("#momo-proposals");
  const input = panel.querySelector("#momo-message");
  const send = panel.querySelector("#momo-send");
  const form = panel.querySelector("#momo-form");
  const displayValue = (value) => {
    const labelled = hongKongLabel(value);
    if (labelled) return labelled;
    return value === null || value === undefined
      ? "(not set)"
      : typeof value === "string"
        ? value || "(empty)"
        : JSON.stringify(value);
  };
  let retryReadyAt = 0;
  let retryTimer;

  function renderPanel() {
    const available = app.isSignedIn() && Boolean(app.getVault());
    history.innerHTML =
      (memory.history.length
        ? memory.history
            .map(
              (turn) =>
                `<article class="qwen-turn" data-role="${turn.role}"><h3>${turn.role === "user" ? "You" : "MOMO"}</h3><p>${escape(turn.content)}</p></article>`,
            )
            .join("")
        : `<div class="empty-state"><strong>Due, overtime, and the morning you finished</strong><p>Ask which tasks are due or overtime, or tell MOMO a task was finished at a Hong Kong time. She proposes the change. You confirm it.</p></div>`) +
      memory.steps
        .map(
          (step) =>
            `<article class="qwen-turn" data-role="tool"><h3>MOMO searched tasks</h3><p>“${escape(step.query)}” — ${step.matches} match${step.matches === 1 ? "" : "es"}</p></article>`,
        )
        .join("");
    quota.innerHTML = memory.quota
      ? `<p${memory.quota.used >= memory.quota.limit * 0.8 ? ' data-warn="true"' : ""}>Tokens this month: ${memory.quota.used.toLocaleString()} / ${memory.quota.limit.toLocaleString()}</p>`
      : "";
    history.setAttribute("aria-busy", String(memory.busy));
    send.disabled = memory.busy || !available || Date.now() < retryReadyAt;
    input.disabled = memory.busy || !available;
    panel.querySelector("#momo-due").disabled = memory.busy || !available || Date.now() < retryReadyAt;
    send.textContent = memory.busy ? "Thinking…" : Date.now() < retryReadyAt ? "Wait to retry" : "Send";
    feedback.dataset.kind = memory.error ? "error" : "";
    const unavailable = ["AI_UNAVAILABLE", "AI_FORBIDDEN", "AI_AUTH_REQUIRED"].includes(memory.error?.code);
    feedback.innerHTML = !available
      ? `<p>MOMO is unavailable until you sign in with GitHub and load your vault.</p>`
      : memory.busy
        ? `<p>MOMO is thinking. Your tasks are unchanged.</p>`
        : memory.error
          ? `<p>${unavailable ? "Assistant unavailable. " : ""}${escape(memory.error.message)}</p><button class="button" id="momo-retry" type="button" ${Date.now() < retryReadyAt ? "disabled" : ""}>Retry</button>`
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
        feedback.textContent = "This proposal is no longer valid. Ask MOMO again.";
        return;
      }
      proposals.innerHTML = `<section aria-labelledby="momo-proposal-title"><h3 id="momo-proposal-title">Proposed changes</h3><p class="form-help">Nothing has changed yet. Choose the tasks to update. GitHub updates when you press Save changes.</p>${previews
        .map((operation, index) => {
          const rows =
            operation.type === "create"
              ? TASK_FIELDS.filter((field) => field in operation.fields).map((field) => ({
                  field,
                  after: operation.fields[field],
                }))
              : operation.changes;
          return `<article class="qwen-operation"><label class="qwen-choice"><input type="checkbox" data-operation="${index}" ${memory.selected.has(index) ? "checked" : ""}><strong>${operation.type === "create" ? "Create" : "Update"} task</strong></label>${operation.id ? `<p class="form-help">ID: ${escape(operation.id)}</p>` : '<p class="form-help">ID and creation time will be assigned locally on Apply.</p>'}<dl class="qwen-diff">${rows
            .map(
              (change) =>
                `<div><dt>${escape(change.field)}</dt>${operation.type === "update" ? `<dd class="qwen-before"><span>Before</span><pre>${escape(displayValue(change.before))}</pre></dd>` : ""}<dd class="qwen-after">${operation.type === "update" ? "<span>After</span>" : ""}<pre>${escape(displayValue(change.after))}</pre></dd></div>`,
            )
            .join("")}</dl></article>`;
        })
        .join("")}<label class="qwen-confirm"><input id="momo-confirm" type="checkbox" ${memory.confirmed ? "checked" : ""}>I confirm applying the selected changes to my local tasks.</label><div class="actions"><button class="button button-primary" type="button" id="momo-apply" ${!memory.confirmed || !memory.selected.size ? "disabled" : ""}>Apply selected</button><button class="button" type="button" id="momo-discard">Discard</button></div></section>`;
    }
    if (memory.undo)
      proposals.insertAdjacentHTML(
        "beforeend",
        '<button class="button qwen-undo" id="momo-undo" type="button">Undo last MOMO apply</button>',
      );
    panel.querySelectorAll("[data-operation]").forEach((box) =>
      box.addEventListener("change", () => {
        const index = Number(box.dataset.operation);
        box.checked ? memory.selected.add(index) : memory.selected.delete(index);
        memory.confirmed = false;
        panel.querySelector("#momo-confirm").checked = false;
        panel.querySelector("#momo-apply").disabled = true;
      }),
    );
    panel.querySelector("#momo-confirm")?.addEventListener("change", (event) => {
      memory.confirmed = event.target.checked;
      panel.querySelector("#momo-apply").disabled = !memory.confirmed || !memory.selected.size;
    });
    for (const [id, action] of [
      ["momo-apply", () => controller.apply()],
      ["momo-discard", () => controller.discard()],
      ["momo-undo", () => controller.undo()],
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
    panel.querySelector("#momo-retry")?.addEventListener("click", () => submit(memory.lastPrompt, true));
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
      retryReadyAt = Date.now() + Math.min(300, Math.max(0, error.retryAfter || 0)) * 1000;
      clearTimeout(retryTimer);
      if (retryReadyAt > Date.now()) retryTimer = setTimeout(renderPanel, retryReadyAt - Date.now());
    }
    renderPanel();
    if (panel.open && !input.disabled) input.focus();
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(input.value.trim());
  });
  panel.querySelector("#momo-due").addEventListener("click", () => {
    input.value = DUE_PROMPT;
    submit(DUE_PROMPT);
  });
  trigger.addEventListener("click", () => {
    renderPanel();
    panel.showModal();
    if (!input.disabled) input.focus();
  });
  panel.querySelector("#momo-close").addEventListener("click", () => panel.close());
  panel.addEventListener("close", () => trigger.focus());
  return controller;
}

if (typeof document !== "undefined" && globalThis.myVaultAIBridge)
  mountMomoPanel(globalThis.myVaultAIBridge, document);
