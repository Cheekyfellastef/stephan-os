export const VR_RUNTIME_RECOVERY_CLASSIFIER_SCHEMA_VERSION = 'stephanos.vr-runtime-recovery-classifier.v1';

export const VR_RUNTIME_FAILURE_LAYERS = Object.freeze([
  'SOURCE_OR_BUILD',
  'DELIVERY_OR_INSTALLED_IDENTITY',
  'LAUNCHER_OR_PREFLIGHT',
  'GAME_OR_TITLE_ADAPTER',
  'OPENXR_APPLICATION',
  'API_LAYER_OR_INJECTOR',
  'OPENXR_LOADER',
  'ACTIVE_RUNTIME_OR_PROVIDER',
  'STREAMING_TRANSPORT',
  'QUEST_OR_DEVICE',
  'TRACKING_OR_INPUT',
  'RENDERING_OR_STEREO',
  'UI_OR_INTERACTION',
  'PERFORMANCE_OR_FRAME_PACING',
  'MOD_OR_CONTENT_ESTATE',
  'SPATIAL_WORLD_OR_ASSET',
  'UNKNOWN_REQUIRES_EXPERIMENT',
  'PHYSICAL_ACCEPTANCE_ONLY',
]);

export const VR_RUNTIME_RECOVERY_VERDICTS = Object.freeze({
  CLASSIFIED: 'VR_RUNTIME_FAILURE_CLASSIFIED',
  AMBIGUOUS: 'VR_RUNTIME_FAILURE_AMBIGUOUS',
  PHYSICAL_RETEST_REQUIRED: 'VR_RUNTIME_PHYSICAL_RETEST_REQUIRED',
  ACCEPTED: 'VR_RUNTIME_ACCEPTANCE_EVIDENCE_COMPLETE',
  INVALID: 'BLOCKED_VR_RUNTIME_RECOVERY_EVIDENCE_INVALID',
});

export const VR_RUNTIME_RECOVERY_NEXT_ACTIONS = Object.freeze({
  SEARCH_OWNER: 'SEARCH_CANONICAL_OWNER',
  EXPERIMENT: 'PREPARE_BOUNDED_EXPERIMENT',
  PHYSICAL_RETEST: 'REQUEST_PHYSICAL_QUEST_RETEST',
  PROMOTE_ACCEPTANCE: 'PROMOTE_VERIFIED_ACCEPTANCE_EVIDENCE',
  NONE: 'NONE',
});

const SIGNAL_LAYERS = new Set(VR_RUNTIME_FAILURE_LAYERS.filter(
  (layer) => !['UNKNOWN_REQUIRES_EXPERIMENT', 'PHYSICAL_ACCEPTANCE_ONLY'].includes(layer),
));
const MACHINE_VERDICTS = new Set(['PASS', 'FAIL', 'BLOCKED', 'UNKNOWN']);
const PHYSICAL_STATES = new Set(['NOT_TESTED', 'PASS', 'FAIL']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,120}$/;

const OWNER_SEARCH_HINTS = Object.freeze({
  SOURCE_OR_BUILD: Object.freeze([1557, 1622, 2321]),
  DELIVERY_OR_INSTALLED_IDENTITY: Object.freeze([1595, 1769, 2321]),
  LAUNCHER_OR_PREFLIGHT: Object.freeze([1769, 2321]),
  GAME_OR_TITLE_ADAPTER: Object.freeze([1595, 1904, 2321]),
  OPENXR_APPLICATION: Object.freeze([1595, 1605, 2321]),
  API_LAYER_OR_INJECTOR: Object.freeze([1593, 1595, 2321]),
  OPENXR_LOADER: Object.freeze([1595, 1605, 2321]),
  ACTIVE_RUNTIME_OR_PROVIDER: Object.freeze([1595, 1605, 2321]),
  STREAMING_TRANSPORT: Object.freeze([1595, 1605, 2321]),
  QUEST_OR_DEVICE: Object.freeze([1595, 1605, 2321]),
  TRACKING_OR_INPUT: Object.freeze([1593, 1595, 1605, 2321]),
  RENDERING_OR_STEREO: Object.freeze([1593, 1595, 2321]),
  UI_OR_INTERACTION: Object.freeze([1593, 1605, 1760, 2321]),
  PERFORMANCE_OR_FRAME_PACING: Object.freeze([1593, 1595, 1605, 2321]),
  MOD_OR_CONTENT_ESTATE: Object.freeze([1904, 2321]),
  SPATIAL_WORLD_OR_ASSET: Object.freeze([1760, 1907, 2321]),
  UNKNOWN_REQUIRES_EXPERIMENT: Object.freeze([1597, 2321]),
  PHYSICAL_ACCEPTANCE_ONLY: Object.freeze([1769, 2321]),
});

