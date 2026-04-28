function asText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asList(value) {
  return Array.isArray(value)
    ? value.map((entry) => asText(entry)).filter(Boolean)
    : [];
}

function normalizeKillSwitchState(value = '') {
  const normalized = asText(value, 'unknown').toLowerCase();
  if (['unavailable', 'required', 'available', 'engaged', 'disengaged', 'unknown'].includes(normalized)) {
    return normalized;
  }
  if (normalized === 'missing') return 'required';
  if (normalized === 'degraded') return 'unavailable';
  return 'unknown';
}

function normalizeKillSwitchMode(value = '') {
  const normalized = asText(value, 'unavailable').toLowerCase();
  if (['policy_only', 'manual_operator', 'local_runtime', 'unavailable'].includes(normalized)) {
    return normalized;
  }
  return 'unavailable';
}

function resolveMode(input = {}) {
  if (asText(input.killSwitchMode)) {
    return normalizeKillSwitchMode(input.killSwitchMode);
  }
  const integrationMode = asText(input.integrationMode || input.mode, 'policy_only').toLowerCase();
  if (integrationMode === 'policy_only') return 'policy_only';
  if (integrationMode === 'local_adapter') return 'local_runtime';
  if (integrationMode === 'direct_adapter') return 'manual_operator';
  return 'unavailable';
}

export function adjudicateOpenClawKillSwitch(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const killSwitchMode = resolveMode(source);
  const normalizedState = normalizeKillSwitchState(source.killSwitchState || source.killSwitch);
  const killSwitchState = killSwitchMode === 'policy_only' && ['unknown', 'unavailable'].includes(normalizedState)
    ? 'required'
    : normalizedState;
  const killSwitchReason = asText(source.killSwitchReason)
    || (killSwitchMode === 'policy_only'
      ? 'Policy-only posture requires explicit kill-switch wiring before automation readiness.'
      : killSwitchState === 'engaged'
        ? 'Operator safety cutoff is currently engaged.'
        : '');
  const killSwitchBlockers = asList(source.killSwitchBlockers);
  const killSwitchWarnings = asList(source.killSwitchWarnings);
  const wiringAvailable = ['available', 'disengaged', 'engaged'].includes(killSwitchState);
  const killSwitchEngaged = killSwitchState === 'engaged';
  const modeSupportsExecution = killSwitchMode !== 'policy_only' && killSwitchMode !== 'unavailable';
  const safeConditionsSatisfied = source.safeConditionsSatisfied === true;
  const openClawExecutionAllowed = safeConditionsSatisfied
    && modeSupportsExecution
    && wiringAvailable
    && !killSwitchEngaged;
  const operatorCanPauseOpenClaw = wiringAvailable;
  const operatorCanResumeOpenClaw = safeConditionsSatisfied
    && modeSupportsExecution
    && wiringAvailable
    && killSwitchEngaged;
  const topBlocker = killSwitchBlockers[0]
    || (wiringAvailable ? '' : 'Wire OpenClaw kill switch and verify operator control path.')
    || (killSwitchEngaged ? 'Kill switch is engaged; resume requires explicit operator action.' : '')
    || '';
  const killSwitchNextAction = asText(source.killSwitchNextAction)
    || (killSwitchEngaged
      ? 'Review blocker state and keep OpenClaw paused until safe resume conditions are met.'
      : !wiringAvailable
        ? 'Wire OpenClaw kill switch and validate pause/resume lifecycle.'
        : !modeSupportsExecution
          ? 'Keep policy-only posture; do not enable direct automation.'
          : !safeConditionsSatisfied
            ? 'Complete adapter + approvals + blocker closure before enabling execution.'
            : 'Kill switch is wired; maintain operator supervision.');

  return {
    killSwitchState,
    killSwitchMode,
    killSwitchReason,
    killSwitchBlockers,
    killSwitchWarnings,
    killSwitchNextAction,
    openClawExecutionAllowed,
    operatorCanPauseOpenClaw,
    operatorCanResumeOpenClaw,
    killSwitchEvidence: [
      `kill-switch-state:${killSwitchState}`,
      `kill-switch-mode:${killSwitchMode}`,
      `execution-allowed:${openClawExecutionAllowed ? 'yes' : 'no'}`,
      `adapter-readiness:${asText(source.adapterReadiness, 'unknown').toLowerCase()}`,
      `adapter-can-execute:${source.adapterCanExecute === true ? 'yes' : 'no'}`,
      ...killSwitchBlockers.map((entry) => `blocker:${entry}`),
      ...killSwitchWarnings.map((entry) => `warning:${entry}`),
    ],
  };
}
