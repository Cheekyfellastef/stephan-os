import test from 'node:test';
import assert from 'node:assert/strict';
import { createHolodeckComfort, HOLODECK_KEYBOARD_DIALS } from '../apps/spatial-bridge/holodeck-comfort-v1.mjs';
import { createHolodeckScreenInput, consoleHit, keyboardDialHit } from '../apps/spatial-bridge/holodeck-screen-input-v1.mjs';
import { SCREEN_BUTTONS, SCREEN_KEYS, DISPLAY_COMFORT_BUTTONS } from '../apps/spatial-bridge/holodeck-screen-v1.mjs';
import { KEYCAP_RISE_METRES } from '../apps/spatial-bridge/holodeck-keycaps-v1.mjs';
import { HOLODECK_CONSOLE, HOLODECK_DISPLAY } from '../apps/spatial-bridge/holodeck-layout-v1.mjs';
import { trackedPose, createHolodeckCubeInteraction } from '../apps/spatial-bridge/holodeck-cube-interaction-v1.mjs';
import { createHolodeckLocomotion, applyHolodeckLocomotionToView, sampleHolodeckControls } from '../apps/spatial-bridge/holodeck-locomotion-v1.mjs';
import { enterHolodeckBaseline } from '../apps/spatial-bridge/holodeck-baseline-v0.mjs';
import { createHolodeckRoomGeometry } from '../apps/spatial-bridge/holodeck-room-v1.mjs';

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const qx = (degrees) => [Math.sin(degrees * Math.PI / 360), 0, 0, Math.cos(degrees * Math.PI / 360)];
const poseAt = (position, q = [0, 0, 0, 1]) => ({ transform: {
  position: { x: position[0], y: position[1], z: position[2] },
  orientation: { x: q[0], y: q[1], z: q[2], w: q[3] },
} });
const buttons = () => Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
const normalize = vector => { const length = Math.hypot(...vector); return vector.map(value => value / length); };
const aim = direction => {
  const q = [direction[1], -direction[0], 0, 1 - direction[2]];
  const length = Math.hypot(...q);
  return q.map(value => value / length);
};

// Compute the expected key position independently of the production transform.
function keyTarget(button, degrees) {
  const c = HOLODECK_CONSOLE, a = degrees * Math.PI / 180;
  const x = -c.halfWidth + 0.10 + (button.x + button.w / 2) * (2 * c.halfWidth - 0.20);
  const z = c.center[2] - c.halfDepth + 0.06 + (button.y + button.h / 2) * (2 * c.halfDepth - 0.12);
  const front = c.center[2] + c.halfDepth;
  // Keys have raised caps; console actions stay on the lower touch plane.
  const rise = SCREEN_KEYS.some(key => key.id === button.id) ? KEYCAP_RISE_METRES : 0.002;
  return { point: [x, c.top + rise * Math.cos(a) - (z - front) * Math.sin(a),
    front + rise * Math.sin(a) + (z - front) * Math.cos(a)], normal: [0, Math.cos(a), Math.sin(a)] };
}

function harness(count = 1) {
  const writes = [], actions = [], appClicks = [];
  const saved = new Map();
  const comfort = createHolodeckComfort({ storage: {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => { saved.set(key, value); writes.push(JSON.parse(value)); },
  } });
  const screen = { comfort, hover() {}, action: id => actions.push(id), point(u, v, activate) {
    if (activate) appClicks.push({ u, v });
    return true;
  } };
  const input = createHolodeckScreenInput({ screen });
  const hands = Array.from({ length: count }, (_, i) => {
    const dial = HOLODECK_KEYBOARD_DIALS[i];
    const origin = dial.center.map((value, j) => value + (j === 2 ? 1 : 0));
    return { source: { handedness: dial.id, targetRayMode: 'tracked-pointer', targetRaySpace: {}, gripSpace: {},
      gamepad: { mapping: 'xr-standard', connected: true, axes: [0, 0, 0, 0], buttons: buttons() } },
    ray: poseAt(origin), grip: poseAt(origin) };
  });
  const sample = { time: 0, pose: poseAt([0, 1.2, 0]), navigation: { x: 0, y: 0, z: 0, yaw: 0 },
    referenceSpace: {}, gamepads: [], frame: { session: { inputSources: hands.map(hand => hand.source) }, getPose(space) {
      for (const hand of hands) {
        if (space === hand.source.targetRaySpace) return hand.ray;
        if (space === hand.source.gripSpace) return hand.grip;
      }
      return null;
    } } };
  function step(changes = {}) { sample.time += 16; return input.update({ ...sample, ...changes }); }
  function press(index, button, pressed) { hands[index].source.gamepad.buttons[button].pressed = pressed; }
  function wrist(index, degrees) {
    const p = hands[index].grip.transform.position;
    hands[index].grip = poseAt([p.x, p.y, p.z], qx(degrees));
  }
  return { comfort, screen, input, hands, sample, step, press, wrist, writes, actions, appClicks };
}

