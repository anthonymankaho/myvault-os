import { TAU } from "./neon-apex-tracks.mjs";

export const TOTAL_LAPS = 3;
export const FORMATION_SPEED = 120;
export const COUNTDOWN_SECONDS = 3;
export const RIVAL_SPEED_CAP = 234;
export const SLIP_MIN = 0.007;
export const SLIP_WINDOW = 0.032;
export const SLIP_LANE = 2.1;

const CORNER_DRAG = 0.08;
const CHASE_GAP = 0.1;
const CHASE_SCALE = 1.025;

// One rolling grid. Progress is a fraction of the lap, so these gaps are a
// few car lengths, not a lap. The player can catch the field.
export const RIVALS = [
  { id: "mira", name: "MIRA", body: 0xd19a43, trim: 0x5ce4da, map: "#d19a43", lane: -2.15, progress: 0.03, pace: 226, aggression: 0.82, phase: 0.4, avoidSign: 1 },
  { id: "kai", name: "KAI", body: 0x24a59f, trim: 0xffb982, map: "#24a59f", lane: 2.35, progress: 0.02, pace: 218, aggression: 0.5, phase: 1.7, avoidSign: -1 },
  { id: "sol", name: "SOL", body: 0x4e70c5, trim: 0xff876f, map: "#4e70c5", lane: -3.55, progress: 0.01, pace: 210, aggression: 0.22, phase: 2.8, avoidSign: 1 },
];

export const PLAYER_GRID = {
  id: "you",
  name: "YOU",
  body: 0xe8e9df,
  trim: 0x9ce6d0,
  map: "#7ce4c8",
  lane: 1.15,
  progress: 0.002,
  player: true,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function scoreOf(racer) {
  const progress = ((racer.progress % 1) + 1) % 1;
  return (racer.laps || 0) + progress;
}

export function standings(racers) {
  return [...racers].sort((a, b) => scoreOf(b) - scoreOf(a) || String(a.name).localeCompare(String(b.name)));
}

export function orderIds(racers) {
  return standings(racers).map((racer) => racer.id);
}

export function freshField() {
  return {
    player: { ...PLAYER_GRID, laps: 0, speed: 0 },
    rivals: RIVALS.map((rival) => ({ ...rival, homeLane: rival.lane, laps: 0, speed: 0 })),
  };
}

export function countdownCue(elapsed) {
  if (elapsed < 1) return "3";
  if (elapsed < 2) return "2";
  if (elapsed < 3) return "1";
  return "GO";
}

export function countdownDone(elapsed) {
  return elapsed >= COUNTDOWN_SECONDS;
}

export function advanceProgress(progress, speed, dt, lapScale = 1) {
  const scale = lapScale > 0 ? lapScale : 1;
  const next = progress + (speed * dt) / (5000 * scale);
  const lapsGained = Math.max(0, Math.floor(next));
  return { progress: next - lapsGained, lapsGained };
}

export function slipstreamAmount(player, rivals, window = SLIP_WINDOW, lane = SLIP_LANE) {
  const playerScore = scoreOf(player);
  let best = 0;
  for (const rival of rivals) {
    const ahead = scoreOf(rival) - playerScore;
    if (ahead < SLIP_MIN || ahead > window) continue;
    const laneGap = Math.abs((rival.lane ?? 0) - (player.lane ?? 0));
    if (laneGap > lane) continue;
    const laneFactor = 1 - laneGap / lane;
    const span = window - SLIP_MIN;
    best = Math.max(best, (1 - (ahead - SLIP_MIN) / span) * laneFactor);
  }
  return best;
}

export function stepRival(rival, dt, world) {
  const limit = Math.max(0, world.laneMax - 0.6);
  if (!world.racing) {
    rival.lane = clamp(rival.lane, -limit, limit);
    return { defending: false };
  }
  const corner = clamp(world.curvature?.(rival.progress) ?? 0, 0, 1);
  const ahead = scoreOf(rival) - scoreOf(world.player);
  let target = rival.pace * (1 - corner * CORNER_DRAG);
  if (Number.isFinite(world.cornerKmh)) target = Math.min(target, Math.max(72, world.cornerKmh));
  if (ahead < -CHASE_GAP) target *= CHASE_SCALE;
  target = Math.min(RIVAL_SPEED_CAP, target);
  const rate = rival.speed < target ? 22 : 42;
  if (rival.speed < target) rival.speed = Math.min(target, rival.speed + rate * dt);
  else rival.speed = Math.max(target, rival.speed - rate * dt);

  let laneTarget = rival.homeLane + Math.sin(world.elapsed / 1400 + rival.phase) * 1.05;
  const defending = ahead > 0 && ahead < 0.03 && Math.abs(world.player.lane - rival.lane) < 3.2;
  if (defending) laneTarget = laneTarget * (1 - rival.aggression) + world.player.lane * rival.aggression;
  for (const other of world.others) {
    const gap = Math.abs(scoreOf(other) - scoreOf(rival));
    if (gap < 0.012 && Math.abs(other.lane - rival.lane) < 2.6) {
      const sign = Math.sign(rival.lane - other.lane) || rival.avoidSign || 1;
      laneTarget += sign * 1.8;
    }
  }
  laneTarget = clamp(laneTarget, -limit, limit);
  const blend = 1 - Math.exp(-dt * 1.7);
  rival.lane = clamp(rival.lane + (laneTarget - rival.lane) * blend, -limit, limit);
  return { defending };
}

export function createCurvatureSampler(track, samples = 128) {
  const angles = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * TAU;
    const d = 0.045;
    const p0 = track.point(a - d);
    const p1 = track.point(a);
    const p2 = track.point(a + d);
    const h1 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    const h2 = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    let turn = h2 - h1;
    while (turn > Math.PI) turn -= TAU;
    while (turn < -Math.PI) turn += TAU;
    angles[i] = Math.min(1, Math.abs(turn) / 0.42);
  }
  return (progress) => {
    const frac = ((progress % 1) + 1) % 1;
    const f = frac * samples;
    const i = Math.floor(f) % samples;
    const j = (i + 1) % samples;
    const t = f - Math.floor(f);
    return angles[i] * (1 - t) + angles[j] * t;
  };
}

