import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampScale,
  fitViewport,
  panViewport,
  resetViewport,
  resizeViewport,
  screenToWorld,
  zoomViewportAt,
} from '../../dist/ui/assets/graph/viewport.js';

test('viewport scale is clamped to useful graph limits', () => {
  assert.equal(clampScale(0.1), 0.35);
  assert.equal(clampScale(1.2), 1.2);
  assert.equal(clampScale(9), 2.5);
});

test('pointer-centered zoom keeps the same world point under the cursor', () => {
  const before = { x: 40, y: 20, scale: 1 };
  const point = { x: 240, y: 120 };
  const world = screenToWorld(before, point);
  const after = zoomViewportAt(before, 2, point);
  assert.deepEqual(screenToWorld(after, point), world);
  assert.deepEqual(after, { x: -160, y: -80, scale: 2 });
});

test('panning and reset are deterministic', () => {
  assert.deepEqual(panViewport({ x: 1, y: 2, scale: 1 }, 20, -5), { x: 21, y: -3, scale: 1 });
  assert.deepEqual(resetViewport(), { x: 0, y: 0, scale: 1 });
});

test('fit centers all graph nodes with padding and respects scale limits', () => {
  const nodes = [
    { id: 'manager', x: 100, y: 100 },
    { id: 'worker', x: 600, y: 400 },
  ];
  const fitted = fitViewport(nodes, { width: 1000, height: 700 }, { width: 190, height: 108 }, 50);
  assert.ok(fitted.scale > 1 && fitted.scale < 2);
  const topLeft = { x: 100 * fitted.scale + fitted.x, y: 100 * fitted.scale + fitted.y };
  const bottomRight = { x: 790 * fitted.scale + fitted.x, y: 508 * fitted.scale + fitted.y };
  assert.ok(topLeft.x >= 49 && topLeft.y >= 49);
  assert.ok(bottomRight.x <= 951 && bottomRight.y <= 651);

  const single = fitViewport([{ id: 'one', x: 0, y: 0 }], { width: 5000, height: 5000 });
  assert.equal(single.scale, 2.5);
});

test('fit returns reset for an empty graph or unusable viewport', () => {
  assert.deepEqual(fitViewport([], { width: 100, height: 100 }), resetViewport());
  assert.deepEqual(fitViewport([{ id: 'one', x: 0, y: 0 }], { width: 0, height: 100 }), resetViewport());
});


test('resizing preserves the world point at the viewport center', () => {
  const viewport = { x: -120, y: 80, scale: 1.4 };
  const before = { width: 1000, height: 700 };
  const after = { width: 390, height: 520 };
  const worldBefore = screenToWorld(viewport, { x: before.width / 2, y: before.height / 2 });
  const resized = resizeViewport(viewport, before, after);
  assert.deepEqual(screenToWorld(resized, { x: after.width / 2, y: after.height / 2 }), worldBefore);
});
