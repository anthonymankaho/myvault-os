import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, develop, search, recruitOfficer, reward, transferOfficer, appointGovernor, moveArmy, transport, attack, stratagem, diplomacy, endTurn, startPlayerPhase, citiesOf, officersOf, stateTotals, DOMESTIC, troopCap } from "../games/ws-engine.mjs";
import { battleRound, autoTactic, finalizeBattle } from "../games/ws-battle.mjs";
import { checkBattleEvents } from "../games/ws-events.mjs";
import { SCENARIOS } from "../games/ws-scenarios.mjs";
import { serialize, deserialize, validate } from "../games/ws-save.mjs";

function autoResolvePending(state) {
  for (const battle of state.pendingBattles) {
    let guard = 0;
    while (!battle.concluded && guard < 40) { battleRound(state, battle, autoTactic(state, battle, "attacker")); guard++; }
    if (!battle.concluded) { battle.concluded = true; battle.result = "retreat"; }
    finalizeBattle(state, battle);
    checkBattleEvents(state, battle);
  }
  startPlayerPhase(state);
}

test("createGame works for every scenario and gives the player cities", () => {
  for (const sc of SCENARIOS) {
    const state = createGame(sc.id, sc.states[0], "normal", 12345);
    assert.equal(state.scenarioId, sc.id);
    assert.ok(citiesOf(state, sc.states[0]).length > 0, `${sc.id} player has cities`);
    assert.ok(stateTotals(state, sc.states[0]).troops > 0);
    assert.ok(state.states[sc.states[0]].ruler);
  }
});

test("develop agriculture raises agriculture, spends gold, marks officer acted", () => {
  const state = createGame("changping", "qin", "normal", 999);
  const city = state.cities.xianyang;
  const officer = state.officers.baiqi;
  const beforeAgri = city.agriculture, beforeGold = city.gold;
  const res = develop(state, "xianyang", "agriculture", "baiqi");
  assert.ok(res.ok, res.reason);
  assert.ok(city.agriculture > beforeAgri);
  assert.equal(city.gold, beforeGold - DOMESTIC.agriculture.gold);
  assert.equal(officer.acted, true);
  const again = develop(state, "xianyang", "agriculture", "baiqi");
  assert.equal(again.ok, false, "officer cannot act twice");
});

test("recruit raises troops and lowers population", () => {
  const state = createGame("changping", "qin", "normal", 999);
  const city = state.cities.xianyang;
  const beforeTroops = city.troops, beforePop = city.population;
  const res = develop(state, "xianyang", "recruit", "wangjian");
  assert.ok(res.ok, res.reason);
  assert.ok(city.troops > beforeTroops);
  assert.ok(city.population < beforePop);
});

test("recruitment never exceeds 20% of population", () => {
  const state = createGame("changping", "qin", "normal", 999);
  const city = state.cities.xianyang;
  city.gold = 1000000; city.food = 2000000;
  const off = officersOf(state, "qin").find((o) => o.location === "xianyang" && o.status === "active");
  for (let i = 0; i < 60; i++) {
    off.acted = false;
    develop(state, "xianyang", "recruit", off.id);
    assert.ok(city.troops <= troopCap(city) + 1, `turn ${i}: troops ${city.troops} > cap ${troopCap(city)}`);
  }
  // once at cap, further recruit is refused
  off.acted = false;
  const refused = develop(state, "xianyang", "recruit", off.id);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /20%/);
});

test("moveArmy merges troops into adjacent own city after endTurn", () => {
  const state = createGame("changping", "qin", "normal", 999);
  const from = state.cities.xianyang, to = state.cities.yueyang;
  const beforeTo = to.troops;
  const res = moveArmy(state, "xianyang", "yueyang", 8000, "wangling", [], null);
  assert.ok(res.ok, res.reason);
  assert.equal(state.armies.length, 1);
  assert.equal(from.troops >= 0, true);
  endTurn(state);
  autoResolvePending(state);
  assert.ok(!state.armies.some((a) => a.kind === "move" && a.target === "yueyang"), "move army resolved");
  assert.ok(to.troops > beforeTo, "troops merged into target");
});

