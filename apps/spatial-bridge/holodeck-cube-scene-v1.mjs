import { HOLODECK_CUBES } from './holodeck-layout-v1.mjs';
import { createHolodeckCubePhysics, cubeSolid, cubeSupportedBySolid, solidMotionLimit,
  add3, subtract3, scale3, length3 } from './holodeck-cube-physics-v1.mjs';

function supportedBodyIds(states,surfaces) {
  const resting=states.filter(state=>!state.heldBy&&state.sleeping
    &&length3(state.velocity)<0.07&&length3(state.angularVelocity)<0.15),supported=new Set();
  // Both live carry and cold-load migration use this contact graph before any
  // body is displaced or depenetrated against a changed furniture pose.
  for(let pass=0;pass<resting.length;pass++)for(const state of resting) {
    if(supported.has(state.id))continue;
    if(surfaces.some(surface=>cubeSupportedBySolid(state,surface))
      ||resting.some(base=>supported.has(base.id)&&cubeSupportedBySolid(state,cubeSolid(base))))supported.add(state.id);
  }
  return supported;
}

// One room owns both bodies. Preview and XR share this same instance.
export function createHolodeckCubeScene({ store = null, environmentSolids = () => [], furniture = null } = {}) {
  const bodies = new Map();
  let restoring = true;
  let carriedBodies = new Set();
  let environmentSource = typeof environmentSolids === 'function' ? environmentSolids : () => [];
  function readEnvironmentSolids() {
    const canonical=furniture?.comfortSolids?.()??[];
    try {
      const solids = environmentSource();
      const owners=new Set(canonical.map(solid=>solid.owner));
      return [...canonical,...(Array.isArray(solids)?solids:[]).filter(solid=>!solid.owner||!owners.has(solid.owner))];
    } catch {
      return canonical;
    }
  }
  function otherSolids(id) {
    const environment = readEnvironmentSolids();
    if (restoring) return environment;
    return [...environment, ...[...bodies].filter(([key]) => key !== id && !carriedBodies.has(key))
      .map(([, body]) => cubeSolid(body.getState()))];
  }
  for (const cube of HOLODECK_CUBES) bodies.set(cube.id,
    createHolodeckCubePhysics({ cube, extraSolids: () => otherSolids(cube.id),
      furnitureSource: () => furniture?.physicsShapes?.()??null }));
  const getStates = () => [...bodies.values()].map(body => body.getState());
  const saved = store?.load();
  let migrated=false;
  if (saved) {
    const original=saved.map(state=>({...state,size:HOLODECK_CUBES.find(cube=>cube.id===state.id)?.size}));
    const placements=new Map(original.map(state=>[state.id,state])),claimed=new Set();
    for(const {id,from,to} of furniture?.getRestoreMotions?.()??[]) {
      const delta=subtract3(to,from);
      for(const key of supportedBodyIds(original,furniture.solids(id,from)))if(!claimed.has(key)) {
        const state=placements.get(key);
        placements.set(key,{...state,position:add3(state.position,delta)});
        claimed.add(key);migrated=true;
      }
    }
    for(const state of placements.values())bodies.get(state.id)?.restore(state);
  }
  restoring = false;
  function withCarried(ids,operation) {
    carriedBodies=ids;
    try{return operation();}finally{carriedBodies=new Set();}
  }
  furniture?.observeMotion?.({
    constrain({id,from,to}) {
      const states=getStates(),assembly=furniture.solids(id,from);
      const supported=supportedBodyIds(states,assembly),delta=subtract3(to,from);
      const stationary=[...states.filter(state=>!supported.has(state.id)).map(cubeSolid),
        ...furniture.motionSolids(id==='table'?'keyboard':'table'),
        ...readEnvironmentSolids().filter(solid=>solid.owner!==id)];
      const moving=[...furniture.motionSolids(id,from),...states.filter(state=>supported.has(state.id)).map(cubeSolid)];
      const fraction=withCarried(supported,()=>Math.min(solidMotionLimit(moving,stationary,delta),
        ...[...supported].map(key=>bodies.get(key).supportMotionLimit(delta,id))));
      return add3(from,scale3(delta,fraction));
    },
    moved({id,from,to}) {
      const delta=subtract3(to,from),supported=supportedBodyIds(getStates(),furniture.solids(id,from));
      withCarried(supported,()=>{
        for(const key of supported)bodies.get(key).moveSupported(delta,id);
      });
    },
    // The preview can be asleep while a DOM nudge moves a resting table. Save
    // its cargo at the same release/nudge boundary, never on each held frame.
    flushed(){checkpoint(0,true);},
  });
  const snapshot = () => getStates().map(({id,position,orientation,velocity,angularVelocity,sleeping,heldBy}) =>
    ({id,position,orientation,velocity,angularVelocity,sleeping:sleeping && !heldBy}));
  // A migrated pose is unsaved even though it is already the current snapshot.
  // The furniture flush must persist it before a later reload loses the delta.
  let lastSnapshot = JSON.stringify(migrated?saved:snapshot()), lastSaveTime = -Infinity;
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
  function setEnvironmentSolids(next) {
    environmentSource = typeof next === 'function' ? next : () => [];
    for (const body of bodies.values()) body.restore(body.getState());
    return readEnvironmentSolids().length;
  }
  function stop() {
    for (const body of bodies.values()) if (body.getState().heldBy) body.release();
    accumulator = 0;
    checkpoint(0, true);
  }
  return { getStates, getBody: id => bodies.get(id), advance, checkpoint, setEnvironmentSolids, stop };
}
