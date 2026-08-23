import {
  MISSION_CONTROLLER_CAPACITY_ROUTER_SCHEMA,
  MISSION_CONTROLLER_ROUTE,
  routeMissionControllerCapacity,
} from './missionControllerCapacityRouterV1.mjs';

export const ZERO_CODEX_BLACKOUT_ZC1_SCHEMA = 'stephanos.zero-codex-blackout-zc1.v1';

export const ZERO_CODEX_ZC1_VERDICT = Object.freeze({
  PASS: 'ZERO_CODEX_ZC1_PASS',
  BLOCKED_BY_PARITY_GAP: 'ZERO_CODEX_ZC1_BLOCKED_BY_PARITY_GAP',
  BLOCKED_INVALID_FIXTURE: 'ZERO_CODEX_ZC1_BLOCKED_INVALID_FIXTURE',
  FAIL_CODEX_SELECTED: 'ZERO_CODEX_ZC1_FAIL_CODEX_SELECTED',
});

const FULL_SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(value) {
  const normalized = text(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function frozenList(value) {
  return Object.freeze(Array.isArray(value) ? [...value] : []);
}

function zeroCodexStatus(nowUtc) {
  return Object.freeze({
    schemaVersion: 'shared-agent-workspace-record.v1',
    statusId: 'codex-capacity-current',
    truthState: 'CURRENT',
    meterTruthUsable: true,
    observedAtUtc: nowUtc,
    remainingPercent: 0,
    availability: 'METER_STALLED',
    confidence: 'high',
    naturalResetAtUtc: '',
  });
}

function authorityBoundary() {
  return Object.freeze({
    mergeAuthority: false,
    deploymentAuthority: false,
    windowsRuntimeAuthority: false,
    openClawMutationAuthority: false,
    providerQualificationAuthority: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
  });
}

export function evaluateZeroCodexZc1Routing(input = {}) {
  const nowUtc = text(input.nowUtc);
  const sourceHead = text(input.sourceHead);
  const missionId = text(input.mission?.missionId);
  const repository = text(input.mission?.repository);
  const base = {
    schemaVersion: ZERO_CODEX_BLACKOUT_ZC1_SCHEMA,
    scenario: 'ZC1_DETERMINISTIC_ROUTING',
    sourceHead,
    missionId,
    repository,
    evaluatedAtUtc: nowUtc,
    capacityInjection: Object.freeze({
      codexCapacity: 'ZERO_OR_UNAVAILABLE',
      workAgenticCapacity: 'ZERO_OR_UNAVAILABLE',
      newCodexDispatchAllowed: false,
      waitingForCodexAllowed: false,
      providerControlsBypassed: false,
    }),
    authorityBoundary: authorityBoundary(),
  };

  if (
    timestamp(nowUtc) === null
    || !FULL_SHA.test(sourceHead)
    || !missionId
    || !REPOSITORY.test(repository)
  ) {
    return Object.freeze({
      ...base,
      route: MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY,
      adapter: '',
      dispatchAllowed: false,
      rejectedCodexRoute: true,
      nonCodexProvidersUsed: Object.freeze([]),
      blockers: Object.freeze(['zero-codex-zc1-fixture-identity-invalid']),
      finalVerdict: ZERO_CODEX_ZC1_VERDICT.BLOCKED_INVALID_FIXTURE,
    });
  }

  const routeDecision = routeMissionControllerCapacity({
    nowUtc,
    mission: input.mission,
    task: input.task,
    codexStatus: zeroCodexStatus(nowUtc),
    githubLaneReceipt: input.githubLaneReceipt,
    forgeSidecar: input.forgeSidecar,
    forgeLaneReceipt: input.forgeLaneReceipt,
  });

  const route = text(routeDecision.route).toUpperCase();
  const adapter = text(routeDecision.adapter);
  const codexSelected = route === MISSION_CONTROLLER_ROUTE.CODEX || adapter === 'codex';
  const nonCodexReady = routeDecision.dispatchAllowed === true
    && !codexSelected
    && route !== MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY;

  let finalVerdict = ZERO_CODEX_ZC1_VERDICT.BLOCKED_BY_PARITY_GAP;
  if (codexSelected) finalVerdict = ZERO_CODEX_ZC1_VERDICT.FAIL_CODEX_SELECTED;
  else if (nonCodexReady) finalVerdict = ZERO_CODEX_ZC1_VERDICT.PASS;

  const blockers = frozenList(routeDecision.blockers);
  return Object.freeze({
    ...base,
    route,
    adapter,
    dispatchAllowed: nonCodexReady,
    rejectedCodexRoute: !codexSelected,
    selectedCapacityReceiptId: routeDecision.selectedCapacityReceiptId || null,
    nonCodexProvidersUsed: Object.freeze(nonCodexReady && adapter ? [adapter] : []),
    blockers,
    routerSchemaVersion: routeDecision.schemaVersion || MISSION_CONTROLLER_CAPACITY_ROUTER_SCHEMA,
    routerFinalVerdict: text(routeDecision.finalVerdict),
    finalVerdict,
  });
}
