import { HOLODECK_DISPLAY as d, HOLODECK_CONSOLE as c } from './holodeck-layout-v1.mjs';
import { consolePointToWorld } from './holodeck-comfort-v1.mjs';
import { buildHolodeckKeycaps, keycapPressTravel, KEYCAP_VERTEX_COUNT, KEYCAP_VERTEX_STRIDE } from './holodeck-keycaps-v1.mjs';

// The same labelled canvas now covers individually extruded 3D keycaps.
// Sidewalls and cap tops share the room's stereo depth, hinge and hit targets.
export function createHolodeckDisplayRenderer({gl,screen,comfort=screen?.comfort}) {
  const shaders=[],buffers=[],textures=[];let program,version=-1;
  function dispose(){buffers.forEach(b=>gl.deleteBuffer(b));textures.forEach(t=>gl.deleteTexture(t));shaders.forEach(s=>gl.deleteShader(s));if(program)gl.deleteProgram(program);}
  try {
    for(const [type,source] of [[gl.VERTEX_SHADER,`
      attribute vec3 aDisplayPosition;attribute vec2 aDisplayUv;attribute float aDisplayMaterial;
      uniform mat4 uDisplayProjection;uniform mat4 uDisplayView;varying vec2 vUv;varying float vMaterial;
      void main(){vUv=aDisplayUv;vMaterial=aDisplayMaterial;gl_Position=uDisplayProjection*uDisplayView*vec4(aDisplayPosition,1.0);}`],
      [gl.FRAGMENT_SHADER,`precision mediump float;varying vec2 vUv;varying float vMaterial;uniform sampler2D uDisplayTexture;
      void main(){
        if(vMaterial>0.5){
          float light=clamp(vMaterial-1.0,0.0,1.0);
          gl_FragColor=vec4(mix(vec3(0.065,0.135,0.18),vec3(0.19,0.44,0.54),light),1.0);
        }else gl_FragColor=texture2D(uDisplayTexture,vUv);
      }`]]) {
      const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('Hologram shader unavailable');
    }
    program=gl.createProgram();shaders.forEach(shader=>gl.attachShader(program,shader));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Hologram program unavailable');
    const positions=[
      [-d.halfWidth,d.top,d.z],[d.halfWidth,d.top,d.z],[d.halfWidth,d.bottom,d.z],[-d.halfWidth,d.bottom,d.z],
      [-c.halfWidth+0.1,c.top+0.002,c.center[2]-c.halfDepth+0.06],[c.halfWidth-0.1,c.top+0.002,c.center[2]-c.halfDepth+0.06],
      [c.halfWidth-0.1,c.top+0.002,c.center[2]+c.halfDepth-0.06],[-c.halfWidth+0.1,c.top+0.002,c.center[2]+c.halfDepth-0.06],
    ];
    const uv=[[0,0],[1,0],[1,1],[0,1]],buffer=gl.createBuffer();buffers.push(buffer);
    let poseVersion='';
    function updateGeometry(tilt,motion) {
      const travel=motion?keycapPressTravel(motion.ageMs):0;
      const next=`${tilt}:${motion?.id||''}:${Math.round(travel*1000000)}`;
      if(next===poseVersion)return;
      poseVersion=next;
      const vertices=[];
      for(const offset of [0,4])for(const index of [0,1,2,0,2,3])
        vertices.push(...(offset?consolePointToWorld(positions[offset+index],tilt):positions[index]),...uv[index],0);
      const cap=buildHolodeckKeycaps({keyboardTilt:tilt,pressedId:motion?.id,pressAgeMs:motion?.ageMs});
      vertices.push(...cap);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);
    }
    for(let i=0;i<2;i++) {
      const texture=gl.createTexture();textures.push(texture);gl.bindTexture(gl.TEXTURE_2D,texture);
      for(const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);
      for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.LINEAR);
    }
    const position=gl.getAttribLocation(program,'aDisplayPosition'),uvLocation=gl.getAttribLocation(program,'aDisplayUv');
    const material=gl.getAttribLocation(program,'aDisplayMaterial');
    const projection=gl.getUniformLocation(program,'uDisplayProjection'),view=gl.getUniformLocation(program,'uDisplayView'),sampler=gl.getUniformLocation(program,'uDisplayTexture');
    return {
      update(){
        updateGeometry(comfort?.getState().keyboardTilt??0,screen.getKeycapMotion?.()??null);
        const frame=screen.render();if(frame.revision===version)return;version=frame.revision;
        gl.activeTexture(gl.TEXTURE0);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
        [frame.screen,frame.console].forEach((canvas,i)=>{gl.bindTexture(gl.TEXTURE_2D,textures[i]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);});
      },
      draw(p,v){
        gl.useProgram(program);gl.uniformMatrix4fv(projection,false,p);gl.uniformMatrix4fv(view,false,v);gl.uniform1i(sampler,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,3,gl.FLOAT,false,KEYCAP_VERTEX_STRIDE*4,0);
        gl.enableVertexAttribArray(uvLocation);gl.vertexAttribPointer(uvLocation,2,gl.FLOAT,false,KEYCAP_VERTEX_STRIDE*4,12);
        gl.enableVertexAttribArray(material);gl.vertexAttribPointer(material,1,gl.FLOAT,false,KEYCAP_VERTEX_STRIDE*4,20);
        gl.activeTexture(gl.TEXTURE0);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
        textures.forEach((texture,i)=>{
          gl.bindTexture(gl.TEXTURE_2D,texture);gl.drawArrays(gl.TRIANGLES,i*6,6);
          if(i===1)gl.drawArrays(gl.TRIANGLES,12,KEYCAP_VERTEX_COUNT);
        });
        gl.disable(gl.BLEND);gl.disableVertexAttribArray(position);gl.disableVertexAttribArray(uvLocation);gl.disableVertexAttribArray(material);
      },dispose,
    };
  } catch(error){dispose();throw error;}
}
