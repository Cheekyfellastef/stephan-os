import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_SPEC_PATH = resolve(REPO_ROOT, 'apps/spatial-bridge/icons/icon-source.json');
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, 'apps/spatial-bridge/icons');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function blendPixel(pixels, size, x, y, color, alpha = 1) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= size || py >= size) return;
  const offset = (py * size + px) * 4;
  const a = Math.max(0, Math.min(1, alpha));
  pixels[offset] = clampByte(pixels[offset] * (1 - a) + color[0] * a);
  pixels[offset + 1] = clampByte(pixels[offset + 1] * (1 - a) + color[1] * a);
  pixels[offset + 2] = clampByte(pixels[offset + 2] * (1 - a) + color[2] * a);
  pixels[offset + 3] = 255;
}

function drawDisc(pixels, size, cx, cy, radius, color, alpha = 1) {
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);
  const softEdge = Math.max(1, radius * 0.12);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance > radius) continue;
      const edgeAlpha = Math.min(1, (radius - distance) / softEdge);
      blendPixel(pixels, size, x, y, color, alpha * edgeAlpha);
    }
  }
}

function drawLine(pixels, size, x0, y0, x1, y1, width, color, alpha = 1) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    drawDisc(
      pixels,
      size,
      x0 + ((x1 - x0) * t),
      y0 + ((y1 - y0) * t),
      width / 2,
      color,
      alpha,
    );
  }
}

function drawArc(pixels, size, cx, cy, radius, startRadians, endRadians, width, color, alpha = 1) {
  const arcLength = Math.abs(endRadians - startRadians) * radius;
  const steps = Math.max(24, Math.ceil(arcLength * 1.5));
  let previous = null;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const angle = startRadians + ((endRadians - startRadians) * t);
    const point = [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
    if (previous) drawLine(pixels, size, previous[0], previous[1], point[0], point[1], width, color, alpha);
    previous = point;
  }
}

function createPixelBuffer(size, spec) {
  const pixels = Buffer.alloc(size * size * 4);
  const top = spec.background.top;
  const bottom = spec.background.bottom;

  for (let y = 0; y < size; y += 1) {
    const t = y / Math.max(1, size - 1);
    for (let x = 0; x < size; x += 1) {
      const radial = Math.max(0, 1 - Math.hypot(x - size * 0.5, y - size * 0.38) / (size * 0.72));
      const offset = (y * size + x) * 4;
      pixels[offset] = clampByte(top[0] * (1 - t) + bottom[0] * t + radial * 9);
      pixels[offset + 1] = clampByte(top[1] * (1 - t) + bottom[1] * t + radial * 19);
      pixels[offset + 2] = clampByte(top[2] * (1 - t) + bottom[2] * t + radial * 26);
      pixels[offset + 3] = 255;
    }
  }

  const scale = size / 512;
  const cx = size / 2;
  const cy = size * 0.51;
  const bridge = spec.bridgeArc;
  const core = spec.captainCore;

  drawDisc(pixels, size, cx, cy, 78 * scale, bridge, 0.08);
  drawArc(pixels, size, cx, cy + 12 * scale, 170 * scale, Math.PI * 1.08, Math.PI * 1.92, 14 * scale, bridge, 0.82);
  drawArc(pixels, size, cx, cy + 18 * scale, 128 * scale, Math.PI * 1.12, Math.PI * 1.88, 8 * scale, core, 0.72);
  drawLine(pixels, size, cx - 145 * scale, cy + 57 * scale, cx - 72 * scale, cy + 112 * scale, 13 * scale, bridge, 0.76);
  drawLine(pixels, size, cx + 145 * scale, cy + 57 * scale, cx + 72 * scale, cy + 112 * scale, 13 * scale, bridge, 0.76);
  drawLine(pixels, size, cx - 72 * scale, cy + 112 * scale, cx + 72 * scale, cy + 112 * scale, 12 * scale, core, 0.75);

  drawDisc(pixels, size, cx, cy + 20 * scale, 54 * scale, bridge, 0.18);
  drawDisc(pixels, size, cx, cy + 20 * scale, 32 * scale, core, 0.92);
  drawDisc(pixels, size, cx, cy + 20 * scale, 15 * scale, [235, 252, 255], 0.92);
  drawDisc(pixels, size, cx - 126 * scale, cy + 68 * scale, 13 * scale, spec.statusNominal, 0.95);
  drawDisc(pixels, size, cx + 126 * scale, cy + 68 * scale, 13 * scale, spec.statusGuarded, 0.95);

  return pixels;
}

export function generateSpatialBridgeIcon(size, spec) {
  if (!Number.isInteger(size) || size < 32 || size > 2048) throw new Error(`Unsupported icon size: ${size}`);
  const pixels = createPixelBuffer(size, spec);
  const scanlineLength = (size * 4) + 1;
  const raw = Buffer.alloc(scanlineLength * size);

  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * scanlineLength;
    raw[rowOffset] = 0;
    pixels.copy(raw, rowOffset + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND'),
  ]);
}

export function writeSpatialBridgeIcons({ specPath = DEFAULT_SPEC_PATH, outputDir = DEFAULT_OUTPUT_DIR } = {}) {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  mkdirSync(outputDir, { recursive: true });
  const outputs = [];

  for (const size of spec.outputSizes) {
    const outputPath = resolve(outputDir, `icon-${size}.png`);
    writeFileSync(outputPath, generateSpatialBridgeIcon(size, spec));
    outputs.push(outputPath);
  }

  return outputs;
}

function parseOutputDir(argv) {
  const index = argv.indexOf('--output-dir');
  return index >= 0 && argv[index + 1] ? resolve(argv[index + 1]) : DEFAULT_OUTPUT_DIR;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputs = writeSpatialBridgeIcons({ outputDir: parseOutputDir(process.argv.slice(2)) });
  for (const output of outputs) console.log(`[spatial-bridge-icons] generated ${output}`);
}
