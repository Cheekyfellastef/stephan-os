import { createHash } from 'node:crypto';

export const CONTROLLER_ESTATE_MIGRATION_SCHEMA = 'stephanos.controller-estate-migration.v1';
export const CONTROLLER_RETIREMENT_ASSESSMENT_SCHEMA = 'stephanos.controller-retirement-assessment.v1';
export const CONTROLLER_POST_RETIREMENT_RECONCILIATION_SCHEMA = 'stephanos.controller-post-retirement-reconciliation.v1';
export const CONTROLLER_RETIREMENT_SHARED_PROJECTION_SCHEMA = 'stephanos.controller-retirement-shared-projection.v1';

export const CONTROLLER_MIGRATION_STATUS = Object.freeze({
  READY: 'READY_FOR_RETIREMENT',
  BLOCKED: 'RETIREMENT_BLOCKED',
  POST_RETIREMENT_PROVEN: 'POST_RETIREMENT_RECONCILED',
  ORPHANED_REPAIR_REQUIRED: 'ORPHANED_REPAIR_REQUIRED',
});

const SAFE_ID = /^[a-z0-9][a-z0-9._:/-]{0,159}$/i;
const SAFE_REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const TERMINAL_STATES = new Set(['COMPLETE', 'COMPLETED', 'CANCELLED', 'SUPERSEDED', 'TERMINAL']);
const PARKED_STATES = new Set(['OPERATOR_READY_PARKED', 'APPROVAL_REQUIRED', 'RUNTIME_GATE_PARKED']);
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function timestamp(value) {
  const normalized = text(value);
  if (!normalized || !EXPLICIT_TIMEZONE.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function unique(values) {
  return [...new Set(values)];
}

function normalizedStrings(values) {
  return unique(list(values).map(text).filter(Boolean)).sort();
}

function includesAll(actual, required) {
  const have = new Set(normalizedStrings(actual));
  return normalizedStrings(required).every((value) => have.has(value));
}

function boundedPlainData(value, depth = 0, state = { nodes: 0, seen: new Set() }) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (typeof value !== 'object' || depth > 8 || state.nodes >= 512 || state.seen.has(value)) return false;
  state.nodes += 1;
  state.seen.add(value);
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length > 192 || keys.some((key) => typeof key !== 'string')) return false;
    for (const key of keys) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return false;
      if (!boundedPlainData(descriptor.value, depth + 1, state)) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    state.seen.delete(value);
  }
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function stableDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeController(controller, role, blockers) {
  if (!controller || typeof controller !== 'object' || Array.isArray(controller)) {
    blockers.push(`${role}-controller-invalid`);
    return null;
  }
  const controllerId = text(controller.controllerId ?? controller.id);
  const title = text(controller.title);
  if (!SAFE_ID.test(controllerId)) blockers.push(`${role}-controller-id-invalid`);
  if (!title) blockers.push(`${role}-controller-title-missing`);
  return freeze({
    controllerId,
    title,
    enabled: controller.enabled === true,
  });
}

function normalizeEstateItem(raw, index, blockers) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    blockers.push(`estate-item-${index}-invalid`);
    return null;
  }
  const itemId = text(raw.itemId);
  const kind = text(raw.kind).toUpperCase();
  const state = text(raw.state).toUpperCase();
  const canonicalOwner = text(raw.canonicalOwner);
  const repository = text(raw.repository);
  const branch = text(raw.branch);
  const headSha = text(raw.headSha).toLowerCase();
  const terminal = raw.terminal === true || TERMINAL_STATES.has(state);
  const activeLease = raw.activeLease === true;
  const writerOwner = text(raw.writerOwner);
  const apronState = text(raw.apronState).toUpperCase();

  if (!SAFE_ID.test(itemId)) blockers.push(`estate-item-${index}-id-invalid`);
  if (!kind) blockers.push(`${itemId || `estate-item-${index}`}-kind-missing`);
  if (!state) blockers.push(`${itemId || `estate-item-${index}`}-state-missing`);
  if (repository && !SAFE_REPOSITORY.test(repository)) blockers.push(`${itemId}-repository-invalid`);
  if (activeLease && !writerOwner) blockers.push(`${itemId}-active-lease-writer-missing`);
  if (apronState === 'OPERATOR_READY_PARKED' && raw.consumesBuilderCapacity !== false) {
    blockers.push(`${itemId}-parked-work-must-consume-zero-capacity`);
  }

  return freeze({
    itemId,
    kind,
    state,
    terminal,
    canonicalOwner,
    repository,
    branch,
    headSha,
    activeLease,
    writerOwner,
    apronState,
    consumesBuilderCapacity: raw.consumesBuilderCapacity === true,
    acceptanceCriteria: normalizedStrings(raw.acceptanceCriteria),
    continuationRules: normalizedStrings(raw.continuationRules),
    providerRequirements: normalizedStrings(raw.providerRequirements),
    authorityBoundary: normalizedStrings(raw.authorityBoundary),
    resourceScopes: normalizedStrings(raw.resourceScopes),
    proofRefs: normalizedStrings(raw.proofRefs),
  });
}