test('the same visible keys remain selectable across the full tilt range, with no rear-face clicks', () => {
  for (const degrees of [0, 17, 45, 73, 90]) {
    for (const button of [SCREEN_BUTTONS[0], SCREEN_BUTTONS.find(item => item.id === 'key:g'),
      SCREEN_BUTTONS.find(item => item.id === 'enter')]) {
      assert.ok(button);
      const { point, normal } = keyTarget(button, degrees);
      const origin = point.map((value, i) => value + normal[i] * 1.2);
      const hit = consoleHit(origin, normal.map(value => -value), degrees);
      assert.equal(hit?.id, button.id, `${button.id} at ${degrees} degrees`);
      close(hit.distance, 1.2);
      assert.equal(consoleHit(point.map((value, i) => value - normal[i] * 1.2), normal, degrees), null);
    }
  }
});

test('both large side knobs are ray targets and the nearer knob wins when the ray crosses both', () => {
  for (const [side, x, dx] of [['right', 5, -1], ['left', -5, 1]]) {
    const dial = HOLODECK_KEYBOARD_DIALS.find(item => item.id === side);
    const hit = keyboardDialHit([x, dial.center[1], dial.center[2]], [dx, 0, 0]);
    assert.equal(hit?.id, `dial:${side}`);
    close(hit.distance, 5 - Math.abs(dial.center[0]) - dial.hitRadius);
    assert.equal(keyboardDialHit([x, dial.center[1], dial.center[2]], [-dx, 0, 0]), null);
  }
  for (const direction of [[0, 0, 0], [NaN, 0, -1], [Infinity, 0, 0]]) {
    assert.equal(keyboardDialHit([0, 1, 0], direction), null);
  }
});

test('the forgiving dial target includes visible cylinder rims, not only its centre sphere', () => {
  for (const dial of HOLODECK_KEYBOARD_DIALS) {
    assert.ok(dial.hitRadius > Math.hypot(dial.radius, dial.halfDepth));
    for (const side of [-1, 1]) {
      // This is visibly inside the cylinder, but outside the old radius-.16 sphere.
      const origin = [dial.center[0] + side * 0.06, dial.center[1] + 0.15, dial.center[2] + 1];
      assert.equal(keyboardDialHit(origin, [0, 0, -1])?.id, `dial:${dial.id}`);
    }
  }
});

test('a dial requires fresh input and relative wrist rotation, with no jump or keyboard click on grab', () => {
  for (const button of [0, 1]) {
    const h = harness();
    h.comfort.setKeyboardTilt(25); h.comfort.flush(); h.wrist(0, 30);
    h.press(0, button, true); h.step();
    assert.equal(h.input.isAdjusting(), false, 'initial held input must be inert');
    h.press(0, button, false); h.step(); h.press(0, button, true); h.step();
    assert.equal(h.input.isAdjusting(), true);
    assert.deepEqual([...h.input.getCapturedSources()], [h.hands[0].source]);
    close(h.comfort.getState().keyboardTilt, 25);
    h.wrist(0, 57); h.step();
    close(h.comfort.getState().keyboardTilt, 52);
    h.hands[0].grip.transform.position.y += 0.4; h.step();
    close(h.comfort.getState().keyboardTilt, 52, 1e-6);
    h.press(0, button, false); h.step();
    assert.equal(h.input.isAdjusting(), false);
    assert.equal(h.input.getCapturedSources().size, 0);
    assert.deepEqual(h.actions, []); assert.deepEqual(h.appClicks, []);
    close(h.writes.at(-1).profiles[h.comfort.getState().mode].keyboardTilt, 52);
  }
});

