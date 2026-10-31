import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutConstellation, layoutStarLabels, matchingNodeIndexes, validConstellationEdges, wrapStarName } from '../constellation.mjs';

test('large constellations retain every skill and produce finite positions', () => {
  const nodes = [{ name: 'Project', kind: 'projects' }, ...Array.from({ length: 90 }, (_, i) => ({ name: `Skill ${i}`, kind: 'skills' }))];
  const points = layoutConstellation(nodes);
  assert.equal(points.length, 91);
  assert.ok(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
  assert.equal(new Set(points.map(({ x, y }) => `${x}:${y}`)).size, nodes.length);
  assert.deepEqual(matchingNodeIndexes(nodes, '', 'skills'), Array.from({ length: 90 }, (_, i) => i + 1));
});

test('search combines names, notes, metadata, and the selected kind', () => {
  const nodes = [
    { name: 'Chinese 中文', kind: 'skills', meta: 'Advanced', description: 'Teaching' },
    { name: 'Teaching plan', kind: 'projects', meta: 'Active', description: 'Lessons' },
  ];
  assert.deepEqual(matchingNodeIndexes(nodes, 'TEACHING', 'skills'), [0]);
  assert.deepEqual(matchingNodeIndexes(nodes, '中文'), [0]);
  assert.deepEqual(matchingNodeIndexes(nodes, 'active'), [1]);
  assert.deepEqual(matchingNodeIndexes(nodes, 'missing'), []);
});

test('only valid explicit links are drawn, without duplicates or self links', () => {
  const nodes = [{}, {}, {}];
  assert.deepEqual(validConstellationEdges(nodes, [
    { source: 0, target: 1 }, { source: 1, target: 0 }, { source: 2, target: 2 },
    { source: 0, target: 20 }, { source: -1, target: 1 }, { source: 0.5, target: 2 },
  ]), [{ source: 0, target: 1 }]);
});

test('long English and Chinese skill names wrap without being truncated', () => {
  const chinese = '這是一個需要完整顯示而不可以省略的中文技能名稱'.repeat(4);
  assert.equal(wrapStarName(chinese).join(''), chinese);
  const name = 'Professional communication and project management for community services';
  assert.equal(wrapStarName(name).join(' '), name);
  assert.ok(wrapStarName(name).every((line) => line.length <= 26));
});

test('all 40 full skill labels receive separate readable boxes', () => {
  const nodes = Array.from({ length: 40 }, (_, i) => ({ name: `Preview skill ${i + 1}`, kind: 'skills' }));
  const labels = layoutStarLabels(nodes, layoutConstellation(nodes));
  assert.equal(labels.length, nodes.length);
  labels.forEach((label, i) => {
    assert.equal(label.lines.join(' '), nodes[i].name);
    for (const previous of labels.slice(0, i)) {
      const a = label.box; const b = previous.box;
      assert.ok(!(a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top));
    }
  });
});
