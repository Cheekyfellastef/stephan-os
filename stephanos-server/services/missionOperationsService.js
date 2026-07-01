import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildMissionOperationsProjection } from '../../shared/runtime/missionOperationsProjection.mjs';

const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_RECEIPT_FILES = 500;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function iso(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function receiptTime(document = {}, file = {}) {
  return iso(document.updatedAt || document.completedAt || document.consumedAt || document.reservedAt || document.createdAt || file.modifiedAt);
}

function stateFromVerdict(verdict = '') {
  const normalized = text(verdict).toUpperCase();
  if (/FAILED|BLOCKED|ERROR/.test(normalized)) return 'BLOCKED';
  if (/CONSUMED|PASS|COMPLETE|MERGED|DONE|SUCCESS/.test(normalized)) return 'COMPLETE';
  if (/RESERVED|RUNNING|STARTED|EXECUT/.test(normalized)) return 'RUNNING';
  if (/APPROVAL/.test(normalized)) return 'AWAITING_APPROVAL';
  if (/VERIFY|CHECK/.test(normalized)) return 'VERIFYING';
  return 'QUEUED';
}

function normalizeCommandReceipt(receipt = {}, index = 0, receiptPrefix = 'operation') {
  const exitCode = Number.isInteger(receipt.exitCode) ? receipt.exitCode : null;
  return {
    receiptId: `${receiptPrefix}-command-${index + 1}`,
    receiptType: 'command-execution',
    source: text(receipt.executable, 'unknown-executable'),
    status: exitCode === 0 ? 'success' : 'failed',
    commandOutputHash: text(receipt.commandOutputHash),
    receiptPath: text(receipt.receiptPath),
    createdAt: iso(receipt.createdAt),
  };
}

function adaptOperationResult(document = {}, file = {}) {
  const packet = document.packet || document;
  const missionId = text(packet.missionId || document.missionId);
  if (!missionId) return null;
  const finalVerdict = text(document.finalVerdict || packet.finalVerdict);
  const state = stateFromVerdict(finalVerdict);
  const receiptPrefix = text(document.authorizationId || packet.authorizationId || file.name, 'operation');
  return {
    missionId,
    title: text(document.title, `OpenClaw GitHub ${text(packet.operation, 'operation')}`),
    intendedOutcome: text(document.intendedOutcome),
    state,
    finalVerdict,
    currentPhase: text(packet.operation, 'github-operation'),
    nextAction: state === 'COMPLETE'
      ? 'Await the next signed operation or operator decision.'
      : 'Inspect the failed operation receipt before retry.',
    updatedAt: receiptTime(document, file),
    activeAgent: {
      agentId: 'openclaw-standalone',
      label: 'OpenClaw Standalone',
      role: 'executor',
      status: state === 'COMPLETE' ? 'idle' : 'active',
    },
    github: {
      repository: text(packet.repository),
      branch: text(packet.branch),
      baseBranch: text(packet.baseBranch, 'main'),
      headSha: text(packet.actualHeadSha || packet.expectedHeadSha),
      worktreePath: text(packet.worktreePath),
      changedFiles: list(packet.changedFiles),
      prNumber: Number.isInteger(packet.prNumber) ? packet.prNumber : null,
      prUrl: text(packet.prUrl),
      prState: text(packet.prState),
      mergeable: packet.mergeable === true,
      merged: packet.merged === true || text(packet.prState).toLowerCase() === 'merged' || Boolean(text(packet.mergeCommitSha)),
      mergeCommitSha: text(packet.mergeCommitSha),
      clean: packet.clean === true,
      checks: list(packet.checks).map((status, index) => ({
        id: `github-check-${index + 1}`,
        name: `Required check ${index + 1}`,
        status,
        required: true,
      })),
    },
    blockers: list(document.blockers || packet.blockers),
    receipts: [
      {
        receiptId: text(file.name, 'operation-result'),
        receiptType: text(document.schemaVersion, 'openclaw-github-operation-result'),
        source: 'openclaw-standalone',
        status: finalVerdict,
        sha256: text(document.sha256 || document.executorOutputHash),
        receiptPath: text(file.path),
        createdAt: receiptTime(document, file),
      },
      ...list(document.receipts).map((receipt, index) => normalizeCommandReceipt(receipt, index, receiptPrefix)),
    ],
  };
}

function adaptAuthorizationConsumption(document = {}, file = {}) {
  const missionId = text(document.missionId);
  if (!missionId) return null;
  const finalVerdict = text(document.finalVerdict);
  const state = stateFromVerdict(finalVerdict);
  return {
    missionId,
    title: `OpenClaw GitHub ${text(document.operation, 'operation')}`,
    state,
    finalVerdict,
    currentPhase: text(document.operation, 'authorization'),
    nextAction: state === 'RUNNING'
      ? 'Wait for the deterministic operation completion receipt.'
      : state === 'COMPLETE'
        ? 'Review the completed operation and determine the next signed action.'
        : 'Inspect the failed authorization receipt before retry.',
    startedAt: iso(document.reservedAt),
    updatedAt: receiptTime(document, file),
    activeAgent: {
      agentId: 'openclaw-standalone',
      label: 'OpenClaw Standalone',
      role: 'executor',
      status: state === 'RUNNING' ? 'active' : 'idle',
    },
    github: {
      repository: text(document.repository),
      branch: text(document.branch),
      baseBranch: 'main',
    },
    blockers: state === 'BLOCKED' ? ['The signed OpenClaw GitHub operation failed.'] : [],
    receipts: [{
      receiptId: text(document.authorizationId || file.name, 'authorization-receipt'),
      receiptType: text(document.schemaVersion, 'stephanos.openclaw-github-authorization-consumption.v1'),
      source: 'openclaw-standalone',
      status: finalVerdict,
      sha256: text(document.claimsSha256),
      receiptPath: text(file.path),
      createdAt: receiptTime(document, file),
    }],
  };
}

function adaptSnapshot(document = {}, file = {}) {
  if (document.schemaVersion !== 'stephanos.mission-operations-snapshot.v1') return null;
  const missionId = text(document.missionId || document.mission?.missionId);
  if (!missionId) return null;
  return {
    ...document,
    missionId,
    updatedAt: receiptTime(document, file),
    receipts: [
      ...list(document.receipts),
      {
        receiptId: text(file.name, 'mission-snapshot'),
        receiptType: document.schemaVersion,
        source: text(document.source, 'stephanos'),
        status: text(document.finalVerdict || document.state, 'snapshot'),
        sha256: text(document.sha256),
        receiptPath: text(file.path),
        createdAt: receiptTime(document, file),
      },
    ],
  };
}

function adaptDocument(document = {}, file = {}) {
  if (document.schemaVersion === 'stephanos.mission-operations-snapshot.v1') return adaptSnapshot(document, file);
  if (document.schemaVersion === 'stephanos.openclaw-github-authorization-consumption.v1') return adaptAuthorizationConsumption(document, file);
  if ((document.packet && document.receipts && document.finalVerdict) || document.schemaVersion === 'stephanos.openclaw-github-operation-result.v1') {
    return adaptOperationResult(document, file);
  }
  return null;
}

function mergeMissionEvents(events = []) {
  const ordered = [...events].sort((left, right) => Date.parse(left.updatedAt || 0) - Date.parse(right.updatedAt || 0));
  const merged = {};
  const receiptMap = new Map();
  for (const event of ordered) {
    Object.assign(merged, event);
    merged.mission = { ...(merged.mission || {}), ...(event.mission || {}) };
    merged.github = { ...(merged.github || {}), ...(event.github || {}) };
    for (const receipt of list(event.receipts)) {
      const key = text(receipt.receiptId || receipt.authorizationId || receipt.receiptPath);
      if (key) receiptMap.set(key, receipt);
    }
  }
  merged.receipts = [...receiptMap.values()];
  return merged;
}

export function resolveMissionOperationsDirectory(env = process.env) {
  const configured = text(env.STEPHANOS_MISSION_OPERATIONS_DIR || env.STEPHANOS_GITHUB_AUTH_RECEIPT_DIR);
  return configured ? resolve(configured) : '';
}

async function readReceiptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'));
  const discovered = await Promise.all(candidates.map(async (entry) => {
    const path = resolve(directory, entry.name);
    const metadata = await stat(path);
    return { entry, path, metadata };
  }));
  const files = discovered
    .sort((left, right) => right.metadata.mtimeMs - left.metadata.mtimeMs)
    .slice(0, MAX_RECEIPT_FILES);

  return Promise.all(files.map(async ({ entry, path, metadata }) => {
    if (metadata.size > MAX_RECEIPT_BYTES) return { name: entry.name, path, modifiedAt: metadata.mtime.toISOString(), error: 'receipt-too-large' };
    try {
      const content = await readFile(path, 'utf8');
      return { name: entry.name, path, modifiedAt: metadata.mtime.toISOString(), document: JSON.parse(content) };
    } catch (error) {
      return { name: entry.name, path, modifiedAt: metadata.mtime.toISOString(), error: error?.message || 'receipt-read-failed' };
    }
  }));
}

