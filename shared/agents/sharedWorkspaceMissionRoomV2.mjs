export const SHARED_WORKSPACE_MISSION_ROOM_SCHEMA_VERSION = 'shared-workspace-mission-room.v2';

export const PARTICIPANT_ROLE = Object.freeze({
  OPERATOR: 'OPERATOR',
  STEPHANOS: 'STEPHANOS',
  OPENCLAW: 'OPENCLAW',
  CODEX: 'CODEX',
  BROWSER: 'BROWSER',
  VERIFIER: 'VERIFIER',
  SCOUT: 'SCOUT',
  PLANNER: 'PLANNER',
  FUTURE_AGENT: 'FUTURE_AGENT',
});

export const WORKSPACE_OBJECT_KIND = Object.freeze({
  MISSION: 'MISSION',
  GOAL: 'GOAL',
  TASK: 'TASK',
  PR: 'PR',
  PROOF: 'PROOF',
  BLOCKER: 'BLOCKER',
  IDEA: 'IDEA',
  DECISION: 'DECISION',
  QUESTION: 'QUESTION',
  EXPERIMENT: 'EXPERIMENT',
});

export const THREAD_KIND = Object.freeze({
  DISCUSSION: 'DISCUSSION',
  EVIDENCE: 'EVIDENCE',
  PATCH: 'PATCH',
  TEST: 'TEST',
  MERGE_DECISION: 'MERGE_DECISION',
  FOLLOW_UP_IDEA: 'FOLLOW_UP_IDEA',
});

export const CONVERSATION_DELIVERY_STATE = Object.freeze({
  QUEUED: 'QUEUED',
  ACCEPTED: 'ACCEPTED',
  IN_PROGRESS: 'IN_PROGRESS',
  REPLIED: 'REPLIED',
  BLOCKED: 'BLOCKED',
  EXPIRED: 'EXPIRED',
});

export const PARTICIPANT_CONNECTION_STATE = Object.freeze({
  CONNECTED: 'CONNECTED',
  DEGRADED: 'DEGRADED',
  OFFLINE: 'OFFLINE',
  UNPROVEN: 'UNPROVEN',
});

export const CONVERSATION_CONNECTION_STALE_AFTER_MS = 5 * 60 * 1000;

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,120}$/i;
const SHA = /^[0-9a-f]{40}$/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function safeId(value, fallback = '') {
  const out = text(value);
  return SAFE_ID.test(out) ? out : fallback;
}

function timestamp(value) {
  const out = text(value);
  return Number.isFinite(Date.parse(out)) ? out : '';
}

function sha(value) {
  const out = text(value).toLowerCase();
  return SHA.test(out) ? out : '';
}

function role(value) {
  const out = text(value, PARTICIPANT_ROLE.FUTURE_AGENT).toUpperCase();
  return Object.values(PARTICIPANT_ROLE).includes(out) ? out : PARTICIPANT_ROLE.FUTURE_AGENT;
}

function objectKind(value) {
  const out = text(value, WORKSPACE_OBJECT_KIND.TASK).toUpperCase();
  return Object.values(WORKSPACE_OBJECT_KIND).includes(out) ? out : WORKSPACE_OBJECT_KIND.TASK;
}

function threadKind(value) {
  const out = text(value, THREAD_KIND.DISCUSSION).toUpperCase();
  return Object.values(THREAD_KIND).includes(out) ? out : THREAD_KIND.DISCUSSION;
}

export function buildSharedWorkspaceMissionRoomContract() {
  return {
    schemaVersion: SHARED_WORKSPACE_MISSION_ROOM_SCHEMA_VERSION,
    contractKind: 'stephanos.shared_workspace.mission_room.contract',
    participantRoles: Object.values(PARTICIPANT_ROLE),
    workspaceObjectKinds: Object.values(WORKSPACE_OBJECT_KIND),
    threadKinds: Object.values(THREAD_KIND),
    conversationDeliveryStates: Object.values(CONVERSATION_DELIVERY_STATE),
    participantConnectionStates: Object.values(PARTICIPANT_CONNECTION_STATE),
    conversationRules: Object.freeze({
      canonicalRecipient: 'stephanos',
      exactReplyCorrelationRequired: true,
      originalEvidenceTimestampRequired: true,
      entitySourceHeadRequiredForConnected: true,
      arbitraryExecutionAuthorityAdded: false,
    }),
    finalVerdict: 'SHARED_WORKSPACE_MISSION_ROOM_CONTRACT_READY',
  };
}

