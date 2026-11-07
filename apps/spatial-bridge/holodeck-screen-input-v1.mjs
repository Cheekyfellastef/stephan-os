import { HOLODECK_CONSOLE, HOLODECK_DISPLAY } from './holodeck-layout-v1.mjs';
import { SCREEN_BUTTONS, screenComfortHit } from './holodeck-screen-v1.mjs';
import { trackedPose } from './holodeck-cube-interaction-v1.mjs';
import { rotate3, multiplyQuaternion } from './holodeck-cube-physics-v1.mjs';
import { consolePointFromWorld, consoleDirectionFromWorld, HOLODECK_KEYBOARD_DIALS } from './holodeck-comfort-v1.mjs';

const down=button=>button?.pressed===true||button?.value>0.55;
const finiteVector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const repeatable=new Set(['height-down','height-up','tilt-down','tilt-up']);

export function consoleHit(origin,direction,tiltDegrees=0) {
  if(!finiteVector(origin)||!finiteVector(direction))return null;
  const c=HOLODECK_CONSOLE;
  origin=consolePointFromWorld(origin,tiltDegrees);
  direction=consoleDirectionFromWorld(direction,tiltDegrees);
  if(direction[1]>=-1e-5||origin[1]<c.top)return null;
  const distance=(c.top+0.002-origin[1])/direction[1];
  if(distance<=0||distance>8)return null;
  const x=origin[0]+distance*direction[0],z=origin[2]+distance*direction[2];
  const u=(x+c.halfWidth-0.10)/(2*c.halfWidth-0.20);
  const v=(z-(c.center[2]-c.halfDepth+0.06))/(2*c.halfDepth-0.12);
  const button=SCREEN_BUTTONS.find(b=>u>=b.x&&u<=b.x+b.w&&v>=b.y&&v<=b.y+b.h);
  return button?{id:button.id,distance}:null;
}

// Spherical targets work from the front even when rays are parallel to a dial's side face.
export function keyboardDialHit(origin,direction) {
  if(!finiteVector(origin)||!finiteVector(direction))return null;
  const a=direction.reduce((sum,v)=>sum+v*v,0);
  if(a<1e-8)return null;
  const hits=[];
  for(const dial of HOLODECK_KEYBOARD_DIALS) {
    const delta=origin.map((v,i)=>v-dial.center[i]);
    const b=delta.reduce((sum,v,i)=>sum+v*direction[i],0);
    const c=delta.reduce((sum,v)=>sum+v*v,0)-dial.hitRadius*dial.hitRadius;
    const discriminant=b*b-a*c;
    if(discriminant<0)continue;
    const near=(-b-Math.sqrt(discriminant))/a,far=(-b+Math.sqrt(discriminant))/a;
    const distance=near>0?near:far;
    if(distance>0&&distance<=8)hits.push({id:'dial:'+dial.id,distance,dial});
  }
  return hits.sort((a,b)=>a.distance-b.distance)[0]??null;
}

export function displayHit(origin,direction) {
  const d=HOLODECK_DISPLAY;if(direction[2]>=-1e-5||origin[2]<=d.z)return null;
  const distance=(d.z-origin[2])/direction[2];if(distance<=0||distance>12)return null;
  const x=origin[0]+distance*direction[0],y=origin[1]+distance*direction[1];
  const u=(x+d.halfWidth)/(2*d.halfWidth),v=(d.top-y)/(d.top-d.bottom);
  return u>=0&&u<=1&&v>=0&&v<=1?{u,v,distance}:null;
}

function pitchDelta(before,after) {
  const delta=multiplyQuaternion(after,[-before[0],-before[1],-before[2],before[3]]);
  // Twist about the same world hinge on both sides, with no grab-time jump.
  if(Math.hypot(delta[0],delta[3])<1e-6)return 0;
  const angle=2*Math.atan2(delta[0],delta[3]);
  return Math.atan2(Math.sin(angle),Math.cos(angle))*180/Math.PI;
}

