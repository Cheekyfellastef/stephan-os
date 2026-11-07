import { applyHolodeckLocomotionToView } from './holodeck-locomotion-v1.mjs';
import { HOLODECK_ROOM, HOLODECK_TABLE, HOLODECK_CUBE, HOLODECK_CUBES, HOLODECK_OBSTACLES, HOLODECK_DISPLAY, HOLODECK_CONSOLE } from './holodeck-layout-v1.mjs';
import { createHolodeckDisplayRenderer } from './holodeck-display-renderer-v1.mjs';
import { rotate3, add3, scale3, normalize3 } from './holodeck-cube-physics-v1.mjs';
import { consolePointToWorld, consoleDirectionToWorld, HOLODECK_KEYBOARD_DIALS } from './holodeck-comfort-v1.mjs';

const CYAN = [0.32, 0.88, 1.0], ICE = [0.68, 0.9, 1.0], WARM = [1.0, 0.75, 0.43];
const GRID = [0.18, 0.43, 0.53], GRID_SOFT = [0.10, 0.24, 0.31];
const CERAMIC = [0.56, 0.67, 0.73], METAL = [0.15, 0.23, 0.29], DARK = [0.04, 0.10, 0.14];

function line(g, a, b, color = CYAN) {
  g.positions.push(...a, ...b); g.colors.push(...color, ...color);
}
function triangle(g, a, b, c, color, emissive = 0) {
  const u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i]);
  const cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  const length = Math.hypot(...cross);
  for (const point of [a, b, c]) {
    g.solidPositions.push(...point); g.solidColors.push(...color);
    g.normals.push(...cross.map(n => n / length)); g.emissions.push(emissive);
  }
}
function quad(g, a, b, c, d, color, emissive = 0) {
  triangle(g, a, b, c, color, emissive); triangle(g, a, c, d, color, emissive);
}
function contour(cx, cz, w, d, bevel, y) {
  return [[-w+bevel,-d],[w-bevel,-d],[w,-d+bevel],[w,d-bevel],
    [w-bevel,d],[-w+bevel,d],[-w,d-bevel],[-w,-d+bevel]].map(([x,z])=>[cx+x,y,cz+z]);
}
function slab(g, { cx = 0, cz = -2.2, w, d, bevel = 0.1, bottom, top, color, emissive = 0 }) {
  const low = contour(cx, cz, w, d, bevel, bottom), high = contour(cx, cz, w, d, bevel, top);
  for (let i = 0; i < 8; i++) {
    const j = (i+1)%8;
    triangle(g, [cx,top,cz], high[j], high[i], color, emissive);
    triangle(g, [cx,bottom,cz], low[i], low[j], color, emissive);
    quad(g, low[i], high[i], high[j], low[j], color, emissive);
  }
}
function outline(g, points, color) {
  points.forEach((p,i) => line(g, p, points[(i+1)%points.length], color));
}
function ring(g, center, radius, color, horizontal = false) {
  const points = Array.from({length:64}, (_,i) => {
    const a = i/64*Math.PI*2;
    return horizontal ? [center[0]+Math.cos(a)*radius,center[1],center[2]+Math.sin(a)*radius]
      : [center[0]+Math.cos(a)*radius,center[1]+Math.sin(a)*radius,center[2]];
  });
  outline(g, points, color);
}
function box(g, center, size, color) {
  const [x,y,z] = center, [w,h,d] = size.map(n => n/2);
  const p = [[x-w,y-h,z-d],[x+w,y-h,z-d],[x+w,y+h,z-d],[x-w,y+h,z-d],
    [x-w,y-h,z+d],[x+w,y-h,z+d],[x+w,y+h,z+d],[x-w,y+h,z+d]];
  for (const f of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]])
    quad(g,...f.map(i=>p[i]),color);
  return p;
}

