import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONCEPT_CATALOG } from '../../apps/vr-capability-atlas/atlas-concepts.mjs';
import {
  MEDIA_ASSET_FABRIC_SCHEMA,
  MEDIA_COLLECTION_VR_ATLAS,
  mediaAssetApiPath,
  mediaVariantSpec,
  validateMediaAssetPointer,
} from '../../shared/media/mediaAssetFabricV1.mjs';

const serviceFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(serviceFile), '../..');
export const DEFAULT_MEDIA_CACHE_ROOT = resolve(repoRoot, '.stephanos', 'media-cache');

const conceptsById = new Map(CONCEPT_CATALOG.map((concept) => [concept.id, concept]));
const PALETTES = Object.freeze({
  'spatial-bridge': ['#050b18', '#0f6d8d', '#5ce7ff', '#9d8cff'],
  'embodied-exploration': ['#06140f', '#0e7355', '#69f3b1', '#87a7ff'],
  'immersive-engineering': ['#100a08', '#925b27', '#ffd26f', '#6fe8ff'],
  'spatial-collaboration': ['#0b0a18', '#554092', '#b494ff', '#61e6ff'],
  'living-starship': ['#050a13', '#155f84', '#72dcff', '#ffb96f'],
  'physical-interaction': ['#0d0d10', '#3e6a79', '#79f0ff', '#f5c46f'],
  'adaptive-dialogue': ['#110b15', '#6f3d71', '#f0a8ff', '#6fe9d4'],
  'cinematic-theatre': ['#050507', '#302f55', '#8cb8ff', '#f2d78c'],
  'flat-to-vr-lab': ['#060c13', '#165d6f', '#62e9ff', '#8dffb1'],
  'capability-factory': ['#070a13', '#3a4a8d', '#7cecff', '#b28cff'],
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[char]));
}

function seedFor(value) {
  const digest = createHash('sha256').update(String(value)).digest();
  return digest.readUInt32BE(0);
}

function stars(seed, width, height, accent) {
  let state = seed || 1;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  const count = Math.max(42, Math.round(width / 42));
  const parts = [];
  for (let index = 0; index < count; index += 1) {
    const x = Math.round(next() * width);
    const y = Math.round(next() * height * 0.72);
    const r = (0.55 + next() * 1.7).toFixed(2);
    const opacity = (0.22 + next() * 0.72).toFixed(2);
    parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${index % 9 === 0 ? accent : '#dff7ff'}" opacity="${opacity}"/>`);
  }
  return parts.join('');
}

function cockpitFrame(width, height, accent) {
  const w = width;
  const h = height;
  return [
    `<path d="M0 ${h * .84} L${w * .18} ${h * .69} L${w * .38} ${h * .72} L${w * .5} ${h * .95} L${w * .62} ${h * .72} L${w * .82} ${h * .69} L${w} ${h * .84} V${h} H0Z" fill="#02050b" opacity=".95"/>`,
    `<path d="M${w * .05} ${h * .88} L${w * .23} ${h * .76} H${w * .37} L${w * .44} ${h * .93}" fill="none" stroke="${accent}" stroke-width="${Math.max(2, w / 900)}" opacity=".55"/>`,
    `<path d="M${w * .95} ${h * .88} L${w * .77} ${h * .76} H${w * .63} L${w * .56} ${h * .93}" fill="none" stroke="${accent}" stroke-width="${Math.max(2, w / 900)}" opacity=".55"/>`,
  ].join('');
}

function handShape(x, y, scale, accent, mirror = false) {
  const transform = `translate(${x} ${y}) scale(${mirror ? -scale : scale} ${scale})`;
  return `<g transform="${transform}" fill="#08131f" stroke="${accent}" stroke-width="4"><path d="M0 80 C18 28 44 12 70 26 L84 8 C91 -3 104 3 101 18 L93 48 L108 21 C114 8 128 15 123 29 L111 59 L126 35 C132 23 145 30 139 43 L121 78 C112 100 95 116 68 124 C42 132 17 118 0 80Z"/><circle cx="68" cy="82" r="23" fill="none" opacity=".55"/></g>`;
}

