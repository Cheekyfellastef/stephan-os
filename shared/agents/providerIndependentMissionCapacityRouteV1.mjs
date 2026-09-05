import {
  MISSION_CONTROLLER_ROUTE,
} from './missionControllerCapacityRouterV1.mjs';
import { routeWithQualifiedOpenClawProvider } from './openClawProviderPoolQualificationV1.mjs';

export const PROVIDER_INDEPENDENT_MISSION_CAPACITY_ROUTE_V1_SCHEMA = 'stephanos.provider-independent-mission-capacity-route.v1';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function freeze(value) {
  return Object.freeze(value);
}

function trustedOpenClawSourceHead(input = {}) {
  return text(input.sourceHead)
    || text(input.openClawHostContext?.qualificationReceipt?.sourceHead);
}

function defaultPlanner(input = {}) {
  const hostContext = input.openClawHostContext && typeof input.openClawHostContext === 'object'
    ? input.openClawHostContext
    : {};
  return routeWithQualifiedOpenClawProvider({
    ...input,
    sourceHead: trustedOpenClawSourceHead(input),
  }, hostContext);
}

function routePlanner(input, options = {}) {
  if (options.routePlanner !== undefined) {
    if (options.testOnly !== true || typeof options.routePlanner !== 'function') {
      throw new TypeError('routePlanner override is test-only');
    }
    return options.routePlanner;
  }
  return defaultPlanner;
}

function nonOpenAiAttempt(input, planner) {
  return planner({
    ...input,
    codexStatus: null,
    githubLaneReceipt: null,
  });
}

function isIndependentBuildRoute(route) {
  const normalized = text(route).toUpperCase();
  return normalized === MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE
    || normalized === MISSION_CONTROLLER_ROUTE.OPENCLAW_LOCAL;
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

  const independent = nonOpenAiAttempt(input, planner);
  const independentReady = independent?.dispatchAllowed === true
    && isIndependentBuildRoute(independent.route);

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
