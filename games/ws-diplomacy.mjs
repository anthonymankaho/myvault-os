// Warring States — diplomacy engine. Results depend on national power, military
// strength, relations, officer ability, personality, traits and strategic
// situation — not pure RNG.

import { clamp, round, chance } from "./ws-util.mjs";
import { traitMult, log, citiesOf, officersOf, stateTotals } from "./ws-engine.mjs";

export const DIPLOMACY_ACTIONS = {
  gift: { name: "贈禮", en: "Gift", desc: "贈金改善關係。" },
  alliance: { name: "同盟", en: "Alliance", desc: "締結同盟（須關係良好）。" },
  nap: { name: "互不侵犯", en: "Non-Aggression", desc: "約定互不攻伐。" },
  trade: { name: "通商", en: "Trade", desc: "開通商路，雙方得利。" },
  threaten: { name: "威脅", en: "Threaten", desc: "以武力脅迫，索取貢賦。" },
  persuade: { name: "說服", en: "Persuade", desc: "遣使遊說，改善關係。" },
  coalition: { name: "合縱", en: "Coalition", desc: "聯合諸侯共抗強敵。" },
  breakAlliance: { name: "破盟", en: "Break Alliance", desc: "斷絕盟約。" },
  requestReinforcement: { name: "求援", en: "Request Aid", desc: "請盟友出兵相助。" },
  surrender: { name: "勸降", en: "Surrender Talks", desc: "勸弱小之國臣服納貢。" },
};

function power(state, key) {
  const t = stateTotals(state, key);
  return t.troops + t.gold * 0.5 + t.cities * 5000;
}

function dipOfficerCheck(state, fromKey, officerId) {
  const officer = state.officers[officerId];
  if (!officer || officer.status !== "active" || officer.state !== fromKey) return { ok: false, reason: "須指派己方在職武將為使。" };
  if (officer.acted) return { ok: false, reason: `${officer.name}本回合已行動。` };
  return { ok: true, officer };
}

function relation(state, a, b) {
  return state.states[a]?.relations[b];
}

function adjustRelation(state, a, b, delta) {
  const r = relation(state, a, b);
  if (!r) return;
  r.value = clamp(r.value + delta, -100, 100);
  if (r.value <= -60) r.war = true;
  if (r.value > -20) r.war = false;
}

