// Warring States — score-based AI engine.
// Candidate Action → Evaluate → Score → Strategic Modifier → Risk → Execute.
// Each AI officer acts once per turn (same economy as the player). Personality
// and difficulty modulate aggression/development. Controlled randomness keeps
// AI varied but not erratic. Receives an `api` (engine actions) to avoid cycles.

import { PERSONALITIES, STATE_TROOP_MIX, DEFAULT_TROOP_MIX, TROOP_TYPES } from "./ws-data.mjs";
import { clamp, round, chance, pick, randomInt } from "./ws-util.mjs";

const citiesOf = (state, key) => Object.values(state.cities).filter((c) => c.active && c.state === key);
const officersOf = (state, key) => Object.values(state.officers).filter((o) => o.state === key && o.status === "active");
const officersIn = (state, cityId) => Object.values(state.officers).filter((o) => o.location === cityId && o.status === "active" && !o.acted && o.wounded <= 0);
const freeIn = (state, cityId) => Object.values(state.officers).filter((o) => o.location === cityId && o.status === "free");

function totals(state, key) {
  const cities = citiesOf(state, key);
  return {
    cities: cities.length,
    troops: cities.reduce((s, c) => s + c.troops, 0),
    gold: cities.reduce((s, c) => s + c.gold, 0),
    food: cities.reduce((s, c) => s + c.food, 0),
  };
}

function personality(state, key) {
  const ruler = state.officers[state.states[key]?.ruler];
  return PERSONALITIES[ruler?.personality ?? "cautious"] ?? PERSONALITIES.cautious;
}

function isBorder(state, city) {
  return city.adjacent.some((id) => { const n = state.cities[id]; return n?.active && n.state && n.state !== city.state; });
}

// AI picks a troop type favouring the state's doctrine and the city terrain.
function preferredTroop(state, key, city) {
  const mix = STATE_TROOP_MIX[key] ?? DEFAULT_TROOP_MIX;
  let best = "infantry", bestScore = -1;
  for (const typeId in mix) {
    const type = TROOP_TYPES[typeId];
    if (!type) continue;
    const score = mix[typeId] * (type.terrain[city.terrain] ?? 1);
    if (score > bestScore) { bestScore = score; best = typeId; }
  }
  return best;
}

function threatAt(state, city) {
  let threat = 0;
  for (const id of city.adjacent) {
    const n = state.cities[id];
    if (n?.active && n.state && n.state !== city.state) {
      const rel = state.states[city.state].relations[n.state];
      const hostile = rel?.war || rel?.value < -30;
      threat += n.troops * (hostile ? 1 : 0.3);
    }
  }
  return threat;
}

// ---- candidate scoring for one officer in one city ----
function candidates(state, key, city, officer, ctx) {
  const out = [];
  const s = officer.stats;
  const pers = ctx.pers;
  const border = ctx.border;
  const foodNeed = city.food < city.troops * 2.5;
  const goldNeed = city.gold < 800;

  const dev = (type, stat, base) => {
    let score = base + stat / 8;
    if (type === "agriculture" && foodNeed) score += 30;
    if (type === "commerce" && goldNeed) score += 25;
    if (type === "order" && city.order < 50) score += 35;
    if (type === "defense" && border && city.defense < 60) score += 30;
    if (type === "train" && city.training < 60) score += 18;
    if (type === "recruit" && ctx.troopShort && city.gold > 600 && city.food > city.troops) score += 28;
    score *= pers.develop;
    if (city.gold < 300 && type !== "recruit" && type !== "order") score -= 40;
    out.push({ type: "develop", arg: type, score, officer: officer.id, city: city.id });
  };
  dev("agriculture", s.pol, 10);
  dev("commerce", s.pol, 10);
  dev("order", s.pol + s.cha / 2, 8);
  dev("defense", s.pol, border ? 14 : 4);
  dev("train", s.lead + s.war / 2, 10);
  dev("recruit", s.cha, 8);
  if (city.food > 3000 && city.order < 55) out.push({ type: "develop", arg: "relief", score: 20 * pers.develop, officer: officer.id, city: city.id });

  // personnel
  const free = freeIn(state, city.id);
  if (free.length) {
    out.push({ type: "recruitOfficer", target: free[0].id, score: 30 + s.cha / 6, officer: officer.id, city: city.id });
    out.push({ type: "search", score: 12 + s.cha / 10, officer: officer.id, city: city.id });
  } else if (s.cha > 65 && city.gold > 300) {
    out.push({ type: "search", score: 8 + s.cha / 12, officer: officer.id, city: city.id });
  }
  return out;
}