function keyboardDial(g,dial) {
  const [x,y,z]=dial.center,r=dial.radius,halfDepth=dial.halfDepth,segments=32;
  const point=(side,angle,radius=r)=>[x+side*halfDepth,y+Math.cos(angle)*radius,z+Math.sin(angle)*radius];
  for(let i=0;i<segments;i++) {
    const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2;
    quad(g,point(-1,a),point(1,a),point(1,b),point(-1,b),i%2?METAL:CERAMIC);
    for(const side of [-1,1]) {
      triangle(g,[x+side*halfDepth,y,z],point(side,a),point(side,b),METAL);
      line(g,point(side,a),point(side,b),CYAN);
      if(i%4===0)line(g,point(side,a,r*0.76),point(side,a),ICE);
    }
  }
  // A bright index follows the hinge angle; a wide rib is visible head-on.
  for(const side of [-1,1])line(g,[x+side*(halfDepth+0.002),y,z],
    [x+side*(halfDepth+0.002),y+r*0.85,z],WARM);
  line(g,[x-halfDepth,y,z+r+0.002],[x+halfDepth,y,z+r+0.002],WARM);
}

function tiltKeyboardArrays(source,target,ranges,angle) {
  for(const [key,range] of Object.entries(ranges))for(let i=range.start;i<range.end;i+=3) {
    const point=Array.from(source[key].slice(i,i+3));
    target[key].set(key==='normals'?consoleDirectionToWorld(point,angle):consolePointToWorld(point,angle),i);
  }
}

