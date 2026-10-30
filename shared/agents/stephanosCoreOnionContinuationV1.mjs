import {
  ONION_CONTINUATION_SCHEMA,
  projectOnionContinuationV1,
} from './onionContinuationDoctrineV1.mjs';

function text(value) {
  return String(value ?? '').trim();
}

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasMaterialInput(value) {
  const input = object(value);
  return Boolean(
    text(input.originalOutcomeId)
    || text(input.blocker)
    || input.originalOutcomeProven === true
    || input.hardBoundary === true
    || input.safeRepairAvailable === false
  );
}

export function projectStephanosCoreOnionContinuationV1({
  current = {},
  persisted = {},
} = {}) {
  const prior = object(persisted);
  const priorValid = prior.schemaVersion === ONION_CONTINUATION_SCHEMA;
  const restored = priorValid ? prior : {};
  const live = object(current);
  const hasLive = hasMaterialInput(live);

  const originalOutcomeId = text(live.originalOutcomeId) || text(restored.originalOutcomeId);
  const blocker = text(live.blocker) || text(restored.blocker);
  const priorDepth = nonNegativeInteger(restored.blockerDepth, 0);
  const explicitDepth = Number.isSafeInteger(Number(live.blockerDepth))
    && Number(live.blockerDepth) >= 0;
  const blockerChanged = Boolean(
    hasLive
    && text(live.blocker)
    && text(restored.blocker)
    && text(live.blocker) !== text(restored.blocker)
  );
  const blockerDepth = explicitDepth
    ? Number(live.blockerDepth)
    : blockerChanged
      ? priorDepth + 1
      : priorDepth;

  const projection = projectOnionContinuationV1({
    ...restored,
    ...live,
    originalOutcomeId,
    blocker,
    blockerDepth,
  });

  return Object.freeze({
    ...projection,
    restoredFromPersistedState: !hasLive && priorValid,
    blockerChanged,
    authorityExpanded: false,
    sourceMutationAuthorityGranted: false,
    schedulerAuthorityGranted: false,
    mergeAuthorityGranted: false,
  });
}
