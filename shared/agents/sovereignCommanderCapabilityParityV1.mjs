export const SOVEREIGN_COMMANDER_CAPABILITY_PARITY_SCHEMA =
  'stephanos.sovereign-commander-capability-parity.v1';

export const SOVEREIGN_COMMANDER_CAPABILITY_PARITY_OWNER = Object.freeze({
  issueNumber: 2573,
  goal: '#2573',
  title: 'Goal: Make Sovereign Commander absorb every Remote Commander capability',
});

export const SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE = Object.freeze({
  PARITY_PRESENT: 'PARITY_PRESENT',
  BUILDABLE_GAP: 'BUILDABLE_GAP',
  BOUNDARY_HOLD: 'BOUNDARY_HOLD',
});

// Source mappings describe only the named private contract. They cannot
// authenticate an installed host, broaden a scope or grant execution authority.
export const SOVEREIGN_COMMANDER_PRIVATE_SESSION_PARITY = Object.freeze(Object.fromEntries([
  ['start-search', 'start_search', 'ONE_EXPLICIT_LOCAL_WINDOWS_DIRECTORY'],
  ['get-more-search-results', 'get_more_search_results', 'THIS_PRIVATE_SESSION_SEARCHES'],
  ['stop-search', 'stop_search', 'THIS_PRIVATE_SESSION_SEARCHES'],
  ['list-searches', 'list_searches', 'THIS_PRIVATE_SESSION_SEARCHES'],
  ['get-usage-stats', 'get_usage_stats', 'THIS_PRIVATE_SESSION_ADVISORY_HISTORY'],
  ['get-recent-tool-calls', 'get_recent_tool_calls', 'THIS_PRIVATE_SESSION_ADVISORY_HISTORY'],
  ['get-tool-result', 'get_tool_result', 'THIS_PRIVATE_SESSION_RETAINED_RECEIPTS'],
  ['list-remote-tool-calls', 'list_remote_tool_calls', 'THIS_PRIVATE_HTTP_SESSION_ADVISORY_HISTORY'],
  ['set-config-value', 'set_config_value', 'THIS_PRIVATE_SESSION_TYPED_IO_LIMITS'],
  ['copy-file-content', 'copy_file_content', 'CREATE_ONLY_SAME_VOLUME_REGULAR_FILE_CONTENT_COPY'],
  ['get-file-hash', 'get_file_hash', 'BOUNDED_LOCAL_REGULAR_FILE_CONTENT_HASH_OBSERVATION'],
  ['cancel-process-session', 'cancel_process_session', 'THIS_PRIVATE_HANDLER_TWO_FIXED_DIAGNOSTIC_CHILDREN_CANCELLATION'],
  ['give-feedback-to-desktop-commander', 'submit_feedback', 'THIS_SOVEREIGN_WORKSPACE_UNVERIFIED_ADVISORY_FEEDBACK'],
].map(([id, sovereignEquivalent, functionalScope]) => [id, Object.freeze({ sovereignEquivalent,
  functionalScope, privateTransportRequired: true, runtimeParityProven: false,
  ...(id === 'give-feedback-to-desktop-commander' ? {
    externalVendorDelivery: false, automaticLearning: false, verifiedFailureEvidence: false,
  } : {}) })])));

