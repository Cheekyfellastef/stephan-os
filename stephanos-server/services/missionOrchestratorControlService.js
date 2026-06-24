import { createHash } from 'node:crypto';
import {
  appendMissionEvent,
  createMissionRecord,
  listMissionRecords,
  readMissionRecord,
} from './missionOrchestratorStore.js';

const COMMAND_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{7,127}$/;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function safeCommandId(value) {
  const commandId = text(value).toLowerCase();
  if (!COMMAND_ID_PATTERN.test(commandId)) throw new Error('Command id is missing or invalid.');
  return commandId;
}

function approvalEventId(commandId, approvalToken) {
  const tokenHash = createHash('sha256').update(text(approvalToken), 'utf8').digest('hex').slice(0, 16);
  return `approval-${safeCommandId(commandId)}-${tokenHash}`.slice(0, 128);
}

function boundedIntent(input = {}) {
  return {
    missionId: input.missionId,
    title: input.title,
    operatorIntent: input.operatorIntent,
    intendedOutcome: input.intendedOutcome,
    missionKind: input.missionKind,
    repository: input.repository,
    repositoryRoot: input.repositoryRoot,
    baseBranch: input.baseBranch,
    branch: input.branch,
    worktreePath: input.worktreePath,
    allowedFiles: input.allowedFiles,
    requiredEvidence: input.requiredEvidence,
    requiredTests: input.requiredTests,
    browserProofRequired: input.browserProofRequired === true,
  };
}

export async function createBoundedMission(input, options = {}) {
  return createMissionRecord(boundedIntent(input), {
    ...options,
    createdBy: text(options.createdBy, 'stephanos-mission-control'),
  });
}

export async function readBoundedMission(missionId, options = {}) {
  return readMissionRecord(missionId, options);
}

export async function listBoundedMissions(options = {}) {
  return listMissionRecords(options);
}

export async function approveBoundedMission(input = {}, options = {}) {
  const missionId = text(input.missionId).toLowerCase();
  const approvalToken = text(input.approvalToken);
  const commandId = safeCommandId(input.commandId);
  const current = await readMissionRecord(missionId, options);
  if (current.state.currentPhase !== 'AWAITING_OPERATOR_APPROVAL') {
    throw new Error('Mission is not awaiting operator approval.');
  }
  if (!approvalToken || approvalToken !== current.state.approval?.requiredToken) {
    throw new Error('Approval token does not match the exact mission pull request head.');
  }
  return appendMissionEvent(missionId, {
    eventId: approvalEventId(commandId, approvalToken),
    eventType: 'OPERATOR_APPROVAL_RECORDED',
    approvalToken,
    summary: 'Exact operator approval recorded through bounded mission control.',
  }, options);
}

export async function cancelBoundedMission(input = {}, options = {}) {
  const missionId = text(input.missionId).toLowerCase();
  const commandId = safeCommandId(input.commandId);
  const current = await readMissionRecord(missionId, options);
  if (['COMPLETE', 'CANCELLED'].includes(current.state.currentPhase)) {
    throw new Error('Terminal mission cannot be cancelled.');
  }
  return appendMissionEvent(missionId, {
    eventId: `cancel-${commandId}`.slice(0, 128),
    eventType: 'MISSION_CANCELLED',
    summary: text(input.reason, 'Mission cancelled by operator.'),
  }, options);
}