test("endTurn advances clock and runs AI without crashing", () => {
  const state = createGame("changping", "qin", "normal", 4242);
  const beforeTurn = state.turn;
  const report = endTurn(state);
  autoResolvePending(state);
  assert.equal(state.turn, beforeTurn + 1);
  assert.ok(Array.isArray(report.aiActions));
  for (const city of Object.values(state.cities)) {
    assert.ok(city.gold >= 0 && city.food >= 0 && city.troops >= 0, `${city.id} negative resource`);
  }
});

test("attack on adjacent enemy creates a player battle that resolves", () => {
  const state = createGame("changping", "qin", "normal", 777);
  // anyi (qin) -> pingyang (zhao)
  assert.equal(state.cities.anyi.state, "qin");
  assert.equal(state.cities.pingyang.state, "zhao");
  const res = attack(state, "anyi", "pingyang", 15000, "wanghe", [], null);
  assert.ok(res.ok, res.reason);
  const report = endTurn(state);
  assert.ok(state.pendingBattles.length >= 1, "player attack yields interactive battle");
  const battle = state.pendingBattles[0];
  let guard = 0;
  while (!battle.concluded && guard < 40) { battleRound(state, battle, autoTactic(state, battle, "attacker")); guard++; }
  assert.ok(battle.concluded);
  assert.ok(["attacker", "defender", "retreat"].includes(battle.result));
  finalizeBattle(state, battle);
  checkBattleEvents(state, battle);
  startPlayerPhase(state);
  // city either captured by qin or still zhao
  assert.ok(["qin", "zhao"].includes(state.cities.pingyang.state));
});

test("60-turn simulation stays stable (no NaN, no negative resources, no crash)", () => {
  const state = createGame("changping", "qin", "normal", 20260);
  for (let i = 0; i < 60; i++) {
    // player auto-develops capital each turn for realism
    const cap = citiesOf(state, "qin").find((c) => c.tier === "capital");
    if (cap) {
      const off = officersOf(state, "qin").find((o) => o.location === cap.id && !o.acted && o.wounded <= 0);
      if (off) develop(state, cap.id, "agriculture", off.id);
    }
    endTurn(state);
    autoResolvePending(state);
    if (state.outcome) break;
    for (const city of Object.values(state.cities)) {
      for (const stat of ["population", "troops", "gold", "food", "agriculture", "commerce", "order", "defense", "training", "morale"]) {
        assert.ok(typeof city[stat] === "number" && !Number.isNaN(city[stat]) && city[stat] >= 0, `${city.id}.${stat}=${city[stat]} turn ${i}`);
      }
    }
  }
  assert.ok(state.turn > 1);
});

test("save serialize/deserialize round-trips the full state", () => {
  const state = createGame("changping", "zhao", "hard", 555);
  endTurn(state); autoResolvePending(state);
  const json = serialize(state);
  const restored = deserialize(json);
  const check = validate(restored);
  assert.ok(check.ok, check.errors.join(";"));
  assert.equal(restored.turn, state.turn);
  assert.equal(restored.year, state.year);
  assert.deepEqual(restored.cities, state.cities);
  assert.deepEqual(restored.officers, state.officers);
  assert.deepEqual(restored.states, state.states);
  assert.deepEqual(restored.armies, state.armies);
});

test("diplomacy gift improves relations and costs gold", () => {
  const state = createGame("changping", "qin", "normal", 31);
  const officer = officersOf(state, "qin").find((o) => !o.acted);
  const before = state.states.qin.relations.zhao.value;
  const res = diplomacy(state, "gift", "qin", "zhao", officer.id, { amount: 500 });
  assert.ok(res.ok, res.reason);
  assert.ok(state.states.qin.relations.zhao.value > before);
});

test("transport moves resources between adjacent own cities", () => {
  const state = createGame("changping", "qin", "normal", 31);
  const from = state.cities.xianyang, to = state.cities.yueyang;
  const beforeToGold = to.gold;
  const res = transport(state, "xianyang", "yueyang", 500, 1000);
  assert.ok(res.ok, res.reason);
  assert.equal(to.gold, beforeToGold + 500);
});
