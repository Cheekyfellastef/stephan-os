import { HOLODECK_ROOM, HOLODECK_TABLE, HOLODECK_TABLE_SURFACE, HOLODECK_TABLE_BASE,
  HOLODECK_CUBE, HOLODECK_CONSOLE, HOLODECK_CONSOLE_SUPPORTS } from './holodeck-layout-v1.mjs';

export const CUBE_GRAVITY = 9.81;
const STEP = 1 / 120;
const SKIN = 0.0001;
const dot = (a,b) => a.reduce((sum,v,i) => sum + v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const add3 = (a,b) => a.map((v,i) => v+b[i]);
export const scale3 = (a,s) => a.map(v => v*s);
export const subtract3 = (a,b) => a.map((v,i) => v-b[i]);
export const length3 = a => Math.hypot(...a);
export const normalize3 = a => scale3(a,1/(length3(a)||1));
const bounded = (a,max) => scale3(a,Math.min(1,max/(length3(a)||1)));
export function normalizeQuaternion(q) {
  if (!q || q.length!==4 || !q.every(Number.isFinite) || Math.hypot(...q)<1e-6) return [0,0,0,1];
  const n=Math.hypot(...q); return q.map(v=>v/n);
}
export function multiplyQuaternion(a,b) {
  const [x,y,z,w]=a,[X,Y,Z,W]=b;
  return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z];
}
export function rotate3(v,q) {
  const [x,y,z]=multiplyQuaternion(multiplyQuaternion(q,[...v,0]),[-q[0],-q[1],-q[2],q[3]]);
  return [x,y,z];
}
export function quaternionFromAngular(angular,dt) {
  const speed=length3(angular),angle=speed*dt/2;
  return speed<1e-8?[0,0,0,1]:[...scale3(angular,Math.sin(angle)/speed),Math.cos(angle)];
}
export function cubeSupport(normal,orientation,size=HOLODECK_CUBE.size) {
  return size/2 * [[1,0,0],[0,1,0],[0,0,1]].reduce((sum,axis)=>sum+Math.abs(dot(normal,rotate3(axis,orientation))),0);
}
function prism(w,d,bottom,top,bevel=0,cx=0,cz=HOLODECK_TABLE.center[2]) {
  const planes=[[[1,0,0],cx+w],[[-1,0,0],w-cx],[[0,1,0],top],[[0,-1,0],-bottom],
    [[0,0,1],cz+d],[[0,0,-1],d-cz]];
  if(bevel) for(const x of [-1,1]) for(const z of [-1,1])
    planes.push([[x/Math.SQRT2,0,z/Math.SQRT2],(w+d-bevel+x*cx+z*cz)/Math.SQRT2]);
  return planes;
}
export function markSolid(planes,{owner,attachment}={}) {
  Object.defineProperties(planes,{owner:{value:owner},attachment:{value:attachment}});
  return planes;
}
export function boxSolid(min,max,metadata={}) {
  return markSolid([0,1,2].flatMap(axis=>{
    const normal=[0,0,0];normal[axis]=1;
    return [[normal,max[axis]],[scale3(normal,-1),-min[axis]]];
  }),metadata);
}
const translateSolid=(planes,offset)=>planes.map(([normal,d])=>[normal,d+dot(normal,offset)]);
export function createTableSolids(table=HOLODECK_TABLE) {
  const tableOffset=subtract3(table.center,HOLODECK_TABLE.center);
  const base=HOLODECK_TABLE_BASE;
  const supports=[prism(base.halfWidth,base.halfDepth,base.bottom,base.top,base.bevel),
    prism(0.20,0.20,0.18,0.58,0.08),
    ...[-1,1].map(side=>{
      const slope=side*0.38/0.55,centre=side*0.24-slope*0.13,n=Math.hypot(1,slope);
      return [[[1/n,-slope/n,0],(centre+0.13)/n],[[-1/n,slope/n,0],(-centre+0.13)/n],
        [[0,1,0],0.68],[[0,-1,0],-0.13],[[0,0,1],HOLODECK_TABLE.center[2]+0.32],[[0,0,-1],-HOLODECK_TABLE.center[2]+0.32]];
    })];
  return [prism(table.halfWidth,table.halfDepth,table.bottom,
    table.top+HOLODECK_TABLE_SURFACE.top-HOLODECK_TABLE.top,table.bevel,table.center[0],table.center[2]),
    ...supports.map(planes=>translateSolid(planes,tableOffset))].map(planes=>markSolid(planes,{owner:'table'}));
}
export function createConsoleSolids(console=HOLODECK_CONSOLE) {
  const offset=subtract3(console.center,HOLODECK_CONSOLE.center);
  return [markSolid(prism(console.halfWidth,console.halfDepth,console.bottom,console.top,
    console.bevel,console.center[0],console.center[2]),{owner:'keyboard'}),
    ...HOLODECK_CONSOLE_SUPPORTS.map(({center,size,attachment})=>markSolid(translateSolid(prism(size[0]/2,size[2]/2,
      center[1]-size[1]/2,center[1]+size[1]/2,0,center[0],center[2]),offset),{owner:'keyboard',attachment}))];
}
export function createCubeSolids(table=HOLODECK_TABLE, console=HOLODECK_CONSOLE) {
  const tableSolids=createTableSolids(table),consoleSolids=createConsoleSolids(console);
  return [tableSolids[0],consoleSolids[0],...consoleSolids.slice(1),...tableSolids.slice(1)];
}
export function cubeSolid(state) {
  return markSolid([[1,0,0],[0,1,0],[0,0,1]].flatMap(axis=>[-1,1].map(sign=>{
    const n=rotate3(scale3(axis,sign),state.orientation);
    return [n,dot(n,state.position)+state.size/2];
  })),{owner:'cube:'+state.id});
}

