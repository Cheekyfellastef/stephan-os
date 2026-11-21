import { HOLODECK_TABLE, HOLODECK_TABLE_SURFACE, HOLODECK_TABLE_BASE,
  HOLODECK_CONSOLE, HOLODECK_CONSOLE_TRAY, HOLODECK_CONSOLE_SUPPORTS,
  HOLODECK_KEYCAP_RISE_METRES, HOLODECK_ROOM } from './holodeck-layout-v1.mjs';
import { HOLODECK_KEYBOARD_HINGE, HOLODECK_KEYBOARD_DIALS, createHolodeckComfortSolids } from './holodeck-comfort-v1.mjs';
import { trackedPose, cubeTargeted } from './holodeck-cube-interaction-v1.mjs';
import { rotate3, subtract3, add3, scale3, createTableSolids, createConsoleSolids, solidMotionLimit, boxSolid } from './holodeck-cube-physics-v1.mjs';

// Scene furniture is persistent *simulation* state. Mass is a damped visual and
// controller response, not a claim that virtual furniture can support a person.
export const SPATIAL_FURNITURE_STORAGE_KEY = 'stephanos.spatial.furniture.v1';
export const FURNITURE_MATERIALS = Object.freeze({
  table: Object.freeze({ material: 'moulded-plastic', massKg: 10, settleSeconds: 0.31 }),
  keyboard: Object.freeze({ material: 'moulded-plastic', massKg: 3.8, settleSeconds: 0.17 }),
});
const targets = Object.freeze(['table', 'keyboard']);
const frozenBounds = axes => Object.freeze(axes.map(axis => Object.freeze(axis)));
const c=HOLODECK_CONSOLE, t=HOLODECK_TABLE;
const supportExtents=axis=>HOLODECK_CONSOLE_SUPPORTS.flatMap(part=>[
  part.center[axis]-part.size[axis]/2,part.center[axis]+part.size[axis]/2,
]);
// Reserve the actual full hinge sweep, not a preferred operator pose. The tray
// reaches its highest point slightly before 90 degrees; the dials stay centred
// on the hinge. These room extents also contain the raised keycaps.
const trayReach=HOLODECK_KEYBOARD_HINGE[2]-(c.center[2]-HOLODECK_CONSOLE_TRAY.halfDepth);
const trayHigh=HOLODECK_KEYBOARD_HINGE[1]+Math.hypot(trayReach,
  HOLODECK_CONSOLE_TRAY.top-HOLODECK_KEYBOARD_HINGE[1]);
const keyboardExtents=frozenBounds([
  [Math.min(...supportExtents(0),...HOLODECK_KEYBOARD_DIALS.map(d=>d.center[0]-d.halfDepth)),
    Math.max(...supportExtents(0),...HOLODECK_KEYBOARD_DIALS.map(d=>d.center[0]+d.halfDepth))],
  [Math.min(c.bottom,...supportExtents(1),...HOLODECK_KEYBOARD_DIALS.map(d=>d.center[1]-d.radius)),
    Math.max(trayHigh,...supportExtents(1),...HOLODECK_KEYBOARD_DIALS.map(d=>d.center[1]+d.radius))],
  [Math.min(...supportExtents(2),c.center[2]-c.halfDepth,
    HOLODECK_KEYBOARD_HINGE[2]-Math.hypot(trayReach,c.top-HOLODECK_CONSOLE_TRAY.bottom)),
    Math.max(...supportExtents(2),...HOLODECK_KEYBOARD_DIALS.map(d=>d.center[2]+d.radius))],
]);
export const FURNITURE_PHYSICAL_EXTENTS=Object.freeze({
  table:frozenBounds([[t.center[0]-t.halfWidth,t.center[0]+t.halfWidth],
    [HOLODECK_TABLE_BASE.bottom,HOLODECK_TABLE_SURFACE.top],
    [t.center[2]-t.halfDepth,t.center[2]+t.halfDepth]]),
  keyboard:keyboardExtents,
});
const roomExtents=[[-HOLODECK_ROOM.halfWidth,HOLODECK_ROOM.halfWidth],
  [0,HOLODECK_ROOM.height],[HOLODECK_ROOM.frontZ,HOLODECK_ROOM.backZ]];
