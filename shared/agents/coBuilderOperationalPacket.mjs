const MAX_REPAIR_ROUNDS = 3;

export const CO_BUILDER_OPERATIONAL_PACKET_SCHEMA_VERSION = 'co-builder-operational-packet.v1';
export const CO_BUILDER_OPERATIONAL_PACKET_KIND = 'stephanos.co_builder.operational_packet';

export const DEFAULT_OPERATIONAL_FORBIDDEN_FILES = Object.freeze([
  'apps/stephanos/dist/**',
  'stephanos-server/data/**',
  'runtime/**',
  'runtime-data/**',
  'root-data/**',
  'root data/**',
  'data/**',
  'tmp/**',
  '.git/**',
  'node_modules/**',
  '.env',
  '.env.*',
  '**/*.pem',
  '**/*.pfx',
  '**/*.key',
  'secrets/**',
  '**/*secret*',
  '**/*token*',
]);

const SECRET_OR_GENERATED_PATTERN = /(^|\/)(apps\/stephanos\/dist|stephanos-server\/data|runtime|runtime-data|root-data|root data|data|tmp|\.git|node_modules)(\/|$)|(^|\/)\.env(\.|$)|\.(pem|pfx|key)$/i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-z]:\//i;
const LOWERCASE_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RECEIPT_PATH_PREFIX_PATTERN = /^(proof|proofs|receipts|evidence\/receipts)\//;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asText(item, '')).filter(Boolean);
}