// Conservative per-piece bounds come from the existing convex planes. A sweep
// keeps thin supports from tunnelling during a large nudge without introducing
// another furniture shape model or an arbitrary travel radius.
const boundsCache=new WeakMap();
export function solidBounds(planes) {
  if(boundsCache.has(planes))return boundsCache.get(planes);
  const vertices=[];
  for(let a=0;a<planes.length;a++)for(let b=a+1;b<planes.length;b++)for(let c=b+1;c<planes.length;c++) {
    const [n,d]=planes[a],[m,e]=planes[b],[p,f]=planes[c],mp=cross(m,p),det=dot(n,mp);
    if(Math.abs(det)<1e-9)continue;
    const point=scale3(add3(add3(scale3(mp,d),scale3(cross(p,n),e)),scale3(cross(n,m),f)),1/det);
    if(planes.every(([normal,distance])=>dot(normal,point)<=distance+1e-7))vertices.push(point);
  }
  const bounds=vertices.length?{min:[0,1,2].map(axis=>Math.min(...vertices.map(v=>v[axis]))),
    max:[0,1,2].map(axis=>Math.max(...vertices.map(v=>v[axis])))}:null;
  boundsCache.set(planes,bounds);return bounds;
}
export function solidMotionLimit(moving,stationary,delta) {
  let fraction=1;
  for(const part of moving)for(const obstacle of stationary) {
    // Only the declared display mounts overlap their wall attachment at the
    // canonical pose. They remain solid against cubes and all other furniture.
    if((part.attachment&&part.attachment===obstacle.owner)
      ||(obstacle.attachment&&obstacle.attachment===part.owner))continue;
    const a=solidBounds(part),b=solidBounds(obstacle);
    if(!a||!b)return 0;
    const overlapping=[0,1,2].every(axis=>a.max[axis]>b.min[axis]+1e-7&&a.min[axis]<b.max[axis]-1e-7);
    if(overlapping) {
      // A legacy penetration may escape along its nearest separating direction;
      // it never grants permission to move farther through an unrelated solid.
      const exits=[0,1,2].flatMap(axis=>[
        {depth:a.max[axis]-b.min[axis],speed:-delta[axis]},
        {depth:b.max[axis]-a.min[axis],speed:delta[axis]},
      ]),nearest=Math.min(...exits.map(exit=>exit.depth));
      if(!exits.some(exit=>exit.depth<=nearest+1e-7&&exit.speed>1e-10))return 0;
      continue;
    }
    let enter=-Infinity,leave=Infinity,hitAxis=-1,separate=false;
    for(let axis=0;axis<3;axis++) {
      const speed=delta[axis];
      if(Math.abs(speed)<1e-10) {
        if(a.max[axis]<=b.min[axis]+1e-8||a.min[axis]>=b.max[axis]-1e-8){separate=true;break;}
        continue;
      }
      const t0=(b.min[axis]-a.max[axis])/speed,t1=(b.max[axis]-a.min[axis])/speed;
      if(Math.min(t0,t1)>enter){enter=Math.min(t0,t1);hitAxis=axis;}
      leave=Math.min(leave,Math.max(t0,t1));
    }
    if(!separate&&hitAxis>=0&&enter>=-1e-8&&enter<=1&&leave>Math.max(0,enter))
      fraction=Math.min(fraction,Math.max(0,enter-SKIN/Math.abs(delta[hitAxis])));
  }
  return fraction;
}