export function createHolodeckRoomGeometry({keyboardTilt=0}={}) {
  const g = { positions: [], colors: [], solidPositions: [], solidColors: [], normals: [], emissions: [] };
  const { halfWidth:w, frontZ:f, backZ:b, height:h } = HOLODECK_ROOM;
  // Solid, inward-facing room shell. Grid lines are inset to avoid depth flicker.
  quad(g,[-w,0,f],[-w,0,b],[w,0,b],[w,0,f],[0.13,0.19,0.23]);
  quad(g,[-w,h,f],[w,h,f],[w,h,b],[-w,h,b],[0.19,0.26,0.31]);
  quad(g,[-w,0,f],[w,0,f],[w,h,f],[-w,h,f],[0.16,0.23,0.29]);
  quad(g,[w,0,b],[-w,0,b],[-w,h,b],[w,h,b],[0.16,0.23,0.29]);
  quad(g,[-w,0,b],[-w,0,f],[-w,h,f],[-w,h,b],[0.16,0.23,0.29]);
  quad(g,[w,0,f],[w,0,b],[w,h,b],[w,h,f],[0.16,0.23,0.29]);
  for (const y of [0.008,h-0.008]) {
    for (let x=-w;x<=w;x+=0.5) line(g,[x,y,f],[x,y,b], x%1===0?GRID:GRID_SOFT);
    for (let z=f;z<=b;z+=0.5) line(g,[-w,y,z],[w,y,z], z%1===0?GRID:GRID_SOFT);
  }
  for (const z of [f+0.008,b-0.008]) {
    for (let x=-w;x<=w;x+=0.5) line(g,[x,0,z],[x,h,z],x%1===0?GRID:GRID_SOFT);
    for (let y=0;y<h;y+=0.5) line(g,[-w,y,z],[w,y,z],y%1===0?GRID:GRID_SOFT);
  }
  for (const x of [-w+0.008,w-0.008]) {
    for (let z=f;z<=b;z+=0.5) line(g,[x,0,z],[x,h,z],z%1===0?GRID:GRID_SOFT);
    for (let y=0;y<h;y+=0.5) line(g,[x,y,f],[x,y,b],y%1===0?GRID:GRID_SOFT);
  }
  // Continuous architectural cove lights, plus broad ceiling luminaires.
  for (const y of [0.07,h-0.14]) {
    for (const x of [-w+0.015,w-0.015])
      quad(g,[x,y,f],[x,y+0.035,f],[x,y+0.035,b],[x,y,b],y<1?CYAN:ICE,1);
    for (const z of [f+0.015,b-0.015])
      quad(g,[-w,y,z],[w,y,z],[w,y+0.035,z],[-w,y+0.035,z],y<1?CYAN:ICE,1);
  }
  for (const x of [-2.6,2.6]) {
    quad(g,[x-0.22,h-0.025,-4.8],[x+0.22,h-0.025,-4.8],
      [x+0.22,h-0.025,1.8],[x-0.22,h-0.025,1.8],ICE,1);
  }
  // Thirty-second-century workstation: suspended ceramic deck, dark inset
  // work surface, detached luminous edge, and a split sculpted pedestal.
  const t = HOLODECK_TABLE, cz=t.center[2];
  slab(g,{w:t.halfWidth,d:t.halfDepth,bevel:t.bevel,bottom:t.bottom,top:0.785,color:CERAMIC});
  slab(g,{w:t.halfWidth,d:t.halfDepth,bevel:t.bevel,bottom:0.803,top:t.top,color:CERAMIC});
  slab(g,{w:1.18,d:0.65,bevel:0.20,bottom:t.top,top:t.top+0.008,color:DARK});
  slab(g,{w:t.halfWidth,d:t.halfDepth,bevel:t.bevel,bottom:0.785,top:0.803,color:CYAN,emissive:1});
  slab(g,{w:0.68,d:0.44,bevel:0.20,bottom:0.035,top:0.11,color:METAL});
  slab(g,{w:0.57,d:0.36,bevel:0.17,bottom:0.11,top:0.13,color:CYAN,emissive:1});
  for (const side of [-1,1]) {
    const low = contour(side*0.24,cz,0.12,0.24,0.06,0.13);
    const high = contour(side*0.62,cz,0.13,0.32,0.07,0.68);
    for (let i=0;i<8;i++) quad(g,low[i],high[i],high[(i+1)%8],low[(i+1)%8],CERAMIC);
    outline(g,high,CYAN);
    line(g,[side*0.24,0.16,cz+0.245],[side*0.62,0.66,cz+0.325],CYAN);
  }
  slab(g,{w:0.20,d:0.20,bevel:0.08,bottom:0.18,top:0.58,color:METAL});
  for (const y of [0.24,0.34,0.44,0.54]) ring(g,[0,y,cz],0.22,CYAN,true);
  outline(g,contour(0,cz,1.18,0.65,0.20,0.891),CYAN);
  ring(g,[0,0.894,cz],0.43,CYAN,true);
  ring(g,[0,0.895,cz],0.47,GRID,true);
  // Inlaid light segments and quiet interface markings, with no flashing.
  for (const side of [-1,1]) {
    for (let i=0;i<5;i++) line(g,[side*(0.63+i*0.09),0.895,cz+0.35],
      [side*(0.63+i*0.09),0.895,cz+0.48],i===0?WARM:CYAN);
    line(g,[side*0.63,0.895,cz-0.38],[side*1.03,0.895,cz-0.38],CYAN);
  }
  ring(g,[0,0.016,cz],1.62,[0.12,0.30,0.36],true);
  // Wall-wide suspended holographic field; separated light rails give it depth.
  const display=HOLODECK_DISPLAY,c=HOLODECK_CONSOLE;
  for(const depth of [0.02,-0.08]) {
    const z=display.z+depth;
    outline(g,[[-3.86,0.60,z],[3.86,0.60,z],[3.86,3.08,z],[-3.86,3.08,z]],depth>0?CYAN:GRID);
    for(const side of [-1,1]) {
      line(g,[side*3.86,0.60,z],[side*4.02,0.76,z-0.1],CYAN);
      line(g,[side*3.86,3.08,z],[side*4.02,2.92,z-0.1],CYAN);
      line(g,[side*4.02,0.76,z-0.1],[side*4.02,2.92,z-0.1],GRID);
    }
  }
  for(const x of [-3.6,-2.4,2.4,3.6]) {
    quad(g,[x-0.04,0.40,f+0.04],[x+0.04,0.40,f+0.04],[x+0.04,0.58,display.z],[x-0.04,0.58,display.z],CYAN,1);
  }
  slab(g,{cz:c.center[2],w:c.halfWidth,d:c.halfDepth,bevel:c.bevel,bottom:c.bottom,top:c.top,color:CERAMIC});
  slab(g,{cz:c.center[2],w:c.halfWidth+0.012,d:c.halfDepth+0.012,bevel:c.bevel,bottom:0.88,top:0.90,color:CYAN,emissive:1});
  const keyboardRanges=Object.fromEntries(['positions','solidPositions','normals'].map(key=>[key,{start:g[key].length}]));
  // The thin keyboard tray tilts above the fixed desk/cube support surface.
  slab(g,{cz:c.center[2],w:c.halfWidth-0.06,d:c.halfDepth-0.02,bevel:c.bevel,
    bottom:c.top-0.02,top:c.top+0.001,color:DARK});
  HOLODECK_KEYBOARD_DIALS.forEach(dial=>keyboardDial(g,dial));
  for(const [key,range] of Object.entries(keyboardRanges))range.end=g[key].length;
  for(const side of [-1,1]) {
    box(g,[side*1.3,0.435,c.center[2]],[0.18,0.77,0.76],METAL);
    box(g,[side*1.3,0.97,-5.72],[0.18,0.26,0.56],CERAMIC);
    line(g,[side*1.3,0.08,-4.734],[side*1.3,0.82,-4.734],CYAN);
  }
  const arrays=Object.fromEntries(Object.entries(g).map(([key,value])=>[key,new Float32Array(value)]));
  if(keyboardTilt!==0)tiltKeyboardArrays(arrays,arrays,keyboardRanges,keyboardTilt);
  return Object.freeze({
    ...arrays,keyboardRanges,
    vertexCount:g.positions.length/3, solidVertexCount:g.solidPositions.length/3,
    primitive:'LINES', room:HOLODECK_ROOM, table:t, ideaCube:HOLODECK_CUBE, obstacles:HOLODECK_OBSTACLES,
  });
}

