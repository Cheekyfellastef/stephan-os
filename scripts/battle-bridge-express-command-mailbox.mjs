#!/usr/bin/env node
import { watch } from 'node:fs';
import { mkdir, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSharedWorkspaceHandoffRecord,
  createSharedWorkspaceMessageRecord,
  createSharedWorkspaceProofRecord,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  CHATGPT_GOAL_INTENT_RECORD_KIND,
  buildChatGptSchedulerGoalRecord,
  promoteChatGptGoalIntent,
} from './chatgpt-shared-workspace-github-relay.mjs';
import {
  EXPRESS_COMMAND_OPERATION,
  buildExpressPathGuardianRecordV1,
  buildExpressResultRecordV1,
  detectDurableMailboxDeliveryV1,
  expressCommandFileNameV1,
  expressGuardianFileNameV1,
  expressResultFileNameV1,
  validateExpressCommandRecordV1,
} from '../shared/agents/expressCommandMailboxV1.mjs';

export const EXPRESS_COMMAND_WATCHER_SCHEMA = 'stephanos.battle-bridge-express-command-watcher.v1';
export const EXPRESS_COMMAND_FALLBACK_SCAN_MS = 5000;

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const expectedRepoRoot = resolve(homedir(), 'Documents', 'GitHub', 'stephan-os');
const defaultWorkspaceRoot = resolve(homedir(), 'Documents', 'Stephanos-openclaw-workspace');
const SAFE_COMMAND_FILE = /^express-command-([a-z0-9][a-z0-9._-]{0,63})\.json$/i;
function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function samePath(left, right) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function goalIdentity(record = {}) {
  return JSON.stringify({
    issueNumber: Number(record.issueNumber) || 0,
    repository: text(record.repository).toLowerCase(),
    title: text(record.title),
    prerequisites: Array.isArray(record.prerequisites) ? record.prerequisites : [],
    priority: Number(record.priority) || 0,
    criticalPathWeight: Number(record.criticalPathWeight) || 0,
    reversibility: text(record.reversibility),
    operatorPriority: record.operatorPriority === true,
  });
}
async function readJsonIfPresent(root, segments, options = {}) {
  const resolved = resolveSharedWorkspacePath({
    root,
    repoRoot: options.repoRoot || repoRoot,
    segments,
  });
  if (!resolved.ok) return { ok: false, reason: resolved.reason, record: null };
  try {
    return {
      ok: true,
      reason: 'RECORD_PRESENT',
      record: JSON.parse(await readFile(resolved.path, 'utf8')),
      path: resolved.path,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ok: true, reason: 'RECORD_MISSING', record: null, path: resolved.path };
    }
    return { ok: false, reason: 'RECORD_READ_FAILED', record: null, path: resolved.path };
  }
}
async function archiveExpressCommandV1(root, commandId, options = {}) {
  const fileName = expressCommandFileNameV1(commandId);
  const source = resolveSharedWorkspacePath({
    root,
    repoRoot: options.repoRoot || repoRoot,
    segments: ['commands', fileName],
  });
  const target = resolveSharedWorkspacePath({
    root,
    repoRoot: options.repoRoot || repoRoot,
    segments: ['archive', fileName],
  });
  if (!source.ok || !target.ok) {
    return { ok: false, reason: source.reason || target.reason };
  }
  try {
    const existing = await readJsonIfPresent(root, ['archive', fileName], options);
    if (existing.record) {
      await unlink(source.path).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
      return { ok: true, reason: 'EXPRESS_COMMAND_ARCHIVE_ALREADY_PRESENT' };
    }
    await rename(source.path, target.path);
    return { ok: true, reason: 'EXPRESS_COMMAND_ARCHIVED' };
  } catch (error) {
    return {
      ok: error?.code === 'ENOENT',
      reason: error?.code === 'ENOENT'
        ? 'EXPRESS_COMMAND_SOURCE_ALREADY_CONSUMED'
        : 'EXPRESS_COMMAND_ARCHIVE_FAILED',
    };
  }
}

async function publishIngressProof(root, command, options = {}) {
  if (!text(command.relatedIssue) && !text(command.relatedPr)) {
    return { ok: true, reason: 'EXPRESS_INGRESS_PROOF_NOT_REQUIRED', proofRef: '' };
  }
  const proofId = 'express-ingress-' + command.commandId;
  const proofRef = 'proof/' + proofId + '.json';
  const proof = createSharedWorkspaceProofRecord({
    proofId,
    participantId: 'chatgpt',
    timestampUtc: command.timestampUtc,
    correlationId: command.commandId,
    relatedIssue: command.relatedIssue,
    relatedPr: command.relatedPr,
    status: 'PASS',
    summary: 'Remote Commander express ingress validated against the closed-world command contract.',
    refs: [proofRef],
    proofRefs: [proofRef],
  });
  const write = await writeAtomicJson(root, ['proof', proofId + '.json'], proof, {
    repoRoot: options.repoRoot || repoRoot,
    nowMs: Date.parse(command.timestampUtc),
  });
  return { ...write, proofRef };
}

