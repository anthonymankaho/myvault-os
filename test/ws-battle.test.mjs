import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../games/ws-engine.mjs";
import { createBattle, battleRound, autoTactic, autoResolveBattle, finalizeBattle, ATTACK_TACTICS, DEFEND_TACTICS } from "../games/ws-battle.mjs";

function makeArmy(state, overrides = {}) {
  return { id: "a1", state: "qin", commander: "baiqi", officers: ["baiqi"], troops: 80000, morale: 90, training: 80, food: 30000, from: "anyi", target: "pingyang", kind: "attack", turnsLeft: 0, status: "marching", ...overrides };
}

test("overwhelming attacker captures the city", () => {
  const state = createGame("changping", "qin", "normal", 123);
  state.cities.pingyang.troops = 4000;
  state.cities.pingyang.defense = 30;
  const battle = autoResolveBattle(state, makeArmy(state));
  assert.equal(battle.result, "attacker");
  assert.equal(state.cities.pingyang.state, "qin");
  assert.ok(state.cities.pingyang.troops > 0);
  assert.ok(state.officers.baiqi.location === "pingyang");
});

test("weak attacker is repelled", () => {
  const state = createGame("changping", "qin", "normal", 123);
  state.cities.pingyang.troops = 60000;
  state.cities.pingyang.defense = 90;
  state.cities.pingyang.morale = 95;
  const battle = autoResolveBattle(state, makeArmy(state, { troops: 3000, morale: 40, food: 500 }));
  assert.ok(["defender", "retreat"].includes(battle.result), battle.result);
  assert.equal(state.cities.pingyang.state, "zhao");
});

test("battle outcome is reproducible for a fixed seed", () => {
  const run = () => {
    const state = createGame("changping", "qin", "normal", 777);
    state.cities.pingyang.troops = 20000;
    const battle = autoResolveBattle(state, makeArmy(state, { troops: 40000 }));
    return { result: battle.result, rounds: battle.round, aTroops: battle.army.troops, dTroops: state.cities.pingyang.troops };
  };
  assert.deepEqual(run(), run());
});

test("battle respects maxRounds and concludes", () => {
  const state = createGame("changping", "qin", "normal", 5);
  const battle = createBattle(state, makeArmy(state, { troops: 20000 }));
  state.cities.pingyang.troops = 20000;
  let guard = 0;
  while (!battle.concluded && guard < 50) { battleRound(state, battle, "assault"); guard++; }
  assert.ok(battle.concluded);
  assert.ok(battle.round <= battle.maxRounds);
});

test("tactic tables are complete", () => {
  for (const key of ["assault", "charge", "stratagem", "fire", "defend", "retreat"]) assert.ok(ATTACK_TACTICS[key]);
  for (const key of ["hold", "sortie", "stratagem", "charge"]) assert.ok(DEFEND_TACTICS[key]);
});
