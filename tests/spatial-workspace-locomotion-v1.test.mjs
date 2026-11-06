import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  sampleHolodeckControls,
  createHolodeckLocomotion,
  applyHolodeckLocomotionToView,
} from '../apps/spatial-bridge/holodeck-locomotion-v1.mjs';
import { enterHolodeckBaseline } from '../apps/spatial-bridge/holodeck-baseline-v0.mjs';

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const buttons = (index = -1) => Array.from({ length: 16 }, (_, i) => ({ pressed: i === index }));
const xbox = (axes = [0, 0, 0, 0], extra = {}) => ({
  mapping: 'standard', connected: true, index: 0, axes, buttons: buttons(), ...extra,
});
const quest = (handedness, axes = [0, 0, 0, 0], extra = {}) => ({
  handedness, targetRayMode: 'tracked-pointer',
  gamepad: { mapping: 'xr-standard', connected: true, axes, buttons: buttons(), ...extra },
});
const pose = (x = 0, z = 0, yaw = 0) => ({ transform: {
  position: { x, y: 1.7, z }, orientation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
} });
const input = (axes = [0, 0, 0, 0], extra = {}) => sampleHolodeckControls({ gamepads: [xbox(axes, extra)] });
const neutral = input();
function ready(head = pose()) {
  const locomotion = createHolodeckLocomotion();
  locomotion.update({ time: 0, pose: head, input: neutral });
  return locomotion;
}

test('Xbox and Quest stick layouts produce identical walking and smooth-turn commands', () => {
  const a = input([0.4, -0.8, 0.7, 0]);
  const b = sampleHolodeckControls({ inputSources: [
    quest('left', [0, 0, 0.4, -0.8]), quest('right', [0, 0, 0.7, 0]),
  ] });
  for (const field of ['moveX', 'moveY', 'turn', 'reset']) assert.equal(a[field], b[field]);
  assert.equal(input([0, 0, 0, 0], { buttons: buttons(11) }).reset, true);
  assert.equal(sampleHolodeckControls({ inputSources: [quest('right', [0, 0, 0, 0], { buttons: buttons(3) })] }).reset, true);
});

test('drift, absent devices, unsupported mappings and disconnected gamepads are ignored', () => {
  const drift = input([0.08, -0.08, 0.1, 0]);
  assert.equal(drift.moveX, 0);
  assert.equal(drift.moveY, 0);
  for (const pad of [null, xbox([], { connected: false }), xbox([1, 1, 1, 1], { mapping: '' }), xbox([1, 1])]) {
    assert.equal(sampleHolodeckControls({ gamepads: [pad] }).source, 'none');
  }
  assert.equal(sampleHolodeckControls({ inputSources: [quest('left', [1, 1])] }).source, 'none');
  const invalid = input([NaN, Infinity, NaN, 0]);
  assert.equal(invalid.moveX, 0);
  assert.equal(invalid.moveY, 0);
  assert.equal(invalid.turn, 0);
});

test('an idle Quest pair permits Xbox movement and retains its ownership while sticks are released', () => {
  const sources = [quest('left'), quest('right')];
  const moving = sampleHolodeckControls({ inputSources: sources, gamepads: [xbox([0, -1, 0, 0])] });
  assert.equal(moving.source, 'gamepad:0');
  const released = sampleHolodeckControls({ inputSources: sources, gamepads: [xbox()], preferredSource: moving.source });
  assert.equal(released.source, 'gamepad:0');
  const both = sampleHolodeckControls({ inputSources: [quest('left', [0, 0, 0, -1])], gamepads: [xbox([0, -1, 0, 0])] });
  assert.equal(both.source, 'xr');
  assert.equal(both.moveY, -1);
});

