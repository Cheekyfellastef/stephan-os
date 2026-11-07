#!/usr/bin/env node
/**
 * Fixed, read-only, one-shot proof that Stephanos AI's existing /api/ai/chat
 * route invokes the canonical Sovereign Commander health tool on Battle Bridge.
 * Runs as an already-registered Sovereign maintenance action, no new worker,
 * shell, auth grant, public listener, source writer or scheduler.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const AI_COMMANDER_ACCEPTANCE_SCHEMA = 'stephanos.sovereign-ai-commander-acceptance.v1';
export const AI_COMMANDER_ACCEPTANCE_MARKER = 'SOVEREIGN_COMMANDER_AI_CHAT_ACCEPTANCE_RESULT=';
const ENDPOINT = 'http://127.0.0.1:8787/api/ai/chat';
const BODY_BYTES_MAX = 64 * 1024;
const FETCH_DEADLINE_MS = 12_000;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function safeToken(value) {
  const candidate = typeof value === 'string' ? value : '';
  return TOKEN.test(candidate) ? candidate : '';
}
function count(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
}
function wrap({ ok, blocker = '', observed = {} }) {
  const receipt = {
    schemaVersion: AI_COMMANDER_ACCEPTANCE_SCHEMA,
    ok: ok === true,
    toolCalled: observed.toolCalled === true,
    healthAvailable: observed.healthAvailable === true,
    guardianCycleCount: count(observed.guardianCycleCount),
    backendRoute: observed.backendRoute === 'system' ? 'system' : 'UNKNOWN',
    blocker: ok ? '' : safeToken(blocker) || 'AI_COMMANDER_TOOL_UNVERIFIED',
    readOnly: true,
    localLoopbackOnly: true,
    remoteCommanderRequired: false,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    coreAwakeProven: false,
    physicalWorkerPickupProven: false,
    finalVerdict: ok
      ? 'STEPHANOS_AI_COMMANDER_TOOL_CALL_PROVEN'
      : 'STEPHANOS_AI_COMMANDER_TOOL_CALL_BLOCKED',
  };
  receipt.proofHash = createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
  return Object.freeze(receipt);
}
export async function verifyStephanosAiCommanderTool({
  fetchFn = fetch,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);
  timer.unref?.();
  try {
    const response = await fetchFn(ENDPOINT, {
      method: 'POST', redirect: 'error', cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '/sovereign', stream: false }),
      signal: controller.signal,
    });
    if (!response || response.ok !== true || response.status !== 200) {
      const safeStatus = Number.isSafeInteger(response?.status)
        && response.status >= 400 && response.status <= 599
        ? `AI_COMMANDER_CHAT_HTTP_${response.status}`
        : 'AI_COMMANDER_CHAT_ENDPOINT_UNAVAILABLE';
      return wrap({ ok: false, blocker: safeStatus });
    }
    const length = response.headers?.get?.('content-length');
    if (length !== null && length !== undefined
      && (!/^\d+$/.test(String(length)) || Number(length) > BODY_BYTES_MAX)) {
      return wrap({ ok: false, blocker: 'AI_COMMANDER_CHAT_RESPONSE_TOO_LARGE' });
    }
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > BODY_BYTES_MAX) {
      return wrap({ ok: false, blocker: 'AI_COMMANDER_CHAT_RESPONSE_TOO_LARGE' });
    }
    let data = null;
    try { data = JSON.parse(body); } catch {}
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || data.success !== true || data.type !== 'tool_result'
      || data.route !== 'system' || data.command !== '/sovereign'
      || !Array.isArray(data.tools_used)
      || data.tools_used.length !== 1
      || data.tools_used[0] !== 'getSovereignCommanderStatus') {
      return wrap({ ok: false, blocker: 'AI_COMMANDER_CHAT_TOOL_CALL_NOT_PROVEN' });
    }
    const o = data.data?.observation;
    if (!o || o.schemaVersion !== 'stephanos.ai-sovereign-commander-health.v1'
      || o.readOnly !== true || o.localLoopbackOnly !== true
      || o.commanderMcpAccessGranted !== false || o.executionProven !== false
      || o.coreAwakeProven !== false || o.physicalWorkerPickupProven !== false
      || o.sourceMutationAllowed !== false || o.arbitraryShellAllowed !== false
      || o.mergeAuthority !== false) {
      return wrap({ ok: false, blocker: 'AI_COMMANDER_TOOL_GUARDRAILS_NOT_PROVEN' });
    }
    // A live call and a healthy Commander's service are separate evidence.
    // Only a service observed healthy can make this acceptance fully green.
    const healthy = o.available === true && o.healthy === true
      && o.state === 'SERVICE_REACHABLE';
    return wrap({
      ok: healthy,
      blocker: healthy ? '' : 'AI_COMMANDER_HEALTH_OBSERVED_BUT_HELD',
      observed: {
        toolCalled: true,
        healthAvailable: o.available === true,
        guardianCycleCount: o.guardian?.cycleCount,
        backendRoute: data.route,
      },
    });
  } catch {
    return wrap({ ok: false, blocker: 'AI_COMMANDER_CHAT_REQUEST_FAILED' });
  } finally {
    clearTimeout(timer);
  }
}
export async function runStephanosAiCommanderToolAcceptance(options = {}) {
  const result = await verifyStephanosAiCommanderTool(options);
  const emit = typeof options.emitLine === 'function' ? options.emitLine : (line) => process.stdout.write(line);
  emit(AI_COMMANDER_ACCEPTANCE_MARKER + JSON.stringify(result) + '\n');
  // Probe execution can complete even when the observed AI tool call is blocked.
  // Exit 0 so the fixed Commander process envelope preserves the typed, public-safe
  // failed-acceptance receipt. The remote mailbox must still mark such outcomes
  // BLOCKED using its independent receipt-validation gate.
  // Non-zero here collapsed the actual cause into REMOTE_RECEIPT_INVALID.
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runStephanosAiCommanderToolAcceptance();
}