export const FURNITURE_MOVEMENT_BOUNDS=Object.freeze(Object.fromEntries(targets.map(id=>[
  id,frozenBounds(FURNITURE_PHYSICAL_EXTENTS[id].map(([min,max],axis)=>[
    roomExtents[axis][0]-min,roomExtents[axis][1]-max,
  ])),
])));
const initial = () => ({ table: [0,0,0], keyboard: [0,0,0] });
const finite = array => Array.isArray(array) && array.length === 3 && array.every(Number.isFinite);
const clamp = (value, [min,max]) => Math.max(min,Math.min(max,value));
const bounded = (id, coords) => coords.map((value,axis) => clamp(value,FURNITURE_MOVEMENT_BOUNDS[id][axis]));
const sum = (a,b) => a.map((v,i)=>v+b[i]);
const place = (original,offset) => ({...original,center:sum(original.center,offset),
  ...(Number.isFinite(original.top)?{top:original.top+offset[1]}:{}),
  ...(Number.isFinite(original.bottom)?{bottom:original.bottom+offset[1]}:{})});
const originShape = id=>id==='table'?HOLODECK_TABLE:HOLODECK_CONSOLE;

export function furnitureObstacles(state) {
  return targets.map(id=>{
    const extents=FURNITURE_PHYSICAL_EXTENTS[id],offset=state[id];
    return {id:'furniture:'+id,...Object.fromEntries(['X','Y','Z'].flatMap((axis,i)=>[
      ['min'+axis,extents[i][0]+offset[i]],['max'+axis,extents[i][1]+offset[i]],
    ]))};
  });
}

