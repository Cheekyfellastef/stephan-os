import {
  BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
  MISSION_CONTROLLER_ROUTE,
  publishBuildLaneCapacityToSharedWorkspace,
  validateBuildLaneCapacityReceipt,
} from './missionControllerCapacityRouterV1.mjs';

export const GITHUB_CONTINUITY_CAPACITY_PUBLICATION_SCHEMA = 'stephanos.github-continuity-capacity-publication.v1';
export const GITHUB_CONTINUITY_CAPACITY_PUBLICATION_STATE = Object.freeze({
  READY: 'READY',
  SAFE_HOLD: 'SAFE_HOLD',
});

const INPUT_KEYS = new Set([
  'receiptId', 'route', 'repository', 'workerId', 'supportedTaskClasses',
  'observedAtUtc', 'expiresAtUtc', 'queueDepth', 'p95StartLatencySeconds',
  'authorityReceiptIds', 'proofRefs',
]);
const ROUTES = new Set([
  MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
  MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
]);
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const TASK_CLASS = /^[A-Z][A-Z0-9_]{2,63}$/;
const SAFE_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_PUBLICATION_LIFETIME_MS = 5 * 60 * 1000;

const ZERO_AUTHORITY = Object.freeze({
  sourceMutationAuthorityAdded: false,
  mergeAuthorityAdded: false,
  deploymentAuthorityAdded: false,
  runtimeMutationAuthorityAdded: false,
  protectedMergeDispatchAllowed: false,
  leaseSeizureAllowed: false,
  duplicateDispatchAllowed: false,
  arbitraryCommandAllowed: false,
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isoMs(value) {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === normalized ? parsed : null;
}

function snapshot(value, state = { nodes: 0 }, depth = 0, seen = new Set()) {
  state.nodes += 1;
  if (state.nodes > 4096 || depth > 12) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.length <= 32768 ? value : undefined;
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) return undefined;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 64 || descriptors.length?.get || descriptors.length?.set) return undefined;
      const expected = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
      if (Object.keys(descriptors).some((key) => !expected.has(key))) return undefined;
      seen.add(value);
      const output = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
          seen.delete(value);
          return undefined;
        }
        const child = snapshot(descriptor.value, state, depth + 1, seen);
        if (child === undefined) {
          seen.delete(value);
          return undefined;
        }
        output.push(child);
      }
      seen.delete(value);
      return Object.freeze(output);
    }
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    seen.add(value);
    const output = Object.create(null);
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key];
      if (RESERVED.has(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        seen.delete(value);
        return undefined;
      }
      const child = snapshot(descriptor.value, state, depth + 1, seen);
      if (child === undefined) {
        seen.delete(value);
        return undefined;
      }
      Object.defineProperty(output, key, { value: child, enumerable: true, writable: false, configurable: false });
    }
    seen.delete(value);
    return Object.freeze(output);
  } catch {
    return undefined;
  }
}

function closedWorld(value) {
  const owned = snapshot(value);
  if (!owned || Array.isArray(owned)) return null;
  const keys = Object.keys(owned);
  if (keys.length !== INPUT_KEYS.size || keys.some((key) => !INPUT_KEYS.has(key))) return null;
  return owned;
}

function uniqueList(value, predicate, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > 32) return null;
  const items = value.map(text);
  if (items.some((item) => !predicate(item)) || new Set(items).size !== items.length) return null;
  return Object.freeze(items);
}

function blocked(blocker) {
  return Object.freeze({
    schemaVersion: GITHUB_CONTINUITY_CAPACITY_PUBLICATION_SCHEMA,
    state: GITHUB_CONTINUITY_CAPACITY_PUBLICATION_STATE.SAFE_HOLD,
    receipt: null,
    blocker,
    authority: ZERO_AUTHORITY,
    finalVerdict: 'GITHUB_CONTINUITY_CAPACITY_PUBLICATION_SAFE_HOLD',
  });
}

