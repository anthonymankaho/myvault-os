export const TRACK_KEY = "myvault_neon_apex_track";
export const ROAD_HALF = 9.6;
export const TAU = Math.PI * 2;

const harbour = {
  center: (t) => [136 * Math.cos(t), 60 * Math.sin(t) * (1 + 0.4 * Math.cos(2 * t)) + 14 * Math.sin(2 * t)],
};
const ridge = {
  center: (t) => [118 * Math.cos(t) - 10 * Math.cos(3 * t), 80 * Math.sin(t) + 22 * Math.sin(2 * t)],
};

export const TRACK_DEFS = [
  {
    id: "night",
    name: "Night Circuit",
    place: "Hong Kong",
    eyebrow: "NIGHT CIRCUIT · HONG KONG",
    title: "Own the<br />apex.",
    lede: "Three laps from the back of the grid. Draft the car ahead, then pull out, and save boost for the long straight.",
    bestKey: "myvault_neon_apex_best",
    uniform: true,
    center: (t) => [104 * Math.cos(t), 72 * Math.sin(t)],
    deriv: (t) => [-104 * Math.sin(t), 72 * Math.cos(t)],
  },
  {
    id: "harbour",
    name: "Harbour Lights",
    place: "Victoria Harbour",
    eyebrow: "HARBOUR LIGHTS · VICTORIA HARBOUR",
    title: "Thread the<br />skyline.",
    lede: "Two long waterfront straights joined by tight hairpins. Draft into the hairpins, brake late, and boost on the way out.",
    bestKey: "myvault_neon_apex_best_harbour",
    center: harbour.center,
  },
  {
    id: "ridge",
    name: "Dusk Ridge",
    place: "Lantau",
    eyebrow: "DUSK RIDGE · LANTAU",
    title: "Chase the<br />sunset.",
    lede: "A rolling canyon from the back of the grid. Carry speed through the sweepers, draft the car ahead, and save nitro for the exits.",
    bestKey: "myvault_neon_apex_best_ridge",
    center: ridge.center,
  },
];

const SAMPLES = 2048;

function numericDeriv(center) {
  const h = 1e-4;
  return (t) => {
    const a = center(t - h), b = center(t + h);
    return [(b[0] - a[0]) / (2 * h), (b[1] - a[1]) / (2 * h)];
  };
}

function lengthTable(center) {
  const cumulative = new Float64Array(SAMPLES + 1);
  let prev = center(0), total = 0;
  for (let i = 1; i <= SAMPLES; i++) {
    const p = center((i / SAMPLES) * TAU);
    total += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    cumulative[i] = total;
    prev = p;
  }
  return { cumulative, total };
}

export function createTrack(def, referenceLength) {
  const deriv = def.deriv || numericDeriv(def.center);
  const { cumulative, total } = lengthTable(def.center);
  // Uniform tracks keep their original parameter so the first circuit drives exactly as before.
  function warp(a) {
    if (def.uniform) return a;
    const frac = ((a % TAU) + TAU) % TAU / TAU;
    const target = frac * total;
    let lo = 0, hi = SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] <= target) lo = mid; else hi = mid;
    }
    const span = cumulative[hi] - cumulative[lo] || 1;
    return ((lo + (target - cumulative[lo]) / span) / SAMPLES) * TAU;
  }
  function point(a, offset = 0) {
    const t = warp(a);
    const [cx, cz] = def.center(t);
    const [tx, tz] = deriv(t);
    const len = Math.hypot(tx, tz) || 1;
    return [cx + (tz / len) * offset, cz + (-tx / len) * offset];
  }
  const outline = [];
  for (let i = 0; i < 240; i++) outline.push(point((i / 240) * TAU));
  function distanceToCenterline(x, z) {
    let best = Infinity;
    for (const [px, pz] of outline) best = Math.min(best, Math.hypot(px - x, pz - z));
    return best;
  }
  return {
    ...def,
    length: total,
    lapScale: def.uniform || !referenceLength ? 1 : total / referenceLength,
    warp,
    point,
    outline,
    distanceToCenterline,
  };
}

export function createTracks(defs = TRACK_DEFS) {
  const reference = lengthTable(defs[0].center).total;
  return defs.map((def) => createTrack(def, reference));
}

export function normalizeTrackId(id, tracks = TRACK_DEFS) {
  return tracks.some((track) => track.id === id) ? id : tracks[0].id;
}

export function outlineFrame(track, size = 64, pad = 6) {
  const xs = track.outline.map((p) => p[0]), zs = track.outline.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const scale = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
  const ox = (size - (maxX - minX) * scale) / 2, oz = (size - (maxZ - minZ) * scale) / 2;
  const path = track.outline
    .map(([x, z], i) => `${i ? "L" : "M"}${(ox + (x - minX) * scale).toFixed(1)} ${(oz + (z - minZ) * scale).toFixed(1)}`)
    .join(" ") + " Z";
  return { minX, minZ, maxX, maxZ, scale, ox, oz, size, path };
}

export function projectPoint(frame, x, z) {
  return [frame.ox + (x - frame.minX) * frame.scale, frame.oz + (z - frame.minZ) * frame.scale];
}

export function outlinePath(track, size = 64, pad = 6) {
  return outlineFrame(track, size, pad).path;
}