export function createHolodeckFurniture({storage,comfort=null,onChange=()=>{},onStatus=()=>{}}={}) {
  // Privacy-restricted browsers may throw on access to localStorage itself.
  // Furniture stays usable in memory; no grant or session state is persisted.
  let preferenceStorage;
  try{preferenceStorage=storage===undefined?globalThis.localStorage:storage;}catch{}
  let offsets=initial(),dirty=false;
  let restoreMotions=[];
  const motionObservers=new Set();
  try {
    const value=preferenceStorage?.getItem(SPATIAL_FURNITURE_STORAGE_KEY);
    if(value) {
      const decoded=JSON.parse(value);
      if(decoded?.version===1 && decoded.offsets && typeof decoded.offsets==='object') {
        // Old releases admitted below-floor offsets. Migrate each finite pose
        // independently; one bad item must not erase the other saved position.
        for(const id of targets) if(finite(decoded.offsets[id])) {
          offsets[id]=bounded(id,decoded.offsets[id]);
          if(offsets[id].some((value,axis)=>value!==decoded.offsets[id][axis])) {
            dirty=true;restoreMotions.push({id,from:[...decoded.offsets[id]],to:[...offsets[id]]});
          }
        }
      }
    }
  }catch{onStatus('Furniture positions are session-only on this browser.');}
  if(!preferenceStorage)onStatus('Furniture positions are session-only on this browser.');
  const getState=()=>({table:[...offsets.table],keyboard:[...offsets.keyboard]});
  const getOffset=id=>targets.includes(id)?[...offsets[id]]:[0,0,0];
  const getRestoreMotions=()=>restoreMotions.map(({id,from,to})=>({id,from:[...from],to:[...to]}));
  const comfortSolids=(offset=offsets.keyboard)=>createHolodeckComfortSolids({
    keyboardTilt:comfort?.getState().keyboardTilt??0,furnitureOffset:offset,
  });
  const solids=(id,offset=offsets[id])=>id==='table'?createTableSolids(place(HOLODECK_TABLE,offset)):
    id==='keyboard'?[...createConsoleSolids(place(HOLODECK_CONSOLE,offset)),
      ...comfortSolids(offset).filter(solid=>solid.owner==='keyboard')]:[];
  const motionSolids=(id,offset=offsets[id])=>id!=='keyboard'?solids(id,offset):[
    ...createConsoleSolids(place(HOLODECK_CONSOLE,offset)),
    // Reserve the analytic full tray/keycap hinge envelope in both directions.
    // Actual cube contact/support still uses the rendered current tray angle.
    boxSolid(add3([-HOLODECK_CONSOLE_TRAY.halfWidth,HOLODECK_CONSOLE_TRAY.bottom,
      HOLODECK_KEYBOARD_HINGE[2]-Math.hypot(trayReach,c.top-HOLODECK_CONSOLE_TRAY.bottom)],offset),
    add3([HOLODECK_CONSOLE_TRAY.halfWidth,trayHigh,
      HOLODECK_KEYBOARD_HINGE[2]+Math.max(HOLODECK_CONSOLE_TRAY.top-c.top,HOLODECK_KEYCAP_RISE_METRES)],offset),{owner:'keyboard'}),
    ...HOLODECK_KEYBOARD_DIALS.map(dial=>{
      const side=Math.sign(dial.center[0]),inner=side*(HOLODECK_CONSOLE_TRAY.halfWidth-HOLODECK_CONSOLE_TRAY.mountOverlap);
      const outer=dial.center[0]+side*dial.halfDepth;
      // The visible short mount lies inside its dial's radial hinge envelope.
      return boxSolid(add3([Math.min(inner,outer),dial.center[1]-dial.radius,dial.center[2]-dial.radius],offset),
        add3([Math.max(inner,outer),dial.center[1]+dial.radius,dial.center[2]+dial.radius],offset),{owner:'keyboard'});
    }),
  ];
  function setOffset(id,value,{save=false}={}) {
    if(!targets.includes(id)||!finite(value))return getState();
    const from=getOffset(id);
    let next=bounded(id,value);
    let boundary=next.some((v,i)=>Math.abs(v-value[i])>1e-9)?'Movement limited by a room wall, floor or ceiling.':'';
    const delta=subtract3(next,from),fraction=solidMotionLimit(motionSolids(id,from),[
      ...motionSolids(id==='table'?'keyboard':'table'),...comfortSolids().filter(solid=>solid.owner==='display'),
    ],delta);
    if(fraction<1) {
      next=add3(from,scale3(delta,fraction));
      boundary='Movement stopped at another solid object.';
    }
    // Physics can shorten a proposed translation before either the furniture or
    // its supported bodies move. It never becomes a second furniture store.
    for(const observer of motionObservers) {
      if(!next.some((v,i)=>v!==from[i]))break;
      const limited=observer.constrain?.({id,from:[...from],to:[...next]});
      if(finite(limited)) {
        if(limited.some((v,i)=>Math.abs(v-next[i])>1e-9))boundary='Movement stopped: the furniture or a supported cube reached a solid surface.';
        next=bounded(id,limited);
      }
    }
    if(next.some((v,i)=>v!==offsets[id][i])) {
      offsets={...offsets,[id]:next};dirty=true;
      for(const observer of motionObservers) observer.moved?.({id,from:[...from],to:[...next]});
      onChange(getState());
    }
    if(save) {
      const saved=flush();
      // Only an explicit nudge/release-save reports a boundary; held-frame
      // updates must not flood live announcements or overwrite other feedback.
      if(boundary)onStatus(boundary+(saved?'':' Position is session-only until storage is available.'));
    }
    return getState();
  }
  function flush() {
    if(!dirty)return true;
    try {
      preferenceStorage.setItem(SPATIAL_FURNITURE_STORAGE_KEY,JSON.stringify({version:1,offsets}));
      dirty=false;
      for(const observer of motionObservers)observer.flushed?.();
      restoreMotions=[];
      onStatus('Furniture positions saved.');return true;
    }catch{onStatus('Furniture moved; position is session-only until storage is available.');return false;}
  }
  const reset=id=>setOffset(id,[0,0,0],{save:true});
  const nudge=(id,axis,amount)=>{
    if(!targets.includes(id)||![0,1,2].includes(axis)||!Number.isFinite(amount))return getState();
    const next=getOffset(id);next[axis]+=amount;
    return setOffset(id,next,{save:true});
  };
  const shape=id=>targets.includes(id)?place(originShape(id),offsets[id]):null;
  const obstacles=()=>furnitureObstacles(offsets);
  const physicsShapes=()=>({table:shape('table'),keyboard:shape('keyboard')});
  const observeMotion=observer=>{motionObservers.add(observer);return()=>motionObservers.delete(observer);};
  return {getState,getOffset,getRestoreMotions,setOffset,flush,reset,nudge,shape,solids,motionSolids,comfortSolids,obstacles,physicsShapes,observeMotion};
}

