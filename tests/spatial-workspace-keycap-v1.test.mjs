import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOLODECK_CONSOLE as c } from '../apps/spatial-bridge/holodeck-layout-v1.mjs';
import { consolePointToWorld, consoleDirectionToWorld } from '../apps/spatial-bridge/holodeck-comfort-v1.mjs';
import { SCREEN_KEYS, screenButtonLabel, createHolodeckScreen } from '../apps/spatial-bridge/holodeck-screen-v1.mjs';
import { consoleHit } from '../apps/spatial-bridge/holodeck-screen-input-v1.mjs';
import {
  buildHolodeckKeycaps, keycapPressTravel, KEYCAP_RISE_METRES,
  KEYCAP_BODY_METRES, KEYCAP_TRAVEL_METRES, KEYCAP_PRESS_DURATION_MS,
  KEYCAP_VERTEX_STRIDE, KEYCAP_VERTEX_COUNT,
} from '../apps/spatial-bridge/holodeck-keycaps-v1.mjs';

const near = (a, b, tol = 0.00002) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const vectorNear = (a, b) => a.forEach((n, i) => near(n, b[i]));
const position = (mesh, index) => Array.from(mesh.slice(index * KEYCAP_VERTEX_STRIDE, index * KEYCAP_VERTEX_STRIDE + 3));
const material = (mesh, index) => mesh[index * KEYCAP_VERTEX_STRIDE + 5];
const texture = (mesh, index) => Array.from(mesh.slice(index * KEYCAP_VERTEX_STRIDE + 3, index * KEYCAP_VERTEX_STRIDE + 5));

test('each physical key has an individually textured top, four solid sides and air gaps', () => {
  const mesh = buildHolodeckKeycaps();
  assert.equal(mesh.length, KEYCAP_VERTEX_COUNT * KEYCAP_VERTEX_STRIDE);
  assert.equal(KEYCAP_VERTEX_COUNT, SCREEN_KEYS.length * 30);
  assert.ok(mesh.every(Number.isFinite));
  for (let i = 0; i < SCREEN_KEYS.length; i++) {
    const key = SCREEN_KEYS[i], first = i * 30;
    assert.equal(material(mesh, first), 0, 'key label is supplied by the original keyboard atlas');
    for (let face = 0; face < 4; face++) {
      assert.ok(material(mesh, first + 6 + face * 6) > 0.5,
        key.id + ' must have a real visible sidewall, not a flat touch pad');
    }
    near(position(mesh, first)[1], c.top + KEYCAP_RISE_METRES);
    near(position(mesh, first + 6)[1], c.top + KEYCAP_RISE_METRES - KEYCAP_BODY_METRES);
    const uv = texture(mesh, first);
    assert.ok(uv[0] > key.x && uv[0] < key.x + key.w);
    assert.ok(uv[1] > key.y && uv[1] < key.y + key.h);
    // A distinct top and side thickness produces real stereo parallax.
    assert.ok(KEYCAP_RISE_METRES > KEYCAP_BODY_METRES);
  }
});

test('press follows physical downstroke, bottom contact and independent spring return', () => {
  near(keycapPressTravel(0), 0);
  near(keycapPressTravel(45), KEYCAP_TRAVEL_METRES);
  near(keycapPressTravel(70), KEYCAP_TRAVEL_METRES);
  assert.ok(keycapPressTravel(18) > 0 && keycapPressTravel(18) < KEYCAP_TRAVEL_METRES);
  assert.ok(keycapPressTravel(140) > 0 && keycapPressTravel(140) < KEYCAP_TRAVEL_METRES);
  near(keycapPressTravel(KEYCAP_PRESS_DURATION_MS), 0);
  for (const age of [NaN, Infinity, -1, KEYCAP_PRESS_DURATION_MS + 1]) near(keycapPressTravel(age), 0);
});

