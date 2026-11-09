// One spatial layout owns visible furniture and the matching walking obstacles.
export const HOLODECK_ROOM = Object.freeze({ halfWidth: 5, frontZ: -6, backZ: 3, height: 3.2 });
export const HOLODECK_TABLE = Object.freeze({
  center: Object.freeze([0, 0.82, -2.2]),
  halfWidth: 1.25, halfDepth: 0.72, bottom: 0.76, top: 0.88, bevel: 0.22,
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
export const HOLODECK_OBSTACLES = Object.freeze([
  Object.freeze({ id: 'table', minX: -HOLODECK_TABLE.halfWidth, maxX: HOLODECK_TABLE.halfWidth,
    minZ: HOLODECK_TABLE.center[2] - HOLODECK_TABLE.halfDepth,
    maxZ: HOLODECK_TABLE.center[2] + HOLODECK_TABLE.halfDepth }),
  Object.freeze({ id: 'console', minX: -HOLODECK_CONSOLE.halfWidth, maxX: HOLODECK_CONSOLE.halfWidth,
    minZ: HOLODECK_ROOM.frontZ, maxZ: HOLODECK_CONSOLE.center[2] + HOLODECK_CONSOLE.halfDepth }),
]);
