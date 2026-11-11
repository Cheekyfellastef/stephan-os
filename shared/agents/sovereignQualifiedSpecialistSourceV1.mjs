import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { formatAuthenticatedReviewDiffV1 } from './sovereignAuthenticatedReviewDiffV1.mjs';
import { buildSovereignSpecialistSourceBindingV1 } from './sovereignQualifiedSpecialistReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SHA = /^[a-f0-9]{40}$/;
const MAX_OBJECT_BYTES = 2 * 1024 * 1024;
const MAX_CLOSURE_BYTES = 32 * 1024 * 1024;
const requireProof = (ok, code) => { if (!ok) throw new Error(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const objectId = (type, bytes) => createHash('sha1').update(type + ' ' + bytes.length + '\0').update(bytes).digest('hex');
const dense = value => Array.isArray(value) && Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean);
const validPath = path => typeof path === 'string' && path.length > 0 && Buffer.byteLength(path, 'utf8') <= 4096
  && Buffer.from(path, 'utf8').toString('utf8') === path && !/[\\\0]/.test(path)
  && path.split('/').length <= 64 && path.split('/').every(part => part && part !== '.' && part !== '..');

function untilAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('SOVEREIGN_SPECIALIST_SOURCE_READ_DEADLINE'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) abort(); else resolve(value);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/** Fixed-origin GET-only source reader. Separate from the repository's general
 * GitHub helper: no mutation, caller URL, redirect or post-buffer size check.
 * The collector supplies ONE actual AbortSignal for its entire source capture. */
export function createSovereignSpecialistGitHubSourceTransportV1({ token, fetchImpl = fetch } = {}) {
  requireProof(typeof token === 'string' && token.length > 0 && token.length <= 65536
    && typeof fetchImpl === 'function', 'SOVEREIGN_SPECIALIST_SOURCE_TRANSPORT_UNAVAILABLE');
  return async (path, { signal } = {}) => {
    const match = typeof path === 'string' && path.match(/^\/repos\/Cheekyfellastef\/stephan-os\/git\/(commits|trees|blobs)\/([a-f0-9]{40})(\?recursive=1)?$/);
    requireProof(match && (match[1] === 'trees' ? match[3] === '?recursive=1' : match[3] === undefined)
      && signal instanceof AbortSignal && !signal.aborted, 'SOVEREIGN_SPECIALIST_SOURCE_TRANSPORT_SCOPE_INVALID');
    const maximum = match[1] === 'commits' ? 512 * 1024 : match[1] === 'trees' ? 8 * 1024 * 1024
      : Math.ceil(MAX_OBJECT_BYTES * 4 / 3) + 65536;
    const url = 'https://api.github.com' + path;
    const response = await untilAbort(fetchImpl(url, { method: 'GET', redirect: 'error', signal,
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'stephanos-sovereign-specialist-source-v1' } }), signal);
    requireProof(!signal.aborted && response?.status === 200 && response.url === url && response.redirected === false
      && typeof response.body?.getReader === 'function', 'SOVEREIGN_SPECIALIST_SOURCE_RESPONSE_INVALID');
    const encoding = String(response.headers?.get('content-encoding') || '').trim().toLowerCase();
    requireProof(['', 'identity', 'gzip', 'deflate', 'br'].includes(encoding),
      'SOVEREIGN_SPECIALIST_SOURCE_ENCODING_UNSUPPORTED');
    const decodedEncoding = encoding !== '' && encoding !== 'identity';
    const declared = response.headers?.get('content-length');
    requireProof(declared === null || declared === undefined || (/^(0|[1-9][0-9]*)$/.test(declared)
      && Number.isSafeInteger(Number(declared)) && Number(declared) <= maximum), 'SOVEREIGN_SPECIALIST_SOURCE_RESPONSE_UNBOUNDED');
    const reader = response.body.getReader(), chunks = [];
    let bytes = 0, count = 0, complete = false;
    try {
      while (true) {
        const item = await untilAbort(reader.read(), signal);
        requireProof(!signal.aborted, 'SOVEREIGN_SPECIALIST_SOURCE_READ_DEADLINE');
        if (item.done === true) { complete = true; break; }
        requireProof(item.done === false && item.value instanceof Uint8Array && item.value.byteLength > 0
          && ++count <= 32768 && bytes + item.value.byteLength <= maximum,
        'SOVEREIGN_SPECIALIST_SOURCE_RESPONSE_UNBOUNDED');
        bytes += item.value.byteLength; chunks.push(Buffer.from(item.value));
      }
      // Node fetch enforces wire framing and transparently decodes supported
      // compression. Content-Length then describes compressed wire bytes, not
      // this bounded decoded stream. Equality applies only to identity bodies.
      requireProof(!signal.aborted && (decodedEncoding || declared === null || declared === undefined || Number(declared) === bytes),
        'SOVEREIGN_SPECIALIST_SOURCE_RESPONSE_INCOMPLETE');
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
      const value = JSON.parse(raw);
      requireProof(!signal.aborted, 'SOVEREIGN_SPECIALIST_SOURCE_READ_DEADLINE');
      return value;
    } finally {
      if (!complete) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* no result accepted */ } }
      try { reader.releaseLock(); } catch { /* aborted read remains rejected */ }
    }
  };
}

