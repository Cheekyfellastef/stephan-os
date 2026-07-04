import { validateConciergeCommand } from './battleBridgeBuildConciergeV2.mjs';

export const BUILD_CONCIERGE_EXECUTION_ENGINE_V9_SCHEMA = 'stephanos.build-concierge.execution-engine.v9';
export const CONNECTOR_CAPABILITY_PROBE_V1_SCHEMA = 'stephanos.connector-capability-probe.v1';
export const BUILD_ENGINE_READINESS_V1_SCHEMA = 'stephanos.build-engine-readiness.v1';

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

const PROGRAM_ISSUES = Object.freeze([1284, 1286, 1287, 1290, 1291, 1292, 1293]);
const ISSUE_TITLES = Object.freeze({
  1284: 'Codex-resilience builder lane capability',
  1286: 'Operator automation layer',
  1287: 'Verification Harness V1',
  1290: 'Shared Agent Workspace V1',
  1291: 'Remote Battle Bridge Bootstrap V1',
  1292: 'Codex Dispatch Queue V1',
  1293: 'Automated Codex Dispatcher V1',
});
const PRIORITY_ORDER = Object.freeze([1290, 1287, 1291, 1292, 1293, 1284, 1286]);

function text(value, fallback = '') { const normalized = String(value ?? '').trim(); return normalized || fallback; }
function list(value) { return Array.isArray(value) ? value : []; }
function unique(values = []) { return [...new Set(values.filter(Boolean).map(String))]; }
function goalFromReceipt(receipt = {}) { return receipt.goal && typeof receipt.goal === 'object' ? receipt.goal : receipt; }
function candidateId(receipt = {}, index = 0) { const goal = goalFromReceipt(receipt); return text(goal.id || receipt.receiptId || `live-goal-${index + 1}`); }
function boolCapability(value) { return value === true ? 'OK' : (value === false ? 'BLOCKED' : 'UNKNOWN'); }
function issueKey(issue) { return `#${issue}`; }

export function buildConnectorCapabilityProbeV1(input = {}) {
  const github = input.github || input.githubConnector || {};
  const codex = input.codex || {};
  const read = boolCapability(github.readAvailable ?? github.read ?? github.adapterAvailable);
  const comment = boolCapability(github.commentAvailable ?? github.comment ?? github.issueCommentWriteAvailable);
  const branch = boolCapability(github.branchCreateAvailable ?? github.branchCreate ?? github.createBranchAvailable);
  const fileWrite = boolCapability(github.fileWriteAvailable ?? github.fileWrite ?? github.contentsWriteAvailable);
  const prCreate = boolCapability(github.prCreateAvailable ?? github.prCreate ?? github.pullRequestCreateAvailable);
  const codexDispatch = boolCapability(codex.dispatchIntegrationAvailable ?? codex.dispatchAvailable ?? codex.integrationAvailable);
  const blockers = unique([
    read !== 'OK' ? 'GitHub read capability is not proven.' : '',
    comment !== 'OK' ? 'GitHub comment capability is not proven.' : '',
    branch !== 'OK' ? 'GitHub branch creation capability is not proven.' : '',
    fileWrite !== 'OK' ? 'GitHub file write capability is not proven.' : '',
    prCreate !== 'OK' ? 'GitHub PR creation capability is not proven.' : '',
    codexDispatch !== 'OK' ? 'Codex dispatch integration is not proven.' : '',
  ]);
  return Object.freeze({
    schemaVersion: CONNECTOR_CAPABILITY_PROBE_V1_SCHEMA,
    github: { read, comment, branch, fileWrite, prCreate },
    codex: {
      dispatchIntegration: codexDispatch,
      capacityState: text(codex.capacityState || codex.meterState, codexDispatch === 'OK' ? 'unknown' : 'blocked-by-no-integration'),
      lastAttemptUtc: text(codex.lastAttemptUtc || codex.lastDispatchAttemptUtc, 'none'),
      nextRetryUtc: text(codex.nextRetryUtc || codex.nextDispatchRetryUtc, 'unknown'),
    },
    blockers,
    finalVerdict: blockers.length ? 'CONNECTOR_CAPABILITY_PROBE_BLOCKED_OR_UNKNOWN' : 'CONNECTOR_CAPABILITY_PROBE_READY',
  });
}

