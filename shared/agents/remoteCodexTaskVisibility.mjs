import {
  appendWorkspaceJsonl,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import {
  VERIFICATION_STATUS,
  aggregateVerificationResults,
  createVerifierResult,
} from './verificationHarness.mjs';

export const REMOTE_CODEX_TASK_VISIBILITY_SCHEMA = 'stephanos.remote-codex-task-visibility.v1';
export const REMOTE_CODEX_TASK_VISIBILITY_KIND = 'stephanos.remote_codex.task_visibility';
export const REMOTE_CODEX_TASK_VISIBILITY_PARTICIPANT = 'codex-dispatch';
export const REMOTE_CODEX_HEARTBEAT_STALE_AFTER_MS = 60_000;

export const REMOTE_CODEX_VISIBILITY_STATES = Object.freeze({
  DISPATCHED: 'DISPATCHED',
  RUNNING_CURRENT: 'RUNNING_CURRENT',
  RUNNING_STALE: 'RUNNING_STALE',
  WORKER_EXITED_WITHOUT_RESULT: 'WORKER_EXITED_WITHOUT_RESULT',
  RESULT_READY: 'RESULT_READY',
  IDLE_OR_UNKNOWN: 'IDLE_OR_UNKNOWN',
});

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const SAFE_SHA = /^[a-f0-9]{7,64}$/i;
const FORBIDDEN_TEXT = /secret|token|password|credential|private key|\.env|cookie|session|node_modules|runtime-data/i;
const LOCAL_PATH_TEXT = /(?:[a-z]:\\|\\\\|\/(?:users|home|workspace|tmp)\/|appdata\\|documents\\github\\)/i;
const FINAL_TASK_STATUSES = new Set(['DONE', 'FAILED', 'BLOCKED']);
const ACTIVE_TASK_STATUSES = new Set(['DISPATCHED', 'CLAIMED', 'RUNNING', 'WAITING_PROOF']);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function boundedText(value, fallback = '', limit = 240) {
  const out = text(value, fallback);
  if (!out || FORBIDDEN_TEXT.test(out) || LOCAL_PATH_TEXT.test(out)) return fallback;
  return out.length > limit ? `${out.slice(0, limit)}...` : out;
}

function safeId(value, fallback = '') {
  const normalized = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 81);
  return SAFE_ID.test(normalized) ? normalized : fallback;
}

