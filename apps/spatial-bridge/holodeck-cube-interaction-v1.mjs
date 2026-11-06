import { add3, subtract3, scale3, length3, normalize3,
  normalizeQuaternion, multiplyQuaternion, rotate3, quaternionFromAngular } from './holodeck-cube-physics-v1.mjs';
import { createHolodeckCubeScene } from './holodeck-cube-scene-v1.mjs';
import { HOLODECK_TABLE } from './holodeck-layout-v1.mjs';

const pressed = button => button?.pressed===true || button?.value>0.55;
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
export function trackedPose(pose,navigation) {
  const p=pose?.transform?.position,q=pose?.transform?.orientation;
  if(!p||!q||![p.x,p.y,p.z,q.x,q.y,q.z,q.w].every(Number.isFinite)) return null;
  const yaw=[0,Math.sin(navigation.yaw/2),0,Math.cos(navigation.yaw/2)];
  return {position:add3(rotate3([p.x,p.y,p.z],yaw),[navigation.x,0,navigation.z]),
    orientation:normalizeQuaternion(multiplyQuaternion(yaw,normalizeQuaternion([q.x,q.y,q.z,q.w])))};
}
export function cubeTargeted(hand,cube) {
  const throughTable = cube.position[1]>=HOLODECK_TABLE.top+0.008
    &&hand.position[1]<HOLODECK_TABLE.top+0.008
    &&Math.abs(hand.position[0])<HOLODECK_TABLE.halfWidth
    &&Math.abs(hand.position[2]-HOLODECK_TABLE.center[2])<HOLODECK_TABLE.halfDepth;
  if(length3(subtract3(hand.position,cube.position))<Math.max(0.16,cube.size*1.6) && hand.kind==='quest' && !throughTable) return true;
  const delta=subtract3(cube.position,hand.rayOrigin),distance=dot(delta,hand.forward);
  if(distance<0||distance>3.5) return false;
  // A small forgiving aim target makes a 57 mm transparent cube usable in VR.
  if(length3(subtract3(delta,scale3(hand.forward,distance)))>Math.max(0.075,cube.size*0.75)) return false;
  // Do not select the cube through the tabletop from underneath.
  const dy=hand.forward[1];
  if(Math.abs(dy)>1e-6) {
    const t=(HOLODECK_TABLE.top+0.008-hand.rayOrigin[1])/dy;
    const hit=add3(hand.rayOrigin,scale3(hand.forward,t));
    if(t>0&&t<distance-0.005&&Math.abs(hit[0])<HOLODECK_TABLE.halfWidth
      &&Math.abs(hit[2]-HOLODECK_TABLE.center[2])<HOLODECK_TABLE.halfDepth) return false;
  }
  return true;
}

