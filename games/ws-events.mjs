// Warring States — event engine. Scripted historical events (provenance-tagged
// 史實/演義/待考) fire by date + condition; random events add variety. Effects
// use a small fixed vocabulary interpreted here.

import { OFFICER_BY_ID } from "./ws-data.mjs";
import { SCENARIO_BY_ID, EVENT_BY_ID, RANDOM_EVENTS } from "./ws-scenarios.mjs";
import { clamp, round, chance, pick, weightedPick, randomInt, SEASON_OF_MONTH } from "./ws-util.mjs";
import { spawnWanderer, log } from "./ws-engine.mjs";

const citiesOf = (state, key) => Object.values(state.cities).filter((c) => c.active && c.state === key);
const officersOf = (state, key) => Object.values(state.officers).filter((o) => o.state === key && o.status === "active");

const STAT_CAP = { agriculture: 100, commerce: 100, order: 100, defense: 100, training: 100, morale: 100 };

function evalCondition(state, cond, ctx = {}) {
  if (!cond) return true;
  switch (cond.t) {
    case "always": return true;
    case "owner": return state.cities[cond.city]?.state === cond.state;
    case "notOwner": return state.cities[cond.city]?.state !== cond.state;
    case "alive": { const o = state.officers[cond.officer]; return !!o && o.status !== "dead"; }
    case "dead": { const o = state.officers[cond.officer]; return !o || o.status === "dead"; }
    case "inState": { const o = state.officers[cond.officer]; return !!o && o.state === cond.state && o.status === "active"; }
    case "stateAlive": return !!state.states[cond.state]?.alive;
    case "and": return cond.c.every((c) => evalCondition(state, c, ctx));
    case "or": return cond.c.some((c) => evalCondition(state, c, ctx));
    case "season": return SEASON_OF_MONTH[state.month - 1] === cond.season;
    case "terrain": return ctx.city?.terrain === cond.terrain;
    case "statAbove": return ctx.city ? ctx.city[cond.stat] > cond.value : false;
    case "statBelow": return ctx.city ? ctx.city[cond.stat] < cond.value : false;
    case "hasSycophant": return officersOf(state, ctx.state).some((o) => o.traits.includes("奸佞"));
    case "hasOldOfficer": return officersOf(state, ctx.state).some((o) => o.age > 70);
    default: return true;
  }
}

function applyToCity(city, stat, d, pct) {
  if (!city) return;
  const delta = pct ? round(city[stat] * d / 100) : d;
  const cap = STAT_CAP[stat];
  city[stat] = cap != null ? clamp(round(city[stat] + delta), 0, cap) : Math.max(0, round(city[stat] + delta));
}

function removeOfficerFromCity(state, officer) {
  const city = state.cities[officer.location];
  if (city) {
    city.officers = city.officers.filter((id) => id !== officer.id);
    if (city.governor === officer.id) city.governor = null;
  }
}

function placeOfficer(state, officer, cityId, status = "active") {
  const city = state.cities[cityId];
  officer.location = cityId;
  officer.status = status;
  if (city && status === "active" && !city.officers.includes(officer.id)) city.officers.push(officer.id);
}

