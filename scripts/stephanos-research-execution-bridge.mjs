#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { consumeStephanosResearchExecutionV1 } from '../shared/agents/stephanosResearchSchedulerConsumerV1.mjs';
import {
  createSharedWorkspaceHandoffRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';

export const STEPHANOS_RESEARCH_EXECUTION_BRIDGE_SCHEMA_VERSION = 'stephanos.research-execution-bridge.v1';
export const STEPHANOS_RESEARCH_EXECUTION_REQUEST_SCHEMA_VERSION = 'stephanos.research-execution-request.v1';

const REQUEST_PREFIX = 'research-execution-request-';
const MAX_REQUESTS_PER_TICK = 8;
const MAX_REQUEST_BYTES = 64 * 1024;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function digest(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function safeFileToken(value) {
  return digest(value).slice(0, 24);
}

function compactAuthority(authority = {}) {
  return Object.freeze({
    sourceMutationAllowed: authority.sourceMutationAllowed === true,
    mergeAllowed: authority.mergeAllowed === true,
    deploymentAllowed: authority.deploymentAllowed === true,
    runtimeMutationAllowed: authority.runtimeMutationAllowed === true,
    arbitraryShellAllowed: authority.arbitraryShellAllowed === true,
    credentialOrAccountChangeAllowed: authority.credentialOrAccountChangeAllowed === true,
    spendingAllowed: authority.spendingAllowed === true,
    knowledgeAutoPromotionAllowed: authority.knowledgeAutoPromotionAllowed === true,
    schedulerAuthorityAdded: authority.schedulerAuthorityAdded === true,
    dispatchPerformed: authority.dispatchPerformed === true,
  });
}

function parseRequest(raw) {
  if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.schemaVersion !== STEPHANOS_RESEARCH_EXECUTION_REQUEST_SCHEMA_VERSION) return null;
    if (!value.mission || typeof value.mission !== 'object' || Array.isArray(value.mission)) return null;
    if (!Array.isArray(value.executionCapabilities)) return null;
    return value;
  } catch {
    return null;
  }
}

function researchStatusRecord(result, timestampUtc) {
  const projection = result.schedulerProjection || {};
  const token = safeFileToken(`${projection.researchMissionId || result.handoff?.researchMissionId || 'unknown'}:${projection.missionFingerprint || result.handoff?.missionFingerprint || ''}`);
  const ready = result.valid === true && ['READY_FOR_EXISTING_SCHEDULER', 'RETURN_RECONCILED', 'NO_EXECUTION_REQUIRED'].includes(result.state);
  return Object.freeze({
    token,
    record: Object.freeze({
      ...createSharedWorkspaceStatusRecord({
        statusId: `research-execution-${token}`,
        participantId: 'research-execution-bridge',
        timestampUtc,
        relatedIssue: '#1902',
        status: ready ? 'READY' : 'BLOCKED',
        summary: ready
          ? `Research execution ${result.state.toLowerCase().replaceAll('_', ' ')} under the existing #1556 scheduler boundary.`
          : `Research execution held: ${text(result.reason) || 'qualified route unavailable'}.`,
        proofRefs: [`research:${token}`],
      }),
      bridgeSchemaVersion: STEPHANOS_RESEARCH_EXECUTION_BRIDGE_SCHEMA_VERSION,
      researchState: result.state,
      researchMissionId: projection.researchMissionId || result.handoff?.researchMissionId || '',
      missionFingerprint: projection.missionFingerprint || result.handoff?.missionFingerprint || '',
      schedulerRoute: projection.schedulerRoute || result.handoff?.schedulerRoute || '',
      requestedTaskType: projection.requestedTaskType || result.handoff?.requestedTaskType || '',
      authority: compactAuthority(result.authority),
    }),
  });
}

function researchHandoffRecord(result, timestampUtc) {
  if (result.valid !== true || result.state !== 'READY_FOR_EXISTING_SCHEDULER') return null;
  const projection = result.schedulerProjection;
  if (!projection?.toParticipantId || !projection.researchMissionId || !projection.missionFingerprint) return null;
  const token = safeFileToken(`${projection.researchMissionId}:${projection.missionFingerprint}:${projection.schedulerRoute}`);
  const handoff = createSharedWorkspaceHandoffRecord({
    handoffId: `research-execution-${token}`,
    participantId: 'research-execution-bridge',
    fromParticipantId: 'research-execution-bridge',
    toParticipantId: projection.toParticipantId,
    timestampUtc,
    correlationId: projection.researchMissionId,
    relatedIssue: '#1902',
    proofRefs: [`research:${token}`],
    summary: `Read-only research mission ${projection.researchMissionId} is ready for the existing ${projection.schedulerRoute} scheduler route.`,
    body: JSON.stringify({
      schemaVersion: STEPHANOS_RESEARCH_EXECUTION_BRIDGE_SCHEMA_VERSION,
      schedulerOwnerGoal: '#1556',
      researchOwnerGoal: '#1902',
      researchMissionId: projection.researchMissionId,
      missionFingerprint: projection.missionFingerprint,
      requestedTaskType: projection.requestedTaskType,
      schedulerRoute: projection.schedulerRoute,
      executionCapabilityRefs: projection.executionCapabilityRefs,
      resultContract: projection.resultContract,
      missionIdentityMustRemainExact: true,
      handoff: result.handoff,
      authority: compactAuthority(result.authority),
    }),
  });
  return Object.freeze({ token, handoff });
}

