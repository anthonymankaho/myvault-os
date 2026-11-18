# 春秋戰國 · Warring States — MyVault OS Grand Strategy

An original, self-contained, turn-based historical grand-strategy game for the
MyVault OS HTML platform. It studies the *strategy philosophy* of classic
historical simulators (KOEI Romance of the Three Kingdoms VI) — officer/city
management, domestic affairs, diplomacy, calculated battle, score-based AI —
and re-implements it as an original engine. **No copyrighted code, art, music,
portraits, maps, UI, text or data tables from any commercial game are used.**

- Era: Eastern Zhou → Spring & Autumn → Warring States (five scenarios, 506–238 BC).
- Platform: browser HTML5/CSS/JS ES-modules, desktop-first, zero external dependencies.
- Opens inside the MyVault OS **Games** view (embedded iframe) or standalone.

## Run / preview

The game uses ES modules, so serve the repo over HTTP (modules do not load from `file://`):

```
cd myvault-os
npx serve .            # or: python -m http.server 8000
# hub:      http://localhost:8000/#games  → "Start a campaign"
# standalone: http://localhost:8000/games/warring-states.html
```

Live (after deploy): `https://anthonymankaho.github.io/myvault-os/games/warring-states.html`.

## Architecture (data → state → logic → UI)

Game State is the single source of truth; the UI only renders it and calls engine actions.

| Module | Role |
|---|---|
| `ws-data.mjs` | States, 40 cities (schematic map + adjacency), ~150 officers, traits, personalities, **troop types**, terrain effects |
| `ws-scenarios.mjs` | 5 scenarios (ownership/placements/relations), scripted + random **event library** (provenance-tagged) |
| `ws-util.mjs` | Seeded RNG (mulberry32), clamp/round/jitter, calendar helpers |
| `ws-engine.mjs` | State creation, turn flow, economy, domestic, personnel, armies/logistics, intelligence, troop composition, victory |
| `ws-battle.mjs` | Turn-based tactical battle: tactics, terrain, supply, morale, wall, weather, duels; calculated outcome + controlled randomness |
| `ws-ai.mjs` | Score-based AI: candidate → evaluate → score → strategic modifier → risk → execute |
| `ws-diplomacy.mjs` | gift/alliance/nap/trade/threaten/persuade/coalition/break/aid/surrender |
| `ws-events.mjs` | Scripted historical chains + random events; effect interpreter |
| `ws-save.mjs` | Full-state serialize/validate/deserialize; 3 slots + autosave; export/import JSON |
| `ws-ui.mjs` + `warring-states.html` | SVG strategic map, panels, dialogs, battle screen, save/load, help |

## Core rules

- **Turn = one month.** Player commands → End Turn → AI states act → events → upkeep (income/consumption/growth/loyalty/aging) → marches arrive → battles → next player phase.
- **Domestic** (each consumes one officer action/turn): 開墾/商業/城防/治安/訓練/徵兵/賑濟. Gains scale with 政治/統率/武力/魅力 and traits (屯田×1.5, 築城×1.5, 商才×1.5, 兵家×1.5, 法家+15%).
- **Troop cap = RECRUITMENT limit, not garrison limit.** `troopCap = population × 20%`. New recruitment can never push troops above it (the math accounts for population shrinking as you recruit). Existing garrison — historical standing armies, reinforcements, captured troops merged in — **may exceed** 20%; it is never force-disbanded.
- **Troop types (兵種)** with attack/defense/cost/terrain: 步兵 1.0/1.0, 騎兵 1.3/0.8 (plain↑), 弩兵 1.15/1.15 (pass↑), 車兵 1.25/0.9 (Spring-Autumn plain↑), 水軍 1.0/1.05 (river↑), 銳士 1.35/1.25 (elite, costly). Composition is conserved through recruitment, marches, merges and battle losses; battle damage is weighted by each side's composition and terrain.
- **Battle** is calculated, not pure RNG: troop size × commander leadership × morale × training × tactic × terrain × supply × wall × weather × troop-type × ±15% jitter. Tactics: 強攻/突擊/計略/火攻/堅守/撤退 (attacker), 堅守/出擊/計略/突擊 (defender). Duels, wall breach, starvation and routs modelled.
- **Victory**: own every active city (unification). **Defeat**: lose all cities.

## Historical sources & provenance

Every event and uncertain datum is tagged:

- **史實** — verified against 《左傳》《史記》《戰國策》; framework from 楊寬《戰國史》 and 童書業《春秋史》.
- **演義** — dramatized material from 《東周列國志》 (馮夢龍/蔡元放). It is a *novel*: such events are labelled literary, never presented as fact.
- **待考** — "Historical verification required": contested dates/attributions/names are flagged, not invented.

Scenarios: 前506 柏舉之戰 (春秋, 《左傳》), 前350 商鞅變法, 前318 合縱連橫 (蘇秦/張儀), 前260 長平之戰, 前238 秦王親政 (秦始皇/王翦/李牧). Covers 孫臏、龐涓、商鞅、蘇秦、張儀、樂毅、白起、廉頗、李牧、王翦、秦始皇 etc.

**Disclaimers:** officer ability scores are *game-design estimates*, not historical data; the map is a *schematic strategic map*, not precise historical borders; officers with unknown birth years use estimated ages (flagged 待考); minor-state rosters are sparse where records are sparse.

## Testing

```
node --test test/*.test.*        # 117 tests: 82 existing + 35 game (data/engine/battle/save/troops)
node C:\Users\User\playwright-verify\myvault_warring_states_verify.js   # standalone game, 23 checks
node C:\Users\User\playwright-verify\myvault_ws_hub_verify.js           # hub Games-view integration
```

Game tests cover: adjacency symmetry, ID uniqueness, scenario/officer era validity, event provenance, develop/recruit formulas, the 20% recruitment cap, march/merge, battle determinism + capture, troop-type attack/defense/terrain + composition conservation, 60-turn stability, save round-trip + validation.

## Hub integration

- `app.js renderGames()` adds a second cover + `#ws-play-area` iframe; `setWarringStatesFullscreen` + `myvault-warring-states` postMessage fullscreen.
- Constellation node `games:warring-states`.
- Cache busters bumped `study-1 → ws-1` (index.html app.js/styles.css); game shell loads `ws-ui.mjs?v=ws-1`.
- `styles.css` `.ws-art/.ws-seal/.ws-rivers` cover art.

## Roadmap / known limits (Phase 6 polish)

- Sound hooks, richer animations, tooltips, difficulty balance pass.
- More scripted event chains (e.g. 284 BC 樂毅破齊 scenario), vassal/tribute upkeep, field battles between marching armies.
- Some minor-state rulers and a few city attributions remain 待考 (flagged in data `note` fields).
