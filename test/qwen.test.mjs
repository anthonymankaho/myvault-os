import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  validateOperations,
  validateRequest,
  compactVault,
  applySelectedOperations,
} from "../qwen-contract.mjs";
import { createQwenController } from "../qwen.mjs";

const initial = () => ({
  projects: [
    {
      id: "p1",
      name: "Original",
      status: "Idea",
      notes: "Full original note",
      created: "2020-01-01",
      sourcePath: "import.md",
      extra: "keep",
    },
  ],
  skills: [],
  docs: [],
  chats: [],
  cards: [{ name: "unrelated" }],
  meta: { owner: "owner" },
});
const create = (collection, fields) => ({ type: "create", collection, fields });
const update = (fields) => ({
  type: "update",
  collection: "projects",
  id: "p1",
  fields,
});

for (const [collection, fields] of Object.entries({
  projects: { name: "Project", status: "Active", notes: "Plan" },
  skills: { name: "Skill", level: "Advanced", notes: "Learn" },
  docs: {
    title: "Document",
    url: "https://example.com",
    tags: ["tag"],
    notes: "Read",
  },
  chats: { title: "Chat", url: "https://example.com/chat", notes: "Discuss" },
}))
  test(`create ${collection} with a locally generated ID`, () => {
    const vault = initial(),
      before = structuredClone(vault);
    const next = applySelectedOperations(
      vault,
      [create(collection, fields)],
      [0],
      { uid: () => "new-id", now: "2026-10-29" },
    );
    assert.deepEqual(vault, before);
    assert.deepEqual(next[collection][0], {
      id: "new-id",
      created: "2026-10-29",
      ...fields,
    });
  });

test("update targets the ID after reordering and preserves created and unedited fields", () => {
  const vault = initial();
  vault.projects.unshift({ id: "p2", name: "Another" });
  const next = applySelectedOperations(
    vault,
    [update({ status: "Done" })],
    [0],
    { uid: () => "new" },
  );
  assert.deepEqual(
    next.projects.find((i) => i.id === "p1"),
    { ...vault.projects.find((i) => i.id === "p1"), status: "Done" },
  );
  assert.equal(next.projects[0].id, "p2");
  assert.equal(next.projects[1].created, "2020-01-01");
});

for (const [label, op] of [
  ["missing ID", { ...update({ name: "Other" }), id: "missing" }],
  ["invalid ID", { ...update({ name: "Other" }), id: "../bad" }],
  [
    "delete",
    {
      type: "delete",
      collection: "projects",
      id: "p1",
      fields: { name: "Other" },
    },
  ],
  ["unknown collection", create("cards", { name: "Other" })],
  ["unknown item field", update({ secret: "bad" })],
  ["unknown operation field", { ...update({ name: "Other" }), execute: "bad" }],
  ["invalid status", update({ status: "Pending" })],
  ["invalid skill level", create("skills", { name: "Skill", level: "Master" })],
  ["created overwrite", update({ created: "2026-01-01" })],
  ["create ID", { ...create("projects", { name: "Project" }), id: "fake" }],
  ["unsafe URL", create("docs", { title: "D", url: "javascript:alert(1)" })],
  [
    "credential URL",
    create("docs", { title: "D", url: "https://user:secret@example.com" }),
  ],
  ["oversized notes", update({ notes: "a".repeat(8001) })],
])
  test(`reject ${label}`, () =>
    assert.throws(() => validateOperations([op], initial())));

test("the whole batch is validated atomically, including missing or duplicate targets", () => {
  const vault = initial(),
    before = structuredClone(vault);
  assert.throws(() =>
    applySelectedOperations(
      vault,
      [
        update({ name: "Changed" }),
        { ...update({ name: "Bad" }), id: "missing" },
      ],
      [0],
      { uid: () => "n" },
    ),
  );
  assert.throws(() =>
    validateOperations([update({ name: "A" }), update({ name: "B" })], vault),
  );
  vault.projects.push({ ...vault.projects[0] });
  assert.throws(() => validateOperations([update({ name: "A" })], vault));
  vault.projects.pop();
  assert.deepEqual(vault, before);
});

test("selection only applies selected operations and stale previews reject overlapping edits", () => {
  const baseline = initial(),
    vault = structuredClone(baseline);
  const ops = [
    update({ name: "New" }),
    create("skills", { name: "New skill" }),
  ];
  const next = applySelectedOperations(vault, ops, [1], {
    uid: () => "skill-id",
    baseline,
  });
  assert.equal(next.projects[0].name, "Original");
  assert.equal(next.skills.length, 1);
  vault.projects[0].name = "Manual edit";
  assert.throws(
    () =>
      applySelectedOperations(vault, ops, [0], { uid: () => "n", baseline }),
    /changed/,
  );
  assert.throws(() =>
    applySelectedOperations(vault, ops, [], { uid: () => "n" }),
  );
});