export function applyEventEffects(state, effects, ctx = {}) {
  for (const ef of effects ?? []) {
    switch (ef.t) {
      case "msg": break;
      case "city": {
        const cityId = ef.city === "@" ? ctx.city?.id : ef.city;
        applyToCity(state.cities[cityId], ef.stat, ef.d, ef.pct);
        break;
      }
      case "allCities":
        for (const c of citiesOf(state, ef.state)) applyToCity(c, ef.stat, ef.d, ef.pct);
        break;
      case "troops": {
        const cityId = ef.city === "@" ? ctx.city?.id : ef.city;
        applyToCity(state.cities[cityId], "troops", ef.d, ef.pct);
        break;
      }
      case "loyalty": {
        const o = state.officers[ef.officer];
        if (o) o.loyalty = clamp(o.loyalty + ef.d, 0, 100);
        break;
      }
      case "death": {
        const o = state.officers[ef.officer];
        if (o && o.status !== "dead") {
          removeOfficerFromCity(state, o);
          o.status = "dead";
          if (state.states[o.state]?.ruler === o.id) state.states[o.state].ruler = null; // engine fixes succession
          log(state, `${o.name}卒。`, "death");
        }
        break;
      }
      case "move": {
        const o = state.officers[ef.officer];
        if (o && o.status !== "dead") {
          removeOfficerFromCity(state, o);
          if (ef.state) o.state = ef.state;
          placeOfficer(state, o, ef.city, o.status === "free" ? "free" : "active");
        }
        break;
      }
      case "join": {
        let o = state.officers[ef.officer];
        if (!o) {
          const base = OFFICER_BY_ID[ef.officer];
          if (!base) break;
          o = state.officers[ef.officer] = { id: base.id, name: base.name, home: base.home, state: ef.state, stats: { ...base.stats }, loyalty: 75, ambition: base.ambition, personality: base.personality, traits: [...base.traits], birth: base.birth, death: base.death, age: base.birth != null ? state.year - base.birth : 40, status: "active", location: ef.city, position: null, acted: false, wounded: 0, bio: base.bio };
        }
        o.state = ef.state; o.loyalty = 75;
        placeOfficer(state, o, ef.city, "active");
        break;
      }
      case "relation": {
        const ra = state.states[ef.a]?.relations[ef.b];
        const rb = state.states[ef.b]?.relations[ef.a];
        if (ra) { ra.value = clamp(ra.value + ef.d, -100, 100); if (ra.value <= -60) ra.war = true; }
        if (rb) { rb.value = clamp(rb.value + ef.d, -100, 100); if (rb.value <= -60) rb.war = true; }
        break;
      }
      case "alliance": {
        const ra = state.states[ef.a]?.relations[ef.b];
        const rb = state.states[ef.b]?.relations[ef.a];
        if (ra) { ra.alliance = ef.on; ra.nap = ef.on; if (ef.on) ra.war = false; }
        if (rb) { rb.alliance = ef.on; rb.nap = ef.on; if (ef.on) rb.war = false; }
        break;
      }
      case "war": {
        const ra = state.states[ef.a]?.relations[ef.b];
        const rb = state.states[ef.b]?.relations[ef.a];
        if (ra) ra.war = ef.on;
        if (rb) rb.war = ef.on;
        break;
      }
      case "gold": {
        const key = ef.state === "@" ? ctx.state : ef.state;
        const cap = citiesOf(state, key).find((c) => c.tier === "capital") ?? citiesOf(state, key)[0];
        if (cap) cap.gold = Math.max(0, round(cap.gold + ef.d));
        break;
      }
      case "food": {
        const key = ef.state === "@" ? ctx.state : ef.state;
        const cap = citiesOf(state, key).find((c) => c.tier === "capital") ?? citiesOf(state, key)[0];
        if (cap) cap.food = Math.max(0, round(cap.food + ef.d));
        break;
      }
      case "ruler": {
        const st = state.states[ef.state];
        if (!st) break;
        let o = state.officers[ef.officer];
        if (!o) {
          const base = OFFICER_BY_ID[ef.officer];
          if (!base) break;
          const cap = citiesOf(state, ef.state).find((c) => c.tier === "capital") ?? citiesOf(state, ef.state)[0];
          o = state.officers[ef.officer] = { id: base.id, name: base.name, home: base.home, state: ef.state, stats: { ...base.stats }, loyalty: 100, ambition: base.ambition, personality: base.personality, traits: [...base.traits], birth: base.birth, death: base.death, age: base.birth != null ? state.year - base.birth : 40, status: "active", location: cap?.id ?? null, position: "governor", acted: false, wounded: 0, bio: base.bio };
          if (cap) { cap.officers.push(o.id); cap.governor = o.id; }
        }
        st.ruler = o.id; o.state = ef.state; o.loyalty = 100; o.status = "active";
        break;
      }
      case "spawnFree": {
        const base = OFFICER_BY_ID[ef.officer];
        if (base && !state.officers[ef.officer]) {
          state.officers[ef.officer] = { id: base.id, name: base.name, home: base.home, state: null, stats: { ...base.stats }, loyalty: 50, ambition: base.ambition, personality: base.personality, traits: [...base.traits], birth: base.birth, death: base.death, age: base.birth != null ? state.year - base.birth : 40, status: "free", location: ef.city, position: null, acted: false, wounded: 0, bio: base.bio };
        }
        break;
      }
      case "spawnWanderer": {
        const key = ctx.state ?? state.playerState;
        const cities = citiesOf(state, key);
        if (cities.length) spawnWanderer(state, pick(state, cities).id);
        break;
      }
      case "randomOfficerLoyalty": {
        const list = officersOf(state, ctx.state).filter((o) => o.id !== state.states[ctx.state]?.ruler);
        const o = pick(state, list);
        if (o) o.loyalty = clamp(o.loyalty + ef.d, 0, 100);
        break;
      }
      case "randomOldDeath": {
        const list = officersOf(state, ctx.state).filter((o) => o.age > 70 && o.id !== state.states[ctx.state]?.ruler);
        const o = pick(state, list);
        if (o) { removeOfficerFromCity(state, o); o.status = "dead"; log(state, `${o.name}病逝（年${o.age}）。`, "death"); }
        break;
      }
      default: break;
    }
  }
}

