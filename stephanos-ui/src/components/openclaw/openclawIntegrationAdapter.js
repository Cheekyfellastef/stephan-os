import {
  OPENCLAW_AUTHORITY_MODEL,
  OPENCLAW_COST_POSTURE,
  OPENCLAW_EXECUTION_POSTURE,
  OPENCLAW_MODE,
} from './openclawTilePolicy.js';
import { buildOpenClawGuardrailSnapshot } from './openclawGuardrails.js';

const BOUNDED_INTENT_TYPES = Object.freeze([
  'run-scan',
  'generate-candidate-prompts',
  'submit-build-goal',
  'refresh-status',
]);

function asText(value, fallback = 'unknown') {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function buildBoundedOpenClawIntent(intent = {}) {
  const intentType = asText(intent.intentType);
  const intentPayload = intent.payload && typeof intent.payload === 'object' ? intent.payload : {};
  const accepted = BOUNDED_INTENT_TYPES.includes(intentType);
  return {
    accepted,
    intentType,
    payload: intentPayload,
    rejectionReason: accepted ? '' : 'Intent rejected: adapter accepts bounded scan/prompt/build-goal/status intents only.',
  };
}

export function buildOpenClawIntegrationSnapshot({
  runtimeStatusModel,
  finalRouteTruth,
  repoPath = '/workspace/stephan-os',
  branchName = 'unknown',
  lastScanType = 'none',
  lastInspectionScope = [],
  lastProposedPrompt = 'none',
  sessionState = 'idle',
  currentActivity = 'Standing by for bounded intent.',
} = {}) {
  const guardrails = buildOpenClawGuardrailSnapshot();
  const runtimeContext = runtimeStatusModel?.runtimeContext || {};
  const sandboxActive = runtimeContext.openClawSandboxActive !== false;
  const sandboxStatus = sandboxActive ? 'active (bounded)' : 'off (unsafe)';
  const repoScope = asText(runtimeContext.openClawRepoScope, repoPath);
  const scopeBoundedToRepo = repoScope === repoPath;
  const nativePluginsAllowed = runtimeContext.openClawNativePluginsAllowed === true;
  const skillAllowlist = toArray(runtimeContext.openClawSkillAllowlist);
  const pluginTrustPosture = nativePluginsAllowed ? 'native-plugins-allowed (unsafe)' : 'no-native-plugins';
  const warnings = [];

  if (!sandboxActive) {
    warnings.push('Sandboxing is off. OpenClaw trust posture is unsafe until bounded sandbox is re-enabled.');
  }
  if (nativePluginsAllowed) {
    warnings.push('Native plugin trust is elevated. Disable native plugins to preserve bounded shadow posture.');
  }
  if (!scopeBoundedToRepo) {
    warnings.push('Repo scope is broader than intended workspace path. Restrict OpenClaw scope to target repo.');
  }

  return {
    agentName: 'OpenClaw',
    role: 'Repo Analyst / Governed Builder',
    mode: OPENCLAW_MODE,
    authority: 'Canonical Build Goal Intake',
    approvalRequired: 'Only at existing guarded approval gates',
    authorityModel: OPENCLAW_AUTHORITY_MODEL,
    workspacePath: repoPath,
    repoScope,
    branchName: asText(branchName),
    sandboxStatus,
    skillPolicyStatus: skillAllowlist.length > 0 ? `allowlist (${skillAllowlist.join(', ')})` : 'allowlist not declared',
    pluginTrustPosture,
    sessionState: asText(sessionState),
    currentActivity: asText(currentActivity),
    lastScanType: asText(lastScanType),
    lastInspectionScope: toArray(lastInspectionScope),
    lastProposedPrompt: asText(lastProposedPrompt),
    blockedCapabilities: guardrails.blockedActions,
    zeroCostGuardrailsStatus: guardrails.zeroCostPosture === 'active' && guardrails.paidPathsAllowed === false ? 'active' : 'degraded',
    proposalOnlyEnforced: false,
    governedBuildIntakeEnabled: true,
    directMutationEnforced: guardrails.directExecutionAllowed === false,
    buildIntakePath: '/api/mission-operations/goals/intake/openclaw',
    catastrophicDenyRules: guardrails.blockedActionCount,
    executionPosture: OPENCLAW_EXECUTION_POSTURE,
    costPosture: OPENCLAW_COST_POSTURE,
    connectedTo: {
      missionConsole: 'connected',
      routeTruthSource: asText(finalRouteTruth?.source, 'unknown'),
      approvalRail: 'Stephanos operator approval rail',
      goalConveyor: 'connected',
      builderSelection: 'provider-neutral',
    },
    topology: [
      { id: 'mission-console', label: 'Agent Mission Console', policyNote: 'Operator-visible mission router surface.' },
      { id: 'openclaw-adapter', label: 'OpenClaw Adapter', policyNote: 'Accepts bounded intents and canonical build-goal submissions; direct repo mutation remains blocked.' },
      { id: 'openclaw-agent', label: 'OpenClaw Governed Agent', policyNote: 'Inspects repo-scoped evidence and may submit a bounded build goal into the canonical conveyor.' },
      { id: 'goal-intake', label: 'Canonical Goal Intake', policyNote: 'Creates/deduplicates the issue-backed goal and publishes it to Shared Workspace.' },
      { id: 'goal-conveyor', label: 'Goal -> Builder Conveyor', policyNote: 'Scheduler selects only proven qualified builder capacity and retains responsibility until pickup.' },
      { id: 'approval-rail', label: 'Stephanos Approval Rail', policyNote: 'Existing merge/deploy/operator gates remain authoritative.' },
    ],
    warnings,
  };
}
