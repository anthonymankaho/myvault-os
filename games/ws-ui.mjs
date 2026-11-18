// Warring States — UI layer. Renders entirely from Game State (single source of
// truth). No game logic here: every action calls the engine, then re-renders.

import { STATES, CITY_BY_ID, OFFICER_BY_ID, TERRAIN_LABELS, TRAITS, POSITIONS, TROOP_TYPES } from "./ws-data.mjs";
import { SCENARIOS, SCENARIO_BY_ID } from "./ws-scenarios.mjs";
import {
  createGame, develop, DOMESTIC, search, recruitOfficer, reward, transferOfficer,
  appointGovernor, assignPosition, moveArmy, transport, attack, stratagem, STRATAGEMS,
  diplomacy, endTurn, startPlayerPhase, citiesOf, officersOf, officersInCity,
  activeOfficersInCity, freeOfficersInCity, stateTotals, troopCap, TROOP_POP_RATIO,
  DIFFICULTIES, TAX_RATES, isPlayer, compTotal, compAttack, compDefense,
} from "./ws-engine.mjs";
import { DIPLOMACY_ACTIONS } from "./ws-diplomacy.mjs";
import { battleRound, autoTactic, finalizeBattle, ATTACK_TACTICS, DEFEND_TACTICS, autoResolveBattle } from "./ws-battle.mjs";
import { createHexBattle, hexReachable, hexAttackTargets, hexMove, hexAttack, hexEndPlayerPhase, hexPixel, HEX_COLS, HEX_ROWS, HEX_SIZE, TERRAIN_HEX_LABEL, checkConclusion } from "./ws-hexbattle.mjs";
import { checkBattleEvents } from "./ws-events.mjs";
import { SaveManager, localStorageAdapter } from "./ws-save.mjs";
import { formatNumber, yearLabel, MONTH_LABELS, SEASON_OF_MONTH, SEASON_LABELS, clamp } from "./ws-util.mjs";

