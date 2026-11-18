// Warring States — core engine: game state, turn flow, economy, officers,
// armies, intelligence. Game State is the single source of truth; the UI only
// renders it. Pure logic (no DOM) so it is unit-testable in Node.

import { CITIES, CITY_BY_ID, OFFICER_BY_ID, STATES, TERRAIN_EFFECTS, GAME_VERSION, TROOP_TYPES, STATE_TROOP_MIX, DEFAULT_TROOP_MIX } from "./ws-data.mjs";
import { SCENARIO_BY_ID, TIER_BASE } from "./ws-scenarios.mjs";
import { clamp, round, nextRandom, randomInt, pick, chance, jitter, uid, sum, SEASON_OF_MONTH } from "./ws-util.mjs";
import { createBattle, autoResolveBattle, finalizeBattle } from "./ws-battle.mjs";
import { runAiTurn } from "./ws-ai.mjs";
import { checkScriptedEvents, checkBattleEvents, rollRandomEvents, applyEventEffects } from "./ws-events.mjs";
import { proposeDiplomacy, aiDiplomacy } from "./ws-diplomacy.mjs";

export const DIFFICULTIES = {
  easy: { name: "輕鬆", en: "Easy", aiResource: 0.85, aiAggression: 0.8, playerBonus: 1.15 },
  normal: { name: "正常", en: "Normal", aiResource: 1.0, aiAggression: 1.0, playerBonus: 1.0 },
  hard: { name: "困難", en: "Hard", aiResource: 1.2, aiAggression: 1.25, playerBonus: 0.9 },
};

export const TAX_RATES = { low: 0.6, normal: 1.0, high: 1.5 };

const SEASON_FOOD = [0.8, 1.0, 1.6, 0.4];