// Reconstruct each actual raw tree from the COMPLETE recursive API estate.
// The supplied root and every directory object must hash to Git's advertised
// SHA. A missing leaf, omitted directory, duplicate or truncated estate cannot
// become a complete native source snapshot merely by repeating a tree ID.
export function authenticateSovereignSpecialistGitHubTreeV1(response, expectedTree) {
  requireProof(response?.sha === expectedTree && SHA.test(expectedTree) && response.truncated === false
    && dense(response.tree) && response.tree.length <= 20000,
  'SOVEREIGN_SPECIALIST_COMPLETE_TREE_REQUIRED');
  const rows = new Map(), directories = new Map([['', expectedTree]]), children = new Map([['', []]]);
  const before = new Map(), sizes = new Map();
  for (const entry of response.tree) {
    requireProof(entry && validPath(entry.path) && !rows.has(entry.path) && SHA.test(entry.sha)
      && ['040000', '100644', '100755', '120000', '160000'].includes(entry.mode)
      && entry.type === (entry.mode === '040000' ? 'tree' : entry.mode === '160000' ? 'commit' : 'blob'),
    'SOVEREIGN_SPECIALIST_TREE_ENTRY_INVALID');
    rows.set(entry.path, entry);
    if (entry.mode === '040000') { directories.set(entry.path, entry.sha); children.set(entry.path, []); }
    else {
      before.set(entry.path, { mode: entry.mode, sha: entry.sha });
      if (entry.type === 'blob') {
        requireProof(Number.isSafeInteger(entry.size) && entry.size >= 0, 'SOVEREIGN_SPECIALIST_BLOB_SIZE_UNPROVEN');
        if (sizes.has(entry.sha)) requireProof(sizes.get(entry.sha) === entry.size, 'SOVEREIGN_SPECIALIST_BLOB_SIZE_UNPROVEN');
        sizes.set(entry.sha, entry.size);
      }
    }
  }
  for (const entry of rows.values()) {
    const slash = entry.path.lastIndexOf('/'), parent = slash < 0 ? '' : entry.path.slice(0, slash);
    const name = slash < 0 ? entry.path : entry.path.slice(slash + 1);
    requireProof(directories.has(parent), 'SOVEREIGN_SPECIALIST_TREE_PARENT_MISSING');
    children.get(parent).push({ name, entry });
  }
  const authenticatedObjectIds = new Set();
  let totalBytes = 0;
  for (const [path, sha] of directories) {
    const entries = children.get(path).sort((left, right) => Buffer.compare(
      Buffer.from(left.name + (left.entry.mode === '040000' ? '/' : ''), 'utf8'),
      Buffer.from(right.name + (right.entry.mode === '040000' ? '/' : ''), 'utf8')));
    const bytes = Buffer.concat(entries.map(({ name, entry }) => Buffer.concat([
      Buffer.from((entry.mode === '040000' ? '40000' : entry.mode) + ' ' + name + '\0', 'utf8'),
      Buffer.from(entry.sha, 'hex'),
    ])));
    requireProof(bytes.length <= MAX_OBJECT_BYTES && objectId('tree', bytes) === sha,
      'SOVEREIGN_SPECIALIST_TREE_OBJECT_HASH_MISMATCH');
    if (!authenticatedObjectIds.has('tree:' + sha)) totalBytes += bytes.length;
    authenticatedObjectIds.add('tree:' + sha);
    requireProof(totalBytes <= MAX_CLOSURE_BYTES, 'SOVEREIGN_SPECIALIST_SOURCE_CLOSURE_UNBOUNDED');
  }
  return Object.freeze({ estate: before, blobSizes: sizes, authenticatedObjectIds, totalBytes });
}

