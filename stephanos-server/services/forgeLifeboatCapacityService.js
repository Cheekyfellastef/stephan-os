import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import {
  MISSION_CONTROLLER_ROUTE,
  FORGE_LIFEBOAT_WORKER_ID,
  forgeLifeboatAuthorityReceiptId,
  forgeLifeboatProofRef,
} from '../../shared/agents/missionControllerCapacityRouterV1.mjs';
import { publishGitHubContinuityCapacityPublicationV1 } from '../../shared/agents/githubContinuityCapacityPublicationV1.mjs';
import {
  createSharedWorkspaceProofRecord,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { resolveCriticalBacklogRuntimePaths } from './criticalBacklogConveyorServiceCore.js';
import { readMissionWorkerQueue } from './missionOrchestratorWorkerService.js';

export const FORGE_LIFEBOAT_CAPACITY_SCHEMA = 'stephanos.forge-lifeboat-capacity.v1';
export const FORGE_LIFEBOAT_PROOF_SCHEMA = 'stephanos.forge-lifeboat-capacity-proof.v1';
export const FORGE_LIFEBOAT_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const FORGE_LIFEBOAT_DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';
export const FORGE_LIFEBOAT_DEFAULT_MODEL = 'qwen:14b';
export const FORGE_LIFEBOAT_TASK_CLASSES = Object.freeze(['FOCUSED_REPAIR', 'MULTI_MODULE_IMPLEMENTATION']);

const SHA40 = /^[0-9a-f]{40}$/i;
const SAFE_MODEL = /^[A-Za-z0-9_.:-]{1,128}$/;
const LOOPBACK_ENDPOINTS = new Set(['http://127.0.0.1:11434', 'http://localhost:11434']);
const RECEIPT_LIFETIME_MS = 4 * 60 * 1000;
const PROBE_TIMEOUT_MS = 60 * 1000;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeOllamaBaseEndpoint(value) {
  const raw = text(value, FORGE_LIFEBOAT_DEFAULT_ENDPOINT).replace(/\/+$/, '');
  return raw.replace(/\/api\/(?:chat|generate)$/i, '').replace(/\/+$/, '');
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function defaultReadSourceHead(repoRoot) {
  const result = spawnSync('git.exe', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return '';
  const head = text(result.stdout).toLowerCase();
  return SHA40.test(head) ? head : '';
}

async function defaultProbeLocalBuilder({ endpoint, model, fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (!LOOPBACK_ENDPOINTS.has(endpoint) || !SAFE_MODEL.test(model)) {
    return Object.freeze({ ok: false, reason: 'FORGE_LIFEBOAT_LOCAL_IDENTITY_INVALID' });
  }
  const request = Object.freeze({
    model,
    prompt: 'Reply with exactly LANE6_READY',
    stream: false,
    keep_alive: '5m',
    options: Object.freeze({ temperature: 0, num_predict: 8 }),
  });
  const requestBody = JSON.stringify(request);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAtMs = Date.now();
  try {
    const response = await fetchImpl(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: requestBody,
      signal: controller.signal,
    });
    const raw = await response.text();
    const latencyMs = Math.max(1, Date.now() - startedAtMs);
    if (!response.ok) {
      return Object.freeze({ ok: false, reason: `FORGE_LIFEBOAT_MODEL_HTTP_${response.status}` });
    }
    let payload;
    try { payload = JSON.parse(raw); }
    catch { return Object.freeze({ ok: false, reason: 'FORGE_LIFEBOAT_MODEL_RESPONSE_INVALID_JSON' }); }
    if (payload?.done !== true || !text(payload?.response)) {
      return Object.freeze({ ok: false, reason: 'FORGE_LIFEBOAT_MODEL_RESPONSE_INCOMPLETE' });
    }
    return Object.freeze({
      ok: true,
      latencyMs,
      requestSha256: sha256(requestBody),
      responseSha256: sha256(raw),
      responsePreview: text(payload.response).slice(0, 64),
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error?.name === 'AbortError'
        ? 'FORGE_LIFEBOAT_MODEL_PROBE_TIMEOUT'
        : `FORGE_LIFEBOAT_MODEL_PROBE_FAILED:${text(error?.message, 'unknown')}`,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function unavailable(reason, extra = {}) {
  return Object.freeze({
    schemaVersion: FORGE_LIFEBOAT_CAPACITY_SCHEMA,
    ok: false,
    available: false,
    workerId: FORGE_LIFEBOAT_WORKER_ID,
    reason,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
    ...extra,
  });
}

export async function refreshForgeLifeboatCapacity(options = {}) {
  const env = options.env || process.env;
  const paths = options.paths || resolveCriticalBacklogRuntimePaths({ env });
  const repository = FORGE_LIFEBOAT_REPOSITORY;
  const endpoint = normalizeOllamaBaseEndpoint(options.endpoint || env.STEPHANOS_OLLAMA_ENDPOINT);
  const model = text(options.model || env.STEPHANOS_LOCAL_BUILDER_MODEL, FORGE_LIFEBOAT_DEFAULT_MODEL);
  if (!LOOPBACK_ENDPOINTS.has(endpoint) || !SAFE_MODEL.test(model)) {
    return unavailable('FORGE_LIFEBOAT_LOCAL_IDENTITY_INVALID');
  }

  const readSourceHead = options.readSourceHead || defaultReadSourceHead;
  const sourceHead = text(await readSourceHead(paths.repoRoot)).toLowerCase();
  if (!SHA40.test(sourceHead)) return unavailable('FORGE_LIFEBOAT_SOURCE_HEAD_UNPROVEN');

  const probe = options.probeLocalBuilder || defaultProbeLocalBuilder;
  const probeResult = await probe({ endpoint, model, fetchImpl: options.fetchImpl, timeoutMs: options.probeTimeoutMs });
  if (probeResult?.ok !== true) return unavailable(text(probeResult?.reason, 'FORGE_LIFEBOAT_MODEL_PROBE_FAILED'), { sourceHead });

  const readQueue = options.readQueue || readMissionWorkerQueue;
  const queue = await readQueue({ env });
  const queueDepth = Array.isArray(queue)
    ? queue.filter((entry) => text(entry?.adapter).toLowerCase() === 'foundry-forge').length
    : 0;
  if (!Number.isSafeInteger(queueDepth) || queueDepth < 0 || queueDepth > 64) {
    return unavailable('FORGE_LIFEBOAT_QUEUE_DEPTH_INVALID', { sourceHead });
  }

  const observedAt = options.now instanceof Date ? options.now : new Date();
  const observedAtUtc = observedAt.toISOString();
  const expiresAtUtc = new Date(observedAt.getTime() + RECEIPT_LIFETIME_MS).toISOString();
  const latencySeconds = Math.min(600, Math.max(0.001, Number(probeResult.latencyMs || 0) / 1000));
  const proofRef = forgeLifeboatProofRef(sourceHead);
  const authorityId = forgeLifeboatAuthorityReceiptId(sourceHead);
  const proofFile = proofRef.replace(/^proof\//, '');
  const proof = Object.freeze({
    ...createSharedWorkspaceProofRecord({
      proofId: `forge-lifeboat-${sourceHead}`,
      participantId: FORGE_LIFEBOAT_WORKER_ID,
      timestampUtc: observedAtUtc,
      correlationId: authorityId,
      relatedIssue: '#1671',
      status: 'PASS',
      summary: `Lane 6 local model ${model} answered one bounded loopback generation probe in ${latencySeconds}s on exact source ${sourceHead}.`,
      refs: [proofRef],
      proofRefs: [proofRef],
    }),
    schema: FORGE_LIFEBOAT_PROOF_SCHEMA,
    sourceHead,
    repository,
    workerId: FORGE_LIFEBOAT_WORKER_ID,
    endpoint,
    model,
    queueDepth,
    sampleCount: 1,
    observedResponseLatencySeconds: latencySeconds,
    latencySemantics: 'single live generation response latency; conservative upper bound for start latency',
    requestSha256: text(probeResult.requestSha256),
    responseSha256: text(probeResult.responseSha256),
    modelResponded: true,
    sourceConstructionAllowed: true,
    focusedTestsAllowed: true,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
    expiresAtUtc,
    finalVerdict: 'FORGE_LIFEBOAT_LOCAL_MODEL_CAPACITY_PROVEN',
  });

  const writeProof = options.writeProof || (async (record) => writeAtomicJson(
    paths.workspaceRoot,
    ['proof', proofFile],
    record,
    { repoRoot: paths.repoRoot, nowMs: observedAt.getTime() },
  ));
  const proofWrite = await writeProof(proof);
  if (proofWrite?.ok !== true) return unavailable(`FORGE_LIFEBOAT_PROOF_PUBLICATION_FAILED:${text(proofWrite?.reason, 'unknown')}`, { sourceHead });

  const receiptSeed = `${sourceHead}\n${model}\n${observedAtUtc}\n${probeResult.requestSha256}\n${probeResult.responseSha256}`;
  const observation = Object.freeze({
    receiptId: `forge-lifeboat-${sha256(receiptSeed).slice(0, 24)}`,
    route: MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
    repository,
    workerId: FORGE_LIFEBOAT_WORKER_ID,
    supportedTaskClasses: FORGE_LIFEBOAT_TASK_CLASSES,
    observedAtUtc,
    expiresAtUtc,
    queueDepth,
    p95StartLatencySeconds: latencySeconds,
    authorityReceiptIds: Object.freeze([authorityId]),
    proofRefs: Object.freeze([proofRef]),
  });

  const publishCapacity = options.publishCapacity || (async (input) => publishGitHubContinuityCapacityPublicationV1(
    paths.workspaceRoot,
    input,
    { repoRoot: paths.repoRoot, nowUtc: observedAtUtc },
  ));
  const publication = await publishCapacity(observation);
  const published = publication?.finalVerdict === 'GITHUB_CONTINUITY_CAPACITY_PUBLISHED'
    || (publication?.publication?.ok === true && publication?.workerScopedPublication?.ok === true);
  if (!published) {
    return unavailable(`FORGE_LIFEBOAT_CAPACITY_PUBLICATION_FAILED:${text(publication?.blocker || publication?.publication?.reason, 'unknown')}`, {
      sourceHead,
      proofWrite,
    });
  }

  return Object.freeze({
    schemaVersion: FORGE_LIFEBOAT_CAPACITY_SCHEMA,
    ok: true,
    available: true,
    repository,
    sourceHead,
    workerId: FORGE_LIFEBOAT_WORKER_ID,
    model,
    queueDepth,
    observedAtUtc,
    expiresAtUtc,
    observedResponseLatencySeconds: latencySeconds,
    authorityReceiptId: authorityId,
    proofRef,
    proofWrite,
    publication,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
    finalVerdict: 'FORGE_LIFEBOAT_LANE_6_CAPACITY_PUBLISHED',
  });
}
