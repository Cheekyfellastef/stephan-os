#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  GUARDED_GOAL_RUNNER_V1_BLOCKERS as B,
  GUARDED_GOAL_RUNNER_V1_OUTCOMES as O,
  classifyGuardedGoalRunnerV1,
} from '../shared/agents/guardedGoalRunnerV1.mjs';

export const GUARDED_GOAL_RUNNER_CURRENT_SCHEMA = 'stephanos.guarded-goal-runner-current.v1';
export const SUPERVISOR_CURRENT_RELATIVE_PATH = path.join('status', 'battle-bridge-ignition-supervisor-current.json');
export const GUARDED_GOAL_RUNNER_CURRENT_RELATIVE_PATH = path.join('status', 'guarded-goal-runner-current.json');

const KNOWN_SUPERVISOR_BLOCKER_MAP = Object.freeze({
  'openclaw-config-write-rejected': B.CONFIG_WRITE_REJECTED,
  'startup-token-missing': B.STARTUP_TOKEN_MISSING,
  'startup-approval-required': B.STARTUP_APPROVAL_REQUIRED,
  'spawn-openclaw-enoent': B.SPAWN_OPENCLAW_ENOENT,
  'spawn-einval': B.SPAWN_EINVAL,
  'openclaw-health-live': B.OPENCLAW_HEALTH_LIVE,
  'served-runtime-exact-head-green': B.SERVED_RUNTIME_EXACT_HEAD_GREEN,
  'served-runtime-stale': B.SERVED_RUNTIME_STALE,
  'exact-head-mismatch': B.EXACT_HEAD_MISMATCH,
});

function clean(value) { return String(value ?? '').trim(); }
function bool(value) { return value === true; }

function collectLogPaths(record = {}) {
  const paths = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.logPath === 'string' && value.logPath.trim()) paths.add(value.logPath.trim());
    if (value.logs && typeof value.logs === 'object') visit(value.logs);
    for (const key of ['stdoutLogPath', 'stderrLogPath']) {
      if (typeof value[key] === 'string' && value[key].trim()) paths.add(value[key].trim());
    }
  };
  visit(record);
  for (const service of Object.values(record.services || {})) visit(service);
  for (const phase of Object.values(record.phases || {})) visit(phase);
  return [...paths].sort();
}

function summarizeService(service = {}) {
  return {
    state: clean(service.state) || 'unknown',
    ready: bool(service.ready),
    evidence: service.evidence ?? null,
  };
}

function summarizeServedRuntimeProof(record = {}) {
  const proof = record.services?.stephanosUi4173?.servedRuntimeProof || record.servedRuntimeProof || null;
  if (!proof) return null;
  return {
    ready: bool(proof.ready),
    currentHead: clean(proof.currentHead || proof.current_head_sha),
    expectedHead: clean(proof.expectedHead || proof.expected_head_sha || record.expectedHeadSha || record.expected_head_sha),
    detail: proof.detail || proof.reason || null,
  };
}

function inferExpectedHead(record = {}, currentHead = '') {
  return clean(record.expectedHeadSha || record.expected_head_sha || record.services?.stephanosUi4173?.servedRuntimeProof?.expectedHead || record.services?.stephanosUi4173?.servedRuntimeProof?.currentHead || currentHead);
}

function inferBlocker(record = {}, currentHead = '') {
  const explicit = clean(record.blockerId || record.blocker || record.status || record.kind);
  if (explicit) return KNOWN_SUPERVISOR_BLOCKER_MAP[explicit] || explicit;
  const served = record.services?.stephanosUi4173?.servedRuntimeProof;
  const expected = inferExpectedHead(record, currentHead);
  if (record.trafficLight === 'green' && record.currentPhase === 'ready' && served?.ready === true) {
    if (clean(served.currentHead) === expected && expected === currentHead) return B.SERVED_RUNTIME_EXACT_HEAD_GREEN;
    return clean(served.currentHead) && clean(served.currentHead) !== currentHead ? B.EXACT_HEAD_MISMATCH : B.SERVED_RUNTIME_STALE;
  }
  return '';
}

export function supervisorRecordToGuardedGoalRunnerProofPacket({ supervisorRecord, currentHead }) {
  const expected = inferExpectedHead(supervisorRecord, currentHead);
  const blocker = inferBlocker(supervisorRecord, currentHead);
  return {
    supervisorCurrentRecord: { ...supervisorRecord, blocker, expectedHeadSha: expected },
    currentSourceHead: { sha: clean(currentHead) },
    prPublicationStatus: { state: 'published' },
    pr: { expectedHeadSha: expected, headSha: clean(currentHead), mergeable: true, conflicting: false },
    logPaths: collectLogPaths(supervisorRecord),
    allowedTests: [
      'node --test shared/agents/guardedGoalRunner*.test.mjs',
      'node --test scripts/guarded-goal-runner*.test.mjs',
      'git diff --check',
    ],
  };
}

