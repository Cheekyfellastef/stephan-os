import { createHash, createPublicKey } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import {
  createStephanosNativeCapacityReceipt,
  createStephanosNativeSourceAuthority,
} from './stephanosNativeCapacityReceiptV1.mjs';
import {
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export const STEPHANOS_NATIVE_CAPACITY_STATUS_ID = 'stephanos-native-capacity-current';
export const STEPHANOS_NATIVE_CAPACITY_WORKER_ID = 'stephanos-native-battle-bridge';
export const STEPHANOS_NATIVE_CAPACITY_QUALIFICATION_ID = 'native-source-qualification-v1';
export const STEPHANOS_NATIVE_CAPACITY_DEFAULT_MODEL = 'qwen:14b';
export const STEPHANOS_NATIVE_CAPACITY_DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';

const SHA40 = /^[0-9a-f]{40}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ALLOWED_ENDPOINTS = new Set(['http://127.0.0.1:11434', 'http://localhost:11434']);
const QUALIFICATION_EXPECTED = Object.freeze({
  source: 'export const add=(a,b)=>a+b;',
  test: 'assert.equal(add(2,3),5);',
});

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function hash(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function frozen(value) { return Object.freeze(value); }
function timestamp(value) {
  const normalized = text(value);
  const parsed = Date.parse(normalized);
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) && Number.isFinite(parsed) ? parsed : null;
}
function safeModel(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
}
function compactTimestamp(value) {
  return value.replace(/[^0-9]/g, '').slice(0, 14);
}
function qualificationPrompt() {
  return [
    'You are qualifying for one bounded source-repair lane.',
    'Return JSON only with exactly two string fields named source and test.',
    'Repair this bug: export const add=(a,b)=>a-b;',
    'The source field must contain the corrected one-line JavaScript source.',
    'The test field must contain one Node assert line proving add(2,3) equals 5.',
    'Do not add markdown, prose, imports, comments, or extra fields.',
  ].join('\n');
}
function parseQualificationContent(value) {
  const raw = text(value).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || Object.getPrototypeOf(parsed) !== Object.prototype) return null;
  if (JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(['source', 'test'])) return null;
  if (parsed.source !== QUALIFICATION_EXPECTED.source || parsed.test !== QUALIFICATION_EXPECTED.test) return null;
  return frozen({ source: parsed.source, test: parsed.test });
}

async function fetchJson(url, init, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    let json;
    try { json = JSON.parse(raw); } catch { throw new Error('INVALID_JSON'); }
    return { raw, json };
  } finally {
    clearTimeout(timer);
  }
}

export async function clearStephanosNativeCapacityStatus(options = {}) {
  const resolved = resolveSharedWorkspacePath({
    root: options.workspaceRoot,
    repoRoot: options.repoRoot,
    segments: ['status', `${STEPHANOS_NATIVE_CAPACITY_STATUS_ID}.json`],
  });
  if (!resolved.ok) return frozen({ ok: false, reason: resolved.reason });
  try { await unlink(resolved.path); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  return frozen({ ok: true, reason: 'STEPHANOS_NATIVE_CAPACITY_STATUS_CLEARED', path: resolved.path });
}

export async function probeStephanosNativeOllamaV1(options = {}) {
  const endpoint = text(options.endpoint) || STEPHANOS_NATIVE_CAPACITY_DEFAULT_ENDPOINT;
  const model = safeModel(options.model || STEPHANOS_NATIVE_CAPACITY_DEFAULT_MODEL);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.min(Math.max(options.timeoutMs, 1_000), 180_000) : 120_000;
  const nowMs = typeof options.nowMs === 'function' ? options.nowMs : Date.now;
  if (!ALLOWED_ENDPOINTS.has(endpoint) || !model || typeof fetchImpl !== 'function') {
    return frozen({ ok: false, reason: 'native-local-transport-invalid' });
  }

  try {
    const tags = await fetchJson(`${endpoint}/api/tags`, { method: 'GET' }, Math.min(timeoutMs, 10_000), fetchImpl);
    const inventory = (Array.isArray(tags.json?.models) ? tags.json.models : [])
      .map((item) => text(item?.name))
      .filter(Boolean)
      .sort();
    if (!inventory.includes(model)) return frozen({ ok: false, reason: 'native-model-not-installed', inventory: frozen(inventory) });

    const requestBody = {
      model,
      stream: false,
      format: 'json',
      keep_alive: '5m',
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: 'Follow the qualification format exactly.' },
        { role: 'user', content: qualificationPrompt() },
      ],
    };
    const requestBytes = JSON.stringify(requestBody);
    const startedAtMs = nowMs();
    const chat = await fetchJson(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBytes,
    }, timeoutMs, fetchImpl);
    const completedAtMs = nowMs();
    const executedModel = text(chat.json?.model);
    const qualified = parseQualificationContent(chat.json?.message?.content);
    if (executedModel !== model) return frozen({ ok: false, reason: 'native-model-substitution-detected', executedModel });
    if (!qualified) return frozen({ ok: false, reason: 'native-source-qualification-failed', executedModel });

    const ps = await fetchJson(`${endpoint}/api/ps`, { method: 'GET' }, Math.min(timeoutMs, 10_000), fetchImpl);
    const loaded = (Array.isArray(ps.json?.models) ? ps.json.models : []).find((item) => text(item?.name) === model);
    if (!loaded) return frozen({ ok: false, reason: 'native-model-load-unproven', executedModel });

    const latencySeconds = Math.max(0, (Number(completedAtMs) - Number(startedAtMs)) / 1000);
    return frozen({
      ok: true,
      reason: 'STEPHANOS_NATIVE_OLLAMA_QUALIFIED',
      provider: 'ollama-local',
      transport: 'http-loopback-fixed',
      endpoint,
      model: executedModel,
      modelInventory: frozen(inventory),
      modelInventorySha256: hash(inventory.join('\n')),
      qualificationId: STEPHANOS_NATIVE_CAPACITY_QUALIFICATION_ID,
      requestSha256: hash(requestBytes),
      responseSha256: hash(chat.raw),
      tagsSha256: hash(tags.raw),
      processSha256: hash(ps.raw),
      queueDepth: 0,
      queueDepthSource: 'publisher-single-flight',
      p95StartLatencySeconds: Number(latencySeconds.toFixed(3)),
      loadState: 'READY',
      loadedModelSizeBytes: Number.isFinite(Number(loaded?.size)) ? Number(loaded.size) : 0,
      loadedModelVramBytes: Number.isFinite(Number(loaded?.size_vram)) ? Number(loaded.size_vram) : 0,
      timeoutMs,
    });
  } catch (error) {
    return frozen({
      ok: false,
      reason: error?.name === 'AbortError' ? 'native-model-probe-timeout' : 'native-model-probe-failed',
      errorCode: text(error?.message).slice(0, 80),
    });
  }
}