export function createHolodeckCubeGeometry(state={}) {
  const g={positions:[],colors:[],solidPositions:[],solidColors:[],normals:[],emissions:[]};
  const position=state.position??HOLODECK_CUBE.center,orientation=state.orientation??[0,0,0,1];
  const size=state.size??HOLODECK_CUBE.size;
  const corners=box(g,[0,0,0],[size,size,size],[0.66,0.88,0.96]);
  for(let i=0;i<g.solidPositions.length;i+=3) {
    g.solidPositions.splice(i,3,...add3(position,rotate3(g.solidPositions.slice(i,i+3),orientation)));
    g.normals.splice(i,3,...rotate3(g.normals.slice(i,i+3),orientation));
  }
  const world=corners.map(p=>add3(position,rotate3(p,orientation)));
  for(const [a,b] of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]])
    line(g,world[a],world[b],state.targeted||state.heldBy?ICE:[0.29,0.53,0.61]);
  for(const pointer of state.pointers??[]) {
    const distance=pointer.targeted?pointer.distance:Math.min(pointer.distance,1.5);
    const end=add3(pointer.origin,scale3(pointer.direction,distance));
    if(pointer.kind==='quest') line(g,pointer.origin,end,pointer.targeted?WARM:[0.12,0.28,0.32]);
    if(pointer.kind==='xbox'||pointer.targeted) {
      const right=normalize3(Math.abs(pointer.direction[1])<0.99?[-pointer.direction[2],0,pointer.direction[0]]:[1,0,0]);
      const up=normalize3([right[1]*pointer.direction[2]-right[2]*pointer.direction[1],
        right[2]*pointer.direction[0]-right[0]*pointer.direction[2],right[0]*pointer.direction[1]-right[1]*pointer.direction[0]]);
      for(const axis of [right,up]) line(g,add3(end,scale3(axis,-0.006*distance)),add3(end,scale3(axis,0.006*distance)),pointer.targeted?WARM:ICE);
    }
  }
  return {...Object.fromEntries(Object.entries(g).map(([key,value])=>[key,new Float32Array(value)])),
    vertexCount:g.positions.length/3,solidVertexCount:g.solidPositions.length/3};
}