test('a nearby grip can turn either knob without aiming the ray at it', () => {
  for (const side of [0, 1]) {
    const h = harness(2), hand = h.hands[side], dial = HOLODECK_KEYBOARD_DIALS[side];
    h.sample.frame.session.inputSources = [hand.source];
    hand.grip = poseAt(dial.center.map((value, i) => value + (i === 2 ? 0.04 : 0)), qx(20));
    hand.ray = poseAt([0, 2, 0], [0, 1, 0, 0]); // Point away from the console.
    h.step(); h.press(side, 1, true); h.step();
    assert.equal(h.input.isAdjusting(), true);
    close(h.comfort.getState().keyboardTilt, 0);
    h.wrist(side, 55); h.step(); close(h.comfort.getState().keyboardTilt, 35);
    assert.deepEqual([...h.input.getCapturedSources()], [hand.source]);
    h.press(side, 1, false); h.step();
    assert.equal(h.input.isAdjusting(), false);
    assert.equal(h.actions.length + h.appClicks.length, 0);
  }
});

test('one hand owns the hinge until release and another held hand cannot silently take it over', () => {
  const h = harness(2); h.step();
  h.press(0, 0, true); h.press(1, 0, true); h.step();
  assert.deepEqual([...h.input.getCapturedSources()], [h.hands[0].source]);
  h.wrist(1, 70); h.step(); close(h.comfort.getState().keyboardTilt, 0);
  h.wrist(0, 30); h.step(); close(h.comfort.getState().keyboardTilt, 30);
  h.sample.frame.session.inputSources.reverse(); h.step();
  assert.deepEqual([...h.input.getCapturedSources()], [h.hands[0].source]);
  h.press(0, 0, false); h.step(); h.step();
  assert.equal(h.input.isAdjusting(), false);
  h.press(1, 0, false); h.step(); h.press(1, 0, true); h.step();
  assert.deepEqual([...h.input.getCapturedSources()], [h.hands[1].source]);
  close(h.comfort.getState().keyboardTilt, 30, 1e-6);
  h.wrist(1, 90); h.step(); close(h.comfort.getState().keyboardTilt, 50);
  assert.equal(h.actions.length + h.appClicks.length, 0);
});

test('knobs stop at flat and vertical, then immediately follow a reversed wrist movement', () => {
  const h = harness(); h.step(); h.press(0, 0, true); h.step();
  h.wrist(0, 120); h.step(); close(h.comfort.getState().keyboardTilt, 90);
  h.wrist(0, 110); h.step(); close(h.comfort.getState().keyboardTilt, 80);
  h.wrist(0, 0); h.step(); close(h.comfort.getState().keyboardTilt, 0);
  h.wrist(0, 10); h.step(); close(h.comfort.getState().keyboardTilt, 10);
});

for (const reason of ['hidden', 'head-tracking', 'ray-tracking', 'grip-tracking', 'disconnect', 'missing-source', 'frame-gap']) {
  test(`a dial releases and saves on ${reason}, without resuming from an already held button`, () => {
    const h = harness(); h.step(); h.press(0, 1, true); h.step();
    h.wrist(0, 35); h.step(); close(h.comfort.getState().keyboardTilt, 35);
    const hand = h.hands[0], ray = hand.ray, grip = hand.grip;
    let changes = {};
    if (reason === 'hidden') changes.visible = false;
    if (reason === 'head-tracking') changes.pose = null;
    if (reason === 'ray-tracking') hand.ray = null;
    if (reason === 'grip-tracking') hand.grip = null;
    if (reason === 'disconnect') hand.source.gamepad.connected = false;
    if (reason === 'missing-source') h.sample.frame.session.inputSources = [];
    if (reason === 'frame-gap') h.sample.time += 1000;
    h.step(changes);
    assert.equal(h.input.isAdjusting(), false);
    assert.equal(h.input.getCapturedSources().size, 0);
    assert.ok(h.writes.length > 0, 'release must persist the last real angle');
    close(h.writes.at(-1).profiles[h.comfort.getState().mode].keyboardTilt, 35);
    hand.ray = ray; hand.grip = grip; hand.source.gamepad.connected = true;
    h.sample.frame.session.inputSources = [hand.source]; h.step();
    assert.equal(h.input.isAdjusting(), false, 'tracking recovery cannot manufacture a fresh grip');
    h.press(0, 1, false); h.step(); h.press(0, 1, true); h.step();
    assert.equal(h.input.isAdjusting(), true);
    assert.equal(h.actions.length + h.appClicks.length, 0);
  });
}

