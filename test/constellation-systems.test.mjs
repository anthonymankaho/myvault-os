import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTION_ORDER,
  SECTION_META,
  sectionMeta,
  layoutSolarSystems,
  starOrbitPosition,
  layoutSystemMap,
  layoutConstellation,
} from '../constellation-systems.mjs';

const mixedNodes = [
  { key: 'projects:p1', kind: 'projects', name: 'Alpha' },
  { key: 'projects:p2', kind: 'projects', name: 'Beta' },
  { key: 'skills:s1', kind: 'skills', name: 'Skill one' },
  { key: 'docs:d1', kind: 'docs', name: 'A document' },
  { key: 'chats:c1', kind: 'chats', name: 'A chat' },
  { key: 'tasks:t1', kind: 'tasks', name: 'A task' },
  { key: 'tasks:t2', kind: 'tasks', name: 'Another task' },
  { key: 'accounting:gpl', kind: 'accounting', name: 'Gold Plume Limited' },
  { key: 'games:neon-apex', kind: 'games', name: 'Neon Apex' },
];

test('every section has distinct sun and star colors', () => {
  assert.equal(SECTION_ORDER.length, 7);
  const suns = new Set(SECTION_ORDER.map((kind) => SECTION_META[kind].sun));
  const stars = new Set(SECTION_ORDER.map((kind) => SECTION_META[kind].star));
  assert.equal(suns.size, 7);
  assert.equal(stars.size, 7);
  SECTION_ORDER.forEach((kind) => {
    assert.ok(SECTION_META[kind].label);
    assert.ok(SECTION_META[kind].zh);
  });
  assert.equal(sectionMeta('unknown-kind'), SECTION_META.projects);
});

test('3D layout places every item once, grouped into one solar system per section', () => {
  const { systems, positions } = layoutSolarSystems(mixedNodes);
  assert.equal(positions.length, mixedNodes.length * 3);
  assert.deepEqual(systems.map((system) => system.kind), SECTION_ORDER.filter((kind) => mixedNodes.some((node) => node.kind === kind)));
  const placed = systems.flatMap((system) => system.stars.map((star) => star.index)).sort((a, b) => a - b);
  assert.deepEqual(placed, mixedNodes.map((_, index) => index));
  assert.ok(Array.from(positions).every(Number.isFinite));
  systems.forEach((system) => {
    assert.ok(system.radius > 0);
    assert.ok(system.stars.length > 0);
    system.stars.forEach((star) => {
      assert.ok(star.orbitRadius > 0);
      assert.ok(star.speed > 0);
      assert.ok(Number.isFinite(star.angle));
    });
  });
});

test('3D layout is deterministic for identical input', () => {
  const a = layoutSolarSystems(mixedNodes);
  const b = layoutSolarSystems(mixedNodes);
  assert.deepEqual(Array.from(a.positions), Array.from(b.positions));
  assert.deepEqual(a.systems.map((system) => system.center), b.systems.map((system) => system.center));
});

test('orbiting stars stay on their orbital shell around the sun', () => {
  const { systems } = layoutSolarSystems(mixedNodes);
  const out = [0, 0, 0];
  systems.forEach((system) => {
    system.stars.forEach((star) => {
      for (const angle of [0, 1.3, 2.9, 4.8]) {
        starOrbitPosition(system, star, angle, out, 0);
        const dx = out[0] - system.center.x;
        const dy = out[1] - system.center.y;
        const dz = out[2] - system.center.z;
        const distance = Math.hypot(dx, dy, dz);
        const expected = Math.hypot(star.orbitRadius, star.yOffset);
        assert.ok(Math.abs(distance - expected) < 1e-6, `distance ${distance} vs ${expected}`);
      }
    });
  });
});

test('empty vault produces no systems and an empty position buffer', () => {
  const { systems, positions } = layoutSolarSystems([]);
  assert.deepEqual(systems, []);
  assert.equal(positions.length, 0);
});

test('large vaults keep every star finite and separated', () => {
  const nodes = Array.from({ length: 260 }, (_, index) => ({
    key: `skills:s${index}`,
    kind: index % 5 === 0 ? 'projects' : 'skills',
    name: `Record ${index}`,
  }));
  const { systems, positions } = layoutSolarSystems(nodes);
  assert.equal(positions.length, nodes.length * 3);
  assert.ok(Array.from(positions).every(Number.isFinite));
  const seen = new Set();
  for (let index = 0; index < nodes.length; index += 1) {
    const key = `${positions[index * 3].toFixed(3)}:${positions[index * 3 + 1].toFixed(3)}:${positions[index * 3 + 2].toFixed(3)}`;
    assert.ok(!seen.has(key), `duplicate position for ${index}`);
    seen.add(key);
  }
  assert.ok(systems.every((system) => system.shells <= 3));
});

test('2D map gives every section a sun and every item a unique finite position', () => {
  const { positions, centers } = layoutSystemMap(mixedNodes);
  assert.equal(positions.length, mixedNodes.length);
  assert.equal(centers.length, 7);
  assert.ok(positions.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
  assert.equal(new Set(positions.map(({ x, y }) => `${x}:${y}`)).size, mixedNodes.length);
  centers.forEach((center) => {
    assert.ok(SECTION_META[center.kind]);
    assert.ok(center.radius >= 22);
    assert.equal(center.count, mixedNodes.filter((node) => node.kind === center.kind).length);
  });
  assert.deepEqual(layoutConstellation(mixedNodes), positions);
});

test('single-item sections sit exactly on their sun', () => {
  const { positions, centers } = layoutSystemMap([{ key: 'docs:only', kind: 'docs', name: 'Only doc' }]);
  assert.equal(centers.length, 1);
  assert.equal(positions[0].x, centers[0].x);
  assert.equal(positions[0].y, centers[0].y);
});