async function admitExpressGoal(root, command, proofRef, options = {}) {
  const boundedPayload = command.payload || {};
  const messageId = 'express-goal-' + command.commandId;
  const message = createSharedWorkspaceMessageRecord({
    messageId,
    participantId: 'chatgpt-bridge',
    timestampUtc: command.timestampUtc,
    correlationId: command.commandId,
    relatedIssue: command.relatedIssue,
    relatedPr: command.relatedPr,
    proofRefs: proofRef ? [proofRef] : [],
    channel: 'chatgpt-participant-bridge',
    summary: 'Goal intent arrived through the Remote Commander express transport.',
    body: JSON.stringify({
      recordKind: CHATGPT_GOAL_INTENT_RECORD_KIND,
      boundedPayload,
    }),
  });
  const built = buildChatGptSchedulerGoalRecord(message, {
    nowMs: Date.parse(command.timestampUtc),
  });
  if (!built.ok) return { ok: false, reason: built.reason };

  const existing = await readJsonIfPresent(
    root,
    ['goals', built.record.goalId + '.json'],
    options,
  );
  if (!existing.ok) return existing;
  if (existing.record) {
    if (goalIdentity(existing.record) === goalIdentity(built.record)) {
      return {
        ok: true,
        reason: 'EXPRESS_GOAL_ALREADY_ADMITTED_BY_OTHER_PATH',
        goalId: built.record.goalId,
      };
    }
    return {
      ok: false,
      reason: 'EXPRESS_GOAL_IDENTITY_CONFLICT',
      goalId: built.record.goalId,
    };
  }

  const inboxFile = 'express-goal-' + command.commandId + '.json';
  const inboxWrite = await writeAtomicJson(root, ['inbox', inboxFile], message, {
    repoRoot: options.repoRoot || repoRoot,
    nowMs: Date.parse(command.timestampUtc),
  });
  if (!inboxWrite.ok) return { ok: false, reason: inboxWrite.reason };

  const promoted = await promoteChatGptGoalIntent({
    root,
    segments: ['inbox', inboxFile],
    record: message,
    writeOptions: {
      repoRoot: options.repoRoot || repoRoot,
      nowMs: Date.parse(command.timestampUtc),
    },
  });
  return {
    ok: promoted.ok === true,
    reason: promoted.reason,
    goalId: promoted.goalId || built.record.goalId,
    issueNumber: promoted.issueNumber || built.record.issueNumber,
  };
}

async function publishExpressHandoff(root, command, proofRef, options = {}) {
  if (!proofRef) return { ok: false, reason: 'EXPRESS_HANDOFF_PROOF_REQUIRED' };
  const handoffId = 'express-handoff-' + command.commandId;
  const handoff = createSharedWorkspaceHandoffRecord({
    handoffId,
    participantId: 'chatgpt',
    fromParticipantId: 'chatgpt',
    toParticipantId: command.recipient,
    timestampUtc: command.timestampUtc,
    correlationId: command.commandId,
    relatedIssue: command.relatedIssue,
    relatedPr: command.relatedPr,
    proofRefs: [proofRef],
    summary: 'Express command handed to the canonical Shared Workspace control plane.',
    body: JSON.stringify({
      schemaVersion: 'stephanos.express-command-mailbox.v1',
      commandId: command.commandId,
      missionId: command.missionId,
      operation: command.operation,
      payload: command.payload,
      mergeAuthority: false,
      arbitraryShellAllowed: false,
    }),
  });
  return writeAtomicJson(root, ['inbox', handoffId + '.json'], handoff, {
    repoRoot: options.repoRoot || repoRoot,
    nowMs: Date.parse(command.timestampUtc),
  });
}

async function publishPathGuardian(root, command, options = {}) {
  const durable = await detectDurableMailboxDeliveryV1(
    root,
    command.commandId,
    { repoRoot: options.repoRoot || repoRoot },
  );
  const guardian = buildExpressPathGuardianRecordV1(command, {
    durableObserved: durable.observed,
    durableProofRef: durable.proofRef,
  }, {
    timestampUtc: options.timestampUtc || new Date().toISOString(),
  });
  const write = await writeAtomicJson(
    root,
    ['events', expressGuardianFileNameV1(command.commandId)],
    guardian,
    {
      repoRoot: options.repoRoot || repoRoot,
      nowMs: Date.parse(guardian.timestampUtc),
    },
  );
  return { ...write, guardian, durable };
}