const app = document.getElementById("app");
const saves = new SaveManager(localStorageAdapter());
const ui = {
  screen: "title", state: null, selectedCity: null, tab: "city",
  scenario: "changping", playerState: "qin", difficulty: "normal",
  officerSort: { key: "lead", dir: -1 }, modal: null, battle: null,
  fullscreen: false, hex: null,
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = formatNumber;
const stateColor = (key) => STATES[key]?.color ?? "#888";
const stateName = (key) => STATES[key]?.name ?? "—";

function compSummary(comp) {
  if (!comp) return "—";
  const parts = Object.entries(comp).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${TROOP_TYPES[k]?.name ?? k}${Math.round(v / 1000)}k`);
  return parts.join("・") || "無";
}

function toast(msg) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function postFullscreen(active) {
  ui.fullscreen = active;
  try { window.parent.postMessage({ type: "myvault-warring-states", action: "fullscreen", active }, window.location.origin); } catch {}
}

// ---- Sound hooks (procedural WebAudio, no external assets) ----
let audioCtx = null, soundOn = true;
function beep(freq = 440, dur = 0.09, type = "sine", gain = 0.04) {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = gain;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.stop(audioCtx.currentTime + dur);
  } catch { /* audio unavailable */ }
}

// ---------------------------------------------------------------------------
// Rendering root
// ---------------------------------------------------------------------------
function render() {
  if (ui.screen === "title") renderTitle();
  else if (ui.screen === "game") renderGame();
  else if (ui.screen === "outcome") renderOutcome();
  renderModal();
}

// ---- Title / new game ----
function renderTitle() {
  const sc = SCENARIO_BY_ID[ui.scenario];
  const autoMeta = saves.list().find((s) => s.slot === "auto")?.meta;
  app.innerHTML = `
    <div class="title-screen">
      <div class="title-hero">
        <h1>春秋戰國</h1>
        <div class="sub">SPRING &amp; AUTUMN · WARRING STATES</div>
        <div class="tag">原創歷史戰略模擬 · ターン制grand strategy。研究 KOEI《三國志VI》之策略哲學而重新設計，不使用其任何受版權保護內容。史料分級：史實／演義（《東周列國志》）／待考。能力值為遊戲設計估值，地圖為示意戰略圖。</div>
      </div>
      <div class="setup">
        <div class="setup-section">
          <h3>一・擇劇本 Select Scenario</h3>
          <div class="scenario-grid">
            ${SCENARIOS.map((s) => `
              <button class="scenario-card ${s.id === ui.scenario ? "sel" : ""}" data-scenario="${s.id}">
                <div class="yr">${yearLabel(s.year)}</div>
                <div class="nm">${esc(s.name)}</div>
                <div class="en">${esc(s.en)}</div>
              </button>`).join("")}
          </div>
          <div class="intro-box">${esc(sc.intro)}</div>
        </div>
        <div class="setup-section">
          <h3>二・擇國 Select State</h3>
          <div class="state-grid">
            ${sc.states.map((k) => `
              <button class="state-card ${k === ui.playerState ? "sel" : ""}" data-state="${k}" style="color:${stateColor(k)}">
                <div class="seal">${stateName(k)}</div>
                <div class="nm">${esc(STATES[k].en)}</div>
              </button>`).join("")}
          </div>
          <div class="hint" style="margin-top:10px">${esc(STATES[ui.playerState]?.desc ?? "")}</div>
        </div>
        <div class="setup-section">
          <h3>三・難度 Difficulty</h3>
          <div class="diff-row">
            ${Object.entries(DIFFICULTIES).map(([k, d]) => `<button class="btn ${k === ui.difficulty ? "sel" : ""}" data-diff="${k}">${d.name} ${d.en}</button>`).join("")}
          </div>
        </div>
        <div class="start-row">
          <button class="btn btn-primary" id="start-game" style="padding:12px 36px;font-size:16px">開新遊戲 New Game ▶</button>
          ${autoMeta ? `<button class="btn" id="continue-auto">繼續自動存檔（${esc(autoMeta.name)}・第${autoMeta.turn}回合）</button>` : ""}
          <button class="btn" id="title-load">讀取存檔 Load</button>
          <button class="btn btn-ghost" id="title-help">說明 Help</button>
        </div>
      </div>
    </div>`;
  app.querySelectorAll("[data-scenario]").forEach((b) => b.addEventListener("click", () => {
    ui.scenario = b.dataset.scenario;
    const s = SCENARIO_BY_ID[ui.scenario];
    if (!s.states.includes(ui.playerState)) ui.playerState = s.states[0];
    render();
  }));
  app.querySelectorAll("[data-state]").forEach((b) => b.addEventListener("click", () => { ui.playerState = b.dataset.state; render(); }));
  app.querySelectorAll("[data-diff]").forEach((b) => b.addEventListener("click", () => { ui.difficulty = b.dataset.diff; render(); }));
  app.querySelector("#start-game").addEventListener("click", () => {
    ui.state = createGame(ui.scenario, ui.playerState, ui.difficulty);
    ui.selectedCity = citiesOf(ui.state, ui.playerState).find((c) => c.tier === "capital")?.id ?? citiesOf(ui.state, ui.playerState)[0]?.id;
    ui.screen = "game"; ui.tab = "city";
    saves.autosave(ui.state);
    render();
  });
  app.querySelector("#continue-auto")?.addEventListener("click", () => {
    try { ui.state = saves.load("auto"); ui.screen = "game"; ui.selectedCity = citiesOf(ui.state, ui.playerState = ui.state.playerState)[0]?.id; render(); }
    catch (e) { toast(e.message); }
  });
  app.querySelector("#title-load").addEventListener("click", () => openSaveLoad("load"));
  app.querySelector("#title-help").addEventListener("click", () => openHelp());
}

// ---- Main game ----
function renderGame() {
  const s = ui.state;
  const st = s.states[s.playerState];
  const totals = stateTotals(s, s.playerState);
  app.innerHTML = `
    <div class="game">
      <div class="topbar">
        <div class="seal" style="color:${st.color}">${st.name}</div>
        <div class="clock">${yearLabel(s.year)}${MONTH_LABELS[s.month - 1]}<small>${SEASON_LABELS[SEASON_OF_MONTH[s.month - 1]]}・第${s.turn}回合・${esc(SCENARIO_BY_ID[s.scenarioId].name)}</small></div>
        <div class="resources">
          <div class="res"><b style="color:#e6c65a">${fmt(totals.gold)}</b><small>金 GOLD</small></div>
          <div class="res"><b style="color:#a0d080">${fmt(totals.food)}</b><small>糧 FOOD</small></div>
          <div class="res"><b style="color:#f0a0a0">${fmt(totals.troops)}</b><small>兵 TROOPS</small></div>
          <div class="res"><b>${totals.cities}</b><small>城 CITIES</small></div>
          <div class="res"><b>${totals.officers}</b><small>將 OFFICERS</small></div>
        </div>
        <div class="spacer"></div>
        <div class="actions">
          <button class="btn btn-sm" id="tb-save">保存</button>
          <button class="btn btn-sm" id="tb-load">讀取</button>
          <button class="btn btn-sm" id="tb-sound" title="音效開關">${soundOn ? "🔊" : "🔇"}</button>
          <button class="btn btn-sm" id="tb-help">說明</button>
          <button class="btn btn-sm" id="tb-fullscreen">${ui.fullscreen ? "離開全螢幕" : "全螢幕"}</button>
          <button class="btn btn-sm btn-ghost" id="tb-title">主選單</button>
          <button class="btn btn-primary" id="tb-endturn">結束回合 ▶</button>
        </div>
      </div>
      <div class="main">
        <div class="map-wrap" id="map-wrap">${renderMap(s)}<div class="map-hint">點選城市以管理 · 原創近似歷史地理圖（春秋／戰國中國）</div></div>
        <div class="side">
          <div class="tabs">
            ${[["city", "城市"], ["officers", "武將"], ["military", "軍事"], ["diplomacy", "外交"], ["intel", "情報"], ["log", "事件"]].map(([k, label]) => `<button class="tab ${ui.tab === k ? "sel" : ""}" data-tab="${k}">${label}</button>`).join("")}
          </div>
          <div class="panel" id="panel">${renderPanel(s)}</div>
        </div>
      </div>
    </div>
    <button class="btn btn-sm fullscreen-btn" id="fs-corner" title="全螢幕">⛶</button>`;
  wireTopbar();
  wireMap();
  wireTabs();
  wirePanel();
  app.querySelector("#fs-corner").addEventListener("click", () => postFullscreen(!ui.fullscreen));
}

function wireTopbar() {
  app.querySelector("#tb-save").addEventListener("click", () => openSaveLoad("save"));
  app.querySelector("#tb-load").addEventListener("click", () => openSaveLoad("load"));
  app.querySelector("#tb-sound").addEventListener("click", (e) => { soundOn = !soundOn; e.currentTarget.textContent = soundOn ? "🔊" : "🔇"; if (soundOn) beep(660); });
  app.querySelector("#tb-help").addEventListener("click", () => openHelp());
  app.querySelector("#tb-fullscreen").addEventListener("click", () => postFullscreen(!ui.fullscreen));
  app.querySelector("#tb-title").addEventListener("click", () => { saves.autosave(ui.state); ui.screen = "title"; render(); });
  app.querySelector("#tb-endturn").addEventListener("click", doEndTurn);
}

function wireTabs() {
  app.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { ui.tab = b.dataset.tab; render(); }));
}

// ---- Map (SVG) ----
function convexHull(points) {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = []; for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = []; for (const p of pts.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Original antique-style geographic base map of Spring-&-Autumn / Warring-States
// China (approximate real geography: lon 100-125E, lat 22-43N -> 920x700).
// Hand-authored SVG; no copyrighted map assets. Classical river/lake/sea names.
function renderBaseMap() {
  const sea = "#12303f";
  const river = "#3a6a8a";
  const lake = "#2a5a6a";
  const range = "#4a5a4a";
  const lbl = "#5a8aaa";
  const mlbl = "#6a7a6a";
  const coast = "M880,0 L860,40 L846,66 L820,90 L790,110 L760,120 L740,140 L720,150 L700,160 L690,180 L700,190 L720,195 L760,200 L790,210 L800,225 L780,240 L750,250 L720,260 L700,280 L710,300 L720,320 L730,340 L740,360 L760,375 L780,385 L790,400 L770,410 L760,420 L780,433 L800,450 L810,480 L820,520 L830,560 L840,620 L850,700 L920,700 L920,0 Z";
  const peaks = (x, y, n = 3) => {
    let d = "";
    for (let i = 0; i < n; i++) d += `M${x + i * 12},${y} l6,-11 l6,11 `;
    return `<path d="${d}" fill="none" stroke="${range}" stroke-width="2" stroke-linejoin="round" opacity="0.8"/>`;
  };
  return `
    <path d="${coast}" fill="${sea}" fill-opacity="0.55"/>
    <path d="${coast}" fill="none" stroke="#4a7a9a" stroke-opacity="0.5" stroke-width="1.5"/>
    <g fill="none" stroke="${river}" stroke-opacity="0.55" stroke-width="3" stroke-linecap="round">
      <path d="M280,60 C330,66 350,90 356,130 C360,170 356,180 357,196 C360,230 368,252 396,260 C430,268 460,260 492,254 C530,247 552,240 588,234 C628,227 656,214 686,202 C706,193 714,172 720,152"/>
      <path d="M240,290 C272,286 300,290 320,290 C345,288 356,280 360,268" stroke-width="2.5"/>
      <path d="M460,177 C450,200 435,220 423,232 C415,240 410,246 405,252" stroke-width="2.5"/>
      <path d="M440,270 C450,276 456,278 462,276 C475,272 485,266 492,258" stroke-width="2"/>
      <path d="M520,262 C560,258 600,252 640,246 C670,240 690,230 706,222" stroke-width="2"/>
      <path d="M470,340 C510,342 548,340 588,338 C628,336 668,336 700,336 C720,336 730,340 740,344" stroke-width="2.5"/>
      <path d="M140,440 C200,436 260,430 320,428 C380,426 420,424 449,423 C490,420 520,412 560,404 C600,398 640,394 680,392 C720,390 740,390 758,390 C775,389 785,384 795,378" stroke-width="4"/>
      <path d="M258,330 C300,340 340,352 380,368 C410,380 430,398 449,410 C455,416 452,420 449,423" stroke-width="2.5"/>
      <path d="M478,493 C476,470 474,455 470,445" stroke-width="2"/>
      <path d="M600,470 C600,455 600,445 600,436" stroke-width="2"/>
    </g>
    <g fill="${lake}" fill-opacity="0.5" stroke="#4a8a9a" stroke-opacity="0.4">
      <ellipse cx="455" cy="440" rx="34" ry="16"/>
      <ellipse cx="470" cy="470" rx="22" ry="14"/>
      <ellipse cx="600" cy="430" rx="20" ry="26"/>
      <ellipse cx="740" cy="398" rx="16" ry="12"/>
      <ellipse cx="540" cy="196" rx="14" ry="8"/>
      <ellipse cx="600" cy="262" rx="14" ry="8"/>
    </g>
    ${peaks(466, 150, 4)}${peaks(470, 190, 3)}
    ${peaks(250, 318, 6)}${peaks(330, 316, 5)}
    ${peaks(618, 236, 2)}${peaks(362, 282, 2)}${peaks(342, 420, 3)}${peaks(596, 80, 3)}
    <g font-family="serif" fill="${lbl}" fill-opacity="0.75" font-size="12">
      <text x="418" y="250">河水</text><text x="560" y="414">江水</text><text x="600" y="332">淮水</text>
      <text x="292" y="282">渭水</text><text x="436" y="205">汾水</text><text x="344" y="352">漢水</text><text x="636" y="240">濟水</text>
      <text x="735" y="140" font-size="14">渤海</text><text x="800" y="270" font-size="14">黃海</text><text x="830" y="430" font-size="14">東海</text>
    </g>
    <g font-family="serif" fill="${mlbl}" fill-opacity="0.8" font-size="11">
      <text x="452" y="460">雲夢澤</text><text x="462" y="488">洞庭</text><text x="592" y="460">彭蠡澤</text><text x="732" y="414">具區</text>
      <text x="492" y="176">太行</text><text x="300" y="332">秦嶺</text><text x="640" y="232">泰山</text><text x="372" y="296">華山</text><text x="330" y="436">巫山</text><text x="606" y="72">燕山</text>
    </g>`;
}

function renderMap(s) {
  const active = Object.values(s.cities).filter((c) => c.active && c.state);
  const byState = {};
  for (const c of active) (byState[c.state] ??= []).push(c);
  let territories = "";
  for (const [key, cities] of Object.entries(byState)) {
    const color = stateColor(key);
    const pts = cities.map((c) => ({ x: c.x, y: c.y }));
    if (pts.length >= 3) {
      const hull = convexHull(pts);
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const expanded = hull.map((p) => ({ x: cx + (p.x - cx) * 1.18, y: cy + (p.y - cy) * 1.18 }));
      const d = expanded.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(" ") + " Z";
      territories += `<path d="${d}" fill="${color}" fill-opacity="0.10" stroke="${color}" stroke-opacity="0.35" stroke-width="1.5" stroke-linejoin="round"/>`;
    } else {
      for (const p of pts) territories += `<circle cx="${p.x}" cy="${p.y}" r="46" fill="${color}" fill-opacity="0.10" stroke="${color}" stroke-opacity="0.3" stroke-width="1.5"/>`;
    }
  }
  let edges = "";
  const drawn = new Set();
  for (const c of active) for (const adj of c.adjacent) {
    const n = s.cities[adj]; if (!n?.active) continue;
    const key = [c.id, adj].sort().join("-"); if (drawn.has(key)) continue; drawn.add(key);
    edges += `<line x1="${c.x}" y1="${c.y}" x2="${n.x}" y2="${n.y}" stroke="#2c3a33" stroke-width="1" stroke-dasharray="3,4"/>`;
  }
  let nodes = "";
  for (const c of active) {
    const color = stateColor(c.state);
    const sel = c.id === ui.selectedCity;
    const r = c.tier === "capital" ? 9 : c.tier === "major" ? 7 : 5.5;
    nodes += `<g class="city-node" data-city="${c.id}">
      ${sel ? `<circle cx="${c.x}" cy="${c.y}" r="${r + 7}" fill="none" stroke="#e6c65a" stroke-width="2"><animate attributeName="r" values="${r + 5};${r + 9};${r + 5}" dur="2s" repeatCount="indefinite"/></circle>` : ""}
      <circle class="dot" cx="${c.x}" cy="${c.y}" r="${r}" fill="${color}" stroke="#0c1210" stroke-width="2"/>
      ${c.tier === "capital" ? `<circle cx="${c.x}" cy="${c.y}" r="${r - 3.5}" fill="#0c1210"/>` : ""}
      <text class="city-label" x="${c.x}" y="${c.y - r - 5}" text-anchor="middle">${esc(c.name)}</text>
      <text class="city-troops" x="${c.x}" y="${c.y + r + 11}" text-anchor="middle">${fmt(c.troops)}</text>
    </g>`;
  }
  let armies = "";
  for (const a of s.armies) {
    const from = s.cities[a.from], to = s.cities[a.target];
    if (!from || !to) continue;
    const t = a.turnsLeft <= 0 ? 0.85 : 0.5;
    const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t;
    const color = stateColor(a.state);
    armies += `<g><rect x="${x - 15}" y="${y - 10}" width="30" height="20" rx="4" fill="#0c1210" stroke="${color}" stroke-width="1.5"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10" fill="${color}">${a.kind === "attack" ? "⚔" : "➤"}${Math.round(a.troops / 1000)}k</text></g>`;
  }
  const legend = Object.keys(byState).map((k) => `<span class="legend-chip" data-legend="${k}" style="color:${stateColor(k)};border-color:${stateColor(k)}66">${stateName(k)}</span>`).join("");
  return `<svg viewBox="110 30 800 520" preserveAspectRatio="xMidYMid meet">
    <rect x="110" y="30" width="800" height="520" fill="transparent"/>
    ${renderBaseMap()}${territories}${edges}${nodes}${armies}
  </svg><div class="map-legend">${legend}</div>`;
}

function wireMap() {
  app.querySelectorAll(".city-node").forEach((g) => g.addEventListener("click", () => {
    ui.selectedCity = g.dataset.city; ui.tab = "city"; render();
  }));
  app.querySelectorAll("[data-legend]").forEach((chip) => chip.addEventListener("click", () => {
    const k = chip.dataset.legend;
    const cap = citiesOf(ui.state, k).find((c) => c.tier === "capital") ?? citiesOf(ui.state, k)[0];
    if (cap) { ui.selectedCity = cap.id; ui.tab = "city"; render(); }
  }));
}