function normalizeMapping(raw, index, blockers) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    blockers.push(`mapping-${index}-invalid`);
    return null;
  }
  const itemId = text(raw.itemId);
  const successorControllerId = text(raw.successorControllerId);
  const successorOwner = text(raw.successorOwner);
  const writerOwner = text(raw.writerOwner);
  const apronState = text(raw.apronState).toUpperCase();
  if (!SAFE_ID.test(itemId)) blockers.push(`mapping-${index}-item-id-invalid`);
  if (!SAFE_ID.test(successorControllerId)) blockers.push(`${itemId || `mapping-${index}`}-successor-controller-invalid`);
  return freeze({
    itemId,
    successorControllerId,
    successorOwner,
    writerOwner,
    preserveCanonicalIdentity: raw.preserveCanonicalIdentity === true,
    preserveActiveLease: raw.preserveActiveLease === true,
    apronState,
    consumesBuilderCapacity: raw.consumesBuilderCapacity === true,
    acceptanceCriteria: normalizedStrings(raw.acceptanceCriteria),
    continuationRules: normalizedStrings(raw.continuationRules),
    providerRequirements: normalizedStrings(raw.providerRequirements),
    authorityBoundary: normalizedStrings(raw.authorityBoundary),
    resourceScopes: normalizedStrings(raw.resourceScopes),
  });
}

