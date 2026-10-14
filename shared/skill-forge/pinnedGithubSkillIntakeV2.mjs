// Fixed-origin, single-file, pinned GitHub SKILL.md intake.
// This is a read-only source observation, not a publisher trust grant or install.
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { assessExternalSkillIntakeV1 } from './externalSkillIntakeV1.mjs';

export const PINNED_GITHUB_SKILL_INTAKE_SCHEMA = 'stephanos.pinned-github-skill-source.v2';
export const PINNED_GITHUB_SKILL_INTAKE_LIMIT_BYTES = 65536;
const MAX_API_RESPONSE_BYTES = 145000;
const SHA40 = /^[a-f0-9]{40}$/i;
const GITHUB_REPOSITORY = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const SOURCE_PATH_SEGMENT = /^[A-Za-z0-9_.-]+$/;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function hold(blocker) {
  return Object.freeze({
    schemaVersion: PINNED_GITHUB_SKILL_INTAKE_SCHEMA,
    verdict: 'SOURCE_HELD',
    blocker,
    sourceVerified: false,
    candidate: null,
    sourceProof: null,
    canInstall: false,
    canExecute: false,
    canGrantPermissions: false,
  });
}

export function preparePinnedGithubSkillSourceV2(input = {}) {
  const repositoryUrl = text(input.repositoryUrl);
  const revision = text(input.revision).toLowerCase();
  const path = text(input.skillPath);
  const match = GITHUB_REPOSITORY.exec(repositoryUrl);
  if (!match || [match[1], match[2]].some(part => part === '.' || part === '..')) {
    return hold('GITHUB_REPOSITORY_INVALID');
  }
  if (!SHA40.test(revision)) return hold('EXACT_GIT_COMMIT_REQUIRED');
  const segments = path.split('/');
  if (!path || segments.some(part => !part || part === '.' || part === '..' || !SOURCE_PATH_SEGMENT.test(part))
      || segments.at(-1) !== 'SKILL.md' || path.length > 240) {
    return hold('SKILL_PATH_INVALID');
  }
  const owner = match[1];
  const repo = match[2];
  const sourceUrl = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/'
    + segments.map(encodeURIComponent).join('/') + '?ref=' + revision;
  return Object.freeze({
    schemaVersion: PINNED_GITHUB_SKILL_INTAKE_SCHEMA,
    verdict: 'SOURCE_READ_PREPARED',
    repositoryUrl, revision, skillPath: path, sourceUrl,
    method: 'GET',
    autoDownload: false,
    canInstall: false, canExecute: false, canGrantPermissions: false,
  });
}

function strictBase64(value) {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[\r\n]/g, '');
  if (!compact || compact.length > 90000 || compact.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) {
    return null;
  }
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.toString('base64') !== compact) return null;
  return bytes;
}

