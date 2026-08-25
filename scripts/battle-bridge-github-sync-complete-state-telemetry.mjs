export const BATTLE_BRIDGE_COMPLETE_STATE_TELEMETRY_SCHEMA = 'stephanos.battle-bridge-complete-state-telemetry.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const QUESTIONS = Object.freeze([
  'SOURCE_IDENTITY',
  'SOURCE_DIRT_AND_HOUSEKEEPER',
  'DELIVERY_AND_RUNTIME_HEADS',
  'BACKEND_HEALTH',
  'UI_HEALTH',
  'OPENCLAW_HEALTH',
  'SHARED_WORKSPACE_HEALTH',
  'POST_SYNC_REFRESH_HEALTH',
  'IGNITION_HEALTH',
  'RECOVERY_MESH_HEALTH',
  'MAILBOX_HEALTH',
  'MISSION_WORKER_HEALTH',
  'PROACTIVE_REPAIR_DECISION',
]);
const CONTROL_PLANE_IDS = Object.freeze(['recoveryMesh', 'mailbox', 'missionWorker']);
const DELIVERY_IDS = Object.freeze(['postSyncRefresh', 'ignition']);
const SERVICE_ALIASES = Object.freeze({
  backend: Object.freeze(['backend']),
  ui: Object.freeze(['stephanos-ui', 'ui']),
  openClaw: Object.freeze(['openclaw-gateway', 'openclaw']),
  sharedWorkspace: Object.freeze(['shared-workspace', 'sharedWorkspace']),
});

