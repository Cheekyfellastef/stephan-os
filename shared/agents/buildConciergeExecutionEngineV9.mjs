import { validateConciergeCommand } from './battleBridgeBuildConciergeV2.mjs';

export const BUILD_CONCIERGE_EXECUTION_ENGINE_V9_SCHEMA = 'stephanos.build-concierge.execution-engine.v9';
export const BUILD_ENGINE_READINESS_V1_SCHEMA = 'stephanos.build-engine-readiness.v1';
export const CONNECTOR_CAPABILITY_PROBE_V1_SCHEMA = 'stephanos.connector-capability-probe.v1';

const COMMANDS = Object.freeze({
  source_only_build_goal: ['npm run stephanos:build', 'npm run stephanos:verify'],
  proof_only_goal: ['npm run stephanos:verify'],
  ui_surface_goal: ['npm run stephanos:build', 'npm run stephanos:browser-proof'],
  backend_api_goal: ['npm run stephanos:build', 'npm run stephanos:verify'],
});
const PROOFS = Object.freeze({
  source_only_build_goal: ['source-diff', 'local-build', 'local-verify'],
  proof_only_goal: ['local-verify', 'receipt-review'],
  ui_surface_goal: ['source-diff', 'local-build', 'browser-proof', 'surface-render'],
  backend_api_goal: ['source-diff', 'local-build', 'api-route-proof', 'local-verify'],
});
const LANES = Object.freeze({
  source_only_build_goal: 'source-build-proof-lane',
  proof_only_goal: 'proof-only-lane',
  ui_surface_goal: 'ui-surface-proof-lane',
  backend_api_goal: 'backend-api-proof-lane',
  unknown: 'unknown-inspection-lane',
});

