import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  COUNTDOWN_SECONDS,
  FORMATION_SPEED,
  PLAYER_GRID,
  RIVALS,
  RIVAL_SPEED_CAP,
  advanceProgress,
  countdownCue,
  countdownDone,
  createCurvatureSampler,
  createPositionWatch,
  freshField,
  orderIds,
  resultRows,
  slipstreamAmount,
  standings,
  stepRival,
} from "../games/neon-apex-race.mjs";
import { outlineFrame, outlinePath, projectPoint, createTracks } from "../games/neon-apex-tracks.mjs";

const tracks = createTracks();

function simulate(playerSpeed, curvature = () => 0) {
  const field = freshField();
  const player = { ...field.player, speed: playerSpeed };
  const rivals = field.rivals.map((rival) => ({ ...rival, speed: FORMATION_SPEED }));
  let elapsed = 0;
  while (player.laps < 3 && elapsed < 180) {
    const dt = 0.05;
    elapsed += dt;
    const moved = advanceProgress(player.progress, playerSpeed, dt, 1);
    player.progress = moved.progress;
    player.laps += moved.lapsGained;
    for (const rival of rivals) {
      stepRival(rival, dt, {
        racing: true,
        player,
        others: rivals.filter((other) => other !== rival),
        elapsed: elapsed * 1000,
        laneMax: 6.2,
        curvature,
      });
      const step = advanceProgress(rival.progress, rival.speed, dt, 1);
      rival.progress = step.progress;
      rival.laps += step.lapsGained;
    }
  }
  const place = standings([player, ...rivals]).findIndex((racer) => racer.player) + 1;
  return { place, elapsed, player };
}

test("the grid is one lap, with the player at the back and a catchable gap", () => {
  const field = freshField();
  const again = freshField();
  field.rivals[0].pace = 1;
  field.rivals[0].lane = 9;
  assert.equal(again.rivals[0].pace, RIVALS[0].pace);
  assert.equal(again.rivals[0].lane, RIVALS[0].lane);
  assert.equal(field.player.id, "you");
  assert.ok(field.player.player);

  const ordered = orderIds([again.player, ...again.rivals]);
  assert.deepEqual(ordered, ["mira", "kai", "sol", "you"]);
  const leader = again.rivals[0];
  assert.ok(leader.progress - again.player.progress < 0.05);
  assert.ok(leader.progress - again.player.progress > 0.02);
  for (const racer of [again.player, ...again.rivals]) {
    assert.equal(racer.laps, 0);
    assert.ok(Math.abs(racer.lane) < 6);
  }
  const formationTravel = COUNTDOWN_SECONDS * FORMATION_SPEED / 5000;
  assert.ok(formationTravel + leader.progress < 0.2);
});

test("a clean 238 km/h run wins and a slow run does not", () => {
  const fast = simulate(238);
  const slow = simulate(150);
  assert.equal(fast.place, 1);
  assert.ok(fast.elapsed < 70, `fast race took ${fast.elapsed}`);
  assert.ok(slow.place > 1);
  assert.equal(slow.player.laps, 3);
});

test("drafting only counts when a rival is just ahead in the same lane", () => {
  const player = { laps: 0, progress: 0.5, lane: 0 };
  const ahead = { laps: 0, progress: 0.512, lane: 0.2 };
  assert.ok(slipstreamAmount(player, [ahead]) > 0.6);
  assert.equal(slipstreamAmount(player, [{ laps: 0, progress: 0.49, lane: 0 }]), 0);
  assert.equal(slipstreamAmount(player, [{ laps: 0, progress: 0.512, lane: 5 }]), 0);
  assert.equal(slipstreamAmount(player, [{ laps: 1, progress: 0.5, lane: 0 }]), 0);
  assert.equal(slipstreamAmount(player, [{ laps: 0, progress: 0.503, lane: 0 }]), 0);
});

test("a corner slows a rival below their pace, and a grip limit slows them further", () => {
  const field = freshField();
  const flat = { ...field.rivals[0], speed: field.rivals[0].pace };
  const bent = { ...field.rivals[0], speed: field.rivals[0].pace };
  const player = { ...field.player, lane: 20, progress: flat.progress };
  const world = { racing: true, player, others: [], elapsed: 0, laneMax: 6.2 };
  for (let i = 0; i < 50; i++) {
    stepRival(flat, 0.05, { ...world, curvature: () => 0 });
    stepRival(bent, 0.05, { ...world, curvature: () => 1 });
  }
  assert.ok(Math.abs(flat.speed - flat.pace) < 1);
  assert.ok(bent.speed < flat.speed - 8);
  assert.ok(bent.speed <= RIVAL_SPEED_CAP);

  const limited = { ...field.rivals[0], speed: field.rivals[0].pace };
  for (let i = 0; i < 80; i++) stepRival(limited, 0.05, { ...world, curvature: () => 0, cornerKmh: 100 });
  assert.ok(limited.speed < 110, `limited speed ${limited.speed}`);
  assert.ok(limited.speed >= 99);
});

