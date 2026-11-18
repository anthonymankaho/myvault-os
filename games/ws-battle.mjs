// Warring States — strategic/tactical turn-based battle engine.
// Outcome = calculated formula × controlled randomness (±15%), never pure RNG.
// Factors: troop size, commander leadership, morale, terrain, supply, training,
// formation (tactic), officer traits, weather, wall defense, duels.

import { TERRAIN_EFFECTS } from "./ws-data.mjs";
import { clamp, round, chance, jitter, pick, randomInt } from "./ws-util.mjs";
import { traitMult, log, citiesOf, compAttack, compDefense, compTerrain, compTotal, setTroops, mergeComp, buildComp } from "./ws-engine.mjs";

export const ATTACK_TACTICS = {
  assault: { name: "強攻", en: "Assault", desc: "正規攻城，傷敵亦自損。" },
  charge: { name: "突擊", en: "Charge", desc: "猛沖，高傷高損；平原、猛將加成。" },
  stratagem: { name: "計略", en: "Stratagem", desc: "智謀較量；成則重創敵軍、奪其士氣。" },
  fire: { name: "火攻", en: "Fire Attack", desc: "火攻；林地平原加成，雨天水鄉減效。" },
  defend: { name: "堅守", en: "Hold", desc: "穩住陣腳，減損蓄力。" },
  retreat: { name: "撤退", en: "Retreat", desc: "全師而退，保存兵力。" },
};

export const DEFEND_TACTICS = {
  hold: { name: "堅守", en: "Hold", desc: "憑城固守，城防加成。" },
  sortie: { name: "出擊", en: "Sortie", desc: "開城逆擊，傷敵自損。" },
  stratagem: { name: "計略", en: "Stratagem", desc: "設伏用計，挫敵攻勢。" },
  charge: { name: "突擊", en: "Charge", desc: "精銳突襲，高風險。" },
};

const WEATHERS = [
  { id: "clear", name: "晴", fire: 1.0, charge: 1.0 },
  { id: "rain", name: "雨", fire: 0.4, charge: 0.85 },
  { id: "snow", name: "雪", fire: 0.6, charge: 0.7 },
  { id: "fog", name: "霧", fire: 0.8, charge: 0.9, stratagem: 1.2 },
];

function bestCommander(state, officers) {
  const list = officers.map((id) => state.officers[id]).filter((o) => o && o.status === "active");
  return list.sort((a, b) => b.stats.lead - a.stats.lead)[0] ?? null;
}

export function createBattle(state, army) {
  const city = state.cities[army.target];
  if (!army.comp) army.comp = buildComp(army.troops || 0, army.state, "late");
  if (!city.comp) city.comp = buildComp(city.troops || 0, city.state, "late");
  const defenderCommander = city.governor ? state.officers[city.governor] : bestCommander(state, city.officers);
  const weather = pick(state, WEATHERS);
  const battle = {
    id: `battle_${state.turn}_${army.id}`,
    army, cityId: city.id,
    attackerState: army.state, defenderState: city.state,
    round: 0, maxRounds: 12, concluded: false, result: null,
    weather, log: [],
    attackerTactic: null, defenderTactic: null,
    wallBreached: false, starving: 0,
    attackerCommander: state.officers[army.commander] ?? null,
    defenderCommander,
    playerAttacker: army.state === state.playerState,
    playerDefender: city.state === state.playerState,
  };
  battle.log.push(`${weather.name}。${state.officers[army.commander]?.name ?? "攻軍"}攻${city.name}，守將${defenderCommander?.name ?? "無"}。地形${city.terrain}。`);
  return battle;
}

function commanderFactor(officer, effect) {
  if (!officer) return 0.7;
  const lead = officer.stats.lead;
  return (0.6 + lead / 100 * 0.8) * traitMult(officer, effect);
}

function supplyFactor(army) {
  return army.food > 0 ? 1 : 0.7;
}

