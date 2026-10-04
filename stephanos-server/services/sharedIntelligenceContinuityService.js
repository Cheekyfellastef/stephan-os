import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createStephanosSharedConversationTurnRecord,
  buildStephanosSharedConversationThread,
} from '../../shared/agents/stephanosSharedConversationThreadV1.mjs';
import { buildStephanosOperatorKnowledgeTwinV1 } from '../../shared/agents/stephanosOperatorKnowledgeTwinV1.mjs';
import { buildStephanosAuthorisedChatHistoryIngestV1 } from '../../shared/agents/stephanosAuthorisedChatHistoryIngestV1.mjs';
import { adjudicateMemoryCandidate } from './memory/memoryAdjudicator.js';
import { durableMemoryStore } from './memory/memoryStore.js';
import {
  STEPHANOS_PRIMARY_SHARED_CONVERSATION_THREAD_ID,
  buildStephanosSharedThreadConversationCanvasV1,
} from '../../shared/agents/stephanosSharedThreadConversationCanvasV1.mjs';
import {
  resolveSharedWorkspaceRuntimeConfig,
  validateExistingSharedWorkspaceRuntimeConfig,
} from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import {
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';

export const SHARED_INTELLIGENCE_PRIMARY_THREAD_ID = STEPHANOS_PRIMARY_SHARED_CONVERSATION_THREAD_ID;
export const SHARED_INTELLIGENCE_CONTINUITY_SCHEMA_VERSION =
  'stephanos.shared-intelligence-continuity-service.v1';

const MAX_FILES = 1024;
const MAX_THREAD_RECORDS = 256;
const MAX_FILE_BYTES = 64 * 1024;
const DURABLE_CONVERSATION_STALE_AFTER_MS = Number.MAX_SAFE_INTEGER;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function safeThreadId(value) {
  const candidate = text(value) || SHARED_INTELLIGENCE_PRIMARY_THREAD_ID;
  return /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(candidate)
    ? candidate
    : SHARED_INTELLIGENCE_PRIMARY_THREAD_ID;
}

function zeroAuthority() {
  return Object.freeze({
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    memoryWriteAllowed: false,
    durablePromotionAllowed: false,
    schedulerCreationAllowed: false,
    workerCreationAllowed: false,
    providerSelectionAuthorityAdded: false,
  });
}

function emptyResult(classification, errors = []) {
  return Object.freeze({
    schemaVersion: SHARED_INTELLIGENCE_CONTINUITY_SCHEMA_VERSION,
    ok: false,
    classification,
    threadId: '',
    threadProjection: null,
    knowledgeTwin: null,
    conversationCanvasView: null,
    contextBlock: '',
    errors: Object.freeze([...new Set(errors)]),
    authority: zeroAuthority(),
  });
}

function stableTurnId(role, requestIdentity) {
  return `${role}-${hash(requestIdentity).slice(0, 24)}`;
}

function sharedTurnSegments(record) {
  const stableIdentity = JSON.stringify([
    text(record?.correlationId),
    text(record?.subjectId),
  ]);
  return ['inbox', `shared-turn-${hash(stableIdentity).slice(0, 24)}.json`];
}

function replyToTurnId(record) {
  try {
    const body = JSON.parse(text(record?.body));
    return text(body?.replyToTurnId);
  } catch {
    return '';
  }
}

function replyClosedTail(records, limit = MAX_THREAD_RECORDS) {
  const tail = records.slice(-limit);
  const admitted = [];
  const admittedTurnIds = new Set();
  for (const record of tail) {
    const turnId = text(record?.subjectId);
    const parentTurnId = replyToTurnId(record);
    if (!turnId) continue;
    if (parentTurnId && !admittedTurnIds.has(parentTurnId)) continue;
    admitted.push(record);
    admittedTurnIds.add(turnId);
  }
  return admitted;
}

async function validateExistingCanonicalWorkspace({
  repoRoot,
  env,
  lstatFn = lstat,
  validateWorkspaceFn = validateExistingSharedWorkspaceRuntimeConfig,
} = {}) {
  const runtime = await validateWorkspaceFn({ repoRoot, env });
  if (!runtime?.ok || !runtime.root) return runtime;
  try {
    const rootInfo = await lstatFn(runtime.root);
    const inboxPath = join(runtime.root, 'inbox');
    const inboxInfo = await lstatFn(inboxPath);
    if (
      !rootInfo.isDirectory()
      || rootInfo.isSymbolicLink()
      || !inboxInfo.isDirectory()
      || inboxInfo.isSymbolicLink()
    ) {
      return {
        ...runtime,
        ok: false,
        reason: 'STEPHANOS_SHARED_AGENT_WORKSPACE_LAYOUT_NOT_READY',
      };
    }
    return runtime;
  } catch (error) {
    return {
      ...runtime,
      ok: false,
      reason: 'STEPHANOS_SHARED_AGENT_WORKSPACE_LAYOUT_NOT_READY',
      errorCode: error?.code || 'LSTAT_FAILED',
    };
  }
}

async function readExistingRecord({ root, repoRoot, segments, readFileFn = readFile }) {
  const resolved = resolveSharedWorkspacePath({ root, repoRoot, segments });
  if (!resolved.ok) return { ok: false, reason: resolved.reason, record: null };
  try {
    return { ok: true, reason: 'WORKSPACE_RECORD_READ', record: JSON.parse(await readFileFn(resolved.path, 'utf8')) };
  } catch (error) {
    return {
      ok: false,
      reason: error?.code === 'ENOENT' ? 'WORKSPACE_RECORD_NOT_FOUND' : 'WORKSPACE_RECORD_READ_FAILED',
      record: null,
    };
  }
}

async function persistTurnRecord({
  root,
  repoRoot,
  record,
  nowMs,
  readFileFn = readFile,
  writeAtomicJsonFn = writeAtomicJson,
}) {
  const segments = sharedTurnSegments(record);
  const existing = await readExistingRecord({ root, repoRoot, segments, readFileFn });
  if (existing.ok) {
    if (JSON.stringify(existing.record) !== JSON.stringify(record)) {
      return { ok: false, reason: 'SHARED_TURN_EXISTING_CONFLICT', segments };
    }
    return { ok: true, reason: 'SHARED_TURN_ALREADY_PERSISTED', segments, resumed: true };
  }
  if (existing.reason !== 'WORKSPACE_RECORD_NOT_FOUND') {
    return { ok: false, reason: existing.reason, segments };
  }
  return writeAtomicJsonFn(root, segments, record, { repoRoot, nowMs });
}

export async function loadSharedIntelligenceThreadRecordsV1({
  threadId = SHARED_INTELLIGENCE_PRIMARY_THREAD_ID,
  repoRoot = process.cwd(),
  env = process.env,
  readdirFn = readdir,
  lstatFn = lstat,
  readFileFn = readFile,
} = {}) {
  const canonicalThreadId = safeThreadId(threadId);
  const runtime = resolveSharedWorkspaceRuntimeConfig({ repoRoot, env });
  if (!runtime.ok) {
    return Object.freeze({
      ok: false,
      classification: 'SHARED_INTELLIGENCE_WORKSPACE_UNAVAILABLE',
      threadId: canonicalThreadId,
      records: Object.freeze([]),
      errors: Object.freeze([runtime.reason]),
    });
  }

  const inbox = join(runtime.root, 'inbox');
  let names;
  try {
    names = (await readdirFn(inbox))
      .filter((name) => /^shared-turn-[0-9a-f]{24}\.json$/i.test(name))
      .sort()
      .slice(-MAX_FILES);
  } catch (error) {
    return Object.freeze({
      ok: false,
      classification: 'SHARED_INTELLIGENCE_INBOX_READ_FAILED',
      threadId: canonicalThreadId,
      records: Object.freeze([]),
      errors: Object.freeze([error?.code || 'READ_FAILED']),
    });
  }

  const records = [];
  for (const name of names) {
    const candidate = join(inbox, name);
    try {
      const info = await lstatFn(candidate);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) continue;
      const record = JSON.parse(await readFileFn(candidate, 'utf8'));
      if (
        text(record?.channel) !== 'shared-stephanos-chat'
        || text(record?.recordSubtype) !== 'conversation-turn'
        || text(record?.correlationId) !== canonicalThreadId
      ) continue;
      records.push(record);
    } catch {
      // Invalid or concurrently rotating files cannot become conversation truth.
    }
  }

  records.sort((left, right) => {
    const timeDelta = Date.parse(text(left?.timestampUtc)) - Date.parse(text(right?.timestampUtc));
    return timeDelta || text(left?.subjectId).localeCompare(text(right?.subjectId));
  });

  return Object.freeze({
    ok: true,
    classification: 'SHARED_INTELLIGENCE_THREAD_RECORDS_READY',
    threadId: canonicalThreadId,
    records: Object.freeze(replyClosedTail(records, MAX_THREAD_RECORDS)),
    errors: Object.freeze([]),
  });
}