// Sweep the cube centre through the support-expanded convex furniture volume.
function sweepSolid(position,delta,planes,orientation,size) {
  let enter=-Infinity,leave=Infinity,normal=null;
  for(const [n,d] of planes) {
    const distance=dot(n,position)-d-cubeSupport(n,orientation,size),speed=dot(n,delta);
    if(Math.abs(speed)<1e-10) { if(distance>=-1e-8) return null; continue; }
    const t=-distance/speed;
    if(speed<0 && t>enter) {enter=t;normal=n;}
    if(speed>0) leave=Math.min(leave,t);
    if(enter>leave) return null;
  }
  return normal && enter>=-1e-8 && enter<=1 && leave>Math.max(enter,0)
    ? {time:Math.max(0,enter),normal}:null;
}
export function cubeSupportedBySolid(state,solid) {
  const hit=sweepSolid(state.position,[0,-SKIN*4,0],solid,state.orientation,state.size);
  return Boolean(hit&&hit.normal[1]>0.5);
}
export function createHolodeckCubePhysics({room=HOLODECK_ROOM,table=HOLODECK_TABLE,cube=HOLODECK_CUBE,extraSolids=()=>[],furnitureSource=null}={}) {
  const solids=createCubeSolids(table);
  const contacts=({omitFurniture=null}={})=>{
    const furniture=typeof furnitureSource==='function'?furnitureSource():null;
    const current=furniture?.table&&furniture?.keyboard?createCubeSolids(furniture.table,furniture.keyboard):solids;
    return [...current,...extraSolids()].filter(solid=>!omitFurniture||solid.owner!==omitFurniture);
  };
  const walls=[[[1,0,0],-room.halfWidth],[[-1,0,0],-room.halfWidth],[[0,1,0],0],
    [[0,-1,0],-room.height],[[0,0,1],room.frontZ],[[0,0,-1],-room.backZ]];
  let position,orientation,velocity,angularVelocity,heldBy,sleeping,accumulator=0,restTime=0;
  function clearPlacement(point,q,physical) {
    return point.every(Number.isFinite)
      &&walls.every(([n,d])=>dot(n,point)>=d+cubeSupport(n,q,cube.size)-1e-8)
      &&physical.every(planes=>planes.some(([n,d])=>dot(n,point)>=d+cubeSupport(n,q,cube.size)-1e-8));
  }
  function correctedPlacement(point,q,physical) {
    let candidate=[...point];
    for(let pass=0;pass<6;pass++) {
      if(clearPlacement(candidate,q,physical))return candidate;
      for(const [n,d] of walls) {
        const depth=d+cubeSupport(n,q,cube.size)-dot(n,candidate);
        if(depth>0)candidate=add3(candidate,scale3(n,depth+SKIN));
      }
      for(const planes of physical) {
        const distances=planes.map(([n,d])=>({n,distance:dot(n,candidate)-d-cubeSupport(n,q,cube.size)}));
        if(distances.every(face=>face.distance<0)) {
          const nearest=distances.reduce((a,b)=>a.distance>b.distance?a:b);
          candidate=add3(candidate,scale3(nearest.n,-nearest.distance+SKIN));
        }
      }
    }
    return clearPlacement(candidate,q,physical)?candidate:null;
  }
  function reset() {
    const currentTable=(typeof furnitureSource==='function'?furnitureSource()?.table:null)??table;
    const desired=add3(cube.center,subtract3(currentTable.center,table.center)),q=[0,0,0,1],physical=contacts();
    const radius=cube.size/2,floor=radius+SKIN;
    const top=currentTable.top+HOLODECK_TABLE_SURFACE.top-HOLODECK_TABLE.top+radius+SKIN;
    const xs=[currentTable.center[0],currentTable.center[0]-currentTable.halfWidth/2,currentTable.center[0]+currentTable.halfWidth/2];
    const zs=[currentTable.center[2],currentTable.center[2]-currentTable.halfDepth/2,currentTable.center[2]+currentTable.halfDepth/2];
    const roomXs=[-room.halfWidth+floor,0,room.halfWidth-floor];
    const roomZs=[room.frontZ+floor,(room.frontZ+room.backZ)/2,room.backZ-floor];
    const candidates=[desired,...xs.flatMap(x=>zs.map(z=>[x,top,z])),
      [desired[0],floor,desired[2]],...xs.flatMap(x=>zs.map(z=>[x,floor,z])),
      ...roomXs.flatMap(x=>roomZs.map(z=>[x,floor,z]))];
    const accepted=candidates.find(candidate=>clearPlacement(candidate,q,physical));
    if(!accepted) {
      // Rejected placement is an atomic no-op, including ownership/velocity.
      // Callers must retain an existing carry rather than report a false recall.
      if(position)return {...getState(),resetPlaced:false};
      throw new Error('No clear initial cube placement is available in this room.');
    }
    position=[...accepted];
    orientation=[0,0,0,1];velocity=[0,0,0];angularVelocity=[0,0,0];heldBy=null;sleeping=true;accumulator=0;restTime=0;
    return {...getState(),resetPlaced:true};
  }
  function getState() {return {position:[...position],orientation:[...orientation],velocity:[...velocity],
    angularVelocity:[...angularVelocity],heldBy,sleeping,size:cube.size,id:cube.id};}
  function depenetrate() {
    for(const [n,d] of walls) {
      const depth=d+cubeSupport(n,orientation,cube.size)-dot(n,position);
      if(depth>0) position=add3(position,scale3(n,depth+SKIN));
    }
    for(const planes of contacts()) {
      const distances=planes.map(([n,d])=>({n,distance:dot(n,position)-d-cubeSupport(n,orientation,cube.size)}));
      if(distances.every(p=>p.distance<0)) {
        const nearest=distances.reduce((a,b)=>a.distance>b.distance?a:b);
        position=add3(position,scale3(nearest.n,-nearest.distance+SKIN));
      }
    }
  }
  function travel(delta,bounce=false,options={}) {
    let remaining=[...delta],grounded=false;
    for(let pass=0;pass<6 && length3(remaining)>1e-9;pass++) {
      let hit=null;
      for(const [n,d] of walls) {
        const speed=dot(n,remaining),distance=dot(n,position)-d-cubeSupport(n,orientation,cube.size);
        if(speed<-1e-10) {
          const time=-distance/speed;
          if(time>=-1e-8 && time<=1 && (!hit||time<hit.time)) hit={time:Math.max(0,time),normal:n};
        }
      }
      for(const solid of contacts(options)) {
        const candidate=sweepSolid(position,remaining,solid,orientation,cube.size);
        if(candidate&&(!hit||candidate.time<hit.time)) hit=candidate;
      }
      if(!hit) {position=add3(position,remaining);break;}
      position=add3(add3(position,scale3(remaining,hit.time)),scale3(hit.normal,SKIN));
      remaining=scale3(remaining,1-hit.time);
      const into=dot(remaining,hit.normal);
      if(into<0) remaining=subtract3(remaining,scale3(hit.normal,into));
      if(hit.normal[1]>0.5) grounded=true;
      if(bounce) {
        const impact=dot(velocity,hit.normal);
        if(impact<0) {
          const restitution=Math.abs(impact)>0.35?0.24:0;
          velocity=subtract3(velocity,scale3(hit.normal,(1+restitution)*impact));
          const normalVelocity=scale3(hit.normal,dot(velocity,hit.normal));
          velocity=add3(normalVelocity,scale3(subtract3(velocity,normalVelocity),0.78));
          angularVelocity=scale3(angularVelocity,0.65);
        }
      }
    }
    return grounded;
  }
  // Read-only sweep for a shared table/cargo translation. Its own table and
  // fellow supported cubes move together; all other solid surfaces still stop it.
  function supportMotionLimit(delta,owner='table') {
    if(heldBy||!delta?.every(Number.isFinite))return 0;
    let fraction=1;
    const accept=hit=>{
      if(hit)fraction=Math.min(fraction,Math.max(0,hit.time-SKIN/Math.max(SKIN,Math.abs(dot(delta,hit.normal)))));
    };
    for(const [n,d] of walls) {
      const speed=dot(n,delta),distance=dot(n,position)-d-cubeSupport(n,orientation,cube.size);
      if(speed<-1e-10&&distance+speed<SKIN)accept({time:Math.max(0,distance/-speed),normal:n});
    }
    for(const solid of contacts({omitFurniture:owner}))accept(sweepSolid(position,delta,solid,orientation,cube.size));
    return fraction;
  }
  function moveSupported(delta,owner='table') {
    if(heldBy||!delta?.every(Number.isFinite))return getState();
    travel(delta,false,{omitFurniture:owner});
    return getState();
  }
  function grab(id) {heldBy=id;velocity=[0,0,0];angularVelocity=[0,0,0];sleeping=false;restTime=0;}
  function moveHeld(target,q=orientation) {
    if(!heldBy||!target?.every(Number.isFinite)) return getState();
    // First sweep translation at the current orientation; rotation is then
    // constrained by the same solid surfaces, even while the cube is held.
    travel(subtract3(target,position));orientation=normalizeQuaternion(q);depenetrate();
    return getState();
  }
  function release(linear=[0,0,0],angular=[0,0,0]) {
    heldBy=null;velocity=bounded(linear.every(Number.isFinite)?linear:[0,0,0],8);
    angularVelocity=bounded(angular.every(Number.isFinite)?angular:[0,0,0],16);
    sleeping=false;restTime=0;accumulator=0;
  }
  function settleFlat(amount) {
    let face=[[1,0,0],[0,1,0],[0,0,1]].map(v=>rotate3(v,orientation))
      .sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))[0];
    if(face[1]<0) face=scale3(face,-1);
    const align=normalizeQuaternion([-face[2],0,face[0],1+face[1]]);
    let target=normalizeQuaternion(multiplyQuaternion(align,orientation));
    if(dot(target,orientation)<0) target=target.map(v=>-v);
    const before=cubeSupport([0,1,0],orientation,cube.size);
    orientation=normalizeQuaternion(orientation.map((v,i)=>v+(target[i]-v)*amount));
    position[1]+=cubeSupport([0,1,0],orientation,cube.size)-before;
    depenetrate();
  }
  function advance(seconds) {
    if(heldBy||!Number.isFinite(seconds)||seconds<=0) return getState();
    // A stacked cube must wake when the supporting cube moves away.
    if(sleeping) {
      const onFloor=position[1]-cubeSupport([0,1,0],orientation,cube.size)<SKIN*3;
      if(onFloor||contacts().some(s=>sweepSolid(position,[0,-SKIN*3,0],s,orientation,cube.size))) return getState();
      sleeping=false;
    }
    accumulator+=Math.min(seconds,0.1);
    while(accumulator>=STEP) {
      accumulator-=STEP;
      orientation=normalizeQuaternion(multiplyQuaternion(quaternionFromAngular(angularVelocity,STEP),orientation));
      depenetrate();velocity[1]-=CUBE_GRAVITY*STEP;
      const grounded=travel(scale3(velocity,STEP),true);
      angularVelocity=scale3(angularVelocity,Math.exp(-(grounded?8:0.12)*STEP));
      velocity=scale3(velocity,Math.exp(-(grounded?4:0.08)*STEP));
      if(grounded&&length3(velocity)<0.3&&length3(angularVelocity)<1) settleFlat(0.12);
      if(grounded&&length3(velocity)<0.07&&length3(angularVelocity)<0.15) restTime+=STEP; else restTime=0;
      if(restTime>0.25) {settleFlat(1);velocity=[0,0,0];angularVelocity=[0,0,0];sleeping=true;accumulator=0;break;}
    }
    return getState();
  }
  function restore(state) {
    if(!state || ![state.position,state.velocity,state.angularVelocity].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))
      || !Array.isArray(state.orientation)||state.orientation.length!==4||!state.orientation.every(Number.isFinite)) return false;
    const q=normalizeQuaternion(state.orientation),accepted=correctedPlacement(state.position,q,contacts());
    if(!accepted)return false;
    position=accepted;orientation=q;
    velocity=bounded(state.velocity,8);angularVelocity=bounded(state.angularVelocity,16);
    heldBy=null;sleeping=state.sleeping===true;accumulator=0;restTime=0;
    return true;
  }
  reset();
  return {getState,reset,grab,moveHeld,release,advance,restore,supportMotionLimit,moveSupported};
}
