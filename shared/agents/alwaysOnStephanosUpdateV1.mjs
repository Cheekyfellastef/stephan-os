export const ALWAYS_ON_UPDATE_SCHEMA_VERSION = 'always-on-stephanos-update.v1';

export const UPDATE_STATE = Object.freeze({
  CURRENT: 'CURRENT',
  UPDATE_AVAILABLE: 'UPDATE_AVAILABLE',
  SAFE_TO_PULL: 'SAFE_TO_PULL',
  REBUILD_REQUIRED: 'REBUILD_REQUIRED',
  RELOAD_REQUIRED: 'RELOAD_REQUIRED',
  READY_TO_APPLY: 'READY_TO_APPLY',
  APPLIED: 'APPLIED',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
});

export const UPDATE_ACTION = Object.freeze({
  NONE: 'NONE',
  FETCH: 'FETCH',
  PULL: 'PULL',
  STASH_THEN_PULL: 'STASH_THEN_PULL',
  REBUILD: 'REBUILD',
  HOT_RELOAD: 'HOT_RELOAD',
  RESTART_SERVICES: 'RESTART_SERVICES',
  OPERATOR_REVIEW: 'OPERATOR_REVIEW',
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function cleanTree(input = {}) {
  return input.workingTreeClean === true && list(input.untrackedFiles).length === 0 && list(input.modifiedFiles).length === 0;
}

function headsDiffer(input = {}) {
  return Boolean(text(input.localHead) && text(input.remoteHead) && text(input.localHead) !== text(input.remoteHead));
}

function changedFiles(input = {}) {
  return [...list(input.changedFiles), ...list(input.modifiedFiles), ...list(input.untrackedFiles)];
}

function touchesSource(files = []) {
  return files.some((file) => /^(apps|shared|scripts|server|tests|package\.json|package-lock\.json)/.test(file));
}

function touchesRuntimeOnly(files = []) {
  return files.length > 0 && files.every((file) => /^(runtime|tmp|memory)\//.test(file));
}

export function buildAlwaysOnUpdateContract() {
  return {
    schemaVersion: ALWAYS_ON_UPDATE_SCHEMA_VERSION,
    contractKind: 'stephanos.always_on_update.contract',
    updateStates: Object.values(UPDATE_STATE),
    updateActions: Object.values(UPDATE_ACTION),
    truthRule: 'Never apply updates when the working tree is dirty unless the changes are protected or operator-approved.',
    finalVerdict: 'ALWAYS_ON_UPDATE_CONTRACT_READY',
  };
}

export function createUpdateObservation(input = {}) {
  return {
    schemaVersion: ALWAYS_ON_UPDATE_SCHEMA_VERSION,
    kind: 'stephanos.always_on_update.observation',
    localHead: text(input.localHead),
    remoteHead: text(input.remoteHead),
    runningBuildHead: text(input.runningBuildHead, input.localHead),
    workingTreeClean: input.workingTreeClean === true,
    modifiedFiles: list(input.modifiedFiles),
    untrackedFiles: list(input.untrackedFiles),
    changedFiles: list(input.changedFiles),
    services: list(input.services),
    finalVerdict: 'ALWAYS_ON_UPDATE_OBSERVATION_READY',
  };
}

export function deriveUpdatePlan(input = {}) {
  const observation = input.kind === 'stephanos.always_on_update.observation' ? input : createUpdateObservation(input);
  const files = changedFiles(observation);
  const remoteChanged = headsDiffer(observation);
  const runningStale = Boolean(text(observation.runningBuildHead) && text(observation.remoteHead) && text(observation.runningBuildHead) !== text(observation.remoteHead));

  if (!remoteChanged && !runningStale) {
    return {
      schemaVersion: ALWAYS_ON_UPDATE_SCHEMA_VERSION,
      kind: 'stephanos.always_on_update.plan',
      state: UPDATE_STATE.CURRENT,
      actions: [UPDATE_ACTION.NONE],
      observation,
      exactUnblockAction: '',
      visibleStatus: 'Stephanos is current.',
      finalVerdict: 'ALWAYS_ON_UPDATE_CURRENT',
    };
  }

  if (!cleanTree(observation) && !input.operatorApprovedDirtyApply) {
    return {
      schemaVersion: ALWAYS_ON_UPDATE_SCHEMA_VERSION,
      kind: 'stephanos.always_on_update.plan',
      state: UPDATE_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      actions: [UPDATE_ACTION.OPERATOR_REVIEW],
      observation,
      exactUnblockAction: 'Review, commit, stash, or discard local working tree changes before applying merged Stephanos updates.',
      visibleStatus: 'Update available but local working tree is dirty.',
      finalVerdict: 'ALWAYS_ON_UPDATE_BLOCKED_DIRTY_TREE',
    };
  }

  const sourceChanged = touchesSource(files) || files.length === 0;
  const runtimeOnly = touchesRuntimeOnly(files);
  const actions = [UPDATE_ACTION.FETCH, UPDATE_ACTION.PULL];
  if (sourceChanged) actions.push(UPDATE_ACTION.REBUILD, UPDATE_ACTION.RESTART_SERVICES);
  else if (runtimeOnly) actions.push(UPDATE_ACTION.HOT_RELOAD);
  else actions.push(UPDATE_ACTION.RESTART_SERVICES);

  return {
    schemaVersion: ALWAYS_ON_UPDATE_SCHEMA_VERSION,
    kind: 'stephanos.always_on_update.plan',
    state: sourceChanged ? UPDATE_STATE.REBUILD_REQUIRED : UPDATE_STATE.RELOAD_REQUIRED,
    actions,
    observation,
    exactUnblockAction: '',
    visibleStatus: sourceChanged ? 'Update available. Safe pull plus rebuild/restart required.' : 'Update available. Safe pull plus hot reload required.',
    finalVerdict: 'ALWAYS_ON_UPDATE_PLAN_READY',
  };
}

export function createApplyResult(input = {}) {
  const plan = input.plan?.kind === 'stephanos.always_on_update.plan' ? input.plan : deriveUpdatePlan(input);
  const applied = input.pullApplied === true && (input.rebuildPassed === true || !plan.actions.includes(UPDATE_ACTION.REBUILD)) && (input.reloadApplied === true || input.restartApplied === true || plan.actions.includes(UPDATE_ACTION.NONE));
  return {
    schemaVersion: ALWAYS_ON_UPDATE_SCHEMA_VERSION,
    kind: 'stephanos.always_on_update.apply_result',
    state: applied ? UPDATE_STATE.APPLIED : UPDATE_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
    plan,
    pullApplied: input.pullApplied === true,
    rebuildPassed: input.rebuildPassed === true,
    reloadApplied: input.reloadApplied === true,
    restartApplied: input.restartApplied === true,
    exactUnblockAction: applied ? '' : text(input.exactUnblockAction, 'Complete pull, rebuild, reload, or restart before marking update applied.'),
    visibleStatus: applied ? 'Stephanos update applied and visible.' : 'Stephanos update not fully applied.',
    finalVerdict: applied ? 'ALWAYS_ON_UPDATE_APPLIED' : 'ALWAYS_ON_UPDATE_APPLY_BLOCKED',
  };
}

export function createAlwaysOnUpdateStatus(input = {}) {
  const plan = input.plan?.kind === 'stephanos.always_on_update.plan' ? input.plan : deriveUpdatePlan(input);
  return {
    schemaVersion: ALWAYS_ON_UPDATE_SCHEMA_VERSION,
    kind: 'stephanos.always_on_update.status',
    currentState: plan.state,
    nextAction: plan.actions[0] || UPDATE_ACTION.NONE,
    actions: plan.actions,
    localHead: plan.observation.localHead,
    remoteHead: plan.observation.remoteHead,
    runningBuildHead: plan.observation.runningBuildHead,
    visibleStatus: plan.visibleStatus,
    exactUnblockAction: plan.exactUnblockAction,
    showInSplash: true,
    showInCommandDeck: true,
    finalVerdict: plan.exactUnblockAction ? 'ALWAYS_ON_UPDATE_STATUS_BLOCKED' : 'ALWAYS_ON_UPDATE_STATUS_READY',
  };
}

export function validateAlwaysOnUpdateStatus(status = {}) {
  const errors = [];
  if (status.schemaVersion !== ALWAYS_ON_UPDATE_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (status.kind !== 'stephanos.always_on_update.status') errors.push('invalid-kind');
  if (!Object.values(UPDATE_STATE).includes(status.currentState)) errors.push('invalid-state');
  if (!Object.values(UPDATE_ACTION).includes(status.nextAction)) errors.push('invalid-next-action');
  if (status.currentState === UPDATE_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION && !text(status.exactUnblockAction)) errors.push('blocked-without-exact-unblock-action');
  if (status.showInSplash !== true || status.showInCommandDeck !== true) errors.push('missing-visible-surface');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'ALWAYS_ON_UPDATE_STATUS_PASS' : 'ALWAYS_ON_UPDATE_STATUS_BLOCKED',
  };
}