function knowledgeTwinFromThread(thread, observedAtUtc) {
  if (!thread?.transcript?.length) return null;
  const items = thread.transcript.map((turn) => ({
    chatId: thread.threadId,
    messageId: turn.turnId,
    role: turn.senderParticipantId === 'chatgpt-bridge' ? 'chatgpt' : turn.senderParticipantId,
    sourceSurface: 'shared-workspace',
    createdAtUtc: turn.timestampUtc,
    text: turn.text,
    knowledgeClass: turn.senderParticipantId === 'operator' ? 'OPEN_THREAD' : 'NONE',
    retentionIntent: 'CONTEXT_ONLY',
    explicitOperatorTeaching: false,
    supersedesKnowledgeId: '',
    sourceRefs: Array.isArray(turn.proofRefs) && turn.proofRefs.length
      ? turn.proofRefs.map((ref) => `workspace://${hash(ref).slice(0, 24)}`)
      : [`workspace://shared-thread/${turn.turnId}`],
  }));

  return buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc,
    operatorConsent: {
      visibilityAllowed: true,
      learningCandidatesAllowed: false,
      durableLearningAllowed: false,
      scope: 'CURRENT_SHARED_THREAD',
    },
    items,
  });
}

function threadContextBlock(thread, knowledgeTwin) {
  if (!thread?.transcript?.length) return '';
  const transcript = thread.transcript.slice(-24).map((turn) => {
    const speaker = turn.senderParticipantId === 'chatgpt-bridge'
      ? 'ChatGPT'
      : turn.senderParticipantId === 'stephanos'
        ? 'Stephanos'
        : 'Stephan';
    return `${speaker}: ${turn.text}`;
  }).join('\n');
  const twinState = knowledgeTwin?.valid
    ? `Knowledge Twin visibility: ${knowledgeTwin.visibilityScope}; ${knowledgeTwin.visibleItems.length} current context items.`
    : 'Knowledge Twin visibility is unavailable for this turn.';
  return [
    'Shared Stephan + ChatGPT + Stephanos conversation context:',
    transcript,
    twinState,
    'Treat this as conversational context only unless existing governed memory separately proves durable operator teaching.',
  ].join('\n');
}