// Useful scoped implementations do not close their broader vendor outcomes,
// even if a retained ledger once called the limited route parity.
export const SOVEREIGN_COMMANDER_PARTIAL_PARITY_GAPS = Object.freeze({
  'write-pdf': Object.freeze({
    partialSovereignEquivalent: 'write_pdf',
    partialScope: 'CREATE_ONLY_BOUNDED_ASCII_TEXT_PDF',
    parityEvidenceScope: 'SOURCE_CATALOG_ONLY',
    runtimeParityProven: false,
    privateTransportRequired: true,
    wholeDocumentAtomicityProven: false,
    existingPdfEditingSupported: false,
    unicodeTextSupported: false,
    parityGapReason: 'GENERAL_PDF_EDITING_AND_RENDERING_UNIMPLEMENTED',
  }),
  'move-file': Object.freeze({
    partialSovereignEquivalent: 'move_file',
    partialScope: 'SAME_PARENT_REGULAR_FILE_RENAME_NO_REPLACE',
    parityEvidenceScope: 'SOURCE_CATALOG_ONLY',
    runtimeParityProven: false,
    privateTransportRequired: true,
    atomicContentCasProven: false,
    parityGapReason: 'CROSS_DIRECTORY_FILE_MOVE_UNQUALIFIED',
  }),
  ...Object.fromEntries([
    ['start-process', 'start_process'],
    ['read-process-output', 'read_process_output'],
    ['list-sessions', 'list_sessions'],
  ].map(([id, partialSovereignEquivalent]) => [id, Object.freeze({
    partialSovereignEquivalent,
    partialScope: 'THIS_PRIVATE_HANDLER_TWO_FIXED_READ_ONLY_DIAGNOSTIC_PROFILES',
    parityEvidenceScope: 'SOURCE_CATALOG_ONLY',
    runtimeParityProven: false,
    privateTransportRequired: true,
    descendantsExcluded: false,
    nativeCustodyQualified: false,
    parityGapReason: 'GENERAL_INTERACTIVE_PROCESS_SESSION_CONTRACT_UNQUALIFIED',
  })])),
  'list-devices': Object.freeze({
    partialSovereignEquivalent: 'visibility-snapshot',
    partialScope: 'LOCAL_BATTLE_BRIDGE_HOST_VISIBILITY_ONLY',
    parityEvidenceScope: 'SOURCE_CATALOG_ONLY',
    runtimeParityProven: false,
    parityGapReason: 'AUTHENTICATED_ACCOUNT_DEVICE_INVENTORY_UNIMPLEMENTED',
  }),
  'force-terminate': Object.freeze({
    partialSovereignEquivalent: 'cancel_process_session',
    partialScope: 'THIS_PRIVATE_HANDLER_TWO_FIXED_DIAGNOSTIC_CHILDREN_CANCELLATION',
    parityEvidenceScope: 'SOURCE_CATALOG_ONLY',
    runtimeParityProven: false,
    privateTransportRequired: true,
    descendantsExcluded: false,
    nativeCustodyQualified: false,
    parityGapReason: 'GENERAL_PROCESS_TERMINATION_CUSTODY_UNQUALIFIED',
  }),
});

const DIRECT_PARITY = Object.freeze({
  'get-config': 'get_config',
  'read-file': 'read_file',
  'read-multiple-files': 'read_multiple_files',
  'get-file-info': 'get_file_info',
  'write-file': 'write_file',
  'edit-file': 'edit_file',
  'edit-block': 'edit_file',
  'list-directory': 'list_directory',
  'create-directory': 'create_directory',
  'search-project': 'search_project',
  'list-processes': 'list_processes',
  'device-status': 'visibility-snapshot',
  'connection-status': 'visibility-snapshot',
  // Exact semantic actions already implemented by the canonical fixed registry.
  // General PowerShell, service control and process termination are not aliases.
  'battle-bridge-status': 'battle-bridge-status',
  'battle-bridge-observe': 'battle-bridge-observe',
  'visibility-snapshot': 'visibility-snapshot',
  'cpu-pressure-snapshot': 'cpu-pressure-snapshot',
  'meter-status': 'meter-status',
  'controller-lane-status': 'controller-lane-status',
  'status-recovery-mesh': 'status-recovery-mesh',
  'status-worker-watchdog': 'status-worker-watchdog',
  'status-stephanos-core-daemon': 'status-stephanos-core-daemon',
  'gaming-resource-status': 'gaming-resource-status',
  'starfield-vr-performance-diagnosis': 'starfield-vr-performance-diagnosis',
  'repair-ui-4173': 'repair-ui-4173',
  'repair-control-plane': 'repair-control-plane',
  'repair-battle-bridge': 'repair-battle-bridge',
  'repair-openclaw-stack': 'repair-openclaw-stack',
  'source-construction': 'sovereign-source-construction-lane',
  ...Object.fromEntries(Object.entries(SOVEREIGN_COMMANDER_PRIVATE_SESSION_PARITY)
    .map(([id, value]) => [id, value.sovereignEquivalent])),
});

// search_project is one bounded literal search in the canonical repository.
// It does not implement the private search-session API. Retain this correction
// for legacy ledgers still routing session work to search_project. The current
// private session mappings above are source evidence, never live acceptance.
export const SOVEREIGN_COMMANDER_SEARCH_PARITY_GAPS = Object.freeze(Object.assign(Object.create(null), Object.fromEntries([
  ['start-search', 'PRIVATE_SESSION_SEARCH_ROUTE_NOT_BOUND'],
  ['search-files', 'WHOLE_PC_FILE_SEARCH_NOT_IMPLEMENTED'],
  ['get-more-search-results', 'PRIVATE_SESSION_PAGINATION_ROUTE_NOT_BOUND'],
  ['stop-search', 'PRIVATE_SESSION_CANCELLATION_ROUTE_NOT_BOUND'],
  ['list-searches', 'PRIVATE_SESSION_INVENTORY_ROUTE_NOT_BOUND'],
].map(([id, parityGapReason]) => [id, Object.freeze({
  partialSovereignEquivalent: 'search_project',
  partialScope: 'CANONICAL_REPOSITORY_LITERAL_SEARCH_ONLY',
  parityEvidenceScope: 'SOURCE_CATALOG_ONLY',
  runtimeParityProven: false,
  parityGapReason,
})]))));