const pressed = button => button?.pressed===true||Number(button?.value)>0.55;
function aabbHit(origin,direction,bounds) {
  let enter=-Infinity,leave=Infinity;
  for(const [axis,min,max] of [[0,bounds.minX,bounds.maxX],[1,bounds.minY,bounds.maxY],[2,bounds.minZ,bounds.maxZ]]) {
    const speed=direction[axis];
    if(Math.abs(speed)<1e-7){if(origin[axis]<min||origin[axis]>max)return null;continue;}
    const t0=(min-origin[axis])/speed,t1=(max-origin[axis])/speed;
    enter=Math.max(enter,Math.min(t0,t1));leave=Math.min(leave,Math.max(t0,t1));
  }
  return leave>=Math.max(0,enter)&&enter<=3.5?Math.max(0,enter):null;
}
export function furnitureGrabTarget(origin,direction,furniture) {
  if(!finite(origin)||!finite(direction))return null;
  const matches=targets.flatMap(id=>{
    const s=furniture.shape(id),rim=id==='table'?0.14:0.18;
    const edge={
      minX:s.center[0]-s.halfWidth-0.035,maxX:s.center[0]+s.halfWidth+0.035,
      minY:s.top-rim,maxY:s.top+0.08,
      minZ:s.center[2]-s.halfDepth-0.055,maxZ:s.center[2]+s.halfDepth+0.055,
    };
    const distance=aabbHit(origin,direction,edge);
    return distance===null?[]:[{id,distance}];
  });
  return matches.sort((a,b)=>a.distance-b.distance)[0]??null;
}

// Direct Quest grip is allowed on the physical body, not only a narrow ray edge.
export function furnitureGripTarget(point,furniture) {
  if(!finite(point)||!furniture)return null;
  const matches=targets.flatMap(id=>{
    const s=furniture.shape(id);
    const min=[s.center[0]-s.halfWidth,s.bottom,s.center[2]-s.halfDepth];
    const max=[s.center[0]+s.halfWidth,s.top,s.center[2]+s.halfDepth];
    const gap=point.map((v,i)=>Math.max(min[i]-v,0,v-max[i]));
    const distance=Math.hypot(...gap);
    return distance<=0.19?[{id,distance,near:true}]:[];
  });
  return matches.sort((a,b)=>a.distance-b.distance)[0]??null;
}

// Physics-inspired bounded follower: heavy plastic furniture visibly lags a held
// controller and settles when released. Not an external-force/haptic simulation.
export function furnitureFollow(current,target,massKg,seconds) {
  if(!finite(current)||!finite(target)||!Number.isFinite(seconds)||seconds<=0)return finite(current)?[...current]:[0,0,0];
  const tau=0.085+Math.sqrt(Math.max(1,massKg))*0.065;
  const fraction=1-Math.exp(-Math.min(0.05,seconds)/tau);
  return current.map((value,i)=>value+(target[i]-value)*fraction);
}