export async function readMissionOperations(options = {}) {
  const env = options.env || process.env;
  const directory = options.directory || resolveMissionOperationsDirectory(env);
  const now = options.now instanceof Date ? options.now : new Date();
  if (!directory) {
    return {
      schemaVersion: 'stephanos.mission-operations-feed.v1',
      status: 'needs-configuration',
      source: 'none',
      directory: '',
      missions: [],
      errors: [],
      recommendedNextAction: 'Configure STEPHANOS_MISSION_OPERATIONS_DIR to the external OpenClaw receipt directory.',
    };
  }

  let files;
  try {
    files = await readReceiptFiles(directory);
  } catch (error) {
    return {
      schemaVersion: 'stephanos.mission-operations-feed.v1',
      status: error?.code === 'ENOENT' ? 'directory-missing' : 'error',
      source: 'external-receipt-directory',
      directory,
      missions: [],
      errors: [error?.message || 'Mission receipt directory could not be read.'],
      recommendedNextAction: 'Create or restore the configured external receipt directory.',
    };
  }

  const errors = files.filter((file) => file.error).map((file) => ({ file: file.name, error: file.error }));
  const grouped = new Map();
  let ignoredReceiptCount = 0;
  for (const file of files.filter((candidate) => candidate.document)) {
    const event = adaptDocument(file.document, file);
    if (!event) {
      ignoredReceiptCount += 1;
      continue;
    }
    const missionId = text(event.missionId || event.mission?.missionId);
    if (!grouped.has(missionId)) grouped.set(missionId, []);
    grouped.get(missionId).push(event);
  }

  const missions = [...grouped.values()]
    .map((events) => buildMissionOperationsProjection(mergeMissionEvents(events), { now }))
    .sort((left, right) => Date.parse(right.mission.updatedAt || 0) - Date.parse(left.mission.updatedAt || 0));

  return {
    schemaVersion: 'stephanos.mission-operations-feed.v1',
    status: missions.length ? 'ready' : 'empty',
    source: 'external-receipt-directory',
    directory,
    generatedAt: now.toISOString(),
    receiptFileCount: files.length,
    acceptedReceiptCount: files.length - errors.length - ignoredReceiptCount,
    ignoredReceiptCount,
    missions,
    errors,
    recommendedNextAction: missions.length ? missions[0].mission.nextAction : 'Run an authorized OpenClaw operation or publish a mission snapshot.',
  };
}