function text(value, limit = 180) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function safeSha(value) {
  const normalized = text(value, 40).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function boundedNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function booleanOrNull(value) {
  return value === true ? true : (value === false ? false : null);
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function pick(record, keys = []) {
  const source = object(record);
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return undefined;
}

function pickNested(record, paths = []) {
  for (const path of paths) {
    let current = record;
    for (const segment of path) current = object(current)?.[segment];
    if (current !== undefined && current !== null && String(current).trim() !== '') return current;
  }
  return undefined;
}

function surfaceMap(surfaces = []) {
  return new Map((Array.isArray(surfaces) ? surfaces : [])
    .filter((surface) => object(surface) && text(surface.id))
    .map((surface) => [text(surface.id), surface]));
}

function surfaceState(surface) {
  return text(surface?.state || 'UNPROVEN', 120).toUpperCase();
}

function isProblem(surface) {
  const state = surfaceState(surface);
  return state === 'STALE'
    || state === 'UNPROVEN'
    || state === 'UNKNOWN'
    || state.includes('BLOCK')
    || state.includes('FAIL')
    || state.includes('DEGRADED')
    || state.includes('STOPPED');
}

function projectSurface(surface, id) {
  if (!surface) {
    return Object.freeze({ id, state: 'UNPROVEN', observedAtUtc: '', ageMs: null, head: '', blocker: 'STATUS_MISSING' });
  }
  return Object.freeze({
    id,
    state: surfaceState(surface),
    observedAtUtc: timestamp(surface.observedAtUtc),
    ageMs: boundedNumber(surface.ageMs),
    head: safeSha(surface.head),
    blocker: text(surface.blocker),
  });
}

function normalizeDirt(syncRecord = {}) {
  const dirt = object(syncRecord.dirtClassification) || object(syncRecord.dirtSummary);
  if (!dirt) {
    return Object.freeze({
      classification: 'UNKNOWN', trackedSourceCount: null, untrackedSourceCount: null,
      runtimeOnlyCount: null, generatedSourceCount: null, unknownCount: null,
      blocksSync: null, pathValuesPublished: false,
    });
  }
  const trackedSourceCount = boundedNumber(dirt.trackedSourceCount);
  const untrackedSourceCount = boundedNumber(dirt.untrackedSourceCount);
  const runtimeOnlyCount = boundedNumber(dirt.runtimeOnlyCount);
  const generatedSourceCount = boundedNumber(dirt.generatedSourceCount);
  const unknownCount = boundedNumber(dirt.unknownCount);
  const blocksSync = booleanOrNull(dirt.blocksSync);
  const blockingCount = (trackedSourceCount || 0) + (untrackedSourceCount || 0) + (unknownCount || 0);
  let classification = 'CLEAN';
  if (blocksSync === true || blockingCount > 0) classification = 'BLOCKING_SOURCE_DIRT';
  else if ((generatedSourceCount || 0) > 0 && (runtimeOnlyCount || 0) > 0) classification = 'SAFE_GENERATED_AND_RUNTIME_DIRT';
  else if ((generatedSourceCount || 0) > 0) classification = 'SAFE_GENERATED_DIRT';
  else if ((runtimeOnlyCount || 0) > 0) classification = 'RUNTIME_ONLY_DIRT';
  return Object.freeze({
    classification, trackedSourceCount, untrackedSourceCount, runtimeOnlyCount,
    generatedSourceCount, unknownCount, blocksSync,
    pathValuesPublished: dirt.pathValuesPublished === true,
  });
}

function serviceFacts(record) {
  return object(record?.observedServiceFacts) || object(record?.services) || object(record?.health?.services) || {};
}

function projectService(record, id, aliases) {
  const facts = serviceFacts(record);
  const service = aliases.map((alias) => object(facts[alias])).find(Boolean) || null;
  if (!service) return Object.freeze({ id, state: 'UNPROVEN', ready: null, blocker: 'SERVICE_EVIDENCE_MISSING' });
  const ready = booleanOrNull(service.ready);
  return Object.freeze({
    id,
    state: text(service.state || service.status || (ready === true ? 'READY' : (ready === false ? 'UNAVAILABLE' : 'UNKNOWN')), 120).toUpperCase(),
    ready,
    blocker: text(service.blocker || service.reason || service.evidence?.detail || ''),
  });
}

function runtimeHeads(statusRecords, sourceHead) {
  const records = [statusRecords.ignition, statusRecords.postSyncRefresh, statusRecords.battleBridge, statusRecords.supervisor].filter(Boolean);
  const candidates = Object.freeze({
    builtHead: Object.freeze({
      flat: ['builtHead', 'builtSourceHead', 'buildHead', 'uiBuiltHead', 'observedBuiltHead', 'lastBuiltHead'],
      nested: [['proof', 'builtHead'], ['result', 'builtHead'], ['runtimeProof', 'builtHead'], ['servedRuntimeProof', 'builtHead']],
    }),
    servedHead: Object.freeze({
      flat: ['servedHead', 'servedSourceHead', 'observedServedHead', 'uiServedHead', 'lastServedHead'],
      nested: [['proof', 'servedHead'], ['result', 'servedHead'], ['runtimeProof', 'servedHead'], ['servedRuntimeProof', 'servedHead']],
    }),
    runtimeHead: Object.freeze({
      flat: ['runtimeHead', 'runtimeSourceHead', 'observedRuntimeHead', 'backendHead', 'backendSourceHead'],
      nested: [['proof', 'runtimeHead'], ['result', 'runtimeHead'], ['runtimeProof', 'runtimeHead'], ['backendIdentity', 'sourceHead']],
    }),
  });
  const result = {};
  for (const [key, candidate] of Object.entries(candidates)) {
    result[key] = '';
    for (const record of records) {
      result[key] = safeSha(pick(record, candidate.flat) || pickNested(record, candidate.nested));
      if (result[key]) break;
    }
  }
  const local = safeSha(sourceHead);
  return Object.freeze({
    ...result,
    sourceBuiltMatch: local && result.builtHead ? local === result.builtHead : null,
    sourceServedMatch: local && result.servedHead ? local === result.servedHead : null,
    sourceRuntimeMatch: local && result.runtimeHead ? local === result.runtimeHead : null,
  });
}

function housekeeperProjection(dirt, explicitRecord, ignitionRecord) {
  const explicit = object(explicitRecord);
  const phase = object(object(ignitionRecord?.phases)?.housekeeping);
  const phaseObserved = Boolean(phase && text(phase.state).toLowerCase() !== 'pending');
  const observed = explicit || (phaseObserved ? {
    status: `IGNITION_HOUSEKEEPING_${text(phase.state, 40).toUpperCase()}`,
    timestampUtc: ignitionRecord?.generatedAt || ignitionRecord?.timestampUtc || ignitionRecord?.observedAtUtc,
    exactNextAction: phase.nextOperatorAction || '',
    automaticExecutionAllowed: false,
  } : null);
  let state = text(observed?.status || observed?.classification || observed?.finalVerdict || observed?.state, 120).toUpperCase();
  let nextAction = text(observed?.exactNextAction || observed?.nextAction || 'Observe the next Housekeeper cycle.');
  if (!observed) {
    state = dirt.classification === 'BLOCKING_SOURCE_DIRT'
      ? 'BLOCKED_SOURCE_DIRT'
      : `DERIVED_${dirt.classification}_EXECUTION_UNPROVEN`;
    nextAction = dirt.classification === 'BLOCKING_SOURCE_DIRT'
      ? 'Classify and preserve blocking source dirt; do not clean it automatically.'
      : 'Publish a bounded Housekeeper execution receipt after each housekeeping cycle.';
  }
  return Object.freeze({
    state,
    lastExecutionObserved: Boolean(observed),
    observedAtUtc: timestamp(observed?.timestampUtc || observed?.observedAtUtc || observed?.completedAt),
    derivedDirtClassification: dirt.classification,
    safeAutomaticCleanupEligible: Boolean(observed?.automaticExecutionAllowed === true && dirt.blocksSync === false),
    sourceCleanupAllowedByTelemetry: false,
    nextAction,
  });
}

function policyAllows(statusRecords, family, targetIds) {
  const policy = object(statusRecords.selfHealingPolicy) || object(statusRecords.controlPlanePolicy);
  if (!policy || policy.automaticExecutionAllowed !== true || policy.operatorNeeded !== false) return false;
  const families = Array.isArray(policy.allowedFamilies) ? policy.allowedFamilies.map(String) : [];
  if (!families.includes(family)) return false;
  const targets = Array.isArray(policy.allowedTargetIds) ? policy.allowedTargetIds.map(String) : [];
  return targetIds.every((id) => targets.includes(id));
}

function coverage({ localHead, remoteHead, dirt, delivery, services, surfaces, housekeeper }) {
  const answerable = new Map([
    ['SOURCE_IDENTITY', Boolean(localHead && remoteHead)],
    ['SOURCE_DIRT_AND_HOUSEKEEPER', dirt.classification !== 'UNKNOWN' && housekeeper.lastExecutionObserved],
    ['DELIVERY_AND_RUNTIME_HEADS', Boolean(delivery.builtHead && delivery.servedHead && delivery.runtimeHead)],
    ['BACKEND_HEALTH', services.backend.ready !== null],
    ['UI_HEALTH', services.ui.ready !== null],
    ['OPENCLAW_HEALTH', services.openClaw.ready !== null],
    ['SHARED_WORKSPACE_HEALTH', services.sharedWorkspace.ready !== null],
    ['POST_SYNC_REFRESH_HEALTH', !isProblem(surfaces.get('postSyncRefresh'))],
    ['IGNITION_HEALTH', !isProblem(surfaces.get('ignition'))],
    ['RECOVERY_MESH_HEALTH', !isProblem(surfaces.get('recoveryMesh'))],
    ['MAILBOX_HEALTH', !isProblem(surfaces.get('mailbox'))],
    ['MISSION_WORKER_HEALTH', !isProblem(surfaces.get('missionWorker'))],
    ['PROACTIVE_REPAIR_DECISION', Boolean(surfaces.get('githubSync'))],
  ]);
  return Object.freeze({
    answerableQuestionClasses: Object.freeze(QUESTIONS.filter((question) => answerable.get(question))),
    unanswerableQuestionClasses: Object.freeze(QUESTIONS.filter((question) => !answerable.get(question))),
  });
}

function repairDecision({ dirt, services, surfaces, housekeeper, coverageState, statusRecords }) {
  if (dirt.classification === 'BLOCKING_SOURCE_DIRT') {
    return Object.freeze({
      currentState: 'BLOCKED_BY_SOURCE_PRESERVATION_BOUNDARY',
      candidateFamily: 'SOURCE_DIRT_DIAGNOSIS_AND_PRESERVATION',
      targetIds: Object.freeze(['canonical-checkout']),
      requiredAuthority: 'SOURCE_PRESERVATION_PLAN',
      automaticExecutionEligible: true,
      executionAuthorizedByTelemetry: false,
      operatorNeeded: false,
      reason: 'Blocking source dirt cannot be erased by a health observer or Housekeeper.',
      nextAutomaticAction: 'Diagnose the bounded dirt class and prepare a preservation-safe source repair without changing local files.',
    });
  }

  const controlPlaneTargets = CONTROL_PLANE_IDS.filter((id) => isProblem(surfaces.get(id)));
  if (controlPlaneTargets.length > 0) {
    const family = 'BATTLE_BRIDGE_CONTROL_PLANE_RECONCILIATION';
    const allowed = policyAllows(statusRecords, family, controlPlaneTargets);
    return Object.freeze({
      currentState: allowed ? 'FIXED_CONTROL_PLANE_SELF_HEAL_READY' : 'FIXED_CONTROL_PLANE_REPAIR_CANDIDATE',
      candidateFamily: family,
      targetIds: Object.freeze(controlPlaneTargets),
      requiredAuthority: allowed ? 'EXISTING_QUALIFIED_SELF_HEAL_POLICY' : 'WINDOWS_RUNTIME_MUTATION',
      automaticExecutionEligible: allowed,
      executionAuthorizedByTelemetry: false,
      operatorNeeded: !allowed,
      reason: 'One or more fixed control-plane surfaces are missing, stale, blocked, or failed.',
      nextAutomaticAction: allowed
        ? 'Run the fixed control-plane reconciliation and require a fresh exact-head beacon before completion.'
        : 'Hold the fixed control-plane reconciliation at the Windows runtime authority boundary.',
    });
  }

  const serviceTargets = Object.values(services)
    .filter((service) => service.ready === false || ['FAILED', 'DEGRADED', 'STOPPED', 'UNAVAILABLE'].includes(service.state))
    .map((service) => service.id);
  if (serviceTargets.length > 0) {
    const family = 'BOUND_SERVICE_RECOVERY';
    const allowed = policyAllows(statusRecords, family, serviceTargets);
    return Object.freeze({
      currentState: allowed ? 'FIXED_SERVICE_SELF_HEAL_READY' : 'SERVICE_RECOVERY_CANDIDATE',
      candidateFamily: family,
      targetIds: Object.freeze(serviceTargets),
      requiredAuthority: allowed ? 'EXISTING_QUALIFIED_SELF_HEAL_POLICY' : 'QUALIFIED_FIXED_SERVICE_RECOVERY',
      automaticExecutionEligible: allowed,
      executionAuthorizedByTelemetry: false,
      operatorNeeded: !allowed,
      reason: 'A bound service is observed unavailable or degraded.',
      nextAutomaticAction: allowed
        ? 'Run only the fixed qualified recovery for the affected service and prove exact runtime identity.'
        : 'Prepare the smallest fixed recovery and retain the runtime authority gate.',
    });
  }

  const deliveryTargets = DELIVERY_IDS.filter((id) => isProblem(surfaces.get(id)));
  if (deliveryTargets.length > 0) {
    const family = 'BOUND_IGNITION_AND_REFRESH_RECOVERY';
    const allowed = policyAllows(statusRecords, family, deliveryTargets);
    return Object.freeze({
      currentState: allowed ? 'FIXED_IGNITION_SELF_HEAL_READY' : 'IGNITION_REFRESH_RECOVERY_CANDIDATE',
      candidateFamily: family,
      targetIds: Object.freeze(deliveryTargets),
      requiredAuthority: allowed ? 'EXISTING_QUALIFIED_SELF_HEAL_POLICY' : 'WINDOWS_RUNTIME_MUTATION',
      automaticExecutionEligible: allowed,
      executionAuthorizedByTelemetry: false,
      operatorNeeded: !allowed,
      reason: 'Post-sync refresh or Ignition truth is stale, blocked, or failed.',
      nextAutomaticAction: allowed
        ? 'Run the fixed exact-head Ignition/refresh recovery and require fresh served/runtime proof.'
        : 'Hold the fixed Ignition/refresh recovery at the Windows runtime authority boundary.',
    });
  }

  if (coverageState.unanswerableQuestionClasses.length === 1
      && coverageState.unanswerableQuestionClasses[0] === 'DELIVERY_AND_RUNTIME_HEADS') {
    return Object.freeze({
      currentState: 'READ_ONLY_RUNTIME_PROOF_REFRESH_READY',
      candidateFamily: 'EXACT_RUNTIME_PROOF_REFRESH',
      targetIds: Object.freeze(['builtHead', 'servedHead', 'runtimeHead']),
      requiredAuthority: 'READ_ONLY_FIXED_PROOF',
      automaticExecutionEligible: true,
      executionAuthorizedByTelemetry: false,
      operatorNeeded: false,
      reason: 'Services are healthy but exact build/served/runtime identities are missing.',
      nextAutomaticAction: 'Run the fixed read-only runtime proof and republish complete-state telemetry.',
    });
  }

  if (coverageState.unanswerableQuestionClasses.length > 0) {
    return Object.freeze({
      currentState: 'BLOCKED_BY_TELEMETRY_GAPS',
      candidateFamily: 'COMPLETE_STATE_TELEMETRY_REPAIR',
      targetIds: Object.freeze([...coverageState.unanswerableQuestionClasses]),
      requiredAuthority: 'NORMAL_SOURCE_REPAIR_POLICY',
      automaticExecutionEligible: true,
      executionAuthorizedByTelemetry: false,
      operatorNeeded: false,
      reason: 'Stephanos cannot safely repair what it cannot identify from fresh complete-state evidence.',
      nextAutomaticAction: 'Repair the missing telemetry writers/projections, then re-evaluate the same machine state.',
    });
  }

  if (!housekeeper.lastExecutionObserved) {
    return Object.freeze({
      currentState: 'HOUSEKEEPER_EXECUTION_UNPROVEN',
      candidateFamily: 'HOUSEKEEPER_RECEIPT_AND_CADENCE_REPAIR',
      targetIds: Object.freeze(['housekeeper']),
      requiredAuthority: 'NORMAL_SOURCE_REPAIR_POLICY',
      automaticExecutionEligible: true,
      executionAuthorizedByTelemetry: false,
      operatorNeeded: false,
      reason: 'Current dirt can be classified, but no durable Housekeeper execution receipt proves cadence or action.',
      nextAutomaticAction: 'Publish a bounded Housekeeper execution receipt and consume it in the beacon.',
    });
  }

  return Object.freeze({
    currentState: 'NO_REPAIR_NEEDED',
    candidateFamily: 'NONE',
    targetIds: Object.freeze([]),
    requiredAuthority: 'NONE',
    automaticExecutionEligible: false,
    executionAuthorizedByTelemetry: false,
    operatorNeeded: false,
    reason: 'Fresh complete-state evidence reports no repair candidate.',
    nextAutomaticAction: 'Continue observing at the bounded cadence.',
  });
}

export function buildBattleBridgeCompleteStateTelemetry({ sourceHead = '', surfaces = [], statusRecords = {}, now = new Date() } = {}) {
  const localHead = safeSha(sourceHead);
  if (!localHead) throw new Error('COMPLETE_STATE_SOURCE_HEAD_INVALID');
  const byId = surfaceMap(surfaces);
  const syncRecord = object(statusRecords.githubSync) || {};
  const remoteHead = safeSha(pick(syncRecord, ['remoteHeadObserved', 'remoteHead', 'originMainHead']));
  const dirt = normalizeDirt(syncRecord);
  const delivery = runtimeHeads(statusRecords, localHead);
  const services = Object.freeze({
    backend: projectService(statusRecords.battleBridge, 'backend', SERVICE_ALIASES.backend),
    ui: projectService(statusRecords.battleBridge, 'ui', SERVICE_ALIASES.ui),
    openClaw: projectService(statusRecords.battleBridge, 'openClaw', SERVICE_ALIASES.openClaw),
    sharedWorkspace: projectService(statusRecords.battleBridge, 'sharedWorkspace', SERVICE_ALIASES.sharedWorkspace),
  });
  const housekeeper = housekeeperProjection(dirt, statusRecords.housekeeper, statusRecords.ignition);
  const coverageBase = coverage({ localHead, remoteHead, dirt, delivery, services, surfaces: byId, housekeeper });
  const staleOrBlockedEvidence = Array.from(byId.values()).filter(isProblem).map((surface) => `${text(surface.id)}:${surfaceState(surface)}`);
  const missingEvidence = [
    !remoteHead ? 'REMOTE_MAIN_HEAD_MISSING' : '',
    dirt.classification === 'UNKNOWN' ? 'SOURCE_DIRT_CLASSIFICATION_MISSING' : '',
    !delivery.builtHead ? 'BUILT_HEAD_MISSING' : '',
    !delivery.servedHead ? 'SERVED_HEAD_MISSING' : '',
    !delivery.runtimeHead ? 'RUNTIME_HEAD_MISSING' : '',
    services.backend.ready === null ? 'BACKEND_SERVICE_EVIDENCE_MISSING' : '',
    services.ui.ready === null ? 'UI_SERVICE_EVIDENCE_MISSING' : '',
    services.openClaw.ready === null ? 'OPENCLAW_SERVICE_EVIDENCE_MISSING' : '',
    services.sharedWorkspace.ready === null ? 'SHARED_WORKSPACE_EVIDENCE_MISSING' : '',
    !housekeeper.lastExecutionObserved ? 'HOUSEKEEPER_EXECUTION_RECEIPT_MISSING' : '',
  ].filter(Boolean);
  const coverageState = Object.freeze({
    verdict: missingEvidence.length === 0 && staleOrBlockedEvidence.length === 0
      ? 'COMPLETE'
      : (coverageBase.answerableQuestionClasses.length === 0 ? 'BLIND' : 'DEGRADED'),
    ...coverageBase,
    missingEvidence: Object.freeze(missingEvidence),
    staleOrBlockedEvidence: Object.freeze(staleOrBlockedEvidence),
  });
  const selfHealing = repairDecision({ dirt, services, surfaces: byId, housekeeper, coverageState, statusRecords });

  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_COMPLETE_STATE_TELEMETRY_SCHEMA,
    observedAtUtc: now.toISOString(),
    source: Object.freeze({
      branch: 'main', localHead, remoteMainHead: remoteHead,
      exactMainMatch: remoteHead ? localHead === remoteHead : null,
      syncState: surfaceState(byId.get('githubSync')),
      dirt,
    }),
    delivery: Object.freeze({
      postSyncRefresh: projectSurface(byId.get('postSyncRefresh'), 'postSyncRefresh'),
      ignition: projectSurface(byId.get('ignition'), 'ignition'),
      ...delivery,
    }),
    services,
    controlPlane: Object.freeze(Object.fromEntries(CONTROL_PLANE_IDS.map((id) => [id, projectSurface(byId.get(id), id)]))),
    housekeeper,
    coverage: coverageState,
    selfHealing,
    readOnly: true,
    sourceMutationAllowed: false,
    runtimeMutationAllowed: false,
    repairExecutionAllowed: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    authorityGrantedByTelemetry: false,
    finalVerdict: coverageState.verdict === 'COMPLETE'
      ? 'BATTLE_BRIDGE_COMPLETE_STATE_TELEMETRY_READY'
      : 'BATTLE_BRIDGE_COMPLETE_STATE_TELEMETRY_INCOMPLETE',
  });
}