test("a rival defends by moving toward a close follower and stays on the road", () => {
  const field = freshField();
  const rival = field.rivals[0];
  rival.speed = rival.pace;
  const player = { ...field.player, progress: rival.progress - 0.012, lane: -0.4, laps: 0 };
  let defended = false;
  for (let i = 0; i < 40; i++) {
    const step = stepRival(rival, 0.05, {
      racing: true,
      player,
      others: [],
      elapsed: 0,
      laneMax: 6.2,
      curvature: () => 0,
    });
    defended = defended || step.defending;
  }
  assert.equal(defended, true);
  assert.ok(rival.lane > -1.3, `lane ${rival.lane}`);
  assert.ok(Math.abs(rival.lane) <= 5.6);
});

test("position changes wait out a flicker, then name the car you passed", () => {
  const watch = createPositionWatch(0.12);
  watch.reset(["mira", "kai", "sol", "you"]);
  assert.equal(watch.update(["mira", "kai", "you", "sol"], 0.05), null);
  assert.equal(watch.update(["mira", "kai", "sol", "you"], 0.2), null);
  assert.equal(watch.update(["mira", "kai", "you", "sol"], 0.05), null);
  assert.deepEqual(watch.update(["mira", "kai", "you", "sol"], 0.12), {
    type: "gain",
    place: 3,
    other: "sol",
  });
  assert.equal(watch.update(["mira", "kai", "you", "sol"], 0.2), null);
});

test("the countdown, lap wrap, and result gap stay consistent", () => {
  assert.equal(countdownCue(0), "3");
  assert.equal(countdownCue(1.2), "2");
  assert.equal(countdownCue(2.4), "1");
  assert.equal(countdownCue(3), "GO");
  assert.equal(countdownDone(2.99), false);
  assert.equal(countdownDone(3), true);
  const wrapped = advanceProgress(0.99, 238, 0.5, 1);
  assert.equal(wrapped.lapsGained, 1);
  assert.ok(Math.abs(wrapped.progress - 0.0138) < 1e-9);

  const rows = resultRows([
    { id: "you", name: "YOU", player: true, laps: 3, progress: 0.01 },
    { id: "mira", name: "MIRA", laps: 2, progress: 0.4 },
    { id: "kai", name: "KAI", laps: 3, progress: 0 },
    { id: "sol", name: "SOL", laps: 2, progress: 0 },
  ], 63000);
  assert.equal(rows[0].id, "you");
  assert.equal(rows[0].gap, "LEAD");
  assert.equal(rows[1].id, "kai");
  assert.match(rows[1].gap, /^\+0\.\ds$/);
  assert.match(rows[3].gap, /^\+1 LAP$/);
  assert.equal(PLAYER_GRID.name, "YOU");
});

test("harbour bends harder than the night oval and the map dots share the outline frame", () => {
  const night = createCurvatureSampler(tracks[0]);
  const harbour = createCurvatureSampler(tracks[1]);
  let nightMax = 0;
  let harbourMax = 0;
  for (let i = 0; i < 64; i++) {
    const n = night(i / 64);
    const h = harbour(i / 64);
    assert.ok(n >= 0 && n <= 1);
    assert.ok(h >= 0 && h <= 1);
    nightMax = Math.max(nightMax, n);
    harbourMax = Math.max(harbourMax, h);
  }
  assert.ok(harbourMax > nightMax);

  const frame = outlineFrame(tracks[0]);
  assert.equal(frame.path, outlinePath(tracks[0]));
  const [x, z] = tracks[0].outline[0];
  const [px, py] = projectPoint(frame, x, z);
  assert.ok(frame.path.startsWith(`M${px.toFixed(1)} ${py.toFixed(1)}`));
});

test("the page, library, and offline cache pick up the race", () => {
  const html = readFileSync(new URL("../games/neon-apex.html", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../games/sw.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(html, /neon-apex-race\.mjs/);
  assert.match(html, /neon-apex-drive\.mjs/);
  assert.match(html, /slipstreamAmount/);
  assert.match(html, /stepDrive/);
  assert.match(html, /id="minimap"/);
  assert.match(html, /id="countdown"/);
  assert.match(html, /id="results"/);
  assert.match(html, /id="mute"/);
  assert.match(html, /id="draft"/);
  assert.match(html, /Tuck in behind a car to draft/);
  assert.match(sw, /neon-apex-offline-v3/);
  assert.match(sw, /neon-apex-race\.mjs/);
  assert.match(sw, /neon-apex-drive\.mjs/);
  assert.match(app, /neon-apex\.html\?v=drive-3/);
});