test('changing seated/standing mode ends a drag without copying its angle into the other profile', () => {
  const h = harness();
  h.comfort.setMode('standing'); h.comfort.setKeyboardTilt(65); h.comfort.setHeightOffset(-0.1); h.comfort.flush();
  h.comfort.setMode('seated'); h.comfort.setHeightOffset(0.45); h.comfort.flush();
  h.step(); h.press(0, 0, true); h.step(); h.wrist(0, 25); h.step();
  close(h.comfort.getState().keyboardTilt, 25);
  h.comfort.setMode('standing'); h.step();
  assert.equal(h.input.isAdjusting(), false);
  close(h.comfort.getState().keyboardTilt, 65); close(h.comfort.getState().heightOffset, -0.1);
  h.wrist(0, 75); h.step(); close(h.comfort.getState().keyboardTilt, 65);
  h.comfort.setMode('seated'); h.step();
  close(h.comfort.getState().keyboardTilt, 25); close(h.comfort.getState().heightOffset, 0.45);
  assert.equal(h.input.isAdjusting(), false);
});

test('height offset is applied once to eyes and controller poses and switches with the active mode', () => {
  const h = harness();
  h.comfort.setMode('seated'); h.comfort.setHeightOffset(0.45);
  h.comfort.setMode('standing'); h.comfort.setHeightOffset(-0.1);
  const locomotion = createHolodeckLocomotion({ comfort: h.comfort });
  const neutral = sampleHolodeckControls();
  for (const [mode, height] of [['seated', 0.45], ['standing', -0.1]]) {
    h.comfort.setMode(mode);
    const rig = locomotion.update({ time: 16, pose: poseAt([0, 1.2, 0]), input: neutral });
    close(rig.y, height);
    const navigation = { ...rig, x: 0.3, z: -0.25, yaw: 0.7 };
    const worldEyes = [];
    for (const eyeX of [-0.032, 0.032]) {
      const trackedEye = poseAt([eyeX, 1.2, 0]);
      const eye = trackedPose(trackedEye, navigation);
      close(eye.position[1], 1.2 + height);
      const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -eyeX, -1.2, 0, 1]);
      const transformed = applyHolodeckLocomotionToView(view, navigation);
      for (let row = 0; row < 3; row++) {
        close(transformed[row] * eye.position[0] + transformed[4 + row] * eye.position[1]
          + transformed[8 + row] * eye.position[2] + transformed[12 + row], 0);
      }
      assert.equal(trackedEye.transform.position.y, 1.2, 'tracked pose must remain untouched');
      worldEyes.push(eye.position);
    }
    close(Math.hypot(...worldEyes[0].map((value, i) => value - worldEyes[1][i])), 0.064);
    close(trackedPose(poseAt([0.2, 0.7, -0.4]), navigation).position[1], 0.7 + height);
  }
});

test('recentring changes horizontal placement without losing or accumulating either mode height', () => {
  const h = harness();
  h.comfort.setMode('seated'); h.comfort.setHeightOffset(0.45);
  h.comfort.setMode('standing'); h.comfort.setHeightOffset(-0.1);
  const locomotion = createHolodeckLocomotion({ comfort: h.comfort });
  const head = poseAt([0.6, 1.2, 0.4], [0, Math.sin(0.2), 0, Math.cos(0.2)]);
  const input = { source: 'gamepad:0', label: 'Xbox', moveX: 0, moveY: 0, turn: 0, reset: false };
  let time = 0;
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const [mode, height] of [['seated', 0.45], ['standing', -0.1]]) {
      h.comfort.setMode(mode);
      locomotion.update({ time: time += 16, pose: head, input });
      const nav = locomotion.update({ time: time += 16, pose: head, input: { ...input, reset: true } });
      const world = trackedPose(head, nav);
      close(world.position[0], 0); close(world.position[2], 0);
      close(world.position[1], 1.2 + height); close(nav.y, height);
      close(h.comfort.getState().heightOffset, height);
    }
  }
});