export function buildControllerEstateMigrationLedgerV1(input = {}) {
  const blockers = [];
  if (!boundedPlainData(input)) {
    return freeze({
      schemaVersion: CONTROLLER_ESTATE_MIGRATION_SCHEMA,
      migrationStatus: CONTROLLER_MIGRATION_STATUS.BLOCKED,
      retirementAllowed: false,
      blockers: ['migration-input-not-bounded-plain-data'],
      unmappedCount: 0,
      mappedCount: 0,
      terminalCount: 0,
      migrationId: null,
      items: [],
    });
  }

  const observedAtUtc = timestamp(input.observedAtUtc);
  if (!observedAtUtc) blockers.push('observed-at-invalid');
  const predecessor = normalizeController(input.predecessor, 'predecessor', blockers);
  const successor = normalizeController(input.successor, 'successor', blockers);
  if (predecessor && successor && predecessor.controllerId === successor.controllerId) {
    blockers.push('predecessor-successor-must-differ');
  }

  const estate = list(input.estate)
    .map((item, index) => normalizeEstateItem(item, index, blockers))
    .filter(Boolean);
  const mappings = list(input.mappings)
    .map((mapping, index) => normalizeMapping(mapping, index, blockers))
    .filter(Boolean);

  const estateIds = estate.map((item) => item.itemId);
  if (new Set(estateIds).size !== estateIds.length) blockers.push('duplicate-estate-item-id');

  const mappingsByItem = new Map();
  for (const mapping of mappings) {
    const existing = mappingsByItem.get(mapping.itemId) ?? [];
    existing.push(mapping);
    mappingsByItem.set(mapping.itemId, existing);
  }

  const itemResults = [];
  let mappedCount = 0;
  let terminalCount = 0;
  let unmappedCount = 0;

  for (const item of estate) {
    const itemBlockers = [];
    const itemMappings = mappingsByItem.get(item.itemId) ?? [];

    if (item.terminal) {
      terminalCount += 1;
      if (itemMappings.length > 1) itemBlockers.push('terminal-item-duplicate-mapping');
    } else if (itemMappings.length === 0) {
      unmappedCount += 1;
      itemBlockers.push('unfinished-item-unmapped');
    } else if (itemMappings.length > 1) {
      itemBlockers.push('duplicate-successor-ownership');
    }

    const mapping = itemMappings[0] ?? null;
    if (mapping && !item.terminal) {
      mappedCount += 1;
      if (!successor || mapping.successorControllerId !== successor.controllerId) {
        itemBlockers.push('wrong-successor-controller');
      }
      if (mapping.preserveCanonicalIdentity !== true) itemBlockers.push('canonical-identity-not-preserved');
      if (item.canonicalOwner && mapping.successorOwner !== item.canonicalOwner) {
        itemBlockers.push('canonical-owner-drift');
      }
      if (!includesAll(mapping.acceptanceCriteria, item.acceptanceCriteria)) {
        itemBlockers.push('acceptance-criteria-loss');
      }
      if (!includesAll(mapping.continuationRules, item.continuationRules)) {
        itemBlockers.push('continuation-rule-loss');
      }
      if (!includesAll(mapping.providerRequirements, item.providerRequirements)) {
        itemBlockers.push('provider-requirement-loss');
      }
      if (!includesAll(mapping.authorityBoundary, item.authorityBoundary)) {
        itemBlockers.push('authority-boundary-loss');
      }
      if (!includesAll(mapping.resourceScopes, item.resourceScopes)) {
        itemBlockers.push('resource-scope-loss');
      }
      if (item.activeLease) {
        if (!mapping.preserveActiveLease) itemBlockers.push('active-lease-not-preserved');
        if (mapping.writerOwner !== item.writerOwner) itemBlockers.push('active-writer-owner-drift');
      }
      if (item.apronState === 'OPERATOR_READY_PARKED') {
        if (mapping.apronState !== 'OPERATOR_READY_PARKED') itemBlockers.push('parked-state-loss');
        if (mapping.consumesBuilderCapacity !== false) itemBlockers.push('parked-capacity-regression');
      }
    }

    for (const reason of itemBlockers) blockers.push(`${item.itemId}:${reason}`);
    itemResults.push(freeze({
      itemId: item.itemId,
      kind: item.kind,
      state: item.state,
      terminal: item.terminal,
      mappingStatus: item.terminal
        ? 'TERMINAL_NO_SUCCESSOR_REQUIRED'
        : itemBlockers.length === 0
          ? 'MAPPED_LOSSLESSLY'
          : 'MAPPING_BLOCKED',
      successorControllerId: mapping?.successorControllerId ?? null,
      successorOwner: mapping?.successorOwner ?? null,
      blockers: itemBlockers,
    }));
  }

  for (const mapping of mappings) {
    if (!estateIds.includes(mapping.itemId)) blockers.push(`${mapping.itemId}:mapping-without-estate-item`);
  }

  const migrationStatus = blockers.length === 0
    ? CONTROLLER_MIGRATION_STATUS.READY
    : CONTROLLER_MIGRATION_STATUS.BLOCKED;
  const canonicalPayload = {
    schemaVersion: CONTROLLER_ESTATE_MIGRATION_SCHEMA,
    observedAtUtc,
    predecessorControllerId: predecessor?.controllerId ?? null,
    successorControllerId: successor?.controllerId ?? null,
    estateCount: estate.length,
    mappedCount,
    terminalCount,
    unmappedCount,
    items: itemResults,
  };

  return freeze({
    ...canonicalPayload,
    migrationStatus,
    retirementAllowed: blockers.length === 0,
    blockers: unique(blockers),
    migrationId: observedAtUtc ? `controller-migration:${stableDigest(canonicalPayload)}` : null,
  });
}

export function assessControllerRetirementV1(input = {}) {
  const blockers = [];
  const ledger = input.ledger;
  if (!ledger || ledger.schemaVersion !== CONTROLLER_ESTATE_MIGRATION_SCHEMA) {
    blockers.push('migration-ledger-invalid');
  } else {
    if (ledger.migrationStatus !== CONTROLLER_MIGRATION_STATUS.READY) blockers.push('migration-ledger-not-ready');
    if (ledger.retirementAllowed !== true) blockers.push('migration-ledger-denies-retirement');
    if (ledger.unmappedCount !== 0) blockers.push('migration-ledger-has-unmapped-items');
    if (!text(ledger.migrationId)) blockers.push('migration-ledger-id-missing');
  }
  if (input.successorEnabled !== true) blockers.push('successor-not-enabled');
  if (input.predecessorEnabled !== true) blockers.push('predecessor-not-active-at-retirement-gate');

  return freeze({
    schemaVersion: CONTROLLER_RETIREMENT_ASSESSMENT_SCHEMA,
    decision: blockers.length === 0 ? 'RETIREMENT_ALLOWED' : 'RETIREMENT_BLOCKED',
    disablePredecessorAllowed: blockers.length === 0,
    migrationId: ledger?.migrationId ?? null,
    blockers: unique(blockers),
  });
}