test('movement requires neutral sticks initially and after changing controller type', () => {
  const nav = createHolodeckLocomotion();
  const forward = input([0, -1, 0, 0]);
  assert.equal(nav.update({ time: 0, pose: pose(), input: forward }).state, 'release-sticks');
  close(nav.update({ time: 20, pose: pose(), input: forward }).z, 0);
  nav.update({ time: 40, pose: pose(), input: neutral });
  close(nav.update({ time: 60, pose: pose(), input: forward }).z, -0.024);
  const xr = sampleHolodeckControls({ inputSources: [quest('left', [0, 0, 0, -1])] });
  assert.equal(nav.update({ time: 80, pose: pose(), input: xr }).state, 'release-sticks');
});

test('walking is head-relative, level, analog and diagonal speed is bounded', () => {
  const forward = ready();
  close(forward.update({ time: 50, pose: pose(), input: input([0, -1, 0, 0]) }).z, -0.06);
  const diagonal = ready().update({ time: 50, pose: pose(), input: input([1, -1, 0, 0]) });
  close(Math.hypot(diagonal.x, diagonal.z), 0.06);
  const turned = ready(pose(0, 0, -Math.PI / 2));
  const right = turned.update({ time: 50, pose: pose(0, 0, -Math.PI / 2), input: input([0, -1, 0, 0]) });
  close(right.x, 0.06);
  close(right.z, 0);
  close(ready().update({ time: 50, pose: pose(), input: input([0, -0.59, 0, 0]) }).z, -0.03);
});

test('both devices turn smoothly each frame with analog speed and frame-rate independence', () => {
  for (const source of ['xbox', 'quest']) {
    for (const frameMs of [10, 20, 50]) {
      const sample = (turn) => source === 'xbox' ? input([0, 0, turn, 0])
        : sampleHolodeckControls({ inputSources: [quest('right', [0, 0, turn, 0])] });
      const nav = createHolodeckLocomotion();
      nav.update({ time: 0, pose: pose(), input: sample(0) });
      let state;
      for (let t = frameMs; t <= 1000; t += frameMs) state = nav.update({ time: t, pose: pose(), input: sample(0.59) });
      close(state.yaw, -Math.PI / 4);
    }
  }
  const nav = ready();
  const first = nav.update({ time: 20, pose: pose(), input: input([0, 0, 1, 0]) });
  const second = nav.update({ time: 40, pose: pose(), input: input([0, 0, 1, 0]) });
  close(first.yaw, -Math.PI / 100);
  close(second.yaw, -Math.PI / 50);
  close(nav.update({ time: 60, pose: pose(), input: input([0, 0, 0.1, 0]) }).yaw, second.yaw);
});

test('turning pivots about the tracked head rather than orbiting the room origin', () => {
  const head = pose(1.4, -0.8);
  const state = ready(head).update({ time: 50, pose: head, input: input([0, 0, 1, 0]) });
  close(state.x + Math.cos(state.yaw) * 1.4 + Math.sin(state.yaw) * -0.8, 1.4);
  close(state.z - Math.sin(state.yaw) * 1.4 + Math.cos(state.yaw) * -0.8, -0.8);
});

test('tracking loss, lost visibility, pauses and disconnects stop motion until neutral', () => {
  for (const stop of [
    { pose: null }, { visible: false }, { time: 1000 },
    { input: sampleHolodeckControls() },
  ]) {
    const nav = ready();
    const forward = input([0, -1, 0, 0]);
    const before = nav.update({ time: 20, pose: pose(), input: forward });
    const stopped = nav.update({ time: 40, pose: pose(), input: forward, ...stop });
    close(stopped.z, before.z);
    const held = nav.update({ time: 1020, pose: pose(), input: forward });
    close(held.z, before.z);
    assert.equal(held.state, 'release-sticks');
    nav.update({ time: 1040, pose: pose(), input: neutral });
    close(nav.update({ time: 1060, pose: pose(), input: forward }).z, before.z - 0.024);
  }
  close(ready().update({ time: 200, pose: pose(), input: input([0, -1, 0, 0]) }).z, -0.06);
});