function classifyProgramIssue(issue, context = {}) {
  const probe = context.connectorCapabilityProbe || buildConnectorCapabilityProbeV1(context);
  const workspaceReady = context.sharedWorkspaceReady === true || context.workspace?.ready === true;
  const verificationReady = context.verificationHarnessReady === true || context.verification?.ready === true;
  const localWindowsProofReady = context.localWindowsProofReady === true || context.localWindowsProof?.ready === true;
  const openclawReady = context.openclawReady === true || context.openclaw?.builderReady === true;
  const codexDispatchReady = probe.codex.dispatchIntegration === 'OK' && !/blocked/i.test(probe.codex.capacityState);
  const githubWritesReady = ['branch', 'fileWrite', 'prCreate'].every((key) => probe.github[key] === 'OK');

  if (context.doneIssues && list(context.doneIssues).map(Number).includes(Number(issue))) return 'DONE';
  if (issue === 1290) return githubWritesReady ? 'READY_TO_BUILD' : 'BLOCKED_BY_SAFETY_POLICY';
  if (issue === 1287) return workspaceReady ? (githubWritesReady ? 'READY_TO_BUILD' : 'BLOCKED_BY_SAFETY_POLICY') : 'NEEDS_CODEX';
  if (issue === 1291) return verificationReady ? 'NEEDS_LOCAL_WINDOWS_PROOF' : 'NEEDS_CODEX';
  if (issue === 1292) return workspaceReady ? (githubWritesReady ? 'READY_TO_BUILD' : 'BLOCKED_BY_SAFETY_POLICY') : 'NEEDS_CODEX';
  if (issue === 1293) return codexDispatchReady ? 'READY_TO_BUILD' : 'BLOCKED_BY_MISSING_INTEGRATION';
  if (issue === 1284) return openclawReady ? 'READY_TO_BUILD' : 'NEEDS_OPENCLAW';
  if (issue === 1286) return localWindowsProofReady ? 'READY_TO_BUILD' : 'NEEDS_OPENCLAW';
  return 'BLOCKED_BY_UNCLEAR_SCOPE';
}

