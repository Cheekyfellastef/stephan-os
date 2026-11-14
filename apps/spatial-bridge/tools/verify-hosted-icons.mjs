import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function requireIcon(condition, code, size) {
  if (!condition) throw new Error(`SPATIAL_PWA_ICON_${code}:${size}`);
}

export function verifyHostedSpatialPwaIcons(siteRoot) {
  const root = resolve(siteRoot);
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  const results = [];
  for (const size of [192, 512]) {
    const src = `./icons/icon-${size}.png`;
    const entry = manifest.icons?.find(icon => icon.src === src
      && icon.type === 'image/png' && icon.sizes === `${size}x${size}`);
    requireIcon(Boolean(entry), 'MANIFEST_ICON_MISSING', size);
    const png = readFileSync(join(root, 'icons', `icon-${size}.png`));
    requireIcon(png.length >= 57 && png.subarray(0, 8).equals(PNG_SIGNATURE), 'PNG_INVALID', size);

    let offset = 8;
    let ihdrSeen = false;
    let iendSeen = false;
    const compressed = [];
    let compressedBytes = 0;
    while (offset < png.length) {
      requireIcon(offset + 12 <= png.length, 'CHUNK_TRUNCATED', size);
      const length = png.readUInt32BE(offset);
      const type = png.toString('latin1', offset + 4, offset + 8);
      const end = offset + length + 12;
      requireIcon(end <= png.length, 'CHUNK_TRUNCATED', size);
      const chunkBytes = png.subarray(offset + 4, end - 4);
      requireIcon(crc32(chunkBytes) === png.readUInt32BE(end - 4), 'CRC_INVALID', size);
      if (type === 'IHDR') {
        requireIcon(!ihdrSeen && offset === 8 && length === 13, 'IHDR_INVALID', size);
        ihdrSeen = true;
        requireIcon(png.readUInt32BE(offset + 8) === size && png.readUInt32BE(offset + 12) === size
          && png[offset + 16] === 8 && png[offset + 17] === 6
          && png[offset + 18] === 0 && png[offset + 19] === 0 && png[offset + 20] === 0,
        'DIMENSIONS_INVALID', size);
      } else if (type === 'IDAT') {
        requireIcon(ihdrSeen && !iendSeen && compressedBytes + length <= 5 * 1024 * 1024,
          'DATA_INVALID', size);
        compressed.push(png.subarray(offset + 8, offset + 8 + length));
        compressedBytes += length;
      } else if (type === 'IEND') {
        requireIcon(ihdrSeen && compressed.length > 0 && length === 0 && end === png.length,
          'IEND_INVALID', size);
        iendSeen = true;
      } else {
        requireIcon(false, 'CHUNK_UNEXPECTED', size);
      }
      offset = end;
    }
    requireIcon(ihdrSeen && iendSeen && compressed.length > 0, 'PNG_INCOMPLETE', size);
    const encoded = Buffer.concat(compressed);
    let raw;
    let consumed;
    const rowBytes = size * 4 + 1;
    try {
      const inflated = inflateSync(encoded, { maxOutputLength: rowBytes * size, info: true });
      raw = inflated.buffer;
      consumed = inflated.engine.bytesWritten;
    } catch {
      requireIcon(false, 'DATA_INVALID', size);
    }
    requireIcon(consumed === encoded.length && raw.length === rowBytes * size,
      'DATA_INVALID', size);
    for (let row = 0; row < size; row += 1) {
      requireIcon(raw[row * rowBytes] === 0, 'SCANLINE_INVALID', size);
    }
    results.push({ size, bytes: png.length });
  }
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const index = process.argv.indexOf('--site-root');
  if (index < 0 || !process.argv[index + 1]) throw new Error('SPATIAL_PWA_SITE_ROOT_REQUIRED');
  const results = verifyHostedSpatialPwaIcons(process.argv[index + 1]);
  console.log(`SPATIAL_PWA_ICONS_VERIFIED:${results.map(item => item.size).join(',')}`);
}