test('stick travel stays in the chamber without snapping an out-of-bounds physical head', () => {
  const nav = createHolodeckLocomotion({ obstacles: [] });
  nav.update({ time: 0, pose: pose(), input: neutral });
  let state;
  for (let t = 50; t <= 20000; t += 50) state = nav.update({ time: t, pose: pose(), input: input([0, -1, 0, 0]) });
  close(state.z, -5.72);
  const outside = ready(pose(8, 0));
  close(outside.update({ time: 50, pose: pose(8, 0), input: input([1, 0, 0, 0]) }).x, 0);
  close(outside.update({ time: 100, pose: pose(8, 0), input: input([-1, 0, 0, 0]) }).x, -0.06);
});

test('right-stick press returns the tracked head to the entrance and requires release', () => {
  const head = pose(1, 2, 0.4);
  const nav = ready(head);
  const reset = nav.update({ time: 20, pose: head, input: input([0, 0, 0, 0], { buttons: buttons(11) }) });
  close(reset.yaw + 0.4, 0);
  close(reset.x + Math.cos(reset.yaw) + Math.sin(reset.yaw) * 2, 0);
  close(reset.z - Math.sin(reset.yaw) + Math.cos(reset.yaw) * 2, 0);
  assert.equal(reset.state, 'release-sticks');
});

test('virtual view transform preserves stereo eye spacing and tracked eye height', () => {
  const rig = { x: 1, z: -2, yaw: 0.7 };
  for (const eyeX of [-0.032, 0.032]) {
    const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -eyeX, -1.7, 0, 1]);
    const out = applyHolodeckLocomotionToView(view, rig);
    const worldEye = [rig.x + Math.cos(rig.yaw) * eyeX, 1.7, rig.z - Math.sin(rig.yaw) * eyeX, 1];
    for (let row = 0; row < 3; row++) {
      close(out[row] * worldEye[0] + out[4 + row] * worldEye[1]
        + out[8 + row] * worldEye[2] + out[12 + row], 0);
    }
    assert.equal(view[12], Math.fround(-eyeX));
  }
});

test('live frame adapter polls controllers, passes movement into stereo rendering, and stops on session end', async () => {
  const callbacks = {};
  const session = { inputSources: [], visibilityState: 'visible', renderState: {},
    updateRenderState(state) { Object.assign(this.renderState, state); },
    requestReferenceSpace: async () => ({}),
    addEventListener(name, callback) { callbacks[name] = callback; },
    requestAnimationFrame(callback) { callbacks.frame = callback; },
    end: async () => callbacks.end?.(),
  };
  let pad = xbox();
  let rendered;
  let disposed = false;
  const statuses = [];
  const result = await enterHolodeckBaseline({
    navigatorRef: { xr: { requestSession: async () => session }, getGamepads: () => [pad] },
    canvas: { getContext: () => ({}) }, xrWebGLLayerCtor: class {},
    rendererFactory: () => ({ geometry: {}, drawFrame: (_frame, _space, data) => {
      rendered = data; return { poseAvailable: Boolean(data.pose), viewCount: 2 };
    }, dispose() { disposed = true; } }),
    onLocomotionStatus: (status) => statuses.push(status),
  });
  assert.equal(result.ok, true);
  const frame = { session, getViewerPose: () => pose() };
  callbacks.frame(0, frame);
  pad = xbox([0, -1, 1, 0]);
  callbacks.frame(20, frame);
  assert.ok(rendered.navigation.z < 0);
  close(rendered.navigation.yaw, -Math.PI / 100);
  assert.equal(statuses[0].state, 'ready');
  const before = rendered;
  await session.end();
  callbacks.frame(40, frame);
  assert.equal(rendered, before);
  assert.equal(disposed, true);
  assert.equal(statuses.at(-1).state, 'ended');
});

test('entry explains smooth controls and the offline module graph includes locomotion', () => {
  const entry = readFileSync(new URL('../apps/spatial-bridge/quest-entry.html', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../apps/spatial-bridge/service-worker.js', import.meta.url), 'utf8');
  assert.match(entry, /right stick for smooth turning/);
  assert.match(entry, /onLocomotionStatus/);
  assert.match(worker, /'\.\/holodeck-locomotion-v1\.mjs'/);
});
