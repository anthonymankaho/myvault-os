import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ROAD_HALF, TAU, TRACK_DEFS, createTracks, normalizeTrackId, outlinePath } from "../games/neon-apex-tracks.mjs";

const tracks = createTracks();

function sample(track, n = 720) {
  return Array.from({ length: n }, (_, i) => track.point((i / n) * TAU));
}

test("there are three distinct race maps with their own best-lap keys", () => {
  assert.deepEqual(tracks.map((track) => track.id), ["night", "harbour", "ridge"]);
  assert.equal(new Set(tracks.map((track) => track.bestKey)).size, 3);
  assert.equal(tracks[0].bestKey, "myvault_neon_apex_best");
  for (const track of tracks) {
    assert.ok(track.name && track.place && track.eyebrow && track.title && track.lede, track.id);
    assert.match(outlinePath(track), /^M[\d. ]+( L[\d. ]+)+ Z$/);
  }
});

test("the original circuit keeps its exact shape and lap length", () => {
  const night = tracks[0];
  assert.equal(night.lapScale, 1);
  for (const a of [0, 0.7, 2.1, 4.4, 6]) {
    assert.equal(night.warp(a), a);
    const ct = Math.cos(a), st = Math.sin(a);
    const tx = -104 * st, tz = 72 * ct, len = Math.hypot(tx, tz);
    const [x, z] = night.point(a, 3.5);
    assert.ok(Math.abs(x - (104 * ct + (tz / len) * 3.5)) < 1e-9);
    assert.ok(Math.abs(z - (72 * st - (tx / len) * 3.5)) < 1e-9);
  }
});

test("new maps advance at an even pace along the road and scale lap length to distance", () => {
  for (const track of tracks.slice(1)) {
    const points = sample(track, 400);
    const steps = points.map((p, i) => {
      const q = points[(i + 1) % points.length];
      return Math.hypot(q[0] - p[0], q[1] - p[1]);
    });
    const mean = steps.reduce((sum, step) => sum + step, 0) / steps.length;
    for (const step of steps) assert.ok(Math.abs(step - mean) / mean < 0.03, `${track.id} uneven step ${step} vs ${mean}`);
    assert.ok(Math.abs(track.lapScale - track.length / tracks[0].length) < 1e-9);
    assert.ok(track.lapScale > 1 && track.lapScale < 1.35, `${track.id} lap scale ${track.lapScale}`);
  }
});

test("every map is a clean loop: no overlapping road and no corner tighter than the road allows", () => {
  for (const track of tracks) {
    const n = 720, points = sample(track, n);
    const step = track.length / n;
    let minGap = Infinity;
    for (let i = 0; i < n; i += 2) {
      for (let j = 0; j < n; j += 2) {
        const arc = Math.min(Math.abs(i - j), n - Math.abs(i - j)) * step;
        if (arc < 80) continue;
        minGap = Math.min(minGap, Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]));
      }
    }
    assert.ok(minGap > (ROAD_HALF + 2) * 2 + 10, `${track.id} sections only ${minGap.toFixed(1)} apart`);

    let minRadius = Infinity;
    for (let i = 0; i < n; i++) {
      const a = points[(i - 3 + n) % n], b = points[i], c = points[(i + 3) % n];
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
      const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      if (area2) minRadius = Math.min(minRadius, (ab * bc * ca) / (2 * area2));
    }
    assert.ok(minRadius > ROAD_HALF * 2, `${track.id} tightest radius ${minRadius.toFixed(1)}`);
  }
});

test("unknown saved map ids fall back to the original circuit", () => {
  assert.equal(normalizeTrackId("ridge"), "ridge");
  assert.equal(normalizeTrackId("moon"), "night");
  assert.equal(normalizeTrackId(null), "night");
  assert.equal(TRACK_DEFS.length, 3);
});

test("the game page offers the map picker and stores best laps per map", () => {
  const html = readFileSync(new URL("../games/neon-apex.html", import.meta.url), "utf8");
  assert.match(html, /id="track-picker"/);
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /createTracks/);
  assert.match(html, /activeTrack\.bestKey/);
  assert.match(html, /activeTrack\.lapScale/);
  assert.doesNotMatch(html, /localStorage\.setItem\("myvault_neon_apex_best"/);
});
