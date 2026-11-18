// Warring States — hex-grid tactical battle layer (war-chess / 戰棋, RTK6-style
// but original). Sits on top of the strategic battle: units are split from each
// side's troop composition, move/attack on a hex field with terrain, ZOC,
// morale, supply and a fort (city wall). Aggregates are synced back to
// battle.army / city so the strategic engine, saves and tests stay consistent.

import { TROOP_TYPES } from "./ws-data.mjs";
import { clamp, round, chance, jitter, randomInt } from "./ws-util.mjs";
import { traitMult } from "./ws-engine.mjs";

export const HEX_COLS = 13;
export const HEX_ROWS = 9;
export const HEX_SIZE = 26;

const EVEN_NB = [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
const ODD_NB = [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]];

export function hexNeighbors(c, r) {
  const d = (r & 1) ? ODD_NB : EVEN_NB;
  return d.map(([dc, dr]) => [c + dc, r + dr]).filter(([c2, r2]) => c2 >= 0 && c2 < HEX_COLS && r2 >= 0 && r2 < HEX_ROWS);
}
export function hexPixel(c, r) {
  return { x: HEX_SIZE * Math.sqrt(3) * (c + 0.5 * (r & 1)) + HEX_SIZE * 1.2, y: HEX_SIZE * 1.5 * r + HEX_SIZE * 1.2 };
}
export function hexDist(c1, r1, c2, r2) {
  const ax = c1 - (r1 - (r1 & 1)) / 2, az = r1, ay = -ax - az;
  const bx = c2 - (r2 - (r2 & 1)) / 2, bz = r2, by = -bx - bz;
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}

const MOVE_COST = {
  plain: { infantry: 1, cavalry: 1, crossbow: 1, chariot: 1, navy: 2, elite: 1, guard: 1, hu: 1, archer: 1, ge: 1, chu: 1 },
  mountain: { infantry: 2, cavalry: 2, crossbow: 2, chariot: 99, navy: 99, elite: 2, guard: 2, hu: 2, archer: 2, ge: 2, chu: 2 },
  pass: { infantry: 2, cavalry: 2, crossbow: 1, chariot: 99, navy: 99, elite: 2, guard: 1, hu: 2, archer: 1, ge: 1, chu: 2 },
  river: { infantry: 2, cavalry: 2, crossbow: 2, chariot: 99, navy: 1, elite: 2, guard: 2, hu: 2, archer: 2, ge: 2, chu: 1 },
  forest: { infantry: 2, cavalry: 2, crossbow: 2, chariot: 2, navy: 99, elite: 2, guard: 2, hu: 2, archer: 2, ge: 2, chu: 1 },
};
const MP = { infantry: 3, cavalry: 5, crossbow: 2, chariot: 4, navy: 3, elite: 3, guard: 3, hu: 5, archer: 2, ge: 3, chu: 3 };
const RANGE = { infantry: 1, cavalry: 1, crossbow: 2, chariot: 1, navy: 1, elite: 1, guard: 1, hu: 1, archer: 2, ge: 1, chu: 1 };
export const TERRAIN_HEX_LABEL = { plain: "平原", mountain: "山地", pass: "關隘", river: "水", forest: "林" };