export function reconcilePostRetirementEstateV1(input = {}) {
  const blockers = [];
  const ledger = input.ledger;
  if (!ledger || ledger.schemaVersion !== CONTROLLER_ESTATE_MIGRATION_SCHEMA) {
    return freeze({
      schemaVersion: CONTROLLER_POST_RETIREMENT_RECONCILIATION_SCHEMA,
      reconciliationStatus: CONTROLLER_MIGRATION_STATUS.ORPHANED_REPAIR_REQUIRED,
      postRetirementProven: false,
      migrationId: null,
      expectedCount: 0,
      observedCount: 0,
      orphanedItemIds: [],
      blockers: ['migration-ledger-invalid'],
    });
  }

  const observedItems = new Map();
  for (const raw of list(input.successorInventory)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const itemId = text(raw.itemId);
    if (!itemId) continue;
    const existing = observedItems.get(itemId) ?? [];
    existing.push(raw);
    observedItems.set(itemId, existing);
  }

  const expected = list(ledger.items).filter((item) => item.terminal !== true);
  const orphanedItemIds = [];

  for (const item of expected) {
    const observed = observedItems.get(item.itemId) ?? [];
    if (observed.length === 0) {
      orphanedItemIds.push(item.itemId);
      blockers.push(`${item.itemId}:missing-from-successor-inventory`);
      continue;
    }
    if (observed.length > 1) {
      orphanedItemIds.push(item.itemId);
      blockers.push(`${item.itemId}:duplicate-successor-inventory`);
      continue;
    }
    const current = observed[0];
    const currentOwner = text(current.canonicalOwner);
    if (item.successorOwner && currentOwner !== item.successorOwner) {
      orphanedItemIds.push(item.itemId);
      blockers.push(`${item.itemId}:successor-owner-drift`);
    }
    const state = text(current.state).toUpperCase();
    const parked = PARKED_STATES.has(state) || current.apronState === 'OPERATOR_READY_PARKED';
    const terminal = current.terminal === true || TERMINAL_STATES.has(state);
    const selectable = current.selectable === true || current.buildable === true;
    const externallyBlocked = current.externalBlocker === true;
    if (!terminal && !parked && !selectable && !externallyBlocked) {
      orphanedItemIds.push(item.itemId);
      blockers.push(`${item.itemId}:not-selectable-buildable-parked-or-external`);
    }
  }

  const reconciliationStatus = blockers.length === 0
    ? CONTROLLER_MIGRATION_STATUS.POST_RETIREMENT_PROVEN
    : CONTROLLER_MIGRATION_STATUS.ORPHANED_REPAIR_REQUIRED;

  return freeze({
    schemaVersion: CONTROLLER_POST_RETIREMENT_RECONCILIATION_SCHEMA,
    reconciliationStatus,
    postRetirementProven: blockers.length === 0,
    migrationId: ledger.migrationId,
    expectedCount: expected.length,
    observedCount: observedItems.size,
    orphanedItemIds: unique(orphanedItemIds).sort(),
    blockers: unique(blockers),
  });
}

export function buildControllerRetirementSharedProjectionV1(input = {}) {
  const ledger = input.ledger;
  const reconciliation = input.reconciliation ?? null;
  return freeze({
    schemaVersion: CONTROLLER_RETIREMENT_SHARED_PROJECTION_SCHEMA,
    migrationId: ledger?.migrationId ?? null,
    predecessorControllerId: ledger?.predecessorControllerId ?? null,
    successorControllerId: ledger?.successorControllerId ?? null,
    migrationStatus: ledger?.migrationStatus ?? 'UNKNOWN',
    estateCount: ledger?.estateCount ?? 0,
    mappedCount: ledger?.mappedCount ?? 0,
    terminalCount: ledger?.terminalCount ?? 0,
    unmappedCount: ledger?.unmappedCount ?? 0,
    retirementAllowed: ledger?.retirementAllowed === true,
    postRetirementStatus: reconciliation?.reconciliationStatus ?? 'NOT_RUN',
    orphanedCount: list(reconciliation?.orphanedItemIds).length,
    migrationReceiptRequired: true,
    mutationAuthority: false,
    controllerDisableAuthority: false,
    sourceMutationAuthority: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
  });
}
