#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveSharedWorkspacePath } from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import * as core from './battle-bridge-outbound-health-beacon-core.mjs';

export * from './battle-bridge-outbound-health-beacon-core.mjs';

export const BATTLE_BRIDGE_COMPLETE_STATE_STATUS_FILE = 'battle-bridge-complete-state-current.json';
export const BATTLE_BRIDGE_COMPLETE_STATE_MIRROR_ROLE = 'battle-bridge-complete-state-projection';

const SHA40 = /^[0-9a-f]{40}$/;

function text(value) {
  return String(value ?? '').trim();
}

function validHead(value) {
  const normalized = text(value).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function digestRecord(record) {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

function assertMirrorRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_RECORD_INVALID');
  if (record.schemaVersion !== core.BATTLE_BRIDGE_OUTBOUND_BEACON_SCHEMA) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_SCHEMA_INVALID');
  if (record.repository !== core.BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_REPOSITORY_INVALID');
  if (record.issueNumber !== core.BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_ISSUE_INVALID');
  if (record.branch !== 'main' || !validHead(record.sourceHead)) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_SOURCE_IDENTITY_INVALID');
  if (!Number.isFinite(Date.parse(text(record.observedAtUtc)))) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_TIMESTAMP_INVALID');
  if (record.readOnly !== true
      || record.sourceMutationAllowed !== false
      || record.taskMutationAllowed !== false
      || record.processRestartAllowed !== false
      || record.arbitraryShellAllowed !== false
      || record.destructiveGitAllowed !== false
      || record.liveOpenClawUpdateAllowed !== false
      || record.pcRestartAllowed !== false) {
    throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_AUTHORITY_INVALID');
  }
  return record;
}

export function mirrorBattleBridgeCompleteStateToSharedWorkspace({ workspaceRoot, repoRoot, record } = {}) {
  const validated = assertMirrorRecord(record);
  const resolved = resolveSharedWorkspacePath({
    root: workspaceRoot,
    repoRoot,
    segments: ['status', BATTLE_BRIDGE_COMPLETE_STATE_STATUS_FILE],
  });
  if (!resolved.ok) throw new Error(`BATTLE_BRIDGE_COMPLETE_STATE_MIRROR_${resolved.reason}`);

  mkdirSync(dirname(resolved.path), { recursive: true });
  const tempPath = `${resolved.path}.${process.pid}.${randomUUID()}.tmp`;
  const payload = `${JSON.stringify(validated, null, 2)}\n`;
  try {
    writeFileSync(tempPath, payload, { flag: 'wx', mode: 0o600 });
    renameSync(tempPath, resolved.path);
  } catch (error) {
    try { unlinkSync(tempPath); } catch {}
    throw error;
  }

  return Object.freeze({
    ok: true,
    state: 'SHARED_WORKSPACE_COMPLETE_STATE_MIRRORED',
    fileName: BATTLE_BRIDGE_COMPLETE_STATE_STATUS_FILE,
    schemaVersion: validated.schemaVersion,
    sourceHead: validated.sourceHead,
    observedAtUtc: validated.observedAtUtc,
    recordSha256: digestRecord(validated),
  });
}

export function compareBattleBridgeCompleteStateMirrors(githubRecord, sharedWorkspaceRecord) {
  if (!githubRecord || typeof githubRecord !== 'object' || !sharedWorkspaceRecord || typeof sharedWorkspaceRecord !== 'object') {
    return Object.freeze({ state: 'UNPROVEN', consistent: false, mismatches: Object.freeze(['record-missing']) });
  }
  const fields = [
    'schemaVersion',
    'repository',
    'issueNumber',
    'observedAtUtc',
    'sourceHead',
    'branch',
    'freshness',
    'completeStateAnswerable',
    'telemetryCompleteness',
    'operatorNeeded',
    'nextAutomaticAction',
  ];
  const mismatches = fields.filter((field) => JSON.stringify(githubRecord[field]) !== JSON.stringify(sharedWorkspaceRecord[field]));
  const githubDigest = digestRecord(githubRecord);
  const sharedWorkspaceDigest = digestRecord(sharedWorkspaceRecord);
  if (githubDigest !== sharedWorkspaceDigest && mismatches.length === 0) mismatches.push('record-digest');
  return Object.freeze({
    state: mismatches.length === 0 ? 'CONSISTENT' : 'CONFLICTING',
    consistent: mismatches.length === 0,
    sourceHead: validHead(githubRecord.sourceHead) || validHead(sharedWorkspaceRecord.sourceHead),
    observedAtUtc: text(githubRecord.observedAtUtc || sharedWorkspaceRecord.observedAtUtc),
    githubRecordSha256: githubDigest,
    sharedWorkspaceRecordSha256: sharedWorkspaceDigest,
    mismatches: Object.freeze(mismatches),
  });
}

export function runBattleBridgeOutboundHealthBeacon(options = {}) {
  const result = core.runBattleBridgeOutboundHealthBeacon(options);
  const env = options.env || process.env;
  const repoRoot = resolve(env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = resolve(env.STEPHANOS_SHARED_AGENT_WORKSPACE || join(env.USERPROFILE || homedir(), 'Documents', 'Stephanos-openclaw-workspace'));
  const mirror = typeof options.mirror === 'function' ? options.mirror : mirrorBattleBridgeCompleteStateToSharedWorkspace;
  const workspaceMirror = mirror({ workspaceRoot, repoRoot, record: result.record });
  return Object.freeze({ ...result, workspaceMirror });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = runBattleBridgeOutboundHealthBeacon();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${text(error?.message || error).slice(0, 200)}\n`);
    process.exitCode = 1;
  }
}
