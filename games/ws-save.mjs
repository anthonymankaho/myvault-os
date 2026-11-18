// Warring States — save manager. Full Game State serialization with schema
// validation. Storage adapter is injectable (localStorage in browser, a Map in
// Node tests). Saves are taken between turns, so transient battle refs are
// stripped to keep the snapshot a clean tree.

import { GAME_VERSION } from "./ws-data.mjs";
import { SCENARIO_BY_ID } from "./ws-scenarios.mjs";

export const SAVE_VERSION = GAME_VERSION;
export const SLOT_KEYS = ["slot1", "slot2", "slot3", "auto"];
const PREFIX = "ws_save_";
const META_PREFIX = "ws_meta_";

export function serialize(state) {
  const snapshot = { ...state, pendingBattles: [], activeBattle: null };
  return JSON.stringify(snapshot);
}

export function validate(state) {
  const errors = [];
  if (!state || typeof state !== "object") return { ok: false, errors: ["not an object"] };
  if (state.version !== SAVE_VERSION) errors.push(`version mismatch: ${state.version} != ${SAVE_VERSION}`);
  if (!SCENARIO_BY_ID[state.scenarioId]) errors.push(`unknown scenario: ${state.scenarioId}`);
  if (!state.states?.[state.playerState]) errors.push("invalid playerState");
  for (const key of ["states", "cities", "officers"]) {
    if (!state[key] || typeof state[key] !== "object") errors.push(`missing ${key}`);
  }
  if (!Array.isArray(state.armies)) errors.push("armies not array");
  if (typeof state.turn !== "number" || typeof state.year !== "number" || typeof state.month !== "number") errors.push("bad clock");
  // numeric sanity on a sample of cities
  for (const city of Object.values(state.cities ?? {}).slice(0, 50)) {
    for (const stat of ["population", "troops", "gold", "food", "agriculture", "commerce", "order", "defense"]) {
      if (typeof city[stat] !== "number" || Number.isNaN(city[stat])) { errors.push(`bad ${stat} in ${city.id}`); break; }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function deserialize(json) {
  let state;
  try { state = JSON.parse(json); } catch (e) { throw new Error("存檔無法解析（JSON 損壞）。"); }
  const check = validate(state);
  if (!check.ok) throw new Error("存檔驗證失敗：" + check.errors.join("; "));
  state.pendingBattles = [];
  state.activeBattle = null;
  state.log = state.log ?? [];
  state.firedEvents = state.firedEvents ?? [];
  state.armies = state.armies ?? [];
  return state;
}

export class SaveManager {
  constructor(storage) {
    this.storage = storage; // { getItem, setItem, removeItem }
  }
  metaKey(slot) { return META_PREFIX + slot; }
  dataKey(slot) { return PREFIX + slot; }

  list() {
    return SLOT_KEYS.map((slot) => {
      const raw = this.storage.getItem(this.metaKey(slot));
      let meta = null;
      try { meta = raw ? JSON.parse(raw) : null; } catch { meta = null; }
      return { slot, meta, exists: !!this.storage.getItem(this.dataKey(slot)) };
    });
  }

  save(slot, state, name) {
    if (!SLOT_KEYS.includes(slot)) throw new Error("invalid slot");
    const json = serialize(state);
    const meta = {
      name: name || `${state.states[state.playerState].name}・${SCENARIO_BY_ID[state.scenarioId].name}`,
      scenario: state.scenarioId, playerState: state.playerState,
      turn: state.turn, year: state.year, month: state.month,
      savedAt: new Date().toISOString(),
    };
    this.storage.setItem(this.dataKey(slot), json);
    this.storage.setItem(this.metaKey(slot), JSON.stringify(meta));
    return meta;
  }

  load(slot) {
    const json = this.storage.getItem(this.dataKey(slot));
    if (!json) throw new Error("空存檔。");
    return deserialize(json);
  }

  delete(slot) {
    this.storage.removeItem(this.dataKey(slot));
    this.storage.removeItem(this.metaKey(slot));
  }

  autosave(state) {
    return this.save("auto", state, "自動存檔");
  }
}

// Browser localStorage adapter.
export function localStorageAdapter() {
  return {
    getItem: (k) => window.localStorage.getItem(k),
    setItem: (k, v) => window.localStorage.setItem(k, v),
    removeItem: (k) => window.localStorage.removeItem(k),
  };
}

// In-memory adapter for tests.
export function memoryAdapter() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}