export function createHolodeckCubeInteraction({physics,scene}={}) {
  // Keep the single-body injection for focused physics/input tests.
  scene ??= physics ? {getStates:()=>[physics.getState()],getBody:()=>physics,
    advance:dt=>[physics.advance(dt)],checkpoint:()=>{}} : createHolodeckCubeScene();
  const sourceIds=new WeakMap();let serial=0,lastTime=null,lastSelected='small';
  const carries=new Map();
  const buttons=new Map();
  function sample({frame,referenceSpace,pose,navigation,gamepads=[]}) {
    const hands=[];
    for(const source of frame?.session?.inputSources??[]) {
      const pad=source.gamepad;
      if(source.targetRayMode!=='tracked-pointer'||pad?.mapping!=='xr-standard'||pad.connected===false||!source.gripSpace) continue;
      let grip,ray;
      try {grip=trackedPose(frame.getPose(source.gripSpace,referenceSpace),navigation);
        ray=trackedPose(frame.getPose(source.targetRaySpace,referenceSpace),navigation);} catch {continue;}
      if(!grip||!ray) continue;
      if(!sourceIds.has(source)) sourceIds.set(source,`quest:${source.handedness}:${++serial}`);
      hands.push({...grip,id:sourceIds.get(source),kind:'quest',grab:pressed(pad.buttons?.[1]),
        rayOrigin:ray.position,forward:rotate3([0,0,-1],ray.orientation),throw:false,reset:false,reach:0,rotate:0});
    }
    const head=trackedPose(pose,navigation);
    if(head) for(const pad of gamepads) {
      if(!pad||pad.mapping!=='standard'||pad.connected===false||!pad.axes||pad.axes.length<4) continue;
      hands.push({...head,id:`xbox:${pad.index}:${pad.id||''}`,kind:'xbox',rayOrigin:head.position,
        forward:rotate3([0,0,-1],head.orientation),grab:pressed(pad.buttons?.[7]),throw:pressed(pad.buttons?.[5]),
        reset:pressed(pad.buttons?.[2]),reach:Number(pressed(pad.buttons?.[12]))-Number(pressed(pad.buttons?.[13])),
        rotate:Number(pressed(pad.buttons?.[15]))-Number(pressed(pad.buttons?.[14]))});
    }
    return hands;
  }
  function states() { return scene.getStates(); }
  function choose(hand) {
    return states().filter(c=>!c.heldBy&&cubeTargeted(hand,c))
      .sort((a,b)=>length3(subtract3(a.position,hand.rayOrigin))-a.size/2
        -(length3(subtract3(b.position,hand.rayOrigin))-b.size/2))[0];
  }
  function safeDrop() {
    for(const cube of states()) if(cube.heldBy) scene.getBody(cube.id).release();
    carries.clear();buttons.clear();scene.checkpoint(0,true);
  }
  function result(hands=[]) {
    const cubes=states();
    const pointers=hands.map(hand=>{
      const target=choose(hand),held=cubes.find(c=>c.heldBy===hand.id),focus=held??target;
      return {origin:hand.rayOrigin,direction:hand.forward,
        distance:focus?Math.min(3.5,length3(subtract3(focus.position,hand.rayOrigin))):1.5,
        targeted:Boolean(focus),targetedId:focus?.id,kind:hand.kind};
    });
    for(const cube of cubes) cube.targeted=pointers.some(p=>p.targetedId===cube.id);
    return {...cubes[0],cubes,pointers,targeted:pointers.some(p=>p.targeted)};
  }
  function update({time,pose,frame,referenceSpace,navigation={x:0,z:0,yaw:0},gamepads=[],visible=true,hands:providedHands}) {
    const seconds=lastTime===null?0:(time-lastTime)/1000;
    const tracked=providedHands!==undefined||trackedPose(pose,navigation);
    if(!visible||!tracked||!Number.isFinite(time)||seconds<0||seconds>0.25) {
      safeDrop();lastTime=null;return result();
    }
    lastTime=time;
    const dt=Math.min(seconds,0.05),hands=providedHands??sample({frame,referenceSpace,pose,navigation,gamepads});
    const ids=new Set(hands.map(h=>h.id));
    for(const id of buttons.keys()) if(!ids.has(id)) {buttons.delete(id);carries.delete(id);}
    let released=false;
    for(const cube of states()) if(cube.heldBy&&!ids.has(cube.heldBy)) {
      scene.getBody(cube.id).release();released=true;
    }
    for(const hand of hands) {
      const previous=buttons.get(hand.id)??{grab:hand.grab,throw:hand.throw,reset:hand.reset,armed:!hand.grab};
      if(!hand.grab) previous.armed=true;
      let cube=states().find(c=>c.heldBy===hand.id);
      if(hand.reset&&!previous.reset) {
        const target=cube??choose(hand)??states().find(c=>c.id===lastSelected&&!c.heldBy);
        if(target) {scene.getBody(target.id).reset();carries.delete(hand.id);lastSelected=target.id;released=true;cube=null;}
      }
      if(!cube&&hand.grab&&!previous.grab&&previous.armed) {
        const target=choose(hand);
        if(target) {
          scene.getBody(target.id).grab(hand.id);lastSelected=target.id;
          carries.set(hand.id,{history:[],reach:0.5,rotation:0});cube=scene.getBody(target.id).getState();
        }
      }
      if(cube) {
        const physics=scene.getBody(cube.id),carry=carries.get(hand.id)??{history:[],reach:0.5,rotation:0};
        let {history,reach,rotation}=carry;
        if(!hand.grab || (hand.throw&&!previous.throw)) {
          let velocity=[0,0,0],angular=[0,0,0];
          if(hand.kind==='quest'&&history.length>=2) {
            const first=history[0],last=history.at(-1),elapsed=(last.time-first.time)/1000;
            if(elapsed>=0.015&&elapsed<=0.15) {
              velocity=scale3(subtract3(last.position,first.position),1/elapsed);
              let q=multiplyQuaternion(last.orientation,[-first.orientation[0],-first.orientation[1],-first.orientation[2],first.orientation[3]]);
              if(q[3]<0) q=q.map(v=>-v);
              const angle=2*Math.acos(Math.max(-1,Math.min(1,q[3])));
              angular=scale3(normalize3(q.slice(0,3)),angle/elapsed);
            }
          } else if(hand.kind==='xbox'&&hand.throw&&!previous.throw) {
            velocity=add3(scale3(hand.forward,5),[0,1.2,0]);angular=[3,4,1];
          }
          physics.release(velocity,angular);carries.delete(hand.id);released=true;
        } else {
          reach=Math.max(0.25,Math.min(1.4,reach+hand.reach*dt*0.6));rotation+=hand.rotate*dt*1.5;
          const target=hand.kind==='quest'?add3(hand.position,rotate3([0,0,-Math.max(0.06,cube.size*0.75)],hand.orientation))
            :add3(add3(hand.position,scale3(hand.forward,reach)),[0,-0.12,0]);
          const orientation=hand.kind==='quest'?hand.orientation:multiplyQuaternion(hand.orientation,quaternionFromAngular([0,rotation,0],1));
          const delta=subtract3(target,cube.position),distance=length3(delta);
          const next=add3(cube.position,scale3(delta,Math.min(1,Math.max(0.001,dt)*8/(distance||1))));
          cube=physics.moveHeld(next,orientation);
          if(length3(subtract3(target,cube.position))>0.08) history=[];
          else history.push({time,position:cube.position,orientation:cube.orientation});
          history=history.filter(item=>time-item.time<=90);
          carries.set(hand.id,{history,reach,rotation});
        }
      }
      buttons.set(hand.id,{grab:hand.grab,throw:hand.throw,reset:hand.reset,armed:previous.armed});
    }
    scene.advance(dt);
    scene.checkpoint(time,released||states().every(c=>c.sleeping));
    return result(hands);
  }
  return {update,getState:()=>states()[0],getStates:states,reset:()=>scene.getBody('small').reset(),stop:safeDrop};
}