function compileShader(gl,type,source) {
  const shader=gl.createShader(type);
  gl.shaderSource(shader,source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) {
    const message=gl.getShaderInfoLog(shader)||'shader compile failed'; gl.deleteShader(shader); throw new Error(message);
  }
  return shader;
}
function createProgram(gl) {
  const vertex=compileShader(gl,gl.VERTEX_SHADER,`
    attribute vec3 aPosition;
    attribute vec3 aColor;
    attribute vec3 aNormal;
    attribute float aEmission;
    uniform mat4 uProjection;
    uniform mat4 uView;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vWorld;
    varying float vEmission;
    void main() {
      vColor=aColor; vNormal=aNormal; vWorld=aPosition; vEmission=aEmission;
      gl_Position=uProjection*uView*vec4(aPosition,1.0);
    }
  `);
  let fragment;
  try { fragment=compileShader(gl,gl.FRAGMENT_SHADER,`
    precision mediump float;
    uniform float uGlass;
    uniform vec3 uEyePosition;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vWorld;
    varying float vEmission;
    vec3 light(vec3 position,vec3 tint,vec3 normal) {
      vec3 delta=position-vWorld;
      float distanceSquared=dot(delta,delta);
      return tint*max(dot(normal,normalize(delta)),0.0)/(1.0+0.10*distanceSquared);
    }
    void main() {
      if (vEmission>0.99) { gl_FragColor=vec4(vColor,1.0); return; }
      vec3 normal=normalize(vNormal);
      if (!gl_FrontFacing) normal=-normal;
      if (uGlass>0.5) {
        vec3 viewDirection=normalize(uEyePosition-vWorld);
        float fresnel=pow(1.0-abs(dot(normal,viewDirection)),4.0);
        vec3 reflection=reflect(-viewDirection,normal);
        vec3 color=vec3(0.32,0.58,0.67)+fresnel*vec3(0.36,0.37,0.33);
        float highlight=0.0;
        if(reflection.y>0.01) {
          vec3 ceiling=vWorld+reflection*((3.2-vWorld.y)/reflection.y);
          highlight=(1.0-smoothstep(0.16,0.25,abs(abs(ceiling.x)-2.6)))
            *step(-4.8,ceiling.z)*step(ceiling.z,1.8);
        }
        color=mix(color,vec3(0.92,0.98,1.0),highlight*0.85);
        gl_FragColor=vec4(color,0.10+0.42*fresnel+0.34*highlight);
        return;
      }
      vec3 illumination=vec3(0.36,0.40,0.44);
      illumination+=light(vec3(-2.6,3.05,-2.0),vec3(0.72,0.88,1.0),normal);
      illumination+=light(vec3(2.6,3.05,-1.0),vec3(1.0,0.88,0.70),normal);
      illumination+=light(vec3(0.0,1.8,-2.2),vec3(0.12,0.43,0.52),normal);
      // Soft contact darkening grounds the pedestal without expensive VR shadow maps.
      if (vWorld.y<0.02) {
        float contact=1.0-smoothstep(0.28,1.5,length((vWorld.xz-vec2(0.0,-2.2))*vec2(0.8,1.2)));
        illumination*=1.0-0.32*contact;
      }
      vec3 color=vColor*illumination;
      gl_FragColor=vec4(pow(clamp(color,0.0,1.0),vec3(0.88)),1.0);
    }
  `); } catch (error) { gl.deleteShader(vertex); throw error; }
  const program=gl.createProgram();
  gl.attachShader(program,vertex); gl.attachShader(program,fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program,gl.LINK_STATUS)) {
    const message=gl.getProgramInfoLog(program)||'program link failed'; gl.deleteProgram(program); throw new Error(message);
  }
  return program;
}