export function autoTactic(state, battle, side) {
  const army = battle.army;
  const city = state.cities[battle.cityId];
  if (side === "attacker") {
    const cmd = battle.attackerCommander;
    const ratio = army.troops / Math.max(1, city.troops);
    if (army.morale < 20 || army.troops < 1500 || (ratio < 0.5 && battle.round > 3)) return "retreat";
    if (army.food <= 0 && battle.round > 2) return "retreat";
    if (cmd && cmd.stats.int > 82 && chance(state, 0.5)) return cmd.traits.includes("神算") ? "stratagem" : (chance(state, 0.5) ? "fire" : "stratagem");
    if (ratio > 1.4 && cmd && cmd.stats.war > 80 && city.terrain === "plain") return "charge";
    if (battle.wallBreached) return "assault";
    return chance(state, 0.6) ? "assault" : "charge";
  }
  const cmd = battle.defenderCommander;
  const ratio = city.troops / Math.max(1, army.troops);
  if (cmd && cmd.stats.int > 85 && chance(state, 0.35)) return "stratagem";
  if (ratio > 1.5 && chance(state, 0.4)) return "sortie";
  if (city.defense > 50 && !battle.wallBreached) return "hold";
  return chance(state, 0.5) ? "hold" : "sortie";
}

// Resolve one round. attackerTactic chosen by player (or auto for AI attacker).
export function battleRound(state, battle, attackerTactic) {
  if (battle.concluded) return battle;
  const army = battle.army;
  const city = state.cities[battle.cityId];
  battle.round += 1;
  const aTactic = attackerTactic ?? autoTactic(state, battle, "attacker");
  const dTactic = battle.playerDefender ? (battle.defenderTactic ?? autoTactic(state, battle, "defender")) : autoTactic(state, battle, "defender");
  battle.attackerTactic = aTactic; battle.defenderTactic = dTactic;
  const terrain = TERRAIN_EFFECTS[city.terrain] ?? TERRAIN_EFFECTS.plain;
  const weather = battle.weather;
  const aCmd = battle.attackerCommander, dCmd = battle.defenderCommander;
  const lines = [];

  if (aTactic === "retreat") {
    battle.concluded = true; battle.result = "retreat";
    battle.log.push(`第${battle.round}回合：攻軍撤退。`);
    return battle;
  }

  // supply
  const consume = round(army.troops * 0.03 * (aCmd?.traits.includes("屯田") ? 0.8 : 1));
  army.food = Math.max(0, army.food - consume);
  if (army.food <= 0) battle.starving += 1; else battle.starving = 0;

  // ---- attacker strikes defender ----
  let aDamage = 0, aMoraleHit = 0, wallHit = 0;
  const aBase = army.troops * 0.062 * compAttack(army.comp) * compTerrain(army.comp, city.terrain) / compDefense(city.comp);
  const aLead = commanderFactor(aCmd, "battleLead");
  const aMorale = 0.5 + army.morale / 100;
  const aTrain = 0.6 + army.training / 200;
  const wallFactor = battle.wallBreached ? 1.0 : clamp(1 - city.defense / 180, 0.35, 1) * (city.terrain === "pass" ? 0.85 : 1);
  const supply = supplyFactor(army);

  if (aTactic === "assault") {
    aDamage = aBase * aLead * aMorale * aTrain * 1.0 * wallFactor * supply * jitter(state);
    wallHit = randomInt(state, 2, 4);
    aMoraleHit = 4;
  } else if (aTactic === "charge") {
    const chargeMult = 1.3 * terrain.charge * (weather.charge ?? 1) * traitMult(aCmd, "charge") * traitMult(aCmd, "cavalry");
    aDamage = aBase * aLead * aMorale * aTrain * chargeMult * wallFactor * supply * jitter(state);
    wallHit = randomInt(state, 3, 5);
    aMoraleHit = 6;
    setTroops(army, round(army.troops * 0.985)); // charge self-loss
  } else if (aTactic === "stratagem") {
    const aInt = aCmd ? aCmd.stats.int : 50;
    const dInt = dCmd ? dCmd.stats.int : 50;
    const success = clamp(0.45 + (aInt - dInt) / 150, 0.1, 0.9) * traitMult(aCmd, "stratagem") * (terrain.stratagem ?? 1) * (weather.stratagem ?? 1);
    if (chance(state, success)) {
      aDamage = aBase * aLead * 1.5 * aMorale * wallFactor * supply * jitter(state);
      aMoraleHit = 14;
      lines.push(`${aCmd?.name ?? "攻軍"}計略成功，敵軍混亂！`);
    } else {
      aDamage = aBase * 0.3 * wallFactor * jitter(state);
      lines.push(`${aCmd?.name ?? "攻軍"}計略為${dCmd?.name ?? "守軍"}所識。`);
    }
  } else if (aTactic === "fire") {
    const aInt = aCmd ? aCmd.stats.int : 50;
    const fireMult = (weather.fire ?? 1) * (city.terrain === "forest" ? 1.4 : city.terrain === "plain" ? 1.15 : city.terrain === "river" ? 0.6 : 1);
    const success = clamp(0.4 + aInt / 200, 0.15, 0.85) * traitMult(aCmd, "stratagem");
    if (chance(state, success) && fireMult > 0.5) {
      aDamage = aBase * aLead * 1.6 * fireMult * aMorale * wallFactor * supply * jitter(state);
      aMoraleHit = 16;
      lines.push(`火攻得手，${city.name}營寨火起！`);
    } else {
      aDamage = aBase * 0.25 * wallFactor * jitter(state);
      lines.push(`火攻不順（${weather.name}）。`);
    }
  } else if (aTactic === "defend") {
    aDamage = aBase * 0.35 * wallFactor * jitter(state);
    army.morale = clamp(army.morale + 4, 0, 100);
  }

  aDamage = round(aDamage);
  setTroops(city, Math.max(0, city.troops - aDamage));
  city.morale = clamp(city.morale - aMoraleHit - round(aDamage / Math.max(1, city.troops + aDamage) * 25), 0, 100);
  city.defense = clamp(city.defense - wallHit, 0, 100);
  if (city.defense <= 0 && !battle.wallBreached) { battle.wallBreached = true; lines.push(`${city.name}城防崩潰，城牆 breached！`); }
  lines.push(`攻軍${ATTACK_TACTICS[aTactic].name}，殺敵${aDamage}。`);

  // ---- defender strikes attacker ----
  let dDamage = 0;
  const dBase = city.troops * 0.058 * compAttack(city.comp) * compTerrain(city.comp, city.terrain) / compDefense(army.comp);
  const dLead = commanderFactor(dCmd, "battleLead");
  const dMorale = 0.5 + city.morale / 100;
  const dTrain = 0.6 + city.training / 200;
  const defTerrain = terrain.defense;
  if (dTactic === "hold") {
    dDamage = dBase * 0.45 * dLead * dMorale * defTerrain * jitter(state);
    city.morale = clamp(city.morale + 2, 0, 100);
  } else if (dTactic === "sortie") {
    dDamage = dBase * 1.15 * dLead * dMorale * jitter(state);
    setTroops(city, round(city.troops * 0.99));
  } else if (dTactic === "stratagem") {
    const dInt = dCmd ? dCmd.stats.int : 50;
    const aInt = aCmd ? aCmd.stats.int : 50;
    if (chance(state, clamp(0.45 + (dInt - aInt) / 150, 0.1, 0.9) * traitMult(dCmd, "stratagem"))) {
      dDamage = dBase * 1.4 * dLead * dMorale * jitter(state);
      army.morale = clamp(army.morale - 10, 0, 100);
      lines.push(`${dCmd?.name ?? "守軍"}設伏，攻軍受挫！`);
    } else {
      dDamage = dBase * 0.3 * jitter(state);
    }
  } else if (dTactic === "charge") {
    dDamage = dBase * 1.3 * dLead * dMorale * terrain.charge * traitMult(dCmd, "charge") * jitter(state);
    setTroops(city, round(city.troops * 0.98));
  }
  // attacker charge risk: takes extra
  if (aTactic === "charge") dDamage *= 1.2;
  dDamage = round(dDamage);
  setTroops(army, Math.max(0, army.troops - dDamage));
  army.morale = clamp(army.morale - round(dDamage / Math.max(1, army.troops + dDamage) * 22) - 2, 0, 100);
  lines.push(`守軍${DEFEND_TACTICS[dTactic].name}，殺敵${dDamage}。`);

  // ---- duel event ----
  if (aCmd && dCmd && aCmd.stats.war > 82 && dCmd.stats.war > 82 && chance(state, 0.12)) {
    const aWar = aCmd.stats.war * traitMult(aCmd, "charge") * jitter(state, 0.2);
    const dWar = dCmd.stats.war * traitMult(dCmd, "charge") * jitter(state, 0.2);
    if (aWar > dWar) {
      city.morale = clamp(city.morale - 12, 0, 100);
      dCmd.wounded = 2;
      lines.push(`單挑！${aCmd.name}勝${dCmd.name}，守軍奪氣。`);
    } else {
      army.morale = clamp(army.morale - 12, 0, 100);
      aCmd.wounded = 2;
      lines.push(`單挑！${dCmd.name}勝${aCmd.name}，攻軍奪氣。`);
    }
  }

  battle.log.push(`【第${battle.round}回合】` + lines.join(" "));

  // ---- conclusion ----
  if (army.troops <= 500 || army.morale <= 5) { battle.concluded = true; battle.result = "defender"; }
  else if (city.troops <= 500 || city.morale <= 5) { battle.concluded = true; battle.result = "attacker"; }
  else if (battle.starving >= 2) { battle.concluded = true; battle.result = "retreat"; battle.log.push("攻軍糧盡，被迫撤退。"); }
  else if (battle.round >= battle.maxRounds) { battle.concluded = true; battle.result = "retreat"; battle.log.push("久攻不下，攻軍撤退。"); }

  if (battle.concluded) {
    const label = battle.result === "attacker" ? `${city.name}陷落！` : battle.result === "defender" ? "攻軍潰敗！" : "攻軍撤退。";
    battle.log.push(`戰畢：${label}`);
  }
  return battle;
}