function decodeBlob(response, expectedId, expectedSize) {
  requireProof(response?.sha === expectedId && response.encoding === 'base64'
    && Number.isSafeInteger(response.size) && response.size === expectedSize
    && expectedSize >= 0 && expectedSize <= MAX_OBJECT_BYTES && typeof response.content === 'string'
    && Buffer.byteLength(response.content, 'utf8') <= Math.ceil(MAX_OBJECT_BYTES * 4 / 3) + 65536,
  'SOVEREIGN_SPECIALIST_CHANGED_BLOB_METADATA_INVALID');
  const encoded = response.content.replace(/[\r\n]/g, '');
  requireProof(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded),
    'SOVEREIGN_SPECIALIST_CHANGED_BLOB_ENCODING_INVALID');
  const bytes = Buffer.from(encoded, 'base64');
  requireProof(bytes.toString('base64') === encoded && bytes.length === expectedSize && objectId('blob', bytes) === expectedId,
    'SOVEREIGN_SPECIALIST_CHANGED_BLOB_HASH_MISMATCH');
  return bytes;
}

/** Fixed GitHub read adapter used by the existing trusted independent-review
 * collector. `readJson` is its authenticated, fixed-origin transport; it is not
 * a field of any review artifact. Commit metadata is authenticated by GitHub;
 * raw trees and changed blob bytes are independently hash-verified here. This
 * does NOT call API metadata a raw hash-verified commit object. */
