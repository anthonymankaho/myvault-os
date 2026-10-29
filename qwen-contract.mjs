// Shared by the browser and Worker. No credentials or provider configuration.
export const COLLECTION_FIELDS = Object.freeze({
  projects: ["name", "status", "notes"],
  skills: ["name", "level", "notes"],
  docs: ["title", "url", "tags", "notes"],
  chats: ["title", "url", "notes"],
});
export const PROJECT_STATUSES = [
  "Idea",
  "Active",
  "Paused",
  "Done",
  "Archived",
];
export const SKILL_LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"];
export const MAX_OPERATIONS = 12;
const MAX_ITEMS = 200;
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
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

export function validateFields(collection, fields, { create = false } = {}) {
  if (!Object.hasOwn(COLLECTION_FIELDS, collection))
    fail("Unknown collection.");
  const allowed = COLLECTION_FIELDS[collection];
  exactKeys(fields, allowed, "Item");
  if (!Object.keys(fields).length) fail("An operation must contain fields.");
  const nameKey = allowed.includes("name") ? "name" : "title";
  if (create && !(nameKey in fields))
    fail(`${nameKey} is required for a create.`);
  const clean = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === "tags") {
      if (
        !Array.isArray(value) ||
        value.length > 20 ||
        value.some(
          (tag) => typeof tag !== "string" || !tag.trim() || tag.length > 60,
        )
      )
        fail("Invalid tags.");
      clean.tags = [...new Set(value.map((tag) => tag.trim()))];
      continue;
    }
    const max = key === "notes" ? 8000 : key === "url" ? 2048 : 200;
    if (typeof value !== "string" || value.length > max)
      fail(`Invalid ${key}.`);
    if (key === nameKey && !value.trim()) fail(`${nameKey} cannot be empty.`);
    if (key === "status" && !PROJECT_STATUSES.includes(value))
      fail("Invalid project status.");
    if (key === "level" && !SKILL_LEVELS.includes(value))
      fail("Invalid skill level.");
    if (key === "url" && value) {
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        fail("Invalid URL.");
      }
      if (
        !["https:", "http:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        /[\u0000-\u0020\u007f]/.test(value)
      )
        fail("Unsafe URL.");
    }
    clean[key] = value;
  }
  return clean;
}

export function validateOperations(operations, vault) {
  if (!Array.isArray(operations) || operations.length > MAX_OPERATIONS)
    fail("Invalid or excessive operations.");
  const targets = new Set();
  return operations.map((operation) => {
    exactKeys(operation, ["type", "collection", "id", "fields"], "Operation");
    const { type, collection, id } = operation;
    if (type !== "create" && type !== "update")
      fail("Only create and update operations are allowed.");
    if (!Object.hasOwn(COLLECTION_FIELDS, collection))
      fail("Unknown collection.");
    if (type === "create" && Object.hasOwn(operation, "id"))
      fail("Create IDs are assigned locally.");
    if (type === "update") {
      if (!validId(id)) fail("Invalid update ID.");
      const matches = (vault?.[collection] ?? []).filter(
        (item) => item.id === id,
      );
      if (matches.length !== 1) fail("Update target is missing or ambiguous.");
      const target = `${collection}:${id}`;
      if (targets.has(target)) fail("Duplicate update target.");
      targets.add(target);
    }
    const fields = validateFields(collection, operation.fields, {
      create: type === "create",
    });
    return { type, collection, ...(type === "update" ? { id } : {}), fields };
  });
}

export function compactVault(vault) {
  const compact = {};
  for (const [key, fields] of Object.entries(COLLECTION_FIELDS)) {
    const items = vault?.[key] ?? [];
    if (!Array.isArray(items) || items.length > MAX_ITEMS)
      fail("Vault exceeds the AI context limit of 200 items per collection.");
    compact[key] = items.map((item) => {
      if (!object(item)) fail("Invalid context item.");
      const projected = {};
      if (validId(item.id)) projected.id = item.id;
      for (const field of fields) {
        const value = item[field];
        if (field === "tags" && Array.isArray(value))
          projected.tags = value
            .filter((tag) => typeof tag === "string")
            .slice(0, 20)
            .map((tag) => tag.slice(0, 60));
        else if (typeof value === "string")
          projected[field] = value.slice(
            0,
            field === "notes" ? 1200 : field === "url" ? 2048 : 200,
          );
      }
      return projected;
    });
  }
  return compact;
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
  exactKeys(payload.vault, Object.keys(COLLECTION_FIELDS), "Vault");
  return {
    message: payload.message.trim(),
    history,
    vault: compactVault(payload.vault),
  };
}

export function validateReply(reply, vault) {
  exactKeys(reply, ["message", "operations"], "Reply");
  if (
    typeof reply.message !== "string" ||
    !reply.message.trim() ||
    reply.message.length > 8000
  )
    fail("Invalid assistant message.");
  return {
    message: reply.message,
    operations: validateOperations(reply.operations, vault),
  };
}

export function previewOperations(operations, vault) {
  return validateOperations(operations, vault).map((operation) => {
    const previous =
      operation.type === "update"
        ? vault[operation.collection].find((item) => item.id === operation.id)
        : null;
    return {
      ...operation,
      changes: Object.entries(operation.fields).map(([field, value]) => ({
        field,
        before: previous?.[field] ?? null,
        after: structuredClone(value),
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
  // Validate the entire batch and every selected baseline before changing a copy.
  for (const index of selected) {
    const op = validated[index];
    if (op.type !== "update") continue;
    const before = baseline[op.collection]?.find((item) => item.id === op.id);
    const current = vault[op.collection]?.find((item) => item.id === op.id);
    if (
      !before ||
      Object.keys(op.fields).some(
        (key) => JSON.stringify(before[key]) !== JSON.stringify(current[key]),
      )
    )
      fail(
        "A target changed since the preview. Ask Qwen again before applying.",
      );
  }
  const next = structuredClone(vault);
  for (const index of selected) {
    const op = validated[index];
    if (op.type === "create") {
      const id = uid();
      if (
        !validId(id) ||
        Object.keys(COLLECTION_FIELDS).some((key) =>
          (next[key] ?? []).some((item) => item.id === id),
        )
      )
        fail("Could not assign a unique item ID.");
      next[op.collection] ??= [];
      next[op.collection].unshift({ id, created: now, ...op.fields });
    } else {
      const target = next[op.collection].find((item) => item.id === op.id);
      Object.assign(target, op.fields);
    }
  }
  return next;
}
