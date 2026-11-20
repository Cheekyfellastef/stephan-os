import { HOLODECK_CUBES, HOLODECK_ROOM } from './holodeck-layout-v1.mjs';

export const CUBE_STORAGE_KEY = 'stephanos.spatial-workspace.cubes.v1';
const vector = (v, length, limit) => Array.isArray(v) && v.length === length
  && v.every(n => Number.isFinite(n) && Math.abs(n) <= limit);

export function validateSavedCubes(value) {
  if (value?.version !== 1 || !Array.isArray(value.cubes) || value.cubes.length !== HOLODECK_CUBES.length) return null;
  const result = [];
  for (const definition of HOLODECK_CUBES) {
    const matches = value.cubes.filter(cube => cube?.id === definition.id);
    if (matches.length !== 1) return null;
    const cube = matches[0];
    if (!vector(cube.position, 3, 10) || !vector(cube.orientation, 4, 1.001)
      || Math.abs(Math.hypot(...cube.orientation) - 1) > 0.01
      || !vector(cube.velocity, 3, 8) || !vector(cube.angularVelocity, 3, 16)
      || typeof cube.sleeping !== 'boolean') return null;
    const [x,y,z] = cube.position;
    if (Math.abs(x) > HOLODECK_ROOM.halfWidth || y < 0 || y > HOLODECK_ROOM.height
      || z < HOLODECK_ROOM.frontZ || z > HOLODECK_ROOM.backZ) return null;
    // IDs and sizes come from the room definition; stored data cannot add bodies
    // or restore controller ownership. Resting bodies never resume stale motion.
    result.push({id:definition.id,position:[...cube.position],orientation:[...cube.orientation],
      velocity:cube.sleeping?[0,0,0]:[...cube.velocity],
      angularVelocity:cube.sleeping?[0,0,0]:[...cube.angularVelocity],sleeping:cube.sleeping});
  }
  return result;
}

export function createHolodeckCubeStore({ storage, onStatus = () => {} } = {}) {
  let expectedRaw = null, writable = true, loaded = false, lastStatus = '';
  function status(message) { if (message !== lastStatus) { lastStatus = message; onStatus(message); } }
  try { storage ??= globalThis.localStorage; } catch { writable = false; }
  if (!storage) writable = false;
  function load() {
    loaded = true;
    if (!writable) { status('Saving unavailable — cube positions will last only for this visit.'); return null; }
    try {
      expectedRaw = storage.getItem(CUBE_STORAGE_KEY);
      if (!expectedRaw) { status('Cube positions will save automatically on this device.'); return null; }
      let parsed;
      try { parsed = JSON.parse(expectedRaw); } catch { /* Invalid saved data uses the safe default layout. */ }
      if (parsed?.version && parsed.version !== 1) {
        writable = false; status('Saved room uses a newer version. Reload the updated workspace before moving cubes.'); return null;
      }
      const cubes = validateSavedCubes(parsed);
      status(cubes ? 'Saved cube positions restored on this device.' : 'Saved positions could not be restored. Cubes are back on the table.');
      return cubes;
    } catch { writable = false; status('Saving unavailable — cube positions will last only for this visit.'); return null; }
  }
  function save(cubes) {
    if (!loaded) load();
    if (!writable || !validateSavedCubes({version:1,cubes})) return false;
    try {
      if (storage.getItem(CUBE_STORAGE_KEY) !== expectedRaw) {
        writable = false;
        status('Cube positions changed in another window. Reopen this workspace to use the latest positions.');
        return false;
      }
      const raw = JSON.stringify({version:1,cubes});
      storage.setItem(CUBE_STORAGE_KEY, raw);
      expectedRaw = raw;
      status('Cube positions saved on this device.');
      return true;
    } catch { writable = false; status('Could not save cube positions. Keep this workspace open to avoid losing changes.'); return false; }
  }
  return {load, save};
}
