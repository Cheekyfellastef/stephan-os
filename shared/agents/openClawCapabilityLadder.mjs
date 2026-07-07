import { createCodexQueueRecord } from './codexDispatchQueue.mjs';
import { createSharedWorkspaceMessage } from './sharedAgentWorkspace.mjs';
import { createAgentCapabilityRecord } from './sharedAgentWorkspaceStore.mjs';
import { runVerificationHarness } from './verificationHarness.mjs';

export const OPENCLAW_CAPABILITY_LADDER_SCHEMA_VERSION = 'openclaw-capability-ladder.v1';

export const OPENCLAW_CAPABILITY_STAGES = Object.freeze([
  'repo_scout',
  'test_runner',
  'patch_prep',
  'approval_gated_writer',
  'pr_helper',
]);

export const OPENCLAW_STAGE_STATE = Object.freeze({
  CAN_RUN_NOW: 'CAN_RUN_NOW',
  NEEDS_APPROVAL: 'NEEDS_APPROVAL',
  BLOCKED: 'BLOCKED',
});

export const OPENCLAW_CAPABILITY_GUARDRAILS = Object.freeze({
  defaultMode: 'design_only',
  boundedWritePath: '/courier-open',
  arbitraryShellAllowed: false,
  trustedSourceWritesAllowed: false,
  approvalSpoofingAllowed: false,
  mergeAuthority: false,
  secretDumpingAllowed: false,
  sourceRepositoryWritesAllowed: false,
});

