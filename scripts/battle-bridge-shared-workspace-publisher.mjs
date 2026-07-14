#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { collectLauncherReadinessLiveFacts, resolveSharedWorkspaceRoot } from './launcher-readiness-live-facts.mjs';
import { SHARED_WORKSPACE_RECORD_KINDS, SHARED_WORKSPACE_RECORD_SCHEMA_VERSION, validateSharedWorkspaceRecord } from '../shared/agents/sharedAgentWorkspaceStore.mjs';

export const BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_SCHEMA = 'stephanos.battle-bridge-shared-workspace-publisher.v1';
export const BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_CORRELATION_ID = 'issue-1290-battle-bridge-current';
export const BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_RELATED_ISSUE = '#1290';
export const BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_AUTHORITY = Object.freeze({
  executesCommands: false,
  executesArbitraryShell: false,
  startsServices: false,
  killsProcesses: false,
  mergesOrPushes: false,
  mutatesRepoFiles: false,
  writesSharedWorkspaceRecordsOnlyWhenInvoked: true,
  allowedWriteRoutes: Object.freeze([
    'status/battle-bridge-current.json',
    'proof/battle-bridge-current.json',
    'events/battle-bridge-current.json',
  ]),
});

const RECORD_ROUTES = Object.freeze({
  status: Object.freeze(['status', 'battle-bridge-current.json']),
  proof: Object.freeze(['proof', 'battle-bridge-current.json']),
  event: Object.freeze(['events', 'battle-bridge-current.json']),
});

function requireFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseArgs(argv) {
  const args = { pretty: true, sharedWorkspace: null, allowRepoLocalFallback: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') args.pretty = false;
    else if (argv[i] === '--shared-workspace') { args.sharedWorkspace = requireFlagValue(argv, i, '--shared-workspace'); i += 1; }
    else if (argv[i] === '--allow-repo-local-fallback') args.allowRepoLocalFallback = true;
    else if (argv[i] === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertSafePublisherWorkspace(resolvedWorkspace, repoRoot, { allowRepoLocalFallback = false } = {}) {
  if (resolvedWorkspace.fallback && !allowRepoLocalFallback) throw new Error('Refusing repo-local shared workspace fallback for publisher writes; pass --shared-workspace or --allow-repo-local-fallback for tests/dev.');
  if (isWithin(repoRoot, resolvedWorkspace.root) && !allowRepoLocalFallback) throw new Error('Refusing to write Battle Bridge publisher records inside the repository.');
  return resolvedWorkspace;
}

function serviceReady(facts, id) {
  return facts?.observedFacts?.services?.[id]?.ready === true;
}

export function deriveBattleBridgePublicationStatus(facts = {}) {
  const backendReady = serviceReady(facts, 'backend');
  const uiReady = serviceReady(facts, 'stephanos-ui');
  const openClawReady = serviceReady(facts, 'openclaw-gateway');
  if (backendReady && uiReady && openClawReady) return { status: 'READY', readiness: 'READY', summary: 'Battle Bridge backend, OpenClaw gateway, Stephanos UI, and shared workspace publisher records are ready.' };
  if (backendReady && openClawReady && !uiReady) return { status: 'DEGRADED', readiness: 'PARTIAL_UI_MISSING', summary: 'Battle Bridge backend and OpenClaw gateway are connected, but Stephanos UI 4173 is missing.' };
  return { status: 'DEGRADED', readiness: 'DEGRADED', summary: 'Battle Bridge publisher refresh observed one or more unavailable services without starting or killing services.' };
}

function observedServiceFacts(facts = {}) {
  const services = facts?.observedFacts?.services || {};
  return Object.fromEntries(['backend', 'openclaw-gateway', 'stephanos-ui', 'shared-workspace'].map((id) => [id, {
    ready: services[id]?.ready === true,
    evidence: services[id]?.evidence || null,
  }]));
}

export function createBattleBridgeSharedWorkspaceRecords({
  facts = {},
  timestampUtc = new Date().toISOString(),
  mode = 'explicit-refresh',
  workspace = {},
  correlationId = BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_CORRELATION_ID,
  relatedIssue = BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_RELATED_ISSUE,
  relatedPr = '',
} = {}) {
  const publication = deriveBattleBridgePublicationStatus(facts);
  const proofRefs = ['proof/battle-bridge-current.json'];
  const issueOrPrCorrelation = String(relatedPr || '').trim()
    ? { relatedPr: String(relatedPr).trim() }
    : { relatedIssue: String(relatedIssue || BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_RELATED_ISSUE).trim() };
  const source = {
    schema: BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_SCHEMA,
    mode,
    workspaceSource: workspace.source || 'unknown',
    workspaceFallback: workspace.fallback === true,
    authority: BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_AUTHORITY,
  };
  const common = {
    timestampUtc,
    status: publication.status,
    summary: publication.summary,
    readiness: publication.readiness,
    observedServiceFacts: observedServiceFacts(facts),
    source,
  };
  return Object.freeze({
    status: { schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION, kind: SHARED_WORKSPACE_RECORD_KINDS.STATUS, statusId: 'battle-bridge-current', ...common, proofRefs },
    proof: {
      schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
      kind: SHARED_WORKSPACE_RECORD_KINDS.PROOF,
      proofId: 'battle-bridge-current',
      correlationId,
      ...issueOrPrCorrelation,
      ...common,
      proofRefs,
      refs: proofRefs,
      proofCommand: 'node scripts/battle-bridge-shared-workspace-publisher.mjs --shared-workspace <path> --json',
    },
    event: { schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION, kind: SHARED_WORKSPACE_RECORD_KINDS.EVENT, eventId: 'battle-bridge-current', eventKind: 'battle-bridge-shared-workspace-refresh', ...common, proofRefs },
  });
}

async function writeAtomicJsonWithinRoot(root, segments, record, options = {}) {
  const validation = validateSharedWorkspaceRecord(record, options);
  if (!validation.valid) return { ok: false, reason: validation.refusalReason, validation };
  const target = path.resolve(root, ...segments);
  if (!isWithin(root, target)) return { ok: false, reason: 'UNSAFE_WORKSPACE_PATH' };
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tempPath = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  await fs.writeFile(tempPath, payload, { flag: 'wx', mode: 0o600 });
  await fs.rename(tempPath, target);
  return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', path: target, bytes: Buffer.byteLength(payload) };
}

export async function refreshBattleBridgeSharedWorkspacePublisher(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const workspace = assertSafePublisherWorkspace(resolveSharedWorkspaceRoot(repoRoot, options), repoRoot, options);
  const facts = options.facts || await collectLauncherReadinessLiveFacts({ ...options, repoRoot, sharedWorkspace: workspace.root });
  const timestampUtc = options.timestampUtc || new Date().toISOString();
  const records = createBattleBridgeSharedWorkspaceRecords({
    facts,
    timestampUtc,
    workspace,
    correlationId: options.correlationId,
    relatedIssue: options.relatedIssue,
    relatedPr: options.relatedPr,
  });
  const writes = [];
  writes.push(await writeAtomicJsonWithinRoot(workspace.root, RECORD_ROUTES.status, records.status, { nowMs: Date.parse(timestampUtc) }));
  writes.push(await writeAtomicJsonWithinRoot(workspace.root, RECORD_ROUTES.proof, records.proof, { nowMs: Date.parse(timestampUtc) }));
  writes.push(await writeAtomicJsonWithinRoot(workspace.root, RECORD_ROUTES.event, records.event, { nowMs: Date.parse(timestampUtc) }));
  const failed = writes.find((write) => !write.ok);
  return { schema: BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_SCHEMA, ok: !failed, status: records.status.status, readiness: records.status.readiness, summary: records.status.summary, workspace, writes, authority: BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_AUTHORITY };
}

export async function main(argv = process.argv.slice(2), stdout = process.stdout) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write('Usage: node scripts/battle-bridge-shared-workspace-publisher.mjs --shared-workspace <path> [--json] [--allow-repo-local-fallback]\n');
    return 0;
  }
  const result = await refreshBattleBridgeSharedWorkspacePublisher(args);
  stdout.write(`${JSON.stringify(result, null, args.pretty ? 2 : 0)}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