export async function publishStephanosNativeCapacityV1(options = {}) {
  const observedAtUtc = text(options.observedAtUtc) || new Date().toISOString();
  const observedAtMs = timestamp(observedAtUtc);
  const repository = text(options.repository);
  const sourceHead = text(options.sourceHead).toLowerCase();
  const workerId = text(options.workerId) || STEPHANOS_NATIVE_CAPACITY_WORKER_ID;
  const keyId = text(options.keyId);
  const workspaceRoot = text(options.workspaceRoot);
  const repoRoot = text(options.repoRoot);
  if (observedAtMs === null || !REPOSITORY.test(repository) || !SHA40.test(sourceHead)
    || !SAFE_ID.test(workerId) || !SAFE_ID.test(keyId) || !workspaceRoot || !repoRoot) {
    return frozen({ ok: false, reason: 'native-capacity-publication-identity-invalid' });
  }

  const cleared = await clearStephanosNativeCapacityStatus({ workspaceRoot, repoRoot });
  if (!cleared.ok) return frozen({ ok: false, reason: cleared.reason });

  try {
    const privateKeyPem = text(options.privateKeyPem)
      || (text(options.signingKeyPath) ? await readFile(text(options.signingKeyPath), 'utf8') : '');
    if (!privateKeyPem) return frozen({ ok: false, reason: 'native-capacity-signing-key-missing', cleared: true });

    const probe = await probeStephanosNativeOllamaV1(options);
    if (!probe.ok) return frozen({ ok: false, reason: probe.reason, probe, cleared: true });

    const proofSeed = JSON.stringify({
      repository, sourceHead, workerId, observedAtUtc,
      model: probe.model,
      modelInventorySha256: probe.modelInventorySha256,
      requestSha256: probe.requestSha256,
      responseSha256: probe.responseSha256,
      tagsSha256: probe.tagsSha256,
      processSha256: probe.processSha256,
    });
    const proofDigest = hash(proofSeed);
    const proofRef = `proof/native-capacity-runtime-${proofDigest}.json`;
    const proofId = `native-capacity-runtime-${proofDigest.slice(0, 40)}`;
    const runtimeProof = frozen({
      ...createSharedWorkspaceProofRecord({
        proofId,
        participantId: workerId,
        timestampUtc: observedAtUtc,
        correlationId: proofId,
        relatedIssue: '#2008',
        status: 'passed',
        summary: `Live local Ollama capacity qualified on ${probe.model}.`,
        refs: [
          `source-head:${sourceHead}`,
          `model:${probe.model}`,
          `inventory-sha256:${probe.modelInventorySha256}`,
          `request-sha256:${probe.requestSha256}`,
          `response-sha256:${probe.responseSha256}`,
          `load-state:${probe.loadState}`,
        ],
        proofRefs: [proofRef],
      }),
      provider: probe.provider,
      transport: probe.transport,
      endpoint: probe.endpoint,
      model: probe.model,
      modelInventory: probe.modelInventory,
      modelInventorySha256: probe.modelInventorySha256,
      qualificationId: probe.qualificationId,
      requestSha256: probe.requestSha256,
      responseSha256: probe.responseSha256,
      tagsSha256: probe.tagsSha256,
      processSha256: probe.processSha256,
      queueDepth: probe.queueDepth,
      queueDepthSource: probe.queueDepthSource,
      p95StartLatencySeconds: probe.p95StartLatencySeconds,
      loadState: probe.loadState,
      loadedModelSizeBytes: probe.loadedModelSizeBytes,
      loadedModelVramBytes: probe.loadedModelVramBytes,
      timeoutMs: probe.timeoutMs,
    });
    const proofWrite = await writeAtomicJson(
      workspaceRoot,
      ['proof', `${proofId}.json`],
      runtimeProof,
      { repoRoot, nowMs: observedAtMs },
    );
    if (!proofWrite.ok) return frozen({ ok: false, reason: `native-capacity-proof:${proofWrite.reason}`, cleared: true });

    const expiresAtUtc = new Date(observedAtMs + 5 * 60 * 1000).toISOString();
    const payload = frozen({
      schemaVersion: 'stephanos.native-capacity-payload.v1',
      receiptId: `native-capacity-${sourceHead.slice(0, 12)}-${compactTimestamp(observedAtUtc)}`,
      repository,
      sourceHead,
      workerId,
      provider: probe.provider,
      transport: probe.transport,
      endpoint: probe.endpoint,
      model: probe.model,
      modelInventorySha256: probe.modelInventorySha256,
      qualificationId: probe.qualificationId,
      supportedTaskClasses: frozen(['FOCUSED_REPAIR']),
      supportedOperations: frozen(['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS']),
      observedAtUtc,
      expiresAtUtc,
      queueDepth: probe.queueDepth,
      p95StartLatencySeconds: probe.p95StartLatencySeconds,
      loadState: probe.loadState,
      requestSha256: probe.requestSha256,
      responseSha256: probe.responseSha256,
      proofRefs: frozen([proofRef]),
    });
    const capacityReceipt = createStephanosNativeCapacityReceipt(payload, { privateKeyPem, keyId });
    if (!capacityReceipt) return frozen({ ok: false, reason: 'native-capacity-signing-failed', cleared: true });
    const publicKeyPem = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).toString();
    const expected = { repository, sourceHead, workerId, nowUtc: observedAtUtc, keyId };
    const sourceAuthority = createStephanosNativeSourceAuthority(capacityReceipt, { publicKeyPem, expected });
    if (!sourceAuthority) return frozen({ ok: false, reason: 'native-source-authority-derivation-failed', cleared: true });

    const receiptDigest = hash(JSON.stringify(capacityReceipt));
    const statusRecord = frozen({
      ...createSharedWorkspaceStatusRecord({
        statusId: STEPHANOS_NATIVE_CAPACITY_STATUS_ID,
        participantId: workerId,
        timestampUtc: observedAtUtc,
        relatedIssue: '#2008',
        status: 'READY',
        summary: `Stephanos-native capacity is freshly qualified on ${probe.model} for exact head ${sourceHead}.`,
        proofRefs: [proofRef],
      }),
      capacityReceipt,
      sourceAuthority,
      publisherAttestation: frozen({
        keyId,
        receiptSha256: receiptDigest,
        sourceHead,
        proofRef,
      }),
      sourceMutationAllowed: true,
      supportedOperations: frozen(['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS']),
      arbitraryCommandAllowed: false,
      mergeAuthority: false,
      leaseSeizureAllowed: false,
      duplicateDispatchAllowed: false,
    });
    const statusWrite = await writeAtomicJson(
      workspaceRoot,
      ['status', `${STEPHANOS_NATIVE_CAPACITY_STATUS_ID}.json`],
      statusRecord,
      { repoRoot, nowMs: observedAtMs },
    );
    if (!statusWrite.ok) return frozen({ ok: false, reason: `native-capacity-status:${statusWrite.reason}`, cleared: true });

    return frozen({
      ok: true,
      reason: 'STEPHANOS_NATIVE_CAPACITY_PUBLISHED',
      statusRecord,
      proofRecord: runtimeProof,
      proofRef,
      statusPath: statusWrite.path,
      expiresAtUtc,
    });
  } catch (error) {
    await clearStephanosNativeCapacityStatus({ workspaceRoot, repoRoot }).catch(() => {});
    return frozen({ ok: false, reason: 'native-capacity-publication-failed', errorCode: text(error?.code || error?.message).slice(0, 80), cleared: true });
  }
}
