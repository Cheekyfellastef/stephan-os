import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHolodeckComfort,
  HOLODECK_COMFORT_DEFAULTS,
  HOLODECK_COMFORT_STORAGE_KEY,
  HOLODECK_KEYBOARD_HINGE,
  HOLODECK_KEYBOARD_DIALS,
  HOLODECK_KEYBOARD_DIAL_RADIUS,
  consolePointToWorld,
  consolePointFromWorld,
  consoleDirectionToWorld,
  consoleDirectionFromWorld,
} from '../apps/spatial-bridge/holodeck-comfort-v1.mjs';
import { HOLODECK_CONSOLE } from '../apps/spatial-bridge/holodeck-layout-v1.mjs';
import { SCREEN_BUTTONS } from '../apps/spatial-bridge/holodeck-screen-v1.mjs';

function memoryStorage(initial = null) {
  let value = initial;
  const writes = [];
  return {
    writes,
    getItem(key) { assert.equal(key, HOLODECK_COMFORT_STORAGE_KEY); return value; },
    setItem(key, next) { assert.equal(key, HOLODECK_COMFORT_STORAGE_KEY); writes.push(next); value = next; },
  };
}

function closeVector(actual, expected, tolerance = 1e-10) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) <= tolerance,
    `component ${i}: expected ${expected[i]}, received ${value}`));
}

function activeProfile(comfort) {
  const { heightOffset, keyboardTilt } = comfort.getState();
  return { heightOffset, keyboardTilt };
}

test('default comfort preserves the existing room and returns isolated state snapshots', () => {
  const storage = memoryStorage(), changes = [];
  const comfort = createHolodeckComfort({ storage, onChange: (state) => changes.push(state) });
  assert.deepEqual(activeProfile(comfort), HOLODECK_COMFORT_DEFAULTS);
  assert.equal(comfort.getState().mode, 'seated');
  assert.deepEqual(comfort.getState().profiles, {
    seated: HOLODECK_COMFORT_DEFAULTS, standing: HOLODECK_COMFORT_DEFAULTS,
  });
  const snapshot = comfort.getState();
  snapshot.heightOffset = 500;
  snapshot.profiles.seated.heightOffset = 500;
  snapshot.profiles.standing.keyboardTilt = 500;
  assert.equal(comfort.getState().heightOffset, 0);
  assert.equal(comfort.getState().profiles.seated.heightOffset, 0);
  assert.equal(comfort.getState().profiles.standing.keyboardTilt, 0);
  assert.equal(comfort.flush(), true);
  assert.equal(storage.writes.length, 0);
  assert.equal(changes.length, 0);
});

test('settings clamp to the admitted ranges without forcing continuous tilt into presets', () => {
  const storage = memoryStorage(), comfort = createHolodeckComfort({ storage });
  comfort.setHeightOffset(2);
  assert.equal(comfort.getState().heightOffset, 1);
  comfort.setHeightOffset(-2);
  assert.equal(comfort.getState().heightOffset, -1);
  comfort.setKeyboardTilt(110);
  assert.equal(comfort.getState().keyboardTilt, 90);
  comfort.setKeyboardTilt(-5);
  assert.equal(comfort.getState().keyboardTilt, 0);
  comfort.setHeightOffset(0.37);
  comfort.setKeyboardTilt(37.125);
  assert.deepEqual(activeProfile(comfort), { heightOffset: 0.37, keyboardTilt: 37.125 });
  assert.equal(storage.writes.length, 0);
});

test('invalid setter values leave the live state and change notifications untouched', () => {
  const changes = [], comfort = createHolodeckComfort({ storage: memoryStorage(), onChange: (s) => changes.push(s) });
  comfort.setHeightOffset(0.21);
  comfort.setKeyboardTilt(37);
  for (const invalid of [NaN, Infinity, -Infinity, null, undefined, '45', {}, []]) {
    comfort.setHeightOffset(invalid);
    comfort.setKeyboardTilt(invalid);
  }
  assert.deepEqual(activeProfile(comfort), { heightOffset: 0.21, keyboardTilt: 37 });
  assert.equal(changes.length, 2);
});

test('many frame updates create one persisted record at explicit release and restore it', () => {
  const storage = memoryStorage(), comfort = createHolodeckComfort({ storage });
  for (let i = 0; i <= 370; i += 1) comfort.setKeyboardTilt(i / 10);
  comfort.setHeightOffset(0.42);
  assert.equal(storage.writes.length, 0);
  assert.equal(comfort.flush(), true);
  assert.equal(storage.writes.length, 1);
  assert.deepEqual(JSON.parse(storage.writes[0]), { version: 2, mode: 'seated', profiles: {
    seated: { heightOffset: 0.42, keyboardTilt: 37 }, standing: HOLODECK_COMFORT_DEFAULTS,
  } });
  assert.equal(comfort.flush(), true);
  assert.equal(storage.writes.length, 1);
  const restored = createHolodeckComfort({ storage });
  assert.deepEqual(activeProfile(restored), { heightOffset: 0.42, keyboardTilt: 37 });
  assert.equal(restored.flush(), true);
  assert.equal(storage.writes.length, 1);
});