export function createHolodeckFurnitureInteraction({furniture,cubeScene=null}={}) {
  const buttons=new Map(),ids=new WeakMap();let serial=0,hold=null,lastTime=null;
  const capturedSources=new Set();
  const isHolding=()=>Boolean(hold);
  function release(){if(hold){furniture?.flush();hold=null;}capturedSources.clear();}
  function stop(){release();buttons.clear();lastTime=null;}
  function update({time,frame,referenceSpace,pose,navigation,gamepads=[],visible=true,blockedSources=new Set()}={}) {
    if(!furniture)return capturedSources;
    const dt=lastTime===null?0:(time-lastTime)/1000;lastTime=time;
    if(!visible||!Number.isFinite(time)||dt<0||dt>0.25||!trackedPose(pose,navigation)){stop();return capturedSources;}
    const hands=[];
    for(const source of frame?.session?.inputSources??[]) {
      if(blockedSources.has(source)||source.targetRayMode!=='tracked-pointer'
        ||source.gamepad?.mapping!=='xr-standard'||source.gamepad.connected===false)continue;
      let grip,ray;
      try{
        grip=source.gripSpace?trackedPose(frame.getPose(source.gripSpace,referenceSpace),navigation):null;
        ray=trackedPose(frame.getPose(source.targetRaySpace,referenceSpace),navigation);
      }catch{}
      if(!ray||!grip)continue;
      if(!ids.has(source))ids.set(source,'quest:'+ ++serial);
      hands.push({id:ids.get(source),source,kind:'quest',grip,ray,down:pressed(source.gamepad.buttons?.[1])});
    }
    const head=trackedPose(pose,navigation);
    if(head)for(const pad of gamepads)if(pad?.mapping==='standard'&&pad.connected!==false&&pad.axes?.length>=4)
      hands.push({id:'xbox:'+pad.index+':'+(pad.id||''),kind:'xbox',ray:head,grip:head,
        down:pressed(pad.buttons?.[4]),axes:[pad.axes[0],pad.axes[1]]});
    const live=new Set(hands.map(x=>x.id));
    if(hold&&!live.has(hold.handId))release();
    for(const id of buttons.keys())if(!live.has(id))buttons.delete(id);
    for(const hand of hands) {
      const last=buttons.get(hand.id)??hand.down;
      const forward=rotate3([0,0,-1],hand.ray.orientation);
      const nearby=hand.kind==='quest'?furnitureGripTarget(hand.grip.position,furniture):null;
      const target=nearby??furnitureGrabTarget(hand.ray.position,forward,furniture);
      const cubeInWay=!nearby&&Boolean(target)&&(cubeScene?.getStates?.().some(cube=>{
        if(cube.heldBy||!cubeTargeted({kind:hand.kind,position:hand.grip.position,
          rayOrigin:hand.ray.position,forward},cube))return false;
        const delta=subtract3(cube.position,hand.ray.position);
        const along=delta.reduce((v,x,i)=>v+x*forward[i],0);
        return along>=0&&along<target.distance-0.02;
      })??false);
      if(!hold&&hand.down&&!last&&target&&!cubeInWay) {
        hold={id:target.id,handId:hand.id,source:hand.source??null,
          handStart:[...hand.grip.position],offsetStart:furniture.getOffset(target.id),
          target:furniture.getOffset(target.id)};
        if(hand.source)capturedSources.add(hand.source);
      }
      if(hold?.handId===hand.id) {
        if(!hand.down){release();}
        else {
          if(hand.kind==='quest') hold.target=add3(hold.offsetStart,
            subtract3(hand.grip.position,hold.handStart));
          else {
            // Xbox LB + walking stick carries furniture with the operator.
            // Do not apply the same stick a second time as furniture velocity.
            hold.target=add3(hold.offsetStart,subtract3(hand.grip.position,hold.handStart));
          }
          furniture.setOffset(hold.id,furnitureFollow(furniture.getOffset(hold.id),
            hold.target,FURNITURE_MATERIALS[hold.id].massKg,dt));
        }
      }
      buttons.set(hand.id,hand.down);
    }
    return new Set(capturedSources);
  }
  return {update,stop,isHolding,getHeldId:()=>hold?.id??null,getCapturedSources:()=>new Set(capturedSources)};
}
