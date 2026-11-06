// One spatial layout owns visible furniture and the matching walking obstacles.
export const HOLODECK_ROOM = Object.freeze({ halfWidth: 5, frontZ: -6, backZ: 3, height: 3.2 });
export const HOLODECK_TABLE = Object.freeze({
  center: Object.freeze([0, 0.82, -2.2]),
  halfWidth: 1.25, halfDepth: 0.72, bottom: 0.76, top: 0.88, bevel: 0.22,
});
export const HOLODECK_CUBE = Object.freeze({ center: Object.freeze([0, 1.25, -2.2]), size: 0.58 });
export const HOLODECK_BODY_RADIUS = 0.28;
export const HOLODECK_OBSTACLES = Object.freeze([
  Object.freeze({ id: 'table', minX: -HOLODECK_TABLE.halfWidth, maxX: HOLODECK_TABLE.halfWidth,
    minZ: HOLODECK_TABLE.center[2] - HOLODECK_TABLE.halfDepth,
    maxZ: HOLODECK_TABLE.center[2] + HOLODECK_TABLE.halfDepth }),
  Object.freeze({ id: 'idea-cube', minX: HOLODECK_CUBE.center[0] - HOLODECK_CUBE.size / 2,
    maxX: HOLODECK_CUBE.center[0] + HOLODECK_CUBE.size / 2,
    minZ: HOLODECK_CUBE.center[2] - HOLODECK_CUBE.size / 2,
    maxZ: HOLODECK_CUBE.center[2] + HOLODECK_CUBE.size / 2 }),
]);