test('capturing a knob suppresses the same grip in cube interaction until a new deliberate grip', () => {
  const h = harness(), dial = HOLODECK_KEYBOARD_DIALS[0];
  h.hands[0].grip = poseAt(dial.center);
  let grabs = 0;
  let cube = { id: 'small', position: [...dial.center], orientation: [0, 0, 0, 1], size: 0.057,
    heldBy: null, sleeping: true };
  const physics = { getState: () => ({ ...cube }), advance: () => ({ ...cube }),
    grab(id) { grabs++; cube.heldBy = id; }, release() { cube.heldBy = null; },
    moveHeld(position, orientation) { cube = { ...cube, position, orientation }; return { ...cube }; }, reset() {} };
  const cubes = createHolodeckCubeInteraction({ physics });
  const step = () => {
    h.step();
    cubes.update({ ...h.sample, blockedSources: h.input.getCapturedSources() });
  };
  step(); h.press(0, 1, true); step(); h.wrist(0, 20); step();
  assert.equal(h.input.isAdjusting(), true); assert.equal(grabs, 0);
  h.press(0, 1, false); step();
  assert.equal(h.input.isAdjusting(), false); assert.equal(grabs, 0);
  // Isolate the cube adapter's rearm behavior after the UI releases ownership.
  h.press(0, 1, true); h.sample.time += 16;
  cubes.update({ ...h.sample, blockedSources: new Set() });
  assert.equal(grabs, 1);
});

test('Xbox gaze plus A can still select a tilted key while its sticks retain locomotion ownership', () => {
  for (const degrees of [0, 45, 90]) {
    const h = harness(0), button = SCREEN_BUTTONS.find(item => item.id === 'key:g');
    h.comfort.setKeyboardTilt(degrees);
    const { point, normal } = keyTarget(button, degrees);
    const origin = point.map((value, i) => value + normal[i] * 1.2);
    const direction = normalize(point.map((value, i) => value - origin[i]));
    h.sample.pose = poseAt(origin, aim(direction));
    const pad = { index: 0, id: 'Xbox test', mapping: 'standard', connected: true,
      axes: [0.4, -0.7, 0.6, 0], buttons: buttons() };
    h.sample.gamepads = [pad];
    const locomotionBefore = sampleHolodeckControls({ gamepads: [pad] });
    h.step(); pad.buttons[0].pressed = true; h.step(); h.step();
    assert.deepEqual(h.actions, [button.id]);
    assert.deepEqual(h.appClicks, []);
    assert.equal(h.input.isAdjusting(), false);
    assert.deepEqual(sampleHolodeckControls({ gamepads: [pad] }), locomotionBefore);
  }
});

