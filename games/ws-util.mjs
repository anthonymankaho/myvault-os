// Shared pure helpers for the Warring States engine. No DOM, no storage —
// unit-testable in plain Node.

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// Deterministic PRNG (mulberry32). The state stores the raw seed cursor so a
// save/load replays the exact same random sequence.
export function nextRandom(state) {
  state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
  let t = state.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomInt(state, min, max) {
  return min + Math.floor(nextRandom(state) * (max - min + 1));
}

export function pick(state, list) {
  if (!list.length) return null;
  return list[Math.floor(nextRandom(state) * list.length)];
}

export function chance(state, probability) {
  return nextRandom(state) < probability;
}

// Controlled randomness: a roll in [1-spread, 1+spread].
export function jitter(state, spread = 0.15) {
  return 1 - spread + nextRandom(state) * spread * 2;
}

export function weightedPick(state, entries) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return null;
  let roll = nextRandom(state) * total;
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight);
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1];
}

export function uid(state, prefix) {
  state.idCounter = (state.idCounter ?? 0) + 1;
  return `${prefix}${state.idCounter}`;
}

export function sum(list, fn) {
  return list.reduce((total, item) => total + fn(item), 0);
}

export function formatNumber(value) {
  return Math.round(value).toLocaleString("en-US");
}

export function yearLabel(year) {
  return year < 0 ? `公元前${-year}年` : `公元${year}年`;
}

export const MONTH_LABELS = ["正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];

export const SEASON_OF_MONTH = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3];
export const SEASON_LABELS = ["春", "夏", "秋", "冬"];
