const ICE = Object.freeze([0.58, 0.9, 1.0]);
const GRID = Object.freeze([0.16, 0.43, 0.62]);
const GRID_SOFT = Object.freeze([0.08, 0.22, 0.34]);
const FRAME = Object.freeze([0.36, 0.72, 0.92]);
const PEDESTAL = Object.freeze([0.38, 0.62, 0.76]);

function pushLine(positions, colors, a, b, color = GRID) {
  positions.push(...a, ...b);
  colors.push(...color, ...color);
}

function pushBox(positions, colors, center, size, color = ICE) {
  const [cx, cy, cz] = center;
  const h = size / 2;
  const p = [
    [cx-h, cy-h, cz-h], [cx+h, cy-h, cz-h],
    [cx+h, cy+h, cz-h], [cx-h, cy+h, cz-h],
    [cx-h, cy-h, cz+h], [cx+h, cy-h, cz+h],
    [cx+h, cy+h, cz+h], [cx-h, cy+h, cz+h],
  ];
  const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  edges.forEach(([a,b]) => pushLine(positions, colors, p[a], p[b], color));
}

function pushRing(positions, colors, center, radius, segments = 48, color = FRAME) {
  const [cx, cy, cz] = center;
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const b = ((i + 1) / segments) * Math.PI * 2;
    pushLine(positions, colors,
      [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, cz],
      [cx + Math.cos(b) * radius, cy + Math.sin(b) * radius, cz], color);
  }
}
export function createHolodeckRoomGeometry() {
  const positions = [];
  const colors = [];
  const halfWidth = 5;
  const frontZ = -6;
  const backZ = 3;
  const height = 3.2;

  for (let x = -halfWidth; x <= halfWidth + 0.001; x += 0.5) {
    pushLine(positions, colors, [x, 0, frontZ], [x, 0, backZ], x % 1 === 0 ? GRID : GRID_SOFT);
  }
  for (let z = frontZ; z <= backZ + 0.001; z += 0.5) {
    pushLine(positions, colors, [-halfWidth, 0, z], [halfWidth, 0, z], Math.abs(z % 1) < 0.001 ? GRID : GRID_SOFT);
  }

  for (let x = -halfWidth; x <= halfWidth + 0.001; x += 1) {
    pushLine(positions, colors, [x, 0, frontZ], [x, height, frontZ], GRID);
  }
  for (let y = 0; y <= height + 0.001; y += 0.5) {
    pushLine(positions, colors, [-halfWidth, y, frontZ], [halfWidth, y, frontZ], y % 1 === 0 ? GRID : GRID_SOFT);
  }

  for (const sideX of [-halfWidth, halfWidth]) {
    for (let z = frontZ; z <= backZ + 0.001; z += 1) {
      pushLine(positions, colors, [sideX, 0, z], [sideX, height, z], GRID_SOFT);
    }
    for (let y = 0; y <= height + 0.001; y += 1) {
      pushLine(positions, colors, [sideX, y, frontZ], [sideX, y, backZ], GRID_SOFT);
    }
  }
  pushLine(positions, colors, [-halfWidth, 0, frontZ], [halfWidth, 0, frontZ], FRAME);
  pushLine(positions, colors, [-halfWidth, height, frontZ], [halfWidth, height, frontZ], FRAME);
  pushLine(positions, colors, [-halfWidth, 0, frontZ], [-halfWidth, height, frontZ], FRAME);
  pushLine(positions, colors, [halfWidth, 0, frontZ], [halfWidth, height, frontZ], FRAME);

  const pedestalZ = -2.2;
  const pedestalHalf = 0.55;
  const pedestalTop = 0.72;
  pushLine(positions, colors, [-pedestalHalf, 0.02, pedestalZ-pedestalHalf], [pedestalHalf, 0.02, pedestalZ-pedestalHalf], PEDESTAL);
  pushLine(positions, colors, [pedestalHalf, 0.02, pedestalZ-pedestalHalf], [pedestalHalf, 0.02, pedestalZ+pedestalHalf], PEDESTAL);
  pushLine(positions, colors, [pedestalHalf, 0.02, pedestalZ+pedestalHalf], [-pedestalHalf, 0.02, pedestalZ+pedestalHalf], PEDESTAL);
  pushLine(positions, colors, [-pedestalHalf, 0.02, pedestalZ+pedestalHalf], [-pedestalHalf, 0.02, pedestalZ-pedestalHalf], PEDESTAL);
  for (const [x,z] of [[-pedestalHalf,-pedestalHalf],[pedestalHalf,-pedestalHalf],[pedestalHalf,pedestalHalf],[-pedestalHalf,pedestalHalf]]) {
    pushLine(positions, colors, [x, 0.02, pedestalZ+z], [x, pedestalTop, pedestalZ+z], PEDESTAL);
  }

  pushBox(positions, colors, [0, 1.18, pedestalZ], 0.58, ICE);
  pushRing(positions, colors, [0, 1.55, frontZ + 0.03], 1.0, 56, FRAME);
  pushRing(positions, colors, [0, 1.55, frontZ + 0.03], 0.84, 56, GRID);

  return Object.freeze({
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    vertexCount: positions.length / 3,
    primitive: 'LINES',
    room: Object.freeze({ halfWidth, frontZ, backZ, height }),
    ideaCube: Object.freeze({ center: [0, 1.18, pedestalZ], size: 0.58 }),
  });
}
function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'shader compile failed';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `
    attribute vec3 aPosition;
    attribute vec3 aColor;
    uniform mat4 uProjection;
    uniform mat4 uView;
    varying vec3 vColor;
    void main() {
      vColor = aColor;
      gl_Position = uProjection * uView * vec4(aPosition, 1.0);
    }
  `);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec3 vColor;
    void main() {
      gl_FragColor = vec4(vColor, 1.0);
    }
  `);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'program link failed';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}
export function createHolodeckRoomRenderer({ gl } = {}) {
  if (!gl) throw new Error('WebGL context required');
  const geometry = createHolodeckRoomGeometry();
  const program = createProgram(gl);
  const positionBuffer = gl.createBuffer();
  const colorBuffer = gl.createBuffer();
  const positionLocation = gl.getAttribLocation(program, 'aPosition');
  const colorLocation = gl.getAttribLocation(program, 'aColor');
  const projectionLocation = gl.getUniformLocation(program, 'uProjection');
  const viewLocation = gl.getUniformLocation(program, 'uView');

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.colors, gl.STATIC_DRAW);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);

  function drawFrame(frame, referenceSpace) {
    const layer = frame.session.renderState.baseLayer;
    const pose = frame.getViewerPose(referenceSpace);
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0.006, 0.015, 0.028, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!pose) return;

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.enableVertexAttribArray(colorLocation);
    gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 0, 0);
    for (const view of pose.views) {
      const viewport = layer.getViewport(view);
      gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
      gl.uniformMatrix4fv(projectionLocation, false, view.projectionMatrix);
      gl.uniformMatrix4fv(viewLocation, false, view.transform.inverse.matrix);
      gl.drawArrays(gl.LINES, 0, geometry.vertexCount);
    }
  }

  function dispose() {
    gl.deleteBuffer(positionBuffer);
    gl.deleteBuffer(colorBuffer);
    gl.deleteProgram(program);
  }

  return Object.freeze({
    geometry,
    drawFrame,
    dispose,
  });
}