function previewMatrices(width,height,eye,target) {
  const normalize=a=>{const l=Math.hypot(...a);return a.map(v=>v/l);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const z=normalize(eye.map((v,i)=>v-target[i])),x=normalize(cross([0,1,0],z)),y=cross(z,x);
  const dot=a=>a.reduce((sum,v,i)=>sum+v*eye[i],0);
  const view=new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x),-dot(y),-dot(z),1]);
  const near=0.05,far=50,f=1/Math.tan(Math.PI/6);
  const projection=new Float32Array([f/(width/height),0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);
  return {view,projection};
}

export function createHolodeckRoomRenderer({gl,screen,comfort=screen?.comfort}={}) {
  if (!gl) throw new Error('WebGL context required');
  const geometry=createHolodeckRoomGeometry(),program=createProgram(gl),buffers=[];
  const display=screen?createHolodeckDisplayRenderer({gl,screen,comfort}):null;
  const attributes=Object.fromEntries(['Position','Color','Normal','Emission'].map(name=>[name,gl.getAttribLocation(program,`a${name}`)]));
  const projectionLocation=gl.getUniformLocation(program,'uProjection'),viewLocation=gl.getUniformLocation(program,'uView');
  const glassLocation=gl.getUniformLocation(program,'uGlass'),eyeLocation=gl.getUniformLocation(program,'uEyePosition');
  function buffer(data) {
    const handle=gl.createBuffer(); buffers.push(handle); gl.bindBuffer(gl.ARRAY_BUFFER,handle);
    gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW); return handle;
  }
  const solid={Position:buffer(geometry.solidPositions),Color:buffer(geometry.solidColors),
    Normal:buffer(geometry.normals),Emission:buffer(geometry.emissions)};
  const lines={Position:buffer(geometry.positions),Color:buffer(geometry.colors)};
  const keyboardArrays=Object.fromEntries(['positions','solidPositions','normals']
    .map(key=>[key,geometry[key].slice()]));
  let keyboardVersion=0;
  function updateKeyboard() {
    const tilt=comfort?.getState().keyboardTilt??0;
    if(tilt===keyboardVersion)return;
    keyboardVersion=tilt;
    tiltKeyboardArrays(geometry,keyboardArrays,geometry.keyboardRanges,tilt);
    for(const [handle,data] of [[solid.Position,keyboardArrays.solidPositions],
      [solid.Normal,keyboardArrays.normals],[lines.Position,keyboardArrays.positions]]) {
      gl.bindBuffer(gl.ARRAY_BUFFER,handle);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
    }
  }
  const cubeSolid={Position:buffer(new Float32Array()),Color:buffer(new Float32Array()),
    Normal:buffer(new Float32Array()),Emission:buffer(new Float32Array())};
  const cubeLines={Position:buffer(new Float32Array()),Color:buffer(new Float32Array())};
  function updateCube(state) {
    const states=state?.cubes??(state?[state]:HOLODECK_CUBES.map(c=>({...c,position:c.center})));
    const parts=states.map((cube,i)=>createHolodeckCubeGeometry({...cube,pointers:i===0?state?.pointers:[]}));
    const g=Object.fromEntries(['positions','colors','solidPositions','solidColors','normals','emissions']
      .map(key=>[key,new Float32Array(parts.flatMap(part=>Array.from(part[key])))]));
    g.vertexCount=g.positions.length/3;
    g.groups=states.map((cube,i)=>({position:cube.position,first:i*36,count:36}));
    for(const [batch,fields] of [[cubeSolid,{Position:g.solidPositions,Color:g.solidColors,Normal:g.normals,Emission:g.emissions}],
      [cubeLines,{Position:g.positions,Color:g.colors}]]) for(const [key,data] of Object.entries(fields)) {
      gl.bindBuffer(gl.ARRAY_BUFFER,batch[key]);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
    }
    return g;
  }
  function bind(batch) {
    for (const [name,location] of Object.entries(attributes)) {
      if (batch[name]) {
        gl.bindBuffer(gl.ARRAY_BUFFER,batch[name]); gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location,name==='Emission'?1:3,gl.FLOAT,false,0,0);
      } else {
        gl.disableVertexAttribArray(location);
        if (name==='Emission') gl.vertexAttrib1f(location,1); else gl.vertexAttrib3f(location,0,1,0);
      }
    }
  }
  function begin(framebuffer) {
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0.06,0.10,0.14,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT); gl.useProgram(program);
  }
  function draw(projection,view,cube) {
    gl.uniformMatrix4fv(projectionLocation,false,projection); gl.uniformMatrix4fv(viewLocation,false,view);
    gl.uniform1f(glassLocation,0);
    bind(solid); gl.drawArrays(gl.TRIANGLES,0,geometry.solidVertexCount);
    bind(lines); gl.drawArrays(gl.LINES,0,geometry.vertexCount);
    display?.draw(projection,view);
    gl.useProgram(program);
    const eye=[-view[0]*view[12]-view[1]*view[13]-view[2]*view[14],
      -view[4]*view[12]-view[5]*view[13]-view[6]*view[14],-view[8]*view[12]-view[9]*view[13]-view[10]*view[14]];
    gl.uniform3f(eyeLocation,...eye);
    gl.uniform1f(glassLocation,1);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);gl.enable(gl.CULL_FACE);bind(cubeSolid);
    // Sort transparent bodies for each eye, drawing each one's back faces first.
    const distance=group=>Math.hypot(...group.position.map((v,i)=>v-eye[i]));
    for(const group of [...cube.groups].sort((a,b)=>distance(b)-distance(a))) {
      gl.cullFace(gl.FRONT);gl.drawArrays(gl.TRIANGLES,group.first,group.count);
      gl.cullFace(gl.BACK);gl.drawArrays(gl.TRIANGLES,group.first,group.count);
    }
    gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.depthMask(true);gl.uniform1f(glassLocation,0);
    bind(cubeLines);gl.drawArrays(gl.LINES,0,cube.vertexCount);
  }
  const locomotionView=new Float32Array(16);
  function drawFrame(frame,referenceSpace,{pose=frame.getViewerPose(referenceSpace),navigation,cube:state}={}) {
    updateKeyboard();
    display?.update();
    const layer=frame.session.renderState.baseLayer; begin(layer.framebuffer);
    if (!pose) return {poseAvailable:false,viewCount:0};
    const cube=updateCube(state);
    for (const view of pose.views) {
      const viewport=layer.getViewport(view); gl.viewport(viewport.x,viewport.y,viewport.width,viewport.height);
      draw(view.projectionMatrix,navigation?applyHolodeckLocomotionToView(view.transform.inverse.matrix,navigation,locomotionView):view.transform.inverse.matrix,cube);
    }
    return {poseAvailable:true,viewCount:pose.views.length};
  }
  function drawPreview({width=gl.drawingBufferWidth,height=gl.drawingBufferHeight,eye=[3.4,2.35,2.1],target=[0,1.15,-2.2],cube:state}={}) {
    updateKeyboard();
    display?.update();
    const {projection,view}=previewMatrices(Math.max(1,width),Math.max(1,height),eye,target);
    begin(null); gl.viewport(0,0,width,height); draw(projection,view,updateCube(state));
  }
  function dispose() { display?.dispose();buffers.forEach(handle=>gl.deleteBuffer(handle)); gl.deleteProgram(program); }
  return Object.freeze({geometry,drawFrame,drawPreview,dispose});
}
