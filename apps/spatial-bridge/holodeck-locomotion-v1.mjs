// Controller motion changes only the rendered room, never the headset's tracking.
// XR thumbstick layout: https://immersive-web.github.io/webxr-gamepads-module/
import { resolveHolodeckMovement } from './holodeck-collision-v1.mjs';
import { HOLODECK_ROOM, HOLODECK_OBSTACLES } from './holodeck-layout-v1.mjs';
const DEAD_ZONE = 0.18;
const TURN_RADIANS_PER_SECOND = Math.PI / 2;
const SPEED = 1.2;
const MAX_FRAME_SECONDS = 0.05;
const TRACKING_GAP_MS = 250;

const axis = (value) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
const pressed = (button) => button?.pressed === true;

function movement(x, y) {
  x = axis(x);
  y = axis(y);
  const length = Math.hypot(x, y);
  if (length <= DEAD_ZONE) return { x: 0, y: 0 };
  const magnitude = (Math.min(1, length) - DEAD_ZONE) / (1 - DEAD_ZONE);
  return { x: x / length * magnitude, y: y / length * magnitude };
}

function controls(source, label, x, y, turn, reset) {
  const move = movement(x, y);
  return { source, label, moveX: move.x, moveY: move.y, turn: axis(turn), reset: Boolean(reset) };
}

const active = (input) => input && (input.moveX !== 0 || input.moveY !== 0
  || Math.abs(input.turn) > DEAD_ZONE || input.reset);

export function sampleHolodeckControls({ inputSources = [], gamepads = [], preferredSource = 'none' } = {}) {
  let left;
  let right;
  for (const source of inputSources) {
    const pad = source?.gamepad;
    if (source?.targetRayMode !== 'tracked-pointer' || pad?.mapping !== 'xr-standard'
      || pad.connected === false || pad.axes?.length < 4 || !pad.axes) continue;
    if (source.handedness === 'left') left ??= pad;
    if (source.handedness === 'right') right ??= pad;
  }
  const xr = left || right ? controls('xr', 'Quest / VR controllers',
    left?.axes[2], left?.axes[3], right?.axes[2], pressed(right?.buttons?.[3])) : null;

  const pads = [];
  for (const pad of gamepads) {
    // Xbox and compatible controllers use the browser's standard layout.
    // Never guess unknown mappings or treat tracked XR pads as Xbox pads.
    if (!pad || pad.connected === false || pad.mapping !== 'standard' || !pad.axes || pad.axes.length < 4) continue;
    pads.push(controls(`gamepad:${pad.index}`, 'Xbox / standard gamepad',
      pad.axes[0], pad.axes[1], pad.axes[2], pressed(pad.buttons?.[11])));
  }
  const gamepad = pads.find(active) ?? pads.find((pad) => pad.source === preferredSource) ?? pads[0];
  // An idle VR pair must not hide a connected Xbox controller. Only one device
  // drives locomotion per frame, so simultaneous inputs cannot double speed.
  const preferred = [xr, gamepad].find((input) => input?.source === preferredSource);
  return (active(xr) ? xr : active(gamepad) ? gamepad : preferred ?? xr ?? gamepad)
    ?? controls('none', 'No controller detected', 0, 0, 0, false);
}

function headPose(pose, previousYaw) {
  const p = pose?.transform?.position;
  const q = pose?.transform?.orientation;
  if (!p || !q || ![p.x, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite)) return null;
  const norm = Math.hypot(q.x, q.y, q.z, q.w);
  if (norm < 0.0001) return null;
  const x = q.x / norm, y = q.y / norm, z = q.z / norm, w = q.w / norm;
  const forwardX = -2 * (x * z + w * y);
  const forwardZ = -(1 - 2 * (x * x + y * y));
  const yaw = Math.hypot(forwardX, forwardZ) > 0.1
    ? Math.atan2(-forwardX, -forwardZ) : previousYaw;
  return { x: p.x, z: p.z, yaw };
}

