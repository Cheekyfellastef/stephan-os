import { HOLODECK_CONSOLE, HOLODECK_DISPLAY } from './holodeck-layout-v1.mjs';
import { SCREEN_BUTTONS } from './holodeck-screen-v1.mjs';
import { trackedPose } from './holodeck-cube-interaction-v1.mjs';
import { rotate3 } from './holodeck-cube-physics-v1.mjs';
const down=button=>button?.pressed===true||button?.value>0.55;
export function consoleHit(origin,direction) {
  const c=HOLODECK_CONSOLE;
  if(direction[1]>=-1e-5||origin[1]<c.top)return null;
  const distance=(c.top+0.002-origin[1])/direction[1];
  if(distance<=0||distance>8)return null;
  const x=origin[0]+distance*direction[0],z=origin[2]+distance*direction[2];
  const u=(x+c.halfWidth-0.10)/(2*c.halfWidth-0.20);
  const v=(z-(c.center[2]-c.halfDepth+0.06))/(2*c.halfDepth-0.12);
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
export function createHolodeckScreenInput({screen}={}) {
  const previous=new Map(),ids=new WeakMap();let serial=0;
  function stop(){previous.clear();screen?.hover(null);}
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
    const live=new Set(samples.map(s=>s.id));for(const id of previous.keys())if(!live.has(id))previous.delete(id);
    const pointers=[];let hover=null;
    for(const sample of samples) {
      const direction=rotate3([0,0,-1],sample.ray.orientation),consoleTarget=consoleHit(sample.ray.position,direction),displayTarget=displayHit(sample.ray.position,direction);
      const hit=consoleTarget??(displayTarget&&screen?.point(displayTarget.u,displayTarget.v)?displayTarget:null);
      // First sample after tracking loss or connection never activates a held button.
      const last=previous.get(sample.id)??sample.pressed;
      if(hit) {
        hover=hit.id??null;
        pointers.push({origin:sample.ray.position,direction,distance:hit.distance,targeted:true,kind:sample.kind});
        if(sample.pressed&&!last){if(hit.id)screen?.action(hit.id);else screen?.point(hit.u,hit.v,true);}
      }
      previous.set(sample.id,sample.pressed);
    }
    screen?.hover(hover);return pointers;
  }
  return {update,stop};
}
