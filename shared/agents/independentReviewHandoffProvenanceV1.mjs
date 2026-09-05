export const INDEPENDENT_REVIEW_HANDOFF_PROVENANCE_SCHEMA = 'stephanos.independent-review-handoff-provenance.v1';
export const INDEPENDENT_REVIEW_HANDOFF_PROVENANCE_MARKER = 'stephanos:exact-head-review-handoff-provenance:v1';
export const CANONICAL_COORDINATOR_WORKFLOW_ID = 316253381;
export const CANONICAL_COORDINATOR_WORKFLOW_NAME = 'Exact-Head Review Dispatch';
export const CANONICAL_COORDINATOR_WORKFLOW_PATH = '.github/workflows/exact-head-review-dispatch.yml';
export const CANONICAL_COORDINATOR_JOB = 'coordinate';

const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ALLOWED_COORDINATOR_EVENTS = new Set([
  'issue_comment',
  'workflow_run',
  'schedule',
  'workflow_dispatch',
]);
const PROVENANCE_KEYS = Object.freeze([
  'schemaVersion',
  'coordinatorWorkflowId',
  'coordinatorWorkflowName',
  'coordinatorWorkflowPath',
  'coordinatorWorkflowRunId',
  'coordinatorWorkflowRunAttempt',
  'coordinatorEvent',
  'coordinatorRepository',
  'coordinatorSourceSha',
  'coordinatorWorkflowRef',
  'coordinatorJobIdentity',
  'handoffCommentId',
]);

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function isPlainRecord(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value, keys) {
  if (!isPlainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function sha(value) {
  const normalized = text(value).toLowerCase();
  return FULL_SHA.test(normalized) ? normalized : '';
}

function freezeProvenance(value) {
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    coordinatorWorkflowId: value.coordinatorWorkflowId,
    coordinatorWorkflowName: value.coordinatorWorkflowName,
    coordinatorWorkflowPath: value.coordinatorWorkflowPath,
    coordinatorWorkflowRunId: value.coordinatorWorkflowRunId,
    coordinatorWorkflowRunAttempt: value.coordinatorWorkflowRunAttempt,
    coordinatorEvent: value.coordinatorEvent,
    coordinatorRepository: value.coordinatorRepository,
    coordinatorSourceSha: value.coordinatorSourceSha,
    coordinatorWorkflowRef: value.coordinatorWorkflowRef,
    coordinatorJobIdentity: value.coordinatorJobIdentity,
    handoffCommentId: value.handoffCommentId,
  });
}

export function validateIndependentReviewHandoffProvenanceV1(
  value,
  { repository = '', currentMainSha = '', handoffCommentId = 0 } = {},
) {
  if (!hasExactKeys(value, PROVENANCE_KEYS)) {
    throw new Error('coordinator handoff provenance must use the exact closed-world schema');
  }
  const normalizedRepository = text(value.coordinatorRepository);
  const normalizedSourceSha = sha(value.coordinatorSourceSha);
  const expectedRepository = text(repository);
  const expectedMainSha = currentMainSha ? sha(currentMainSha) : '';
  const expectedCommentId = handoffCommentId ? positiveInteger(handoffCommentId) : 0;
  const expectedWorkflowRef = `${normalizedRepository}/${CANONICAL_COORDINATOR_WORKFLOW_PATH}@refs/heads/main`;

  if (text(value.schemaVersion) !== INDEPENDENT_REVIEW_HANDOFF_PROVENANCE_SCHEMA
    || positiveInteger(value.coordinatorWorkflowId) !== CANONICAL_COORDINATOR_WORKFLOW_ID
    || text(value.coordinatorWorkflowName) !== CANONICAL_COORDINATOR_WORKFLOW_NAME
    || text(value.coordinatorWorkflowPath) !== CANONICAL_COORDINATOR_WORKFLOW_PATH
    || !positiveInteger(value.coordinatorWorkflowRunId)
    || !positiveInteger(value.coordinatorWorkflowRunAttempt)
    || !ALLOWED_COORDINATOR_EVENTS.has(text(value.coordinatorEvent))
    || !SAFE_REPOSITORY.test(normalizedRepository)
    || !normalizedSourceSha
    || text(value.coordinatorWorkflowRef) !== expectedWorkflowRef
    || text(value.coordinatorJobIdentity) !== CANONICAL_COORDINATOR_JOB
    || !positiveInteger(value.handoffCommentId)) {
    throw new Error('coordinator handoff provenance is incomplete or not canonical');
  }
  if (expectedRepository && normalizedRepository !== expectedRepository) {
    throw new Error('coordinator handoff provenance repository mismatch');
  }
  if (currentMainSha && (!expectedMainSha || normalizedSourceSha !== expectedMainSha)) {
    throw new Error('coordinator handoff provenance source is not exact current main');
  }
  if (handoffCommentId && (!expectedCommentId || positiveInteger(value.handoffCommentId) !== expectedCommentId)) {
    throw new Error('coordinator handoff provenance comment id mismatch');
  }

  return freezeProvenance({
    schemaVersion: INDEPENDENT_REVIEW_HANDOFF_PROVENANCE_SCHEMA,
    coordinatorWorkflowId: CANONICAL_COORDINATOR_WORKFLOW_ID,
    coordinatorWorkflowName: CANONICAL_COORDINATOR_WORKFLOW_NAME,
    coordinatorWorkflowPath: CANONICAL_COORDINATOR_WORKFLOW_PATH,
    coordinatorWorkflowRunId: positiveInteger(value.coordinatorWorkflowRunId),
    coordinatorWorkflowRunAttempt: positiveInteger(value.coordinatorWorkflowRunAttempt),
    coordinatorEvent: text(value.coordinatorEvent),
    coordinatorRepository: normalizedRepository,
    coordinatorSourceSha: normalizedSourceSha,
    coordinatorWorkflowRef: expectedWorkflowRef,
    coordinatorJobIdentity: CANONICAL_COORDINATOR_JOB,
    handoffCommentId: positiveInteger(value.handoffCommentId),
  });
}