export function log(state, text, kind = "info") {
  state.log.push({ turn: state.turn, year: state.year, month: state.month, text, kind });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

// ---------------------------------------------------------------------------
// State creation
// ---------------------------------------------------------------------------
export function createGame(scenarioId, playerState, difficulty = "normal", seed = Date.now() % 2147483647) {
  const scenario = SCENARIO_BY_ID[scenarioId];
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
  if (!scenario.states.includes(playerState)) throw new Error(`State ${playerState} not in scenario`);
  const state = {
    version: GAME_VERSION,
    scenarioId, playerState, difficulty,
    seed, rngState: seed >>> 0, idCounter: 0,
    turn: 1, year: scenario.year, month: scenario.month,
    firedEvents: [], log: [], pendingBattles: [], activeBattle: null,
    states: {}, cities: {}, officers: {}, armies: [],
    outcome: null,
  };

  for (const key of scenario.states) {
    const meta = STATES[key];
    const relations = {};
    for (const other of scenario.states) {
      if (other === key) continue;
      const value = scenario.relations[`${key}:${other}`] ?? scenario.relations[`${other}:${key}`] ?? 0;
      relations[other] = { value: clamp(value, -100, 100), alliance: false, nap: false, trade: false, war: value <= -60 };
    }
    state.states[key] = {
      key, name: meta.name, color: meta.color, alive: true,
      ruler: scenario.rulers[key] ?? null,
      taxRate: "normal",
      personality: OFFICER_BY_ID[scenario.rulers[key]]?.personality ?? "cautious",
      relations,
    };
  }

  const activeCityIds = new Set(Object.keys(scenario.ownership));
  for (const city of CITIES) {
    const owner = scenario.ownership[city.id];
    const active = activeCityIds.has(city.id);
    const tier = TIER_BASE[city.tier] ?? TIER_BASE.minor;
    const scale = scenario.scale ?? 1;
    const override = scenario.cityOverrides?.[city.id] ?? {};
    state.cities[city.id] = {
      id: city.id, name: city.name, en: city.en, x: city.x, y: city.y,
      terrain: city.terrain, tier: city.tier, adjacent: [...city.adjacent], note: city.note ?? "",
      active, state: owner ?? null,
      population: round((override.population ?? tier.population) * scale),
      agriculture: override.agriculture ?? tier.agriculture,
      commerce: override.commerce ?? tier.commerce,
      order: override.order ?? tier.order,
      defense: override.defense ?? tier.defense,
      troops: round((override.troops ?? tier.troops) * scale),
      comp: buildComp(round((override.troops ?? tier.troops) * scale), owner, scenario.troopEra ?? "late"),
      gold: round((override.gold ?? tier.gold) * scale),
      food: round((override.food ?? tier.food) * scale),
      training: override.training ?? tier.training,
      morale: override.morale ?? tier.morale,
      governor: null, officers: [],
    };
  }

  const place = (officerId, cityId, position, ageEst, status = "active", loyalty = 78) => {
    const base = OFFICER_BY_ID[officerId];
    if (!base) throw new Error(`Unknown officer: ${officerId}`);
    const owner = state.cities[cityId]?.state;
    const age = base.birth != null ? state.year - base.birth : (ageEst ?? 40);
    state.officers[officerId] = {
      id: base.id, name: base.name, home: base.home,
      state: status === "free" ? null : owner,
      stats: { ...base.stats }, loyalty: status === "free" ? 50 : loyalty,
      ambition: base.ambition, personality: base.personality, traits: [...base.traits],
      birth: base.birth, death: base.death, age,
      status, location: cityId, position: position ?? null,
      acted: false, wounded: 0, bio: base.bio,
    };
    if (status !== "free" && cityId && state.cities[cityId]) state.cities[cityId].officers.push(officerId);
  };

  for (const [id, city, pos, ageEst] of scenario.placements) place(id, city, pos, ageEst, "active", 82);
  for (const [id, city] of scenario.freeOfficers ?? []) place(id, city, null, null, "free", 50);

  // Rulers govern their capital and start fully loyal.
  for (const key of scenario.states) {
    const rulerId = state.states[key].ruler;
    const ruler = state.officers[rulerId];
    if (ruler) {
      ruler.loyalty = 100;
      ruler.position = "governor";
      const capital = Object.values(state.cities).find((c) => c.state === key && c.tier === "capital");
      if (capital) { capital.governor = rulerId; ruler.location = capital.id; }
    }
  }

  log(state, `${scenario.name}（${state.year < 0 ? "公元前" + -state.year : state.year}年）開始。玩家選擇${STATES[playerState].name}國。`, "start");
  return state;
}

// ---------------------------------------------------------------------------
// Lookups & totals
// ---------------------------------------------------------------------------
export const cityOf = (state, id) => state.cities[id];
export const officerOf = (state, id) => state.officers[id];
export const citiesOf = (state, key) => Object.values(state.cities).filter((c) => c.active && c.state === key);
export const officersOf = (state, key) => Object.values(state.officers).filter((o) => o.state === key && o.status === "active");
export const officersInCity = (state, cityId) => Object.values(state.officers).filter((o) => o.location === cityId && (o.status === "active" || o.status === "free"));
export const activeOfficersInCity = (state, cityId) => Object.values(state.officers).filter((o) => o.location === cityId && o.status === "active");
export const freeOfficersInCity = (state, cityId) => Object.values(state.officers).filter((o) => o.location === cityId && o.status === "free");

export function stateTotals(state, key) {
  const cities = citiesOf(state, key);
  return {
    cities: cities.length,
    population: sum(cities, (c) => c.population),
    troops: sum(cities, (c) => c.troops) + sum(state.armies.filter((a) => a.state === key), (a) => a.troops),
    gold: sum(cities, (c) => c.gold),
    food: sum(cities, (c) => c.food),
    officers: officersOf(state, key).length,
  };
}

export function traitMult(officer, effect) {
  if (!officer) return 1;
  let mult = 1;
  if (officer.traits.includes("名將") && effect === "battleLead") mult *= 1.1;
  if (officer.traits.includes("猛將") && effect === "charge") mult *= 1.15;
  if (officer.traits.includes("神算") && effect === "stratagem") mult *= 1.2;
  if (officer.traits.includes("築城") && effect === "defense") mult *= 1.5;
  if (officer.traits.includes("屯田") && effect === "agriculture") mult *= 1.5;
  if (officer.traits.includes("商才") && effect === "commerce") mult *= 1.5;
  if (officer.traits.includes("名士") && effect === "recruit") mult *= 1.15;
  if (officer.traits.includes("辯士") && effect === "diplomacy") mult *= 1.2;
  if (officer.traits.includes("養士") && effect === "recruit") mult *= 1.25;
  if (officer.traits.includes("法家") && effect === "develop") mult *= 1.15;
  if (officer.traits.includes("兵家") && effect === "train") mult *= 1.5;
  if (officer.traits.includes("變法") && effect === "develop") mult *= 1.1;
  if (officer.traits.includes("千古一帝") && effect === "all") mult *= 1.1;
  if (officer.traits.includes("刺客") && effect === "assassin") mult *= 1.3;
  if (officer.traits.includes("胡服騎射") && effect === "cavalry") mult *= 1.25;
  if (officer.traits.includes("紙上談兵") && effect === "battleLead") mult *= 0.8;
  return mult;
}

function rulerOf(state, key) {
  return state.officers[state.states[key]?.ruler];
}

export function isPlayer(state, key) {
  return key === state.playerState;
}

function requireOfficer(state, officerId, cityId) {
  const officer = state.officers[officerId];
  if (!officer || officer.status !== "active") return { ok: false, reason: "武將不存在或不在職。" };
  if (officer.acted) return { ok: false, reason: `${officer.name}本回合已行動。` };
  if (cityId && officer.location !== cityId) return { ok: false, reason: `${officer.name}不在該城。` };
  if (officer.wounded > 0) return { ok: false, reason: `${officer.name}傷病未癒。` };
  return { ok: true, officer };
}

function spend(city, gold, food) {
  if (city.gold < gold || city.food < food) return false;
  city.gold -= gold; city.food -= food;
  return true;
}

// ---------------------------------------------------------------------------
// Domestic affairs. Each: cost → officer → formula → result → side effect.
// ---------------------------------------------------------------------------
export const DOMESTIC = {
  agriculture: { name: "開墾", en: "Farm", gold: 250, food: 0, desc: "農業+。政治影響。" },
  commerce: { name: "商業", en: "Trade", gold: 250, food: 0, desc: "商業+。政治影響。" },
  defense: { name: "城防", en: "Fortify", gold: 300, food: 0, desc: "城防+。政治影響，築城×1.5。" },
  order: { name: "治安", en: "Order", gold: 150, food: 0, desc: "治安+。政治、魅力影響。" },
  train: { name: "訓練", en: "Drill", gold: 200, food: 500, desc: "訓練+。統率、武力影響，兵家×1.5。" },
  recruit: { name: "徵兵", en: "Recruit", gold: 0, food: 0, desc: "兵力+。魅力影響；耗金糧、降人口治安。" },
  relief: { name: "賑濟", en: "Relief", gold: 0, food: 2000, desc: "治安+、民心+。耗糧。" },
};

// Maximum sustainable garrison = 20% of city population. Recruitment cannot
// push troops above this cap (starting historical armies may exceed it).
export const TROOP_POP_RATIO = 0.2;
export function troopCap(city) {
  return round(city.population * TROOP_POP_RATIO);
}

// ---- Troop composition (兵種). comp = { typeId: count }; troops = sum(comp). ----
export function compTotal(comp) {
  let t = 0; for (const k in comp) t += comp[k] || 0; return t;
}
export function buildComp(total, stateKey, era = "late") {
  const mix = { ...(STATE_TROOP_MIX[stateKey] ?? DEFAULT_TROOP_MIX) };
  if (era === "spring") { mix.chariot = (mix.chariot || 0) + 0.3; mix.cavalry = (mix.cavalry || 0) * 0.3; }
  else if (era === "early") { mix.chariot = (mix.chariot || 0) + 0.12; mix.cavalry = (mix.cavalry || 0) * 0.7; }
  else { mix.chariot = (mix.chariot || 0) * 0.3; mix.cavalry = (mix.cavalry || 0) + 0.08; }
  let sum = 0; for (const k in mix) sum += mix[k];
  const comp = {}; let assigned = 0; const keys = Object.keys(mix);
  keys.forEach((k, i) => {
    if (i === keys.length - 1) comp[k] = Math.max(0, total - assigned);
    else { const v = round(total * mix[k] / sum); comp[k] = v; assigned += v; }
  });
  return comp;
}
export function scaleComp(comp, factor) { for (const k in comp) comp[k] = round((comp[k] || 0) * factor); }
// Works on any entity with { comp, troops } (city or army).
export function setTroops(entity, total) {
  if (!entity.comp) entity.comp = entity.troops > 0 ? { infantry: entity.troops } : {};
  const cur = compTotal(entity.comp);
  scaleComp(entity.comp, cur > 0 ? Math.max(0, total) / cur : 0);
  entity.troops = compTotal(entity.comp);
}
export function addTroops(city, type, amount) {
  city.comp[type] = (city.comp[type] || 0) + amount;
  city.troops = compTotal(city.comp);
}
export function takeTroops(city, amount) {
  const total = city.troops || 0;
  const f = total > 0 ? Math.min(1, amount / total) : 0;
  const slice = {};
  for (const k in city.comp) { const take = round((city.comp[k] || 0) * f); slice[k] = take; city.comp[k] = (city.comp[k] || 0) - take; }
  city.troops = compTotal(city.comp);
  return slice;
}
export function mergeComp(target, source) { for (const k in source) if (source[k]) target[k] = (target[k] || 0) + source[k]; }
export function compStat(comp, stat) {
  const t = compTotal(comp); if (t <= 0) return 1;
  let s = 0; for (const k in comp) { const type = TROOP_TYPES[k]; if (type) s += (comp[k] || 0) / t * type[stat]; }
  return s || 1;
}
export function compTerrain(comp, terrain) {
  const t = compTotal(comp); if (t <= 0) return 1;
  let s = 0; for (const k in comp) { const type = TROOP_TYPES[k]; if (type) s += (comp[k] || 0) / t * (type.terrain[terrain] ?? 1); }
  return s || 1;
}
export const compAttack = (comp) => compStat(comp, "attack");
export const compDefense = (comp) => compStat(comp, "defense");

export function develop(state, cityId, type, officerId, troopType = "infantry") {
  const city = state.cities[cityId];
  if (!city || city.state !== state.playerState && !isAiAllowed(state, city)) return { ok: false, reason: "非己方城市。" };
  const check = requireOfficer(state, officerId, cityId);
  if (!check.ok) return check;
  const officer = check.officer;
  const spec = DOMESTIC[type];
  if (!spec) return { ok: false, reason: "未知內政。" };
  const pol = officer.stats.pol, cha = officer.stats.cha, lead = officer.stats.lead, war = officer.stats.war;
  const emperor = traitMult(officer, "all");
  let gain = 0, side = "";

  if (type === "recruit") {
    const tt = TROOP_TYPES[troopType] ?? TROOP_TYPES.infantry;
    const cap = troopCap(city);
    const room = cap - city.troops;
    const desired = round((1500 + cha * 28 + pol * 8) * emperor);
    // recruiting shrinks population by amount*0.5, so the cap shrinks too;
    // solve amount such that troops+amount <= (population-amount*0.5)*ratio.
    const amount = Math.min(desired, Math.floor(room / (1 + 0.5 * TROOP_POP_RATIO)), round(city.population * 0.06));
    if (amount < 500) return { ok: false, reason: `${city.name}已達徵兵上限（人口20%＝${cap}），無法再徵。` };
    const goldCost = round(amount / 1000 * tt.gold), foodCost = round(amount / 1000 * tt.food);
    if (!spend(city, goldCost, foodCost)) return { ok: false, reason: "金糧不足。" };
    addTroops(city, tt.id, amount);
    city.population = round(city.population - amount * 0.5);
    city.order = clamp(city.order - 2, 0, 100);
    gain = amount; side = `${tt.name}・人口-${round(amount * 0.5)}，治安-2`;
  } else if (type === "relief") {
    if (!spend(city, 0, spec.food)) return { ok: false, reason: "糧食不足。" };
    city.order = clamp(city.order + 8, 0, 100);
    city.morale = clamp(city.morale + 5, 0, 100);
    gain = 8; side = "民心+5";
  } else {
    if (!spend(city, spec.gold, spec.food)) return { ok: false, reason: "金錢不足。" };
    const devMult = traitMult(officer, "develop") * emperor;
    if (type === "agriculture") gain = round((2 + pol / 22) * traitMult(officer, "agriculture") * devMult);
    if (type === "commerce") gain = round((2 + pol / 22) * traitMult(officer, "commerce") * devMult);
    if (type === "defense") gain = round((2 + pol / 28) * traitMult(officer, "defense") * devMult);
    if (type === "order") gain = round((3 + pol / 20 + cha / 45) * devMult);
    if (type === "train") gain = round((3 + lead / 24 + war / 40) * traitMult(officer, "train") * devMult);
    const statKey = { agriculture: "agriculture", commerce: "commerce", defense: "defense", order: "order", train: "training" }[type];
    city[statKey] = clamp(city[statKey] + gain, 0, 100);
  }
  officer.acted = true;
  const label = type === "recruit" ? `徵兵+${gain}` : type === "relief" ? `治安+${gain}` : `${spec.name}+${gain}`;
  log(state, `${city.name}：${officer.name}${label}${side ? "（" + side + "）" : ""}。`, "domestic");
  return { ok: true, gain, label };
}

function isAiAllowed(state, city) {
  // AI uses the same develop() via api; allow when called for an AI city.
  return city.state && city.state !== state.playerState;
}

export function setTaxRate(state, key, rate) {
  if (!TAX_RATES[rate]) return { ok: false, reason: "無效稅率。" };
  state.states[key].taxRate = rate;
  log(state, `${STATES[key].name}調整稅率為${{ low: "低", normal: "中", high: "高" }[rate]}。`, "policy");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Personnel
// ---------------------------------------------------------------------------
export function search(state, cityId, officerId) {
  const city = state.cities[cityId];
  const check = requireOfficer(state, officerId, cityId);
  if (!check.ok) return check;
  const officer = check.officer;
  if (!spend(city, 100, 0)) return { ok: false, reason: "金錢不足。" };
  officer.acted = true;
  const free = freeOfficersInCity(state, cityId);
  const bonus = traitMult(officer, "recruit");
  if (free.length && chance(state, 0.75 * bonus)) {
    const found = pick(state, free);
    log(state, `${city.name}：${officer.name}探索發現隱士${found.name}！可登用。`, "personnel");
    return { ok: true, found: found.id };
  }
  if (officer.traits.includes("養士") && chance(state, 0.5)) {
    const wanderer = spawnWanderer(state, cityId);
    log(state, `${city.name}：${officer.name}養士之名遠播，${wanderer.name}來投。`, "personnel");
    return { ok: true, found: wanderer.id };
  }
  log(state, `${city.name}：${officer.name}探索，未有所獲。`, "personnel");
  return { ok: true, found: null };
}

let wandererCounter = 0;
const WANDERER_NAMES = ["無名俠士", "遊學書生", "隱逸高人", "落魄劍客", "行商智者", "鄉野賢才"];
export function spawnWanderer(state, cityId) {
  wandererCounter += 1;
  const id = `wanderer_${state.idCounter}_${wandererCounter}`;
  const name = pick(state, WANDERER_NAMES);
  const stat = () => randomInt(state, 45, 82);
  state.officers[id] = {
    id, name, home: null, state: null,
    stats: { lead: stat(), war: stat(), int: stat(), pol: stat(), cha: stat() },
    loyalty: 50, ambition: randomInt(state, 20, 70), personality: pick(state, ["bold", "cautious", "loyal", "diplomatic"]),
    traits: chance(state, 0.2) ? [pick(state, ["名士", "猛將", "神算", "商才"])] : [],
    birth: null, death: null, age: randomInt(state, 22, 55),
    status: "free", location: cityId, position: null, acted: false, wounded: 0,
    bio: "四方遊士，聞風而來。（遊戲生成人物，非史實）",
  };
  return state.officers[id];
}

export function recruitOfficer(state, cityId, targetId, officerId, gift = 0) {
  const city = state.cities[cityId];
  const check = requireOfficer(state, officerId, cityId);
  if (!check.ok) return check;
  const officer = check.officer;
  const target = state.officers[targetId];
  if (!target || target.location !== cityId) return { ok: false, reason: "目標不在該城。" };
  if (target.status !== "free" && target.status !== "captured") return { ok: false, reason: "目標不可登用。" };
  const goldCost = 200 + gift;
  if (!spend(city, goldCost, 0)) return { ok: false, reason: "金錢不足。" };
  officer.acted = true;
  const bonus = traitMult(officer, "recruit");
  const resistance = target.loyalty * 0.4 + target.ambition * 0.3 - gift / 20;
  const probability = clamp(0.35 + (officer.stats.cha - resistance) / 130, 0.05, 0.95) * bonus;
  if (chance(state, probability)) {
    target.status = "active";
    target.state = city.state;
    target.loyalty = clamp(55 + gift / 30 + officer.stats.cha / 10, 40, 90);
    target.position = null;
    if (!city.officers.includes(targetId)) city.officers.push(targetId);
    log(state, `${city.name}：${officer.name}成功登用${target.name}！`, "personnel");
    return { ok: true, recruited: true };
  }
  log(state, `${city.name}：${officer.name}登用${target.name}失敗。`, "personnel");
  return { ok: true, recruited: false };
}

export function reward(state, officerId, amount = 300) {
  const officer = state.officers[officerId];
  if (!officer || officer.state !== state.playerState) return { ok: false, reason: "非己方武將。" };
  const city = state.cities[officer.location];
  const mult = officer.traits.includes("貪婪") ? 1.5 : 1;
  const cost = round(amount * mult);
  if (!city || !spend(city, cost, 0)) return { ok: false, reason: "金錢不足。" };
  const gain = round(10 * (amount / 300));
  officer.loyalty = clamp(officer.loyalty + gain, 0, 100);
  log(state, `${officer.name}受褒賞${cost}金，忠誠+${gain}。`, "personnel");
  return { ok: true, gain };
}

export function transferOfficer(state, officerId, toCityId) {
  const officer = state.officers[officerId];
  if (!officer || officer.status !== "active") return { ok: false, reason: "武將不在職。" };
  if (officer.acted) return { ok: false, reason: "本回合已行動。" };
  const from = state.cities[officer.location];
  const to = state.cities[toCityId];
  if (!to || to.state !== officer.state) return { ok: false, reason: "目標非己方城市。" };
  if (!from.adjacent.includes(toCityId)) return { ok: false, reason: "只能移動至相鄰城市。" };
  from.officers = from.officers.filter((id) => id !== officerId);
  if (from.governor === officerId) from.governor = null;
  to.officers.push(officerId);
  officer.location = toCityId;
  officer.position = null;
  officer.acted = true;
  log(state, `${officer.name}自${from.name}移駐${to.name}。`, "personnel");
  return { ok: true };
}

export function appointGovernor(state, cityId, officerId) {
  const city = state.cities[cityId];
  const officer = state.officers[officerId];
  if (!city || !officer || officer.location !== cityId || officer.status !== "active") return { ok: false, reason: "無效任命。" };
  if (city.state !== officer.state) return { ok: false, reason: "非己方城市。" };
  city.governor = officerId;
  officer.position = "governor";
  log(state, `${officer.name}任${city.name}太守。`, "personnel");
  return { ok: true };
}

export function assignPosition(state, officerId, position) {
  const officer = state.officers[officerId];
  if (!officer || officer.status !== "active") return { ok: false, reason: "武將不在職。" };
  if (position && !["general", "advisor", "governor"].includes(position)) return { ok: false, reason: "無效職位。" };
  officer.position = position;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Armies & logistics
// ---------------------------------------------------------------------------
export function moveArmy(state, fromId, toId, troops, commanderId, officerIds = [], food = null) {
  const from = state.cities[fromId], to = state.cities[toId];
  if (!from || !to) return { ok: false, reason: "城市不存在。" };
  if (from.state !== to.state) return { ok: false, reason: "移動目標須為己方城市（攻擊請用出陣）。" };
  if (!from.adjacent.includes(toId)) return { ok: false, reason: "只能移至相鄰城市。" };
  const commander = state.officers[commanderId];
  if (!commander || commander.location !== fromId || commander.status !== "active") return { ok: false, reason: "須指派城中武將為指揮。" };
  if (commander.acted) return { ok: false, reason: "指揮本回合已行動。" };
  troops = clamp(round(troops), 0, from.troops - 500);
  if (troops < 1000) return { ok: false, reason: "兵力須≥1000（留500守城）。" };
  const carried = food != null ? clamp(round(food), 0, from.food) : round(troops * 0.15);
  if (from.food < carried) return { ok: false, reason: "糧草不足。" };
  const slice = takeTroops(from, troops); from.food -= carried;
  const ids = [commanderId, ...officerIds.filter((id) => id !== commanderId && state.officers[id]?.location === fromId && state.officers[id]?.status === "active" && !state.officers[id].acted)];
  from.officers = from.officers.filter((id) => !ids.includes(id));
  if (from.governor && ids.includes(from.governor)) from.governor = null;
  for (const id of ids) { state.officers[id].acted = true; state.officers[id].location = null; }
  const army = { id: uid(state, "army"), state: from.state, commander: commanderId, officers: ids, troops: compTotal(slice), comp: slice, morale: from.morale, training: from.training, food: carried, from: fromId, target: toId, kind: "move", turnsLeft: 1, status: "marching" };
  state.armies.push(army);
  log(state, `${commander.name}率${troops}兵自${from.name}移駐${to.name}。`, "military");
  return { ok: true, armyId: army.id };
}

export function transport(state, fromId, toId, gold, food) {
  const from = state.cities[fromId], to = state.cities[toId];
  if (!from || !to || from.state !== to.state) return { ok: false, reason: "須為己方相鄰城市。" };
  if (!from.adjacent.includes(toId)) return { ok: false, reason: "只能運至相鄰城市。" };
  gold = clamp(round(gold), 0, from.gold); food = clamp(round(food), 0, from.food);
  from.gold -= gold; from.food -= food; to.gold += gold; to.food += food;
  log(state, `${from.name}運${gold}金、${food}糧至${to.name}。`, "military");
  return { ok: true };
}

export function attack(state, fromId, targetId, troops, commanderId, officerIds = [], food = null) {
  const from = state.cities[fromId], target = state.cities[targetId];
  if (!from || !target || !target.active) return { ok: false, reason: "城市不存在。" };
  if (from.state === target.state) return { ok: false, reason: "不可攻擊己方城市。" };
  if (!from.adjacent.includes(targetId)) return { ok: false, reason: "只能攻擊相鄰城市。" };
  const rel = state.states[from.state].relations[target.state];
  if (rel?.alliance) return { ok: false, reason: "與目標同盟，須先破盟。" };
  const commander = state.officers[commanderId];
  if (!commander || commander.location !== fromId || commander.status !== "active") return { ok: false, reason: "須指派城中武將為主帥。" };
  if (commander.acted) return { ok: false, reason: "主帥本回合已行動。" };
  troops = clamp(round(troops), 0, from.troops - 500);
  if (troops < 1000) return { ok: false, reason: "兵力須≥1000。" };
  const carried = food != null ? clamp(round(food), 0, from.food) : round(troops * 0.12);
  if (from.food < carried) return { ok: false, reason: "糧草不足。" };
  const slice = takeTroops(from, troops); from.food -= carried;
  const ids = [commanderId, ...officerIds.filter((id) => id !== commanderId && state.officers[id]?.location === fromId && state.officers[id]?.status === "active" && !state.officers[id].acted)];
  from.officers = from.officers.filter((id) => !ids.includes(id));
  if (from.governor && ids.includes(from.governor)) from.governor = null;
  for (const id of ids) { state.officers[id].acted = true; state.officers[id].location = null; }
  rel.war = true; rel.nap = false; rel.value = clamp(rel.value - 20, -100, 100);
  const army = { id: uid(state, "army"), state: from.state, commander: commanderId, officers: ids, troops: compTotal(slice), comp: slice, morale: from.morale, training: from.training, food: carried, from: fromId, target: targetId, kind: "attack", turnsLeft: 1, status: "marching" };
  state.armies.push(army);
  log(state, `${commander.name}率${troops}兵自${from.name}出陣，攻${target.name}（${STATES[target.state].name}）！`, "military");
  return { ok: true, armyId: army.id };
}

// ---------------------------------------------------------------------------
// Intelligence
// ---------------------------------------------------------------------------
export const STRATAGEMS = {
  rumor: { name: "流言", en: "Rumor", gold: 200, desc: "敵城治安-、武將忠誠-。" },
  sabotage: { name: "破壞", en: "Sabotage", gold: 300, desc: "相鄰敵城城防-。" },
  discord: { name: "離間", en: "Discord", gold: 350, desc: "敵武將忠誠-。" },
};

export function stratagem(state, cityId, officerId, type, targetCityId, targetOfficerId = null) {
  const city = state.cities[cityId];
  const check = requireOfficer(state, officerId, cityId);
  if (!check.ok) return check;
  const officer = check.officer;
  const spec = STRATAGEMS[type];
  if (!spec) return { ok: false, reason: "未知計略。" };
  const target = state.cities[targetCityId];
  if (!target || target.state === city.state) return { ok: false, reason: "目標須為敵城。" };
  if (type === "sabotage" && !city.adjacent.includes(targetCityId)) return { ok: false, reason: "破壞須相鄰。" };
  if (!spend(city, spec.gold, 0)) return { ok: false, reason: "金錢不足。" };
  officer.acted = true;
  const advisor = activeOfficersInCity(state, targetCityId).sort((a, b) => b.stats.int - a.stats.int)[0];
  const defenseInt = advisor ? advisor.stats.int : 40;
  let probability = clamp(0.4 + (officer.stats.int - defenseInt) / 180, 0.08, 0.9) * traitMult(officer, "stratagem");
  if (officer.traits.includes("奸佞")) probability *= 1.15;
  if (!chance(state, probability)) {
    log(state, `${officer.name}對${target.name}施${spec.name}，為敵所識，失敗。`, "intel");
    return { ok: true, success: false };
  }
  if (type === "rumor") {
    target.order = clamp(target.order - 8, 0, 100);
    for (const o of activeOfficersInCity(state, targetCityId)) o.loyalty = clamp(o.loyalty - 4, 0, 100);
  } else if (type === "sabotage") {
    target.defense = clamp(target.defense - 10, 0, 100);
  } else if (type === "discord") {
    const t = state.officers[targetOfficerId];
    if (t && t.state === target.state) t.loyalty = clamp(t.loyalty - 15, 0, 100);
  }
  log(state, `${officer.name}對${target.name}施${spec.name}，成功！`, "intel");
  return { ok: true, success: true };
}

// ---------------------------------------------------------------------------
// Diplomacy (delegates to ws-diplomacy.mjs)
// ---------------------------------------------------------------------------
export function diplomacy(state, action, fromKey, toKey, officerId, options = {}) {
  return proposeDiplomacy(state, action, fromKey, toKey, officerId, options);
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------
function resolveArrivals(state) {
  for (const army of state.armies) {
    army.turnsLeft -= 1;
    const consume = round(army.troops * 0.03 * (state.officers[army.commander]?.traits.includes("屯田") ? 0.8 : 1));
    army.food -= consume;
    if (army.food < 0) {
      army.food = 0;
      army.morale = clamp(army.morale - 12, 0, 100);
      scaleComp(army.comp, 0.94); army.troops = compTotal(army.comp);
      log(state, `${state.officers[army.commander]?.name ?? "軍"}軍糧盡，士氣潰散，減員。`, "military");
    }
  }
  const arriving = state.armies.filter((a) => a.turnsLeft <= 0);
  for (const army of arriving) {
    const target = state.cities[army.target];
    if (army.kind === "move" || army.kind === "reinforce") {
      if (target && target.state === army.state) {
        mergeComp(target.comp, army.comp); target.troops = compTotal(target.comp);
        target.food += army.food;
        target.morale = round((target.morale + army.morale) / 2);
        for (const id of army.officers) {
          const o = state.officers[id];
          if (o) { o.location = target.id; o.status = "active"; if (!target.officers.includes(id)) target.officers.push(id); }
        }
        log(state, `${state.officers[army.commander]?.name ?? "軍"}抵達${target.name}，併入守軍。`, "military");
      } else {
        // target lost en route — disband back to nearest own city
        disbandArmy(state, army);
      }
      state.armies = state.armies.filter((a) => a.id !== army.id);
    } else if (army.kind === "attack") {
      if (!target || !target.active) { disbandArmy(state, army); state.armies = state.armies.filter((a) => a.id !== army.id); continue; }
      if (target.state === army.state) {
        // city changed hands to friendly — merge
        mergeComp(target.comp, army.comp); target.troops = compTotal(target.comp); target.food += army.food;
        for (const id of army.officers) { const o = state.officers[id]; if (o) { o.location = target.id; o.status = "active"; if (!target.officers.includes(id)) target.officers.push(id); } }
        state.armies = state.armies.filter((a) => a.id !== army.id);
        continue;
      }
      const playerInvolved = army.state === state.playerState || target.state === state.playerState;
      if (playerInvolved) {
        const battle = createBattle(state, army);
        state.pendingBattles.push(battle);
        state.armies = state.armies.filter((a) => a.id !== army.id);
      } else {
        const battle = autoResolveBattle(state, army);
        checkBattleEvents(state, battle);
        state.armies = state.armies.filter((a) => a.id !== army.id);
      }
    }
  }
}

function disbandArmy(state, army) {
  const home = state.cities[army.from];
  const fallback = home && home.state === army.state ? home : citiesOf(state, army.state)[0];
  if (fallback) {
    mergeComp(fallback.comp, army.comp); fallback.troops = compTotal(fallback.comp); fallback.food += army.food;
    for (const id of army.officers) { const o = state.officers[id]; if (o) { o.location = fallback.id; o.status = "active"; if (!fallback.officers.includes(id)) fallback.officers.push(id); } }
  } else {
    for (const id of army.officers) { const o = state.officers[id]; if (o) o.status = "captured"; }
  }
}

function upkeep(state) {
  const season = SEASON_OF_MONTH[state.month - 1];
  for (const city of Object.values(state.cities)) {
    if (!city.active || !city.state) continue;
    const st = state.states[city.state];
    const governor = city.governor ? state.officers[city.governor] : null;
    const govBonus = governor ? 1 + governor.stats.pol / 250 : 1;
    const tax = TAX_RATES[st.taxRate] ?? 1;
    const diff = DIFFICULTIES[state.difficulty];
    const aiMult = city.state === state.playerState ? diff.playerBonus : diff.aiResource;

    const goldIncome = round(city.commerce * 6 * tax * (0.5 + city.order / 200) * govBonus * aiMult);
    const foodIncome = round(city.agriculture * 11 * SEASON_FOOD[season] * govBonus * aiMult);
    city.gold += goldIncome;
    city.food += foodIncome;

    const consume = round(city.troops * 0.03);
    city.food -= consume;
    if (city.food < 0) {
      city.food = 0;
      city.morale = clamp(city.morale - 8, 0, 100);
      setTroops(city, round(city.troops * 0.96));
      city.order = clamp(city.order - 4, 0, 100);
    }
    city.population = round(city.population * (1 + 0.003 * (city.order / 100)));
    city.order = clamp(city.order + (governor ? 2 : 0) - (tax > 1 ? 2 : 0) - (city.order > 60 ? 1 : 0), 0, 100);
    city.training = clamp(city.training - 1, 0, 100);
    city.morale = clamp(city.morale + (city.order > 60 ? 1 : -1), 0, 100);
    city.gold = round(city.gold); city.food = round(city.food); city.troops = round(city.troops);
  }

  // officer loyalty drift, aging, wounds
  for (const officer of Object.values(state.officers)) {
    if (officer.status !== "active" || !officer.state) continue;
    if (officer.wounded > 0) {
      officer.wounded -= officer.traits.includes("醫術") ? 2 : 1;
      if (officer.wounded < 0) officer.wounded = 0;
    }
    if (officer.id === state.states[officer.state]?.ruler) { officer.loyalty = 100; continue; }
    const totals = stateTotals(state, officer.state);
    const weakness = totals.cities <= 2 ? 3 : 0;
    const drift = (officer.ambition > 70 ? 2 : 0) + weakness - (officer.traits.includes("忠義") ? 2 : 1);
    officer.loyalty = clamp(officer.loyalty - drift + randomInt(state, -1, 1), 0, 100);
    if (officer.loyalty < 25 && officer.ambition > 65 && chance(state, 0.12)) {
      defectOfficer(state, officer);
    }
  }
}

function defectOfficer(state, officer) {
  const rivals = Object.values(state.states).filter((s) => s.alive && s.key !== officer.state && s.relations[officer.state]?.value < -20);
  const target = pick(state, rivals);
  const from = state.cities[officer.location];
  if (from) from.officers = from.officers.filter((id) => id !== officer.id);
  if (from?.governor === officer.id) from.governor = null;
  if (target) {
    const cap = citiesOf(state, target.key).find((c) => c.tier === "capital") ?? citiesOf(state, target.key)[0];
    officer.state = target.key; officer.location = cap?.id ?? null; officer.loyalty = 60; officer.position = null;
    if (cap) cap.officers.push(officer.id);
    log(state, `${officer.name}心懷異志，叛奔${target.name}！`, "defect");
  } else {
    officer.status = "free"; officer.state = null; officer.loyalty = 50;
    log(state, `${officer.name}掛印而去，成為在野。`, "defect");
  }
}

function ageOfficers(state) {
  for (const officer of Object.values(state.officers)) {
    if (officer.status === "dead") continue;
    if (officer.birth != null) officer.age = state.year - officer.birth;
    else officer.age += 1;
    if (officer.death != null && state.year >= officer.death && officer.status !== "dead") {
      // historical death handled by scripted events; generic fallback for unscripted
      if (!state.firedEvents.some((id) => id.includes(officer.id))) {
        // leave scripted deaths to events; only natural death for very old unknowns
      }
    }
    if (officer.birth == null && officer.age > 78 && chance(state, 0.15) && officer.status === "active") {
      officer.status = "dead";
      const city = state.cities[officer.location];
      if (city) { city.officers = city.officers.filter((id) => id !== officer.id); if (city.governor === officer.id) city.governor = null; }
      log(state, `${officer.name}病逝（年${officer.age}）。`, "death");
      if (state.states[officer.state]?.ruler === officer.id) succeedRuler(state, officer.state);
    }
  }
}

export function succeedRuler(state, key) {
  const st = state.states[key];
  if (!st?.alive) return;
  const candidates = officersOf(state, key).filter((o) => o.id !== st.ruler);
  const heir = candidates.sort((a, b) => (b.stats.cha + b.stats.pol) - (a.stats.cha + a.stats.pol))[0];
  if (heir) {
    st.ruler = heir.id; heir.loyalty = 100;
    log(state, `${STATES[key].name}以${heir.name}繼位（史實繼承人待考，遊戲以重臣繼之）。`, "succession");
  } else {
    eliminateState(state, key, "無後繼");
  }
}

export function eliminateState(state, key, reason = "") {
  const st = state.states[key];
  if (!st || !st.alive) return;
  st.alive = false;
  for (const o of officersOf(state, key)) { o.status = "free"; o.state = null; o.loyalty = 50; }
  log(state, `${STATES[key].name}亡${reason ? "（" + reason + "）" : ""}。`, "fall");
}

function checkVictory(state) {
  if (state.outcome) return;
  const playerCities = citiesOf(state, state.playerState);
  const activeCities = Object.values(state.cities).filter((c) => c.active);
  if (playerCities.length === 0) {
    state.outcome = { result: "defeat", text: "山河破碎，社稷傾覆。" };
    log(state, "玩家失去所有城市，敗亡。", "outcome");
    return;
  }
  const rivals = Object.values(state.states).filter((s) => s.alive && s.key !== state.playerState);
  const rivalCities = activeCities.filter((c) => c.state !== state.playerState);
  if (rivalCities.length === 0 || rivals.every((r) => citiesOf(state, r.key).length === 0)) {
    state.outcome = { result: "victory", text: "六王畢，四海一。天下並為一統！" };
    log(state, "玩家統一天下，勝利！", "outcome");
  }
}

// AI api surface (dependency injection avoids circular imports).
function buildApi(state) {
  return {
    develop: (cityId, type, officerId, troopType) => develop(state, cityId, type, officerId, troopType),
    setTaxRate: (key, rate) => setTaxRate(state, key, rate),
    search: (cityId, officerId) => search(state, cityId, officerId),
    recruitOfficer: (cityId, targetId, officerId, gift) => recruitOfficer(state, cityId, targetId, officerId, gift),
    reward: (officerId, amount) => reward(state, officerId, amount),
    transferOfficer: (officerId, toCityId) => transferOfficer(state, officerId, toCityId),
    appointGovernor: (cityId, officerId) => appointGovernor(state, cityId, officerId),
    moveArmy: (fromId, toId, troops, commanderId, officerIds, food) => moveArmy(state, fromId, toId, troops, commanderId, officerIds, food),
    attack: (fromId, targetId, troops, commanderId, officerIds, food) => attack(state, fromId, targetId, troops, commanderId, officerIds, food),
    stratagem: (cityId, officerId, type, targetCityId, targetOfficerId) => stratagem(state, cityId, officerId, type, targetCityId, targetOfficerId),
    diplomacy: (action, fromKey, toKey, officerId, options) => proposeDiplomacy(state, action, fromKey, toKey, officerId, options),
  };
}

// End the player turn: AI → events → upkeep → time → arrivals/battles.
// Returns pendingBattles for the UI to resolve interactively (player involved).
export function endTurn(state) {
  if (state.outcome) return { pendingBattles: [], outcome: state.outcome };
  const report = { aiActions: [], events: [], battles: [] };

  for (const key of Object.keys(state.states)) {
    if (key === state.playerState || !state.states[key].alive) continue;
    const actions = runAiTurn(state, key, buildApi(state));
    report.aiActions.push(...actions);
  }

  const scripted = checkScriptedEvents(state);
  report.events.push(...scripted);
  const random = rollRandomEvents(state);
  report.events.push(...random);

  upkeep(state);

  state.month += 1;
  if (state.month > 12) { state.month = 1; state.year += 1; ageOfficers(state); }
  state.turn += 1;

  resolveArrivals(state);
  checkVictory(state);

  report.pendingBattles = state.pendingBattles;
  return report;
}

// Called by UI after all pending interactive battles are finalized.
export function startPlayerPhase(state) {
  state.pendingBattles = [];
  for (const officer of Object.values(state.officers)) officer.acted = false;
  // remove dead/captured officers from city lists
  for (const city of Object.values(state.cities)) {
    city.officers = city.officers.filter((id) => state.officers[id]?.status === "active" && state.officers[id]?.location === city.id);
    if (city.governor && state.officers[city.governor]?.status !== "active") city.governor = null;
    if (city.state && !state.states[city.state]?.alive) city.state = null;
  }
  // eliminate states with no cities
  for (const st of Object.values(state.states)) {
    if (st.alive && citiesOf(state, st.key).length === 0) eliminateState(state, st.key, "失所有城");
  }
  // fix succession for rulers killed by scripted events
  for (const st of Object.values(state.states)) {
    if (!st.alive) continue;
    const ruler = st.ruler ? state.officers[st.ruler] : null;
    if (!ruler || ruler.status === "dead" || ruler.state !== st.key) succeedRuler(state, st.key);
  }
  checkVictory(state);
  return state;
}

export { finalizeBattle, applyEventEffects, checkBattleEvents };
