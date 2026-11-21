import {
  STEPHANOS_MEMORY_AUTHORITY_CLASS,
  STEPHANOS_MEMORY_CONNECTION_STATE,
} from '../runtime/stephanosMemoryAdequacy.mjs';
import { PROGRAMME_AUTHORITY_COMPONENTS } from './programmeAuthorityV1.mjs';

export const STEPHANOS_MEMORY_ADEQUACY_INPUT_SCHEMA_VERSION = 'stephanos.memory-adequacy-inputs.v1';

const MAX_MEMORY_RECORDS = 50_000;
const MAX_COMPONENTS = 1_000;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipt|receipts|evidence|github|shared-workspace|runtime|memory)\/[a-z0-9._/#:-]+$/i;
const EXACT_HEAD = /^[a-f0-9]{40}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const SHARED_WORKSPACE_RECEIPT_SCHEMA = 'stephanos.battle-bridge-github-command-receipt.v1';
const SHARED_WORKSPACE_STATUS_OPERATION = 'READ_SHARED_WORKSPACE_STATUS';
const SHARED_WORKSPACE_RECEIPT_SOURCE = 'battle-bridge-read-shared-workspace-status';

function text(value, maximum = 240) {
  return String(value ?? '').trim().slice(0, maximum);
}

function iso(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeProofRefs(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => text(item)).filter((item) => (
      SAFE_PROOF_REF.test(item) && !item.includes('..')
    )))].slice(0, 32)
    : [];
}

function recordDomain(record = {}) {
  const tags = new Set(Array.isArray(record.tags) ? record.tags.map((tag) => text(tag, 80).toLowerCase()) : []);
  const type = text(record.type, 80).toLowerCase();
  if ([...tags].some((tag) => /lesson|incident|failure|repair|postmortem/.test(tag))) return 'lessons-incident-memory';
  if ([...tags].some((tag) => /goal|decision|approval|priority/.test(tag))) return 'goal-decision-memory';
  if ([...tags].some((tag) => /architecture|component|machinery|continuity|project/.test(tag))) return 'project-architecture-memory';
  if (type === 'operator.preference') return 'operator-memory';
  if (type === 'operator.goal' || type === 'ai.decision') return 'goal-decision-memory';
  if (type === 'continuity.note' || type === 'workspace.state' || type === 'ai.summary') return 'project-architecture-memory';
  if (['route.diagnostic', 'truth.contradiction', 'law.violation'].includes(type)) return 'lessons-incident-memory';
  if (['tile.event', 'tile.result', 'simulation.result'].includes(type)) return 'runtime-proof-memory';
  return 'session-memory';
}

function indexableRecord(record = {}) {
  const required = [record.namespace, record.id, record.type, record.source, record.updatedAt];
  const present = required.filter((value) => text(value)).length;
  const tagsObserved = Array.isArray(record.tags) ? 1 : 0;
  return (present + tagsObserved) / 6;
}

function approximateBytes(records) {
  return Buffer.byteLength(JSON.stringify(records.map((record) => ({
    namespace: text(record.namespace, 80),
    id: text(record.id, 160),
    type: text(record.type, 80),
    source: text(record.source, 160),
    scope: text(record.scope, 120),
    tags: Array.isArray(record.tags) ? record.tags.map((tag) => text(tag, 80)).slice(0, 32) : [],
    importance: text(record.importance, 40),
    retentionHint: text(record.retentionHint, 80),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }))), 'utf8');
}

function memoryAuthorityClass(diagnostics = {}) {
  const pendingIntentCount = Number.isSafeInteger(diagnostics.pendingIntentCount)
    ? diagnostics.pendingIntentCount
    : 0;
  if (pendingIntentCount > 0) return STEPHANOS_MEMORY_AUTHORITY_CLASS.PENDING_LOCAL_INTENT;
  const sharedReady = diagnostics.stateClass === 'shared-durable-truth'
    && diagnostics.hydrationCompleted === true
    && diagnostics.hydrationState === 'ready'
    && diagnostics.sourceUsedOnLoad === 'shared-backend'
    && !text(diagnostics.fallbackReason);
  return sharedReady
    ? STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY
    : STEPHANOS_MEMORY_AUTHORITY_CLASS.LOCAL_MIRROR;
}

