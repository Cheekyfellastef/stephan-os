// External skills are untrusted documents, never executable tool grants.
// Node-only admission logic for a separately staged SKILL.md document.
// The canonical Shared Workspace remains the only durable status/evidence store.
import { createHash } from 'node:crypto';

export const EXTERNAL_SKILL_REVIEW_SCHEMA = 'stephanos.external-skill-review.v1';
export const EXTERNAL_SKILL_SOURCE_TYPES = Object.freeze([
  'github', 'clawhub', 'skills-sh', 'openai', 'anthropic',
]);

const MAX_SKILL_BYTES = 65536;
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const SPDX_ID = /^[A-Za-z0-9][A-Za-z0-9+.-]{0,63}$/;
const DANGEROUS_SIGNALS = Object.freeze([
  ['REMOTE_CODE_PIPE', /\b(?:curl|wget|iwr|irm)\b[^\n]{0,180}\|\s*(?:bash|sh|powershell|pwsh|iex)\b/i],
  ['ARBITRARY_SHELL', /\b(?:sudo|Invoke-Expression|Start-Process\s+.*-Verb\s+RunAs)\b/i],
  ['DESTRUCTIVE_COMMAND', /\b(?:rm\s+-rf|Remove-Item\s+.*-Recurse|git\s+push\s+--force)\b/i],
  ['CREDENTIAL_HANDLING', /\b(?:process\.env|\.ssh\/|\.aws\/credentials|API[_ -]?KEY|access[_ -]?token)\b/i],
  ['PERMISSION_OVERRIDE', /\b(?:ignore\s+(?:all\s+)?(?:previous\s+)?instructions|bypass\s+(?:approval|security|permissions))\b/i],
]);

const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const clean = (value, max = 180) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function canonicalRepository(value) {
  const url = clean(value, 240);
  // Repository-scoped HTTPS GitHub origin only. Never fetch a URL here.
  const parts = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(url);
  if (!parts || [parts[1], parts[2]].some(part => part === '.' || part === '..')) return '';
  return url;
}

function canonicalSkillPath(value) {
  const path = clean(value, 240);
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('%') ||
      path.includes('?') || path.includes('#') || path.includes(':')) return '';
  const segments = path.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' ||
      !/^[A-Za-z0-9_.-]+$/.test(segment))) return '';
  return segments.at(-1) === 'SKILL.md' ? path : '';
}

function validFrontmatter(content) {
  const match = /^\uFEFF?---\r?\n([\s\S]{0,4096}?)\r?\n---(?:\r?\n|$)/.exec(content);
  return Boolean(match && /^name:\s*\S/im.test(match[1]) &&
    /^description:\s*\S/im.test(match[1]));
}

export function assessExternalSkillIntakeV1(input = {}) {
  const request = asObject(input);
  const source = asObject(request.source);
  const registry = clean(source.registry, 32).toLowerCase();
  const repositoryUrl = canonicalRepository(source.repositoryUrl);
  const revision = clean(source.revision, 64).toLowerCase();
  const skillPath = canonicalSkillPath(source.skillPath);
  const content = typeof request.skillMd === 'string' ? request.skillMd : '';
  const contentBytes = Buffer.byteLength(content, 'utf8');
  const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');
  const licenseClaim = clean(source.licenseSpdx, 64);
  const publisherClaim = clean(source.publisher, 100);
  const signals = DANGEROUS_SIGNALS
    .filter(([, pattern]) => pattern.test(content)).map(([name]) => name);
  const structuralBlockers = [];
  if (!EXTERNAL_SKILL_SOURCE_TYPES.includes(registry)) structuralBlockers.push('REGISTRY_UNRECOGNISED');
  if (!repositoryUrl) structuralBlockers.push('REPOSITORY_ORIGIN_INVALID');
  if (!GIT_SHA.test(revision)) structuralBlockers.push('SOURCE_REVISION_NOT_PINNED');
  if (!skillPath) structuralBlockers.push('SKILL_PATH_INVALID');
  if (!content || contentBytes > MAX_SKILL_BYTES || content.includes('\0'))
    structuralBlockers.push('SKILL_SIZE_OR_BYTES_INVALID');
  if (!validFrontmatter(content)) structuralBlockers.push('SKILL_FRONTMATTER_INVALID');
  if (!publisherClaim) structuralBlockers.push('PUBLISHER_CLAIM_MISSING');
  if (!SPDX_ID.test(licenseClaim) || ['NOASSERTION', 'UNKNOWN', 'NONE'].includes(licenseClaim.toUpperCase()))
    structuralBlockers.push('LICENSE_CLAIM_MISSING');
  if (request.targetActor !== 'openclaw-local') structuralBlockers.push('TARGET_NOT_OPENCLAW_LOCAL');

  // Metadata supplied by a skill publisher cannot independently verify itself.
  // These gates must be satisfied by separate existing reviewer/approval/runtime receipts.
  const reviewBlockers = [
    'PUBLISHER_PROVENANCE_REQUIRES_INDEPENDENT_VERIFICATION',
    'LICENSE_REQUIRES_INDEPENDENT_VERIFICATION',
    'CONTENT_SECURITY_REVIEW_REQUIRED',
    'TARGET_SCOPE_REVIEW_REQUIRED',
    'OPERATOR_APPROVAL_REQUIRED',
    'TARGET_RUNTIME_INSTALLATION_UNPROVEN',
  ];
  if (signals.length) reviewBlockers.push('HIGH_RISK_INSTRUCTION_SIGNALS');
  const validDraft = structuralBlockers.length === 0;
  const repositoryFileUrl = validDraft
    ? repositoryUrl + '/blob/' + revision + '/' + skillPath
    : '';
  const id = 'external-' + contentHash.slice(0, 20);

  return Object.freeze({
    schemaVersion: EXTERNAL_SKILL_REVIEW_SCHEMA,
    id,
    name: clean(request.name, 100) || 'External skill candidate',
    status: validDraft ? 'DRAFT' : 'BLOCKED',
    verdict: validDraft ? 'REVIEW_REQUIRED' : 'STRUCTURALLY_BLOCKED',
    targetActor: 'openclaw-local',
    claimedRegistry: registry,
    claimedPublisher: publisherClaim,
    claimedLicense: licenseClaim,
    sourceRepository: repositoryUrl,
    sourceRevision: GIT_SHA.test(revision) ? revision : '',
    sourcePath: skillPath,
    sourceFileUrl: repositoryFileUrl,
    contentSha256: contentHash,
    contentBytes,
    instructionSignals: signals,
    structuralBlockers,
    reviewBlockers,
    provenance: 'EXTERNAL_DRAFT_NOT_INSTALLED',
    permissionLevel: 'PROPOSE_ONLY',
    riskLevel: signals.length ? 'HIGH' : 'MEDIUM',
    canInstall: false,
    canExecute: false,
    canWrite: false,
    canGrantPermissions: false,
    canMerge: false,
    activated: false,
    nextAction: 'Independently verify publisher, pinned source, license and content; perform the existing ten-question exam, tests, exact-target runtime proof, independent review and operator approval before using any existing guarded installation route.',
  });
}