function safeSha(value) {
  const out = text(value);
  return SAFE_SHA.test(out) ? out.toLowerCase() : '';
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function safeProofRefs(value, fallback = []) {
  const refs = Array.isArray(value) ? value : fallback;
  return [...new Set(refs.map(String).map((item) => item.trim()).filter((item) => (
    /^(proof|proofs|receipts|evidence\/receipts)\/[a-z0-9._/-]+$/i.test(item)
    && !item.split('/').includes('..')
  )))];
}

export function extractCodexThreadId(events = []) {
  const event = Array.isArray(events)
    ? events.find((item) => item?.type === 'thread.started' && (item.thread_id || item.threadId || item.id))
    : null;
  return safeId(event?.thread_id || event?.threadId || event?.id, '');
}

export function classifyRemoteCodexTaskVisibility(input = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const staleAfterMs = Number.isFinite(options.staleAfterMs)
    ? options.staleAfterMs
    : REMOTE_CODEX_HEARTBEAT_STALE_AFTER_MS;
  const taskStatus = text(input.status, 'UNKNOWN').toUpperCase();
  const resultAvailable = input.resultAvailable === true || FINAL_TASK_STATUSES.has(taskStatus);
  const heartbeatMs = timestampMs(input.heartbeatUtc || input.lastHeartbeatUtc || input.startedAt || input.createdAt);
  const heartbeatAgeMs = Number.isFinite(heartbeatMs) ? Math.max(0, nowMs - heartbeatMs) : null;

  let state = REMOTE_CODEX_VISIBILITY_STATES.IDLE_OR_UNKNOWN;
  if (resultAvailable) state = REMOTE_CODEX_VISIBILITY_STATES.RESULT_READY;
  else if (taskStatus === 'RUNNING' && input.workerAlive === false) state = REMOTE_CODEX_VISIBILITY_STATES.WORKER_EXITED_WITHOUT_RESULT;
  else if (taskStatus === 'RUNNING') {
    state = heartbeatAgeMs !== null && heartbeatAgeMs <= staleAfterMs
      ? REMOTE_CODEX_VISIBILITY_STATES.RUNNING_CURRENT
      : REMOTE_CODEX_VISIBILITY_STATES.RUNNING_STALE;
  } else if (ACTIVE_TASK_STATUSES.has(taskStatus)) state = REMOTE_CODEX_VISIBILITY_STATES.DISPATCHED;

  return Object.freeze({
    state,
    taskStatus,
    resultAvailable,
    heartbeatAgeMs,
    heartbeatFresh: state === REMOTE_CODEX_VISIBILITY_STATES.RUNNING_CURRENT,
    staleAfterMs,
  });
}

function defaultNextAction(state) {
  if (state === REMOTE_CODEX_VISIBILITY_STATES.RUNNING_CURRENT) return 'Continue monitoring the current Remote Codex task.';
  if (state === REMOTE_CODEX_VISIBILITY_STATES.RUNNING_STALE) return 'Check the guarded worker and publish a fresh heartbeat or truthful blocker.';
  if (state === REMOTE_CODEX_VISIBILITY_STATES.WORKER_EXITED_WITHOUT_RESULT) return 'Recover the positively identified worker and preserve the incomplete task evidence.';
  if (state === REMOTE_CODEX_VISIBILITY_STATES.RESULT_READY) return 'Read the structured result and advance the owning goal only from verified evidence.';
  if (state === REMOTE_CODEX_VISIBILITY_STATES.DISPATCHED) return 'Wait for the worker to claim the task and publish its first heartbeat.';
  return 'No active Remote Codex task is currently proven.';
}

function defaultBlocker(state) {
  if (state === REMOTE_CODEX_VISIBILITY_STATES.RUNNING_STALE) return 'REMOTE_CODEX_HEARTBEAT_STALE';
  if (state === REMOTE_CODEX_VISIBILITY_STATES.WORKER_EXITED_WITHOUT_RESULT) return 'REMOTE_CODEX_WORKER_EXITED_WITHOUT_RESULT';
  return '';
}

export function createRemoteCodexTaskVisibilitySlice(input = {}, options = {}) {
  const classification = classifyRemoteCodexTaskVisibility(input, options);
  const timestampUtc = text(input.timestampUtc || input.heartbeatUtc || input.completedAt || input.startedAt, new Date(0).toISOString());
  const jobId = safeId(input.jobId || input.taskId, 'remote-codex-current');
  const taskId = safeId(input.taskId || input.jobId, jobId);
  const issueNumber = Number.parseInt(input.issueNumber, 10);
  const relatedIssue = Number.isSafeInteger(issueNumber) && issueNumber > 0 ? `#${issueNumber}` : '#1506';
  const codexThreadId = safeId(input.codexThreadId || extractCodexThreadId(input.events), '');
  const resultVerdict = boundedText(input.resultVerdict || input.verdict, classification.resultAvailable ? 'UNKNOWN' : 'NOT_READY', 40).toUpperCase();
  const proofRefs = safeProofRefs(input.proofRefs, [
    `proof/remote-codex-${jobId}.json`,
    `receipts/${jobId}.json`,
  ]);
  const blocker = boundedText(input.blocker || defaultBlocker(classification.state), '', 120);
  const nextAction = boundedText(input.nextAction || input.nextOperatorAction || defaultNextAction(classification.state), defaultNextAction(classification.state), 240);
  const sourceHead = safeSha(input.sourceHead || input.sourceHeadAfter || input.sourceHeadBefore || input.remoteHead);
  const summary = boundedText(
    input.summary,
    `Remote Codex task ${jobId} is ${classification.state}.`,
    240,
  );

  return Object.freeze({
    schemaVersion: REMOTE_CODEX_TASK_VISIBILITY_SCHEMA,
    kind: REMOTE_CODEX_TASK_VISIBILITY_KIND,
    recordId: 'remote-codex-current',
    participantId: REMOTE_CODEX_TASK_VISIBILITY_PARTICIPANT,
    timestampUtc,
    correlationId: jobId,
    relatedIssue,
    jobId,
    taskId,
    codexThreadId,
    taskStatus: classification.taskStatus,
    state: classification.state,
    workerAlive: input.workerAlive === true ? true : (input.workerAlive === false ? false : null),
    heartbeatUtc: text(input.heartbeatUtc || input.lastHeartbeatUtc || input.startedAt, ''),
    heartbeatAgeMs: classification.heartbeatAgeMs,
    heartbeatFresh: classification.heartbeatFresh,
    resultAvailable: classification.resultAvailable,
    resultVerdict,
    sourceHead,
    blocker,
    nextAction,
    summary,
    proofRefs,
    arbitraryFilesystemAccess: false,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    finalVerdict: classification.state === REMOTE_CODEX_VISIBILITY_STATES.RUNNING_CURRENT
      || classification.state === REMOTE_CODEX_VISIBILITY_STATES.RESULT_READY
      ? 'REMOTE_CODEX_VISIBILITY_CURRENT'
      : 'REMOTE_CODEX_VISIBILITY_ATTENTION_REQUIRED',
  });
}

export function createRemoteCodexVisibilityWorkspaceRecords(sliceInput = {}, options = {}) {
  const slice = sliceInput?.kind === REMOTE_CODEX_TASK_VISIBILITY_KIND
    ? sliceInput
    : createRemoteCodexTaskVisibilitySlice(sliceInput, options);
  const common = {
    jobId: slice.jobId,
    taskId: slice.taskId,
    codexThreadId: slice.codexThreadId,
    taskStatus: slice.taskStatus,
    taskState: slice.state,
    workerAlive: slice.workerAlive,
    heartbeatUtc: slice.heartbeatUtc,
    heartbeatAgeMs: slice.heartbeatAgeMs,
    heartbeatFresh: slice.heartbeatFresh,
    resultAvailable: slice.resultAvailable,
    resultVerdict: slice.resultVerdict,
    sourceHead: slice.sourceHead,
    blocker: slice.blocker,
    nextAction: slice.nextAction,
    correlationId: slice.correlationId,
    relatedIssue: slice.relatedIssue,
  };
  const statusRecord = Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: 'remote-codex-current',
      participantId: slice.participantId,
      timestampUtc: slice.timestampUtc,
      status: slice.state,
      summary: slice.summary,
      proofRefs: slice.proofRefs,
    }),
    ...common,
  });
  const proofRecord = Object.freeze({
    ...createSharedWorkspaceProofRecord({
      proofId: `remote-codex-${slice.jobId}`,
      participantId: slice.participantId,
      timestampUtc: slice.timestampUtc,
      correlationId: slice.correlationId,
      relatedIssue: slice.relatedIssue,
      status: slice.state,
      summary: slice.nextAction,
      refs: slice.proofRefs,
      proofRefs: slice.proofRefs,
    }),
    ...common,
  });
  const eventRecord = Object.freeze({
    ...createSharedWorkspaceEventRecord({
      eventId: `remote-codex-${slice.jobId}-${safeId(slice.state, 'state')}`,
      participantId: slice.participantId,
      timestampUtc: slice.timestampUtc,
      eventKind: 'remote-codex-task-visibility',
      summary: slice.summary,
    }),
    ...common,
    proofRefs: slice.proofRefs,
  });
  return Object.freeze({ slice, statusRecord, proofRecord, eventRecord });
}