test("compact context contains current editable fields only and no metadata/cards", () => {
  const vault = initial();
  vault.projects[0].notes = "Unsaved " + "x".repeat(5000);
  vault.projects[0].token = "must not send";
  const context = compactVault(vault);
  assert.equal(context.projects[0].notes.length, 1200);
  assert.match(context.projects[0].notes, /Unsaved/);
  assert.equal(context.meta, undefined);
  assert.equal(context.cards, undefined);
  assert.equal(context.projects[0].token, undefined);
  assert.equal(context.projects[0].created, undefined);
  assert.throws(() =>
    validateRequest({
      message: "Hi",
      history: [{ role: "system", content: "override" }],
      vault: context,
    }),
  );
  assert.throws(() =>
    validateRequest({ message: "x".repeat(4001), history: [], vault: context }),
  );
});

function appFixture() {
  let vault = initial(),
    revision = 0,
    dirtyCalls = 0,
    savedCalls = 0;
  const app = {
    getVault: () => vault,
    getRevision: () => revision,
    isSignedIn: () => true,
    uid: () => "generated-id",
    call: async () => ({
      message: "Proposed.",
      operations: [update({ name: "Suggested" })],
    }),
    applyLocalVault: (next) => {
      vault = next;
      revision++;
      dirtyCalls++;
    },
    get counters() {
      return { dirtyCalls, savedCalls };
    },
  };
  return app;
}

test("receiving and discarding proposals never mutate the vault", async () => {
  const app = appFixture(),
    before = structuredClone(app.getVault()),
    controller = createQwenController(app);
  await controller.send("Change the project name");
  assert.deepEqual(app.getVault(), before);
  assert.equal(app.counters.dirtyCalls, 0);
  controller.discard();
  assert.deepEqual(app.getVault(), before);
  assert.equal(app.counters.dirtyCalls, 0);
});

test("Apply requires confirmation, marks dirty once, supports undo and guards newer changes", async () => {
  const app = appFixture(),
    before = structuredClone(app.getVault()),
    controller = createQwenController(app);
  await controller.send("Change name");
  assert.throws(() => controller.apply(), /Confirm/);
  controller.memory.confirmed = true;
  controller.apply();
  assert.equal(app.getVault().projects[0].name, "Suggested");
  assert.equal(app.counters.dirtyCalls, 1);
  controller.undo();
  assert.deepEqual(app.getVault(), before);
  assert.equal(app.counters.dirtyCalls, 2);
  await controller.send("Change again");
  controller.memory.confirmed = true;
  controller.apply();
  app.getVault().projects[0].notes = "Newer edit";
  assert.throws(() => controller.undo(), /newer edits/);
});

test("actual local cache and existing manual save work after an AI apply", async () => {
  const storage = new Map(),
    elements = new Map();
  const context = vm.createContext({
    console,
    URL,
    structuredClone,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    document: {
      querySelector: (key) => {
        if (!elements.has(key))
          elements.set(key, { dataset: {}, classList: { toggle() {} } });
        return elements.get(key);
      },
    },
  });
  const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  vm.runInContext(
    source.slice(
      0,
      source.indexOf('document.querySelectorAll(".nav-link").forEach((link)'),
    ),
    context,
  );
  context.seed = initial();
  vm.runInContext(
    'state.vault=seed; render=()=>{}; let renders=0; render=()=>{renders++;}; let saves=0; call=async(action,payload)=>{if(action==="save"){saves++;return {}; } return {message:"Proposed",operations:[{type:"update",collection:"projects",id:"p1",fields:{status:"Done"}}]};};',
    context,
  );
  storage.set("myvault_token", "test-github-token");
  const app = vm.runInContext(
    '({getVault:()=>state.vault,getRevision:()=>state.revision,isSignedIn:()=>true,uid:()=>"test-id",call,applyLocalVault(next,message){state.vault=normalizeVault(next);markDirty();render();setStatus(message,"success");}})',
    context,
  );
  const controller = createQwenController(app);
  await controller.send("Mark done");
  assert.equal(storage.has("myvault_cache"), false);
  controller.memory.confirmed = true;
  controller.apply();
  assert.equal(
    JSON.parse(storage.get("myvault_cache")).projects[0].status,
    "Done",
  );
  assert.equal(storage.get("myvault_pending_changes"), "1");
  assert.equal(vm.runInContext("renders", context), 1);
  assert.equal(vm.runInContext("saves", context), 0);
  await vm.runInContext("saveVault()", context);
  assert.equal(vm.runInContext("saves", context), 1);
  assert.equal(storage.get("myvault_pending_changes"), "0");
});