test('pressed key translates only its own real top and sidewalls through 0°, 37° and 90° tilt', () => {
  const id = 'key:g', selected = SCREEN_KEYS.findIndex(key => key.id === id);
  assert.ok(selected > 0);
  for (const keyboardTilt of [0, 37, 90]) {
    const neutral = buildHolodeckKeycaps({ keyboardTilt });
    const pressed = buildHolodeckKeycaps({ keyboardTilt, pressedId: id, pressAgeMs: 45 });
    const start = selected * 30;
    const delta = position(pressed, start).map((value, i) => value - position(neutral, start)[i]);
    const expected = consoleDirectionToWorld([0, -KEYCAP_TRAVEL_METRES, 0], keyboardTilt);
    vectorNear(delta, expected);
    // All six vertices of the same key top move, as do its four sidewalls.
    for (let j of [0, 4, 6, 18, 29]) {
      vectorNear(position(pressed, start + j).map((value, i) => value - position(neutral, start + j)[i]), expected);
    }
    for (const neighbour of [0, Math.min(SCREEN_KEYS.length - 1, selected + 1)])
      vectorNear(position(pressed, neighbour * 30), position(neutral, neighbour * 30));
  }
});

test('Quest and Xbox ray hits match the visible raised key surfaces at every tilt', () => {
  const key = SCREEN_KEYS.find(k => k.id === 'key:g');
  const flat = [
    (-c.halfWidth + 0.1) + (key.x + key.w / 2) * (2 * c.halfWidth - 0.2),
    c.top + KEYCAP_RISE_METRES,
    (c.center[2] - c.halfDepth + 0.06) + (key.y + key.h / 2) * (2 * c.halfDepth - 0.12),
  ];
  for (const angle of [0, 37, 90]) {
    const target = consolePointToWorld(flat, angle);
    const normal = consoleDirectionToWorld([0, 1, 0], angle);
    const origin = target.map((value, index) => value + normal[index] * 1.1);
    const ray = normal.map(n => -n);
    assert.equal(consoleHit(origin, ray, angle)?.id, key.id);
  }
});

test('selecting a key or Shift animates the real cap, then releases without additional input authority', () => {
  let timestamp = 100, inputs = [];
  const client = {
    getState: () => ({ status: 'live', revision: 0, message: '' }),
    getFrame: () => ({ naturalWidth: 1920, naturalHeight: 1080 }),
    input: value => { inputs.push(value); return true; },
  };
  const screen = createHolodeckScreen({
    client, now: () => timestamp,
    documentRef: { createElement: () => ({ getContext: () => ({}) }) },
  });
  assert.equal(screen.getKeycapMotion(), null);
  screen.action('key:g');
  assert.deepEqual(inputs.at(-1), { kind: 'text', text: 'g' });
  assert.deepEqual(screen.getKeycapMotion(), { id: 'key:g', ageMs: 0 });
  timestamp += 45;
  near(keycapPressTravel(screen.getKeycapMotion().ageMs), KEYCAP_TRAVEL_METRES);
  timestamp += 200;
  near(keycapPressTravel(screen.getKeycapMotion().ageMs), 0);
  screen.action('shift');
  assert.equal(screen.getKeycapMotion().id, 'shift');
  screen.action('key:1');
  assert.deepEqual(inputs.at(-1), { kind: 'text', text: '!' });
  assert.equal(screen.getKeycapMotion().id, 'key:1');
  assert.equal(screenButtonLabel(SCREEN_KEYS.find(key => key.id === 'key:1'), true), '!');
  assert.equal(inputs.length, 2, 'visual motion must not post extra keyboard events');
});

test('offline shell carries the keycap renderer and changes its asset epoch', () => {
  const source = readFileSync(new URL('../apps/spatial-bridge/service-worker.js', import.meta.url), 'utf8');
  assert.match(source, /\.\/holodeck-keycaps-v1\.mjs/);
  assert.match(source, /stephanos-spatial-workspace-v1-consented-window-v7/);
});