export async function prepareSharedIntelligenceForAiTurnV1({
  threadId,
  requestIdentity,
  operatorText,
  timestampUtc,
  repoRoot = process.cwd(),
  env = process.env,
  readFileFn = readFile,
  writeAtomicJsonFn = writeAtomicJson,
  readdirFn = readdir,
  lstatFn = lstat,
  validateWorkspaceFn = validateExistingSharedWorkspaceRuntimeConfig,
} = {}) {
  const canonicalThreadId = safeThreadId(threadId);
  const operatorTurnId = stableTurnId('operator', requestIdentity || `${timestampUtc}:${operatorText}`);
  const runtime = await validateExistingCanonicalWorkspace({
    repoRoot,
    env,
    lstatFn,
    validateWorkspaceFn,
  });
  if (!runtime?.ok) return emptyResult('SHARED_INTELLIGENCE_WORKSPACE_UNAVAILABLE', [runtime?.reason || 'WORKSPACE_UNAVAILABLE']);

  const built = createStephanosSharedConversationTurnRecord({
    threadId: canonicalThreadId,
    turnId: operatorTurnId,
    senderParticipantId: 'operator',
    replyToTurnId: '',
    text: text(operatorText),
    timestampUtc,
  }, {
    relatedIssue: '#2434',
    proofRefs: [`proof/ai-chat/${hash(requestIdentity || operatorTurnId).slice(0, 24)}`],
    workspaceValidationOptions: {
      nowMs: Date.parse(timestampUtc),
      staleAfterMs: DURABLE_CONVERSATION_STALE_AFTER_MS,
    },
  });
  if (!built.valid) return emptyResult('SHARED_INTELLIGENCE_OPERATOR_TURN_REJECTED', built.errors);

  const persisted = await persistTurnRecord({
    root: runtime.root,
    repoRoot,
    record: built.record,
    nowMs: Date.parse(timestampUtc),
    readFileFn,
    writeAtomicJsonFn,
  });
  if (!persisted.ok) return emptyResult('SHARED_INTELLIGENCE_OPERATOR_TURN_PERSISTENCE_BLOCKED', [persisted.reason]);

  const loaded = await loadSharedIntelligenceThreadRecordsV1({
    threadId: canonicalThreadId,
    repoRoot,
    env,
    readdirFn,
    lstatFn,
    readFileFn,
  });
  const records = loaded.ok && loaded.records.length ? loaded.records : [built.record];
  const projection = buildStephanosSharedConversationThread(records, {
    threadId: canonicalThreadId,
    workspaceValidationOptions: {
      nowMs: Date.parse(timestampUtc),
      staleAfterMs: DURABLE_CONVERSATION_STALE_AFTER_MS,
    },
  });
  if (!projection.valid) return emptyResult('SHARED_INTELLIGENCE_THREAD_REJECTED', projection.errors);

  const knowledgeTwin = knowledgeTwinFromThread(projection.thread, timestampUtc);
  return Object.freeze({
    schemaVersion: SHARED_INTELLIGENCE_CONTINUITY_SCHEMA_VERSION,
    ok: true,
    classification: 'SHARED_INTELLIGENCE_CONTEXT_READY',
    threadId: canonicalThreadId,
    operatorTurnId,
    threadProjection: projection.thread,
    knowledgeTwin,
    conversationCanvasView: null,
    contextBlock: threadContextBlock(projection.thread, knowledgeTwin),
    errors: Object.freeze([]),
    authority: zeroAuthority(),
  });
}