test('invalid saved records cannot introduce NaN, coercion, out-of-range values, or a foreign version', () => {
  const invalid = [
    '', 'not json', 'NaN', 'null', '[]', '123', '{}',
    { version: 3, heightOffset: 0.2, keyboardTilt: 37 },
    { version: 1, heightOffset: 0.2 },
    { version: 1, heightOffset: null, keyboardTilt: 37 },
    { version: 1, heightOffset: '0.2', keyboardTilt: 37 },
    { version: 1, heightOffset: 1.01, keyboardTilt: 37 },
    { version: 1, heightOffset: -1.01, keyboardTilt: 37 },
    { version: 1, heightOffset: 0.2, keyboardTilt: -0.01 },
    { version: 1, heightOffset: 0.2, keyboardTilt: 90.01 },
    { version: 1, heightOffset: 0.2, keyboardTilt: '37' },
    { version: 1, heightOffset: NaN, keyboardTilt: Infinity },
  ];
  for (const record of invalid) {
    const storage = memoryStorage(typeof record === 'string' ? record : JSON.stringify(record));
    const comfort = createHolodeckComfort({ storage });
    assert.deepEqual(activeProfile(comfort), HOLODECK_COMFORT_DEFAULTS);
    assert.deepEqual(comfort.getState().profiles.standing, HOLODECK_COMFORT_DEFAULTS);
    assert.equal(storage.writes.length, 0);
  }
});

test('storage failures never prevent live adjustment and failed writes remain retryable', () => {
  let fail = true;
  const statuses = [], writes = [];
  const storage = {
    getItem() { throw new Error('blocked read'); },
    setItem(key, value) {
      if (fail) throw new Error('quota');
      writes.push({ key, value });
    },
  };
  const comfort = createHolodeckComfort({ storage, onStatus: (s) => statuses.push(s) });
  comfort.setHeightOffset(-0.35);
  comfort.setKeyboardTilt(63.5);
  assert.equal(comfort.flush(), false);
  assert.deepEqual(activeProfile(comfort), { heightOffset: -0.35, keyboardTilt: 63.5 });
  assert.equal(statuses.at(-1).state, 'session-only');
  fail = false;
  assert.equal(comfort.flush(), true);
  assert.equal(writes.length, 1);
  assert.equal(statuses.at(-1).state, 'saved');
  assert.equal(comfort.flush(), true);
  assert.equal(writes.length, 1);
});

test('missing storage and throwing UI observers do not interrupt adjustment or reset', () => {
  const fail = () => { throw new Error('observer failed'); };
  const comfort = createHolodeckComfort({ storage: null, onChange: fail, onStatus: fail });
  comfort.setKeyboardTilt(37);
  comfort.setHeightOffset(0.3);
  assert.deepEqual(activeProfile(comfort), { heightOffset: 0.3, keyboardTilt: 37 });
  assert.equal(comfort.flush(), false);
  comfort.reset();
  assert.deepEqual(activeProfile(comfort), HOLODECK_COMFORT_DEFAULTS);
});

test('reset saves both defaults together and repairs an invalid preference record', () => {
  const storage = memoryStorage('invalid saved record'), comfort = createHolodeckComfort({ storage });
  comfort.reset();
  assert.deepEqual(activeProfile(comfort), HOLODECK_COMFORT_DEFAULTS);
  assert.equal(storage.writes.length, 1);
  comfort.setHeightOffset(0.5);
  comfort.setKeyboardTilt(70);
  comfort.reset();
  assert.deepEqual(activeProfile(comfort), HOLODECK_COMFORT_DEFAULTS);
  assert.equal(storage.writes.length, 2);
  assert.deepEqual(JSON.parse(storage.writes.at(-1)), { version: 2, mode: 'seated', profiles: {
    seated: HOLODECK_COMFORT_DEFAULTS, standing: HOLODECK_COMFORT_DEFAULTS,
  } });
  comfort.flush();
  assert.equal(storage.writes.length, 2);
});