export function createPositionWatch(hold = 0.12) {
  let order = null;
  let pending = null;
  let pendingKey = "";
  let pendingFor = 0;
  return {
    reset(ids) {
      order = ids.slice();
      pending = null;
      pendingKey = "";
      pendingFor = 0;
    },
    update(ids, dt) {
      const key = ids.join(",");
      if (!order) {
        order = ids.slice();
        return null;
      }
      if (key === order.join(",")) {
        pending = null;
        pendingKey = "";
        pendingFor = 0;
        return null;
      }
      if (pendingKey !== key) {
        pending = ids.slice();
        pendingKey = key;
        pendingFor = 0;
        return null;
      }
      pendingFor += dt;
      if (pendingFor < hold) return null;
      const event = positionChange(order, pending);
      order = pending.slice();
      pending = null;
      pendingKey = "";
      pendingFor = 0;
      return event;
    },
  };
}

export function positionChange(previous, next) {
  const was = previous.indexOf("you");
  const now = next.indexOf("you");
  if (was < 0 || now < 0 || was === now) return null;
  if (now < was) return { type: "gain", place: now + 1, other: next[now + 1] || null };
  return { type: "loss", place: now + 1, other: next[now - 1] || null };
}

export function resultRows(racers, elapsedMs) {
  const ordered = standings(racers);
  const leader = ordered[0];
  const leaderScore = Math.max(scoreOf(leader), 0.001);
  const msPerScore = elapsedMs / leaderScore;
  return ordered.map((racer, index) => {
    const behind = scoreOf(leader) - scoreOf(racer);
    let gap = "LEAD";
    if (index > 0) gap = behind >= 1 ? `+${Math.floor(behind)} LAP` : `+${(behind * msPerScore / 1000).toFixed(1)}s`;
    return { place: index + 1, id: racer.id, name: racer.name, player: Boolean(racer.player), gap };
  });
}