function text(value) {
  return String(value ?? '').trim();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values)];
}

function invalid(blockers, normalized = {}) {
  return Object.freeze({
    schemaVersion: VR_RUNTIME_RECOVERY_CLASSIFIER_SCHEMA_VERSION,
    verdict: VR_RUNTIME_RECOVERY_VERDICTS.INVALID,
    blockers: Object.freeze(unique(blockers)),
    vrRunId: text(normalized.vrRunId),
    classification: '',
    candidateLayers: Object.freeze([]),
    nextAction: VR_RUNTIME_RECOVERY_NEXT_ACTIONS.NONE,
    ownerSearchIssues: Object.freeze([]),
    physicalAcceptanceProven: false,
    sourceMutationAllowed: false,
    runtimeExecutionAllowed: false,
    providerMutationAllowed: false,
    mergeAuthority: false,
    arbitraryShellAllowed: false,
  });
}

function normalizedPhysicalAcceptance(input = {}, blockers = []) {
  const state = text(input?.state || 'NOT_TESTED').toUpperCase();
  const evidenceRef = text(input?.evidenceRef);
  const operatorObserved = input?.operatorObserved === true;
  if (!PHYSICAL_STATES.has(state)) blockers.push('physical-acceptance-state-invalid');
  if (['PASS', 'FAIL'].includes(state) && !operatorObserved) {
    blockers.push('physical-acceptance-operator-observation-required');
  }
  if (['PASS', 'FAIL'].includes(state) && !evidenceRef) {
    blockers.push('physical-acceptance-evidence-ref-required');
  }
  return Object.freeze({ state, evidenceRef, operatorObserved });
}

function normalizedSignals(input = [], blockers = []) {
  const raw = list(input);
  if (raw.length > 32) blockers.push('failure-signals-too-many');
  const signals = [];
  for (const [index, signal] of raw.slice(0, 32).entries()) {
    const layer = text(signal?.layer).toUpperCase();
    const code = text(signal?.code);
    const evidenceRefs = unique(list(signal?.evidenceRefs).map(text).filter(Boolean)).slice(0, 16);
    if (!SIGNAL_LAYERS.has(layer)) blockers.push(`failure-signal-layer-invalid:${index}`);
    if (!SAFE_ID.test(code)) blockers.push(`failure-signal-code-invalid:${index}`);
    if (evidenceRefs.length === 0) blockers.push(`failure-signal-evidence-missing:${index}`);
    signals.push(Object.freeze({ layer, code, evidenceRefs: Object.freeze(evidenceRefs) }));
  }
  return Object.freeze(signals);
}

function result({
  vrRunId,
  machineVerdict,
  physicalAcceptance,
  signals,
  verdict,
  classification,
  candidateLayers = [],
  nextAction,
  physicalAcceptanceProven = false,
}) {
  const ownerSearchIssues = classification
    ? OWNER_SEARCH_HINTS[classification] || OWNER_SEARCH_HINTS.UNKNOWN_REQUIRES_EXPERIMENT
    : [];
  return Object.freeze({
    schemaVersion: VR_RUNTIME_RECOVERY_CLASSIFIER_SCHEMA_VERSION,
    verdict,
    blockers: Object.freeze([]),
    vrRunId,
    machineVerdict,
    classification,
    candidateLayers: Object.freeze(candidateLayers),
    failureSignals: signals,
    physicalAcceptance,
    physicalAcceptanceProven,
    nextAction,
    ownerSearchIssues,
    ownerSearchIsHintOnly: true,
    deduplicationRequiredBeforeNewGoal: true,
    sourceMutationAllowed: false,
    runtimeExecutionAllowed: false,
    providerMutationAllowed: false,
    mergeAuthority: false,
    arbitraryShellAllowed: false,
  });
}