export function createHolodeckScreenInput({screen,comfort=screen?.comfort}={}) {
  const previous=new Map(),ids=new WeakMap();let serial=0,grab=null,lastTime=null;
  let mode=comfort?.getState().mode;
  const capturedSources=new Set();
  function release(){if(grab)comfort?.flush();grab=null;capturedSources.clear();}
  function stop(){release();comfort?.flush();previous.clear();lastTime=null;screen?.hover(null);}
  function update({time,frame,referenceSpace,pose,navigation,gamepads=[],visible=true}) {
    const currentMode=comfort?.getState().mode;
    const initialTilt=comfort?.getState().keyboardTilt;
    const gap=Number.isFinite(time)&&lastTime!==null&&(time-lastTime>250||time<lastTime);
    if(!visible||!trackedPose(pose,navigation)||gap){stop();return [];}
    if(currentMode!==mode){stop();mode=currentMode;}
    if(Number.isFinite(time))lastTime=time;
    const samples=[];
    for(const source of frame?.session?.inputSources??[]) {
      if(source.targetRayMode!=='tracked-pointer'||source.gamepad?.mapping!=='xr-standard'||source.gamepad.connected===false)continue;
      let ray,grip;
      try {
        ray=trackedPose(frame.getPose(source.targetRaySpace,referenceSpace),navigation);
        if(source.gripSpace)grip=trackedPose(frame.getPose(source.gripSpace,referenceSpace),navigation);
      }catch{}
      if(!ray)continue;
      if(!ids.has(source))ids.set(source,'quest:'+(++serial));
      samples.push({id:ids.get(source),source,kind:'quest',ray,grip,
        pressed:down(source.gamepad.buttons?.[0]),gripping:down(source.gamepad.buttons?.[1])});
    }
    const head=trackedPose(pose,navigation);
    for(const pad of gamepads)if(pad?.mapping==='standard'&&pad.connected!==false&&pad.axes?.length>=4)
      samples.push({id:'xbox:'+pad.index+':'+(pad.id||''),kind:'xbox',ray:head,pressed:down(pad.buttons?.[0]),gripping:false});
    const live=new Set(samples.map(s=>s.id));
    if(grab&&!live.has(grab.id))release();
    for(const id of previous.keys())if(!live.has(id)){previous.delete(id);comfort?.flush();}
    const pointers=[];let hover=null;
    for(const sample of samples) {
      const direction=rotate3([0,0,-1],sample.ray.orientation);
      const keyboard=consoleHit(sample.ray.position,direction,comfort?.getState().keyboardTilt??0);
      const dial=comfort?keyboardDialHit(sample.ray.position,direction):null;
      const display=displayHit(sample.ray.position,direction);
      const displayControl=display&&comfort&&screenComfortHit(display.u,display.v);
      let nearDial=null;
      if(comfort&&sample.grip) {
        const nearest=HOLODECK_KEYBOARD_DIALS.find(d=>Math.hypot(...d.center.map((v,i)=>v-sample.grip.position[i]))<=d.radius+0.06);
        if(nearest)nearDial={id:'dial:'+nearest.id,dial:nearest,distance:Math.hypot(...nearest.center.map((v,i)=>v-sample.ray.position[i]))};
      }
      const hit=[keyboard,dial,displayControl?{...display,id:displayControl.id}:display]
        .filter(Boolean).sort((a,b)=>a.distance-b.distance)
        .find(target=>target.id||screen?.point(target.u,target.v));
      // First sample after tracking loss or connection never activates held input.
      const last=previous.get(sample.id)??{pressed:sample.pressed,gripping:sample.gripping};
      const pressedNow=sample.pressed&&!last.pressed,grippedNow=sample.gripping&&!last.gripping;
      let consumed=false;
      if(grab?.id===sample.id) {
        consumed=true;
        const held=grab.button==='grip'?sample.gripping:sample.pressed;
        const hand=grab.poseKind==='grip'?sample.grip:sample.ray;
        if(!held||!hand)release();
        else {
          comfort.setKeyboardTilt(comfort.getState().keyboardTilt+pitchDelta(grab.orientation,hand.orientation));
          grab.orientation=hand.orientation;hover=grab.target.id;
          pointers.push({origin:sample.ray.position,direction,distance:grab.target.distance,targeted:true,kind:sample.kind,controlId:grab.target.id});
        }
      } else if(!grab&&sample.kind==='quest'&&comfort) {
        const target=grippedNow?(nearDial??(hit?.dial?hit:null)):pressedNow&&hit?.dial?hit:null;
        if(target) {
          const poseKind=sample.grip?'grip':'ray';
          grab={id:sample.id,source:sample.source,target,poseKind,
            button:grippedNow?'grip':'trigger',orientation:sample[poseKind].orientation};
          capturedSources.add(sample.source);consumed=true;hover=target.id;
          pointers.push({origin:sample.ray.position,direction,distance:target.distance,targeted:true,kind:sample.kind,controlId:target.id});
        }
      }
      let repeat=last.repeat;
      if(!consumed&&!grab&&hit?.dial) {
        hover=hit.id;
        pointers.push({origin:sample.ray.position,direction,distance:hit.distance,targeted:true,kind:sample.kind,controlId:hit.id});
      }
      if(!consumed&&!grab&&hit&&!hit.dial) {
        hover=hit.id??null;
        pointers.push({origin:sample.ray.position,direction,distance:hit.distance,targeted:true,kind:sample.kind});
        if(pressedNow) {
          if(hit.id)screen?.action(hit.id);else screen?.point(hit.u,hit.v,true);
          repeat=repeatable.has(hit.id)&&Number.isFinite(time)?{id:hit.id,next:time+400}:null;
        } else if(sample.pressed&&repeat&&repeat.id===hit.id&&Number.isFinite(time)&&time>=repeat.next) {
          screen?.action(hit.id);repeat.next=time+80;
        }
      }
      if(!sample.pressed||repeat?.id!==hit?.id||consumed||grab)repeat=null;
      if(!sample.pressed&&last.pressed)comfort?.flush();
      previous.set(sample.id,{pressed:sample.pressed,gripping:sample.gripping,repeat});
      if(comfort?.getState().mode!==currentMode) {
        stop();mode=comfort?.getState().mode;return [];
      }
    }
    screen?.hover(hover);
    // The hinge is fixed, but a changed key plane invalidates old key hits.
    return comfort?.getState().keyboardTilt!==initialTilt
      ?pointers.filter(pointer=>pointer.controlId?.startsWith('dial:')):pointers;
  }
  return {update,stop,isAdjusting:()=>Boolean(grab),getCapturedSources:()=>new Set(capturedSources)};
}