export function buildBuildEngineReadinessV1(input = {}) {
  const probe = input.connectorCapabilityProbe || buildConnectorCapabilityProbeV1(input);
  const issueClassifications = PRIORITY_ORDER.map((issue) => {
    const classification = classifyProgramIssue(issue, { ...input, connectorCapabilityProbe: probe });
    const reason = classification === 'READY_TO_BUILD'
      ? 'Scope is bounded and connector/source path appears available for a guarded implementation slice.'
      : classification === 'NEEDS_CODEX'
        ? 'Source implementation is needed before this dependent lane can be proven.'
        : classification === 'NEEDS_OPENCLAW'
          ? 'OpenClaw local capability/proof is needed before this lane can advance.'
          : classification === 'NEEDS_LOCAL_WINDOWS_PROOF'
            ? 'Battle Bridge scheduled task, service, or worker recovery proof must be captured locally.'
            : classification === 'BLOCKED_BY_MISSING_INTEGRATION'
              ? 'Automated Codex dispatch integration is not proven; record blocked-by-no-integration until a real path exists.'
              : classification === 'BLOCKED_BY_SAFETY_POLICY'
                ? 'GitHub write capability is not fully proven for branch/file/PR operations.'
                : classification === 'DONE'
                  ? 'Done marker supplied by receipts/context.'
                  : 'Scope is not yet precise enough for a safe build.';
    return Object.freeze({ issue: issueKey(issue), title: ISSUE_TITLES[issue], classification, reason });
  });
  const nextBuild = issueClassifications.find((item) => item.classification === 'READY_TO_BUILD') || null;
  const blockers = unique([
    ...list(probe.blockers),
    ...issueClassifications.filter((item) => !['READY_TO_BUILD', 'DONE'].includes(item.classification)).map((item) => `${item.issue}: ${item.classification}`),
  ]);
  return Object.freeze({
    schemaVersion: BUILD_ENGINE_READINESS_V1_SCHEMA,
    connectorCapabilityProbe: probe,
    issueClassifications,
    priorityOrder: PRIORITY_ORDER.map(issueKey),
    buildingNow: nextBuild ? `${nextBuild.issue} ${nextBuild.title}` : 'none',
    nextThreeActions: nextBuild ? [
      `Build smallest safe source slice for ${nextBuild.issue}.`,
      'Run deterministic local verification harness/build tests before success is reported.',
      'Open draft PR and wait for exact-head operator approval before merge.',
    ] : [
      'Prove GitHub branch/file/PR write capability or record blocked-by-policy.',
      'Prepare manual Codex/OpenClaw packet for the highest-priority blocked lane.',
      'Capture local Windows proof when Battle Bridge-specific checks are required.',
    ],
    operatorNeeded: blockers.some((blocker) => /approval|policy|local windows/i.test(blocker)),
    localWindowsProofNeeded: issueClassifications.some((item) => item.classification === 'NEEDS_LOCAL_WINDOWS_PROOF'),
    codexNeeded: issueClassifications.some((item) => item.classification === 'NEEDS_CODEX'),
    openclawNeeded: issueClassifications.some((item) => item.classification === 'NEEDS_OPENCLAW'),
    blockers,
    exactNextPromptOrCommand: nextBuild ? 'node --test shared/agents/buildConciergeExecutionEngineV9.test.mjs' : 'Capture CONNECTOR_CAPABILITY_PROBE_V1 and Shared Agent Workspace readiness proof before building.',
    finalVerdict: nextBuild ? 'BUILD_ENGINE_READINESS_READY_TO_BUILD' : 'BUILD_ENGINE_READINESS_BLOCKED_OR_WAITING',
  });
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
  const blockers = [];
  if (requestedActive.length > 1) blockers.push('One active proof lane guardrail blocks multiple active execution lanes unless explicitly isolated.');
  const buildEngineReadiness = buildBuildEngineReadinessV1(input.buildEngineReadiness || input);
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
      blockerReasons: unique([...classified.blockers, ...unsafeCommandBlockers, ...(adapterAvailable && !sourceApproved && classified.classification !== 'unknown' ? ['Safe dispatch adapter present, but exact source approval for dispatch is absent; readiness is modeled only.'] : [])]),
      nextOperatorAction: manualDispatchRequired ? 'Copy the Codex mission packet into an explicitly approved Codex dispatch surface.' : (dispatchReady ? 'Operator may dispatch through the approved adapter; this projection does not execute dispatch.' : 'Resolve blockers or leave the goal unknown/blocked.'),
      commandExecutionAllowed: false,
      mergeAllowed: false,
      codexDispatchExecuted: false
    };
    return { ...candidate, codexMissionPacket: manualDispatchRequired ? buildCodexMissionPacket({ receipt, candidate }) : '' };
  });
  const dispatchPackets = enrichedCandidates.filter((c) => c.dispatchReadiness === 'MANUAL_DISPATCH_REQUIRED').map((c) => ({ candidateId: c.candidateId, status: 'MANUAL_DISPATCH_REQUIRED', packet: c.codexMissionPacket }));
  const classifiedGoalCount = enrichedCandidates.filter((c) => c.classification !== 'unknown').length;
  const allBlockers = unique([...blockers, ...enrichedCandidates.flatMap((c) => c.blockerReasons)]);
  return {
    schemaVersion: BUILD_CONCIERGE_EXECUTION_ENGINE_V9_SCHEMA,
    status: allBlockers.length ? 'blocked_or_manual' : (enrichedCandidates.length ? 'ready_model_only' : 'idle'),
    watchedGoalCount: receipts.length,
    classifiedGoalCount,
    enrichedCandidateCount: enrichedCandidates.length,
    dispatchReadyCount: enrichedCandidates.filter((c) => c.dispatchReady).length,
    manualDispatchRequiredCount: dispatchPackets.length,
    activeExecutionLane: requestedActive[0] || enrichedCandidates.find((c) => c.classification !== 'unknown')?.suggestedLane || 'none',
    buildEngineReadiness,
    connectorCapabilityProbe: buildEngineReadiness.connectorCapabilityProbe,
    enrichedCandidates,
    dispatchPackets,
    blockers: allBlockers,
    nextOperatorAction: dispatchPackets.length ? 'Copy a MANUAL_DISPATCH_REQUIRED Codex mission packet; do not claim Codex ran until a receipt exists.' : (allBlockers[0] || 'Continue guarded Build Concierge execution modeling; no commands or merges executed.'),
    finalVerdict: allBlockers.length ? 'BUILD_CONCIERGE_V9_BLOCKED_OR_MANUAL_DISPATCH_REQUIRED' : 'BUILD_CONCIERGE_V9_READY_MODEL_ONLY',
    commandExecutionAllowed: false,
    mergeAllowed: false,
    codexDispatchAllowed: false,
  };
}
