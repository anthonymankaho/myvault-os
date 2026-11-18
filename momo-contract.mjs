// Shared by the browser and Worker. No credentials or provider configuration.
// MOMO sees Monthly Tasks only. Chats, documents, and other notes stay out.
export const TASK_FIELDS = Object.freeze([
  "description",
  "company",
  "planningMonth",
  "scheduledDate",
  "status",
  "docResult",
  "completedAt",
]);
export const TASK_STATUSES = Object.freeze(["Not Started", "Completed"]);
export const MAX_OPERATIONS = 12;
export const MAX_TOOL_STEPS = 6;
export const MAX_SEARCH_RESULTS = 10;
export const MAX_TASKS = 200;
const SEARCH_RESULT_PREVIEW = 300;
const COMPACT_RESULT_LIMIT = 800;
const FUTURE_SLACK_MS = 26 * 60 * 60 * 1000;
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const monthPattern = /^\d{4}-\d{2}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message) => {
  throw new Error(message);
};
export const validId = (value) =>
  typeof value === "string" && idPattern.test(value);

function exactKeys(value, allowed, label) {
  if (!object(value)) fail(`${label} must be an object.`);
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail(`Unknown ${label.toLowerCase()} field.`);
}

export function canonicalCompletedAt(value, now = Date.now()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value))
    fail("Invalid completedAt.");
  const time = Date.parse(value);
  if (!Number.isFinite(time)) fail("Invalid completedAt.");
  if (time > now + FUTURE_SLACK_MS)
    fail("Completion time cannot be more than a day in the future.");
  return new Date(time).toISOString();
}

export function validateTaskFields(fields, { create = false, current = null } = {}) {
  exactKeys(fields, TASK_FIELDS, "Item");
  if (!Object.keys(fields).length) fail("An operation must contain fields.");
  if (create && !("description" in fields)) fail("description is required for a create.");
  const clean = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === "completedAt") continue;
    if (key === "status") {
      if (!TASK_STATUSES.includes(value)) fail("Invalid task status.");
      clean.status = value;
      continue;
    }
    const max = key === "docResult" ? 8000 : key === "description" ? 500 : 80;
    if (typeof value !== "string" || value.length > max) fail(`Invalid ${key}.`);
    if (key === "description" && !value.trim()) fail("description cannot be empty.");
    if (key === "company" && !value.trim()) fail("company cannot be empty.");
    if (key === "planningMonth" && !monthPattern.test(value))
      fail("Invalid planningMonth.");
    if (key === "scheduledDate" && !datePattern.test(value))
      fail("Invalid scheduledDate.");
    clean[key] = key === "description" || key === "company" ? value.trim() : value;
  }
  if (create) {
    for (const key of ["company", "planningMonth", "scheduledDate", "status"]) {
      if (!(key in clean)) fail(`${key} is required for a create.`);
    }
    if (!("docResult" in clean)) clean.docResult = "";
  }
  const status = clean.status ?? current?.status;
  if (clean.status === "Not Started") clean.completedAt = null;
  else if ("completedAt" in fields) {
    clean.completedAt =
      fields.completedAt === null ? null : canonicalCompletedAt(fields.completedAt);
  }
  if (status === "Completed" && clean.status === "Completed" && clean.completedAt == null)
    fail("completedAt is required when marking a task completed.");
  if (status === "Completed" && clean.completedAt === null)
    fail("completedAt is required when marking a task completed.");
  if (status !== "Completed" && clean.completedAt)
    fail("Set status to Completed when recording a completion time.");
  return clean;
}

function projectTask(item) {
  if (!object(item)) fail("Invalid context item.");
  const projected = {};
  if (validId(item.id)) projected.id = item.id;
  for (const field of TASK_FIELDS) {
    const value = item[field];
    if (field === "completedAt") {
      if (typeof value === "string" && value) projected.completedAt = value.slice(0, 40);
      else if (value === null) projected.completedAt = null;
      continue;
    }
    if (typeof value !== "string") continue;
    projected[field] = value.slice(
      0,
      field === "docResult" ? COMPACT_RESULT_LIMIT : field === "description" ? 500 : 80,
    );
  }
  if (!projected.status) projected.status = "Not Started";
  return projected;
}

export function prepareTasks(tasks) {
  if (!Array.isArray(tasks)) fail("Tasks must be a list.");
  const open = [];
  const done = [];
  for (const item of tasks) {
    const projected = projectTask(item);
    if (projected.status === "Completed") done.push(projected);
    else open.push(projected);
  }
  done.sort((a, b) =>
    String(b.completedAt || "").localeCompare(String(a.completedAt || "")),
  );
  const ordered = [...open, ...done];
  return {
    tasks: ordered.slice(0, MAX_TASKS),
    total: tasks.length,
    omitted: Math.max(0, ordered.length - MAX_TASKS),
  };
}

export function validateOperations(operations, vault) {
  if (!Array.isArray(operations) || operations.length > MAX_OPERATIONS)
    fail("Invalid or excessive operations.");
  const tasks = Array.isArray(vault?.tasks) ? vault.tasks : [];
  const targets = new Set();
  return operations.map((operation) => {
    exactKeys(operation, ["type", "collection", "id", "fields"], "Operation");
    const { type, collection, id } = operation;
    if (type !== "create" && type !== "update")
      fail("Only create and update operations are allowed.");
    if (collection !== "tasks") fail("MOMO can only change Monthly Tasks.");
    let current = null;
    if (type === "create" && Object.hasOwn(operation, "id"))
      fail("Create IDs are assigned locally.");
    if (type === "update") {
      if (!validId(id)) fail("Invalid update ID.");
      const matches = tasks.filter((item) => item?.id === id);
      if (matches.length !== 1) fail("Update target is missing or ambiguous.");
      current = matches[0];
      if (targets.has(id)) fail("Duplicate update target.");
      targets.add(id);
    }
    const fields = validateTaskFields(operation.fields, {
      create: type === "create",
      current,
    });
    return { type, collection, ...(type === "update" ? { id } : {}), fields };
  });
}