function fire(state, ev, ctx) {
  applyEventEffects(state, ev.effects, ctx);
  state.firedEvents.push(ev.id);
  log(state, `【${ev.provenance}】${ev.title}：${ev.text}`, "event");
  return { id: ev.id, title: ev.title, text: ev.text, provenance: ev.provenance };
}

export function checkScriptedEvents(state) {
  const scenario = SCENARIO_BY_ID[state.scenarioId];
  const fired = [];
  let changed = true;
  let guard = 0;
  while (changed && guard < 10) {
    changed = false; guard += 1;
    for (const id of scenario.events) {
      if (state.firedEvents.includes(id)) continue;
      const ev = EVENT_BY_ID[id];
      if (!ev?.trigger) continue;
      if (ev.trigger.year !== state.year) continue;
      if (ev.trigger.month && ev.trigger.month !== state.month) continue;
      if (!evalCondition(state, ev.trigger.condition)) continue;
      fired.push(fire(state, ev, {}));
      changed = true;
    }
  }
  return fired;
}

export function checkBattleEvents(state, battle) {
  const scenario = SCENARIO_BY_ID[state.scenarioId];
  const fired = [];
  for (const id of scenario.events) {
    if (state.firedEvents.includes(id)) continue;
    const ev = EVENT_BY_ID[id];
    if (!ev?.battleTrigger) continue;
    const bt = ev.battleTrigger;
    const city = state.cities[battle.cityId];
    if (bt.city && bt.city !== battle.cityId) continue;
    if (bt.attacker && bt.attacker !== battle.attackerState) continue;
    if (bt.defender && bt.defender !== battle.defenderState) continue;
    if (ev.trigger && !evalCondition(state, ev.trigger.condition)) continue;
    fired.push(fire(state, ev, { city }));
  }
  return fired;
}

export function rollRandomEvents(state) {
  const fired = [];
  if (!chance(state, 0.55)) return fired;
  const count = chance(state, 0.25) ? 2 : 1;
  for (let i = 0; i < count; i += 1) {
    const scope = chance(state, 0.6) ? "city" : "state";
    let ctx;
    if (scope === "city") {
      const cities = Object.values(state.cities).filter((c) => c.active && c.state);
      const city = pick(state, cities);
      if (!city) continue;
      ctx = { city, state: city.state };
    } else {
      const keys = Object.values(state.states).filter((s) => s.alive).map((s) => s.key);
      const key = pick(state, keys);
      if (!key) continue;
      ctx = { state: key };
    }
    const eligible = RANDOM_EVENTS.filter((e) => e.scope === scope && evalCondition(state, e.condition, ctx));
    const chosen = weightedPick(state, eligible.map((e) => ({ weight: e.weight, e })));
    if (!chosen) continue;
    const ev = chosen.e;
    applyEventEffects(state, ev.effects, ctx);
    const where = scope === "city" ? ctx.city.name : state.states[ctx.state].name;
    log(state, `【${ev.provenance}】${where}・${ev.title}：${ev.text}`, "event");
    fired.push({ id: ev.id, title: ev.title, text: ev.text, provenance: ev.provenance, where });
  }
  return fired;
}