export async function captureSovereignSpecialistGitHubSourceV1(identity, { readJson, files, diff } = {}) {
  requireProof(identity?.repository === REPOSITORY && SHA.test(identity.sourceHead) && SHA.test(identity.baseSha)
    && identity.sourceHead !== identity.baseSha && typeof readJson === 'function'
    && typeof diff === 'string' && Buffer.byteLength(diff, 'utf8') > 0 && Buffer.byteLength(diff, 'utf8') <= 2 * 1024 * 1024,
  'SOVEREIGN_SPECIALIST_SOURCE_TRANSPORT_INPUT_INVALID');
  const started = Date.now(), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  timer.unref?.();
  try {
  const read = async suffix => {
    requireProof(!controller.signal.aborted && Date.now() - started >= 0 && Date.now() - started < 60000,
      'SOVEREIGN_SPECIALIST_SOURCE_READ_DEADLINE');
    const value = await untilAbort(readJson('/repos/' + REPOSITORY + suffix, { signal: controller.signal }), controller.signal);
    requireProof(!controller.signal.aborted && Date.now() - started >= 0 && Date.now() - started < 60000,
      'SOVEREIGN_SPECIALIST_SOURCE_READ_DEADLINE');
    return value;
  };
  const [sourceCommit, baseCommit] = await Promise.all([
    read('/git/commits/' + identity.sourceHead), read('/git/commits/' + identity.baseSha),
  ]);
  requireProof(sourceCommit?.sha === identity.sourceHead && baseCommit?.sha === identity.baseSha
    && SHA.test(sourceCommit?.tree?.sha || '') && SHA.test(baseCommit?.tree?.sha || ''),
  'SOVEREIGN_SPECIALIST_COMMIT_TREES_UNPROVEN');
  const [beforeResponse, afterResponse] = await Promise.all([
    read('/git/trees/' + baseCommit.tree.sha + '?recursive=1'),
    read('/git/trees/' + sourceCommit.tree.sha + '?recursive=1'),
  ]);
  const before = authenticateSovereignSpecialistGitHubTreeV1(beforeResponse, baseCommit.tree.sha);
  const after = authenticateSovereignSpecialistGitHubTreeV1(afterResponse, sourceCommit.tree.sha);
  const changedPaths = [...new Set([...before.estate.keys(), ...after.estate.keys()])].filter(path => (
    before.estate.get(path)?.sha !== after.estate.get(path)?.sha || before.estate.get(path)?.mode !== after.estate.get(path)?.mode
  )).sort();
  requireProof(changedPaths.length > 0 && changedPaths.length <= 64, 'SOVEREIGN_SPECIALIST_CHANGED_PATH_ESTATE_INVALID');
  const wanted = new Map();
  for (const path of changedPaths) for (const side of [before, after]) {
    const entry = side.estate.get(path);
    if (!entry) continue;
    requireProof(['100644', '100755'].includes(entry.mode), 'SOVEREIGN_SPECIALIST_CHANGED_PATH_TYPE_UNSUPPORTED');
    const size = side.blobSizes.get(entry.sha);
    requireProof(Number.isSafeInteger(size) && size >= 0 && size <= MAX_OBJECT_BYTES,
      'SOVEREIGN_SPECIALIST_CHANGED_BLOB_UNBOUNDED');
    if (wanted.has(entry.sha)) requireProof(wanted.get(entry.sha) === size, 'SOVEREIGN_SPECIALIST_BLOB_SIZE_UNPROVEN');
    wanted.set(entry.sha, size);
  }
  const ids = [...wanted.keys()].sort(), blobs = new Map();
  // Four bounded concurrent requests, with aggregate source bytes admitted
  // before any blob request. Unsupported/oversize sources never get truncated.
  requireProof(before.totalBytes + after.totalBytes + [...wanted.values()].reduce((sum, size) => sum + size, 0) <= MAX_CLOSURE_BYTES,
    'SOVEREIGN_SPECIALIST_SOURCE_CLOSURE_UNBOUNDED');
  for (let i = 0; i < ids.length; i += 4) {
    const batch = ids.slice(i, i + 4);
    const received = await Promise.allSettled(batch.map(id => read('/git/blobs/' + id)));
    for (let n = 0; n < batch.length; n += 1) {
      requireProof(received[n].status === 'fulfilled', 'SOVEREIGN_SPECIALIST_CHANGED_BLOB_READ_FAILED');
      blobs.set(batch[n], decodeBlob(received[n].value, batch[n], wanted.get(batch[n])));
    }
  }
  const authenticatedObjectIds = [...new Set(['commit:' + identity.baseSha, 'commit:' + identity.sourceHead,
    ...before.authenticatedObjectIds, ...after.authenticatedObjectIds, ...ids.map(id => 'blob:' + id)])].sort();
  const canonicalSnapshot = formatAuthenticatedReviewDiffV1({ base: identity.baseSha, head: identity.sourceHead,
    before: before.estate, after: after.estate, blobs, authenticatedObjectIds });
  const binding = buildSovereignSpecialistSourceBindingV1({ ...identity, files, sourceCommit, baseCommit, canonicalSnapshot });
  requireProof(!controller.signal.aborted && Date.now() - started >= 0 && Date.now() - started < 60000,
    'SOVEREIGN_SPECIALIST_SOURCE_READ_DEADLINE');
  return Object.freeze({ binding,
    sourceTransport: 'GITHUB_AUTHENTICATED_COMMIT_METADATA_HASH_VERIFIED_TREES_AND_BLOBS',
    githubRawDiffSha256: hash(diff), githubRawDiffBytes: Buffer.byteLength(diff, 'utf8'),
    canonicalDiffSha256: binding.fullDiffSha256, reviewedObjectClosureSha256: binding.reviewedObjectClosureSha256 });
  } finally { clearTimeout(timer); controller.abort(); }
}