test('seated and standing profiles persist separately and each switch writes once', () => {
  const storage = memoryStorage(), changes = [];
  const comfort = createHolodeckComfort({ storage, onChange: (value) => changes.push(value) });
  const seated = { heightOffset: 0.54, keyboardTilt: 37 };
  const standing = { heightOffset: -0.12, keyboardTilt: 68.25 };
  comfort.setHeightOffset(seated.heightOffset);
  comfort.setKeyboardTilt(seated.keyboardTilt);
  assert.equal(storage.writes.length, 0);
  comfort.setMode('standing');
  assert.equal(storage.writes.length, 1);
  assert.equal(comfort.getState().mode, 'standing');
  assert.deepEqual(activeProfile(comfort), HOLODECK_COMFORT_DEFAULTS);
  assert.deepEqual(comfort.getState().profiles.seated, seated);
  comfort.setHeightOffset(standing.heightOffset);
  comfort.setKeyboardTilt(standing.keyboardTilt);
  comfort.setMode('seated');
  assert.equal(storage.writes.length, 2);
  assert.deepEqual(activeProfile(comfort), seated);
  assert.deepEqual(changes.at(-1), comfort.getState());
  comfort.setMode('standing');
  assert.equal(storage.writes.length, 3);
  const restored = createHolodeckComfort({ storage });
  assert.equal(restored.getState().mode, 'standing');
  assert.deepEqual(activeProfile(restored), standing);
  assert.deepEqual(restored.getState().profiles, { seated, standing });
  restored.flush();
  assert.equal(storage.writes.length, 3);
});

test('legacy preferences migrate into seated only with no implicit storage write', () => {
  const seated = { heightOffset: 0.28, keyboardTilt: 37.5 };
  const storage = memoryStorage(JSON.stringify({ version: 1, ...seated }));
  const comfort = createHolodeckComfort({ storage });
  assert.equal(comfort.getState().mode, 'seated');
  assert.deepEqual(activeProfile(comfort), seated);
  assert.deepEqual(comfort.getState().profiles.standing, HOLODECK_COMFORT_DEFAULTS);
  assert.equal(storage.writes.length, 0);
  comfort.flush();
  assert.equal(storage.writes.length, 1);
  assert.deepEqual(JSON.parse(storage.writes[0]), { version: 2, mode: 'seated', profiles: {
    seated, standing: HOLODECK_COMFORT_DEFAULTS,
  } });
});

test('invalid profiles recover independently without discarding the other valid profile', () => {
  const valid = { heightOffset: 0.25, keyboardTilt: 37 };
  for (const broken of [undefined, null, [], {}, { heightOffset: '0.5', keyboardTilt: 30 },
    { heightOffset: 0.2, keyboardTilt: null }, { heightOffset: 2, keyboardTilt: 30 }]) {
    for (const badMode of ['seated', 'standing']) {
      const goodMode = badMode === 'seated' ? 'standing' : 'seated';
      const storage = memoryStorage(JSON.stringify({ version: 2, mode: goodMode, profiles: {
        [goodMode]: valid, [badMode]: broken,
      } }));
      const comfort = createHolodeckComfort({ storage });
      assert.equal(comfort.getState().mode, goodMode);
      assert.deepEqual(activeProfile(comfort), valid);
      assert.deepEqual(comfort.getState().profiles[badMode], HOLODECK_COMFORT_DEFAULTS);
      assert.equal(storage.writes.length, 0);
    }
  }
  const comfort = createHolodeckComfort({ storage: memoryStorage(JSON.stringify({
    version: 2, mode: 'lying-down', profiles: { seated: valid, standing: valid },
  })) });
  assert.equal(comfort.getState().mode, 'seated');
  assert.deepEqual(comfort.getState().profiles, { seated: valid, standing: valid });
});

test('repeated mode selections never add offsets or overwrite the other profile on reset', () => {
  const storage = memoryStorage(), comfort = createHolodeckComfort({ storage });
  const seated = { heightOffset: 0.55, keyboardTilt: 37 };
  const standing = { heightOffset: -0.15, keyboardTilt: 65 };
  comfort.setHeightOffset(seated.heightOffset);
  comfort.setKeyboardTilt(seated.keyboardTilt);
  comfort.setMode('standing');
  comfort.setHeightOffset(standing.heightOffset);
  comfort.setKeyboardTilt(standing.keyboardTilt);
  comfort.flush();
  for (let i = 0; i < 30; i += 1) {
    comfort.setMode('seated');
    assert.deepEqual(activeProfile(comfort), seated);
    comfort.setMode('standing');
    assert.deepEqual(activeProfile(comfort), standing);
  }
  const before = storage.writes.length;
  comfort.setMode('standing');
  comfort.setMode('unknown');
  comfort.setMode(null);
  assert.equal(storage.writes.length, before);
  assert.deepEqual(comfort.getState().profiles, { seated, standing });
  comfort.reset();
  assert.equal(comfort.getState().mode, 'standing');
  assert.deepEqual(activeProfile(comfort), HOLODECK_COMFORT_DEFAULTS);
  assert.deepEqual(comfort.getState().profiles.seated, seated);
  const restored = createHolodeckComfort({ storage });
  assert.deepEqual(restored.getState().profiles, { seated, standing: HOLODECK_COMFORT_DEFAULTS });
});