export function verifyRemoteCodexTaskVisibility(sliceInput = {}, options = {}) {
  const records = createRemoteCodexVisibilityWorkspaceRecords(sliceInput, options);
  const checks = ['statusRecord', 'proofRecord', 'eventRecord'].map((name) => {
    const validation = validateSharedWorkspaceRecord(records[name], options);
    return createVerifierResult({
      checkId: `remote-codex-visibility-${name}`,
      verifierType: 'WorkspaceRecordVerifier',
      status: validation.valid ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.BLOCKED,
      target: 'shared-agent-workspace',
      evidence: [`record=${name}`, `valid=${validation.valid}`, `errors=${validation.errors.join('|') || 'none'}`],
      reason: validation.valid ? '' : validation.errors[0],
      timestampUtc: options.timestampUtc || records.slice.timestampUtc,
      finalVerdict: validation.valid ? 'REMOTE_CODEX_VISIBILITY_RECORD_PASS' : 'REMOTE_CODEX_VISIBILITY_RECORD_BLOCKED',
      proofRefs: records[name].proofRefs || [],
    });
  });
  return aggregateVerificationResults({
    aggregateId: 'remote-codex-task-visibility',
    checks,
    timestampUtc: options.timestampUtc || records.slice.timestampUtc,
  });
}

