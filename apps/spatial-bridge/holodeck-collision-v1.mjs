import { HOLODECK_ROOM, HOLODECK_OBSTACLES, HOLODECK_BODY_RADIUS } from './holodeck-layout-v1.mjs';

const EPSILON = 1e-7;
function boundedDelta(current, delta, min, max) {
  // Physical tracking can place the viewer outside. Never move their head for them.
  if (current < min) return Math.max(0, Math.min(delta, max - current));
  if (current > max) return Math.min(0, Math.max(delta, min - current));
  return Math.max(min, Math.min(max, current + delta)) - current;
}
const inside = (p, b) => p.x > b.minX + EPSILON && p.x < b.maxX - EPSILON
  && p.z > b.minZ + EPSILON && p.z < b.maxZ - EPSILON;

function sweep(p, d, b) {
  let enter = -Infinity, leave = Infinity;
  let normal = { x: 0, z: 0 };
  for (const [axis, min, max] of [['x', b.minX, b.maxX], ['z', b.minZ, b.maxZ]]) {
    if (Math.abs(d[axis]) < EPSILON) {
      if (p[axis] <= min || p[axis] >= max) return null;
      continue;
    }
    const a = (min - p[axis]) / d[axis], c = (max - p[axis]) / d[axis];
    const near = Math.min(a, c), far = Math.max(a, c);
    if (near > enter + EPSILON) {
      enter = near;
      normal = { x: 0, z: 0, [axis]: -Math.sign(d[axis]) };
    } else if (Math.abs(near - enter) <= EPSILON) normal[axis] = -Math.sign(d[axis]);
    leave = Math.min(leave, far);
  }
  return enter >= -EPSILON && enter <= 1 && leave > Math.max(0, enter) && enter <= leave
    ? { time: Math.max(0, enter), normal } : null;
}

export function createHolodeckDynamicObstacles(states = []) {
  if (!Array.isArray(states)) return [];
  const obstacles = [];
  for (const state of states) {
    const position = state?.position, size = state?.size;
    if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)
      || !Number.isFinite(size) || size <= 0) continue;
    const half = size * Math.sqrt(3) / 2;
    obstacles.push({
      id: `cube:${state.id ?? 'unknown'}`,
      minX: position[0] - half, maxX: position[0] + half,
      minZ: position[2] - half, maxZ: position[2] + half,
    });
  }
  return obstacles;
}

export function resolveHolodeckMovement(position, delta, {
  room = HOLODECK_ROOM, obstacles = HOLODECK_OBSTACLES, radius = HOLODECK_BODY_RADIUS,
} = {}) {
  const p = { x: position.x, z: position.z };
  if (![p.x, p.z, delta.x, delta.z, radius].every(Number.isFinite) || radius < 0) return { x: 0, z: 0 };
  let remaining = {
    x: boundedDelta(p.x, delta.x, -room.halfWidth + radius, room.halfWidth - radius),
    z: boundedDelta(p.z, delta.z, room.frontZ + radius, room.backZ - radius),
  };
  const expanded = obstacles.map(b => ({ minX: b.minX - radius, maxX: b.maxX + radius,
    minZ: b.minZ - radius, maxZ: b.maxZ + radius }));
  // The cube sits above the table. Remove contained footprints so physical
  // overlap recovery has one coherent nearest exit, even inside both objects.
  const boxes = expanded.filter((b, i) => !expanded.some((other, j) => j !== i
    && b.minX >= other.minX && b.maxX <= other.maxX && b.minZ >= other.minZ && b.maxZ <= other.maxZ
    && (j < i || b.minX > other.minX || b.maxX < other.maxX || b.minZ > other.minZ || b.maxZ < other.maxZ)));
  for (const b of boxes) {
    if (!inside(p, b)) continue;
    const faces = [
      { distance: p.x - b.minX, x: -1, z: 0 }, { distance: b.maxX - p.x, x: 1, z: 0 },
      { distance: p.z - b.minZ, x: 0, z: -1 }, { distance: b.maxZ - p.z, x: 0, z: 1 },
    ];
    const nearest = Math.min(...faces.map(f => f.distance));
    const exits = faces.filter(f => f.distance <= nearest + EPSILON);
    const exit = exits.sort((a, c) => (c.x * remaining.x + c.z * remaining.z)
      - (a.x * remaining.x + a.z * remaining.z))[0];
    const outward = Math.max(0, remaining.x * exit.x + remaining.z * exit.z);
    remaining = { x: exit.x * outward, z: exit.z * outward };
  }
  for (let pass = 0; pass < 3 && Math.hypot(remaining.x, remaining.z) > EPSILON; pass++) {
    let hit = null;
    for (const box of boxes) {
      if (inside(p, box)) continue; // only the explicit outward recovery above is permitted
      const candidate = sweep(p, remaining, box);
      if (candidate && (!hit || candidate.time < hit.time)) hit = candidate;
    }
    if (!hit) { p.x += remaining.x; p.z += remaining.z; break; }
    const stop = Math.max(0, hit.time - 0.0001 / Math.hypot(remaining.x, remaining.z));
    p.x += remaining.x * stop;
    p.z += remaining.z * stop;
    remaining.x *= 1 - stop;
    remaining.z *= 1 - stop;
    if (hit.normal.x) remaining.x = 0;
    if (hit.normal.z) remaining.z = 0;
  }
  return { x: p.x - position.x, z: p.z - position.z };
}
