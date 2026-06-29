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

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
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
    finalVerdict: 'SHARED_WORKSPACE_MISSION_ROOM_CONTRACT_READY',
  };
}

export function createParticipant(input = {}) {
  const participantRole = role(input.role);
  return {
    participantId: text(input.participantId, participantRole.toLowerCase()),
    displayName: text(input.displayName, participantRole),
    role: participantRole,
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
  return {
    messageId: text(input.messageId, 'message-current'),
    participantId: text(input.participantId, 'stephanos'),
    role: role(input.role),
    threadId: text(input.threadId, 'discussion-thread'),
    objectIds: list(input.objectIds),
    body: text(input.body),
    claimType: input.proven === true ? 'PROVEN_FACT' : 'HYPOTHESIS_OR_PROPOSAL',
    requiresOperator: input.requiresOperator === true,
  };
}

export function routeWorkspaceWork(input = {}) {
  const kind = objectKind(input.kind);
  const summary = text(input.summary);
  let assignedRole = PARTICIPANT_ROLE.STEPHANOS;
  if ([WORKSPACE_OBJECT_KIND.PR, WORKSPACE_OBJECT_KIND.TASK].includes(kind) || /source slice|source|code|patch|implement|build/i.test(summary)) assignedRole = PARTICIPANT_ROLE.CODEX;
  else if ([WORKSPACE_OBJECT_KIND.PROOF, WORKSPACE_OBJECT_KIND.EXPERIMENT].includes(kind) || /verify|proof|test|browser/i.test(summary)) assignedRole = PARTICIPANT_ROLE.VERIFIER;
  else if (/scout|research|inspect|fallback/i.test(summary)) assignedRole = PARTICIPANT_ROLE.OPENCLAW;
  if ([WORKSPACE_OBJECT_KIND.DECISION].includes(kind) || /approve|merge/i.test(summary)) assignedRole = PARTICIPANT_ROLE.OPERATOR;
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
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'SHARED_WORKSPACE_MISSION_ROOM_PASS' : 'SHARED_WORKSPACE_MISSION_ROOM_BLOCKED',
  };
}