// ---- Side panel ----
function renderPanel(s) {
  switch (ui.tab) {
    case "city": return renderCityPanel(s);
    case "officers": return renderOfficersPanel(s);
    case "military": return renderMilitaryPanel(s);
    case "diplomacy": return renderDiplomacyPanel(s);
    case "intel": return renderIntelPanel(s);
    case "log": return renderLogPanel(s);
    default: return "";
  }
}

function statBar(label, value, max, color) {
  const pct = clamp(value / max * 100, 0, 100);
  return `<div class="stat" title="${label}：${fmt(value)} / ${fmt(max)}"><small>${label}</small><b>${fmt(value)}</b><div class="bar"><i style="width:${pct}%;background:${color}"></i></div></div>`;
}

function renderCityPanel(s) {
  const c = s.cities[ui.selectedCity];
  if (!c || !c.active) return `<div class="hint">請於地圖點選城市。</div>`;
  const mine = c.state === s.playerState;
  const color = stateColor(c.state);
  const gov = c.governor ? s.officers[c.governor] : null;
  const officers = officersInCity(s, c.id);
  const cap = troopCap(c);
  return `
    <div class="card">
      <h4 style="color:${color}">${esc(c.name)} <span class="pill" style="color:${color};border-color:${color}66">${stateName(c.state)}</span> <span class="pill">${TERRAIN_LABELS[c.terrain]}</span></h4>
      <div class="hint" style="margin-bottom:10px">${esc(c.note)}</div>
      <div class="stat-grid">
        ${statBar("人口", c.population, 500000, "#9aa79c")}
        ${statBar("兵力", c.troops, Math.max(cap, c.troops), "#e05252")}
        ${statBar("農業", c.agriculture, 100, "#a0d080")}
        ${statBar("商業", c.commerce, 100, "#e6c65a")}
        ${statBar("城防", c.defense, 100, "#8ab4f0")}
        ${statBar("治安", c.order, 100, "#2dd4bf")}
        ${statBar("訓練", c.training, 100, "#f0a060")}
        ${statBar("士氣", c.morale, 100, "#c090f0")}
        ${statBar("金", c.gold, 10000, "#e6c65a")}
        ${statBar("糧", c.food, 80000, "#a0d080")}
      </div>
      <div class="hint" style="margin-top:8px">徵兵上限＝人口×20%＝<b style="color:#f0a0a0">${fmt(cap)}</b>（現駐兵${fmt(c.troops)}；駐兵可高於徵兵上限，如歷史常備軍／增援）。太守：${gov ? esc(gov.name) : "未任命"}。</div>
      <div class="hint" style="margin-top:6px">兵種：${compSummary(c.comp)} ・ 全軍攻×${compAttack(c.comp).toFixed(2)} 防×${compDefense(c.comp).toFixed(2)}</div>
      ${mine ? `<div class="cmd-row">
        <button class="btn btn-sm" data-cmd="domestic">內政</button>
        <button class="btn btn-sm" data-cmd="recruit">徵兵</button>
        <button class="btn btn-sm" data-cmd="military">軍事</button>
        <button class="btn btn-sm" data-cmd="personnel">人事</button>
        <button class="btn btn-sm" data-cmd="intel">計略</button>
        <button class="btn btn-sm" data-cmd="transport">運輸</button>
        <button class="btn btn-sm" data-cmd="tax">稅率</button>
      </div>` : `<div class="hint" style="margin-top:8px;color:#f0a0a0">非己方城市。可於軍事頁出陣攻打（須相鄰）。</div>`}
    </div>
    <div class="card">
      <h4>城中人物（${officers.length}）</h4>
      ${officers.length ? `<table class="tbl"><thead><tr><th>姓名</th><th>統</th><th>武</th><th>智</th><th>政</th><th>魅</th><th>忠</th><th>職</th></tr></thead><tbody>
        ${officers.map((o) => `<tr class="click" data-officer="${o.id}"><td>${esc(o.name)}${o.status === "free" ? ' <span class="pill">在野</span>' : o.status === "captured" ? ' <span class="pill" style="color:#f0a0a0">俘</span>' : ""}</td><td>${o.stats.lead}</td><td>${o.stats.war}</td><td>${o.stats.int}</td><td>${o.stats.pol}</td><td>${o.stats.cha}</td><td class="${o.loyalty > 70 ? "loyal-hi" : o.loyalty > 45 ? "loyal-mid" : "loyal-lo"}">${o.loyalty}</td><td>${o.position ? POSITIONS[o.position].name : "—"}</td></tr>`).join("")}
      </tbody></table>` : `<div class="hint">無人物。</div>`}
    </div>`;
}

function renderOfficersPanel(s) {
  const list = officersOf(s, s.playerState);
  const { key, dir } = ui.officerSort;
  const sorted = [...list].sort((a, b) => {
    const av = key === "name" ? a.name : key === "loyalty" ? a.loyalty : key === "location" ? (s.cities[a.location]?.name ?? "") : a.stats[key];
    const bv = key === "name" ? b.name : key === "loyalty" ? b.loyalty : key === "location" ? (s.cities[b.location]?.name ?? "") : b.stats[key];
    return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
  });
  const th = (k, label) => `<th data-sort="${k}">${label}${key === k ? (dir < 0 ? " ▼" : " ▲") : ""}</th>`;
  return `<div class="card"><h4>己方武將（${list.length}）</h4>
    <table class="tbl"><thead><tr>${th("name", "姓名")}${th("lead", "統")}${th("war", "武")}${th("int", "智")}${th("pol", "政")}${th("cha", "魅")}${th("loyalty", "忠")}${th("location", "駐地")}<th>職</th></tr></thead>
    <tbody>${sorted.map((o) => `<tr class="click" data-officer="${o.id}"><td>${esc(o.name)}${o.acted ? ' <span class="pill" style="color:#6b7a6e">已動</span>' : ""}${o.wounded > 0 ? ' <span class="pill" style="color:#f0a0a0">傷</span>' : ""}</td><td>${o.stats.lead}</td><td>${o.stats.war}</td><td>${o.stats.int}</td><td>${o.stats.pol}</td><td>${o.stats.cha}</td><td class="${o.loyalty > 70 ? "loyal-hi" : o.loyalty > 45 ? "loyal-mid" : "loyal-lo"}">${o.loyalty}</td><td>${esc(s.cities[o.location]?.name ?? "—")}</td><td>${o.position ? POSITIONS[o.position].name : "—"}</td></tr>`).join("")}</tbody></table>
    <div class="hint" style="margin-top:8px">點姓名查看详情、褒賞、移動、任命。每將每回合可行動一次。</div>
  </div>`;
}

function renderMilitaryPanel(s) {
  const armies = s.armies.filter((a) => a.state === s.playerState);
  const myCities = citiesOf(s, s.playerState);
  return `
    <div class="card"><h4>行軍中（${armies.length}）</h4>
      ${armies.length ? armies.map((a) => `<div class="kv"><span>${esc(s.officers[a.commander]?.name ?? "軍")}・${a.kind === "attack" ? "攻" : "移"}${esc(s.cities[a.target]?.name)}</span><span>${fmt(a.troops)}兵・${fmt(a.food)}糧・${a.turnsLeft <= 0 ? "抵達" : a.turnsLeft + "回合"}</span></div>`).join("") : `<div class="hint">無行軍。</div>`}
    </div>
    <div class="card"><h4>調度</h4>
      <div class="hint">於城市頁按「軍事」出陣／移動；或選下方城市快速出陣。</div>
      <div class="cmd-row">${myCities.filter((c) => c.adjacent.some((id) => s.cities[id]?.active && s.cities[id]?.state && s.cities[id].state !== s.playerState)).map((c) => `<button class="btn btn-sm" data-attackfrom="${c.id}">${esc(c.name)}出陣</button>`).join("") || '<span class="hint">無相鄰敵城。</span>'}</div>
    </div>`;
}

function renderDiplomacyPanel(s) {
  const st = s.states[s.playerState];
  const others = Object.values(s.states).filter((x) => x.alive && x.key !== s.playerState);
  return `<div class="card"><h4>外交 Relations</h4>
    ${others.map((o) => {
      const r = st.relations[o.key];
      const tags = [r.alliance ? "同盟" : "", r.nap ? "互不侵犯" : "", r.trade ? "通商" : "", r.war ? "戰爭" : "", o.vassalOf === s.playerState ? "臣服" : ""].filter(Boolean).join("・");
      return `<div class="kv"><span style="color:${stateColor(o.key)}">${stateName(o.key)} <span class="hint">${tags || "中立"}</span></span><span class="${r.value > 20 ? "loyal-hi" : r.value < -30 ? "loyal-lo" : "loyal-mid"}">${r.value > 0 ? "+" : ""}${r.value}</span></div>`;
    }).join("")}
    <div class="cmd-row" style="margin-top:12px"><button class="btn btn-sm" data-dip="open">遣使外交</button></div>
    <div class="hint" style="margin-top:8px">同盟須關係≥25；合縱可聯合諸侯共抗強敵。結果受國力、軍力、關係、武將能力、性格影響。</div>
  </div>`;
}

function renderIntelPanel(s) {
  const myCities = citiesOf(s, s.playerState);
  return `<div class="card"><h4>計略 Intelligence</h4>
    <div class="hint">流言（敵治安・忠誠↓）、破壞（相鄰敵城防↓）、離間（敵將忠誠↓）。成功率受智力、敵方謀士、特技影響。選城市施計：</div>
    <div class="cmd-row">${myCities.map((c) => `<button class="btn btn-sm" data-intelfrom="${c.id}">${esc(c.name)}</button>`).join("")}</div>
  </div>`;
}

function renderLogPanel(s) {
  const items = [...s.log].reverse().slice(0, 120);
  return `<div class="card"><h4>事件簿 Chronicle</h4><div class="log-feed">
    ${items.map((l) => `<div class="log-item ${l.kind}"><span class="when">${yearLabel(l.year)}${MONTH_LABELS[l.month - 1]}</span> ${esc(l.text)}</div>`).join("") || '<div class="hint">暫無記錄。</div>'}
  </div></div>`;
}