// ---- global attack evaluation ----
function attackCandidates(state, key, ctx) {
  const out = [];
  const aggression = ctx.aggression;
  for (const city of citiesOf(state, key)) {
    if (!isBorder(state, city)) continue;
    const commanders = officersIn(state, city.id).filter((o) => o.stats.lead > 55).sort((a, b) => b.stats.lead - a.stats.lead);
    if (!commanders.length) continue;
    const available = city.troops - 2500;
    if (available < 4000) continue;
    for (const id of city.adjacent) {
      const target = state.cities[id];
      if (!target?.active || !target.state || target.state === key) continue;
      const rel = state.states[key].relations[target.state];
      if (rel?.alliance || rel?.nap) continue;
      const defensePower = target.troops + target.defense * 120 + (target.terrain === "pass" ? 4000 : 0);
      const ratio = available / Math.max(1, defensePower);
      const threshold = 1.25 / aggression;
      if (ratio < threshold) continue;
      if (city.food < available * 0.12) continue;
      let score = ratio * 40 * aggression;
      if (rel?.war) score += 15;
      if (target.tier === "capital") score += 12;
      if (target.troops < 8000) score += 10;
      // risk: leaving home weak
      if (available > city.troops * 0.8) score -= 12;
      score += randomInt(state, -6, 6);
      const cmd = commanders[0];
      const troops = round(clamp(available * 0.85, 4000, available));
      out.push({ type: "attack", from: city.id, target: id, troops, commander: cmd.id, score, city: city.id });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export function runAiTurn(state, key, api) {
  const actions = [];
  const st = state.states[key];
  if (!st?.alive) return actions;
  const pers = personality(state, key);
  const diff = { easy: 0.8, normal: 1.0, hard: 1.25 }[state.difficulty] ?? 1;
  const ctx = { pers, aggression: pers.aggression * diff, border: false, troopShort: false };
  const t = totals(state, key);
  ctx.troopShort = t.troops < t.cities * 18000;

  // 1) attacks (best first, limited per turn)
  const attacks = attackCandidates(state, key, ctx);
  let attackCount = 0;
  for (const cand of attacks) {
    if (attackCount >= 2) break;
    const cmd = state.officers[cand.commander];
    if (!cmd || cmd.acted) continue;
    const res = api.attack(cand.from, cand.target, cand.troops, cand.commander, [], null);
    if (res.ok) { attackCount += 1; actions.push(`${st.name}：${cmd.name}攻${state.cities[cand.target].name}`); }
  }

  // 2) reinforce threatened border cities from safe rear
  for (const city of citiesOf(state, key)) {
    if (!isBorder(state, city)) continue;
    const threat = threatAt(state, city);
    if (threat > city.troops * 1.6 && city.troops < 20000) {
      const rear = citiesOf(state, key).filter((c) => !isBorder(state, c) && c.troops > 12000 && c.adjacent.includes(city.id));
      const source = rear.sort((a, b) => b.troops - a.troops)[0];
      if (source) {
        const cmd = officersIn(state, source.id).sort((a, b) => b.stats.lead - a.stats.lead)[0];
        if (cmd) {
          const res = api.moveArmy(source.id, city.id, round(source.troops * 0.5), cmd.id, [], null);
          if (res.ok) actions.push(`${st.name}：${cmd.name}增援${city.name}`);
        }
      }
    }
  }

  // 3) per-officer domestic/personnel (score-based best action)
  for (const city of citiesOf(state, key)) {
    ctx.border = isBorder(state, city);
    for (const officer of officersIn(state, city.id)) {
      if (officer.acted) continue;
      if (officer.id === st.ruler && city.tier === "capital") {
        // ruler governs; occasionally reward low-loyalty officers
        const low = officersOf(state, key).filter((o) => o.loyalty < 55 && o.id !== st.ruler).sort((a, b) => a.loyalty - b.loyalty)[0];
        if (low && city.gold > 500) { api.reward(low.id, 300); actions.push(`${st.name}：褒賞${low.name}`); officer.acted = true; continue; }
      }
      const cands = candidates(state, key, city, officer, ctx).sort((a, b) => b.score - a.score);
      const best = cands[0];
      if (!best || best.score < 12) { officer.acted = true; continue; }
      let res;
      if (best.type === "develop") {
        const troopType = best.arg === "recruit" ? preferredTroop(state, key, city) : undefined;
        res = api.develop(best.city, best.arg, best.officer, troopType);
      }
      else if (best.type === "search") res = api.search(best.city, best.officer);
      else if (best.type === "recruitOfficer") res = api.recruitOfficer(best.city, best.target, best.officer, 100);
      if (res?.ok) {
        officer.acted = true;
        if (best.type === "develop") actions.push(`${st.name}：${officer.name}${best.arg}於${city.name}`);
        else if (best.type === "recruitOfficer" && res.recruited) actions.push(`${st.name}：登用${state.officers[best.target]?.name}`);
      } else {
        officer.acted = true;
      }
    }
  }

  // 4) diplomacy
  const dip = aiDiplomacy(state, key, api);
  actions.push(...dip);

  // 5) tax policy: high if gold-short and order healthy, else normal
  if (t.gold < t.cities * 600 && citiesOf(state, key).every((c) => c.order > 60)) api.setTaxRate(key, "high");
  else if (st.taxRate === "high" && citiesOf(state, key).some((c) => c.order < 45)) api.setTaxRate(key, "normal");

  return actions;
}

// Lightweight AI diplomacy (full engine in ws-diplomacy.mjs).
function aiDiplomacy(state, key, api) {
  const actions = [];
  const st = state.states[key];
  const others = Object.values(state.states).filter((s) => s.alive && s.key !== key);
  if (!others.length) return actions;
  const dipOfficer = officersOf(state, key).filter((o) => !o.acted && o.stats.cha > 60).sort((a, b) => b.stats.cha - a.stats.cha)[0];
  if (!dipOfficer) return actions;
  // strongest neighbor threat
  const threats = others.map((s) => ({ s, power: totals(state, s.key).troops, rel: st.relations[s.key]?.value ?? 0 }))
    .sort((a, b) => b.power - a.power);
  const strongest = threats[0];
  // improve relations with a non-hostile strong state, or gift to avoid war
  const target = threats.find((x) => x.rel < 20 && x.rel > -50) ?? strongest;
  if (target && chance(state, 0.4)) {
    const res = api.diplomacy("gift", key, target.s.key, dipOfficer.id, { amount: 300 });
    if (res?.ok) { actions.push(`${st.name}：贈禮${target.s.name}`); dipOfficer.acted = true; }
  }
  // ally against strongest if weak
  if (strongest && strongest.power > totals(state, key).troops * 1.4 && chance(state, 0.3)) {
    const ally = threats.find((x) => x.s.key !== strongest.s.key && x.rel > -20);
    if (ally) {
      const res = api.diplomacy("alliance", key, ally.s.key, dipOfficer.id, {});
      if (res?.ok) { actions.push(`${st.name}：欲結盟${ally.s.name}`); dipOfficer.acted = true; }
    }
  }
  return actions;
}
