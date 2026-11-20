import {
  MISSION_CONTROLLER_ROUTE,
  routeMissionControllerCapacity,
} from './missionControllerCapacityRouterV1.mjs';

export const PROVIDER_INDEPENDENT_MISSION_CAPACITY_ROUTE_V1_SCHEMA = 'stephanos.provider-independent-mission-capacity-route.v1';

const SOVEREIGN_SOURCE_ADAPTERS = Object.freeze({
  [MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE]: 'foundry-forge',
  [MISSION_CONTROLLER_ROUTE.STEPHANOS_NATIVE]: 'stephanos-native',
  [MISSION_CONTROLLER_ROUTE.SOVEREIGN_COMMANDER]: 'sovereign-commander',
  [MISSION_CONTROLLER_ROUTE.OPENCLAW_STANDALONE]: 'openclaw-standalone',
  [MISSION_CONTROLLER_ROUTE.OPENCLAW_LOCAL]: 'openclaw-local',
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function freeze(value) {
  return Object.freeze(value);
}

function routePlanner(input, options = {}) {
  if (options.routePlanner !== undefined) {
    if (options.testOnly !== true || typeof options.routePlanner !== 'function') {
      throw new TypeError('routePlanner override is test-only');
    }
    return options.routePlanner;
  }
  return routeMissionControllerCapacity;
}

// Shared by the single-mission worker and elastic capacity enumeration. This
// only excludes metered transports; the canonical router still owns receipt,
// task-class, source-head, freshness and existing-dispatch qualification.
export function providerIndependentSourceCapacityInputV1(input = {}) {
  // A non-OpenAI route is not necessarily sovereign: Desktop Commander is
  // another metered external transport. Preserve it only as optional normal
  // capacity when it is actually available, never as blackout independence.
  const blockedAdapters = [...new Set([...list(input.blockedAdapters), 'desktop-commander'])];
  return freeze({
    ...input,
    codexStatus: null,
    githubLaneReceipt: null,
    desktopCommanderLaneReceipt: null,
    blockedAdapters: freeze(blockedAdapters),
  });
}

export function isProviderIndependentSourceCapacityCandidateV1(candidate = {}) {
  const route = text(candidate?.route).toUpperCase();
  const adapter = text(candidate?.adapter).toLowerCase();
  return Object.hasOwn(SOVEREIGN_SOURCE_ADAPTERS, route)
    && SOVEREIGN_SOURCE_ADAPTERS[route] === adapter;
}

function decorate(result, additions = {}) {
  return freeze({
    ...result,
    providerIndependenceSchema: PROVIDER_INDEPENDENT_MISSION_CAPACITY_ROUTE_V1_SCHEMA,
    preferNonOpenAi: additions.preferNonOpenAi === true,
    openAiBlackout: additions.openAiBlackout === true,
    nonOpenAiAttempted: additions.nonOpenAiAttempted === true,
    nonOpenAiRouteSelected: additions.nonOpenAiRouteSelected === true,
    openAiCriticalPathRequired: additions.openAiCriticalPathRequired === true,
  });
}

export function routeProviderIndependentMissionCapacityV1(input = {}, options = {}) {
  const planner = routePlanner(input, options);
  const preferNonOpenAi = input.preferNonOpenAi !== false;
  const openAiBlackout = input.openAiBlackout === true;
  const normal = planner(input);

  if (normal?.finalVerdict === 'MISSION_CONTROLLER_EXISTING_DISPATCH_PRESERVED') {
    return decorate(normal, {
      preferNonOpenAi,
      openAiBlackout,
      nonOpenAiAttempted: false,
      nonOpenAiRouteSelected: false,
      openAiCriticalPathRequired: false,
    });
  }

  if (!preferNonOpenAi && !openAiBlackout) {
    return decorate(normal, {
      preferNonOpenAi: false,
      openAiBlackout: false,
      nonOpenAiAttempted: false,
      nonOpenAiRouteSelected: false,
      openAiCriticalPathRequired: normal?.dispatchAllowed === true
        && [MISSION_CONTROLLER_ROUTE.CODEX, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB].includes(text(normal.route).toUpperCase()),
    });
  }

  const independent = planner(providerIndependentSourceCapacityInputV1(input));
  const independentReady = independent?.dispatchAllowed === true
    && isProviderIndependentSourceCapacityCandidateV1(independent);

  if (independentReady) {
    return decorate({
      ...independent,
      finalVerdict: 'MISSION_CONTROLLER_PROVIDER_INDEPENDENT_ROUTE_READY',
    }, {
      preferNonOpenAi,
      openAiBlackout,
      nonOpenAiAttempted: true,
      nonOpenAiRouteSelected: true,
      openAiCriticalPathRequired: false,
    });
  }

  if (openAiBlackout) {
    return decorate({
      ...independent,
      route: MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY,
      adapter: '',
      dispatchAllowed: false,
      blockers: freeze([...new Set([
        ...list(independent?.blockers),
        'openai-blackout-non-openai-capacity-unavailable',
      ])]),
      finalVerdict: 'MISSION_CONTROLLER_OPENAI_BLACKOUT_HELD',
    }, {
      preferNonOpenAi,
      openAiBlackout: true,
      nonOpenAiAttempted: true,
      nonOpenAiRouteSelected: false,
      openAiCriticalPathRequired: false,
    });
  }

  return decorate(normal, {
    preferNonOpenAi,
    openAiBlackout: false,
    nonOpenAiAttempted: true,
    nonOpenAiRouteSelected: false,
    openAiCriticalPathRequired: normal?.dispatchAllowed === true
      && [MISSION_CONTROLLER_ROUTE.CODEX, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB].includes(text(normal.route).toUpperCase()),
  });
}