export function createParticipant(input = {}) {
  const participantRole = role(input.role);
  return {
    participantId: safeId(input.participantId, participantRole.toLowerCase()),
    displayName: text(input.displayName, participantRole),
    role: participantRole,
    conversationAdapterId: safeId(input.conversationAdapterId),
    canReceiveConversation: input.canReceiveConversation === true,
    canReplyConversation: input.canReplyConversation === true,
    canMutateSource: input.canMutateSource === true,
    canApproveMerge: participantRole === PARTICIPANT_ROLE.OPERATOR && input.canApproveMerge === true,
    canPublishProof: input.canPublishProof !== false,
  };
}

export function createWorkspaceObject(input = {}) {
  return {
    objectId: text(input.objectId, `${objectKind(input.kind).toLowerCase()}-object`),
    kind: objectKind(input.kind),
    title: text(input.title, 'Untitled workspace object'),
    summary: text(input.summary),
    status: text(input.status, 'OPEN'),
    refs: list(input.refs),
    relatedObjectIds: list(input.relatedObjectIds),
    proven: input.proven === true,
  };
}

export function createMissionThread(input = {}) {
  return {
    threadId: text(input.threadId, `${threadKind(input.kind).toLowerCase()}-thread`),
    kind: threadKind(input.kind),
    title: text(input.title, 'Untitled thread'),
    objectIds: list(input.objectIds),
    messageIds: list(input.messageIds),
    status: text(input.status, 'OPEN'),
  };
}

export function createRoomMessage(input = {}) {
  const participantId = safeId(input.participantId, role(input.role).toLowerCase());
  const recipientParticipantId = safeId(input.recipientParticipantId, 'operator');
  const createdAtUtc = timestamp(input.createdAtUtc);
  const expiresAtUtc = timestamp(input.expiresAtUtc);
  const deliveryState = text(input.deliveryState, CONVERSATION_DELIVERY_STATE.QUEUED).toUpperCase();
  return {
    messageId: safeId(input.messageId, 'message-current'),
    participantId,
    senderParticipantId: participantId,
    recipientParticipantId,
    requestedEntityId: safeId(input.requestedEntityId, recipientParticipantId),
    role: role(input.role),
    conversationId: safeId(input.conversationId, 'conversation-current'),
    threadId: safeId(input.threadId, 'discussion-thread'),
    correlationId: safeId(input.correlationId, safeId(input.conversationId, 'conversation-current')),
    replyToMessageId: safeId(input.replyToMessageId),
    objectIds: list(input.objectIds),
    body: text(input.body),
    createdAtUtc,
    expiresAtUtc,
    deliveryState: Object.values(CONVERSATION_DELIVERY_STATE).includes(deliveryState)
      ? deliveryState
      : CONVERSATION_DELIVERY_STATE.BLOCKED,
    sourceHead: sha(input.sourceHead),
    proofRefs: list(input.proofRefs),
    claimType: input.proven === true ? 'PROVEN_FACT' : 'HYPOTHESIS_OR_PROPOSAL',
    requiresOperator: input.requiresOperator === true,
  };
}

export function validateRoomMessage(message = {}) {
  const errors = [];
  if (!safeId(message.messageId)) errors.push('invalid-message-id');
  if (!safeId(message.senderParticipantId || message.participantId)) errors.push('invalid-sender-participant-id');
  if (!safeId(message.recipientParticipantId)) errors.push('invalid-recipient-participant-id');
  if (!safeId(message.conversationId)) errors.push('invalid-conversation-id');
  if (!safeId(message.threadId)) errors.push('invalid-thread-id');
  if (!safeId(message.correlationId)) errors.push('invalid-correlation-id');
  if (text(message.replyToMessageId) && !safeId(message.replyToMessageId)) errors.push('invalid-reply-to-message-id');
  if (!Object.values(CONVERSATION_DELIVERY_STATE).includes(message.deliveryState)) errors.push('invalid-delivery-state');
  if (text(message.sourceHead) && !sha(message.sourceHead)) errors.push('invalid-source-head');
  if (text(message.createdAtUtc) && !timestamp(message.createdAtUtc)) errors.push('invalid-created-at');
  if (text(message.expiresAtUtc) && !timestamp(message.expiresAtUtc)) errors.push('invalid-expires-at');
  if (timestamp(message.createdAtUtc) && timestamp(message.expiresAtUtc)
    && Date.parse(message.expiresAtUtc) <= Date.parse(message.createdAtUtc)) errors.push('expiry-not-after-creation');
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    finalVerdict: errors.length === 0 ? 'MISSION_ROOM_MESSAGE_PASS' : 'MISSION_ROOM_MESSAGE_BLOCKED',
  });
}