function nextOperatorActionFor(nextAction, supervisorRecord = {}) {
  if (nextAction.operatorApproval?.action) return nextAction.operatorApproval.action;
  if (supervisorRecord.nextOperatorAction) return supervisorRecord.nextOperatorAction;
  if (nextAction.outcome === O.GOAL_GREEN) return 'Prepare bounded PR publication proof; do not merge.';
  if (nextAction.outcome === O.ABORT_MISSING_PROOF) return 'Run Battle Bridge ignition supervisor to produce current proof, then rerun Guarded Goal Runner intake.';
  return nextAction.reason;
}

function allowedNextStepFor(nextAction) {
  if (nextAction.outcome === O.KNOWN_BLOCKER_NEXT_PATCH) return 'write-bounded-source-or-proof-patch';
  if (nextAction.outcome === O.GOAL_GREEN) return 'operator-pr-publication-proof-only';
  if (nextAction.outcome === O.ABORT_MISSING_PROOF) return 'produce-supervisor-current-record';
  return 'stop-and-report';
}

export function buildGuardedGoalRunnerCurrentPacket({ repoRoot, sharedWorkspaceRoot, currentHead, supervisorRecord = null, sourceProofPath }) {
  const proofPacket = supervisorRecord ? supervisorRecordToGuardedGoalRunnerProofPacket({ supervisorRecord, currentHead }) : { supervisorCurrentRecord: null };
  const nextAction = classifyGuardedGoalRunnerV1(proofPacket);
  const safeToMerge = nextAction.outcome === O.SAFE_TO_MERGE_WITH_EXPECTED_HEAD;
  return {
    schema: GUARDED_GOAL_RUNNER_CURRENT_SCHEMA,
    generatedAt: new Date().toISOString(),
    issue: 1497,
    repositoryRoot: repoRoot,
    sharedWorkspaceRoot,
    currentHead: clean(currentHead),
    sourceProofPath,
    outcome: nextAction.outcome,
    blockerId: nextAction.blocker || null,
    nextOperatorAction: nextOperatorActionFor(nextAction, supervisorRecord || {}),
    safeToMerge,
    performsMerge: false,
    performsShellExecution: false,
    allowedNextStep: allowedNextStepFor(nextAction),
    ...(nextAction.outcome.startsWith('abort-') ? { abortReason: nextAction.reason } : {}),
    proofSummary: {
      backend8787: summarizeService(supervisorRecord?.services?.backend8787),
      openClaw18789: summarizeService(supervisorRecord?.services?.openClaw18789),
      stephanosUi4173: summarizeService(supervisorRecord?.services?.stephanosUi4173),
      servedRuntimeProof: supervisorRecord ? summarizeServedRuntimeProof(supervisorRecord) : null,
      runtimeOnlyDirtCaveat: supervisorRecord?.runtimeOnlyDirtCaveat || null,
    },
    logPaths: supervisorRecord ? collectLogPaths(supervisorRecord) : [],
  };
}

export function runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot, currentHead, now = null } = {}) {
  if (!repoRoot || !sharedWorkspaceRoot || !currentHead) throw new Error('repoRoot, sharedWorkspaceRoot, and currentHead are required.');
  const sourceProofPath = path.join(sharedWorkspaceRoot, SUPERVISOR_CURRENT_RELATIVE_PATH);
  const outputPath = path.join(sharedWorkspaceRoot, GUARDED_GOAL_RUNNER_CURRENT_RELATIVE_PATH);
  const supervisorRecord = fs.existsSync(sourceProofPath) ? JSON.parse(fs.readFileSync(sourceProofPath, 'utf8')) : null;
  const packet = buildGuardedGoalRunnerCurrentPacket({ repoRoot, sharedWorkspaceRoot, currentHead, supervisorRecord, sourceProofPath });
  if (now) packet.generatedAt = now;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
  return { outputPath, packet };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1];
    if (argv[i].startsWith('--')) i += 1;
  }
  return args;
}

export function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1], cwd = process.cwd(), platform = process.platform } = {}) {
  if (!argv1) return false;
  const modulePath = fileURLToPath(metaUrl);
  const scriptPath = platform === 'win32' ? path.win32.resolve(cwd, argv1) : path.resolve(cwd, argv1);
  const normalizeForPlatform = (value) => {
    const normalized = (platform === 'win32' ? path.win32.normalize(value) : path.normalize(value));
    if (platform !== 'win32') return normalized;
    return normalized.replace(/^\\([A-Za-z]:\\)/, '$1').toLowerCase();
  };
  return normalizeForPlatform(modulePath) === normalizeForPlatform(scriptPath);
}

if (isDirectCliEntrypoint()) {
  const args = parseArgs(process.argv.slice(2));
  const result = runGuardedGoalRunnerCurrent({ repoRoot: args.repoRoot, sharedWorkspaceRoot: args.sharedWorkspaceRoot, currentHead: args.currentHead });
  process.stdout.write(`${result.outputPath}\n`);
}