export function proposeDiplomacy(state, action, fromKey, toKey, officerId, options = {}) {
  const spec = DIPLOMACY_ACTIONS[action];
  if (!spec) return { ok: false, reason: "未知外交行動。" };
  if (fromKey === toKey) return { ok: false, reason: "不可對自己外交。" };
  const from = state.states[fromKey], to = state.states[toKey];
  if (!from?.alive || !to?.alive) return { ok: false, reason: "對象不存在或已亡。" };
  const check = dipOfficerCheck(state, fromKey, officerId);
  if (!check.ok) return check;
  const officer = check.officer;
  const r = relation(state, fromKey, toKey);
  const dipMult = traitMult(officer, "diplomacy") * traitMult(officer, "all");
  const cha = officer.stats.cha, int = officer.stats.int;
  const pFrom = power(state, fromKey), pTo = power(state, toKey);
  const ratio = pFrom / Math.max(1, pTo);
  const city = state.cities[officer.location];
  let result = { ok: true, success: false, action };

  const finish = (success, text) => {
    officer.acted = true;
    result.success = success;
    log(state, `${from.name}・${officer.name}使${to.name}・${spec.name}：${text}`, "diplomacy");
    return result;
  };

  switch (action) {
    case "gift": {
      const amount = clamp(round(options.amount ?? 300), 100, 2000);
      if (!city || city.gold < amount) return { ok: false, reason: "金錢不足。" };
      city.gold -= amount;
      const delta = round((amount / 25) * dipMult);
      adjustRelation(state, fromKey, toKey, delta);
      return finish(true, `贈${amount}金，關係+${delta}。`);
    }
    case "persuade": {
      const prob = clamp(0.4 + (cha + int) / 250 + r.value / 300, 0.1, 0.9) * dipMult;
      if (chance(state, prob)) { adjustRelation(state, fromKey, toKey, 15); return finish(true, "遊說成功，關係+15。"); }
      return finish(false, "遊說不納。");
    }
    case "nap": {
      if (r.value < -20) return finish(false, "關係太差，不成。");
      const prob = clamp(0.5 + r.value / 150 + cha / 300, 0.15, 0.95) * dipMult;
      if (chance(state, prob)) { r.nap = true; adjustRelation(state, fromKey, toKey, 10); return finish(true, "約互不侵犯。"); }
      return finish(false, "拒約。");
    }
    case "trade": {
      if (r.value < 0) return finish(false, "關係不佳，不通商。");
      r.trade = true;
      const gold = round(200 * dipMult);
      if (city) city.gold += gold;
      adjustRelation(state, fromKey, toKey, 8);
      return finish(true, `通商，得${gold}金，關係+8。`);
    }
    case "alliance": {
      if (r.alliance) return finish(false, "已同盟。");
      if (r.value < 25) return finish(false, "關係未足（須≥25），先贈禮遊說。");
      const coalitionBonus = officer.traits.includes("合縱") ? 1.3 : 1;
      const prob = clamp(0.45 + r.value / 120 + cha / 250 - (ratio < 0.6 ? 0.2 : 0), 0.1, 0.95) * dipMult * coalitionBonus;
      if (chance(state, prob)) { r.alliance = true; r.nap = true; r.war = false; adjustRelation(state, fromKey, toKey, 20); return finish(true, "締結同盟！"); }
      return finish(false, "盟議不成。");
    }
    case "breakAlliance": {
      r.alliance = false; r.nap = false; r.trade = false;
      adjustRelation(state, fromKey, toKey, -40);
      return finish(true, "斷盟，關係-40。");
    }
    case "threaten": {
      adjustRelation(state, fromKey, toKey, -15);
      if (ratio > 1.6 && chance(state, clamp(0.3 + (ratio - 1) / 3, 0.1, 0.85))) {
        const tribute = round(300 * ratio);
        const toCity = citiesOf(state, toKey)[0];
        if (toCity) toCity.gold = Math.max(0, toCity.gold - tribute);
        if (city) city.gold += tribute;
        return finish(true, `脅迫成功，索貢${tribute}金。`);
      }
      return finish(false, "脅迫不屈，關係-15。");
    }
    case "coalition": {
      const against = options.against;
      if (!against || !state.states[against]?.alive) return { ok: false, reason: "須指定合縱對象。" };
      const coalitionBonus = officer.traits.includes("合縱") ? 1.35 : 1;
      const members = [fromKey];
      for (const s of Object.values(state.states)) {
        if (!s.alive || s.key === fromKey || s.key === against) continue;
        const rel = s.relations[against]?.value ?? 0;
        if (rel < -20 && chance(state, clamp(0.4 + cha / 250, 0.1, 0.85) * coalitionBonus)) {
          members.push(s.key);
          adjustRelation(state, fromKey, s.key, 15);
          s.relations[against].war = true;
        }
      }
      from.relations[against].war = true;
      adjustRelation(state, fromKey, against, -30);
      return finish(members.length > 1, `合縱${members.length}國共抗${state.states[against].name}。`);
    }
    case "requestReinforcement": {
      if (!r.alliance) return finish(false, "非盟友，難求援。");
      adjustRelation(state, fromKey, toKey, 5);
      return finish(true, "盟友允諾相助（盟軍將自行出兵）。");
    }
    case "surrender": {
      const toCities = citiesOf(state, toKey).length;
      if (toCities > 2 || ratio < 2.2) return finish(false, "國力未足壓服，勸降不成。");
      const prob = clamp(0.3 + (ratio - 2) / 4 + cha / 300, 0.1, 0.9) * dipMult;
      if (chance(state, prob)) {
        to.vassalOf = fromKey;
        r.nap = true; r.war = false;
        adjustRelation(state, fromKey, toKey, 40);
        const tribute = round(500 * ratio);
        const toCity = citiesOf(state, toKey)[0];
        if (toCity) toCity.gold = Math.max(0, toCity.gold - tribute);
        if (city) city.gold += tribute;
        return finish(true, `${to.name}臣服納貢，歲貢${tribute}金。`);
      }
      return finish(false, "寧死不降。");
    }
    default:
      return { ok: false, reason: "未實装。" };
  }
}

// Exported for engine import symmetry; AI uses its own lightweight pass in ws-ai.
export function aiDiplomacy(state, key, api) {
  const officer = officersOf(state, key).filter((o) => !o.acted && o.stats.cha > 60)[0];
  if (!officer) return [];
  const others = Object.values(state.states).filter((s) => s.alive && s.key !== key);
  const target = others.sort((a, b) => (state.states[key].relations[a.key]?.value ?? 0) - (state.states[key].relations[b.key]?.value ?? 0))[0];
  if (!target) return [];
  const res = proposeDiplomacy(state, "gift", key, target.key, officer.id, { amount: 300 });
  return res.ok ? [`${state.states[key].name}贈禮${target.name}`] : [];
}