export async function completeSharedIntelligenceAiTurnV1({
  prepared,
  requestIdentity,
  answerText,
  timestampUtc,
  repoRoot = process.cwd(),
  env = process.env,
  surface = 'desktop-browser',
  readFileFn = readFile,
  writeAtomicJsonFn = writeAtomicJson,
  readdirFn = readdir,
  lstatFn = lstat,
  validateWorkspaceFn = validateExistingSharedWorkspaceRuntimeConfig,
} = {}) {
  if (!prepared?.ok || !prepared.threadId || !prepared.operatorTurnId) {
    return emptyResult('SHARED_INTELLIGENCE_PREPARED_CONTEXT_REQUIRED', ['prepared-context-invalid']);
  }
  const runtime = await validateExistingCanonicalWorkspace({
    repoRoot,
    env,
    lstatFn,
    validateWorkspaceFn,
  });
  if (!runtime?.ok) return emptyResult('SHARED_INTELLIGENCE_WORKSPACE_UNAVAILABLE', [runtime?.reason || 'WORKSPACE_UNAVAILABLE']);

  const answerTurnId = stableTurnId('stephanos', `${requestIdentity}:answer`);
  const built = createStephanosSharedConversationTurnRecord({
    threadId: prepared.threadId,
    turnId: answerTurnId,
    senderParticipantId: 'stephanos',
    replyToTurnId: prepared.operatorTurnId,
    text: text(answerText),
    timestampUtc,
  }, {
    relatedIssue: '#2434',
    proofRefs: [`proof/ai-chat-answer/${hash(requestIdentity || answerTurnId).slice(0, 24)}`],
    workspaceValidationOptions: {
      nowMs: Date.parse(timestampUtc),
      staleAfterMs: DURABLE_CONVERSATION_STALE_AFTER_MS,
    },
  });
  if (!built.valid) return emptyResult('SHARED_INTELLIGENCE_STEPHANOS_TURN_REJECTED', built.errors);

  const persisted = await persistTurnRecord({
    root: runtime.root,
    repoRoot,
    record: built.record,
    nowMs: Date.parse(timestampUtc),
    readFileFn,
    writeAtomicJsonFn,
  });
  if (!persisted.ok) return emptyResult('SHARED_INTELLIGENCE_STEPHANOS_TURN_PERSISTENCE_BLOCKED', [persisted.reason]);

  const loaded = await loadSharedIntelligenceThreadRecordsV1({
    threadId: prepared.threadId,
    repoRoot,
    env,
    readdirFn,
    lstatFn,
    readFileFn,
  });
  if (!loaded.ok || !loaded.records.length) {
    return emptyResult('SHARED_INTELLIGENCE_THREAD_RELOAD_BLOCKED', loaded.errors);
  }

  const nowMs = Date.parse(timestampUtc);
  const projection = buildStephanosSharedConversationThread(loaded.records, {
    threadId: prepared.threadId,
    workspaceValidationOptions: {
      nowMs,
      staleAfterMs: DURABLE_CONVERSATION_STALE_AFTER_MS,
    },
  });
  if (!projection.valid) return emptyResult('SHARED_INTELLIGENCE_THREAD_REJECTED', projection.errors);

  const knowledgeTwin = knowledgeTwinFromThread(projection.thread, timestampUtc);
  const canvas = buildStephanosSharedThreadConversationCanvasV1({
    threadId: prepared.threadId,
    surface,
    turnRecords: loaded.records,
  }, {
    nowMs,
    staleAfterMs: DURABLE_CONVERSATION_STALE_AFTER_MS,
  });
  if (!canvas.valid) return emptyResult('SHARED_INTELLIGENCE_CANVAS_BLOCKED', canvas.errors);

  return Object.freeze({
    schemaVersion: SHARED_INTELLIGENCE_CONTINUITY_SCHEMA_VERSION,
    ok: true,
    classification: 'SHARED_INTELLIGENCE_TURN_COMPLETE',
    threadId: prepared.threadId,
    operatorTurnId: prepared.operatorTurnId,
    stephanosTurnId: answerTurnId,
    threadProjection: projection.thread,
    knowledgeTwin,
    conversationCanvasView: canvas.conversationCanvasView,
    contextBlock: threadContextBlock(projection.thread, knowledgeTwin),
    errors: Object.freeze([]),
    authority: zeroAuthority(),
  });
}