export function classifyVrRuntimeRecoveryEvidenceV1(input = {}) {
  const blockers = [];
  const vrRunId = text(input.vrRunId);
  const machineVerdict = text(input.machineVerdict || 'UNKNOWN').toUpperCase();
  if (!SAFE_ID.test(vrRunId)) blockers.push('vr-run-id-invalid');
  if (!MACHINE_VERDICTS.has(machineVerdict)) blockers.push('machine-verdict-invalid');

  const signals = normalizedSignals(input.failureSignals, blockers);
  const physicalAcceptance = normalizedPhysicalAcceptance(input.physicalAcceptance, blockers);

  if (machineVerdict === 'PASS' && signals.length > 0) {
    blockers.push('machine-pass-conflicts-with-failure-signals');
  }
  if (blockers.length > 0) return invalid(blockers, { vrRunId });

  const layers = unique(signals.map((signal) => signal.layer));
  if (layers.length > 1) {
    return result({
      vrRunId,
      machineVerdict,
      physicalAcceptance,
      signals,
      verdict: VR_RUNTIME_RECOVERY_VERDICTS.AMBIGUOUS,
      classification: 'UNKNOWN_REQUIRES_EXPERIMENT',
      candidateLayers: layers,
      nextAction: VR_RUNTIME_RECOVERY_NEXT_ACTIONS.EXPERIMENT,
    });
  }

  if (layers.length === 1) {
    return result({
      vrRunId,
      machineVerdict,
      physicalAcceptance,
      signals,
      verdict: VR_RUNTIME_RECOVERY_VERDICTS.CLASSIFIED,
      classification: layers[0],
      nextAction: VR_RUNTIME_RECOVERY_NEXT_ACTIONS.SEARCH_OWNER,
      physicalAcceptanceProven: physicalAcceptance.operatorObserved && physicalAcceptance.state !== 'NOT_TESTED',
    });
  }

  if (['FAIL', 'BLOCKED'].includes(machineVerdict)) {
    return result({
      vrRunId,
      machineVerdict,
      physicalAcceptance,
      signals,
      verdict: VR_RUNTIME_RECOVERY_VERDICTS.AMBIGUOUS,
      classification: 'UNKNOWN_REQUIRES_EXPERIMENT',
      nextAction: VR_RUNTIME_RECOVERY_NEXT_ACTIONS.EXPERIMENT,
    });
  }

  if (physicalAcceptance.state === 'FAIL') {
    return result({
      vrRunId,
      machineVerdict,
      physicalAcceptance,
      signals,
      verdict: VR_RUNTIME_RECOVERY_VERDICTS.CLASSIFIED,
      classification: 'PHYSICAL_ACCEPTANCE_ONLY',
      nextAction: VR_RUNTIME_RECOVERY_NEXT_ACTIONS.SEARCH_OWNER,
      physicalAcceptanceProven: true,
    });
  }

  if (machineVerdict === 'PASS' && physicalAcceptance.state === 'PASS') {
    return result({
      vrRunId,
      machineVerdict,
      physicalAcceptance,
      signals,
      verdict: VR_RUNTIME_RECOVERY_VERDICTS.ACCEPTED,
      classification: '',
      nextAction: VR_RUNTIME_RECOVERY_NEXT_ACTIONS.PROMOTE_ACCEPTANCE,
      physicalAcceptanceProven: true,
    });
  }

  return result({
    vrRunId,
    machineVerdict,
    physicalAcceptance,
    signals,
    verdict: VR_RUNTIME_RECOVERY_VERDICTS.PHYSICAL_RETEST_REQUIRED,
    classification: '',
    nextAction: VR_RUNTIME_RECOVERY_NEXT_ACTIONS.PHYSICAL_RETEST,
    physicalAcceptanceProven: false,
  });
}