const BOUNDARY_PATTERN =
  /(?:^|[-_])(arbitrary[-_]?shell|run[-_]?shell|force[-_]?push|destructive[-_]?git|delete[-_]?file|pc[-_]?restart|credential[-_]?export|secret[-_]?export|merge)(?:$|[-_])/i;

function catalogTruth(buildableGapCount, boundaryHoldCount) {
  return Object.freeze({
    parityEvidenceScope: 'SOURCE_CATALOG_ONLY',
    runtimeParityProven: false,
    installedParityState: 'UNKNOWN',
    zeroGapInvariantSatisfied: buildableGapCount === 0 && boundaryHoldCount === 0,
    sourceGapClosureRequired: buildableGapCount > 0 || boundaryHoldCount > 0,
    closureRequired: true,
    daemonMayReportGreen: false,
    mustContinueUntilZero: true,
    finalVerdict: buildableGapCount > 0
      ? 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GAPS_TRACKED'
      : boundaryHoldCount > 0
        ? 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_BOUNDARY_HOLD'
        : 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RUNTIME_UNPROVEN',
  });
}

// Queue observations and catalog equivalence cannot authenticate installed
// acceptance. Both public transports use this same projection, including when
// receiving an older producer's unsupported GREEN claim. Physical receipts
// remain in their existing acceptance surfaces; this does not erase them.
export function projectSovereignCapabilityCatalogTruth(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.canonicalOwnerGoal !== '#2573') return null;
  const keys = ['retainedCapabilityCount', 'parityPresentCount', 'buildableGapCount', 'boundaryHoldCount'];
  if (keys.some(key => !Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 10000)) return null;
  if (value.retainedCapabilityCount !== value.parityPresentCount + value.buildableGapCount + value.boundaryHoldCount) return null;
  if (!['SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GREEN', 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GAPS_TRACKED',
    'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RUNTIME_UNPROVEN', 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_BOUNDARY_HOLD'].includes(value.finalVerdict)) return null;
  return Object.freeze({ canonicalOwnerGoal: '#2573',
    ...Object.fromEntries(keys.map(key => [key, value[key]])),
    ...catalogTruth(value.buildableGapCount, value.boundaryHoldCount),
  });
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function capabilityId(value) {
  return text(value, 'source-construction')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'source-construction';
}

function operationFromEntry(entry = {}) {
  const item = entry?.item && typeof entry.item === 'object' ? entry.item : {};
  const candidates = [
    item?.executionBinding?.operation,
    item?.actionGrant?.operation,
    item?.payload?.operation,
    item?.payload?.actionKind,
    item?.operation,
    item?.actionKind,
  ];
  const observed = candidates.map((value) => text(value)).find(Boolean) || 'source-construction';
  return capabilityId(observed === 'agent-handoff' ? 'source-construction' : observed);
}

function authorityWideningRequested(entry = {}) {
  const item = entry?.item && typeof entry.item === 'object' ? entry.item : {};
  const candidates = [item, item?.payload, item?.actionGrant, item?.executionBinding]
    .filter((value) => value && typeof value === 'object');
  return candidates.some((value) => (
    value.arbitraryShellAllowed === true
    || value.arbitraryUnboundedCommandAllowed === true
    || value.mergeAuthority === true
    || value.destructiveGitAllowed === true
    || value.pcRestartAuthority === true
    || value.credentialExportAllowed === true
  ));
}

function suggestedEquivalent(operation) {
  if (DIRECT_PARITY[operation]) return DIRECT_PARITY[operation];
  if (operation === 'source-construction') return 'sovereign-source-construction-lane';
  return `sovereign-${operation}`;
}

export function classifyRemoteCommanderCapabilityObservation(entry = {}) {
  const observedAdapter = text(entry?.adapter).toLowerCase();
  const acceptedAdapters = new Set([
    'desktop-commander',
    'remote-desktop-commander',
    'desktop-commander-direct',
  ]);
  if (!acceptedAdapters.has(observedAdapter)) return null;
  const operation = operationFromEntry(entry);
  const boundaryHold = BOUNDARY_PATTERN.test(operation) || authorityWideningRequested(entry);
  const directEquivalent = DIRECT_PARITY[operation] || '';
  const partialGap = !directEquivalent
    ? SOVEREIGN_COMMANDER_SEARCH_PARITY_GAPS[operation] || SOVEREIGN_COMMANDER_PARTIAL_PARITY_GAPS[operation] : null;

  const state = boundaryHold
    ? SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BOUNDARY_HOLD
    : directEquivalent
      ? SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT
      : SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BUILDABLE_GAP;

  return Object.freeze({
    capabilityId: operation,
    observedAdapter: 'desktop-commander',
    observationIngress: observedAdapter,
    state,
    sovereignEquivalent: directEquivalent || suggestedEquivalent(operation),
    parityEvidenceScope: 'SOURCE_CATALOG_ONLY',
    runtimeParityProven: false,
    ...(partialGap || {}),
    ...(SOVEREIGN_COMMANDER_PRIVATE_SESSION_PARITY[operation] || {}),
    canonicalOwnerGoal: SOVEREIGN_COMMANDER_CAPABILITY_PARITY_OWNER.goal,
    canonicalOwnerTitle: SOVEREIGN_COMMANDER_CAPABILITY_PARITY_OWNER.title,
    requiresExistingGoalSearch: false,
    createDuplicateGoalAllowed: false,
    exactOwnerKnown: true,
    meterDependencyAccepted: false,
    operatorFallbackAllowed: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
    pcRestartAuthority: false,
    destructiveGitAllowed: false,
    sourceQueuePath: text(entry?.path),
    missionId: text(entry?.item?.missionId),
    actionId: text(entry?.item?.actionId),
  });
}

function priorCapabilities(priorLedger = {}) {
  return Array.isArray(priorLedger?.capabilities) ? priorLedger.capabilities : [];
}

function validTimestamp(value, fallback) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

export function buildSovereignCommanderCapabilityParityLedger(entries = [], {
  priorLedger = null,
  nowUtc = new Date().toISOString(),
} = {}) {
  const timestampUtc = validTimestamp(nowUtc, new Date().toISOString());
  const prior = new Map(
    priorCapabilities(priorLedger)
      .filter((item) => text(item?.capabilityId))
      .map((item) => [capabilityId(item.capabilityId), item]),
  );
  const observed = new Map();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const classified = classifyRemoteCommanderCapabilityObservation(entry);
    if (!classified) continue;
    const existing = observed.get(classified.capabilityId);
    if (!existing) {
      observed.set(classified.capabilityId, {
        classified,
        currentObservationCount: 1,
        missionIds: new Set([classified.missionId].filter(Boolean)),
        actionIds: new Set([classified.actionId].filter(Boolean)),
        queuePaths: new Set([classified.sourceQueuePath].filter(Boolean)),
      });
      continue;
    }
    existing.currentObservationCount += 1;
    if (classified.missionId) existing.missionIds.add(classified.missionId);
    if (classified.actionId) existing.actionIds.add(classified.actionId);
    if (classified.sourceQueuePath) existing.queuePaths.add(classified.sourceQueuePath);
  }

  const ids = [...new Set([...prior.keys(), ...observed.keys()])].sort();
  const capabilities = ids.map((id) => {
    const previous = prior.get(id) || {};
    const current = observed.get(id);
    const classified = current?.classified || null;
    const previousState = text(previous.state);
    const directEquivalent = DIRECT_PARITY[id];
    const partialGap = !directEquivalent
      ? SOVEREIGN_COMMANDER_SEARCH_PARITY_GAPS[id] || SOVEREIGN_COMMANDER_PARTIAL_PARITY_GAPS[id] : null;
    // Repair retained false equivalence too: no new Remote Commander call is
    // required to correct a prior source-catalog classification. A boundary
    // hold still wins, and a correction cannot become a new parity proof.
    const retainedState = previousState === SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BOUNDARY_HOLD
      ? previousState : directEquivalent
        ? SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT
        : partialGap ? SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BUILDABLE_GAP : previousState;
    const state = classified?.state || retainedState || SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BUILDABLE_GAP;
    const stateTransition = previousState && previousState !== state
      ? `${previousState}->${state}`
      : current
        ? 'OBSERVED'
        : 'RETAINED';
    const newlyMappedCapability = previousState === SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BUILDABLE_GAP
      && state === SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT;
    const firstSeenAtUtc = validTimestamp(previous.firstSeenAtUtc, timestampUtc);
    const priorCount = Number.isSafeInteger(Number(previous.observationCount))
      ? Math.max(0, Number(previous.observationCount))
      : 0;
    const currentCount = current?.currentObservationCount || 0;
    const retainedReferences = (key, currentValues) => [...new Set([
      ...(Array.isArray(previous[key]) ? previous[key].map((value) => text(value)).filter(Boolean) : []),
      ...(currentValues || []),
    ])].sort();
    return Object.freeze({
      capabilityId: id,
      state,
      previousState: previousState || null,
      stateTransition,
      newlyProvenParity: false,
      newlyMappedCapability,
      parityEvidenceScope: 'SOURCE_CATALOG_ONLY',
      runtimeParityProven: false,
      sovereignEquivalent: text(classified?.sovereignEquivalent
        || directEquivalent
        || (partialGap ? suggestedEquivalent(id) : previous.sovereignEquivalent)
        || suggestedEquivalent(id)),
      ...(partialGap || {}),
      ...(SOVEREIGN_COMMANDER_PRIVATE_SESSION_PARITY[id] || {}),
      canonicalOwnerGoal: SOVEREIGN_COMMANDER_CAPABILITY_PARITY_OWNER.goal,
      canonicalOwnerTitle: SOVEREIGN_COMMANDER_CAPABILITY_PARITY_OWNER.title,
      currentObserved: Boolean(current),
      firstSeenAtUtc,
      lastSeenAtUtc: current ? timestampUtc : validTimestamp(previous.lastSeenAtUtc, firstSeenAtUtc),
      observationCount: priorCount + currentCount,
      missionIds: Object.freeze(retainedReferences('missionIds', current?.missionIds)),
      actionIds: Object.freeze(retainedReferences('actionIds', current?.actionIds)),
      queuePaths: Object.freeze(retainedReferences('queuePaths', current?.queuePaths)),
      nextAction: state === SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT
        ? 'Prefer the mapped Sovereign route after live capability admission; verify each result.'
        : state === SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BOUNDARY_HOLD
          ? 'Preserve the authority boundary. Do not clone forbidden authority merely for parity.'
          : 'Advance #2573 through the canonical goal-building fabric until guarded Sovereign parity is proven.',
      createDuplicateGoalAllowed: false,
      operatorFallbackAllowed: false,
      meterDependencyAccepted: false,
      mergeAuthority: false,
      runtimeMutationAuthority: false,
      arbitraryShellAllowed: false,
      pcRestartAuthority: false,
      destructiveGitAllowed: false,
    });
  });

  const countState = (state) => capabilities.filter((item) => item.state === state).length;
  const buildableGapCount = countState(SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BUILDABLE_GAP);
  const boundaryHoldCount = countState(SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BOUNDARY_HOLD);
  const parityPresentCount = countState(SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT);
  const newlyProvenParityCount = capabilities.filter((item) => item.newlyProvenParity === true).length;

  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_CAPABILITY_PARITY_SCHEMA,
    timestampUtc,
    canonicalOwnerIssueNumber: SOVEREIGN_COMMANDER_CAPABILITY_PARITY_OWNER.issueNumber,
    canonicalOwnerGoal: SOVEREIGN_COMMANDER_CAPABILITY_PARITY_OWNER.goal,
    canonicalOwnerTitle: SOVEREIGN_COMMANDER_CAPABILITY_PARITY_OWNER.title,
    doctrine: 'REMOTE_COMMANDER_USE_DISCOVERS_CAPABILITY_SOVEREIGN_COMMANDER_RETAINS_IT',
    standingGoalMustRemainOpen: true,
    remoteCommanderRole: 'BOOTSTRAP_PROVING_BREAK_GLASS',
    sovereignCommanderRole: 'DURABLE_METER_FREE_IMPLEMENTATION',
    observedCurrentCapabilityCount: observed.size,
    retainedCapabilityCount: capabilities.length,
    parityPresentCount,
    newlyProvenParityCount,
    newlyMappedCapabilityCount: capabilities.filter(item => item.newlyMappedCapability).length,
    buildableGapCount,
    boundaryHoldCount,
    ...catalogTruth(buildableGapCount, boundaryHoldCount),
    capabilities: Object.freeze(capabilities),
    schedulerBypassAllowed: false,
    duplicateSchedulerAllowed: false,
    duplicateGoalCreationAllowed: false,
    operatorFallbackAllowed: false,
    meterDependencyAccepted: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
    pcRestartAuthority: false,
    destructiveGitAllowed: false,
  });
}