function motif(assetId, width, height, accent, secondary) {
  const cx = width / 2;
  const cy = height / 2;
  const sw = Math.max(2, width / 900);
  switch (assetId) {
    case 'spatial-bridge':
      return `${cockpitFrame(width, height, accent)}<g filter="url(#glow)"><ellipse cx="${cx}" cy="${cy * .72}" rx="${width * .17}" ry="${height * .17}" fill="none" stroke="${accent}" stroke-width="${sw * 2}" opacity=".65"/><path d="M${cx - width * .25} ${height * .4} Q${cx} ${height * .16} ${cx + width * .25} ${height * .4}" fill="none" stroke="${secondary}" stroke-width="${sw}" opacity=".5"/></g>`;
    case 'embodied-exploration':
      return `<path d="M0 ${height * .72} Q${width * .18} ${height * .58} ${width * .36} ${height * .68} T${width * .72} ${height * .61} T${width} ${height * .7} V${height} H0Z" fill="#08241c"/><circle cx="${width * .78}" cy="${height * .24}" r="${height * .1}" fill="${secondary}" opacity=".28"/>${handShape(width * .2, height * .66, width / 2200, accent)}${handShape(width * .8, height * .66, width / 2200, accent, true)}<g stroke="${accent}" stroke-width="${sw}" opacity=".7"><path d="M${width * .38} ${height * .72} q20 -80 40 0 q20 -110 40 0"/><path d="M${width * .58} ${height * .7} q25 -100 50 0 q25 -70 45 0"/></g>`;
    case 'immersive-engineering':
      return `${handShape(width * .22, height * .67, width / 2300, accent)}${handShape(width * .78, height * .67, width / 2300, accent, true)}<g transform="translate(${cx} ${cy})" filter="url(#glow)"><circle r="${height * .18}" fill="#091621" stroke="${accent}" stroke-width="${sw * 2}"/><circle r="${height * .1}" fill="none" stroke="${secondary}" stroke-width="${sw}" stroke-dasharray="14 10"/><path d="M${-height * .24} 0 H${height * .24} M0 ${-height * .24} V${height * .24}" stroke="${accent}" stroke-width="${sw}" opacity=".55"/></g>`;
    case 'spatial-collaboration':
      return `<ellipse cx="${cx}" cy="${height * .69}" rx="${width * .28}" ry="${height * .09}" fill="#0b1830" stroke="${accent}" stroke-width="${sw}"/><ellipse cx="${cx}" cy="${height * .57}" rx="${width * .16}" ry="${height * .13}" fill="none" stroke="${secondary}" stroke-width="${sw * 1.4}" filter="url(#glow)"/>${[.28,.39,.61,.72].map((p,i)=>`<g transform="translate(${width*p} ${height*(.43+(i%2)*.05)})"><circle r="${height*.045}" fill="#13293c" stroke="${accent}" stroke-width="${sw}"/><path d="M${-height*.07} ${height*.11} Q0 ${height*.04} ${height*.07} ${height*.11}" fill="#13293c" stroke="${accent}" stroke-width="${sw}"/></g>`).join('')}`;
    case 'living-starship':
      return `${cockpitFrame(width, height, accent)}<circle cx="${width * .72}" cy="${height * .27}" r="${height * .13}" fill="url(#planet)"/><path d="M${width*.13} ${height*.22} L${width*.3} ${height*.35} M${width*.87} ${height*.22} L${width*.7} ${height*.35}" stroke="${accent}" stroke-width="${sw*2}" opacity=".35"/>`;
    case 'physical-interaction':
      return `${handShape(width * .2, height * .64, width / 2100, accent)}${handShape(width * .8, height * .64, width / 2100, accent, true)}<g transform="translate(${cx} ${height*.52})" filter="url(#glow)"><rect x="${-width*.09}" y="${-height*.08}" width="${width*.18}" height="${height*.16}" rx="22" fill="#0b1720" stroke="${accent}" stroke-width="${sw*1.5}"/><circle r="${height*.045}" fill="none" stroke="${secondary}" stroke-width="${sw}"/><path d="M${-width*.06} 0 H${width*.06}" stroke="${accent}" stroke-width="${sw}"/></g>`;
    case 'adaptive-dialogue':
      return `<g transform="translate(${width*.36} ${height*.5})"><circle cy="${-height*.09}" r="${height*.075}" fill="#172036" stroke="${accent}" stroke-width="${sw}"/><path d="M${-height*.12} ${height*.12} Q0 ${-height*.005} ${height*.12} ${height*.12}" fill="#172036" stroke="${accent}" stroke-width="${sw}"/></g><g transform="translate(${width*.65} ${height*.5})"><circle cy="${-height*.09}" r="${height*.075}" fill="#22172c" stroke="${secondary}" stroke-width="${sw}"/><path d="M${-height*.12} ${height*.12} Q0 ${-height*.005} ${height*.12} ${height*.12}" fill="#22172c" stroke="${secondary}" stroke-width="${sw}"/></g><path d="M${width*.43} ${height*.32} Q${cx} ${height*.2} ${width*.57} ${height*.32}" fill="none" stroke="${accent}" stroke-width="${sw}" stroke-dasharray="12 9" opacity=".75"/>`;
    case 'cinematic-theatre':
      return `<g filter="url(#glow)"><rect x="${width*.18}" y="${height*.2}" width="${width*.64}" height="${height*.4}" rx="${height*.025}" fill="#0c1830" stroke="${accent}" stroke-width="${sw*2}"/><rect x="${width*.215}" y="${height*.235}" width="${width*.57}" height="${height*.33}" rx="${height*.012}" fill="url(#screen)" opacity=".9"/></g><path d="M${width*.2} ${height*.77} Q${cx} ${height*.61} ${width*.8} ${height*.77}" fill="none" stroke="${secondary}" stroke-width="${sw}" opacity=".45"/>`;
    case 'flat-to-vr-lab':
      return `<g stroke-width="${sw}"><rect x="${width*.1}" y="${height*.28}" width="${width*.2}" height="${height*.28}" rx="18" fill="#0a1724" stroke="${accent}"/><rect x="${width*.4}" y="${height*.23}" width="${width*.2}" height="${height*.38}" rx="18" fill="#0b1e2a" stroke="${secondary}"/><rect x="${width*.7}" y="${height*.18}" width="${width*.2}" height="${height*.48}" rx="18" fill="#0c2630" stroke="${accent}"/></g><path d="M${width*.31} ${height*.42} H${width*.38} M${width*.61} ${height*.42} H${width*.68}" stroke="${accent}" stroke-width="${sw*2}" marker-end="url(#arrow)"/>`;
    case 'capability-factory':
      return `${[[-.24,-.08],[-.08,.12],[.12,-.13],[.27,.08],[0,-.01]].map(([x,y],i)=>`<g transform="translate(${cx+width*x} ${cy+height*y})" filter="url(#glow)"><circle r="${height*(.055+i*.004)}" fill="#101b35" stroke="${i%2?secondary:accent}" stroke-width="${sw*1.4}"/></g>`).join('')}<g stroke="${accent}" stroke-width="${sw}" opacity=".5"><path d="M${cx-width*.24} ${cy-height*.08} L${cx-width*.08} ${cy+height*.12} L${cx} ${cy-height*.01} L${cx+width*.12} ${cy-height*.13} L${cx+width*.27} ${cy+height*.08}"/></g>`;
    default:
      return `<circle cx="${cx}" cy="${cy}" r="${height*.18}" fill="none" stroke="${accent}" stroke-width="${sw*2}"/>`;
  }
}