function wirePanel() {
  app.querySelectorAll("[data-officer]").forEach((tr) => tr.addEventListener("click", () => openOfficer(tr.dataset.officer)));
  app.querySelectorAll("[data-sort]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.sort;
    if (ui.officerSort.key === k) ui.officerSort.dir *= -1; else { ui.officerSort.key = k; ui.officerSort.dir = -1; }
    render();
  }));
  app.querySelectorAll("[data-cmd]").forEach((b) => b.addEventListener("click", () => {
    const cmd = b.dataset.cmd;
    if (cmd === "domestic") openDomestic(ui.selectedCity);
    else if (cmd === "recruit") openDomestic(ui.selectedCity, "recruit");
    else if (cmd === "military") openMilitary(ui.selectedCity);
    else if (cmd === "personnel") openPersonnel(ui.selectedCity);
    else if (cmd === "intel") openIntel(ui.selectedCity);
    else if (cmd === "transport") openTransport(ui.selectedCity);
    else if (cmd === "tax") openTax();
  }));
  app.querySelectorAll("[data-attackfrom]").forEach((b) => b.addEventListener("click", () => openMilitary(b.dataset.attackfrom, "attack")));
  app.querySelectorAll("[data-intelfrom]").forEach((b) => b.addEventListener("click", () => openIntel(b.dataset.intelfrom)));
  app.querySelector("[data-dip='open']")?.addEventListener("click", () => openDiplomacy());
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function openModal(title, body, foot, wide = false) {
  ui.modal = { title, body, foot, wide };
  renderModal();
}
function closeModal() { ui.modal = null; renderModal(); }

function renderModal() {
  document.querySelector(".modal-backdrop")?.remove();
  if (ui.battle) { renderBattleModal(); return; }
  if (!ui.modal) return;
  const { title, body, foot, wide } = ui.modal;
  const el = document.createElement("div");
  el.className = "modal-backdrop";
  el.innerHTML = `<div class="modal ${wide ? "wide" : ""}"><div class="modal-head"><h3>${title}</h3><button class="btn btn-sm btn-ghost" id="modal-x">✕</button></div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ""}</div>`;
  document.body.appendChild(el);
  el.querySelector("#modal-x").addEventListener("click", closeModal);
  el.querySelector("#modal-cancel")?.addEventListener("click", closeModal);
  el.addEventListener("click", (e) => { if (e.target === el) closeModal(); });
  if (ui.modal.wire) ui.modal.wire(el);
}

function officerOptions(cityId, filter = () => true) {
  return activeOfficersInCity(ui.state, cityId).filter((o) => !o.acted && o.wounded <= 0 && filter(o));
}

function openDomestic(cityId, preset) {
  const c = ui.state.cities[cityId];
  const officers = officerOptions(cityId);
  if (!officers.length) { toast("城中無可行動之武將。"); return; }
  let action = preset ?? "agriculture";
  let officerId = officers[0].id;
  let troopType = "infantry";
  let lastResult = "";
  const body = () => `
    <div class="field"><label>指令 Command（${esc(c.name)}・金${fmt(c.gold)}・糧${fmt(c.food)}）</label>
      <div class="opt-grid">${Object.entries(DOMESTIC).map(([k, d]) => `<button class="opt ${k === action ? "sel" : ""}" data-act="${k}"><div class="t">${d.name}</div><div class="d">${d.desc}${d.gold ? " ・" + d.gold + "金" : ""}${d.food ? " ・" + d.food + "糧" : ""}</div></button>`).join("")}</div>
    </div>
    <div class="field"><label>執行武將 Officer</label><select id="dom-officer">${officers.map((o) => `<option value="${o.id}" ${o.id === officerId ? "selected" : ""}>${esc(o.name)}（政${o.stats.pol} 魅${o.stats.cha} 統${o.stats.lead}）</option>`).join("")}</select></div>
    ${action === "recruit" ? `<div class="field"><label>兵種 Troop Type（徵兵上限＝人口20%＝${fmt(troopCap(c))}，現駐兵${fmt(c.troops)}；特殊兵種只限本國）</label><div class="opt-grid">${Object.values(TROOP_TYPES).filter((t) => !t.states || t.states.includes(ui.state.playerState)).map((t) => `<button class="opt ${t.id === troopType ? "sel" : ""}" data-tt="${t.id}"><div class="t">${t.name}${t.rating ? ` <span class="pill">評${t.rating}</span>` : ""}</div><div class="d">攻×${t.attack} 防×${t.defense}・${t.gold}金/${t.food}糧（每千）</div></button>`).join("")}</div></div>` : ""}
    <div id="dom-result">${lastResult}</div>`;
  const wire = (el) => {
    el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => { action = b.dataset.act; refresh(); }));
    el.querySelectorAll("[data-tt]").forEach((b) => b.addEventListener("click", () => { troopType = b.dataset.tt; refresh(); }));
    el.querySelector("#dom-officer").addEventListener("change", (e) => { officerId = e.target.value; });
    el.querySelector("#dom-go").addEventListener("click", () => {
      const res = develop(ui.state, cityId, action, officerId, troopType);
      if (res.ok) { lastResult = `<div class="result-msg ok">${esc(res.label ?? "成功")}。</div>`; beep(520); saves.autosave(ui.state); renderGame(); refresh(); }
      else { lastResult = `<div class="result-msg no">${esc(res.reason)}</div>`; refresh(); }
    });
  };
  const refresh = () => { ui.modal.body = body(); ui.modal.wire = wire; renderModal(); };
  openModal(`內政・${esc(c.name)}`, body(), `<button class="btn" id="modal-cancel">關閉</button><button class="btn btn-primary" id="dom-go">執行</button>`);
  ui.modal.wire = (el) => { wire(el); el.querySelector("#modal-cancel").addEventListener("click", closeModal); };
  renderModal();
}

function openMilitary(cityId, mode = "attack") {
  const c = ui.state.cities[cityId];
  const s = ui.state;
  const officers = officerOptions(cityId, (o) => o.stats.lead > 40);
  if (!officers.length) { toast("城中無可用主帥（須統率>40且未行動）。"); return; }
  const targets = c.adjacent.map((id) => s.cities[id]).filter((n) => n?.active && n.state);
  const enemyTargets = targets.filter((n) => n.state !== s.playerState);
  const ownTargets = targets.filter((n) => n.state === s.playerState);
  let kind = mode === "attack" && enemyTargets.length ? "attack" : "move";
  let commander = officers.sort((a, b) => b.stats.lead - a.stats.lead)[0].id;
  let target = (kind === "attack" ? enemyTargets : ownTargets)[0]?.id ?? "";
  let troops = Math.min(c.troops - 500, 20000);
  let food = Math.round(troops * 0.12);
  const body = () => `
    <div class="field"><label>行動</label><div class="diff-row">
      <button class="btn btn-sm ${kind === "attack" ? "sel" : ""}" data-kind="attack" ${enemyTargets.length ? "" : "disabled"}>出陣攻擊</button>
      <button class="btn btn-sm ${kind === "move" ? "sel" : ""}" data-kind="move" ${ownTargets.length ? "" : "disabled"}>移駐己城</button>
    </div></div>
    <div class="field"><label>主帥 Commander</label><select id="mil-cmd">${officers.map((o) => `<option value="${o.id}" ${o.id === commander ? "selected" : ""}>${esc(o.name)}（統${o.stats.lead} 武${o.stats.war} 智${o.stats.int}）</option>`).join("")}</select></div>
    <div class="field"><label>目標 Target</label><select id="mil-target">${(kind === "attack" ? enemyTargets : ownTargets).map((n) => `<option value="${n.id}" ${n.id === target ? "selected" : ""}>${esc(n.name)}（${stateName(n.state)}・${fmt(n.troops)}兵・防${n.defense}）</option>`).join("") || '<option value="">無相鄰目標</option>'}</select></div>
    <div class="field"><label>兵力 Troops（城內${fmt(c.troops)}，須留500守城）：<b id="mil-troops-val">${fmt(troops)}</b></label><input type="range" id="mil-troops" min="1000" max="${Math.max(1000, c.troops - 500)}" step="500" value="${troops}"></div>
    <div class="field"><label>攜糧 Food（城內${fmt(c.food)}）：<b id="mil-food-val">${fmt(food)}</b></label><input type="range" id="mil-food" min="0" max="${c.food}" step="500" value="${Math.min(food, c.food)}"></div>
    <div class="hint">行軍一回合抵達。攻軍抵達後進入戰鬥；糧盡則士氣潰散減員。</div>
    <div id="mil-result"></div>`;
  const wire = (el) => {
    el.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => { kind = b.dataset.kind; target = (kind === "attack" ? enemyTargets : ownTargets)[0]?.id ?? ""; refresh(); }));
    el.querySelector("#mil-cmd").addEventListener("change", (e) => { commander = e.target.value; });
    el.querySelector("#mil-target").addEventListener("change", (e) => { target = e.target.value; });
    el.querySelector("#mil-troops").addEventListener("input", (e) => { troops = +e.target.value; el.querySelector("#mil-troops-val").textContent = fmt(troops); });
    el.querySelector("#mil-food").addEventListener("input", (e) => { food = +e.target.value; el.querySelector("#mil-food-val").textContent = fmt(food); });
    el.querySelector("#mil-go").addEventListener("click", () => {
      if (!target) { el.querySelector("#mil-result").innerHTML = `<div class="result-msg no">請選目標。</div>`; return; }
      const fn = kind === "attack" ? attack : moveArmy;
      const res = fn(ui.state, cityId, target, troops, commander, [], food);
      if (res.ok) { closeModal(); beep(300, 0.12, "square"); saves.autosave(ui.state); render(); toast(kind === "attack" ? "出陣！" : "移駐！"); }
      else el.querySelector("#mil-result").innerHTML = `<div class="result-msg no">${esc(res.reason)}</div>`;
    });
  };
  const refresh = () => { ui.modal.body = body(); ui.modal.wire = wire; renderModal(); };
  openModal(`軍事・${esc(c.name)}`, body(), `<button class="btn" id="modal-cancel">關閉</button><button class="btn btn-primary" id="mil-go">出發</button>`);
  ui.modal.wire = (el) => { wire(el); el.querySelector("#modal-cancel").addEventListener("click", closeModal); };
  renderModal();
}