export async function processExpressCommandV1(root, command = {}, options = {}) {
  const validation = validateExpressCommandRecordV1(command, {
    nowMs: Number.isFinite(options.nowMs) ? options.nowMs : Date.now(),
  });
  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.reason,
      commandId: validation.commandId,
      terminal: true,
    };
  }
  const existingResult = await readJsonIfPresent(
    root,
    ['receipts', expressResultFileNameV1(command.commandId)],
    options,
  );
  if (!existingResult.ok) {
    return { ok: false, reason: existingResult.reason, commandId: command.commandId };
  }
  if (existingResult.record) {
    const guardian = await publishPathGuardian(root, command, options);
    return {
      ok: existingResult.record.status === 'COMPLETED',
      reason: 'EXPRESS_COMMAND_ALREADY_PROCESSED',
      commandId: command.commandId,
      duplicateSuppressed: true,
      guardian: guardian.guardian,
      terminal: guardian.ok === true,
    };
  }

  const proof = await publishIngressProof(root, command, options);
  let result;
  if (!proof.ok) {
    result = { ok: false, reason: proof.reason };
  } else if (command.operation === EXPRESS_COMMAND_OPERATION.PING) {
    result = { ok: true, reason: 'EXPRESS_PING_ACKNOWLEDGED' };
  } else if (command.operation === EXPRESS_COMMAND_OPERATION.HANDOFF) {
    const handoff = await publishExpressHandoff(root, command, proof.proofRef, options);
    result = { ok: handoff.ok === true, reason: handoff.reason };
  } else if (command.operation === EXPRESS_COMMAND_OPERATION.ADMIT_GOAL) {
    result = await admitExpressGoal(root, command, proof.proofRef, options);
  } else {
    result = { ok: false, reason: 'EXPRESS_OPERATION_NOT_IMPLEMENTED' };
  }

  const resultRecord = buildExpressResultRecordV1(command, result, {
    timestampUtc: options.timestampUtc || new Date().toISOString(),
  });
  const resultWrite = await writeAtomicJson(
    root,
    ['receipts', expressResultFileNameV1(command.commandId)],
    resultRecord,
    {
      repoRoot: options.repoRoot || repoRoot,
      nowMs: Date.parse(resultRecord.timestampUtc),
    },
  );
  const guardian = await publishPathGuardian(root, command, options);
  return {
    ok: result.ok === true && resultWrite.ok === true && guardian.ok === true,
    reason: result.reason,
    commandId: command.commandId,
    resultRecord,
    guardian: guardian.guardian,
    durable: guardian.durable,
    terminal: resultWrite.ok === true && guardian.ok === true,
  };
}

export async function drainExpressCommandMailboxV1(root, options = {}) {
  const layout = await ensureSharedWorkspaceLayout({
    root,
    repoRoot: options.repoRoot || repoRoot,
  });
  if (!layout.ok) return { ok: false, reason: layout.reason, processed: [] };

  const commandsPath = resolve(layout.root, 'commands');
  let names = [];
  try {
    names = await readdir(commandsPath);
  } catch (error) {
    return {
      ok: false,
      reason: 'EXPRESS_COMMAND_DIRECTORY_READ_FAILED',
      error: text(error?.message),
      processed: [],
    };
  }

  const processed = [];
  for (const name of names.filter((value) => SAFE_COMMAND_FILE.test(value)).sort()) {
    const match = SAFE_COMMAND_FILE.exec(name);
    const commandId = match?.[1] || '';
    if (name !== expressCommandFileNameV1(commandId)) continue;
    try {
      const command = JSON.parse(await readFile(resolve(commandsPath, name), 'utf8'));
      const result = await processExpressCommandV1(layout.root, command, options);
      if (result.terminal === true) {
        result.archive = await archiveExpressCommandV1(layout.root, commandId, options);
      }
      processed.push(result);
    } catch (error) {
      processed.push({
        ok: false,
        reason: 'EXPRESS_COMMAND_READ_OR_PARSE_FAILED',
        commandId,
        error: text(error?.message),
      });
    }
  }
  return {
    ok: processed.every((item) => item.ok === true),
    reason: 'EXPRESS_COMMAND_MAILBOX_DRAINED',
    processed,
  };
}

