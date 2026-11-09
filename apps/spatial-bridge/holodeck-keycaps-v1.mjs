// The same keyboard atlas drives the visible key labels and their raised 3D faces.
// Geometry stays in console-local coordinates until the existing keyboard hinge moves it.
import { HOLODECK_CONSOLE } from './holodeck-layout-v1.mjs';
import { consolePointToWorld } from './holodeck-comfort-v1.mjs';
import { SCREEN_KEYS } from './holodeck-screen-v1.mjs';

export const KEYCAP_RISE_METRES = 0.034;
export const KEYCAP_BODY_METRES = 0.022;
export const KEYCAP_TRAVEL_METRES = 0.011;
export const KEYCAP_PRESS_DURATION_MS = 210;
export const KEYCAP_VERTEX_STRIDE = 6; // position xyz, original atlas uv, face material

// A 45 ms downstroke, brief bottom contact, and decelerating 140 ms spring return.
// Input is a timestamped visual event, not an extra keyboard/Windows authority path.
export function keycapPressTravel(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= KEYCAP_PRESS_DURATION_MS) return 0;
  if (ageMs < 45) {
    const t = ageMs / 45;
    return KEYCAP_TRAVEL_METRES * (1 - (1 - t) ** 2);
  }
  if (ageMs < 70) return KEYCAP_TRAVEL_METRES;
  const remaining = (KEYCAP_PRESS_DURATION_MS - ageMs) / 140;
  return KEYCAP_TRAVEL_METRES * remaining * remaining;
}

const c = HOLODECK_CONSOLE;
const left = -c.halfWidth + 0.1, front = c.center[2] - c.halfDepth + 0.06;
const width = 2 * c.halfWidth - 0.2, depth = 2 * c.halfDepth - 0.12;
const insetU = 0.002 / width, insetV = 0.002 / depth;
const vertexCountPerKey = 30; // top + 4 solid, individually movable sides

export const KEYCAP_VERTEX_COUNT = SCREEN_KEYS.length * vertexCountPerKey;

// Textured top plus shaded solid sidewalls. The top is slightly inset, so there
// are real air gaps rather than one continuous holographic touch surface.
export function buildHolodeckKeycaps({ keyboardTilt = 0, pressedId = '', pressAgeMs = Infinity, furnitureOffset = [0,0,0] } = {}) {
  const vertices = [];
  const vertex = (point, uv, material) => {
    const position = consolePointToWorld(point, keyboardTilt).map((value,i)=>value+furnitureOffset[i]);
    vertices.push(...position, ...uv, material);
  };
  const quad = (p, uv, material) => {
    for (const i of [0, 1, 2, 0, 2, 3]) vertex(p[i], uv[i], material);
  };
  for (const key of SCREEN_KEYS) {
    const u0 = key.x + insetU, u1 = key.x + key.w - insetU;
    const v0 = key.y + insetV, v1 = key.y + key.h - insetV;
    const x0 = left + u0 * width, x1 = left + u1 * width;
    const z0 = front + v0 * depth, z1 = front + v1 * depth;
    const depression = key.id === pressedId ? keycapPressTravel(pressAgeMs) : 0;
    const top = c.top + KEYCAP_RISE_METRES - depression;
    const bottom = top - KEYCAP_BODY_METRES;
    const high = [[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]];
    const low = high.map(([x, , z]) => [x, bottom, z]);
    quad(high, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], 0);
    // Material >0 signals a real opaque ceramic side, not the flat canvas.
    const blank = [[0, 0], [0, 0], [0, 0], [0, 0]];
    quad([low[0], low[1], high[1], high[0]], blank, 1.65); // far wall
    quad([low[1], low[2], high[2], high[1]], blank, 1.33);
    quad([low[2], low[3], high[3], high[2]], blank, 1.88); // nearest bright edge
    quad([low[3], low[0], high[0], high[3]], blank, 1.20);
  }
  return new Float32Array(vertices);
}
