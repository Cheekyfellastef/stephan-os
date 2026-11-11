import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { verifyHostedSpatialPwaIcons } from '../apps/spatial-bridge/tools/verify-hosted-icons.mjs';

const table = new Uint32Array(256);
for (let n = 0; n < table.length; n += 1) {
  let value = n;
  for (let k = 0; k < 8; k += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  table[n] = value >>> 0;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data = Buffer.alloc(0)) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}
function png(size) {
  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(size);
  hdr.writeUInt32BE(size, 4);
  hdr[8] = 8;
  hdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', hdr), chunk('IDAT', deflateSync(raw)), chunk('IEND')]);
}
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-pwa-'));
  mkdirSync(join(root, 'icons'));
  writeFileSync(join(root, 'manifest.webmanifest'), JSON.stringify({icons:[192,512].map(size => ({
    src:`./icons/icon-${size}.png`, type:'image/png', sizes:`${size}x${size}`,
  }))}));
  for (const size of [192,512]) writeFileSync(join(root,'icons',`icon-${size}.png`), png(size));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
const iconPath = root => join(root,'icons','icon-192.png');
function mutate(root, mutateFn) {
  const path = iconPath(root);
  writeFileSync(path, mutateFn(readFileSync(path)));
}

test('both valid generated-format 192 and 512 icons pass', () => fixture(root => {
  assert.deepEqual(verifyHostedSpatialPwaIcons(root).map(x => x.size), [192,512]);
}));
test('manifest without declared file fails', () => fixture(root => {
  writeFileSync(join(root,'manifest.webmanifest'), JSON.stringify({icons:[]}));
  assert.throws(() => verifyHostedSpatialPwaIcons(root), /MANIFEST_ICON_MISSING:192/);
}));
test('truncated IHDR-only file with correct signature and dimensions fails', () => fixture(root => {
  mutate(root, file => file.subarray(0,33));
  assert.throws(() => verifyHostedSpatialPwaIcons(root), /PNG_INVALID:192/);
}));
test('shortened IDAT without IEND fails', () => fixture(root => {
  mutate(root, file => file.subarray(0,file.length - 12));
  assert.throws(() => verifyHostedSpatialPwaIcons(root), /PNG_INCOMPLETE:192/);
}));
test('wrong dimensions fail even with recomputed CRC', () => fixture(root => {
  mutate(root, file => {const out=Buffer.from(file);out.writeUInt32BE(190,16);
    out.writeUInt32BE(crc32(out.subarray(12,29)),29);return out;});
  assert.throws(() => verifyHostedSpatialPwaIcons(root), /DIMENSIONS_INVALID:192/);
}));
test('corrupted IDAT checksum fails', () => fixture(root => {
  mutate(root, file => {const out=Buffer.from(file);out[50] ^= 1;return out;});
  assert.throws(() => verifyHostedSpatialPwaIcons(root), /CRC_INVALID:192/);
}));
test('invalid compressed image with valid CRC fails decompression', () => fixture(root => {
  mutate(root, file => {const bad=Buffer.from(file);
    const offset=33;const len=bad.readUInt32BE(offset);
    bad[offset+8]=0xff;
    bad.writeUInt32BE(crc32(bad.subarray(offset+4,offset+8+len)),offset+8+len);
    return bad;});
  assert.throws(() => verifyHostedSpatialPwaIcons(root), /DATA_INVALID:192/);
}));
test('trailing bytes after IEND refuse', () => fixture(root => {
  mutate(root, file => Buffer.concat([file,Buffer.from([0])]));
  assert.throws(() => verifyHostedSpatialPwaIcons(root), /IEND_INVALID:192/);
}));
test('no arbitrary chunks allowed before IEND', () => fixture(root => {
  mutate(root, file => Buffer.concat([file.subarray(0,file.length-12),chunk('tEXt',Buffer.from('x')),
    file.subarray(file.length-12)]));
  assert.throws(() => verifyHostedSpatialPwaIcons(root), /CHUNK_UNEXPECTED:192/);
}));