export function buildGitHubContinuityCapacityPublicationV1(rawInput = {}) {
  const input = closedWorld(rawInput);
  if (!input) return blocked('capacity-observation-not-data-only-or-closed-world');

  const route = text(input.route).toUpperCase();
  const repository = text(input.repository);
  const receiptId = text(input.receiptId);
  const workerId = text(input.workerId);
  const observedAtUtc = text(input.observedAtUtc);
  const expiresAtUtc = text(input.expiresAtUtc);
  const observedAtMs = isoMs(observedAtUtc);
  const expiresAtMs = isoMs(expiresAtUtc);
  const supportedTaskClasses = uniqueList(input.supportedTaskClasses, (item) => TASK_CLASS.test(item), 1);
  const authorityReceiptIds = uniqueList(input.authorityReceiptIds, (item) => SAFE_ID.test(item), 0);
  const proofRefs = uniqueList(input.proofRefs, (item) => SAFE_REF.test(item) && !item.includes('..'), 1);

  if (!ROUTES.has(route) || !REPOSITORY.test(repository) || !SAFE_ID.test(receiptId) || !SAFE_ID.test(workerId)) {
    return blocked('capacity-observation-identity-invalid');
  }
  if (observedAtMs === null || expiresAtMs === null || expiresAtMs <= observedAtMs
      || expiresAtMs - observedAtMs > MAX_PUBLICATION_LIFETIME_MS) {
    return blocked('capacity-observation-freshness-invalid');
  }
  if (!supportedTaskClasses || !authorityReceiptIds || !proofRefs
      || !Number.isSafeInteger(input.queueDepth) || input.queueDepth < 0 || input.queueDepth > 1000
      || !Number.isFinite(input.p95StartLatencySeconds) || input.p95StartLatencySeconds < 0
      || input.p95StartLatencySeconds > 24 * 60 * 60) {
    return blocked('capacity-observation-evidence-invalid');
  }

  const receipt = Object.freeze({
    schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
    receiptId,
    route,
    repository,
    workerId,
    state: 'READY',
    supportedOperations: Object.freeze(['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS']),
    supportedTaskClasses,
    observedAtUtc,
    expiresAtUtc,
    queueDepth: input.queueDepth,
    p95StartLatencySeconds: input.p95StartLatencySeconds,
    authorityReceiptIds,
    proofRefs,
  });

  const invalidClass = supportedTaskClasses.find((taskClass) => !validateBuildLaneCapacityReceipt(receipt, {
    repository,
    taskClass,
    nowUtc: observedAtUtc,
  }).valid);
  if (invalidClass) return blocked('canonical-capacity-receipt-validation-failed');

  return Object.freeze({
    schemaVersion: GITHUB_CONTINUITY_CAPACITY_PUBLICATION_SCHEMA,
    state: GITHUB_CONTINUITY_CAPACITY_PUBLICATION_STATE.READY,
    receipt,
    blocker: '',
    authority: ZERO_AUTHORITY,
    finalVerdict: 'GITHUB_CONTINUITY_CAPACITY_RECEIPT_READY',
  });
}

export async function publishGitHubContinuityCapacityPublicationV1(root, rawInput = {}, options = {}) {
  const built = buildGitHubContinuityCapacityPublicationV1(rawInput);
  if (built.state !== GITHUB_CONTINUITY_CAPACITY_PUBLICATION_STATE.READY) return built;

  const injectedNowUtc = options && typeof options === 'object' && !Array.isArray(options)
    ? text(options.nowUtc)
    : '';
  const nowUtc = injectedNowUtc || new Date().toISOString();
  if (isoMs(nowUtc) === null) return blocked('publication-time-invalid');

  const invalidAtPublication = built.receipt.supportedTaskClasses.find((taskClass) => !validateBuildLaneCapacityReceipt(
    built.receipt,
    {
      repository: built.receipt.repository,
      taskClass,
      nowUtc,
    },
  ).valid);
  if (invalidAtPublication) return blocked('capacity-observation-not-current-at-publication');

  const publication = await publishBuildLaneCapacityToSharedWorkspace(root, built.receipt, { nowUtc });
  return Object.freeze({
    ...built,
    publication,
    finalVerdict: publication.ok
      ? 'GITHUB_CONTINUITY_CAPACITY_PUBLISHED'
      : 'GITHUB_CONTINUITY_CAPACITY_PUBLICATION_FAILED',
  });
}
