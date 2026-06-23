const MAX_REPAIR_ROUNDS = 3;

export const CO_BUILDER_OPERATIONAL_PACKET_SCHEMA_VERSION = 'co-builder-operational-packet.v1';
export const CO_BUILDER_OPERATIONAL_PACKET_KIND = 'stephanos.co_builder.operational_packet';

export const DEFAULT_OPERATIONAL_FORBIDDEN_FILES = Object.freeze([
  'apps/stephanos/dist/**',
  'stephanos-server/data/**',
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

const SECRET_OR_GENERATED_PATTERN = /(^|\/)(apps\/stephanos\/dist|stephanos-server\/data|data|tmp|\.git|node_modules)(\/|$)|(^|\/)\.env(\.|$)|\.(pem|pfx|key)$/i;

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

function includesForbiddenPath(path) {
  const text = asText(path, '');
  return !text || SECRET_OR_GENERATED_PATTERN.test(text) || /secret|token/i.test(text);
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

function evidenceItemVerified(item) {
  if (typeof item === 'string') return false;
  if (!item || typeof item !== 'object') return false;
  const status = asText(item.status || item.verificationStatus || item.verdict, '').toLowerCase();
  return item.verified === true || item.supplied === true && item.accepted === true || ['verified', 'accepted', 'passed', 'complete'].includes(status);
}

function evidenceItemText(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  return [item.requirement, item.id, item.label, item.name, item.summary, item.command, item.evidence].map((v) => asText(v, '')).filter(Boolean).join(' ');
}

function evidenceRequirementSatisfied(requirement, suppliedEvidence) {
  const normalizedRequirement = normalizeEvidenceToken(requirement);
  if (!normalizedRequirement) return false;
  return suppliedEvidence.some((item) => evidenceItemVerified(item) && normalizeEvidenceToken(evidenceItemText(item)).includes(normalizedRequirement));
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
  const allowedFiles = rawAllowedFiles.filter((path) => !includesForbiddenPath(path));
  const forbiddenFiles = uniqueList([...DEFAULT_OPERATIONAL_FORBIDDEN_FILES, ...asList(harnessAgentProjection.forbiddenFileScopes), ...asList(harnessAgentProjection.forbiddenFiles), ...rawAllowedFiles.filter(includesForbiddenPath)]);
  const requiredEvidence = uniqueList([
    ...asList(agentWorkRoutingProjection.requiredProof),
    ...asList(missionBrainNextAction.proofRequiredBeforeMerge),
    ...asList(verificationReturnIntake.missingEvidence),
  ]);
  const requiredTests = uniqueList([
    ...asList(harnessAgentProjection.requiredTests),
    ...asList(agentWorkRoutingProjection.requiredTests),
  ]);
  const suppliedEvidence = collectSuppliedEvidence({ verificationReturnIntake, supportSnapshot, agentWorkRoutingProjection });
  const unsatisfiedEvidence = requiredEvidence.filter((requirement) => !evidenceRequirementSatisfied(requirement, suppliedEvidence));
  const resolvedMissionId = asText(missionId || supportSnapshot.missionId, 'mission-unresolved');
  const blockingReasons = [];
  const missionKind = inferMissionKind({ operatorIntent, missionBrainNextAction, supportSnapshot });
  const sensitive = asText(harnessAgentProjection.generatedArtifactRisk, '').toLowerCase() === 'yes'
    || forbiddenFiles.some((path) => rawAllowedFiles.includes(path))
    || rawAllowedFiles.some(includesForbiddenPath)
    || /secret|token|env|generated|dist|runtime data|merge|deploy|permission|policy/i.test([operatorIntent, intendedOutcome].join(' '));

  if (isPlaceholderMissionId(resolvedMissionId)) blockingReasons.push('Mission id is missing, placeholder, or unresolved.');
  if (!asText(operatorIntent, '')) blockingReasons.push('Operator intent is missing.');
  if (!asText(intendedOutcome || missionBrainNextAction.missionObjective || missionIntelligenceSummary.currentMissionSummary, '')) blockingReasons.push('Intended outcome is unclear.');
  if (!allowedFiles.length && missionKind === 'implementation') blockingReasons.push('Allowed source file scope is unclear.');
  if (!requiredEvidence.length) blockingReasons.push('Evidence requirements are unclear.');
  if (requiredEvidence.length && unsatisfiedEvidence.length) blockingReasons.push('Required evidence has not been supplied as verified proof.');
  if (sensitive) blockingReasons.push('Scope touches or implies forbidden, generated, runtime, policy, merge, environment, or secret-bearing work.');

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
    suppliedEvidence: suppliedEvidence.map(evidenceItemText).filter(Boolean),
    unsatisfiedEvidence,
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
