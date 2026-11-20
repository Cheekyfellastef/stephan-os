// One spatial layout owns visible furniture and the matching walking obstacles.
export const HOLODECK_ROOM = Object.freeze({ halfWidth: 5, frontZ: -6, backZ: 3, height: 3.2 });
export const HOLODECK_TABLE = Object.freeze({
  center: Object.freeze([0, 0.82, -2.2]),
  halfWidth: 1.25, halfDepth: 0.72, bottom: 0.76, top: 0.88, bevel: 0.22,
});
// Physical furniture pieces shared by rendering, collision and movement limits.
// Light outlines are decoration and do not reduce the usable room volume.
export const HOLODECK_TABLE_SURFACE = Object.freeze({
  halfWidth: 1.18, halfDepth: 0.65, bevel: 0.20,
  bottom: HOLODECK_TABLE.top, top: HOLODECK_TABLE.top + 0.008,
});
export const HOLODECK_TABLE_BASE = Object.freeze({
  halfWidth: 0.68, halfDepth: 0.44, bevel: 0.20, bottom: 0.035, top: 0.13,
});
export const HOLODECK_CUBE = Object.freeze({ id: 'small', center: Object.freeze([0, 0.9166, -2.2]), size: 0.057 });
export const HOLODECK_CUBES = Object.freeze([
  HOLODECK_CUBE,
  Object.freeze({ id: 'large', center: Object.freeze([0.28, 0.9451, -2.2]), size: HOLODECK_CUBE.size * 2 }),
]);
export const HOLODECK_BODY_RADIUS = 0.28;
export const HOLODECK_DISPLAY = Object.freeze({ halfWidth: 3.8, bottom: 0.66, top: 3.02, z: -5.72 });
export const HOLODECK_CONSOLE = Object.freeze({
  center: Object.freeze([0, 0.94, -5.12]), halfWidth: 1.65, halfDepth: 0.42,
  bottom: 0.82, top: 0.96, bevel: 0.14,
});
export const HOLODECK_CONSOLE_TRAY = Object.freeze({
  halfWidth: HOLODECK_CONSOLE.halfWidth - 0.06,
  halfDepth: HOLODECK_CONSOLE.halfDepth - 0.02,
  bottom: HOLODECK_CONSOLE.top - 0.02, top: HOLODECK_CONSOLE.top + 0.003,
  mountOverlap: 0.035,
});
export const HOLODECK_KEYCAP_RISE_METRES = 0.034;
export const HOLODECK_CONSOLE_SUPPORTS = Object.freeze([-1, 1].flatMap(side => [
  Object.freeze({ center: Object.freeze([side * 1.3, 0.435, HOLODECK_CONSOLE.center[2]]),
    size: Object.freeze([0.18, 0.77, 0.76]), material: 'metal' }),
  Object.freeze({ center: Object.freeze([side * 1.3, 0.97, -5.72]),
    size: Object.freeze([0.18, 0.26, 0.56]), material: 'ceramic', attachment: 'display' }),
]));
export const HOLODECK_OBSTACLES = Object.freeze([
  Object.freeze({ id: 'table', minX: -HOLODECK_TABLE.halfWidth, maxX: HOLODECK_TABLE.halfWidth,
    minZ: HOLODECK_TABLE.center[2] - HOLODECK_TABLE.halfDepth,
    maxZ: HOLODECK_TABLE.center[2] + HOLODECK_TABLE.halfDepth }),
  Object.freeze({ id: 'console', minX: -HOLODECK_CONSOLE.halfWidth, maxX: HOLODECK_CONSOLE.halfWidth,
    minZ: HOLODECK_ROOM.frontZ, maxZ: HOLODECK_CONSOLE.center[2] + HOLODECK_CONSOLE.halfDepth }),
]);
