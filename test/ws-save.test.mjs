import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, endTurn } from "../games/ws-engine.mjs";
import { SaveManager, memoryAdapter, serialize, deserialize, validate } from "../games/ws-save.mjs";

test("SaveManager save/list/load/delete round-trip", () => {
  const mgr = new SaveManager(memoryAdapter());
  const state = createGame("changping", "qin", "normal", 42);
  const meta = mgr.save("slot1", state, "測試存檔");
  assert.equal(meta.name, "測試存檔");
  const list = mgr.list();
  const slot1 = list.find((s) => s.slot === "slot1");
  assert.ok(slot1.exists);
  assert.equal(slot1.meta.turn, state.turn);
  const loaded = mgr.load("slot1");
  assert.equal(loaded.scenarioId, state.scenarioId);
  assert.deepEqual(loaded.cities, state.cities);
  mgr.delete("slot1");
  assert.ok(!mgr.list().find((s) => s.slot === "slot1").exists);
});

test("autosave writes the auto slot", () => {
  const mgr = new SaveManager(memoryAdapter());
  const state = createGame("shangyang", "wei", "normal", 7);
  mgr.autosave(state);
  assert.ok(mgr.list().find((s) => s.slot === "auto").exists);
  assert.equal(mgr.load("auto").playerState, "wei");
});

test("deserialize rejects corrupted JSON", () => {
  assert.throws(() => deserialize("{not json"), /JSON/);
});

test("validate rejects wrong version and missing fields", () => {
  const state = createGame("changping", "qin", "normal", 1);
  const bad = JSON.parse(serialize(state));
  bad.version = 999;
  assert.equal(validate(bad).ok, false);
  const bad2 = JSON.parse(serialize(state));
  delete bad2.cities;
  assert.equal(validate(bad2).ok, false);
});

test("save after several turns restores identical clock and armies", () => {
  const mgr = new SaveManager(memoryAdapter());
  const state = createGame("changping", "zhao", "normal", 99);
  for (let i = 0; i < 5; i++) { endTurn(state); state.pendingBattles = []; for (const o of Object.values(state.officers)) o.acted = false; }
  mgr.save("slot2", state);
  const loaded = mgr.load("slot2");
  assert.equal(loaded.turn, state.turn);
  assert.equal(loaded.year, state.year);
  assert.equal(loaded.month, state.month);
  assert.deepEqual(loaded.armies, state.armies);
});
