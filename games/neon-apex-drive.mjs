import { TAU } from "./neon-apex-tracks.mjs";

// The lap clock treats `speed / 5000` as a fraction of a reference lap.
// That is the same as driving TRACK_METERS at `speed` km/h.
export const TRACK_METERS = 5000 / 3.6;
export const GRIP_G = 1.05;
const GRAVITY = 9.81;
const YAW_LIMIT = 0.95;
const ALIGN = 2.15;
const MAX_WHEEL = 0.52;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrapAngle(angle) {
  let next = angle;
  while (next > Math.PI) next -= TAU;
  while (next < -Math.PI) next += TAU;
  return next;
}

export function metersPerUnit(referenceLength) {
  return TRACK_METERS / referenceLength;
}

export function trackHeading(track, progress) {
  const t = ((progress % 1) + 1) % 1 * TAU;
  const a = track.point(t);
  const b = track.point(t + 1e-4);
  return Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));
}

// Signed heading change per mesh unit. Positive means the road turns toward +lane.
export function trackBend(track, progress) {
  const h = 0.008;
  const t = ((progress % 1) + 1) % 1 * TAU;
  const head = (u) => {
    const uu = ((u % TAU) + TAU) % TAU;
    const a = track.point(uu);
    const b = track.point(uu + 1e-4);
    return Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));
  };
  const arcStart = ((t - h) % TAU + TAU) % TAU;
  const arcEnd = ((t + h) % TAU + TAU) % TAU;
  const p0 = track.point(arcStart);
  const p1 = track.point(arcEnd);
  const arc = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  if (arc < 1e-6) return 0;
  return wrapAngle(head(t + h) - head(t - h)) / arc;
}

export function cornerSpeedKmh(curvaturePerUnit, unitScale, gripG = GRIP_G) {
  const kappa = Math.abs(curvaturePerUnit);
  if (kappa < 1e-4) return Infinity;
  const radius = unitScale / kappa;
  return Math.sqrt(gripG * GRAVITY * radius) * 3.6;
}

export function createDriveCar(progress, lane, speed) {
  return { progress, lane, speed, yaw: 0, wheel: 0 };
}

function stepOnce(car, input, world, dt) {
  const steerInput = clamp(input.steer || 0, -1, 1);
  const wheelTarget = steerInput * MAX_WHEEL;
  car.wheel += clamp(wheelTarget - car.wheel, -2.6 * dt, 2.6 * dt);

  const v = car.speed / 3.6;
  const offroad = Math.abs(car.lane) > world.roadHalf - 1.2;
  const drifting = Boolean(input.drifting) && Math.abs(v) > 26.4 && Math.abs(steerInput) > 0.12;
  let latAccel = (offroad ? 0.48 : GRIP_G) * GRAVITY;
  if (input.braking && !drifting) latAccel *= 0.78;
  if (drifting) latAccel *= 0.62;
  const gripYaw = latAccel / Math.max(Math.abs(v), 5);
  const direction = Math.sign(v || 1);
  let yawRate = direction * steerInput * gripYaw;
  if (drifting) yawRate *= 1.9;
  else if (input.braking && Math.abs(steerInput) > 0.2) yawRate *= 1.1;

  const along = v * Math.cos(car.yaw);
  const roadYawRate = (along / world.metersPerUnit) * (world.curvature || 0);
  const align = drifting ? 0.32 : ALIGN;
  car.yaw += (yawRate - roadYawRate - align * car.yaw) * dt;
  if (Math.abs(car.yaw) > YAW_LIMIT) {
    car.yaw = clamp(car.yaw, -YAW_LIMIT, YAW_LIMIT);
    car.speed -= Math.sign(car.speed || 1) * 22 * dt;
  }

  const slip = clamp(input.slip || 0, 0, 1);
  const cap = ((input.boosting ? 292 : 238) + (input.boosting ? 0 : slip * 18)) / 3.6;
  const peak = (input.boosting ? 14 : 11) * (1 + slip * 0.28) * (offroad ? 0.4 : 1);
  const drive = input.accelerating ? peak * Math.max(0, 1 - Math.max(v, 0) / cap) : 0;
  const brake = input.braking ? (drifting ? 6.5 : 11.5) : 0;
  const coast = !input.accelerating && !input.braking ? 2.2 : 0;
  const grass = offroad ? Math.abs(v) * 0.22 : 0;
  const slide = (drifting ? 3.5 : 0) + Math.abs(car.yaw) * 1.6;
  const newV = v + (drive - brake - coast - grass - slide) * dt;
  car.speed = clamp(newV, input.accelerating ? 0 : -8, 320 / 3.6) * 3.6;

  const moved = car.speed / 3.6;
  car.lane += (moved * Math.sin(car.yaw) / world.metersPerUnit) * dt;
  let hitWall = false;
  if (Math.abs(car.lane) > world.laneLimit) {
    car.lane = clamp(car.lane, -world.laneLimit, world.laneLimit);
    car.yaw *= 0.45;
    car.speed = Math.min(Math.abs(car.speed), 58) * Math.sign(car.speed || 1);
    hitWall = true;
  }

  const lapMeters = TRACK_METERS * (world.lapScale || 1);
  let next = car.progress + (moved * Math.cos(car.yaw) * dt) / lapMeters;
  let laps = 0;
  while (next >= 1) { next -= 1; laps += 1; }
  while (next < 0) { next += 1; laps -= 1; }
  car.progress = next;
  return {
    lapsGained: laps,
    offroad: Math.abs(car.lane) > world.roadHalf - 1.2,
    sliding: drifting && Math.abs(car.yaw) > 0.16,
    understeer: Math.abs(roadYawRate) > gripYaw + 0.04,
    hitWall,
  };
}

export function stepDrive(car, input, world, dt) {
  const steps = Math.max(1, Math.ceil(dt / 0.02));
  const h = dt / steps;
  const total = { lapsGained: 0, offroad: false, sliding: false, understeer: false, hitWall: false };
  for (let i = 0; i < steps; i++) {
    const step = stepOnce(car, input, world, h);
    total.lapsGained += step.lapsGained;
    total.offroad = step.offroad;
    total.sliding = total.sliding || step.sliding;
    total.understeer = total.understeer || step.understeer;
    total.hitWall = total.hitWall || step.hitWall;
  }
  return total;
}