export function finalizeBattle(state, battle) {
  const army = battle.army;
  const city = state.cities[battle.cityId];
  const result = battle.result;
  const attackerState = battle.attackerState;

  if (result === "attacker") {
    const defenderState = city.state;
    city.state = attackerState;
    city.comp = { ...army.comp };
    city.troops = compTotal(city.comp);
    city.food += army.food;
    city.morale = clamp(army.morale, 0, 100);
    city.defense = round(city.defense * 0.5);
    city.governor = null;
    // defender officers captured
    for (const id of [...city.officers]) {
      const o = state.officers[id];
      if (o && o.status === "active") { o.status = "captured"; o.capturedBy = attackerState; o.loyalty = clamp(o.loyalty - 20, 0, 100); }
    }
    city.officers = [];
    // attacker officers garrison
    for (const id of army.officers) {
      const o = state.officers[id];
      if (o) { o.status = "active"; o.state = attackerState; o.location = city.id; o.acted = false; o.wounded = Math.max(0, o.wounded); if (!city.officers.includes(id)) city.officers.push(id); }
    }
    const cmd = state.officers[army.commander];
    if (cmd) { city.governor = cmd.id; cmd.position = "governor"; }
    // annihilator trait: extra population loss
    if (cmd?.traits.includes("殲滅")) city.population = round(city.population * 0.9);
    log(state, `${cmd?.name ?? "攻軍"}克${city.name}（${defenderState ? "原屬" + defenderState : ""}），俘守將吏卒。`, "capture");
  } else {
    // retreat or defender win — army withdraws
    city.morale = clamp(city.morale + (result === "defender" ? 8 : 2), 0, 100);
    const home = state.cities[army.from];
    const fallback = home && home.state === attackerState ? home : citiesOf(state, attackerState).find((c) => c.tier === "capital") ?? citiesOf(state, attackerState)[0];
    if (fallback) {
      mergeComp(fallback.comp, army.comp); fallback.troops = compTotal(fallback.comp);
      fallback.food += army.food;
      for (const id of army.officers) {
        const o = state.officers[id];
        if (o) { o.status = "active"; o.location = fallback.id; o.acted = false; if (!fallback.officers.includes(id)) fallback.officers.push(id); }
      }
      log(state, `${state.officers[army.commander]?.name ?? "攻軍"}${result === "defender" ? "潰敗" : "撤退"}，退守${fallback.name}，餘${round(army.troops)}兵。`, "battle");
    } else {
      for (const id of army.officers) { const o = state.officers[id]; if (o) { o.status = "captured"; o.capturedBy = city.state; } }
      log(state, `攻軍無歸路，將士被俘。`, "battle");
    }
  }
  battle.finalized = true;
  return battle;
}

export function autoResolveBattle(state, army) {
  const battle = createBattle(state, army);
  let guard = 0;
  while (!battle.concluded && guard < 30) {
    battleRound(state, battle, autoTactic(state, battle, "attacker"));
    guard += 1;
  }
  if (!battle.concluded) { battle.concluded = true; battle.result = "retreat"; }
  finalizeBattle(state, battle);
  return battle;
}