export function renderVrAtlasVectorFallback(assetId, variant) {
  const concept = conceptsById.get(String(assetId || ''));
  const spec = mediaVariantSpec(variant);
  if (!concept || !spec) return null;
  const [bg, deep, accent, secondary] = PALETTES[concept.id] || PALETTES['spatial-bridge'];
  const { width, height } = spec;
  const seed = seedFor(`${concept.id}:${variant}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${esc(concept.title)}</title><desc id="desc">${esc(concept.alt)}</desc>
<defs>
  <radialGradient id="bg" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${deep}"/><stop offset=".48" stop-color="${bg}"/><stop offset="1" stop-color="#010205"/></radialGradient>
  <radialGradient id="planet" cx="35%" cy="30%"><stop offset="0" stop-color="${secondary}"/><stop offset=".55" stop-color="${accent}"/><stop offset="1" stop-color="#101728"/></radialGradient>
  <linearGradient id="screen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity=".62"/><stop offset="1" stop-color="${secondary}" stop-opacity=".2"/></linearGradient>
  <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${Math.max(2, width/1400)}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="${accent}"/></marker>
</defs>
<rect width="${width}" height="${height}" fill="url(#bg)"/>
<g>${stars(seed, width, height, accent)}</g>
<g opacity=".18" stroke="${accent}" stroke-width="1"><path d="M0 ${height*.76} H${width}"/><path d="M${width*.12} 0 V${height}"/><path d="M${width*.88} 0 V${height}"/></g>
${motif(concept.id, width, height, accent, secondary)}
<g transform="translate(${width*.055} ${height*.09})"><rect width="${width*.36}" height="${height*.092}" rx="${height*.018}" fill="#02060d" opacity=".72" stroke="${accent}" stroke-opacity=".35"/><text x="${width*.018}" y="${height*.038}" fill="#e9fbff" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="${Math.max(18,width/78)}" font-weight="700">${esc(concept.title)}</text><text x="${width*.018}" y="${height*.068}" fill="${accent}" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="${Math.max(11,width/145)}" letter-spacing="2">STEPHANOS CONCEPT PROJECTION</text></g>
<g transform="translate(${width*.74} ${height*.9})"><text fill="#b8cede" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="${Math.max(10,width/190)}">VECTOR-NATIVE SHARP FALLBACK · NOT RUNTIME PROOF</text></g>
</svg>`;
  const bytes = Buffer.from(svg, 'utf8');
  return Object.freeze({
    bytes,
    sha256: sha256(bytes),
    contentType: 'image/svg+xml',
    extension: 'svg',
    width,
    height,
    byteSize: bytes.length,
    source: 'vector-native-fallback',
    qualityClass: 'VECTOR_NATIVE_SHARP',
    assetId: concept.id,
    variant,
  });
}

async function readVerifiedCachedObject(assetId, variant, options = {}) {
  const cacheRoot = options.cacheRoot || DEFAULT_MEDIA_CACHE_ROOT;
  const pointerPath = resolve(cacheRoot, 'pointers', MEDIA_COLLECTION_VR_ATLAS, `${assetId}.${variant}.json`);
  let pointer;
  try {
    pointer = JSON.parse(await readFile(pointerPath, 'utf8'));
  } catch {
    return null;
  }
  const validation = validateMediaAssetPointer(pointer, {
    collection: MEDIA_COLLECTION_VR_ATLAS,
    assetId,
    variant,
  });
  if (!validation.ok) return null;
  const objectPath = resolve(cacheRoot, 'objects', `${String(pointer.sha256).toLowerCase()}.${validation.extension}`);
  let bytes;
  try {
    const info = await stat(objectPath);
    if (!info.isFile() || info.size !== Number(pointer.byteSize)) return null;
    bytes = await readFile(objectPath);
  } catch {
    return null;
  }
  const digest = sha256(bytes);
  if (digest !== String(pointer.sha256).toLowerCase()) return null;
  return Object.freeze({
    bytes,
    sha256: digest,
    contentType: validation.contentType,
    extension: validation.extension,
    width: validation.spec.width,
    height: validation.spec.height,
    byteSize: bytes.length,
    source: 'verified-content-addressed-cache',
    qualityClass: validation.extension === 'svg' ? 'VECTOR_NATIVE_SHARP' : 'VERIFIED_RASTER_QUALITY_FLOOR',
    assetId,
    variant,
  });
}

export function getVrAtlasMediaManifest() {
  return Object.freeze({
    schemaVersion: MEDIA_ASSET_FABRIC_SCHEMA,
    collection: MEDIA_COLLECTION_VR_ATLAS,
    cacheModel: 'content-addressed-sha256',
    sharpFallback: 'vector-native',
    assetCount: CONCEPT_CATALOG.length,
    assets: Object.freeze(CONCEPT_CATALOG.map((concept) => Object.freeze({
      assetId: concept.id,
      title: concept.title,
      alt: concept.alt,
      variants: Object.freeze(Object.fromEntries(['thumb', 'panel', 'hero'].map((variant) => {
        const spec = mediaVariantSpec(variant);
        return [variant, Object.freeze({
          url: mediaAssetApiPath(MEDIA_COLLECTION_VR_ATLAS, concept.id, variant),
          width: spec.width,
          height: spec.height,
          minimumRasterBytes: spec.minimumRasterBytes,
        })];
      }))),
    }))),
  });
}

export async function resolveVrAtlasMediaAsset(assetId, variant, options = {}) {
  const conceptId = String(assetId || '').toLowerCase();
  const variantId = String(variant || '').toLowerCase();
  if (!conceptsById.has(conceptId) || !mediaVariantSpec(variantId)) {
    return Object.freeze({ ok: false, status: 404, reason: 'MEDIA_ASSET_NOT_FOUND' });
  }
  const cached = await readVerifiedCachedObject(conceptId, variantId, options);
  const asset = cached || renderVrAtlasVectorFallback(conceptId, variantId);
  if (!asset) return Object.freeze({ ok: false, status: 404, reason: 'MEDIA_ASSET_NOT_FOUND' });
  return Object.freeze({
    ok: true,
    status: 200,
    collection: MEDIA_COLLECTION_VR_ATLAS,
    ...asset,
    cacheControl: asset.source === 'verified-content-addressed-cache'
      ? 'public, max-age=300, stale-while-revalidate=86400'
      : 'public, max-age=300',
  });
}