function text(value, fallback = '') { const normalized = String(value ?? '').trim(); return normalized || fallback; }
function list(value) { return Array.isArray(value) ? value : []; }
function unique(values = []) { return [...new Set(values.filter(Boolean).map(String))]; }
function goalFromReceipt(receipt = {}) { return receipt.goal && typeof receipt.goal === 'object' ? receipt.goal : receipt; }
function candidateId(receipt = {}, index = 0) { const goal = goalFromReceipt(receipt); return text(goal.id || receipt.receiptId || `live-goal-${index + 1}`); }
function state(value, fallback = 'unknown') { return text(value, fallback).toLowerCase().replace(/[^a-z0-9]+/g, '_'); }
function iso(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function classifyBuildConciergeGoal(goalInput = {}) {
  const goal = goalFromReceipt(goalInput);
  const haystack = `${goal.title || ''}\n${goal.intent || ''}`.toLowerCase();
  const blockers = [];
  if (!text(goal.title) || !text(goal.intent)) blockers.push('Goal title and intent are required before classification.');
  const unsafe = /\b(merge|push|deploy|delete|secret|token|password|approval token|sudo|curl|wget|rm -rf|checkout|reset)\b/i;
  if (unsafe.test(haystack)) blockers.push('Goal contains unsafe automation, secret, merge, or destructive-command intent.');
  let classification = 'unknown';
  if (!blockers.length) {
    if (/\b(ui|surface|dashboard|panel|render|browser|dom|css|clipboard|mission operations|goal dashboard)\b/.test(haystack)) classification = 'ui_surface_goal';
    else if (/\b(api|backend|server|route|endpoint|service|receipt|projection)\b/.test(haystack)) classification = 'backend_api_goal';
    else if (/\b(proof|verify|test|receipt|evidence|browser proof)\b/.test(haystack) && !/\b(build|implement|add|fix|source|code)\b/.test(haystack)) classification = 'proof_only_goal';
    else if (/\b(build|implement|add|fix|source|code|refactor|test)\b/.test(haystack)) classification = 'source_only_build_goal';
  }
  if (classification === 'unknown' && !blockers.length) blockers.push('Goal intent does not match source-only, proof-only, UI/surface, or backend/API classifiers; unknown stays unknown.');
  return { classification, blockers, confidence: classification === 'unknown' ? 'low' : 'medium' };
}

export function buildConnectorCapabilityProbeV1(input = {}) {
  const github = input.github || input.githubConnector || input.connectorCapabilities?.github || {};
  const read = github.read === true || github.fetchFile === true || github.repositoryRead === true || input.githubReadAvailable === true;
  const comment = github.comment === true || github.issueComment === true || input.githubCommentAvailable === true;
  const branch = github.branch === true || github.createBranch === true || input.githubBranchCreateAvailable === true;
  const write = github.write === true || github.contentsWrite === true || input.githubWriteAvailable === true;
  const pullRequest = github.pullRequest === true || github.prCreate === true || input.githubPullRequestAvailable === true;
  const capabilities = {
    read: read ? 'ok' : 'unknown',
    comment: comment ? 'ok' : 'unknown_or_blocked',
    branch: branch ? 'ok' : 'unknown_or_blocked',
    write: write ? 'ok' : 'unknown_or_blocked',
    pullRequest: pullRequest ? 'ok' : 'unknown_or_blocked',
  };
  const blocked = Object.entries(capabilities).filter(([, value]) => value !== 'ok').map(([key, value]) => `${key}:${value}`);
  return Object.freeze({
    schemaVersion: CONNECTOR_CAPABILITY_PROBE_V1_SCHEMA,
    status: blocked.length ? 'partial_or_unknown' : 'all_declared_ok',
    capabilities,
    blockerReasons: blocked,
    lastProbeAtUtc: iso(input.lastProbeAtUtc || input.probedAtUtc),
    proofBoundary: 'connector capabilities are declared or observed by safe probes only; no fake GitHub/Codex proof',
  });
}

export function buildBuildEngineReadinessV1(input = {}) {
  const connectorProbe = input.connectorProbe || buildConnectorCapabilityProbeV1(input.connectorCapabilities || input);
  const codex = input.codex || input.codexCapacity || {};
  const activeJob = text(input.activeJob || codex.activeJob || 'none');
  const lastAttemptUtc = iso(input.lastAttemptUtc || codex.lastAttemptUtc || codex.lastDispatchAttemptUtc);
  const nextRetryUtc = iso(input.nextRetryUtc || codex.nextRetryUtc);
  const capacityState = state(codex.capacity || codex.status || input.codexCapacityState, 'unknown');
  const dispatchAvailable = codex.dispatchAvailable === true || input.codexDispatchAvailable === true;
  const meterBlocked = ['blocked_by_meter', 'meter_blocked', 'quota_exhausted', 'waiting_for_quota_reset'].includes(capacityState);
  const connectorCanWrite = connectorProbe.capabilities?.branch === 'ok' && connectorProbe.capabilities?.write === 'ok';
  const automaticResumeEligible = dispatchAvailable && connectorCanWrite && activeJob === 'none' && !meterBlocked;
  const blockers = unique([
    ...(dispatchAvailable ? [] : ['Codex dispatch path is not proven available.']),
    ...(connectorCanWrite ? [] : ['GitHub branch/write connector capability is not fully proven.']),
    ...(meterBlocked ? ['Codex capacity is blocked by meter/quota state.'] : []),
    ...(activeJob !== 'none' ? [`Active build job already present: ${activeJob}`] : []),
    ...list(input.blockers),
  ]);
  const status = automaticResumeEligible ? 'ready_to_resume' : (meterBlocked ? 'waiting_for_codex_capacity' : (blockers.length ? 'blocked_or_waiting' : 'ready_model_only'));
  const fallbackOwner = text(input.fallbackOwner || codex.fallbackOwner || (dispatchAvailable ? 'build-concierge' : 'operator-or-openclaw'));
  return Object.freeze({
    schemaVersion: BUILD_ENGINE_READINESS_V1_SCHEMA,
    status,
    connectorProbe,
    codex: {
      dispatchAvailable,
      capacityState,
      activeJob,
      lastAttemptUtc,
      nextRetryUtc,
      automaticResumeEligible,
      fallbackOwner,
    },
    retry: {
      lastAttemptUtc,
      nextRetryUtc,
      automaticResumeEligible,
      fallbackOwner,
    },
    blockers,
    nextOperatorAction: automaticResumeEligible ? 'Resume the next eligible build lane through the approved adapter; preserve exact-head proof.' : (blockers[0] || 'Keep readiness modeled until a dispatch receipt exists.'),
    commandExecutionAllowed: false,
    mergeAllowed: false,
    codexDispatchAllowed: false,
  });
}

export function buildCodexMissionPacket({ receipt = {}, candidate = {} } = {}) {
  const goal = goalFromReceipt(receipt);
  return [
    `Build Concierge V9 mission packet for ${candidate.candidateId || candidateId(receipt)}`,
    `Title: ${text(goal.title, candidate.title || 'unknown')}`,
    `Intent: ${text(goal.intent, 'unknown')}`,
    `Suggested lane: ${candidate.suggestedLane || 'unknown'}`,
    `Required proof families: ${list(candidate.requiredProofFamilies).join(', ') || 'unknown'}`,
    `Allowlisted proof commands: ${list(candidate.declaredAllowlistedProofCommands).join(' && ') || 'none'}`,
    'Guardrails: no command execution by projection, no merge execution, no fake GitHub/local/browser proof, preserve exact-head approval and post-merge reproof.',
  ].join('\n');
}

export function buildConciergeExecutionEngineV9(input = {}) {
  const receipts = list(input.receipts || input.goalReceipts);
  const adapterAvailable = input.dispatchAdapterAvailable === true || input.githubCodexMissionDispatchAvailable === true;
  const sourceApproved = input.sourceApproved === true || input.explicitSourceApproval === true;
  const requestedActive = list(input.activeExecutionLane || input.activeProofLane).filter(Boolean);
  const readiness = buildBuildEngineReadinessV1({
    connectorCapabilities: input.connectorCapabilities || input.connectorProbe || {},
    codex: input.codex || input.codexCapacity || {},
    codexDispatchAvailable: adapterAvailable,
    activeJob: input.activeJob,
    lastAttemptUtc: input.lastAttemptUtc,
    nextRetryUtc: input.nextRetryUtc,
    fallbackOwner: input.fallbackOwner,
  });
  const blockers = [];
  if (requestedActive.length > 1) blockers.push('One active proof lane guardrail blocks multiple active execution lanes unless explicitly isolated.');
  const enrichedCandidates = receipts.map((receipt, index) => {
    const goal = goalFromReceipt(receipt);
    const classified = classifyBuildConciergeGoal(receipt);
    const commands = COMMANDS[classified.classification] || [];
    const commandProof = commands.map(validateConciergeCommand);
    const unsafeCommandBlockers = commandProof.filter((proof) => !proof.allowed).map((proof) => proof.blocker);
    const manualDispatchRequired = classified.classification !== 'unknown' && !adapterAvailable;
    const dispatchReady = classified.classification !== 'unknown' && adapterAvailable && sourceApproved && !classified.blockers.length && !unsafeCommandBlockers.length && requestedActive.length <= 1;
    const candidate = {
      candidateId: candidateId(receipt, index),
      title: text(goal.title, 'Untitled Build Concierge goal'),
      classification: classified.classification,
      suggestedLane: LANES[classified.classification],
      requiredProofFamilies: PROOFS[classified.classification] || [],
      declaredAllowlistedProofCommands: commandProof.filter((proof) => proof.allowed).map((proof) => proof.command),
      dispatchReadiness: dispatchReady ? 'READY_MODEL_ONLY_SOURCE_APPROVED' : (manualDispatchRequired ? 'MANUAL_DISPATCH_REQUIRED' : 'BLOCKED_OR_UNKNOWN'),
      dispatchReady,
      buildEngineReadiness: readiness.status,
      blockerReasons: unique([...classified.blockers, ...unsafeCommandBlockers, ...(adapterAvailable && !sourceApproved && classified.classification !== 'unknown' ? ['Safe dispatch adapter present, but exact source approval for dispatch is absent; readiness is modeled only.'] : [])]),
      nextOperatorAction: manualDispatchRequired ? 'Copy the Codex mission packet into an explicitly approved Codex dispatch surface.' : (dispatchReady ? 'Operator may dispatch through the approved adapter; this projection does not execute dispatch.' : 'Resolve blockers or leave the goal unknown/blocked.'),
      commandExecutionAllowed: false,
      mergeAllowed: false,
      codexDispatchExecuted: false,
    };
    return { ...candidate, codexMissionPacket: manualDispatchRequired ? buildCodexMissionPacket({ receipt, candidate }) : '' };
  });
  const dispatchPackets = enrichedCandidates.filter((c) => c.dispatchReadiness === 'MANUAL_DISPATCH_REQUIRED').map((c) => ({ candidateId: c.candidateId, status: 'MANUAL_DISPATCH_REQUIRED', packet: c.codexMissionPacket }));
  const classifiedGoalCount = enrichedCandidates.filter((c) => c.classification !== 'unknown').length;
  const allBlockers = unique([...blockers, ...enrichedCandidates.flatMap((c) => c.blockerReasons), ...list(input.includeReadinessBlockers ? readiness.blockers : [])]);
  return {
    schemaVersion: BUILD_CONCIERGE_EXECUTION_ENGINE_V9_SCHEMA,
    status: allBlockers.length ? 'blocked_or_manual' : (enrichedCandidates.length ? 'ready_model_only' : 'idle'),
    watchedGoalCount: receipts.length,
    classifiedGoalCount,
    enrichedCandidateCount: enrichedCandidates.length,
    dispatchReadyCount: enrichedCandidates.filter((c) => c.dispatchReady).length,
    manualDispatchRequiredCount: dispatchPackets.length,
    activeExecutionLane: requestedActive[0] || enrichedCandidates.find((c) => c.classification !== 'unknown')?.suggestedLane || 'none',
    buildEngineReadiness: readiness,
    connectorCapabilityProbe: readiness.connectorProbe,
    enrichedCandidates,
    dispatchPackets,
    blockers: allBlockers,
    nextOperatorAction: dispatchPackets.length ? 'Copy a MANUAL_DISPATCH_REQUIRED Codex mission packet; do not claim Codex ran until a receipt exists.' : (allBlockers[0] || readiness.nextOperatorAction || 'Continue guarded Build Concierge execution modeling; no commands or merges executed.'),
    finalVerdict: allBlockers.length ? 'BUILD_CONCIERGE_V9_BLOCKED_OR_MANUAL_DISPATCH_REQUIRED' : 'BUILD_CONCIERGE_V9_READY_MODEL_ONLY',
    commandExecutionAllowed: false,
    mergeAllowed: false,
    codexDispatchAllowed: false,
  };
}
