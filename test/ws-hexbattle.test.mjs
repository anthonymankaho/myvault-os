import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, attack, endTurn } from "../games/ws-engine.mjs";
import { createHexBattle, hexNeighbors, hexDist, hexPixel, hexReachable, hexAttackTargets, hexMove, hexAttack, hexEndPlayerPhase, checkConclusion, syncAggregates, HEX_COLS, HEX_ROWS } from "../games/ws-hexbattle.mjs";

function playerBattle(seed = 777) {
  const state = createGame("changping", "qin", "normal", seed);
  attack(state, "anyi", "pingyang", 20000, "wanghe", [], null);
  endTurn(state);
  const battle = state.pendingBattles[0];
  assert.ok(battle, "player battle pending");
  return { state, battle };
}

test("hex neighbours and distance are sane", () => {
  assert.equal(hexNeighbors(0, 0).length, 2); // corner
  assert.equal(hexNeighbors(5, 4).length, 6); // interior
  assert.equal(hexDist(0, 0, 0, 0), 0);
  assert.equal(hexDist(0, 0, 1, 0), 1);
  assert.equal(hexDist(2, 2, 5, 5), hexDist(5, 5, 2, 2));
  const p = hexPixel(3, 3);
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test("createHexBattle splits composition into units matching aggregates", () => {
  const { state, battle } = playerBattle();
  const hb = createHexBattle(state, battle);
  const att = hb.units.filter((u) => u.side === "att").reduce((s, u) => s + u.troops, 0);
  const def = hb.units.filter((u) => u.side === "def").reduce((s, u) => s + u.troops, 0);
  assert.equal(att, battle.army.troops);
  assert.equal(def, state.cities[battle.cityId].troops);
  assert.equal(hb.grid.length, HEX_ROWS);
  assert.equal(hb.grid[0].length, HEX_COLS);
  assert.ok(hb.units.some((u) => u.isCmd && u.side === "att"));
});

test("hex move respects reachability and updates position", () => {
  const { state, battle } = playerBattle();
  const hb = createHexBattle(state, battle);
  const u = hb.units.find((x) => x.side === "att" && !x.acted);
  const reach = hexReachable(state, hb, u);
  assert.ok(reach.length > 0);
  const [c, r] = reach[0];
  hexMove(state, hb, u, c, r);
  assert.equal(u.c, c); assert.equal(u.r, r);
  assert.equal(u.moved, true);
});

test("hex attack reduces target troops and keeps aggregates consistent", () => {
  const { state, battle } = playerBattle();
  const hb = createHexBattle(state, battle);
  // force an attacker adjacent to a defender to guarantee a target
  const att = hb.units.find((x) => x.side === "att");
  const def = hb.units.find((x) => x.side === "def");
  att.c = def.c - 1; att.r = def.r;
  const before = def.troops;
  const targets = hexAttackTargets(state, hb, att);
  assert.ok(targets.some((t) => t.id === def.id));
  hexAttack(state, hb, att, def);
  assert.ok(def.troops < before);
  assert.equal(battle.army.troops, hb.units.filter((u) => u.side === "att").reduce((s, u) => s + u.troops, 0));
  assert.equal(state.cities[battle.cityId].troops, hb.units.filter((u) => u.side === "def").reduce((s, u) => s + u.troops, 0));
});

test("hex AI phase + end round advances and can conclude", () => {
  const { state, battle } = playerBattle();
  const hb = createHexBattle(state, battle);
  for (let i = 0; i < 14 && !hb.concluded; i++) hexEndPlayerPhase(state, hb);
  assert.ok(hb.concluded, "hex battle concludes within round cap");
  assert.ok(["attacker", "defender", "retreat"].includes(hb.result));
  assert.equal(battle.concluded, true);
});

test("breached fort lets attacker occupy and win", () => {
  const { state, battle } = playerBattle();
  const hb = createHexBattle(state, battle);
  hb.fort.defense = 0;
  const att = hb.units.find((x) => x.side === "att");
  att.c = hb.fort.c - 1; att.r = hb.fort.r; att.moved = false; att.acted = false;
  const reach = hexReachable(state, hb, att);
  assert.ok(reach.some(([c, r]) => c === hb.fort.c && r === hb.fort.r), "fort enterable once breached");
  hexMove(state, hb, att, hb.fort.c, hb.fort.r);
  assert.equal(hb.result, "attacker");
});

test("retreat concludes as retreat", () => {
  const { state, battle } = playerBattle();
  const hb = createHexBattle(state, battle);
  hb.retreat = true;
  checkConclusion(state, hb);
  assert.equal(hb.result, "retreat");
});