function openTransport(cityId) {
  const c = ui.state.cities[cityId];
  const own = c.adjacent.map((id) => ui.state.cities[id]).filter((n) => n?.active && n.state === ui.state.playerState);
  if (!own.length) { toast("無相鄰己方城市可運輸。"); return; }
  let target = own[0].id, gold = 0, food = 0;
  const body = () => `
    <div class="field"><label>目標</label><select id="tr-target">${own.map((n) => `<option value="${n.id}" ${n.id === target ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select></div>
    <div class="field"><label>金（${fmt(c.gold)}）：<b id="tr-gold-val">${fmt(gold)}</b></label><input type="range" id="tr-gold" min="0" max="${c.gold}" step="100" value="${gold}"></div>
    <div class="field"><label>糧（${fmt(c.food)}）：<b id="tr-food-val">${fmt(food)}</b></label><input type="range" id="tr-food" min="0" max="${c.food}" step="500" value="${food}"></div>
    <div id="tr-result"></div>`;
  const wire = (el) => {
    el.querySelector("#tr-target").addEventListener("change", (e) => { target = e.target.value; });
    el.querySelector("#tr-gold").addEventListener("input", (e) => { gold = +e.target.value; el.querySelector("#tr-gold-val").textContent = fmt(gold); });
    el.querySelector("#tr-food").addEventListener("input", (e) => { food = +e.target.value; el.querySelector("#tr-food-val").textContent = fmt(food); });
    el.querySelector("#tr-go").addEventListener("click", () => {
      const res = transport(ui.state, cityId, target, gold, food);
      if (res.ok) { closeModal(); render(); toast("運輸完成。"); } else el.querySelector("#tr-result").innerHTML = `<div class="result-msg no">${esc(res.reason)}</div>`;
    });
  };
  openModal(`運輸・${esc(c.name)}`, body(), `<button class="btn" id="modal-cancel">關閉</button><button class="btn btn-primary" id="tr-go">運輸</button>`);
  ui.modal.wire = (el) => { wire(el); el.querySelector("#modal-cancel").addEventListener("click", closeModal); };
  renderModal();
}

function openTax() {
  const st = ui.state.states[ui.state.playerState];
  const body = `<div class="field"><label>稅率（影響金收入與治安）</label><div class="diff-row">
    ${Object.entries(TAX_RATES).map(([k, v]) => `<button class="btn ${st.taxRate === k ? "sel" : ""}" data-tax="${k}">${{ low: "低稅", normal: "中稅", high: "高稅" }[k]}（×${v}）</button>`).join("")}
  </div></div><div class="hint">高稅：金×1.5，但每回合治安−2。低稅：金×0.6，治安較穩。</div>`;
  openModal("稅率 Taxation", body, `<button class="btn" id="modal-cancel">關閉</button>`);
  ui.modal.wire = (el) => {
    el.querySelector("#modal-cancel").addEventListener("click", closeModal);
    el.querySelectorAll("[data-tax]").forEach((b) => b.addEventListener("click", () => {
      const { setTaxRate } = engineRef; setTaxRate(ui.state, ui.state.playerState, b.dataset.tax); closeModal(); render();
    }));
  };
  renderModal();
}

function openPersonnel(cityId) {
  const c = ui.state.cities[cityId];
  const officers = officerOptions(cityId);
  const free = freeOfficersInCity(ui.state, cityId);
  const captured = Object.values(ui.state.officers).filter((o) => o.location === cityId && o.status === "captured");
  const body = `
    <div class="card"><h4>探索・登用</h4>
      <div class="hint">在野：${free.map((o) => esc(o.name)).join("、") || "無"}。被俘：${captured.map((o) => esc(o.name)).join("、") || "無"}。</div>
      <div class="cmd-row">
        <button class="btn btn-sm" id="per-search">探索（100金）</button>
        ${[...free, ...captured].map((o) => `<button class="btn btn-sm" data-recruit="${o.id}">登用${esc(o.name)}</button>`).join("")}
      </div><div id="per-result"></div>
    </div>
    <div class="card"><h4>任命太守</h4>
      <div class="cmd-row">${activeOfficersInCity(ui.state, cityId).map((o) => `<button class="btn btn-sm" data-gov="${o.id}">${esc(o.name)}（政${o.stats.pol}）</button>`).join("") || '<span class="hint">無武將。</span>'}</div>
    </div>`;
  openModal(`人事・${esc(c.name)}`, body, `<button class="btn" id="modal-cancel">關閉</button>`);
  ui.modal.wire = (el) => {
    el.querySelector("#modal-cancel").addEventListener("click", closeModal);
    const show = (res) => { el.querySelector("#per-result").innerHTML = res.ok ? `<div class="result-msg ok">${res.found ? "發現" + esc(ui.state.officers[res.found].name) + "！" : res.recruited ? "登用成功！" : res.recruited === false ? "登用失敗。" : "完成。"}</div>` : `<div class="result-msg no">${esc(res.reason)}</div>`; renderGame(); };
    el.querySelector("#per-search").addEventListener("click", () => {
      if (!officers.length) { toast("無可行動武將。"); return; }
      show(search(ui.state, cityId, officers[0].id));
    });
    el.querySelectorAll("[data-recruit]").forEach((b) => b.addEventListener("click", () => {
      if (!officers.length) { toast("無可行動武將。"); return; }
      show(recruitOfficer(ui.state, cityId, b.dataset.recruit, officers[0].id, 200));
    }));
    el.querySelectorAll("[data-gov]").forEach((b) => b.addEventListener("click", () => {
      const res = appointGovernor(ui.state, cityId, b.dataset.gov);
      if (res.ok) { closeModal(); render(); toast("已任命太守。"); } else toast(res.reason);
    }));
  };
  renderModal();
}

function openIntel(cityId) {
  const c = ui.state.cities[cityId];
  const officers = officerOptions(cityId, (o) => o.stats.int > 50);
  if (!officers.length) { toast("城中無智力>50且未行動之武將。"); return; }
  const enemies = Object.values(ui.state.cities).filter((n) => n.active && n.state && n.state !== ui.state.playerState);
  const adjacentEnemies = enemies.filter((n) => c.adjacent.includes(n.id));
  let type = "rumor", officerId = officers.sort((a, b) => b.stats.int - a.stats.int)[0].id, targetCity = (type === "sabotage" ? adjacentEnemies : enemies)[0]?.id ?? "";
  let targetOfficer = "";
  const body = () => {
    const tc = ui.state.cities[targetCity];
    const enemyOfficers = tc ? activeOfficersInCity(ui.state, targetCity).filter((o) => o.state !== ui.state.playerState) : [];
    return `
    <div class="field"><label>計略</label><div class="opt-grid">${Object.entries(STRATAGEMS).map(([k, d]) => `<button class="opt ${k === type ? "sel" : ""}" data-st="${k}"><div class="t">${d.name}</div><div class="d">${d.desc}・${d.gold}金</div></button>`).join("")}</div></div>
    <div class="field"><label>執行武將</label><select id="int-officer">${officers.map((o) => `<option value="${o.id}" ${o.id === officerId ? "selected" : ""}>${esc(o.name)}（智${o.stats.int}）</option>`).join("")}</select></div>
    <div class="field"><label>目標敵城${type === "sabotage" ? "（須相鄰）" : ""}</label><select id="int-city">${(type === "sabotage" ? adjacentEnemies : enemies).map((n) => `<option value="${n.id}" ${n.id === targetCity ? "selected" : ""}>${esc(n.name)}（${stateName(n.state)}）</option>`).join("") || '<option value="">無</option>'}</select></div>
    ${type === "discord" ? `<div class="field"><label>目標敵將</label><select id="int-officer-target">${enemyOfficers.map((o) => `<option value="${o.id}" ${o.id === targetOfficer ? "selected" : ""}>${esc(o.name)}（忠${o.loyalty}）</option>`).join("") || '<option value="">無</option>'}</select></div>` : ""}
    <div id="int-result"></div>`;
  };
  const wire = (el) => {
    el.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", () => { type = b.dataset.st; targetCity = (type === "sabotage" ? adjacentEnemies : enemies)[0]?.id ?? ""; refresh(); }));
    el.querySelector("#int-officer").addEventListener("change", (e) => { officerId = e.target.value; });
    el.querySelector("#int-city").addEventListener("change", (e) => { targetCity = e.target.value; refresh(); });
    el.querySelector("#int-officer-target")?.addEventListener("change", (e) => { targetOfficer = e.target.value; });
    el.querySelector("#int-go").addEventListener("click", () => {
      if (!targetCity) { el.querySelector("#int-result").innerHTML = `<div class="result-msg no">請選目標。</div>`; return; }
      const res = stratagem(ui.state, cityId, officerId, type, targetCity, targetOfficer || null);
      el.querySelector("#int-result").innerHTML = res.ok ? `<div class="result-msg ${res.success ? "ok" : "no"}">${res.success ? "計略成功！" : "計略失敗，為敵所識。"}</div>` : `<div class="result-msg no">${esc(res.reason)}</div>`;
      renderGame();
    });
  };
  const refresh = () => { ui.modal.body = body(); ui.modal.wire = wire; renderModal(); };
  openModal(`計略・${esc(c.name)}`, body(), `<button class="btn" id="modal-cancel">關閉</button><button class="btn btn-primary" id="int-go">施計</button>`);
  ui.modal.wire = (el) => { wire(el); el.querySelector("#modal-cancel").addEventListener("click", closeModal); };
  renderModal();
}

function openDiplomacy() {
  const s = ui.state;
  const officers = officersOf(s, s.playerState).filter((o) => !o.acted && o.wounded <= 0);
  if (!officers.length) { toast("無可行動之武將為使。"); return; }
  const others = Object.values(s.states).filter((x) => x.alive && x.key !== s.playerState);
  let action = "gift", toKey = others[0]?.key, officerId = officers.sort((a, b) => b.stats.cha - a.stats.cha)[0].id, amount = 300, against = others[0]?.key;
  const body = () => `
    <div class="field"><label>外交行動</label><div class="opt-grid">${Object.entries(DIPLOMACY_ACTIONS).map(([k, d]) => `<button class="opt ${k === action ? "sel" : ""}" data-da="${k}"><div class="t">${d.name}</div><div class="d">${d.desc}</div></button>`).join("")}</div></div>
    <div class="field"><label>對象</label><select id="dip-to">${others.map((o) => `<option value="${o.key}" ${o.key === toKey ? "selected" : ""}>${stateName(o.key)}（關係${s.states[s.playerState].relations[o.key]?.value ?? 0}）</option>`).join("")}</select></div>
    <div class="field"><label>使者</label><select id="dip-officer">${officers.map((o) => `<option value="${o.id}" ${o.id === officerId ? "selected" : ""}>${esc(o.name)}（魅${o.stats.cha} 智${o.stats.int}）</option>`).join("")}</select></div>
    ${action === "gift" ? `<div class="field"><label>贈金：<b id="dip-amt-val">${amount}</b></label><input type="range" id="dip-amt" min="100" max="2000" step="100" value="${amount}"></div>` : ""}
    ${action === "coalition" ? `<div class="field"><label>合縱對象（共抗）</label><select id="dip-against">${others.map((o) => `<option value="${o.key}" ${o.key === against ? "selected" : ""}>${stateName(o.key)}</option>`).join("")}</select></div>` : ""}
    <div id="dip-result"></div>`;
  const wire = (el) => {
    el.querySelectorAll("[data-da]").forEach((b) => b.addEventListener("click", () => { action = b.dataset.da; refresh(); }));
    el.querySelector("#dip-to").addEventListener("change", (e) => { toKey = e.target.value; });
    el.querySelector("#dip-officer").addEventListener("change", (e) => { officerId = e.target.value; });
    el.querySelector("#dip-amt")?.addEventListener("input", (e) => { amount = +e.target.value; el.querySelector("#dip-amt-val").textContent = amount; });
    el.querySelector("#dip-against")?.addEventListener("change", (e) => { against = e.target.value; });
    el.querySelector("#dip-go").addEventListener("click", () => {
      const res = diplomacy(ui.state, action, s.playerState, toKey, officerId, { amount, against });
      el.querySelector("#dip-result").innerHTML = res.ok ? `<div class="result-msg ${res.success ? "ok" : "no"}">${res.success ? "成功。" : "不成。"}（詳見事件簿）</div>` : `<div class="result-msg no">${esc(res.reason)}</div>`;
      renderGame();
    });
  };
  const refresh = () => { ui.modal.body = body(); ui.modal.wire = wire; renderModal(); };
  openModal("外交 Diplomacy", body(), `<button class="btn" id="modal-cancel">關閉</button><button class="btn btn-primary" id="dip-go">遣使</button>`, true);
  ui.modal.wire = (el) => { wire(el); el.querySelector("#modal-cancel").addEventListener("click", closeModal); };
  renderModal();
}

function openOfficer(officerId) {
  const o = ui.state.officers[officerId];
  if (!o) return;
  const mine = o.state === ui.state.playerState;
  const city = ui.state.cities[o.location];
  const rels = Object.values(ui.state.officers).filter((x) => x.id !== o.id && x.state === o.state && x.location === o.location).slice(0, 6);
  const body = `
    <div class="kv"><span>所屬</span><span style="color:${stateColor(o.state)}">${o.state ? stateName(o.state) : "在野"}</span></div>
    <div class="kv"><span>駐地</span><span>${esc(city?.name ?? "—")}</span></div>
    <div class="kv"><span>年齡</span><span>${o.birth != null ? o.age + "（生於" + yearLabel(o.birth) + "）" : o.age + "（估算・待考）"}</span></div>
    <div class="kv"><span>忠誠</span><span class="${o.loyalty > 70 ? "loyal-hi" : o.loyalty > 45 ? "loyal-mid" : "loyal-lo"}">${o.loyalty}</span></div>
    <div class="kv"><span>野心</span><span>${o.ambition}</span></div>
    <div class="kv"><span>性格</span><span>${o.personality}</span></div>
    <div class="kv"><span>職位</span><span>${o.position ? POSITIONS[o.position].name : "—"}</span></div>
    <div class="stat-grid" style="margin-top:12px">
      ${statBar("統率", o.stats.lead, 100, "#e05252")}${statBar("武力", o.stats.war, 100, "#f0a060")}${statBar("智力", o.stats.int, 100, "#8ab4f0")}${statBar("政治", o.stats.pol, 100, "#a0d080")}${statBar("魅力", o.stats.cha, 100, "#c090f0")}
    </div>
    <div style="margin-top:10px">${o.traits.map((t) => `<span class="trait-tag" title="${esc(TRAITS[t]?.desc ?? "")}">${t}</span>`).join("") || '<span class="hint">無特技</span>'}</div>
    <div class="hint" style="margin-top:10px;line-height:1.8">${esc(o.bio)}</div>
    ${mine && o.status === "active" ? `<div class="cmd-row" style="margin-top:12px">
      <button class="btn btn-sm" id="off-reward">褒賞（300金・忠+10）</button>
      <button class="btn btn-sm" id="off-transfer">移動</button>
      <button class="btn btn-sm" id="off-general">任將軍</button>
      <button class="btn btn-sm" id="off-advisor">任謀士</button>
    </div>` : ""}
    <div id="off-result"></div>`;
  openModal(`${esc(o.name)}${o.status === "captured" ? "（被俘）" : o.status === "free" ? "（在野）" : ""}`, body, `<button class="btn" id="modal-cancel">關閉</button>`);
  ui.modal.wire = (el) => {
    el.querySelector("#modal-cancel").addEventListener("click", closeModal);
    el.querySelector("#off-reward")?.addEventListener("click", () => {
      const res = reward(ui.state, officerId, 300);
      el.querySelector("#off-result").innerHTML = res.ok ? `<div class="result-msg ok">忠誠+${res.gain}。</div>` : `<div class="result-msg no">${esc(res.reason)}</div>`;
      renderGame();
    });
    el.querySelector("#off-transfer")?.addEventListener("click", () => { closeModal(); openTransfer(officerId); });
    el.querySelector("#off-general")?.addEventListener("click", () => { assignPosition(ui.state, officerId, "general"); closeModal(); render(); });
    el.querySelector("#off-advisor")?.addEventListener("click", () => { assignPosition(ui.state, officerId, "advisor"); closeModal(); render(); });
  };
  renderModal();
}

function openTransfer(officerId) {
  const o = ui.state.officers[officerId];
  const from = ui.state.cities[o.location];
  const targets = from.adjacent.map((id) => ui.state.cities[id]).filter((n) => n?.active && n.state === o.state);
  if (!targets.length) { toast("無相鄰己方城市可移動。"); return; }
  const body = `<div class="field"><label>移駐至</label><select id="tf-target">${targets.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join("")}</select></div>`;
  openModal(`移動・${esc(o.name)}`, body, `<button class="btn" id="modal-cancel">關閉</button><button class="btn btn-primary" id="tf-go">移動</button>`);
  ui.modal.wire = (el) => {
    el.querySelector("#modal-cancel").addEventListener("click", closeModal);
    el.querySelector("#tf-go").addEventListener("click", () => {
      const res = transferOfficer(ui.state, officerId, el.querySelector("#tf-target").value);
      if (res.ok) { closeModal(); render(); toast("已移動。"); } else toast(res.reason);
    });
  };
  renderModal();
}

// ---- Save / Load ----
function openSaveLoad(mode) {
  const list = saves.list();
  const body = `<div class="hint" style="margin-bottom:12px">${mode === "save" ? "選擇存檔位（保存完整 Game State 於本瀏覽器 localStorage）。" : "選擇存檔讀取。"}</div>
    ${list.map((s) => `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div><b>${{ slot1: "存檔一", slot2: "存檔二", slot3: "存檔三", auto: "自動存檔" }[s.slot]}</b><div class="hint">${s.meta ? esc(s.meta.name) + "・第" + s.meta.turn + "回合・" + yearLabel(s.meta.year) + MONTH_LABELS[s.meta.month - 1] : "空"}</div></div>
      <div class="cmd-row" style="margin:0">
        ${mode === "save" && s.slot !== "auto" ? `<button class="btn btn-sm btn-primary" data-save="${s.slot}">保存</button>` : ""}
        ${s.exists ? `<button class="btn btn-sm" data-load="${s.slot}">讀取</button><button class="btn btn-sm btn-danger" data-del="${s.slot}">刪</button>` : ""}
      </div>
    </div>`).join("")}
    <div class="cmd-row"><button class="btn btn-sm" id="sl-export">匯出 JSON</button><button class="btn btn-sm" id="sl-import">匯入 JSON</button><input type="file" id="sl-file" accept="application/json" style="display:none"></div>`;
  openModal(mode === "save" ? "保存 Save" : "讀取 Load", body, `<button class="btn" id="modal-cancel">關閉</button>`);
  ui.modal.wire = (el) => {
    el.querySelector("#modal-cancel").addEventListener("click", closeModal);
    el.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", () => { saves.save(b.dataset.save, ui.state); closeModal(); render(); toast("已保存。"); }));
    el.querySelectorAll("[data-load]").forEach((b) => b.addEventListener("click", () => {
      try { ui.state = saves.load(b.dataset.load); ui.playerState = ui.state.playerState; ui.screen = "game"; ui.selectedCity = citiesOf(ui.state, ui.playerState)[0]?.id; closeModal(); render(); toast("已讀取。"); }
      catch (e) { toast(e.message); }
    }));
    el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { saves.delete(b.dataset.del); openSaveLoad(mode); }));
    el.querySelector("#sl-export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(ui.state, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `warring-states-${ui.state.scenarioId}-t${ui.state.turn}.json`; a.click(); URL.revokeObjectURL(a.href);
    });
    el.querySelector("#sl-import").addEventListener("click", () => el.querySelector("#sl-file").click());
    el.querySelector("#sl-file").addEventListener("change", (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { try { const { deserialize } = saveRef; ui.state = deserialize(reader.result); ui.playerState = ui.state.playerState; ui.screen = "game"; closeModal(); render(); toast("已匯入。"); } catch (err) { toast(err.message); } };
      reader.readAsText(file);
    });
  };
  renderModal();
}

function openHelp() {
  const body = `
    <div class="hint" style="line-height:2">
      <b style="color:var(--bronze2)">遊戲目標</b>：統一天下（佔領所有城市）。失去所有城市則敗亡。<br>
      <b style="color:var(--bronze2)">回合</b>：每回合＝一月。你行動後按「結束回合」，AI 諸侯行動、事件觸發、收支結算，然後行軍抵達／戰鬥。<br>
      <b style="color:var(--bronze2)">內政</b>：每將每回合行動一次。開墾／商業／城防／治安／訓練／徵兵／賑濟，真正影響 Game State。<b>徵兵上限＝人口×20%</b>（只限新增徵兵；駐兵可高於此，如歷史常備軍、增援、俘虜併入）。<br>
      <b style="color:var(--bronze2)">兵種</b>：步兵／騎兵／弩兵／車兵／水軍／銳士，各有攻擊力、防備力、成本與地形加成。徵兵時選兵種；戰鬥傷害按全軍兵種組成加權計算（騎兵平原強、弩兵守關強、車兵春秋平原強、水軍水鄉強）。<b>特殊兵種（只限該國徵募）</b>：周「近」評9（近衛）、秦「胡」評6（胡騎）／「射」評7（射士）、趙「胡」評6、韓魏齊「戈」評5（戈戟）、楚「卒」評6（楚卒）。<br>
      <b style="color:var(--bronze2)">軍事／戰鬥</b>：出陣攻相鄰敵城，行軍一回合抵達後進入<b>hex 戰棋戰場</b>（三國志式戰棋、原创 UI）：部隊按兵種分成棋子，點己子→點綠格移動／點紅圈攻擊；弩兵射程2；ZOC 貼敵只能移1格；地形格（平原／山地／關隘／水／林）影響移動與攻防；城壘（城防）破後攻軍入城即克城。士氣、補給、單挑、天氣入計算——計算結果＋可控隨機，非純隨機。亦可「快速結算」自動打完。AI 對 AI 自動結算。<br>
      <b style="color:var(--bronze2)">外交</b>：贈禮／同盟／互不侵犯／通商／威脅／說服／合縱／破盟／求援／勸降。受國力、軍力、關係、武將能力、性格影響。<br>
      <b style="color:var(--bronze2)">計略</b>：流言／破壞／離間，智力較量。<br>
      <b style="color:var(--bronze2)">存檔</b>：3 手動存檔位＋自動存檔，可匯出／匯入 JSON。<br><br>
      <b style="color:var(--bronze2)">史料分級 Provenance</b>：<br>
      ・<b>史實</b>：據《左傳》《史記》《戰國策》及楊寬《戰國史》、童書業《春秋史》框架。<br>
      ・<b>演義</b>：取材《東周列國志》（馮夢龍／蔡元放）——小說演義，非史實，已標記。<br>
      ・<b>待考</b>：Historical verification required——不確定之年代／歸屬／名諱，標記而非虛構。<br>
      武將能力值為<b>遊戲設計估值</b>，非歷史數據。地圖為<b>原創古風地理底圖</b>：海岸、渤海／黃海／東海、河水／江水／淮水／濟水／渭水／汾水／漢水、雲夢澤／洞庭／彭蠡澤／具區、太行／秦嶺／泰山／華山／巫山／燕山；城市坐標對照真實地理位置（經緯投影）， state 疆界為近似。生年不詳者年齡為估算。<br><br>
      <b style="color:var(--bronze2)">劇本</b>：前506柏舉之戰（春秋）、前350商鞅變法、前318合縱連橫、前284樂毅破齊／田單復齊、前260長平之戰、前238秦王親政。涵蓋孫臏、龐涓、商鞅、蘇秦、張儀、樂毅、田單、白起、廉頗、李牧、王翦、秦始皇等。
    </div>`;
  openModal("說明 Help", body, `<button class="btn btn-primary" id="modal-cancel">明白</button>`, true);
  ui.modal.wire = (el) => el.querySelector("#modal-cancel").addEventListener("click", closeModal);
  renderModal();
}

// ---- Hex war-chess battle modal (戰棋) ----
const TYPE_GLYPH = { infantry: "步", cavalry: "騎", crossbow: "弩", chariot: "車", navy: "水", elite: "銳", guard: "近", hu: "胡", archer: "射", ge: "戈", chu: "卒" };
const HEX_FILL = { plain: "#1c2620", mountain: "#2a2a22", pass: "#33291d", river: "#173039", forest: "#1b2a1b" };

function hexPoints(cx, cy, s) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i + 30);
    pts.push(`${(cx + s * Math.cos(a)).toFixed(1)},${(cy + s * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

function renderHexModal() {
  document.querySelector(".modal-backdrop")?.remove();
  const hb = ui.hex, b = hb.battle, s = ui.state;
  const city = s.cities[b.cityId];
  const playerSide = hb.playerSide;
  const el = document.createElement("div");
  el.className = "modal-backdrop";
  const W = HEX_SIZE * Math.sqrt(3) * (HEX_COLS + 1) + 20, H = HEX_SIZE * 1.5 * (HEX_ROWS - 1) + HEX_SIZE * 2 + 20;
  let hexes = "";
  for (let r = 0; r < HEX_ROWS; r++) for (let c = 0; c < HEX_COLS; c++) {
    const { x, y } = hexPixel(c, r);
    const t = hb.grid[r][c];
    const reach = hb.reachable.some(([rc, rr]) => rc === c && rr === r);
    const isFort = c === hb.fort.c && r === hb.fort.r;
    hexes += `<polygon points="${hexPoints(x, y, HEX_SIZE * 0.96)}" fill="${HEX_FILL[t]}" stroke="${reach ? "#2dd4bf" : "#2c3a33"}" stroke-width="${reach ? 2 : 1}" ${reach ? 'stroke-dasharray="4,3"' : ""} data-hex="${c},${r}" class="hex-cell"/>`;
    if (isFort) hexes += `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="15" fill="#e6c65a" pointer-events="none">⛫</text><text x="${x}" y="${y + 16}" text-anchor="middle" font-size="8" fill="#e6c65a" pointer-events="none">防${hb.fort.defense}</text>`;
  }
  let tokens = "";
  for (const u of hb.units) {
    if (u.troops <= 0) continue;
    const { x, y } = hexPixel(u.c, u.r);
    const color = u.side === "att" ? stateColor(b.attackerState) : stateColor(b.defenderState);
    const sel = hb.selected === u;
    const isTarget = hb.targets.some((t) => !t.fort && t.id === u.id);
    const mine = u.side === playerSide && !u.acted && !hb.concluded;
    tokens += `<g class="hex-unit" data-unit="${u.id}" style="cursor:${mine ? "pointer" : "default"}">
      ${sel ? `<circle cx="${x}" cy="${y}" r="16" fill="none" stroke="#e6c65a" stroke-width="2.5"/>` : ""}
      ${isTarget ? `<circle cx="${x}" cy="${y}" r="16" fill="none" stroke="#e05252" stroke-width="2.5" stroke-dasharray="3,2"/>` : ""}
      <circle cx="${x}" cy="${y}" r="12" fill="${color}" stroke="#0c1210" stroke-width="2" opacity="${u.acted ? 0.55 : 1}"/>
      <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" fill="#0c1210" font-weight="700" pointer-events="none">${TYPE_GLYPH[u.type] ?? "兵"}</text>
      <text x="${x}" y="${y - 15}" text-anchor="middle" font-size="8.5" fill="${color}" pointer-events="none">${u.isCmd ? "★" : ""}${Math.round(u.troops / 1000)}k</text>
      <text x="${x}" y="${y + 22}" text-anchor="middle" font-size="7.5" fill="#9aa79c" pointer-events="none">士${u.morale}</text>
    </g>`;
  }
  const fortTarget = hb.targets.some((t) => t.fort);
  const att = hb.units.filter((u) => u.side === "att").reduce((a, u) => a + u.troops, 0);
  const def = hb.units.filter((u) => u.side === "def").reduce((a, u) => a + u.troops, 0);
  el.innerHTML = `<div class="modal wide">
    <div class="modal-head"><h3>戰棋・${esc(city.name)} <span class="weather-tag">${b.weather.name}・第${hb.round}回合・${hb.concluded ? "戰畢" : "你的回合"}</span></h3></div>
    <div class="modal-body">
      <div class="cmd-row" style="margin:0 0 8px">
        <span class="pill" style="color:${stateColor(b.attackerState)}">攻 ${fmt(att)}</span>
        <span class="pill" style="color:${stateColor(b.defenderState)}">守 ${fmt(def)}</span>
        <span class="pill" style="color:#e6c65a">城防 ${hb.fort.defense}</span>
        <span class="pill">糧 ${fmt(b.army.food)}</span>
        <span class="hint">點己方棋子→點綠格移動／點紅圈攻擊。弩兵射程2。ZOC：貼敵只能移1格。破城防後攻軍可入城壘。</span>
      </div>
      <svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" style="width:100%;background:#0c1210;border:1px solid var(--line);border-radius:10px">${hexes}${tokens}${fortTarget ? `<circle cx="${hexPixel(hb.fort.c, hb.fort.r).x}" cy="${hexPixel(hb.fort.c, hb.fort.r).y}" r="17" fill="none" stroke="#e05252" stroke-width="2.5" stroke-dasharray="3,2" data-hex="${hb.fort.c},${hb.fort.r}" class="hex-cell"/>` : ""}</svg>
      <div class="tactic-row">
        ${hb.concluded ? `<button class="btn btn-primary" id="hex-done">繼續 ▶</button>` : `<button class="btn btn-primary" id="hex-end">結束回合 ▶</button><button class="btn btn-danger" id="hex-retreat">撤退</button><button class="btn" id="hex-auto">快速結算</button>`}
      </div>
      ${hb.concluded ? `<div class="result-msg ${hb.result === "attacker" ? (playerSide === "att" ? "ok" : "no") : (playerSide === "att" ? "no" : "ok")}">戰畢：${hb.result === "attacker" ? city.name + "陷落" : hb.result === "defender" ? "攻軍潰敗" : "攻軍撤退"}。</div>` : ""}
      <div class="battle-log" id="hex-log">${hb.log.slice(-40).map((l) => `<div>${esc(l)}</div>`).join("")}</div>
    </div>
  </div>`;
  document.body.appendChild(el);
  const logEl = el.querySelector("#hex-log"); logEl.scrollTop = logEl.scrollHeight;
  const after = () => {
    if (hb.concluded && !b.finalized) { finalizeBattle(s, b); checkBattleEvents(s, b); beep(180, 0.25, "triangle"); }
    renderHexModal();
  };
  el.querySelectorAll(".hex-unit").forEach((g) => g.addEventListener("click", () => {
    const u = hb.units.find((x) => x.id === g.dataset.unit);
    if (!u || hb.concluded) return;
    if (u.side === playerSide && !u.acted) {
      hb.selected = u; hb.reachable = hexReachable(s, hb, u); hb.targets = hexAttackTargets(s, hb, u);
      renderHexModal(); return;
    }
    if (hb.selected && hb.targets.some((t) => !t.fort && t.id === u.id)) { hexAttack(s, hb, hb.selected, u); beep(200, 0.1, "sawtooth"); hb.selected = null; hb.reachable = []; hb.targets = []; after(); }
  }));
  el.querySelectorAll(".hex-cell").forEach((p) => p.addEventListener("click", () => {
    if (hb.concluded || !hb.selected) return;
    const [c, r] = p.dataset.hex.split(",").map(Number);
    if (hb.targets.some((t) => t.fort && t.c === c && t.r === r)) { hexAttack(s, hb, hb.selected, { fort: true, c, r }); beep(160, 0.12, "sawtooth"); hb.selected = null; hb.reachable = []; hb.targets = []; after(); return; }
    if (hb.reachable.some(([rc, rr]) => rc === c && rr === r)) { hexMove(s, hb, hb.selected, c, r); hb.selected = null; hb.reachable = []; hb.targets = []; after(); }
  }));
  el.querySelector("#hex-end")?.addEventListener("click", () => { hexEndPlayerPhase(s, hb); after(); });
  el.querySelector("#hex-retreat")?.addEventListener("click", () => { hb.retreat = true; checkConclusion(s, hb); after(); });
  el.querySelector("#hex-auto")?.addEventListener("click", () => { const rb = autoResolveBattle(s, b.army); b.concluded = true; b.result = rb.result; b.finalized = true; ui.hex = null; renderBattleModal(); });
  el.querySelector("#hex-done")?.addEventListener("click", () => { ui.hex = null; ui.battle = null; advancePendingBattles(); });
}

// ---- Battle modal ----
function renderBattleModal() {
  document.querySelector(".modal-backdrop")?.remove();
  if (ui.hex) { renderHexModal(); return; }
  const b = ui.battle;
  const s = ui.state;
  const city = s.cities[b.cityId];
  const army = b.army;
  const aCmd = b.attackerCommander, dCmd = b.defenderCommander;
  const playerAttacker = b.playerAttacker;
  const el = document.createElement("div");
  el.className = "modal-backdrop";
  const tacticButtons = b.concluded ? "" : (playerAttacker
    ? Object.entries(ATTACK_TACTICS).map(([k, t]) => `<button class="btn btn-sm" data-tactic="${k}" title="${t.desc}">${t.name}</button>`).join("")
    : Object.entries(DEFEND_TACTICS).map(([k, t]) => `<button class="btn btn-sm" data-tactic="${k}" title="${t.desc}">${t.name}</button>`).join(""));
  el.innerHTML = `<div class="modal wide">
    <div class="modal-head"><h3>戰・${esc(city.name)} <span class="weather-tag">${b.weather.name}・${TERRAIN_LABELS[city.terrain]}・第${b.round}回合</span></h3></div>
    <div class="modal-body">
      <div class="battle-field">
        <div class="army-card" style="border-color:${stateColor(b.attackerState)}66">
          <h4 style="color:${stateColor(b.attackerState)}">攻・${stateName(b.attackerState)}</h4>
          <div class="hint">主帥 ${esc(aCmd?.name ?? "—")}（統${aCmd?.stats.lead ?? "?"}）</div>
          <div class="hint" style="color:${stateColor(b.attackerState)}">兵種 ${compSummary(army.comp)}・攻×${compAttack(army.comp).toFixed(2)}</div>
          ${statBar("兵力", army.troops, Math.max(army.troops, 1), "#e05252")}
          ${statBar("士氣", army.morale, 100, "#c090f0")}
          ${statBar("糧草", army.food, Math.max(army.food, 1), "#a0d080")}
        </div>
        <div class="vs">⚔</div>
        <div class="army-card" style="border-color:${stateColor(b.defenderState)}66">
          <h4 style="color:${stateColor(b.defenderState)}">守・${stateName(b.defenderState)}</h4>
          <div class="hint">守將 ${esc(dCmd?.name ?? "—")}（統${dCmd?.stats.lead ?? "?"}）${b.wallBreached ? "・城牆已破" : ""}</div>
          <div class="hint" style="color:${stateColor(b.defenderState)}">兵種 ${compSummary(city.comp)}・防×${compDefense(city.comp).toFixed(2)}</div>
          ${statBar("兵力", city.troops, Math.max(city.troops, 1), "#8ab4f0")}
          ${statBar("士氣", city.morale, 100, "#c090f0")}
          ${statBar("城防", city.defense, 100, "#e6c65a")}
        </div>
      </div>
      <div class="tactic-row">${tacticButtons}</div>
      ${b.concluded ? `<div class="result-msg ${b.result === "attacker" ? (playerAttacker ? "ok" : "no") : (playerAttacker ? "no" : "ok")}">戰畢：${b.result === "attacker" ? city.name + "陷落" : b.result === "defender" ? "攻軍潰敗" : "攻軍撤退"}。</div><div class="cmd-row"><button class="btn btn-primary" id="battle-done">繼續 ▶</button></div>` : `<div class="hint">選擇戰術。${playerAttacker ? "你是攻方。" : "你是守方，選擇守城戰術。"}</div>`}
      <div class="battle-log" id="battle-log">${b.log.map((l) => `<div>${esc(l)}</div>`).join("")}</div>
    </div>
  </div>`;
  document.body.appendChild(el);
  const logEl = el.querySelector("#battle-log"); logEl.scrollTop = logEl.scrollHeight;
  el.querySelectorAll("[data-tactic]").forEach((btn) => btn.addEventListener("click", () => {
    const tactic = btn.dataset.tactic;
    if (playerAttacker) {
      battleRound(s, b, tactic);
    } else {
      b.defenderTactic = tactic;
      battleRound(s, b, autoTactic(s, b, "attacker"));
      b.defenderTactic = null;
    }
    if (b.concluded) { finalizeBattle(s, b); checkBattleEvents(s, b); }
    renderBattleModal();
  }));
  el.querySelector("#battle-done")?.addEventListener("click", () => {
    ui.battle = null; ui.hex = null;
    advancePendingBattles();
  });
}

function advancePendingBattles() {
  const s = ui.state;
  if (s.pendingBattles.length) {
    ui.battle = s.pendingBattles.shift();
    ui.hex = createHexBattle(s, ui.battle);
    renderBattleModal();
    return;
  }
  startPlayerPhase(s);
  saves.autosave(s);
  if (s.outcome) { ui.screen = "outcome"; render(); return; }
  render();
  showTurnReport();
}

function doEndTurn() {
  const s = ui.state;
  beep(440, 0.1);
  const before = { gold: stateTotals(s, s.playerState).gold, food: stateTotals(s, s.playerState).food };
  const report = endTurn(s);
  ui.lastReport = { ...report, before };
  if (s.pendingBattles.length) {
    ui.battle = s.pendingBattles.shift();
    ui.hex = createHexBattle(s, ui.battle);
    renderBattleModal();
  } else {
    startPlayerPhase(s);
    saves.autosave(s);
    if (s.outcome) { ui.screen = "outcome"; render(); return; }
    render();
    showTurnReport();
  }
}

function showTurnReport() {
  const r = ui.lastReport;
  if (!r) return;
  const s = ui.state;
  const after = stateTotals(s, s.playerState);
  const events = r.events ?? [];
  const ai = r.aiActions ?? [];
  const body = `
    <div class="stat-grid">
      ${statBar("金", after.gold, Math.max(after.gold, 1), "#e6c65a")}
      ${statBar("糧", after.food, Math.max(after.food, 1), "#a0d080")}
      ${statBar("兵", after.troops, Math.max(after.troops, 1), "#e05252")}
      ${statBar("城", after.cities, 40, "#8ab4f0")}
    </div>
    ${events.length ? `<div class="card" style="margin-top:12px"><h4>事件 Events</h4><div class="log-feed">${events.map((e) => `<div class="log-item event"><span class="prov">[${e.provenance}]</span><b>${esc(e.title)}</b>：${esc(e.text)}</div>`).join("")}</div></div>` : ""}
    ${ai.length ? `<div class="card"><h4>諸侯動向 AI（${ai.length}）</h4><div class="hint" style="line-height:1.9">${ai.slice(0, 24).map((a) => "・" + esc(a)).join("<br>")}${ai.length > 24 ? "<br>…" : ""}</div></div>` : ""}
    <div class="hint">第${s.turn}回合・${yearLabel(s.year)}${MONTH_LABELS[s.month - 1]}。武將行動已重置。</div>`;
  openModal("回合報告 Turn Report", body, `<button class="btn btn-primary" id="modal-cancel">繼續 ▶</button>`, true);
  ui.modal.wire = (el) => el.querySelector("#modal-cancel").addEventListener("click", closeModal);
  renderModal();
}

function renderOutcome() {
  const s = ui.state;
  const win = s.outcome?.result === "victory";
  const totals = stateTotals(s, s.playerState);
  app.innerHTML = `<div class="outcome-screen ${win ? "victory" : "defeat"}">
    <div>
      <h1>${win ? "一統天下" : "社稷傾覆"}</h1>
      <p>${esc(s.outcome?.text ?? "")}</p>
      <p>${stateName(s.playerState)}・${esc(SCENARIO_BY_ID[s.scenarioId].name)}・第${s.turn}回合・${yearLabel(s.year)}。存城${totals.cities}，兵${fmt(totals.troops)}。</p>
      <div class="cmd-row" style="justify-content:center"><button class="btn btn-primary" id="oc-new">再玩一局</button><button class="btn" id="oc-title">主選單</button></div>
    </div>
  </div>`;
  app.querySelector("#oc-new").addEventListener("click", () => { ui.screen = "title"; render(); });
  app.querySelector("#oc-title").addEventListener("click", () => { ui.screen = "title"; render(); });
}

// Late-bound refs to avoid circular static imports for rarely used functions.
import * as engineRef from "./ws-engine.mjs";
import * as saveRef from "./ws-save.mjs";

render();