export function prepareAuthorisedHistoricalChatContextV1(packet = null) {
  if (!packet) {
    return Object.freeze({
      ok: false,
      classification: 'AUTHORISED_CHAT_HISTORY_NOT_SUPPLIED',
      knowledgeTwin: null,
      contextBlock: '',
      errors: Object.freeze([]),
      authority: zeroAuthority(),
    });
  }

  const result = buildStephanosAuthorisedChatHistoryIngestV1(packet);
  if (!result?.valid || !result.knowledgeTwin?.valid) {
    return Object.freeze({
      ok: false,
      classification: result?.classification || 'AUTHORISED_CHAT_HISTORY_INGEST_BLOCKED',
      knowledgeTwin: null,
      contextBlock: '',
      errors: Object.freeze(Array.isArray(result?.errors) ? result.errors : ['history-ingest-invalid']),
      authority: zeroAuthority(),
    });
  }

  const visible = Array.isArray(result.knowledgeTwin.visibleItems)
    ? result.knowledgeTwin.visibleItems.slice(-24)
    : [];
  const lines = visible.map((item) => {
    const speaker = item.role === 'chatgpt' ? 'ChatGPT' : item.role === 'stephanos' ? 'Stephanos' : 'Stephan';
    return `${speaker}: ${item.text}`;
  });
  const contextBlock = [
    'Explicitly authorised prior-chat context:',
    ...lines,
    `Knowledge Twin visibility: ${result.knowledgeTwin.visibilityScope}; ${result.knowledgeTwin.visibleItems.length} visible items; ${result.knowledgeTwin.durableTeachingCandidates.length} governed durable-teaching candidates.`,
    'Visibility is context only unless the existing memory authority separately promotes explicit operator teaching.',
  ].join('\n');

  return Object.freeze({
    ok: true,
    classification: 'AUTHORISED_CHAT_HISTORY_CONTEXT_READY',
    knowledgeTwin: result.knowledgeTwin,
    sourceLineage: result.sourceLineage,
    contextBlock,
    errors: Object.freeze([]),
    authority: zeroAuthority(),
  });
}


function governedMemoryKey(candidate) {
  return `operator.knowledge.${text(candidate?.knowledgeId).replace(/[^a-z0-9._-]+/gi, '-').toLowerCase()}`;
}

function governedMemorySourceRef(candidate) {
  const refs = Array.isArray(candidate?.sourceRefs) ? candidate.sourceRefs : [];
  return text(refs[0]) || `operator:${text(candidate?.knowledgeId) || 'teaching'}`;
}