function rotate(x, z, yaw) {
  return { x: Math.cos(yaw) * x + Math.sin(yaw) * z,
    z: -Math.sin(yaw) * x + Math.cos(yaw) * z };
}

export function createHolodeckLocomotion({ room = HOLODECK_ROOM, obstacles = HOLODECK_OBSTACLES, comfort } = {}) {
  const rig = { x: 0, y: 0, z: 0, yaw: 0 };
  let previousTime = null;
  let previousSource = 'none';
  let headYaw = 0;
  let armed = false;

  function update({ time, pose, input, visible = true }) {
    rig.y = comfort?.getState().heightOffset ?? 0;
    const head = headPose(pose, headYaw);
    const elapsed = previousTime === null ? 0 : time - previousTime;
    const validTime = Number.isFinite(time) && elapsed >= 0 && elapsed <= TRACKING_GAP_MS;
    const neutral = input.moveX === 0 && input.moveY === 0
      && Math.abs(input.turn) <= DEAD_ZONE && !input.reset;
    if (!visible || !head || !validTime || input.source === 'none') {
      previousTime = null;
      armed = false;
      previousSource = input.source;
      return { ...rig, controller: input.label, state: 'paused' };
    }
    previousTime = time;
    headYaw = head.yaw;
    if (input.source !== previousSource) {
      armed = false;
      previousSource = input.source;
    }
    if (!armed) {
      armed = neutral;
      return { ...rig, controller: input.label, state: armed ? 'ready' : 'release-sticks' };
    }
    if (input.reset) {
      rig.yaw = -headYaw;
      const headAtEntrance = rotate(head.x, head.z, rig.yaw);
      rig.x = -headAtEntrance.x;
      rig.z = -headAtEntrance.z;
      armed = false;
      return { ...rig, controller: input.label, state: 'release-sticks' };
    }
    const dt = Math.min(MAX_FRAME_SECONDS, elapsed / 1000);
    const turn = Math.abs(input.turn) <= DEAD_ZONE ? 0
      : Math.sign(input.turn) * (Math.abs(input.turn) - DEAD_ZONE) / (1 - DEAD_ZONE);
    if (turn !== 0) {
      const before = rotate(head.x, head.z, rig.yaw);
      rig.yaw -= turn * TURN_RADIANS_PER_SECOND * dt;
      rig.yaw = Math.atan2(Math.sin(rig.yaw), Math.cos(rig.yaw));
      const after = rotate(head.x, head.z, rig.yaw);
      // Turn about the current head position, including room-scale movement.
      rig.x += before.x - after.x;
      rig.z += before.z - after.z;
    }
    const direction = rotate(input.moveX, input.moveY, rig.yaw + headYaw);
    const tracked = rotate(head.x, head.z, rig.yaw);
    const travel = resolveHolodeckMovement({ x: rig.x + tracked.x, z: rig.z + tracked.z },
      { x: direction.x * SPEED * dt, z: direction.z * SPEED * dt }, { room, obstacles });
    rig.x += travel.x;
    rig.z += travel.z;
    return { ...rig, controller: input.label, state: 'ready' };
  }

  return { update };
}

// Column-major: world view = tracked eye view * inverse(virtual walking rig).
// Each eye retains its native tracked pose and stereo separation.
export function applyHolodeckLocomotionToView(view, rig, output = new Float32Array(16)) {
  const c = Math.cos(rig.yaw), s = Math.sin(rig.yaw);
  const tx = -c * rig.x + s * rig.z;
  const ty = -(rig.y ?? 0);
  const tz = -s * rig.x - c * rig.z;
  for (let row = 0; row < 4; row += 1) {
    output[row] = view[row] * c + view[8 + row] * s;
    output[4 + row] = view[4 + row];
    output[8 + row] = -view[row] * s + view[8 + row] * c;
    output[12 + row] = view[row] * tx + view[4 + row] * ty + view[8 + row] * tz + view[12 + row];
  }
  return output;
}