export async function runStephanosResearchExecutionBridge(input = {}) {
  const repoRoot = path.resolve(text(input.repoRoot));
  const workspaceRoot = path.resolve(text(input.workspaceRoot));
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const timestampUtc = text(input.timestampUtc) || new Date(nowMs).toISOString();
  if (!text(input.repoRoot) || !text(input.workspaceRoot)) {
    return Object.freeze({ ok: false, reason: 'CANONICAL_RESEARCH_BRIDGE_PATHS_REQUIRED', processed: 0, published: 0, held: 0 });
  }

  const layout = await ensureSharedWorkspaceLayout({ root: workspaceRoot, repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, reason: layout.reason, processed: 0, published: 0, held: 0 });
  const inbox = resolveSharedWorkspacePath({ root: layout.root, repoRoot, segments: ['inbox'] });
  if (!inbox.ok) return Object.freeze({ ok: false, reason: inbox.reason, processed: 0, published: 0, held: 0 });

  let entries = [];
  try {
    entries = await readdir(inbox.path, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') return Object.freeze({ ok: false, reason: 'RESEARCH_EXECUTION_INBOX_READ_FAILED', processed: 0, published: 0, held: 0 });
  }

  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(REQUEST_PREFIX) && entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_REQUESTS_PER_TICK);

  let processed = 0;
  let published = 0;
  let held = 0;
  const results = [];

  for (const entry of candidates) {
    const resolved = resolveSharedWorkspacePath({ root: layout.root, repoRoot, segments: ['inbox', entry.name] });
    if (!resolved.ok) continue;
    let request = null;
    try { request = parseRequest(await readFile(resolved.path, 'utf8')); } catch { request = null; }
    if (!request) {
      held += 1;
      results.push(Object.freeze({ file: entry.name, state: 'BLOCKED', reason: 'RESEARCH_EXECUTION_REQUEST_INVALID' }));
      continue;
    }

    const result = consumeStephanosResearchExecutionV1(request);
    processed += 1;
    const status = researchStatusRecord(result, timestampUtc);
    const statusValidation = validateSharedWorkspaceRecord(status.record, { nowMs });
    if (!statusValidation.valid) {
      held += 1;
      results.push(Object.freeze({ file: entry.name, state: 'BLOCKED', reason: 'RESEARCH_EXECUTION_STATUS_INVALID' }));
      continue;
    }
    const statusWrite = await writeAtomicJson(layout.root, ['status', `research-execution-${status.token}.json`], status.record, { repoRoot, nowMs });
    if (!statusWrite.ok) {
      held += 1;
      results.push(Object.freeze({ file: entry.name, state: 'BLOCKED', reason: statusWrite.reason || 'RESEARCH_EXECUTION_STATUS_WRITE_FAILED' }));
      continue;
    }

    const outbound = researchHandoffRecord(result, timestampUtc);
    if (outbound) {
      const validation = validateSharedWorkspaceRecord(outbound.handoff, { nowMs });
      if (!validation.valid) {
        held += 1;
        results.push(Object.freeze({ file: entry.name, state: 'BLOCKED', reason: 'RESEARCH_EXECUTION_HANDOFF_INVALID' }));
        continue;
      }
      const handoffWrite = await writeAtomicJson(layout.root, ['handoffs', `${outbound.handoff.handoffId}.json`], outbound.handoff, { repoRoot, nowMs });
      if (!handoffWrite.ok) {
        held += 1;
        results.push(Object.freeze({ file: entry.name, state: 'BLOCKED', reason: handoffWrite.reason || 'RESEARCH_EXECUTION_HANDOFF_WRITE_FAILED' }));
        continue;
      }
      published += 1;
    } else if (result.state === 'WAITING_FOR_QUALIFIED_ROUTE' || result.valid !== true) {
      held += 1;
    }
    results.push(Object.freeze({ file: entry.name, state: result.state, reason: result.reason, researchMissionId: result.handoff?.researchMissionId || '' }));
  }

  return Object.freeze({
    schemaVersion: STEPHANOS_RESEARCH_EXECUTION_BRIDGE_SCHEMA_VERSION,
    ok: true,
    reason: candidates.length === 0 ? 'RESEARCH_EXECUTION_BRIDGE_IDLE' : 'RESEARCH_EXECUTION_BRIDGE_PASS',
    processed,
    published,
    held,
    results: Object.freeze(results),
    authority: Object.freeze({
      sourceMutationAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      arbitraryShellAllowed: false,
      credentialOrAccountChangeAllowed: false,
      spendingAllowed: false,
      knowledgeAutoPromotionAllowed: false,
      schedulerAuthorityAdded: false,
    }),
  });
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('stephanos-research-execution-bridge.mjs')) {
  const [repoRoot, workspaceRoot] = process.argv.slice(2);
  const result = await runStephanosResearchExecutionBridge({ repoRoot, workspaceRoot });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
