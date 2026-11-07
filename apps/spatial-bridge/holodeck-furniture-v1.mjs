import { HOLODECK_TABLE, HOLODECK_CONSOLE, HOLODECK_ROOM } from './holodeck-layout-v1.mjs';
import { trackedPose, cubeTargeted } from './holodeck-cube-interaction-v1.mjs';
import { rotate3, subtract3, add3, scale3 } from './holodeck-cube-physics-v1.mjs';

// Scene furniture is persistent *simulation* state. Mass is a damped visual and
// controller response, not a claim that virtual furniture can support a person.
export const SPATIAL_FURNITURE_STORAGE_KEY = 'stephanos.spatial.furniture.v1';
export const FURNITURE_MATERIALS = Object.freeze({
  table: Object.freeze({ material: 'moulded-plastic', massKg: 10, settleSeconds: 0.31,
    bounds: Object.freeze([[-1.1,1.1],[-0.14,0.18],[-0.20,0.55]]) }),
  keyboard: Object.freeze({ material: 'moulded-plastic', massKg: 3.8, settleSeconds: 0.17,
    bounds: Object.freeze([[-1.15,1.15],[-0.20,0.32],[0,1.30]]) }),
});
const targets = Object.freeze(['table', 'keyboard']);
const initial = () => ({ table: [0,0,0], keyboard: [0,0,0] });
const finite = array => Array.isArray(array) && array.length === 3 && array.every(Number.isFinite);
const clamp = (value, [min,max]) => Math.max(min,Math.min(max,value));
const bounded = (id, coords) => coords.map((value,axis) => clamp(value,FURNITURE_MATERIALS[id].bounds[axis]));
const sum = (a,b) => a.map((v,i)=>v+b[i]);
const place = (original,offset) => ({...original,center:sum(original.center,offset)});
const sourceState = state => targets.every(id=>finite(state?.[id])
  && state[id].every((value,axis)=>value===clamp(value,FURNITURE_MATERIALS[id].bounds[axis])));
const boxAt = (shape,margin=0) => ({
  minX:shape.center[0]-shape.halfWidth-margin,maxX:shape.center[0]+shape.halfWidth+margin,
  minZ:shape.center[2]-shape.halfDepth-margin,maxZ:shape.center[2]+shape.halfDepth+margin,
});
const originShape = id=>id==='table'?HOLODECK_TABLE:HOLODECK_CONSOLE;

export function furnitureObstacles(state) {
  return targets.map(id=>{
    const shape=place(originShape(id),state[id]);
    const bounds=boxAt(shape,id==='keyboard'?0.20:0);
    return {id:'furniture:'+id,...bounds};
  });
}

export function createHolodeckFurniture({storage=globalThis.localStorage,onChange=()=>{},onStatus=()=>{}}={}) {
  let offsets=initial(),dirty=false;
  try {
    const value=storage?.getItem(SPATIAL_FURNITURE_STORAGE_KEY);
    if(value) {
      const decoded=JSON.parse(value);
      if(decoded?.version===1 && sourceState(decoded?.offsets)) offsets={
        table:[...decoded.offsets.table],keyboard:[...decoded.offsets.keyboard],
      };
    }
  }catch{onStatus('Furniture positions are session-only on this browser.');}
  const getState=()=>({table:[...offsets.table],keyboard:[...offsets.keyboard]});
  const getOffset=id=>targets.includes(id)?[...offsets[id]]:[0,0,0];
  function setOffset(id,value,{save=false}={}) {
    if(!targets.includes(id)||!finite(value))return getState();
    const next=bounded(id,value);
    if(next.some((v,i)=>v!==offsets[id][i])) {
      offsets={...offsets,[id]:next};dirty=true;
      onChange(getState());
    }
    if(save)flush();
    return getState();
  }
  function flush() {
    if(!dirty)return true;
    try {
      storage.setItem(SPATIAL_FURNITURE_STORAGE_KEY,JSON.stringify({version:1,offsets}));
      dirty=false;onStatus('Furniture positions saved.');return true;
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
  return {getState,getOffset,setOffset,flush,reset,nudge,shape,obstacles,physicsShapes};
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
      const target=furnitureGrabTarget(hand.ray.position,forward,furniture);
      const cubeInWay=cubeScene?.getStates?.().some(cube=>cubeTargeted({
        kind:hand.kind,position:hand.grip.position,rayOrigin:hand.ray.position,forward,
      },cube))??false;
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
            const dx=Number.isFinite(hand.axes?.[0])?hand.axes[0]:0,dy=Number.isFinite(hand.axes?.[1])?hand.axes[1]:0;
            hold.target=add3(hold.target,[dx*Math.min(dt,0.05)*0.65,0,dy*Math.min(dt,0.05)*0.65]);
          }
          furniture.setOffset(hold.id,furnitureFollow(furniture.getOffset(hold.id),
            hold.target,FURNITURE_MATERIALS[hold.id].massKg,dt));
        }
      }
      buttons.set(hand.id,hand.down);
    }
    return new Set(capturedSources);
  }
  return {update,stop,isHolding,getCapturedSources:()=>new Set(capturedSources)};
}
