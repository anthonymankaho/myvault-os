import { test } from "node:test";
import assert from "node:assert/strict";
import { CITIES, CITY_BY_ID, OFFICERS, OFFICER_BY_ID, STATES } from "../games/ws-data.mjs";
import { SCENARIOS, EVENTS, EVENT_BY_ID, RANDOM_EVENTS } from "../games/ws-scenarios.mjs";

test("city adjacency is symmetric and references exist", () => {
  const problems = [];
  for (const city of CITIES) {
    for (const adj of city.adjacent) {
      const other = CITY_BY_ID[adj];
      if (!other) { problems.push(`${city.id} -> missing ${adj}`); continue; }
      if (!other.adjacent.includes(city.id)) problems.push(`${city.id} -> ${adj} not reciprocal`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("officer and city IDs are unique", () => {
  const seenO = new Set(); const dupO = [];
  for (const o of OFFICERS) { if (seenO.has(o.id)) dupO.push(o.id); seenO.add(o.id); }
  const seenC = new Set(); const dupC = [];
  for (const c of CITIES) { if (seenC.has(c.id)) dupC.push(c.id); seenC.add(c.id); }
  assert.deepEqual(dupO, [], "duplicate officer ids: " + dupO.join(","));
  assert.deepEqual(dupC, [], "duplicate city ids: " + dupC.join(","));
});

test("every officer stat is within 1..100", () => {
  for (const o of OFFICERS) {
    for (const [k, v] of Object.entries(o.stats)) {
      assert.ok(v >= 1 && v <= 100, `${o.id}.${k}=${v}`);
    }
    assert.ok(STATES[o.home], `${o.id} home ${o.home} unknown`);
  }
});

test("scenario placements reference valid officers and owned cities", () => {
  const problems = [];
  for (const sc of SCENARIOS) {
    for (const [id, city, pos] of sc.placements) {
      if (!OFFICER_BY_ID[id]) problems.push(`${sc.id}: officer ${id} missing`);
      if (!CITY_BY_ID[city]) problems.push(`${sc.id}: city ${city} missing`);
      if (!sc.ownership[city]) problems.push(`${sc.id}: city ${city} not owned`);
      if (pos && !["governor", "general", "advisor"].includes(pos)) problems.push(`${sc.id}: bad pos ${pos}`);
    }
    for (const [id, city] of sc.freeOfficers ?? []) {
      if (!OFFICER_BY_ID[id]) problems.push(`${sc.id}: free officer ${id} missing`);
      if (!CITY_BY_ID[city]) problems.push(`${sc.id}: free city ${city} missing`);
    }
    for (const key of sc.states) {
      if (!STATES[key]) problems.push(`${sc.id}: state ${key} unknown`);
      if (!sc.rulers[key]) problems.push(`${sc.id}: state ${key} no ruler`);
      else if (!OFFICER_BY_ID[sc.rulers[key]]) problems.push(`${sc.id}: ruler ${sc.rulers[key]} missing`);
    }
    for (const evId of sc.events) {
      if (!EVENT_BY_ID[evId]) problems.push(`${sc.id}: event ${evId} missing`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("scenario rulers are placed and alive at scenario year", () => {
  const problems = [];
  for (const sc of SCENARIOS) {
    for (const key of sc.states) {
      const rulerId = sc.rulers[key];
      const placed = sc.placements.find((p) => p[0] === rulerId);
      if (!placed) problems.push(`${sc.id}: ruler ${rulerId} not placed`);
      const base = OFFICER_BY_ID[rulerId];
      if (base?.death != null && sc.year > base.death) problems.push(`${sc.id}: ruler ${rulerId} dead at start (${base.death})`);
      if (base?.birth != null && sc.year < base.birth) problems.push(`${sc.id}: ruler ${rulerId} unborn at start`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("placed officers are born and not historically dead at scenario year", () => {
  const problems = [];
  for (const sc of SCENARIOS) {
    for (const [id] of sc.placements) {
      const base = OFFICER_BY_ID[id];
      if (base.death != null && sc.year > base.death) problems.push(`${sc.id}: ${id} died ${base.death} before ${sc.year}`);
      if (base.birth != null && sc.year < base.birth) problems.push(`${sc.id}: ${id} born ${base.birth} after ${sc.year}`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("every scenario state owns a city and each ruler sits in his own state", () => {
  const problems = [];
  for (const sc of SCENARIOS) {
    for (const key of sc.states) {
      const owned = Object.values(sc.ownership).filter((o) => o === key).length;
      if (owned === 0) problems.push(`${sc.id}: ${key} owns no city`);
      const placed = sc.placements.find((p) => p[0] === sc.rulers[key]);
      if (placed && sc.ownership[placed[1]] !== key) problems.push(`${sc.id}: ruler ${sc.rulers[key]} in ${sc.ownership[placed[1]]}, not ${key}`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("events have valid provenance and effect vocabulary", () => {
  const validProv = ["史實", "演義", "待考"];
  const validEffects = ["msg", "city", "allCities", "troops", "loyalty", "death", "move", "join", "relation", "alliance", "war", "gold", "food", "ruler", "spawnFree", "spawnWanderer", "randomOfficerLoyalty", "randomOldDeath"];
  for (const ev of [...EVENTS, ...RANDOM_EVENTS]) {
    assert.ok(validProv.includes(ev.provenance), `${ev.id} provenance ${ev.provenance}`);
    for (const ef of ev.effects ?? []) assert.ok(validEffects.includes(ef.t), `${ev.id} effect ${ef.t}`);
  }
});