function lifecycleState(value, allowed, fallback = 'UNKNOWN') {
  const normalized = text(value, 40).toUpperCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function buildMemoryObservations({ records = [], diagnostics = {}, observedAtUtc, lifecycleProof = {} }, blockers) {
  if (!Array.isArray(records)) {
    blockers.push('memory-records-not-array');
    return [];
  }
  if (records.length > MAX_MEMORY_RECORDS) {
    blockers.push('memory-record-count-exceeds-bound');
    return [];
  }
  if (!plainObject(diagnostics)) blockers.push('memory-diagnostics-not-object');
  const validRecords = records.filter(plainObject);
  if (validRecords.length !== records.length) blockers.push('memory-record-not-object');
  const byDomain = new Map();
  for (const record of validRecords) {
    const domain = recordDomain(record);
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(record);
  }
  const authorityClass = memoryAuthorityClass(diagnostics);
  const deletionState = lifecycleState(lifecycleProof.deletionState, new Set(['PROVEN', 'PARTIAL', 'BLOCKED', 'UNKNOWN']));
  const conflictState = lifecycleState(lifecycleProof.conflictState, new Set(['CONVERGED', 'PENDING', 'BLOCKED', 'UNKNOWN']));
  const backupState = lifecycleState(lifecycleProof.backupState, new Set(['PROVEN', 'PARTIAL', 'BLOCKED', 'UNKNOWN']));
  const proofRefs = safeProofRefs([
    'memory/stephanos-memory-diagnostics',
    ...(lifecycleProof.proofRefs || []),
  ]);
  return [...byDomain.entries()].map(([domain, domainRecords]) => {
    const coverage = domainRecords.length
      ? domainRecords.reduce((total, record) => total + indexableRecord(record), 0) / domainRecords.length
      : 0;
    const retentionDeclared = domainRecords.length > 0
      && domainRecords.every((record) => Boolean(text(record.retentionHint)));
    return Object.freeze({
      domain,
      authorityClass,
      recordCount: domainRecords.length,
      approximateBytes: approximateBytes(domainRecords),
      observedAtUtc,
      source: text(diagnostics.sourceUsedOnLoad || diagnostics.stateClass || 'stephanos-memory-diagnostics', 160),
      retrievalCoverage: Math.round(coverage * 10_000) / 10_000,
      retentionPolicy: lifecycleProof.retentionEnforced === true
        ? 'ENFORCED'
        : (retentionDeclared ? 'DECLARED' : 'UNKNOWN'),
      deletionState,
      conflictState,
      backupState,
      proofRefs,
    });
  });
}

function buildProgrammeObservation({ programmeComponents, observedAtUtc }, blockers) {
  const components = programmeComponents ?? PROGRAMME_AUTHORITY_COMPONENTS;
  if (!Array.isArray(components)) {
    blockers.push('programme-components-not-array');
    return null;
  }
  if (components.length > MAX_COMPONENTS) {
    blockers.push('programme-component-count-exceeds-bound');
    return null;
  }
  const safeComponents = components.filter((component) => (
    plainObject(component) && text(component.componentId, 120) && text(component.source, 240)
  ));
  if (safeComponents.length !== components.length) blockers.push('programme-component-invalid');
  if (!safeComponents.length) return null;
  return Object.freeze({
    domain: 'project-architecture-memory',
    authorityClass: STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY,
    recordCount: safeComponents.length,
    approximateBytes: Buffer.byteLength(JSON.stringify(safeComponents.map((component) => ({
      componentId: text(component.componentId, 120),
      source: text(component.source, 240),
      ownership: text(component.ownership, 120),
      reuse: component.reuse === true,
    }))), 'utf8'),
    observedAtUtc,
    source: 'github-programme-authority-source-inventory',
    retrievalCoverage: 1,
    retentionPolicy: 'DECLARED',
    deletionState: 'UNKNOWN',
    conflictState: 'CONVERGED',
    backupState: 'PARTIAL',
    proofRefs: Object.freeze(['github/programme-authority/components']),
  });
}

function emptySharedWorkspaceConnection({
  observed = false,
  observedAtUtc = '',
  source = '',
  proofRefs = [],
} = {}) {
  return Object.freeze({
    state: STEPHANOS_MEMORY_CONNECTION_STATE.UNKNOWN,
    observed,
    observedAtUtc,
    source,
    proofRefs: Object.freeze(proofRefs),
  });
}

function buildSharedWorkspaceConnection(status, blockers) {
  if (status === undefined || status === null) return emptySharedWorkspaceConnection();
  if (!plainObject(status)) {
    blockers.push('shared-workspace-status-receipt-invalid');
    return emptySharedWorkspaceConnection({ observed: true });
  }

  const execution = plainObject(status.execution) ? status.execution : {};
  const operationResult = plainObject(status.operationResult) ? status.operationResult : {};
  const completedAtUtc = iso(status.completedAt);
  const expectedHead = text(status.expectedHead, 40).toLowerCase();
  const sourceHead = text(operationResult.sourceHead, 40).toLowerCase();
  const proofRefs = safeProofRefs(status.proofRefs);
  const validReceipt = status.schemaVersion === SHARED_WORKSPACE_RECEIPT_SCHEMA
    && SAFE_REQUEST_ID.test(text(status.requestId, 160))
    && text(status.operation, 120) === SHARED_WORKSPACE_STATUS_OPERATION
    && text(status.state, 40).toUpperCase() === 'DONE'
    && execution.ok === true
    && operationResult.ok === true
    && text(operationResult.finalVerdict, 160).toUpperCase() === 'SHARED_WORKSPACE_STATUS_READY'
    && text(operationResult.branch, 80) === 'main'
    && operationResult.expectedHeadMatch === true
    && Boolean(completedAtUtc)
    && EXACT_HEAD.test(expectedHead)
    && EXACT_HEAD.test(sourceHead)
    && expectedHead === sourceHead
    && !text(status.blocker)
    && !text(operationResult.blocker)
    && proofRefs.length > 0;

  if (!validReceipt) {
    blockers.push('shared-workspace-status-receipt-invalid');
    return emptySharedWorkspaceConnection({
      observed: true,
      observedAtUtc: completedAtUtc,
      source: SHARED_WORKSPACE_RECEIPT_SOURCE,
      proofRefs,
    });
  }

  return Object.freeze({
    state: STEPHANOS_MEMORY_CONNECTION_STATE.CONNECTED,
    observed: true,
    observedAtUtc: completedAtUtc,
    source: SHARED_WORKSPACE_RECEIPT_SOURCE,
    proofRefs: Object.freeze(proofRefs),
  });
}

export function buildStephanosMemoryAdequacyInputs(input = {}) {
  const blockers = [];
  const observedAtUtc = iso(input.observedAtUtc || new Date().toISOString());
  if (!observedAtUtc) blockers.push('invalid-observed-time');
  const safeObservedAtUtc = observedAtUtc || new Date(0).toISOString();
  const observations = [
    ...buildMemoryObservations({
      records: input.memoryRecords || [],
      diagnostics: input.memoryDiagnostics || {},
      lifecycleProof: input.memoryLifecycleProof || {},
      observedAtUtc: safeObservedAtUtc,
    }, blockers),
  ];
  const programmeObservation = buildProgrammeObservation({
    programmeComponents: input.programmeComponents,
    observedAtUtc: safeObservedAtUtc,
  }, blockers);
  if (programmeObservation) observations.push(programmeObservation);
  const sharedWorkspaceConnection = buildSharedWorkspaceConnection(
    input.sharedWorkspaceStatus,
    blockers,
  );
  return Object.freeze({
    schemaVersion: STEPHANOS_MEMORY_ADEQUACY_INPUT_SCHEMA_VERSION,
    kind: 'stephanos.memory_adequacy.inputs',
    readOnly: true,
    mutationAuthority: false,
    valid: blockers.length === 0,
    observations: Object.freeze(observations),
    sharedWorkspaceConnection,
    blockers: Object.freeze([...new Set(blockers)]),
    finalVerdict: blockers.length
      ? 'STEPHANOS_MEMORY_ADEQUACY_INPUTS_BLOCKED'
      : 'STEPHANOS_MEMORY_ADEQUACY_INPUTS_READY',
  });
}