export function createParticipantConnectionReceipt(input = {}) {
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_MISSION_ROOM_SCHEMA_VERSION,
    kind: 'stephanos.shared_workspace.participant_connection',
    participantId: safeId(input.participantId, 'future-agent'),
    conversationAdapterId: safeId(input.conversationAdapterId),
    observedAtUtc: timestamp(input.observedAtUtc),
    sourceHead: sha(input.sourceHead),
    receiveProven: input.receiveProven === true,
    replyProven: input.replyProven === true,
    exactCorrelationProven: input.exactCorrelationProven === true,
    authenticatedIdentityProven: input.authenticatedIdentityProven === true,
    proofRefs: list(input.proofRefs),
    authority: Object.freeze({
      conversationOnly: input.authority?.conversationOnly !== false,
      sourceMutationAllowed: false,
      commandExecutionGrantedByConversation: false,
      mergeAuthority: false,
      selfApprovalAllowed: false,
    }),
  });
}

export function evaluateParticipantConnection(receipt = null, {
  nowMs = Date.now(),
  staleAfterMs = CONVERSATION_CONNECTION_STALE_AFTER_MS,
} = {}) {
  if (!receipt || typeof receipt !== 'object') return Object.freeze({
    state: PARTICIPANT_CONNECTION_STATE.UNPROVEN,
    participantId: '',
    observedAtUtc: '',
    ageSeconds: null,
    blocker: 'CONVERSATION_CONNECTION_RECEIPT_MISSING',
  });
  const observedAtUtc = timestamp(receipt.observedAtUtc);
  const ageMs = observedAtUtc && Number.isFinite(nowMs) ? Math.max(0, nowMs - Date.parse(observedAtUtc)) : null;
  const identityComplete = Boolean(
    safeId(receipt.participantId)
    && safeId(receipt.conversationAdapterId)
    && sha(receipt.sourceHead)
    && receipt.authenticatedIdentityProven === true
  );
  const roundTripComplete = receipt.receiveProven === true
    && receipt.replyProven === true
    && receipt.exactCorrelationProven === true;
  let state = PARTICIPANT_CONNECTION_STATE.CONNECTED;
  let blocker = '';
  if (ageMs === null || !identityComplete) {
    state = PARTICIPANT_CONNECTION_STATE.UNPROVEN;
    blocker = 'CONVERSATION_CONNECTION_IDENTITY_UNPROVEN';
  } else if (ageMs > staleAfterMs) {
    state = PARTICIPANT_CONNECTION_STATE.OFFLINE;
    blocker = 'CONVERSATION_CONNECTION_RECEIPT_STALE';
  } else if (!roundTripComplete) {
    state = PARTICIPANT_CONNECTION_STATE.DEGRADED;
    blocker = 'CONVERSATION_ROUND_TRIP_UNPROVEN';
  }
  return Object.freeze({
    state,
    participantId: safeId(receipt.participantId),
    conversationAdapterId: safeId(receipt.conversationAdapterId),
    sourceHead: sha(receipt.sourceHead),
    observedAtUtc,
    ageSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
    blocker,
    proofRefs: Object.freeze(list(receipt.proofRefs)),
  });
}

export function buildConversationConnectionProjection({ participants = [], receipts = [], nowMs = Date.now() } = {}) {
  const receiptByParticipant = new Map(receipts.map((receipt) => [safeId(receipt?.participantId), receipt]));
  const connections = participants.map((participantInput) => {
    const participant = createParticipant(participantInput);
    return Object.freeze({
      participant,
      connection: evaluateParticipantConnection(receiptByParticipant.get(participant.participantId), { nowMs }),
    });
  });
  const blockers = connections
    .filter((entry) => entry.connection.state !== PARTICIPANT_CONNECTION_STATE.CONNECTED)
    .map((entry) => `${entry.participant.participantId}:${entry.connection.blocker}`);
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_MISSION_ROOM_SCHEMA_VERSION,
    projectionKind: 'conversation-participant-connections',
    connections: Object.freeze(connections),
    allConnected: blockers.length === 0,
    blockers: Object.freeze(blockers),
    finalVerdict: blockers.length === 0
      ? 'SHARED_CONVERSATION_CONNECTIONS_PROVEN'
      : 'SHARED_CONVERSATION_CONNECTIONS_INCOMPLETE',
  });
}

