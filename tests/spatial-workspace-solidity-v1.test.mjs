import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createHolodeckComfortSolids, consolePointToWorld, HOLODECK_KEYBOARD_DIALS,
} from '../apps/spatial-bridge/holodeck-comfort-v1.mjs';
import { createHolodeckCubePhysics } from '../apps/spatial-bridge/holodeck-cube-physics-v1.mjs';
import { createHolodeckCubeScene } from '../apps/spatial-bridge/holodeck-cube-scene-v1.mjs';
import {
  createHolodeckDynamicObstacles, resolveHolodeckMovement,
} from '../apps/spatial-bridge/holodeck-collision-v1.mjs';
import { createHolodeckLocomotion } from '../apps/spatial-bridge/holodeck-locomotion-v1.mjs';
import {
  HOLODECK_BODY_RADIUS, HOLODECK_CONSOLE, HOLODECK_CUBE, HOLODECK_DISPLAY,
} from '../apps/spatial-bridge/holodeck-layout-v1.mjs';

const close = (actual, expected, tolerance = 0.003) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

function projectile(start, velocity, solids, steps = 360) {
  const body = createHolodeckCubePhysics({ extraSolids: () => solids });
  body.grab('setup');
  body.moveHeld(start);
  body.release(velocity);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < steps; i += 1) {
    const state = body.advance(1/120);
    minX = Math.min(minX, state.position[0]); maxX = Math.max(maxX, state.position[0]);
    minZ = Math.min(minZ, state.position[2]); maxZ = Math.max(maxZ, state.position[2]);
  }
  return { state: body.getState(), minX, maxX, minZ, maxZ };
}

test('display, tilted keyboard and both visible dials are physical cube solids', () => {
  const solids = createHolodeckComfortSolids({ keyboardTilt: 90 });
  assert.equal(solids.length, 4);

  const displayShot = projectile([0, 2.2, -4.5], [0, 0, -8], solids);
  const displayFront = HOLODECK_DISPLAY.z + 0.02;
  assert.ok(displayShot.minZ >= displayFront + HOLODECK_CUBE.size / 2 - 0.003);

  const keyboardShot = projectile([0, 1.35, -4.2], [0, 0, -6], solids, 180);
  const keyboardFront = consolePointToWorld(
    [0, HOLODECK_CONSOLE.top + 0.003, HOLODECK_CONSOLE.center[2]], 90,
  )[2];
  assert.ok(keyboardShot.minZ >= keyboardFront + HOLODECK_CUBE.size / 2 - 0.004);

  const dial = HOLODECK_KEYBOARD_DIALS[0];
  const dialShot = projectile(
    [dial.center[0] - 0.6, dial.center[1], dial.center[2]], [6, 0, 0], solids, 120,
  );
  const dialLeft = dial.center[0] - dial.halfDepth;
  assert.ok(dialShot.maxX <= dialLeft - HOLODECK_CUBE.size / 2 + 0.004);
});

test('cube scene can adopt live environment solids without rebuilding its bodies', () => {
  const scene = createHolodeckCubeScene();
  const solids = createHolodeckComfortSolids({ keyboardTilt: 63 });
  assert.equal(scene.setEnvironmentSolids(() => solids), 4);
  assert.equal(scene.getStates().length, 2);
  assert.ok(scene.getStates().every((cube) => cube.position.every(Number.isFinite)));
});

test('every movable cube produces a conservative player obstacle at any orientation', () => {
  const states = [
    { id: 'small', position: [0, 0.9, -2], size: 0.057, orientation: [0,0,0,1] },
    { id: 'large', position: [1, 0.9, -3], size: 0.114, orientation: [0.3,0.2,0.1,0.9] },
    { id: 'bad', position: [NaN, 0, 0], size: 1 },
  ];
  const obstacles = createHolodeckDynamicObstacles(states);
  assert.equal(obstacles.length, 2);
  for (const obstacle of obstacles) {
    assert.ok(obstacle.maxX > obstacle.minX);
    assert.ok(obstacle.maxY > obstacle.minY);
    assert.ok(obstacle.maxZ > obstacle.minZ);
  }
  const cube = obstacles[0];
  const movement = resolveHolodeckMovement({ x: 0, z: 0 }, { x: 0, z: -5 }, { obstacles: [cube] });
  close(movement.z, cube.maxZ + HOLODECK_BODY_RADIUS);
});