function terrainFor(state, cityTerrain) {
  const weights = {
    plain: [["plain", 62], ["forest", 14], ["mountain", 10], ["river", 8], ["pass", 6]],
    mountain: [["mountain", 46], ["plain", 22], ["forest", 16], ["pass", 12], ["river", 4]],
    pass: [["pass", 30], ["mountain", 34], ["plain", 22], ["forest", 10], ["river", 4]],
    river: [["river", 34], ["plain", 34], ["forest", 16], ["mountain", 10], ["pass", 6]],
    forest: [["forest", 40], ["plain", 30], ["mountain", 16], ["river", 10], ["pass", 4]],
  }[cityTerrain] || [["plain", 70], ["forest", 15], ["mountain", 10], ["river", 5]];
  const total = weights.reduce((s, w) => s + w[1], 0);
  let roll = nextRoll(state) * total;
  for (const [t, w] of weights) { roll -= w; if (roll <= 0) return t; }
  return "plain";
}
function nextRoll(state) {
  state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
  let t = state.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createHexBattle(state, battle) {
  const city = state.cities[battle.cityId];
  const army = battle.army;
  const hb = {
    battle, grid: [], units: [], round: 1, phase: "player",
    selected: null, reachable: [], targets: [], log: [],
    concluded: false, result: null, retreat: false, starving: 0,
    fort: { c: HEX_COLS - 2, r: Math.floor(HEX_ROWS / 2), defense: city.defense },
    maxRounds: 10,
    playerSide: battle.playerAttacker ? "att" : "def",
  };
  for (let r = 0; r < HEX_ROWS; r++) {
    const row = [];
    for (let c = 0; c < HEX_COLS; c++) row.push(terrainFor(state, city.terrain));
    hb.grid.push(row);
  }
  hb.grid[hb.fort.r][hb.fort.c] = city.terrain === "pass" ? "pass" : "plain";

  let uid = 0;
  const mkUnit = (side, type, troops, officerId, isCmd, c, r) => ({
    id: `u${uid++}`, side, type, troops, officerId, isCmd,
    morale: side === "att" ? army.morale : city.morale,
    training: side === "att" ? army.training : city.training,
    c, r, moved: false, acted: false,
  });
  // attacker units from composition, enter from left
  const attTypes = Object.entries(army.comp || {}).filter(([, n]) => n > 0);
  attTypes.forEach(([type, n], i) => {
    const officerId = i === 0 ? army.commander : (army.officers[i] ?? null);
    hb.units.push(mkUnit("att", type, n, officerId, i === 0, 0, 1 + i * 2));
  });
  if (!attTypes.length) hb.units.push(mkUnit("att", "infantry", army.troops, army.commander, true, 0, 4));
  // defender units from composition, guard the fort on the right
  const defTypes = Object.entries(city.comp || {}).filter(([, n]) => n > 0);
  const defOfficers = city.officers || [];
  defTypes.forEach(([type, n], i) => {
    const officerId = i === 0 ? (battle.defenderCommander?.id ?? null) : (defOfficers[i] ?? null);
    const r = clamp(1 + i * 2, 0, HEX_ROWS - 1);
    hb.units.push(mkUnit("def", type, n, officerId, i === 0, HEX_COLS - 3, r));
  });
  if (!defTypes.length) hb.units.push(mkUnit("def", "infantry", city.troops, battle.defenderCommander?.id ?? null, true, HEX_COLS - 3, 4));
  hb.log.push(`戰棋戰場：${city.name}。${battle.weather.name}。攻方自左入，守方護城壘。`);
  syncAggregates(state, hb);
  return hb;
}

export function syncAggregates(state, hb) {
  const army = hb.battle.army;
  const city = state.cities[hb.battle.cityId];
  hb.units = hb.units.filter((u) => u.troops > 0);
  const att = hb.units.filter((u) => u.side === "att");
  const def = hb.units.filter((u) => u.side === "def");
  army.troops = att.reduce((s, u) => s + u.troops, 0);
  army.morale = att.length ? round(att.reduce((s, u) => s + u.morale, 0) / att.length) : 0;
  city.troops = def.reduce((s, u) => s + u.troops, 0);
  city.morale = def.length ? round(def.reduce((s, u) => s + u.morale, 0) / def.length) : 0;
  city.defense = hb.fort.defense;
}

const unitAt = (hb, c, r) => hb.units.find((u) => u.c === c && u.r === r && u.troops > 0);
const adjacentEnemy = (hb, u) => hexNeighbors(u.c, u.r).some(([c, r]) => { const t = unitAt(hb, c, r); return t && t.side !== u.side; });

export function hexReachable(state, hb, u) {
  if (u.moved || u.acted) return [];
  let mp = MP[u.type] ?? 3;
  if (adjacentEnemy(hb, u)) mp = Math.min(mp, 1); // ZOC: pinned, only 1 hex
  const seen = new Map([[`${u.c},${u.r}`, 0]]);
  const queue = [[u.c, u.r, 0]];
  const out = [];
  while (queue.length) {
    const [c, r, cost] = queue.shift();
    for (const [nc, nr] of hexNeighbors(c, r)) {
      const terrain = hb.grid[nr][nc];
      const step = MOVE_COST[terrain]?.[u.type] ?? 99;
      if (step >= 99) continue;
      const ncost = cost + step;
      if (ncost > mp) continue;
      const key = `${nc},${nr}`;
      if (seen.has(key) && seen.get(key) <= ncost) continue;
      seen.set(key, ncost);
      const occupant = unitAt(hb, nc, nr);
      const isFort = nc === hb.fort.c && nr === hb.fort.r;
      if (occupant) continue; // cannot pass through units
      if (isFort && !(u.side === "att" && hb.fort.defense <= 0)) continue; // fort blocks until breached
      out.push([nc, nr]);
      queue.push([nc, nr, ncost]);
    }
  }
  return out;
}

export function hexAttackTargets(state, hb, u) {
  if (u.acted) return [];
  const range = RANGE[u.type] ?? 1;
  const targets = hb.units.filter((t) => t.side !== u.side && t.troops > 0 && hexDist(u.c, u.r, t.c, t.r) <= range);
  if (u.side === "att" && hexDist(u.c, u.r, hb.fort.c, hb.fort.r) <= range) targets.push({ fort: true, c: hb.fort.c, r: hb.fort.r });
  return targets;
}

export function hexMove(state, hb, u, c, r) {
  u.c = c; u.r = r; u.moved = true;
  hb.log.push(`${nameOf(state, u)}移動至(${c},${r})。`);
  if (u.side === "att" && c === hb.fort.c && r === hb.fort.r && hb.fort.defense <= 0) {
    hb.concluded = true; hb.result = "attacker";
    hb.log.push(`攻軍入城壘，${state.cities[hb.battle.cityId].name}陷落！`);
  }
  syncAggregates(state, hb);
  checkConclusion(state, hb);
  return hb;
}

function nameOf(state, u) {
  const o = u.officerId ? state.officers[u.officerId] : null;
  return `${o ? o.name : ""}${TROOP_TYPES[u.type]?.name ?? u.type}`;
}

export function hexAttack(state, hb, u, target) {
  u.acted = true; u.moved = true;
  const city = state.cities[hb.battle.cityId];
  if (target.fort) {
    const dmg = round(u.troops * 0.02 * (0.6 + (state.officers[u.officerId]?.stats.lead ?? 50) / 100) * jitter(state));
    hb.fort.defense = clamp(hb.fort.defense - dmg, 0, 100);
    hb.log.push(`${nameOf(state, u)}攻城壘，城防-${dmg}（餘${hb.fort.defense}）。`);
    if (hb.fort.defense <= 0) hb.log.push("城壘已破！攻軍可入城。");
    syncAggregates(state, hb); checkConclusion(state, hb); return hb;
  }
  const aOff = u.officerId ? state.officers[u.officerId] : null;
  const dOff = target.officerId ? state.officers[target.officerId] : null;
  const aType = TROOP_TYPES[u.type], dType = TROOP_TYPES[target.type];
  const terrain = hb.grid[target.r][target.c];
  const aLead = (0.6 + (aOff?.stats.lead ?? 50) / 100 * 0.8) * traitMult(aOff, "battleLead");
  const dLead = (0.6 + (dOff?.stats.lead ?? 50) / 100 * 0.8) * traitMult(dOff, "battleLead");
  const aMor = 0.5 + u.morale / 100, dMor = 0.5 + target.morale / 100;
  const aTr = 0.6 + u.training / 200, dTr = 0.6 + target.training / 200;
  const terrA = aType.terrain[terrain] ?? 1, terrD = dType.terrain[terrain] ?? 1;
  let dmg = round(u.troops * 0.09 * aLead * aMor * aTr * aType.attack * terrA / (dType.defense * terrD) * jitter(state));
  dmg = Math.max(1, dmg);
  target.troops = Math.max(0, target.troops - dmg);
  target.morale = clamp(target.morale - round(dmg / Math.max(1, target.troops + dmg) * 30) - 3, 0, 100);
  hb.log.push(`${nameOf(state, u)}擊${nameOf(state, target)}，殺${dmg}。`);
  // counter-attack (melee, defender survives, not crossbow-vs-range)
  if (target.troops > 0 && hexDist(u.c, u.r, target.c, target.r) <= (RANGE[target.type] ?? 1)) {
    let cd = round(target.troops * 0.06 * dLead * dMor * dTr * dType.attack * terrD / (aType.defense * terrA) * jitter(state));
    cd = Math.max(1, cd);
    u.troops = Math.max(0, u.troops - cd);
    u.morale = clamp(u.morale - round(cd / Math.max(1, u.troops + cd) * 25) - 2, 0, 100);
    hb.log.push(`${nameOf(state, target)}反擊，殺${cd}。`);
  }
  // duel between commanders
  if (u.isCmd && target.isCmd && aOff && dOff && aOff.stats.war > 80 && dOff.stats.war > 80 && chance(state, 0.2)) {
    if (aOff.stats.war * jitter(state, 0.2) > dOff.stats.war * jitter(state, 0.2)) { target.morale = clamp(target.morale - 12, 0, 100); hb.log.push(`單挑！${aOff.name}勝${dOff.name}。`); }
    else { u.morale = clamp(u.morale - 12, 0, 100); hb.log.push(`單挑！${dOff.name}勝${aOff.name}。`); }
  }
  if (target.troops <= 0) hb.log.push(`${nameOf(state, target)}潰滅。`);
  if (u.troops <= 0) hb.log.push(`${nameOf(state, u)}潰滅。`);
  syncAggregates(state, hb);
  checkConclusion(state, hb);
  return hb;
}

export function hexAiPhase(state, hb, side) {
  for (const u of hb.units.filter((x) => x.side === side && x.troops > 0)) {
    if (hb.concluded) break;
    const targets = hexAttackTargets(state, hb, u);
    if (targets.length) {
      const best = targets.sort((a, b) => (a.fort ? 1 : 0) - (b.fort ? 1 : 0) || (a.troops ?? 0) - (b.troops ?? 0))[0];
      hexAttack(state, hb, u, best);
      continue;
    }
    const reach = hexReachable(state, hb, u);
    if (reach.length) {
      const enemies = hb.units.filter((x) => x.side !== side && x.troops > 0);
      const goal = side === "def" ? hb.fort : (enemies[0] ?? hb.fort);
      const bestHex = reach.sort((a, b) => hexDist(a[0], a[1], goal.c, goal.r) - hexDist(b[0], b[1], goal.c, goal.r))[0];
      hexMove(state, hb, u, bestHex[0], bestHex[1]);
    }
    u.acted = true; u.moved = true;
  }
}

export function hexEndPlayerPhase(state, hb) {
  const enemySide = hb.playerSide === "att" ? "def" : "att";
  hexAiPhase(state, hb, enemySide);
  if (hb.concluded) { syncAggregates(state, hb); return hb; }
  // supply + morale tick
  const army = hb.battle.army;
  const consume = round(army.troops * 0.03);
  army.food = Math.max(0, army.food - consume);
  if (army.food <= 0) { hb.starving += 1; for (const u of hb.units.filter((x) => x.side === "att")) u.morale = clamp(u.morale - 10, 0, 100); }
  else hb.starving = 0;
  hb.round += 1;
  for (const u of hb.units) { u.moved = false; u.acted = false; }
  hb.phase = "player"; hb.selected = null; hb.reachable = []; hb.targets = [];
  syncAggregates(state, hb);
  checkConclusion(state, hb);
  return hb;
}

export function checkConclusion(state, hb) {
  if (hb.concluded) return hb;
  const att = hb.units.filter((u) => u.side === "att" && u.troops > 0);
  const def = hb.units.filter((u) => u.side === "def" && u.troops > 0);
  const onFort = att.some((u) => u.c === hb.fort.c && u.r === hb.fort.r);
  if (onFort || def.length === 0) { hb.concluded = true; hb.result = "attacker"; }
  else if (att.length === 0) { hb.concluded = true; hb.result = "defender"; }
  else if (hb.retreat) { hb.concluded = true; hb.result = "retreat"; }
  else if (hb.starving >= 2) { hb.concluded = true; hb.result = "retreat"; hb.log.push("攻軍糧盡撤退。"); }
  else if (hb.round > hb.maxRounds) { hb.concluded = true; hb.result = "retreat"; hb.log.push("久攻不下，撤退。"); }
  if (hb.concluded) {
    syncAggregates(state, hb);
    hb.battle.concluded = true;
    hb.battle.result = hb.result;
    hb.battle.log.push(...hb.log.slice(-3));
  }
  return hb;
}