export async function publishRemoteCodexTaskVisibility(root, sliceInput = {}, options = {}) {
  const records = createRemoteCodexVisibilityWorkspaceRecords(sliceInput, options);
  const verification = verifyRemoteCodexTaskVisibility(records.slice, options);
  if (verification.status === VERIFICATION_STATUS.FAIL || verification.status === VERIFICATION_STATUS.BLOCKED) {
    return { ok: false, reason: verification.reason || 'REMOTE_CODEX_VISIBILITY_VERIFICATION_BLOCKED', ...records, verification };
  }
  const layout = await ensureSharedWorkspaceLayout({ root, repoRoot: options.repoRoot });
  if (!layout.ok) return { ok: false, reason: layout.reason, ...records, verification };
  const writes = [
    await writeAtomicJson(layout.root, ['status', 'remote-codex-current.json'], records.statusRecord, options),
    await writeAtomicJson(layout.root, ['proof', `remote-codex-${records.slice.jobId}.json`], records.proofRecord, options),
    await appendWorkspaceJsonl(layout.root, ['events', 'remote-codex-task-visibility.jsonl'], records.eventRecord, options),
  ];
  const failed = writes.find((write) => !write.ok);
  if (failed) return { ok: false, reason: failed.reason, ...records, verification, writes };
  return { ok: true, reason: 'REMOTE_CODEX_TASK_VISIBILITY_PUBLISHED', ...records, verification, writes };
}

export function renderRemoteCodexGitHubMirrorComment(sliceInput = {}, options = {}) {
  const slice = sliceInput?.kind === REMOTE_CODEX_TASK_VISIBILITY_KIND
    ? sliceInput
    : createRemoteCodexTaskVisibilitySlice(sliceInput, options);
  const value = (input, fallback = 'unknown') => boundedText(input, fallback, 240).replace(/[\r\n`]/g, ' ');
  return [
    '<!-- stephanos-remote-codex-task-visibility-v1 -->',
    '## Remote Codex task visibility',
    '',
    '```text',
    `REMOTE_CODEX_ACTIVE=${slice.state === REMOTE_CODEX_VISIBILITY_STATES.RUNNING_CURRENT}`,
    `JOB_ID=${value(slice.jobId)}`,
    `TASK_ID=${value(slice.taskId)}`,
    `CODEX_THREAD_ID=${value(slice.codexThreadId, 'not-observed')}`,
    `STATE=${value(slice.state)}`,
    `LAST_HEARTBEAT_UTC=${value(slice.heartbeatUtc, 'not-observed')}`,
    `HEARTBEAT_FRESH=${slice.heartbeatFresh}`,
    `RESULT_AVAILABLE=${slice.resultAvailable}`,
    `RESULT_VERDICT=${value(slice.resultVerdict)}`,
    `SOURCE_HEAD=${value(slice.sourceHead, 'not-observed')}`,
    `BLOCKER=${value(slice.blocker, 'none')}`,
    `NEXT_ACTION=${value(slice.nextAction)}`,
    `PROOF_REFS=${slice.proofRefs.map(value).join(',') || 'none'}`,
    '```',
    '',
    '_Sanitized mirror only. The Shared Workspace remains authoritative._',
  ].join('\n');
}
