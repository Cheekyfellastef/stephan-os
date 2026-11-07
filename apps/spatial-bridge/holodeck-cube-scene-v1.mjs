import { HOLODECK_CUBES } from './holodeck-layout-v1.mjs';
import { createHolodeckCubePhysics, rotate3 } from './holodeck-cube-physics-v1.mjs';

// One room owns both bodies. Preview and XR share this same instance.
export function createHolodeckCubeScene({ store = null } = {}) {
  const bodies = new Map();
  let restoring = true;
  function otherSolids(id) {
    if (restoring) return [];
    return [...bodies].filter(([key]) => key !== id).map(([, body]) => {
      const state = body.getState();
      return [[1,0,0],[0,1,0],[0,0,1]].flatMap(axis => [-1,1].map(sign => {
        const n = rotate3(axis.map(v => v * sign), state.orientation);
        return [n, n.reduce((sum,v,i) => sum + v * state.position[i], 0) + state.size / 2];
      }));
    });
  }
  for (const cube of HOLODECK_CUBES) bodies.set(cube.id,
    createHolodeckCubePhysics({ cube, extraSolids: () => otherSolids(cube.id) }));
  const getStates = () => [...bodies.values()].map(body => body.getState());
  const saved = store?.load();
  if (saved) for (const state of saved) bodies.get(state.id)?.restore(state);
  restoring = false;
  const snapshot = () => getStates().map(({id,position,orientation,velocity,angularVelocity,sleeping,heldBy}) =>
    ({id,position,orientation,velocity,angularVelocity,sleeping:sleeping && !heldBy}));
  let lastSnapshot = JSON.stringify(snapshot()), lastSaveTime = -Infinity;
  let accumulator = 0;
  function checkpoint(time = 0, force = false) {
    if (!store) return;
    const states = snapshot(), encoded = JSON.stringify(states);
    if (encoded === lastSnapshot || (!force && time - lastSaveTime < 400)) return;
    if (store.save(states)) { lastSnapshot = encoded; lastSaveTime = time; }
  }
  function advance(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return getStates();
    accumulator += Math.min(seconds, 0.1);
    // Step both bodies together so a moving support cannot tunnel past a stack.
    while (accumulator >= 1/120) {
      accumulator -= 1/120;
      for (const body of bodies.values()) body.advance(1/120);
    }
    return getStates();
  }
  function stop() {
    for (const body of bodies.values()) if (body.getState().heldBy) body.release();
    accumulator = 0;
    checkpoint(0, true);
  }
  return { getStates, getBody: id => bodies.get(id), advance, checkpoint, stop };
}