export function buildIndependentReviewHandoffProvenanceV1({
  repository,
  currentMainSha,
  workflowRun,
  workflowRef,
  jobIdentity,
  handoffCommentId,
} = {}) {
  if (!isPlainRecord(workflowRun)) {
    throw new Error('exact coordinator workflow run is required');
  }
  const value = {
    schemaVersion: INDEPENDENT_REVIEW_HANDOFF_PROVENANCE_SCHEMA,
    coordinatorWorkflowId: positiveInteger(workflowRun.workflow_id),
    coordinatorWorkflowName: text(workflowRun.name),
    coordinatorWorkflowPath: text(workflowRun.path),
    coordinatorWorkflowRunId: positiveInteger(workflowRun.id),
    coordinatorWorkflowRunAttempt: positiveInteger(workflowRun.run_attempt),
    coordinatorEvent: text(workflowRun.event),
    coordinatorRepository: text(workflowRun?.repository?.full_name),
    coordinatorSourceSha: sha(workflowRun.head_sha),
    coordinatorWorkflowRef: text(workflowRef),
    coordinatorJobIdentity: text(jobIdentity),
    handoffCommentId: positiveInteger(handoffCommentId),
  };
  return validateIndependentReviewHandoffProvenanceV1(value, {
    repository,
    currentMainSha,
    handoffCommentId,
  });
}

export function independentReviewHandoffProvenanceMarkerV1() {
  return `<!-- ${INDEPENDENT_REVIEW_HANDOFF_PROVENANCE_MARKER} -->`;
}

export function appendIndependentReviewHandoffProvenanceV1(body, provenance) {
  const normalizedBody = text(body);
  const validated = validateIndependentReviewHandoffProvenanceV1(provenance);
  const marker = independentReviewHandoffProvenanceMarkerV1();
  if (!normalizedBody) throw new Error('review handoff body is required');
  if (normalizedBody.includes(marker)) throw new Error('review handoff provenance already exists');
  return `${normalizedBody}\n\n${marker}\n\`\`\`json\n${JSON.stringify(validated, null, 2)}\n\`\`\``;
}

export function parseIndependentReviewHandoffProvenanceV1(body, expected = {}) {
  const normalizedBody = text(body);
  const marker = independentReviewHandoffProvenanceMarkerV1();
  const markerIndex = normalizedBody.indexOf(marker);
  if (markerIndex < 0) throw new Error('coordinator handoff provenance marker is missing');
  if (normalizedBody.indexOf(marker, markerIndex + marker.length) >= 0) {
    throw new Error('coordinator handoff provenance marker is duplicated');
  }
  const tail = normalizedBody.slice(markerIndex + marker.length);
  const matches = [...tail.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (matches.length !== 1) {
    throw new Error('coordinator handoff provenance must contain exactly one JSON object');
  }
  let parsed;
  try {
    parsed = JSON.parse(matches[0][1]);
  } catch {
    throw new Error('coordinator handoff provenance JSON is malformed');
  }
  return validateIndependentReviewHandoffProvenanceV1(parsed, expected);
}