test('controller locomotion composes static geometry with current cube obstacles', () => {
  const [cube] = createHolodeckDynamicObstacles([{ id:'large', position:[0,1,-1.8], size:0.114 }]);
  const nav = createHolodeckLocomotion({ obstacles: [] });
  const pose = { transform: {
    position: { x:0, y:1.25, z:0 }, orientation: { x:0, y:0, z:0, w:1 },
  } };
  const neutral = { source:'test', label:'test', moveX:0, moveY:0, turn:0, reset:false };
  const forward = { ...neutral, moveY:-1 };
  nav.update({ time:0, pose, input:neutral, dynamicObstacles:[cube] });
  let state;
  for (let time = 50; time <= 5000; time += 50)
    state = nav.update({ time, pose, input:forward, dynamicObstacles:[cube] });
  close(state.z, cube.maxZ + HOLODECK_BODY_RADIUS);
});

test('floor-relative locomotion ignores overhead cubes without weakening solid room geometry', () => {
  const [floorCube, overheadCube, unreachableCube] = [
    ['floor', 0.3], ['overhead', 2.9], ['unreachable', 50],
  ].map(([id, y]) => createHolodeckDynamicObstacles([
    { id, position:[0,y,-1.8], size:0.114 },
  ])[0]);
  const pose = { transform: {
    position: { x:0, y:1.25, z:0 }, orientation: { x:0, y:0, z:0, w:1 },
  } };
  const neutral = { source:'test', label:'test', moveX:0, moveY:0, turn:0, reset:false };
  const forward = { ...neutral, moveY:-1 };

  const travel = (obstacle, floorRelativeY = true) => {
    const nav = createHolodeckLocomotion({ obstacles: [], floorRelativeY });
    nav.update({ time:0, pose, input:neutral, dynamicObstacles:[obstacle] });
    let state;
    for (let time = 50; time <= 5000; time += 50)
      state = nav.update({ time, pose, input:forward, dynamicObstacles:[obstacle] });
    return state;
  };

  close(travel(floorCube).z, floorCube.maxZ + HOLODECK_BODY_RADIUS);
  close(travel(overheadCube).z, -5.72);
  close(travel(unreachableCube).z, -5.72);
  // Without a floor-relative reference, fail conservatively rather than guessing
  // body height from an arbitrary local-space Y value.
  close(travel(overheadCube, false).z, overheadCube.maxZ + HOLODECK_BODY_RADIUS);
});

test('direct collision filtering preserves static solids and rejects invalid body-span shortcuts', () => {
  const [overheadCube] = createHolodeckDynamicObstacles([
    { id:'overhead', position:[0,2.9,-2], size:0.114 },
  ]);
  const free = resolveHolodeckMovement({ x:0, z:0 }, { x:0, z:-5 }, {
    obstacles:[overheadCube], bodyBottomY:0, bodyTopY:1.37,
  });
  close(free.z, -5);
  const conservative = resolveHolodeckMovement({ x:0, z:0 }, { x:0, z:-5 }, {
    obstacles:[overheadCube], bodyBottomY:2, bodyTopY:1,
  });
  assert.ok(conservative.z > -5);
  const staticWall = { minX:-0.5, maxX:0.5, minZ:-2.1, maxZ:-1.9 };
  const staticBlocked = resolveHolodeckMovement({ x:0, z:0 }, { x:0, z:-5 }, {
    obstacles:[staticWall], bodyBottomY:0, bodyTopY:1.37,
  });
  assert.ok(staticBlocked.z > -5);
});

test('runtime and documentation retain the solid-by-default integration boundary', () => {
  const baseline = readFileSync(new URL('../apps/spatial-bridge/holodeck-baseline-v0.mjs', import.meta.url), 'utf8');
  const docs = readFileSync(new URL('../apps/spatial-bridge/SPATIAL-CONSOLE.md', import.meta.url), 'utf8');
  assert.match(baseline, /setEnvironmentSolids/);
  assert.match(baseline, /createHolodeckDynamicObstacles/);
  assert.match(baseline, /floorRelativeY:\s*referenceSpaceType === 'local-floor'/);
  assert.match(docs, /Solid-by-default room contract/i);
  assert.match(docs, /future physical room objects/i);
});