export function validateRequest(payload) {
  exactKeys(payload, ["message", "history", "vault"], "Request");
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 120000)
    fail("AI request is too large.");
  if (
    typeof payload.message !== "string" ||
    !payload.message.trim() ||
    payload.message.length > 4000
  )
    fail("Message must contain 1–4000 characters.");
  const history = payload.history ?? [];
  if (!Array.isArray(history) || history.length > 12)
    fail("Conversation history is too long.");
  let characters = 0;
  for (const turn of history) {
    exactKeys(turn, ["role", "content"], "History");
    if (
      !["user", "assistant"].includes(turn.role) ||
      typeof turn.content !== "string" ||
      turn.content.length > 2000
    )
      fail("Invalid conversation history.");
    characters += turn.content.length;
  }
  if (characters > 12000) fail("Conversation history is too large.");
  exactKeys(payload.vault, ["tasks"], "Vault");
  const prepared = prepareTasks(payload.vault.tasks);
  return {
    message: payload.message.trim(),
    history,
    vault: { tasks: prepared.tasks },
    total: prepared.total,
    omitted: prepared.omitted,
  };
}

export function searchTasks(compact, query) {
  if (typeof query !== "string" || !query.trim() || query.length > 200)
    fail("Invalid search query.");
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = [];
  for (const item of compact.tasks ?? []) {
    const haystack = [
      item.id ?? "",
      item.description ?? "",
      item.company ?? "",
      item.planningMonth ?? "",
      item.scheduledDate ?? "",
      item.status ?? "",
      item.completedAt ?? "",
      item.docResult ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) continue;
    const match = { collection: "tasks" };
    if (validId(item.id)) match.id = item.id;
    for (const field of TASK_FIELDS) {
      if (!(field in item)) continue;
      match[field] =
        field === "docResult" && typeof item[field] === "string"
          ? item[field].slice(0, SEARCH_RESULT_PREVIEW)
          : item[field];
    }
    matches.push(match);
    if (matches.length >= MAX_SEARCH_RESULTS) break;
  }
  return matches;
}

export function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length > MAX_TOOL_STEPS)
    fail("Invalid assistant steps.");
  return steps.map((step) => {
    exactKeys(step, ["tool", "query", "matches"], "Step");
    if (step.tool !== "vault_search") fail("Unknown assistant tool.");
    if (
      typeof step.query !== "string" ||
      !step.query.trim() ||
      step.query.length > 200
    )
      fail("Invalid step query.");
    if (
      !Number.isInteger(step.matches) ||
      step.matches < 0 ||
      step.matches > MAX_SEARCH_RESULTS
    )
      fail("Invalid step match count.");
    return { tool: step.tool, query: step.query, matches: step.matches };
  });
}

export function validateQuota(quota) {
  if (quota === undefined || quota === null) return undefined;
  exactKeys(quota, ["used", "limit"], "Quota");
  if (!Number.isInteger(quota.used) || quota.used < 0)
    fail("Invalid quota usage.");
  if (!Number.isInteger(quota.limit) || quota.limit < 1)
    fail("Invalid quota limit.");
  return { used: quota.used, limit: quota.limit };
}

export function validateReply(reply, vault) {
  exactKeys(reply, ["message", "operations", "steps", "quota"], "Reply");
  if (
    typeof reply.message !== "string" ||
    !reply.message.trim() ||
    reply.message.length > 8000
  )
    fail("Invalid assistant message.");
  return {
    message: reply.message,
    operations: validateOperations(reply.operations ?? [], vault),
    steps: reply.steps === undefined ? [] : validateSteps(reply.steps),
    quota: validateQuota(reply.quota),
  };
}

export function previewOperations(operations, vault) {
  return validateOperations(operations, vault).map((operation) => {
    const previous =
      operation.type === "update"
        ? vault.tasks.find((item) => item.id === operation.id)
        : null;
    return {
      ...operation,
      changes: Object.entries(operation.fields).map(([field, value]) => ({
        field,
        before: previous?.[field] ?? null,
        after: value,
      })),
    };
  });
}

export function applySelectedOperations(
  vault,
  operations,
  selected,
  { uid, now = new Date().toISOString(), baseline = vault } = {},
) {
  const validated = validateOperations(operations, vault);
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    new Set(selected).size !== selected.length ||
    selected.some(
      (index) =>
        !Number.isInteger(index) || index < 0 || index >= validated.length,
    )
  )
    fail("Select valid operations to apply.");
  for (const index of selected) {
    const op = validated[index];
    if (op.type !== "update") continue;
    const before = baseline.tasks?.find((item) => item.id === op.id);
    const current = vault.tasks?.find((item) => item.id === op.id);
    if (
      !before ||
      !current ||
      Object.keys(op.fields).some(
        (key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(current[key] ?? null),
      )
    )
      fail("A target changed since the preview. Ask MOMO again before applying.");
  }
  const next = structuredClone(vault);
  next.tasks ??= [];
  for (const index of selected) {
    const op = validated[index];
    if (op.type === "create") {
      const id = uid();
      if (!validId(id) || next.tasks.some((item) => item.id === id))
        fail("Could not assign a unique item ID.");
      next.tasks.unshift({
        id,
        createdAt: now,
        updatedAt: now,
        recurring: false,
        ...op.fields,
      });
    } else {
      const target = next.tasks.find((item) => item.id === op.id);
      Object.assign(target, op.fields, { updatedAt: now });
    }
  }
  return next;
}