export async function reconcileDurableReceiptV1(root, fileName, options = {}) {
  const match = /^([a-z0-9][a-z0-9._-]{0,63})\.json$/i.exec(text(fileName));
  if (!match) return { ok: true, reason: 'DURABLE_RECEIPT_NOT_EXPRESS_CORRELATED' };
  const commandId = match[1];

  let source = await readJsonIfPresent(
    root,
    ['archive', expressCommandFileNameV1(commandId)],
    options,
  );
  if (!source.ok) return source;
  if (!source.record) {
    source = await readJsonIfPresent(
      root,
      ['commands', expressCommandFileNameV1(commandId)],
      options,
    );
  }
  if (!source.ok || !source.record) {
    return { ok: true, reason: 'EXPRESS_COMMAND_NOT_OBSERVED_FOR_DURABLE_RECEIPT' };
  }

  const validation = validateExpressCommandRecordV1(source.record, {
    nowMs: Number.isFinite(options.nowMs) ? options.nowMs : Date.now(),
    staleAfterMs: Number.MAX_SAFE_INTEGER,
    allowExpired: true,
  });
  if (!validation.ok) {
    return { ok: false, reason: validation.reason, commandId };
  }
  const guardian = await publishPathGuardian(root, source.record, options);
  return {
    ok: guardian.ok === true,
    reason: guardian.durable?.observed
      ? 'EXPRESS_PATH_GUARDIAN_BOTH_OBSERVED'
      : 'EXPRESS_PATH_GUARDIAN_DURABLE_NOT_CONFIRMED',
    commandId,
    guardian: guardian.guardian,
  };
}

async function main() {
  if (!samePath(repoRoot, expectedRepoRoot)) {
    throw new Error('EXPRESS_MAILBOX_CANONICAL_CHECKOUT_REQUIRED:' + expectedRepoRoot);
  }
  const root = resolve(
    process.env.STEPHANOS_SHARED_AGENT_WORKSPACE || defaultWorkspaceRoot,
  );
  const once = process.argv.includes('--once');
  let drainPromise = Promise.resolve();
  let guardianPromise = Promise.resolve();

  const queueDrain = () => {
    drainPromise = drainPromise.then(async () => {
      const result = await drainExpressCommandMailboxV1(root, { repoRoot });
      process.stdout.write(JSON.stringify({
        checkedAt: new Date().toISOString(),
        schemaVersion: EXPRESS_COMMAND_WATCHER_SCHEMA,
        ...result,
      }) + '\n');
    }).catch((error) => {
      process.stderr.write(JSON.stringify({
        checkedAt: new Date().toISOString(),
        finalVerdict: 'EXPRESS_COMMAND_MAILBOX_DRAIN_FAILED',
        error: text(error?.message),
      }) + '\n');
    });
    return drainPromise;
  };

  const queueGuardian = (fileName) => {
    guardianPromise = guardianPromise.then(() => reconcileDurableReceiptV1(
      root,
      String(fileName || ''),
      { repoRoot },
    )).catch(() => {});
    return guardianPromise;
  };

  await queueDrain();
  if (once) return;

  const commandsPath = resolve(root, 'commands');
  const durableReceiptPath = resolve(root, 'receipts', 'github-command-mailbox');
  await mkdir(durableReceiptPath, { recursive: true });

  const commandWatcher = watch(
    commandsPath,
    { persistent: true },
    (_eventType, fileName) => {
      if (!fileName || SAFE_COMMAND_FILE.test(String(fileName))) queueDrain();
    },
  );
  const durableWatcher = watch(
    durableReceiptPath,
    { persistent: true },
    (_eventType, fileName) => {
      if (fileName) queueGuardian(fileName);
    },
  );
  const fallback = setInterval(queueDrain, EXPRESS_COMMAND_FALLBACK_SCAN_MS);
  fallback.unref();

  process.stdout.write(JSON.stringify({
    startedAt: new Date().toISOString(),
    schemaVersion: EXPRESS_COMMAND_WATCHER_SCHEMA,
    workspaceRoot: root,
    eventDriven: true,
    fallbackScanMs: EXPRESS_COMMAND_FALLBACK_SCAN_MS,
    shellExecution: 'NOT_EXPOSED',
    mergeAuthority: false,
    finalVerdict: 'EXPRESS_COMMAND_MAILBOX_WATCHING',
  }) + '\n');
  const close = () => {
    commandWatcher.close();
    durableWatcher.close();
    clearInterval(fallback);
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify({
      finalVerdict: 'EXPRESS_COMMAND_MAILBOX_START_FAILED',
      error: text(error?.message),
    }) + '\n');
    process.exitCode = 1;
  });
}
