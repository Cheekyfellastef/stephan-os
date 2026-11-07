import { HOLODECK_CONSOLE, HOLODECK_DISPLAY } from './holodeck-layout-v1.mjs';
import { SCREEN_BUTTONS } from './holodeck-screen-v1.mjs';
import { trackedPose } from './holodeck-cube-interaction-v1.mjs';
import { rotate3 } from './holodeck-cube-physics-v1.mjs';

const down=button=>button?.pressed===true||button?.value>0.55;
const hingeY=HOLODECK_CONSOLE.top+0.002;
const hingeZ=HOLODECK_CONSOLE.center[2]-HOLODECK_CONSOLE.halfDepth+0.06;
const keyboardDepth=2*HOLODECK_CONSOLE.halfDepth-0.12;
const knobCenter=side=>[side*(HOLODECK_CONSOLE.halfWidth+0.18),hingeY+0.10,hingeZ];

function keyboardLocal(origin,direction,angleDegrees=0) {
  const angle=Math.max(0,Math.min(90,Number(angleDegrees)||0))*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const oy=origin[1]-hingeY,oz=origin[2]-hingeZ;
  return {
    origin:[origin[0],c*oy-s*oz,s*oy+c*oz],
    direction:[direction[0],c*direction[1]-s*direction[2],s*direction[1]+c*direction[2]],
  };
}

export function consoleHit(origin,direction,angleDegrees=0) {
  const c=HOLODECK_CONSOLE,local=keyboardLocal(origin,direction,angleDegrees);
  if(local.direction[1]>=-1e-5)return null;
  const distance=-local.origin[1]/local.direction[1];
  if(distance<=0||distance>8)return null;
  const x=local.origin[0]+distance*local.direction[0],z=local.origin[2]+distance*local.direction[2];
  const u=(x+c.halfWidth-0.10)/(2*c.halfWidth-0.20),v=z/keyboardDepth;
  const button=SCREEN_BUTTONS.find(b=>u>=b.x&&u<=b.x+b.w&&v>=b.y&&v<=b.y+b.h);
  return button?{id:button.id,distance}:null;
}

export function displayHit(origin,direction) {
  const d=HOLODECK_DISPLAY;if(direction[2]>=-1e-5||origin[2]<=d.z)return null;
  const distance=(d.z-origin[2])/direction[2];if(distance<=0||distance>12)return null;
  const x=origin[0]+distance*direction[0],y=origin[1]+distance*direction[1];
  const u=(x+d.halfWidth)/(2*d.halfWidth),v=(d.top-y)/(d.top-d.bottom);
  return u>=0&&u<=1&&v>=0&&v<=1?{u,v,distance}:null;
}

export function comfortKnobHit(origin,direction) {
  let best=null;
  for(const side of [-1,1]) {
    if(Math.abs(direction[0])<1e-5)continue;
    const center=knobCenter(side),distance=(center[0]-origin[0])/direction[0];
    if(distance<=0||distance>8)continue;
    const y=origin[1]+distance*direction[1],z=origin[2]+distance*direction[2];
    if(Math.hypot(y-center[1],z-center[2])>0.23)continue;
    if(!best||distance<best.distance)best={id:`knob:${side<0?'left':'right'}`,side,distance};
  }
  return best;
}

export function comfortKnobAngle(origin,direction,side) {
  if(![-1,1].includes(side)||Math.abs(direction[0])<1e-5)return null;
  const center=knobCenter(side),distance=(center[0]-origin[0])/direction[0];
  if(distance<=0||distance>8)return null;
  const y=origin[1]+distance*direction[1],z=origin[2]+distance*direction[2];
  const degrees=Math.atan2(y-center[1],z-center[2])*180/Math.PI;
  return Math.max(0,Math.min(90,degrees));
}

export function createHolodeckScreenInput({screen,comfort}={}) {
  const previous=new Map(),drags=new Map(),ids=new WeakMap();let serial=0;
  function stop(){previous.clear();drags.clear();screen?.hover(null);}
  function update({frame,referenceSpace,pose,navigation,gamepads=[],visible=true}) {
    if(!visible||!trackedPose(pose,navigation)){stop();return [];}
    const samples=[];
    for(const source of frame?.session?.inputSources??[]) {
      if(source.targetRayMode!=='tracked-pointer'||source.gamepad?.mapping!=='xr-standard'||source.gamepad.connected===false)continue;
      let ray;try{ray=trackedPose(frame.getPose(source.targetRaySpace,referenceSpace),navigation);}catch{}
      if(!ray)continue;if(!ids.has(source))ids.set(source,`quest:${++serial}`);
      samples.push({id:ids.get(source),kind:'quest',ray,pressed:down(source.gamepad.buttons?.[0])});
    }
    const head=trackedPose(pose,navigation);
    for(const pad of gamepads)if(pad?.mapping==='standard'&&pad.connected!==false&&pad.axes?.length>=4)
      samples.push({id:`xbox:${pad.index}:${pad.id||''}`,kind:'xbox',ray:head,pressed:down(pad.buttons?.[0])});
    const live=new Set(samples.map(s=>s.id));for(const id of previous.keys())if(!live.has(id)){previous.delete(id);drags.delete(id);}
    const pointers=[];let hover=null;
    for(const sample of samples) {
      const direction=rotate3([0,0,-1],sample.ray.orientation);
      const last=previous.get(sample.id)??sample.pressed;
      const drag=drags.get(sample.id);
      if(drag) {
        if(sample.pressed) {
          const desired=comfortKnobAngle(sample.ray.position,direction,drag.side);
          if(desired!==null)comfort?.setKeyboardAngle?.(desired);
          hover=drag.id;
          pointers.push({origin:sample.ray.position,direction,distance:drag.distance,targeted:true,kind:sample.kind});
        } else drags.delete(sample.id);
        previous.set(sample.id,sample.pressed);
        continue;
      }
      const angle=Number(comfort?.getState?.()?.active?.keyboardAngle)||0;
      const knobTarget=comfortKnobHit(sample.ray.position,direction);
      const consoleTarget=consoleHit(sample.ray.position,direction,angle);
      const displayTarget=displayHit(sample.ray.position,direction);
      const hit=knobTarget??consoleTarget??(displayTarget&&screen?.point(displayTarget.u,displayTarget.v)?displayTarget:null);
      if(hit) {
        hover=hit.id??null;
        pointers.push({origin:sample.ray.position,direction,distance:hit.distance,targeted:true,kind:sample.kind});
        if(sample.pressed&&!last){
          if(knobTarget){
            drags.set(sample.id,knobTarget);
            const desired=comfortKnobAngle(sample.ray.position,direction,knobTarget.side);
            if(desired!==null)comfort?.setKeyboardAngle?.(desired);
          } else if(hit.id)screen?.action(hit.id);
          else screen?.point(hit.u,hit.v,true);
        }
      }
      previous.set(sample.id,sample.pressed);
    }
    screen?.hover(hover);return pointers;
  }
  return {update,stop};
}