test('switches remain usable with unavailable storage and retain both profiles for a later save', () => {
  let fail = true;
  const storage = memoryStorage(), write = storage.setItem;
  storage.setItem = (key, value) => { if (fail) throw new Error('quota'); write(key, value); };
  const comfort = createHolodeckComfort({ storage });
  comfort.setHeightOffset(0.5);
  comfort.setMode('standing');
  comfort.setHeightOffset(-0.1);
  comfort.setMode('seated');
  assert.equal(comfort.getState().heightOffset, 0.5);
  assert.equal(comfort.getState().profiles.standing.heightOffset, -0.1);
  assert.equal(storage.writes.length, 0);
  fail = false;
  assert.equal(comfort.flush(), true);
  assert.equal(storage.writes.length, 1);
  assert.deepEqual(createHolodeckComfort({ storage }).getState(), comfort.getState());
});

test('flat and vertical endpoints keep the front edge fixed and face keys towards the seated user', () => {
  const c = HOLODECK_CONSOLE;
  const rear = [0, c.top, c.center[2] - c.halfDepth];
  closeVector(consolePointToWorld(rear, 0), rear);
  closeVector(consolePointToWorld(rear, 90), [0, c.top + 2 * c.halfDepth, HOLODECK_KEYBOARD_HINGE[2]]);
  closeVector(consoleDirectionToWorld([0, 1, 0], 90), [0, 0, 1]);
  for (const angle of [0, 37, 90]) {
    closeVector(consolePointToWorld(HOLODECK_KEYBOARD_HINGE, angle), HOLODECK_KEYBOARD_HINGE);
    for (const dial of HOLODECK_KEYBOARD_DIALS) {
      assert.ok(Math.abs(dial.center[0]) > c.halfWidth);
      assert.equal(dial.radius, HOLODECK_KEYBOARD_DIAL_RADIUS);
      closeVector(consolePointToWorld(dial.center, angle), dial.center);
    }
  }
});

test('the rigid keyboard transform preserves distances and inverts arbitrary points and directions', () => {
  const points = [
    [-1.65, 0.82, -5.54], [1.65, 0.96, -4.7], [0.37, 0.962, -5.1], [0, 2.1, -1.8],
  ];
  const directions = [[0, -1, 0], [0, 0, -1], [0.2, -0.6, 0.7]];
  for (const angle of [0, 1, 37, 63.125, 89.9, 90]) {
    for (const point of points) {
      const transformed = consolePointToWorld(point, angle);
      closeVector(consolePointFromWorld(transformed, angle), point);
      const before = Math.hypot(...point.map((v, i) => v - HOLODECK_KEYBOARD_HINGE[i]));
      const after = Math.hypot(...transformed.map((v, i) => v - HOLODECK_KEYBOARD_HINGE[i]));
      assert.ok(Math.abs(before - after) < 1e-10);
    }
    for (const direction of directions) {
      closeVector(consoleDirectionFromWorld(consoleDirectionToWorld(direction, angle), angle), direction);
    }
  }
});

test('rays at every key centre retain the correct key coordinates and distance through arbitrary tilt', () => {
  const c = HOLODECK_CONSOLE;
  for (const angle of [0, 37, 90]) {
    for (const button of SCREEN_BUTTONS) {
      const u = button.x + button.w / 2, v = button.y + button.h / 2;
      const point = [
        -c.halfWidth + 0.10 + u * (2 * c.halfWidth - 0.20),
        c.top + 0.002,
        c.center[2] - c.halfDepth + 0.06 + v * (2 * c.halfDepth - 0.12),
      ];
      const target = consolePointToWorld(point, angle);
      const normal = consoleDirectionToWorld([0, 1, 0], angle);
      const origin = target.map((value, i) => value + normal[i] * 2);
      const direction = normal.map((value) => -value);
      const flatOrigin = consolePointFromWorld(origin, angle);
      const flatDirection = consoleDirectionFromWorld(direction, angle);
      const distance = (c.top + 0.002 - flatOrigin[1]) / flatDirection[1];
      const hit = flatOrigin.map((value, i) => value + flatDirection[i] * distance);
      closeVector(hit, point);
      assert.ok(Math.abs(distance - 2) < 1e-10);
      const hitU = (hit[0] + c.halfWidth - 0.10) / (2 * c.halfWidth - 0.20);
      const hitV = (hit[2] - (c.center[2] - c.halfDepth + 0.06)) / (2 * c.halfDepth - 0.12);
      const selected = SCREEN_BUTTONS.find((b) => hitU >= b.x && hitU <= b.x + b.w && hitV >= b.y && hitV <= b.y + b.h);
      assert.equal(selected?.id, button.id);
    }
  }
});
