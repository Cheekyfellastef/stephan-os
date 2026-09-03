import assert from 'node:assert/strict';
import test from 'node:test';

import { MISSION_CONTROLLER_ROUTE } from './missionControllerCapacityRouterV1.mjs';
import {
  PROVIDER_INDEPENDENT_MISSION_CAPACITY_ROUTE_V1_SCHEMA,
  routeProviderIndependentMissionCapacityV1,
} from './providerIndependentMissionCapacityRouteV1.mjs';

function plannerFor({ normalRoute = MISSION_CONTROLLER_ROUTE.CODEX, independentReady = true } = {}) {
  return (input = {}) => {
    const stripped = input.codexStatus === null && input.githubLaneReceipt === null;
    if (stripped) {
      if (!independentReady) {
        return Object.freeze({
          route: MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY,
          adapter: '',
          dispatchAllowed: false,
          blockers: Object.freeze(['proven-build-fallback-unavailable']),
          finalVerdict: 'MISSION_CONTROLLER_CAPACITY_BLOCKED',
        });
      }
      return Object.freeze({
        route: MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
        adapter: 'foundry-forge',
        workerId: 'forge-builder-01',
        dispatchAllowed: true,
        blockers: Object.freeze([]),
        finalVerdict: 'MISSION_CONTROLLER_FALLBACK_ROUTE_READY',
      });
    }
    return Object.freeze({
      route: normalRoute,
      adapter: normalRoute === MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB ? 'chatgpt-github' : 'codex',
      dispatchAllowed: true,
      blockers: Object.freeze([]),
      finalVerdict: 'MISSION_CONTROLLER_ROUTE_READY',
    });
  };
}

const TEST_OPTIONS = (planner) => ({ testOnly: true, routePlanner: planner });

test('prefers a proven non-OpenAI route before otherwise healthy OpenAI capacity', () => {
  const result = routeProviderIndependentMissionCapacityV1({
    preferNonOpenAi: true,
    codexStatus: { available: true },
    githubLaneReceipt: { available: true },
  }, TEST_OPTIONS(plannerFor()));

  assert.equal(result.providerIndependenceSchema, PROVIDER_INDEPENDENT_MISSION_CAPACITY_ROUTE_V1_SCHEMA);
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE);
  assert.equal(result.adapter, 'foundry-forge');
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.nonOpenAiAttempted, true);
  assert.equal(result.nonOpenAiRouteSelected, true);
  assert.equal(result.openAiCriticalPathRequired, false);
  assert.equal(result.finalVerdict, 'MISSION_CONTROLLER_PROVIDER_INDEPENDENT_ROUTE_READY');
});

test('an OpenAI blackout holds rather than silently falling back to Codex or ChatGPT GitHub', () => {
  const result = routeProviderIndependentMissionCapacityV1({
    openAiBlackout: true,
    codexStatus: { available: true },
    githubLaneReceipt: { available: true },
  }, TEST_OPTIONS(plannerFor({ independentReady: false })));

  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.openAiBlackout, true);
  assert.equal(result.openAiCriticalPathRequired, false);
  assert.ok(result.blockers.includes('openai-blackout-non-openai-capacity-unavailable'));
  assert.equal(result.finalVerdict, 'MISSION_CONTROLLER_OPENAI_BLACKOUT_HELD');
});

test('without blackout, OpenAI remains optional overflow only when no independent route is proven', () => {
  const result = routeProviderIndependentMissionCapacityV1({
    preferNonOpenAi: true,
  }, TEST_OPTIONS(plannerFor({
    normalRoute: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
    independentReady: false,
  })));

  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.nonOpenAiAttempted, true);
  assert.equal(result.nonOpenAiRouteSelected, false);
  assert.equal(result.openAiCriticalPathRequired, true);
});

test('existing running dispatch ownership is preserved and never duplicated by failover', () => {
  const planner = () => Object.freeze({
    route: MISSION_CONTROLLER_ROUTE.CODEX,
    adapter: 'codex',
    dispatchAllowed: false,
    blockers: Object.freeze(['existing-agent-dispatch-owns-mission']),
    finalVerdict: 'MISSION_CONTROLLER_EXISTING_DISPATCH_PRESERVED',
  });
  const result = routeProviderIndependentMissionCapacityV1({
    preferNonOpenAi: true,
    openAiBlackout: true,
  }, TEST_OPTIONS(planner));

  assert.equal(result.finalVerdict, 'MISSION_CONTROLLER_EXISTING_DISPATCH_PRESERVED');
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.nonOpenAiAttempted, false);
  assert.equal(result.openAiCriticalPathRequired, false);
});

test('route planner overrides are rejected outside explicit test-only use', () => {
  assert.throws(() => routeProviderIndependentMissionCapacityV1({}, {
    routePlanner: plannerFor(),
  }), /test-only/);
});