// Invoke only on a GitHub Contents response received through the exact request.
// An arbitrary caller-supplied response is not an authenticated provenance claim.
export function assessPinnedGithubContentsV2(input = {}, contents = {}) {
  const prepared = preparePinnedGithubSkillSourceV2(input);
  if (prepared.verdict !== 'SOURCE_READ_PREPARED') return prepared;
  if (!contents || contents.type !== 'file'
      || contents.path !== prepared.skillPath
      || contents.encoding !== 'base64'
      || !SHA40.test(text(contents.sha))) return hold('GITHUB_FILE_METADATA_INVALID');
  const bytes = strictBase64(contents.content);
  if (!bytes || bytes.length < 1 || bytes.length > PINNED_GITHUB_SKILL_INTAKE_LIMIT_BYTES
      || contents.size !== bytes.length) return hold('GITHUB_FILE_CONTENT_INVALID');
  const blobHeader = Buffer.from('blob ' + bytes.length + '\0', 'utf8');
  const observedGitBlobSha = createHash('sha1').update(blobHeader).update(bytes).digest('hex');
  if (observedGitBlobSha !== contents.sha.toLowerCase()) return hold('GIT_BLOB_DIGEST_MISMATCH');
  let skillMd;
  try { skillMd = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return hold('SKILL_CONTENT_NOT_UTF8'); }
  if (skillMd.includes('\0')) return hold('SKILL_CONTENT_HAS_NUL');

  const candidate = assessExternalSkillIntakeV1({
    name: input.name, targetActor: 'openclaw-local',
    skillMd,
    source: {
      registry: input.registry || 'github',
      repositoryUrl: prepared.repositoryUrl,
      revision: prepared.revision,
      skillPath: prepared.skillPath,
      publisher: input.publisher,
      licenseSpdx: input.licenseSpdx,
    },
  });
  const sourceProof = Object.freeze({
    schemaVersion: PINNED_GITHUB_SKILL_INTAKE_SCHEMA,
    repositoryUrl: prepared.repositoryUrl,
    pinnedRevision: prepared.revision,
    skillPath: prepared.skillPath,
    sourceUrl: prepared.sourceUrl,
    gitBlobSha1: observedGitBlobSha,
    contentSha256: candidate.contentSha256,
    contentBytes: bytes.length,
    verification: 'PINNED_GITHUB_CONTENTS_API_BLOB_MATCHED',
    publisherIdentityVerified: false,
    licenseVerified: false,
    dependenciesVerified: false,
    runtimeInstalled: false,
  });
  return Object.freeze({
    schemaVersion: PINNED_GITHUB_SKILL_INTAKE_SCHEMA,
    verdict: candidate.verdict === 'REVIEW_REQUIRED' ? 'SOURCE_VERIFIED_REVIEW_REQUIRED' : 'SOURCE_VERIFIED_DRAFT_BLOCKED',
    blocker: candidate.verdict === 'REVIEW_REQUIRED' ? '' : 'CANDIDATE_STRUCTURAL_REVIEW_BLOCKED',
    sourceVerified: true,
    sourceProof, candidate,
    canInstall: false, canExecute: false, canGrantPermissions: false,
  });
}

async function readBoundedBody(response) {
  if (!response?.body || typeof response.body.getReader !== 'function') {
    const value = await response.text();
    if (Buffer.byteLength(value, 'utf8') > MAX_API_RESPONSE_BYTES) throw Error('SOURCE_RESPONSE_TOO_LARGE');
    return value;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_API_RESPONSE_BYTES) throw Error('SOURCE_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), length).toString('utf8');
}

export async function fetchPinnedGithubSkillV2(input = {}, { fetchFn = fetch, token = '' } = {}) {
  const prepared = preparePinnedGithubSkillSourceV2(input);
  if (prepared.verdict !== 'SOURCE_READ_PREPARED') return prepared;
  if (typeof fetchFn !== 'function') return hold('GITHUB_SOURCE_TRANSPORT_MISSING');
  let response;
  try {
    response = await fetchFn(prepared.sourceUrl, {
      method: 'GET', redirect: 'error',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'stephanos-skill-foundry-v2',
        ...(text(token) ? { Authorization: 'Bearer ' + token } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch { return hold('GITHUB_PINNED_READ_FAILED'); }
  if (!response || response.status !== 200 || response.redirected === true
      || (response.url && response.url !== prepared.sourceUrl)) return hold('GITHUB_PINNED_READ_NOT_CONFIRMED');
  const remaining = Number(response.headers?.get?.('x-ratelimit-remaining'));
  const limit = Number(response.headers?.get?.('x-ratelimit-limit'));
  if (Number.isFinite(remaining) && Number.isFinite(limit)
      && limit > 0 && remaining < Math.max(10, Math.ceil(limit * 0.2))) return hold('GITHUB_API_RESERVE_HOLD');
  try {
    const contents = JSON.parse(await readBoundedBody(response));
    return assessPinnedGithubContentsV2(input, contents);
  } catch { return hold('GITHUB_CONTENTS_RESPONSE_INVALID'); }
}
