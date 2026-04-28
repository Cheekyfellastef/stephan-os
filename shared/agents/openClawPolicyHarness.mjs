import { adjudicateOpenClawKillSwitch } from './openClawKillSwitch.mjs';

function asText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asBoolean(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function toMode(value = '') {
  const normalized = asText(value, 'policy_only').toLowerCase();
  if (['policy_only', 'local_adapter', 'direct_adapter'].includes(normalized)) {
    return normalized;
  }
  return 'policy_only';
}

function toKillSwitch(value = '') {
  const normalized = asText(value, 'missing').toLowerCase();
  if (['available', 'missing', 'degraded', 'unknown', 'required', 'engaged', 'disengaged', 'unavailable'].includes(normalized)) {
    return normalized;
  }
  return 'missing';
}

function toApprovals(value) {
  return Array.isArray(value)
    ? value.map((entry) => asText(entry).toLowerCase()).filter(Boolean)
    : [];
}

export function adjudicateOpenClawPolicyHarness(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const mode = toMode(source.integrationMode || source.mode);
  const adapterPresent = asBoolean(source.adapterPresent, mode !== 'policy_only');
  const localAdapter = asBoolean(source.localAdapterAvailable, mode === 'local_adapter');
  const directAdapter = asBoolean(source.directAdapterAvailable, mode === 'direct_adapter');
  const killSwitchState = toKillSwitch(source.killSwitchState || source.killSwitch);
  const approvalsRequired = toApprovals(source.requiredApprovals);
  const approvalsSatisfied = toApprovals(source.satisfiedApprovals);
  const blockers = Array.isArray(source.blockers)
    ? source.blockers.map((entry) => asText(entry)).filter(Boolean)
    : [];
  const approvalsMissing = approvalsRequired.filter((gate) => !approvalsSatisfied.includes(gate));
  const modeSupportsAutomation = mode === 'local_adapter' || mode === 'direct_adapter';
  const adapterSatisfied = adapterPresent && ((mode === 'local_adapter' && localAdapter) || (mode === 'direct_adapter' && directAdapter));
  const noBlockers = blockers.length === 0;
  const approvalsComplete = approvalsMissing.length === 0;
  const safetyPreconditionsSatisfied = modeSupportsAutomation && adapterSatisfied && approvalsComplete && noBlockers;
  const killSwitch = adjudicateOpenClawKillSwitch({
    integrationMode: mode,
    killSwitchState,
    safeConditionsSatisfied: safetyPreconditionsSatisfied,
    killSwitchBlockers: source.killSwitchBlockers,
    killSwitchWarnings: source.killSwitchWarnings,
    killSwitchReason: source.killSwitchReason,
    killSwitchNextAction: source.killSwitchNextAction,
  });
  const killSwitchAvailable = ['available', 'disengaged', 'engaged'].includes(killSwitch.killSwitchState);
  const openClawSafeToUse = modeSupportsAutomation && adapterSatisfied && approvalsComplete && killSwitchAvailable && noBlockers;

  let readiness = 'needs_policy';
  if (openClawSafeToUse) {
    readiness = 'ready';
  } else if (mode === 'policy_only') {
    readiness = 'needs_policy';
  } else if (!adapterSatisfied) {
    readiness = 'needs_adapter';
  } else if (!approvalsComplete) {
    readiness = 'needs_approval';
  } else {
    readiness = 'blocked';
  }

  const highestPriorityBlocker = blockers[0]
    || killSwitch.killSwitchBlockers[0]
    || (killSwitchAvailable ? '' : 'Kill switch must be wired and operator-reachable.')
    || (approvalsMissing[0] ? `Approval missing: ${approvalsMissing[0]}` : '')
    || (modeSupportsAutomation ? '' : 'Policy-only harness is active; direct automation is intentionally disabled.');
  const nextAction = mode === 'policy_only'
    ? killSwitch.killSwitchNextAction
    : !killSwitchAvailable
      ? 'Wire and validate OpenClaw kill switch before enabling automation.'
      : !adapterSatisfied
        ? 'Complete adapter implementation and bind operator approvals.'
        : approvalsMissing.length > 0
          ? `Obtain missing approvals: ${approvalsMissing.join(', ')}.`
          : blockers[0] || 'Resolve remaining OpenClaw blockers.';

  return {
    integrationMode: mode,
    policyOnly: mode === 'policy_only',
    adapterPresent,
    localAdapterAvailable: localAdapter,
    directAdapterAvailable: directAdapter,
    requiredApprovals: approvalsRequired,
    approvalsSatisfied,
    approvalsMissing,
    approvalsComplete,
    killSwitchState: killSwitch.killSwitchState,
    killSwitchMode: killSwitch.killSwitchMode,
    killSwitchAvailable,
    killSwitchReason: killSwitch.killSwitchReason,
    killSwitchBlockers: killSwitch.killSwitchBlockers,
    killSwitchWarnings: killSwitch.killSwitchWarnings,
    killSwitchNextAction: killSwitch.killSwitchNextAction,
    killSwitchEvidence: killSwitch.killSwitchEvidence,
    operatorCanPauseOpenClaw: killSwitch.operatorCanPauseOpenClaw,
    operatorCanResumeOpenClaw: killSwitch.operatorCanResumeOpenClaw,
    openClawExecutionAllowed: killSwitch.openClawExecutionAllowed,
    blockers,
    highestPriorityBlocker,
    nextAction,
    openClawSafeToUse,
    openClawReadiness: readiness,
  };
}