function uniqueList(items) {
  return [...new Set(asList(items))];
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clampRound(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(Math.floor(parsed), MAX_REPAIR_ROUNDS);
}

function normalizePacketPath(path) {
  return asText(path, '').replace(/\\/g, '/');
}

function isAbsoluteOrTraversalPath(path) {
  const text = normalizePacketPath(path);
  if (!text) return true;
  if (text.startsWith('/') || text.startsWith('//') || WINDOWS_ABSOLUTE_PATH_PATTERN.test(text)) return true;
  return text.split('/').some((part) => part === '..');
}

function includesForbiddenPath(path) {
  const text = normalizePacketPath(path);
  return !text || isAbsoluteOrTraversalPath(text) || SECRET_OR_GENERATED_PATTERN.test(text) || /secret|token/i.test(text);
}

function globBase(path) {
  const text = normalizePacketPath(path).replace(/\*\*.*$/, '').replace(/\*.*$/, '');
  return text.replace(/\/+$/, '');
}

function isGlobalWildcardScope(path) {
  const text = normalizePacketPath(path);
  return text === '**' || text === '**/*';
}

function isGlobalFilePattern(path) {
  return normalizePacketPath(path).startsWith('**/');
}

function isRootFilePattern(path) {
  const text = normalizePacketPath(path);
  return !text.includes('/') && text.includes('*');
}

function rootFilePatternMatches(path, pattern) {
  const expression = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${expression}$`).test(path);
}

function scopeOverlap(left, right) {
  const leftText = normalizePacketPath(left);
  const rightText = normalizePacketPath(right);
  if (isGlobalWildcardScope(leftText)) return true;
  if (isGlobalFilePattern(rightText)) return false;
  if (isRootFilePattern(leftText) && !isRootFilePattern(rightText)) return false;
  if (isRootFilePattern(rightText)) {
    if (leftText.includes('/')) return false;
    if (isRootFilePattern(leftText)) return leftText === rightText;
    return rootFilePatternMatches(leftText, rightText);
  }
  const a = globBase(leftText);
  const b = globBase(rightText);
  if (!a || !b) return true;
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function findAllowedForbiddenOverlaps(allowedScopes, forbiddenScopes) {
  const overlaps = [];
  for (const allowed of allowedScopes) {
    for (const forbidden of forbiddenScopes) {
      if (scopeOverlap(allowed, forbidden)) overlaps.push(`${allowed} overlaps ${forbidden}`);
    }
  }
  return overlaps;
}

function normalizeEvidenceToken(value) {
  return asText(value, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isPlaceholderMissionId(value) {
  const text = asText(value, '');
  return !text || /^(mission-unresolved|unknown|none|null|undefined|todo|tbd|placeholder|changeme)$/i.test(text);
}

function collectSuppliedEvidence({ verificationReturnIntake = {}, supportSnapshot = {}, agentWorkRoutingProjection = {} } = {}) {
  return [
    ...asArray(verificationReturnIntake.suppliedEvidence),
    ...asArray(verificationReturnIntake.verifiedEvidence),
    ...asArray(verificationReturnIntake.completedEvidence),
    ...asArray(supportSnapshot.suppliedEvidence),
    ...asArray(supportSnapshot.verifiedEvidence),
    ...asArray(agentWorkRoutingProjection.suppliedEvidence),
  ];
}

function validLowercaseHash(value) {
  const text = asText(value, '');
  return LOWERCASE_SHA256_PATTERN.test(text);
}

function validReceiptPath(value) {
  const text = normalizePacketPath(value);
  return Boolean(text) && RECEIPT_PATH_PREFIX_PATTERN.test(text) && !includesForbiddenPath(text);
}

function evidenceHasDeterministicReceipt(item) {
  if (validLowercaseHash(item.sha256)) return true;
  if (validLowercaseHash(item.commandOutputHash)) return true;
  if (Number.isInteger(item.exitCode) && item.exitCode === 0) return true;
  return validReceiptPath(item.receiptPath);
}

function sanitizeEvidenceReceipt(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const receipt = {
    requirement: asText(item.requirement, ''),
    source: asText(item.source, ''),
    evidenceType: asText(item.evidenceType, ''),
    verified: item.verified === true,
  };
  if (!receipt.requirement || !receipt.source || !receipt.evidenceType || receipt.verified !== true) return null;

  let hasProof = false;
  if (validLowercaseHash(item.sha256)) {
    receipt.sha256 = item.sha256;
    hasProof = true;
  }
  if (validLowercaseHash(item.commandOutputHash)) {
    receipt.commandOutputHash = item.commandOutputHash;
    hasProof = true;
  }
  if (Number.isInteger(item.exitCode) && item.exitCode === 0) {
    receipt.exitCode = 0;
    hasProof = true;
  }
  if (validReceiptPath(item.receiptPath)) {
    receipt.receiptPath = normalizePacketPath(item.receiptPath);
    hasProof = true;
  }
  return hasProof ? receipt : null;
}

function sanitizeEvidenceReceipts(items) {
  const accepted = [];
  let rejectedCount = 0;
  for (const item of items) {
    const receipt = sanitizeEvidenceReceipt(item);
    if (receipt) accepted.push(receipt);
    else rejectedCount += 1;
  }
  return { accepted, rejectedCount };
}

function evidenceRequirementSatisfied(requirement, suppliedEvidence) {
  const normalizedRequirement = normalizeEvidenceToken(requirement);
  if (!normalizedRequirement) return false;
  return suppliedEvidence.some((item) => normalizeEvidenceToken(item.requirement) === normalizedRequirement);
}

function inferMissionKind({ operatorIntent, missionBrainNextAction = {}, supportSnapshot = {} }) {
  const explicit = asText(supportSnapshot.operationalPacketKind || supportSnapshot.coBuilderPacketMissionKind || supportSnapshot.taskKind, '').toLowerCase();
  if (['implementation', 'live-browser-investigation', 'verification', 'research', 'unknown'].includes(explicit)) return explicit;
  const text = [operatorIntent, missionBrainNextAction.nextBestAction, missionBrainNextAction.missionObjective].map((v) => asText(v, '')).join(' ').toLowerCase();
  if (/browser|runtime|live.*inspect|screenshot|ui proof|investigat|verify/.test(text) && !/implement|code|patch|edit|write/.test(text)) return 'live-browser-investigation';
  if (/implement|code|patch|edit|write|fix|build/.test(text)) return 'implementation';
  return 'unknown';
}

export function buildCoBuilderOperationalPacket({
  missionId,
  operatorIntent,
  intendedOutcome,
  missionStatus,
  missionBrainNextAction = {},
  missionIntelligenceSummary = {},
  harnessAgentProjection = {},
  agentWorkRoutingProjection = {},
  coBuilderLoopProjection = {},
  verificationReturnIntake = {},
  supportSnapshot = {},
} = {}) {
  const rawAllowedFiles = uniqueList(harnessAgentProjection.allowedFileScopes || agentWorkRoutingProjection.allowedFiles || []);
  const normalizedAllowedFileCandidates = rawAllowedFiles.map(normalizePacketPath);
  const callerForbiddenScopes = [...asList(harnessAgentProjection.forbiddenFileScopes), ...asList(harnessAgentProjection.forbiddenFiles)].map(normalizePacketPath);
  const defaultForbiddenScopes = DEFAULT_OPERATIONAL_FORBIDDEN_FILES.map(normalizePacketPath);
  const allowedFiles = normalizedAllowedFileCandidates.filter((path) => !includesForbiddenPath(path));
  const forbiddenFiles = uniqueList([...defaultForbiddenScopes, ...callerForbiddenScopes, ...normalizedAllowedFileCandidates.filter(includesForbiddenPath)]);
  const allowedForbiddenOverlaps = findAllowedForbiddenOverlaps(allowedFiles, [...callerForbiddenScopes, ...defaultForbiddenScopes]);
  const requiredEvidence = uniqueList([
    ...asList(agentWorkRoutingProjection.requiredProof),
    ...asList(missionBrainNextAction.proofRequiredBeforeMerge),
    ...asList(verificationReturnIntake.missingEvidence),
  ]);
  const requiredTests = uniqueList([
    ...asList(harnessAgentProjection.requiredTests),
    ...asList(agentWorkRoutingProjection.requiredTests),
  ]);
  const rawSuppliedEvidence = collectSuppliedEvidence({ verificationReturnIntake, supportSnapshot, agentWorkRoutingProjection });
  const sanitizedEvidence = sanitizeEvidenceReceipts(rawSuppliedEvidence);
  const suppliedEvidence = sanitizedEvidence.accepted;
  const unsatisfiedEvidence = requiredEvidence.filter((requirement) => !evidenceRequirementSatisfied(requirement, suppliedEvidence));
  const resolvedMissionId = asText(missionId || supportSnapshot.missionId, 'mission-unresolved');
  const blockingReasons = [];
  const missionKind = inferMissionKind({ operatorIntent, missionBrainNextAction, supportSnapshot });
  const sensitive = asText(harnessAgentProjection.generatedArtifactRisk, '').toLowerCase() === 'yes'
    || forbiddenFiles.some((path) => normalizedAllowedFileCandidates.includes(path))
    || normalizedAllowedFileCandidates.some(includesForbiddenPath)
    || /secret|token|env|generated|dist|runtime data|merge|deploy|permission|policy/i.test([operatorIntent, intendedOutcome].join(' '));

  if (isPlaceholderMissionId(resolvedMissionId)) blockingReasons.push('Mission id is missing, placeholder, or unresolved.');
  if (!asText(operatorIntent, '')) blockingReasons.push('Operator intent is missing.');
  if (!asText(intendedOutcome || missionBrainNextAction.missionObjective || missionIntelligenceSummary.currentMissionSummary, '')) blockingReasons.push('Intended outcome is unclear.');
  if (!allowedFiles.length && missionKind === 'implementation') blockingReasons.push('Allowed source file scope is unclear.');
  if (!requiredEvidence.length) blockingReasons.push('Evidence requirements are unclear.');
  if (requiredEvidence.length && unsatisfiedEvidence.length) blockingReasons.push('Required evidence has not been supplied as verified proof.');
  if (sensitive) blockingReasons.push('Scope touches or implies forbidden, generated, runtime, policy, merge, environment, or secret-bearing work.');
  if (allowedForbiddenOverlaps.length) blockingReasons.push('Allowed source scope overlaps a forbidden scope.');

  const requestedRound = Number(supportSnapshot.coBuilderLoopRound || coBuilderLoopProjection.loopRound || 1) || 1;
  if (requestedRound > MAX_REPAIR_ROUNDS) blockingReasons.push('Maximum repair rounds exceeded.');
  if (asList(verificationReturnIntake.missingEvidence).length) blockingReasons.push('Required evidence is missing.');

  let primaryOwner = 'BLOCKED';
  let supportingAgent = 'BLOCKED';
  let activeWriter = 'none';
  const browserProofRequired = harnessAgentProjection.browserProofRequired === true || missionKind === 'live-browser-investigation' || asText(agentWorkRoutingProjection.requiredProof, '').includes('browser');

  if (!blockingReasons.length) {
    if (missionKind === 'live-browser-investigation') {
      primaryOwner = 'OpenClaw';
      supportingAgent = 'Codex';
      activeWriter = 'none';
    } else if (missionKind === 'implementation') {
      primaryOwner = 'Codex';
      supportingAgent = 'OpenClaw';
      activeWriter = 'Codex';
    } else {
      blockingReasons.push('Mission kind is unclear.');
    }
  }

  const blocked = blockingReasons.length > 0;
  if (blocked) {
    primaryOwner = 'BLOCKED';
    supportingAgent = 'BLOCKED';
    activeWriter = 'none';
  }

  const allowedActions = activeWriter === 'Codex'
    ? ['read-source', 'edit-allowed-source-files', 'run-focused-tests', 'run-build', 'run-verify', 'report-evidence']
    : (primaryOwner === 'OpenClaw' ? ['read-only-discovery', 'live-runtime-inspection', 'browser-verification', 'report-evidence'] : []);

  const finalVerdict = blocked ? 'BLOCKED' : 'READY_FOR_OPERATOR_APPROVAL';

  return {
    schemaVersion: CO_BUILDER_OPERATIONAL_PACKET_SCHEMA_VERSION,
    packetKind: CO_BUILDER_OPERATIONAL_PACKET_KIND,
    missionId: resolvedMissionId,
    operatorIntent: asText(operatorIntent || missionBrainNextAction.missionObjective, ''),
    intendedOutcome: asText(intendedOutcome || missionIntelligenceSummary.nextBestAction || missionBrainNextAction.nextBestAction, ''),
    missionStatus: asText(missionStatus || missionIntelligenceSummary.missionIntelligenceStatus, 'unknown'),
    primaryOwner,
    supportingAgent,
    activeWriter,
    allowedFiles,
    forbiddenFiles,
    allowedActions,
    disallowedActions: ['auto-dispatch', 'auto-write-outside-allowed-files', 'simultaneous-agent-writes', 'auto-approve', 'auto-merge', 'edit-generated-output', 'edit-runtime-data', 'edit-secrets'],
    requiredEvidence,
    suppliedEvidence,
    rejectedSuppliedEvidenceCount: sanitizedEvidence.rejectedCount,
    unsatisfiedEvidence,
    scopeOverlaps: allowedForbiddenOverlaps,
    evidenceSatisfied: requiredEvidence.length > 0 && unsatisfiedEvidence.length === 0,
    requiredTests,
    browserProofRequired,
    operatorApprovalRequired: true,
    stopConditions: uniqueList(['scope unclear', 'ownership unclear', 'forbidden path requested', 'missing evidence', 'repair round > 3', ...asList(coBuilderLoopProjection.stopConditions)]),
    completionCriteria: uniqueList([...asList(harnessAgentProjection.definitionOfDone), 'exactly one active writer or read-only inspection packet', 'all required evidence supplied', 'operator final approval before promotion or merge']),
    maximumRepairRounds: MAX_REPAIR_ROUNDS,
    currentRound: clampRound(requestedRound),
    nextAction: blocked ? 'STOP_AND_REQUEST_OPERATOR_CLARIFICATION_OR_EVIDENCE' : (activeWriter === 'Codex' ? 'HAND_TO_CODEX_FOR_BOUNDED_SOURCE_IMPLEMENTATION' : 'HAND_TO_OPENCLAW_FOR_READ_ONLY_BROWSER_OR_RUNTIME_VERIFICATION'),
    blockingReasons,
    finalVerdict,
  };
}