const STAGE_RULES = Object.freeze({
  repo_scout: { state: OPENCLAW_STAGE_STATE.CAN_RUN_NOW, exactNextAction: 'Read repository metadata and publish a design-only scout note to Shared Workspace.' },
  test_runner: { state: OPENCLAW_STAGE_STATE.CAN_RUN_NOW, exactNextAction: 'Run allowlisted deterministic proof commands through the verification harness and publish receipts.' },
  patch_prep: { state: OPENCLAW_STAGE_STATE.CAN_RUN_NOW, exactNextAction: 'Prepare a patch proposal packet in Shared Workspace without source writes.' },
  approval_gated_writer: { state: OPENCLAW_STAGE_STATE.NEEDS_APPROVAL, exactNextAction: 'Operator must approve bounded /courier-open write handoff before any writer action.' },
  pr_helper: { state: OPENCLAW_STAGE_STATE.BLOCKED, exactNextAction: 'Wait for Codex-owned committed source changes and proof; OpenClaw has no merge or PR authority.' },
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function safeStage(value) {
  const stage = text(value);
  return OPENCLAW_CAPABILITY_STAGES.includes(stage) ? stage : '';
}

export function buildOpenClawCapabilityLadderContract() {
  return Object.freeze({
    schemaVersion: OPENCLAW_CAPABILITY_LADDER_SCHEMA_VERSION,
    contractKind: 'stephanos.openclaw.capability_ladder.contract',
    stages: [...OPENCLAW_CAPABILITY_STAGES],
    states: Object.values(OPENCLAW_STAGE_STATE),
    publishes: 'stephanos.shared_workspace.agent_capability',
    verifiesWith: 'stephanos.verification.contract',
    dispatchIntegration: 'stephanos.codex_dispatch.queue_record',
    guardrails: { ...OPENCLAW_CAPABILITY_GUARDRAILS },
    finalVerdict: 'OPENCLAW_CAPABILITY_LADDER_CONTRACT_READY',
  });
}

export function createOpenClawCapabilityRecord(input = {}) {
  const stage = safeStage(input.stage) || 'repo_scout';
  const rule = STAGE_RULES[stage];
  const capability = createAgentCapabilityRecord({
    agentId: 'openclaw',
    timestampUtc: input.timestampUtc || 'pending',
    proofRefs: input.proofRefs || [`proof/openclaw/${stage}.json`],
  });
  return Object.freeze({
    ...capability,
    schemaVersion: capability.schemaVersion,
    capabilitySchemaVersion: OPENCLAW_CAPABILITY_LADDER_SCHEMA_VERSION,
    stage,
    stageState: rule.state,
    canRunNow: rule.state === OPENCLAW_STAGE_STATE.CAN_RUN_NOW,
    needsApproval: rule.state === OPENCLAW_STAGE_STATE.NEEDS_APPROVAL,
    blocked: rule.state === OPENCLAW_STAGE_STATE.BLOCKED,
    exactNextAction: rule.exactNextAction,
  });
}

export function verifyOpenClawCapabilityStage(input = {}) {
  const record = createOpenClawCapabilityRecord(input);
  return runVerificationHarness({
    aggregateId: `openclaw-${record.stage}-capability`,
    timestampUtc: input.timestampUtc || record.timestampUtc,
    verifiers: ['AgentCapabilityVerifier', 'ProofReferenceVerifier'],
    packets: {
      AgentCapabilityVerifier: { record },
      ProofReferenceVerifier: { proofRefs: record.proofRefs },
    },
  });
}

export function projectOpenClawOperatorAutomation(input = {}) {
  const timestampUtc = input.timestampUtc || 'pending';
  const records = OPENCLAW_CAPABILITY_STAGES.map((stage) => createOpenClawCapabilityRecord({ stage, timestampUtc }));
  const canRunNow = records.filter((record) => record.canRunNow).map((record) => record.stage);
  const needsApproval = records.filter((record) => record.needsApproval).map((record) => record.stage);
  const blocked = records.filter((record) => record.blocked).map((record) => record.stage);
  const exactNextAction = STAGE_RULES.repo_scout.exactNextAction;
  return Object.freeze({
    schemaVersion: OPENCLAW_CAPABILITY_LADDER_SCHEMA_VERSION,
    kind: 'stephanos.openclaw.operator_automation_projection',
    agentId: 'openclaw',
    timestampUtc,
    canRunNow,
    needsApproval,
    blocked,
    exactNextAction,
    records,
    sharedWorkspaceMessage: createSharedWorkspaceMessage({
      messageId: 'openclaw-capability-ladder',
      sender: 'openclaw',
      recipient: 'operator',
      channel: 'operator-automation',
      kind: 'capability-update',
      severity: 'info',
      correlationId: '#1284-#1286',
      relatedGoal: '#1284 #1286',
      summary: `OpenClaw can run ${canRunNow.join(', ')}; approval required for ${needsApproval.join(', ')}; blocked: ${blocked.join(', ')}.`,
      status: 'DESIGN_ONLY_CAPABILITY_LADDER_READY',
      proofRefs: ['proof/openclaw/capability-ladder.json'],
      requiresOperator: needsApproval.length > 0,
    }),
    guardrails: { ...OPENCLAW_CAPABILITY_GUARDRAILS },
    finalVerdict: 'OPENCLAW_OPERATOR_AUTOMATION_PROJECTION_READY',
  });
}

export function createOpenClawDispatchQueueRecord(input = {}) {
  const stage = safeStage(input.stage) || 'repo_scout';
  const record = createCodexQueueRecord({
    issueNumber: input.issueNumber || 1284,
    branch: input.branch || `codex/openclaw-${stage}`,
    prompt: input.prompt || `Codex review requested for OpenClaw ${stage} capability ladder packet. Keep OpenClaw design_only and source writes Codex-owned.`,
    requestedProofCommands: input.requestedProofCommands || [
      'node --test shared/agents/*openclaw*capability*.test.mjs',
      'node --test shared/agents/*.test.mjs',
    ],
    approvalRequirements: {
      requiresOperatorApprovalBeforeDispatch: stage === 'approval_gated_writer',
      requiresOperatorApprovalBeforeMerge: true,
      approvalReceipt: text(input.approvalReceipt, ''),
    },
    createdAt: input.timestampUtc || 'pending',
  });
  return Object.freeze({ ...record, resultMetadata: Object.freeze({ ...record.resultMetadata, openClawStage: stage, openClawMode: 'design_only', boundedWritePath: '/courier-open' }) });
}
