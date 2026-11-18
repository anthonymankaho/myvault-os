import { test } from "node:test";
import assert from "node:assert/strict";
import { TROOP_TYPES } from "../games/ws-data.mjs";
import { createGame, develop, buildComp, compTotal, compAttack, compDefense, compTerrain, addTroops, takeTroops, mergeComp, setTroops, troopCap, officersOf } from "../games/ws-engine.mjs";
import { createBattle, battleRound } from "../games/ws-battle.mjs";

test("every troop type has attack, defense, cost and terrain stats", () => {
  for (const t of Object.values(TROOP_TYPES)) {
    assert.ok(t.attack > 0 && t.defense > 0, t.id);
    assert.ok(t.gold > 0 && t.food > 0, t.id);
    for (const terrain of ["plain", "mountain", "pass", "river", "forest"]) assert.ok(t.terrain[terrain] > 0, `${t.id}.${terrain}`);
  }
});

test("buildComp distributes exactly to the total", () => {
  for (const era of ["spring", "early", "late"]) {
    for (const key of ["qin", "zhao", "wu", "jin", "zhou"]) {
      const comp = buildComp(20000, key, era);
      assert.equal(compTotal(comp), 20000, `${key}/${era}`);
    }
  }
});

test("cavalry attacks harder than infantry; crossbow defends better", () => {
  assert.ok(compAttack({ cavalry: 1000 }) > compAttack({ infantry: 1000 }));
  assert.ok(compDefense({ crossbow: 1000 }) > compDefense({ infantry: 1000 }));
  assert.ok(compTerrain({ cavalry: 1000 }, "plain") > compTerrain({ cavalry: 1000 }, "mountain"));
  assert.ok(compTerrain({ navy: 1000 }, "river") > compTerrain({ navy: 1000 }, "plain"));
});

test("recruit by type adds to that type and keeps comp == troops", () => {
  const state = createGame("changping", "qin", "normal", 5);
  const city = state.cities.xianyang;
  city.gold = 100000; city.food = 200000;
  const off = officersOf(state, "qin").find((o) => o.location === "xianyang");
  const beforeCav = city.comp.cavalry || 0;
  off.acted = false;
  const res = develop(state, "xianyang", "recruit", off.id, "cavalry");
  assert.ok(res.ok, res.reason);
  assert.ok((city.comp.cavalry || 0) > beforeCav);
  assert.equal(compTotal(city.comp), city.troops);
  assert.ok(city.troops <= troopCap(city) + 1);
});

test("takeTroops + mergeComp conserve total composition", () => {
  const state = createGame("changping", "qin", "normal", 5);
  const city = state.cities.xianyang;
  const totalBefore = city.troops;
  const slice = takeTroops(city, 10000);
  assert.equal(compTotal(slice) + city.troops, totalBefore);
  const other = state.cities.yueyang;
  const otherBefore = other.troops;
  mergeComp(other.comp, slice); other.troops = compTotal(other.comp);
  assert.equal(other.troops, otherBefore + compTotal(slice));
});

test("cavalry army inflicts more damage than infantry on plain (same seed)", () => {
  const run = (comp) => {
    const state = createGame("changping", "qin", "normal", 4242);
    const city = state.cities.pingyang; // plain terrain
    city.troops = 30000; city.comp = buildComp(30000, "zhao", "late"); city.defense = 40;
    const army = { id: "a", state: "qin", commander: "baiqi", officers: ["baiqi"], troops: 30000, comp, morale: 90, training: 80, food: 30000, from: "anyi", target: "pingyang", kind: "attack", turnsLeft: 0 };
    const battle = createBattle(state, army);
    battleRound(state, battle, "assault");
    return 30000 - city.troops;
  };
  const cavDamage = run({ cavalry: 30000 });
  const infDamage = run({ infantry: 30000 });
  assert.ok(cavDamage > infDamage, `cavalry ${cavDamage} should exceed infantry ${infDamage}`);
});

test("composition stays consistent with troops through a full battle", () => {
  const state = createGame("changping", "qin", "normal", 9);
  const city = state.cities.pingyang;
  city.troops = 8000; city.comp = buildComp(8000, "zhao", "late");
  const army = { id: "a", state: "qin", commander: "baiqi", officers: ["baiqi"], troops: 40000, comp: buildComp(40000, "qin", "late"), morale: 90, training: 80, food: 30000, from: "anyi", target: "pingyang", kind: "attack", turnsLeft: 0 };
  const battle = createBattle(state, army);
  let guard = 0;
  while (!battle.concluded && guard < 40) { battleRound(state, battle, "assault"); guard++; }
  assert.equal(compTotal(city.comp), city.troops);
  assert.equal(compTotal(army.comp), army.troops);
});