export function governAuthorisedHistoricalTeachingV1(historyContext, {
  adjudicateFn = adjudicateMemoryCandidate,
  store = durableMemoryStore,
  persist = true,
} = {}) {
  if (!historyContext?.ok || !historyContext.knowledgeTwin?.valid) {
    return Object.freeze({
      ok: false,
      classification: 'GOVERNED_OPERATOR_TEACHING_CONTEXT_REQUIRED',
      candidateCount: 0,
      promotedCount: 0,
      results: Object.freeze([]),
      errors: Object.freeze(['authorised-history-context-not-ready']),
      authority: zeroAuthority(),
    });
  }

  const candidates = Array.isArray(historyContext.knowledgeTwin.durableTeachingCandidates)
    ? historyContext.knowledgeTwin.durableTeachingCandidates
    : [];
  const results = candidates.map((candidate) => {
    const memoryCandidate = {
      key: governedMemoryKey(candidate),
      value: {
        knowledgeId: candidate.knowledgeId,
        subjectRef: candidate.subjectRef,
        knowledgeClass: candidate.knowledgeClass,
        summary: candidate.summary,
        origin: candidate.origin,
        authorityClass: candidate.authorityClass,
        currentState: candidate.currentState,
        observedAtUtc: candidate.observedAtUtc,
        sourceRefs: candidate.sourceRefs,
      },
      sourceType: 'operator',
      sourceRef: governedMemorySourceRef(candidate),
      memoryReason: `Long-lived explicit operator teaching (${candidate.knowledgeClass}) admitted from authorised chat through Operator Knowledge Twin governance.`,
      memoryConfidence: 'high',
      tags: ['operator-teaching', `knowledge-class:${String(candidate.knowledgeClass || '').toLowerCase()}`],
      supersedes: text(candidate.supersedesKnowledgeId),
    };
    const truth = adjudicateFn(memoryCandidate, { store, persist });
    return Object.freeze({
      knowledgeId: candidate.knowledgeId,
      memoryKey: memoryCandidate.key,
      memoryEligible: truth.memoryEligible === true,
      memoryPromoted: truth.memoryPromoted === true,
      memoryReason: truth.memoryReason,
      memorySourceRef: truth.memorySourceRef,
    });
  });

  return Object.freeze({
    ok: true,
    classification: candidates.length
      ? 'GOVERNED_OPERATOR_TEACHING_ADJUDICATED'
      : 'NO_DURABLE_OPERATOR_TEACHING_CANDIDATES',
    candidateCount: candidates.length,
    promotedCount: results.filter((item) => item.memoryPromoted).length,
    results: Object.freeze(results),
    errors: Object.freeze([]),
    authority: zeroAuthority(),
  });
}

function memoryQueryTokens(query = '') {
  return [...new Set(String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9._-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3))];
}

export function recallGovernedOperatorTeachingV1(query = '', {
  store = durableMemoryStore,
  limit = 8,
} = {}) {
  const records = store.list()
    .filter((record) => Array.isArray(record.tags) && record.tags.includes('operator-teaching'));
  const supersededKnowledgeIds = new Set(
    records.map((record) => text(record.supersedes)).filter(Boolean),
  );
  const current = records.filter((record) => {
    const knowledgeId = text(record?.value?.knowledgeId);
    return knowledgeId && !supersededKnowledgeIds.has(knowledgeId);
  });
  const tokens = memoryQueryTokens(query);
  const scored = current.map((record) => {
    const searchable = JSON.stringify({
      key: record.key,
      value: record.value,
      tags: record.tags,
    }).toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (searchable.includes(token) ? 1 : 0), 0);
    return { record, score };
  });
  const selected = scored
    .filter(({ score }) => tokens.length === 0 || score > 0)
    .sort((left, right) => right.score - left.score || String(right.record.updatedAt).localeCompare(String(left.record.updatedAt)))
    .slice(0, Math.max(1, Math.min(Number(limit) || 8, 16)))
    .map(({ record }) => record);
  const contextBlock = selected.length
    ? [
        'Governed durable operator teaching:',
        ...selected.map((record) => `- [${text(record?.value?.knowledgeClass, 'KNOWLEDGE')}] ${text(record?.value?.summary)} (source: ${text(record.sourceRef)})`),
        'These items were explicitly taught by the operator, admitted through the existing durable-memory adjudicator, and are current after supersession filtering.',
      ].join('\n')
    : '';

  return Object.freeze({
    ok: true,
    classification: selected.length ? 'GOVERNED_OPERATOR_TEACHING_RECALLED' : 'NO_RELEVANT_GOVERNED_OPERATOR_TEACHING',
    recordCount: selected.length,
    records: Object.freeze(selected.map((record) => Object.freeze({ ...record }))),
    contextBlock,
    authority: zeroAuthority(),
  });
}
