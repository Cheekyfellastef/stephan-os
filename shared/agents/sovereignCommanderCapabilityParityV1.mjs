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

const DIRECT_PARITY = Object.freeze({
  'get-config': 'get_config',
  'read-file': 'read_file',
  'write-file': 'write_file',
  'edit-file': 'edit_file',
  'edit-block': 'edit_file',
  'list-directory': 'list_directory',
  'list-processes': 'list_processes',
});

const BOUNDARY_PATTERN =
  /(?:^|[-_])(arbitrary[-_]?shell|run[-_]?shell|force[-_]?push|destructive[-_]?git|delete[-_]?file|pc[-_]?restart|credential[-_]?export|secret[-_]?export|merge)(?:$|[-_])/i;

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
  return capabilityId(candidates.map(text).find(Boolean) || 'source-construction');
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
  if (text(entry?.adapter).toLowerCase() !== 'desktop-commander') return null;
  const operation = operationFromEntry(entry);
  const boundaryHold = BOUNDARY_PATTERN.test(operation) || authorityWideningRequested(entry);
  const directEquivalent = DIRECT_PARITY[operation] || '';

  const state = boundaryHold
    ? SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BOUNDARY_HOLD
    : directEquivalent
      ? SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT
      : SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BUILDABLE_GAP;

  return Object.freeze({
    capabilityId: operation,
    observedAdapter: 'desktop-commander',
    state,
    sovereignEquivalent: directEquivalent || suggestedEquivalent(operation),
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
    const state = classified?.state || previousState || SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BUILDABLE_GAP;
    const firstSeenAtUtc = validTimestamp(previous.firstSeenAtUtc, timestampUtc);
    const priorCount = Number.isSafeInteger(Number(previous.observationCount))
      ? Math.max(0, Number(previous.observationCount))
      : 0;
    const currentCount = current?.currentObservationCount || 0;
    return Object.freeze({
      capabilityId: id,
      state,
      sovereignEquivalent: text(classified?.sovereignEquivalent || previous.sovereignEquivalent || suggestedEquivalent(id)),
      canonicalOwnerGoal: SOVEREIGN_COMMANDER_CAPABILITY_PARITY_OWNER.goal,
      canonicalOwnerTitle: SOVEREIGN_COMMANDER_CAPABILITY_PARITY_OWNER.title,
      currentObserved: Boolean(current),
      firstSeenAtUtc,
      lastSeenAtUtc: current ? timestampUtc : validTimestamp(previous.lastSeenAtUtc, firstSeenAtUtc),
      observationCount: priorCount + currentCount,
      missionIds: Object.freeze([...(current?.missionIds || [])].sort()),
      actionIds: Object.freeze([...(current?.actionIds || [])].sort()),
      queuePaths: Object.freeze([...(current?.queuePaths || [])].sort()),
      nextAction: state === SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT
        ? 'Use Sovereign Commander by default; keep Remote Commander break-glass only.'
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
    buildableGapCount,
    boundaryHoldCount,
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
    finalVerdict: buildableGapCount > 0
      ? 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GAPS_TRACKED'
      : 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GREEN',
  });
}
