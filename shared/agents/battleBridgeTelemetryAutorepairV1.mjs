import * as base from './battleBridgeTelemetryAutorepairV1Base.mjs';

export const BATTLE_BRIDGE_TELEMETRY_AUTOREPAIR_SCHEMA = base.BATTLE_BRIDGE_TELEMETRY_AUTOREPAIR_SCHEMA;
export const BATTLE_BRIDGE_EXECUTIVE_STATE_SCHEMA = base.BATTLE_BRIDGE_EXECUTIVE_STATE_SCHEMA;
export const BATTLE_BRIDGE_EXECUTIVE_QUESTION_CLASSES = base.BATTLE_BRIDGE_EXECUTIVE_QUESTION_CLASSES;

const SHA40 = /^[0-9a-f]{40}$/;
const RUNTIME_HEAD_KEYS = Object.freeze(['builtHead', 'servedHead', 'runtimeHead']);

function validHead(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function runtimeHeadAggregate(sourceHead, surfaces = []) {
  const exactHead = validHead(sourceHead);
  const observed = Object.fromEntries(RUNTIME_HEAD_KEYS.map((key) => [key, new Set()]));

  for (const surface of Array.isArray(surfaces) ? surfaces : []) {
    const runtimeHeads = surface?.runtimeHeads;
    if (!runtimeHeads || typeof runtimeHeads !== 'object' || Array.isArray(runtimeHeads)) continue;
    for (const key of RUNTIME_HEAD_KEYS) {
      const head = validHead(runtimeHeads[key]);
      if (head) observed[key].add(head);
    }
  }

  const aggregate = {};
  for (const key of RUNTIME_HEAD_KEYS) {
    const heads = [...observed[key]];
    if (heads.length === 0) aggregate[key] = '';
    else if (heads.length === 1) aggregate[key] = heads[0];
    else aggregate[key] = heads.find((head) => head !== exactHead) || heads[0];
  }
  return Object.freeze(aggregate);
}

function normalizeRuntimeHeadSurfaces(sourceHead, surfaces = []) {
  const safeSurfaces = Array.isArray(surfaces) ? surfaces : [];
  const aggregate = runtimeHeadAggregate(sourceHead, safeSurfaces);
  const normalized = safeSurfaces.map((surface) => {
    if (!surface || typeof surface !== 'object' || Array.isArray(surface) || !Object.hasOwn(surface, 'runtimeHeads')) return surface;
    const { runtimeHeads: _ignoredRuntimeHeads, ...rest } = surface;
    return Object.freeze(rest);
  });

  if (RUNTIME_HEAD_KEYS.some((key) => aggregate[key])) {
    normalized.push(Object.freeze({
      id: 'runtime-heads-aggregate',
      runtimeHeads: aggregate,
    }));
  }
  return Object.freeze(normalized);
}

function preserveAbsentOperatorAuthorization(executive = {}) {
  return Object.freeze({
    ...executive,
    operatorAuthorizationState: 'OPERATOR_AUTHORIZATION_NOT_PRESENT',
  });
}

export function buildBattleBridgeExecutiveStateProjection(input = {}) {
  const normalized = {
    ...input,
    surfaces: normalizeRuntimeHeadSurfaces(input?.sourceHead, input?.surfaces),
  };
  return preserveAbsentOperatorAuthorization(base.buildBattleBridgeExecutiveStateProjection(normalized));
}

export function buildBattleBridgeTelemetryAutorepairProjection(input = {}) {
  const normalized = {
    ...input,
    surfaces: normalizeRuntimeHeadSurfaces(input?.sourceHead, input?.surfaces),
  };
  const projection = base.buildBattleBridgeTelemetryAutorepairProjection(normalized);
  const executive = preserveAbsentOperatorAuthorization(projection.executive);
  return Object.freeze({
    ...projection,
    operatorAuthorizationState: 'OPERATOR_AUTHORIZATION_NOT_PRESENT',
    executive,
  });
}

export const isBattleBridgeTelemetryStateHealthy = base.isBattleBridgeTelemetryStateHealthy;