test('a live height button applies one coherent eye, controller, and pointer transform per frame', async () => {
  const comfort = createHolodeckComfort({ storage: null });
  comfort.setHeightOffset(0.6);
  const button = SCREEN_BUTTONS.find(item => item.id === 'height-up');
  const { point } = keyTarget(button, 0);
  const trackedEye = [point[0], 1.2, -4];
  const worldEye = [trackedEye[0], 1.8, trackedEye[2]];
  const head = poseAt(trackedEye, aim(normalize(point.map((value, i) => value - worldEye[i]))));
  const pad = { index: 0, id: 'frame-consistency', mapping: 'standard', connected: true,
    axes: [0, 0, 0, 0], buttons: buttons() };
  let nextFrame, rendered;
  const callbacks = {};
  const session = { inputSources: [], visibilityState: 'visible', renderState: {},
    updateRenderState(state) { Object.assign(this.renderState, state); },
    requestReferenceSpace: async () => ({}),
    requestAnimationFrame(callback) { nextFrame = callback; },
    addEventListener(name, callback) { callbacks[name] = callback; },
    end: async () => callbacks.end?.(),
  };
  const actions = [];
  const screen = { comfort, hover() {}, point: () => false, action(id) {
    actions.push(id);
    if (id === 'height-up') comfort.setHeightOffset(comfort.getState().heightOffset + 0.01);
  } };
  const result = await enterHolodeckBaseline({ comfort, screen,
    navigatorRef: { xr: { requestSession: async () => session }, getGamepads: () => [pad] },
    canvas: { getContext: () => ({}) }, xrWebGLLayerCtor: class {},
    rendererFactory: () => ({ geometry: {}, dispose() {}, drawFrame(_frame, _space, data) {
      rendered = data; return { poseAvailable: true, viewCount: 2 };
    } }),
  });
  assert.equal(result.ok, true);
  const frame = { session, getViewerPose: () => head };
  nextFrame(16, frame);
  pad.buttons[0].pressed = true;
  nextFrame(32, frame);
  assert.deepEqual(actions, ['height-up']);
  close(comfort.getState().heightOffset, 0.61);
  close(rendered.navigation.y, 0.6, 1e-10);
  for (const pointer of rendered.cube.pointers) {
    close(pointer.origin[1], trackedPose(head, rendered.navigation).position[1]);
  }
  nextFrame(48, frame);
  close(rendered.navigation.y, 0.61);
  for (const pointer of rendered.cube.pointers) {
    close(pointer.origin[1], trackedPose(head, rendered.navigation).position[1]);
  }
  await session.end();
});

test('a profile button ends the input frame before another source can act on old-height samples', () => {
  const h = harness(2);
  h.comfort.setMode('standing'); h.comfort.setHeightOffset(-0.1); h.comfort.setKeyboardTilt(65);
  h.comfort.setMode('seated'); h.comfort.setHeightOffset(0.6);
  h.sample.navigation.y = 0.6;
  for (const [index, id] of ['mode-standing', 'comfort-reset'].entries()) {
    const button = DISPLAY_COMFORT_BUTTONS.find(item => item.id === id), d = HOLODECK_DISPLAY;
    const u = button.x + button.w / 2, v = button.y + button.h / 2;
    const point = [u * 2 * d.halfWidth - d.halfWidth, d.top - v * (d.top - d.bottom), d.z];
    const origin = [point[0], 1.2, 0], worldOrigin = [point[0], 1.8, 0];
    h.hands[index].ray = poseAt(origin, aim(normalize(point.map((value, i) => value - worldOrigin[i]))));
  }
  h.screen.action = id => {
    h.actions.push(id);
    if (id === 'mode-standing') h.comfort.setMode('standing');
    else if (id === 'comfort-reset') h.comfort.reset();
  };
  h.step(); h.press(0, 0, true); h.press(1, 0, true);
  assert.deepEqual(h.step(), [], 'old-profile pointers must not survive the switch');
  assert.deepEqual(h.actions, ['mode-standing']);
  assert.equal(h.comfort.getState().mode, 'standing');
  close(h.comfort.getState().heightOffset, -0.1);
  close(h.comfort.getState().keyboardTilt, 65);
  h.sample.navigation.y = -0.1;
  h.step();
  assert.deepEqual(h.actions, ['mode-standing'], 'already-held inputs cannot activate after mode change');
});

test('changing keyboard tilt does not render pointer targets calculated on the prior keyboard plane', () => {
  const h = harness(2);
  for (const [index, id] of ['key:g', 'tilt-up'].entries()) {
    const { point, normal } = keyTarget(SCREEN_BUTTONS.find(item => item.id === id), 0);
    const origin = point.map((value, i) => value + normal[i] * 1.2);
    h.hands[index].ray = poseAt(origin, aim(normal.map(value => -value)));
  }
  h.screen.action = id => {
    h.actions.push(id);
    if (id === 'tilt-up') h.comfort.setKeyboardTilt(h.comfort.getState().keyboardTilt + 1);
  };
  h.step(); h.press(1, 0, true);
  assert.deepEqual(h.step(), []);
  close(h.comfort.getState().keyboardTilt, 1);
  assert.deepEqual(h.actions, ['tilt-up']);
});