export function routeWorkspaceWork(input = {}) {
  const kind = objectKind(input.kind);
  const summary = text(input.summary);
  let assignedRole = PARTICIPANT_ROLE.STEPHANOS;
  if ([WORKSPACE_OBJECT_KIND.DECISION].includes(kind) || /approve|merge/i.test(summary)) assignedRole = PARTICIPANT_ROLE.OPERATOR;
  else if (/scout|research|inspect|fallback/i.test(summary)) assignedRole = PARTICIPANT_ROLE.OPENCLAW;
  else if ([WORKSPACE_OBJECT_KIND.PR, WORKSPACE_OBJECT_KIND.TASK].includes(kind) || /source slice|source|code|patch|implement|build/i.test(summary)) assignedRole = PARTICIPANT_ROLE.CODEX;
  else if ([WORKSPACE_OBJECT_KIND.PROOF, WORKSPACE_OBJECT_KIND.EXPERIMENT].includes(kind) || /verify|proof|test|browser/i.test(summary)) assignedRole = PARTICIPANT_ROLE.VERIFIER;
  return {
    schemaVersion: SHARED_WORKSPACE_MISSION_ROOM_SCHEMA_VERSION,
    kind: 'stephanos.shared_workspace.role_route',
    objectKind: kind,
    assignedRole,
    reason: `Route ${kind} to ${assignedRole}.`,
    finalVerdict: 'WORKSPACE_ROLE_ROUTE_READY',
  };
}

export function createFlywheelTurn(input = {}) {
  const idea = createWorkspaceObject({
    objectId: input.ideaId || 'idea-current',
    kind: WORKSPACE_OBJECT_KIND.IDEA,
    title: input.title || 'Operator idea',
    summary: input.idea,
    proven: false,
  });
  const question = createWorkspaceObject({
    objectId: input.questionId || 'question-current',
    kind: WORKSPACE_OBJECT_KIND.QUESTION,
    title: 'Flywheel question',
    summary: input.question || 'What is the smallest useful source slice?',
    relatedObjectIds: [idea.objectId],
  });
  const nextAction = createWorkspaceObject({
    objectId: input.nextActionId || 'task-next-source-slice',
    kind: WORKSPACE_OBJECT_KIND.TASK,
    title: 'Next source slice',
    summary: input.nextAction || 'Turn this idea into source, proof, blocker, or explicit reject decision.',
    relatedObjectIds: [idea.objectId, question.objectId],
  });
  return {
    schemaVersion: SHARED_WORKSPACE_MISSION_ROOM_SCHEMA_VERSION,
    kind: 'stephanos.shared_workspace.flywheel_turn',
    objects: [idea, question, nextAction],
    route: routeWorkspaceWork(nextAction),
    finalVerdict: 'WORKSPACE_FLYWHEEL_TURN_READY',
  };
}

export function createMissionRoom(input = {}) {
  const participants = (Array.isArray(input.participants) ? input.participants : []).map(createParticipant);
  const objects = (Array.isArray(input.objects) ? input.objects : []).map(createWorkspaceObject);
  const threads = (Array.isArray(input.threads) ? input.threads : []).map(createMissionThread);
  const messages = (Array.isArray(input.messages) ? input.messages : []).map(createRoomMessage);
  return {
    schemaVersion: SHARED_WORKSPACE_MISSION_ROOM_SCHEMA_VERSION,
    kind: 'stephanos.shared_workspace.mission_room',
    roomId: text(input.roomId, 'mission-room-current'),
    title: text(input.title, 'Shared Workspace Mission Room'),
    participants,
    objects,
    threads,
    messages,
    memoryHooks: list(input.memoryHooks),
    finalVerdict: 'SHARED_WORKSPACE_MISSION_ROOM_READY',
  };
}

export function validateMissionRoom(room = {}) {
  const errors = [];
  if (room.schemaVersion !== SHARED_WORKSPACE_MISSION_ROOM_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (room.kind !== 'stephanos.shared_workspace.mission_room') errors.push('invalid-kind');
  if (!text(room.roomId)) errors.push('missing-room-id');
  if (!Array.isArray(room.participants) || !room.participants.length) errors.push('missing-participants');
  if (!Array.isArray(room.objects)) errors.push('missing-objects');
  if (!Array.isArray(room.threads)) errors.push('missing-threads');
  if (!Array.isArray(room.messages)) errors.push('missing-messages');
  if (Array.isArray(room.messages)) {
    for (const message of room.messages) {
      const validation = validateRoomMessage(message);
      errors.push(...validation.errors.map((error) => `message:${message?.messageId || 'unknown'}:${error}`));
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'SHARED_WORKSPACE_MISSION_ROOM_PASS' : 'SHARED_WORKSPACE_MISSION_ROOM_BLOCKED',
  };
}
