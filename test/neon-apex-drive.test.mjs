import assert from "node:assert/strict";
import test from "node:test";
import {
  GRIP_G,
  TRACK_METERS,
  cornerSpeedKmh,
  createDriveCar,
  metersPerUnit,
  stepDrive,
  trackBend,
} from "../games/neon-apex-drive.mjs";
import { ROAD_HALF, createTracks } from "../games/neon-apex-tracks.mjs";

const tracks = createTracks();
const night = tracks[0];
const unitScale = metersPerUnit(night.length);
const straight = {
  curvature: 0,
  metersPerUnit: unitScale,
  lapScale: 1,
  roadHalf: ROAD_HALF,
  laneLimit: ROAD_HALF + 3.6,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drive(car, input, seconds, world = straight) {
  for (let t = 0; t < seconds; t += 0.02) stepDrive(car, input, world, 0.02);
  return car;
}

test("a straight holds the old lap clock and settles under the open-road cap", () => {
  assert.equal(TRACK_METERS, 5000 / 3.6);
  const car = createDriveCar(0.25, 0, 180);
  stepDrive(car, { steer: 0 }, straight, 0.05);
  const nominal = 180 / 5000 * 0.05;
  assert.ok(Math.abs(car.progress - 0.25 - nominal) / nominal < 0.02);
  assert.ok(Math.abs(car.lane) < 0.001);
  assert.ok(Math.abs(car.yaw) < 0.001);

  const launch = drive(createDriveCar(0.2, 0, 0), { steer: 0, accelerating: true }, 20);
  assert.ok(launch.speed > 220, `top ${launch.speed}`);
  assert.ok(launch.speed <= 238);
  assert.ok(Math.abs(launch.lane) < 0.05);
});

test("braking can stop the car, and drafting or boost raise the cap without crossing it", () => {
  const braked = drive(createDriveCar(0.2, 0, 180), { steer: 0, braking: true }, 5);
  const coast = drive(createDriveCar(0.2, 0, 180), { steer: 0 }, 5);
  assert.ok(braked.speed < 42, `braked ${braked.speed}`);
  assert.ok(coast.speed > 140, `coast ${coast.speed}`);
  assert.ok(braked.speed < coast.speed);

  const draft = drive(createDriveCar(0.2, 0, 236), { steer: 0, accelerating: true, slip: 1 }, 6);
  assert.ok(draft.speed > 245, `draft ${draft.speed}`);
  assert.ok(draft.speed <= 256);

  const boost = drive(createDriveCar(0.2, 0, 250), { steer: 0, accelerating: true, boosting: true }, 8);
  assert.ok(boost.speed > 280, `boost ${boost.speed}`);
  assert.ok(boost.speed <= 292);
});

test("the wheel changes lane, then the car straightens when you let go", () => {
  const held = drive(createDriveCar(0.3, 0, 150), { steer: 1, accelerating: true }, 1);
  assert.ok(held.lane > 0.4, `lane ${held.lane}`);
  assert.ok(held.yaw > 0.04, `yaw ${held.yaw}`);
  const released = drive(held, { steer: 0, accelerating: true }, 2);
  assert.ok(Math.abs(released.yaw) < 0.03, `released yaw ${released.yaw}`);
});

test("the handbrake yaws harder and scrubs more speed than the same steer", () => {
  const grip = drive(createDriveCar(0.3, 0, 150), { steer: 1, accelerating: true }, 0.8);
  const slide = drive(createDriveCar(0.3, 0, 150), { steer: 1, accelerating: true, drifting: true }, 0.8);
  assert.ok(slide.yaw > grip.yaw + 0.05, `slide ${slide.yaw} grip ${grip.yaw}`);
  assert.ok(slide.speed < grip.speed);
});

test("the night oval's tight end needs a brake, and a clean lap beats flat-out", () => {
  const bend = trackBend(night, 0);
  const limit = cornerSpeedKmh(bend, unitScale);
  assert.ok(bend < 0, `bend ${bend}`);
  assert.ok(limit > 110 && limit < 150, `corner ${limit}`);
  assert.equal(GRIP_G, 1.05);

  const worldFor = (car) => ({
    curvature: trackBend(night, car.progress),
    metersPerUnit: unitScale,
    lapScale: night.lapScale,
    roadHalf: ROAD_HALF,
    laneLimit: ROAD_HALF + 3.6,
  });
  function lap(driver) {
    const car = createDriveCar(0.05, 0, 120);
    let off = 0;
    let maxLane = 0;
    for (let t = 0; t < 80; t += 0.02) {
      const world = worldFor(car);
      const step = stepDrive(car, driver(car, world), world, 0.02);
      maxLane = Math.max(maxLane, Math.abs(car.lane));
      if (step.offroad) off += 0.02;
      if (car.progress < 0.04 && t > 8) return { lap: t, off, maxLane };
    }
    return { lap: Infinity, off, maxLane };
  }
  const clean = lap((car, world) => {
    const v = Math.max(Math.abs(car.speed) / 3.6, 5);
    const road = (v / unitScale) * world.curvature;
    const grip = GRIP_G * 9.81 / v;
    const fix = clamp(-car.lane * 0.12 - car.yaw * 2, -0.7, 0.7);
    const corner = cornerSpeedKmh(world.curvature, unitScale);
    const braking = Number.isFinite(corner) && car.speed > corner * 1.04;
    return { steer: clamp(road / grip + fix, -1, 1), accelerating: !braking, braking, drifting: false };
  });
  const wild = lap((car, world) => {
    const v = Math.max(Math.abs(car.speed) / 3.6, 5);
    const road = (v / unitScale) * world.curvature;
    const grip = GRIP_G * 9.81 / v;
    const fix = clamp(-car.lane * 0.18 - car.yaw * 1.6, -1, 1);
    return { steer: clamp(road / grip + fix, -1, 1), accelerating: true, braking: false, drifting: false };
  });
  assert.equal(clean.off, 0);
  assert.ok(clean.maxLane < ROAD_HALF - 1.2, `clean lane ${clean.maxLane}`);
  assert.ok(wild.off > 1, `wild off ${wild.off}`);
  assert.ok(clean.lap < wild.lap, `clean ${clean.lap} wild ${wild.lap}`);
});