test('holding trigger or A over application content neither repeats clicks nor reads a missing repeat timer', () => {
  for (const kind of ['quest', 'xbox']) {
    const h = harness(kind === 'quest' ? 1 : 0);
    const origin = [0, 1.2, 0], point = [0, 1.9, HOLODECK_DISPLAY.z];
    const pose = poseAt(origin, aim(normalize(point.map((value, i) => value - origin[i]))));
    const pad = kind === 'quest' ? h.hands[0].source.gamepad : {
      index: 0, id: 'held-content', mapping: 'standard', connected: true,
      axes: [0, 0, 0, 0], buttons: buttons(),
    };
    if (kind === 'quest') h.hands[0].ray = pose;
    else { h.sample.pose = pose; h.sample.gamepads = [pad]; }
    pad.buttons[0].pressed = true;
    assert.doesNotThrow(() => h.step(), `${kind}: first held sample must be inert`);
    assert.equal(h.appClicks.length, 0);
    pad.buttons[0].pressed = false; h.step();
    pad.buttons[0].pressed = true; h.step();
    for (let i = 0; i < 40; i++) assert.doesNotThrow(() => h.step());
    assert.equal(h.appClicks.length, 1, `${kind}: only one deliberately pressed click`);
    assert.deepEqual(h.actions, []);
  }
});

test('pending height-button changes save when tracking or the input source disappears', () => {
  for (const loss of ['hidden', 'head-tracking', 'source-removed']) {
    const h = harness();
    const { point, normal } = keyTarget(SCREEN_BUTTONS.find(item => item.id === 'height-up'), 0);
    h.hands[0].ray = poseAt(point.map((value, i) => value + normal[i]), aim(normal.map(value => -value)));
    h.screen.action = id => {
      if (id === 'height-up') h.comfort.setHeightOffset(h.comfort.getState().heightOffset + 0.01);
    };
    h.step(); h.press(0, 0, true); h.step();
    close(h.comfort.getState().heightOffset, 0.01);
    assert.equal(h.writes.length, 0);
    if (loss === 'hidden') h.step({ visible: false });
    else if (loss === 'head-tracking') h.step({ pose: null });
    else { h.sample.frame.session.inputSources = []; h.step(); }
    assert.equal(h.writes.length, 1, loss);
    close(h.writes[0].profiles.seated.heightOffset, 0.01);
  }
});

test('upright comfort controls remain visible above the actual desk and tilted tray from the room entrance', () => {
  const subtract = (a, b) => a.map((value, i) => value - b[i]);
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // Independent segment/triangle test against the renderer's actual solid mesh.
  function blocked(origin, target, vertices) {
    const direction = subtract(target, origin);
    for (let i = 0; i < vertices.length; i += 9) {
      const a = Array.from(vertices.slice(i, i + 3));
      const edge1 = subtract(vertices.slice(i + 3, i + 6), a);
      const edge2 = subtract(vertices.slice(i + 6, i + 9), a);
      const p = cross(direction, edge2), determinant = dot(edge1, p);
      if (Math.abs(determinant) < 1e-8) continue;
      const offset = subtract(origin, a), u = dot(offset, p) / determinant;
      if (u < 0 || u > 1) continue;
      const q = cross(offset, edge1), v = dot(direction, q) / determinant;
      if (v < 0 || u + v > 1) continue;
      const distance = dot(edge2, q) / determinant;
      if (distance > 1e-6 && distance < 1 - 1e-6) return true;
    }
    return false;
  }
  for (const keyboardTilt of [0, 37, 90]) {
    const geometry = createHolodeckRoomGeometry({ keyboardTilt });
    for (const eyeHeight of [1.2, 1.7]) {
      for (const button of DISPLAY_COMFORT_BUTTONS) {
        const d = HOLODECK_DISPLAY;
        const u = button.x + button.w / 2, v = button.y + button.h / 2;
        const point = [u * 2 * d.halfWidth - d.halfWidth, d.top - v * (d.top - d.bottom), d.z];
        assert.equal(blocked([0, eyeHeight, 0], point, geometry.solidPositions), false,
          `${button.id} hidden at eye height ${eyeHeight}, keyboard ${keyboardTilt} degrees`);
      }
    }
  }
});
