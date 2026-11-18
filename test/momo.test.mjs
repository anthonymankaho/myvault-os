import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySelectedOperations,
  prepareTasks,
  searchTasks,
  validateOperations,
  validateRequest,
} from "../momo-contract.mjs";
import { createMomoController } from "../momo.mjs";

const task = (overrides = {}) => ({
  id: "t1",
  description: "WEEKLY EXCHANGE REPORT",
  company: "MCL",
  planningMonth: "2026-11",
  scheduledDate: "2026-11-16",
  status: "Not Started",
  docResult: "keep this result",
  completedAt: null,
  recurring: true,
  createdAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});
const vault = () => ({ tasks: [task()], chats: [{ id: "c1", notes: "do not send" }] });

test("stores a named Hong Kong completion time and leaves other task fields", () => {
  const operations = validateOperations(
    [
      {
        type: "update",
        collection: "tasks",
        id: "t1",
        fields: { status: "Completed", completedAt: "2026-11-16T09:16:00+08:00" },
      },
    ],
    vault(),
  );
  const next = applySelectedOperations(vault(), operations, [0], {
    uid: () => "unused",
    now: "2026-11-18T01:00:00.000Z",
    baseline: vault(),
  });
  assert.equal(next.tasks[0].completedAt, "2026-11-16T01:16:00.000Z");
  assert.equal(next.tasks[0].status, "Completed");
  assert.equal(next.tasks[0].docResult, "keep this result");
  assert.equal(next.tasks[0].recurring, true);
  assert.equal(next.tasks[0].createdAt, "2026-11-01T00:00:00.000Z");
  assert.equal(next.chats[0].notes, "do not send");
  assert.equal(vault().tasks[0].status, "Not Started");
});

test("rejects a completion that omits the time, a date-only value, and a far future time", () => {
  assert.throws(
    () => validateOperations([{ type: "update", collection: "tasks", id: "t1", fields: { status: "Completed" } }], vault()),
    /completedAt is required/,
  );
  assert.throws(
    () =>
      validateOperations(
        [{ type: "update", collection: "tasks", id: "t1", fields: { status: "Completed", completedAt: "2026-11-16" } }],
        vault(),
      ),
    /Invalid completedAt/,
  );
  assert.throws(
    () =>
      validateOperations(
        [{ type: "update", collection: "tasks", id: "t1", fields: { status: "Completed", completedAt: "2099-01-01T09:16:00+08:00" } }],
        vault(),
      ),
    /future/,
  );
});

test("reopens a task by clearing its completion time and can still edit result notes", () => {
  const done = vault();
  done.tasks[0].status = "Completed";
  done.tasks[0].completedAt = "2026-11-16T01:16:00.000Z";
  const reopened = validateOperations(
    [{ type: "update", collection: "tasks", id: "t1", fields: { status: "Not Started" } }],
    done,
  );
  assert.equal(reopened[0].fields.completedAt, null);
  const noted = validateOperations(
    [{ type: "update", collection: "tasks", id: "t1", fields: { docResult: "filed" } }],
    done,
  );
  assert.equal(noted[0].fields.completedAt, undefined);
  assert.equal(noted[0].fields.docResult, "filed");
});

test("rejects other collections, deletes, and recurring edits", () => {
  assert.throws(
    () => validateOperations([{ type: "update", collection: "chats", id: "c1", fields: { notes: "x" } }], vault()),
    /Monthly Tasks/,
  );
  assert.throws(
    () => validateOperations([{ type: "delete", collection: "tasks", id: "t1" }], vault()),
    /create and update/,
  );
  assert.throws(
    () => validateOperations([{ type: "update", collection: "tasks", id: "t1", fields: { recurring: false } }], vault()),
    /Unknown item field/,
  );
});

test("keeps open tasks when the working set is capped and searches by name", () => {
  const tasks = Array.from({ length: 201 }, (_, index) =>
    task({ id: `t${index}`, description: index === 5 ? "RMB EXCHANGE REPORT" : `Task ${index}`, status: "Not Started" }),
  );
  tasks.push(task({ id: "old", description: "OLD DONE", status: "Completed", completedAt: "2020-01-01T00:00:00.000Z" }));
  const prepared = prepareTasks(tasks);
  assert.equal(prepared.tasks.length, 200);
  assert.equal(prepared.omitted, 2);
  assert.equal(prepared.tasks.some((item) => item.id === "old"), false);
  assert.equal(prepared.tasks.some((item) => item.description === "RMB EXCHANGE REPORT"), true);
  const found = searchTasks(prepared, "rmb exchange");
  assert.equal(found[0].description, "RMB EXCHANGE REPORT");
});

test("request vault is tasks only", () => {
  assert.throws(
    () => validateRequest({ message: "hello", history: [], vault: { tasks: [], chats: [] } }),
    /Unknown vault field/,
  );
});

test("apply waits for confirmation and tells the user to save", async () => {
  const state = { vault: vault(), revision: 3 };
  const calls = [];
  const app = {
    isSignedIn: () => true,
    getVault: () => state.vault,
    getRevision: () => state.revision,
    uid: () => "new-task",
    call: async (action, payload) => {
      calls.push({ action, payload });
      return {
        message: "Proposed.",
        operations: [
          {
            type: "update",
            collection: "tasks",
            id: "t1",
            fields: { status: "Completed", completedAt: "2026-11-16T09:16:00+08:00" },
          },
        ],
      };
    },
    applyLocalVault(next, message) {
      state.vault = next;
      state.revision += 1;
      state.message = message;
    },
  };
  const controller = createMomoController(app);
  const signedOut = createMomoController({ ...app, isSignedIn: () => false });
  await assert.rejects(() => signedOut.send("done"), /Sign in with GitHub/);
  await controller.send("Mark Weekly Exchange Report completed yesterday at 9:16.");
  assert.equal(calls[0].action, "momo");
  assert.deepEqual(Object.keys(calls[0].payload.vault), ["tasks"]);
  assert.equal(JSON.stringify(calls[0].payload).includes("do not send"), false);
  assert.throws(() => controller.apply(), /Confirm/);
  controller.memory.confirmed = true;
  controller.apply();
  assert.equal(state.vault.tasks[0].completedAt, "2026-11-16T01:16:00.000Z");
  assert.equal(state.vault.tasks[0].recurring, true);
  assert.match(state.message, /Save changes to sync with GitHub/);
  assert.equal(calls.length, 1);
});
