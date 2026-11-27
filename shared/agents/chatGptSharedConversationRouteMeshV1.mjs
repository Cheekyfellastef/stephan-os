import { createHash } from 'node:crypto';

export const SHARED_CONVERSATION_ROUTE_MESH_SCHEMA = 'stephanos.shared-conversation-route-mesh.v1';
export const SHARED_CONVERSATION_ROUTE_IDS = Object.freeze({
  OPENCLAW_GATEWAY_RPC: 'openclaw-gateway-rpc',
  SHARED_WORKSPACE_INBOX: 'shared-workspace-inbox',
  GITHUB_SIGNED_REPLY: 'github-signed-reply',
  OPENCLAW_REVERSE_POLL: 'openclaw-reverse-poll',
  SOVEREIGN_COMMANDER_LOCAL: 'sovereign-commander-local',
  CHATGPT_REMOTE_MCP: 'chatgpt-remote-mcp',
  GITHUB_COMMENT_CARRIER: 'github-comment-carrier',
  GITHUB_BROWSER_CARRIER: 'github-browser-carrier',
});
const CATALOG = Object.freeze({
  'openclaw-gateway-rpc': { failureDomain: 'openclaw-gateway', role: 'native-reply' },
  'shared-workspace-inbox': { failureDomain: 'shared-workspace', role: 'reconciliation' },
  'github-signed-reply': { failureDomain: 'github', role: 'native-reply' },
  'openclaw-reverse-poll': { failureDomain: 'openclaw-runtime', role: 'native-reply' },
  'sovereign-commander-local': { failureDomain: 'sovereign-commander', role: 'native-reply' },
  'chatgpt-remote-mcp': { failureDomain: 'chatgpt-remote-mcp-tunnel', role: 'native-reply' },
  'github-comment-carrier': { failureDomain: 'github', role: 'carrier-only' },
  'github-browser-carrier': { failureDomain: 'github', role: 'carrier-only' },
});
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const ISSUE_ID = /^#[1-9][0-9]{0,6}$/;
const SECRET_TEXT = /(?:BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-)/i;
const DISPOSITIONS = new Set(['accepted', 'transport-failure', 'application-denied', 'uncertain']);
const RECEIPT_KEYS = [
  'routeId', 'requestId', 'messageId', 'threadId', 'turnId', 'relatedIssue',
  'idempotencyKey', 'receiptId', 'replyText', 'transportIdentity', 'executionSurface',
  'sourceMutationAllowed', 'commandExecutionAllowed', 'approvalAllowed', 'mergeAllowed',
  'modelResponseProven',
];

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try { const p = Object.getPrototypeOf(value); return p === Object.prototype || p === null; }
  catch { return false; }
}
function hash(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function exact(value, keys) {
  return plain(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function envelopeOf(value) {
  const keys = ['requestId', 'messageId', 'threadId', 'turnId', 'relatedIssue', 'text'];
  if (!exact(value, keys)) return { ok: false, reason: 'ROUTE_ENVELOPE_SHAPE_INVALID' };
  if (keys.slice(0, 4).some((key) => typeof value[key] !== 'string' || !SAFE_ID.test(value[key]))) return { ok: false, reason: 'ROUTE_ENVELOPE_ID_INVALID' };
  if (typeof value.relatedIssue !== 'string' || !ISSUE_ID.test(value.relatedIssue)) return { ok: false, reason: 'ROUTE_ENVELOPE_ISSUE_INVALID' };
  if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 1200 || SECRET_TEXT.test(value.text)) return { ok: false, reason: 'ROUTE_ENVELOPE_TEXT_INVALID' };
  const idempotencyKey = hash(JSON.stringify([value.requestId, value.messageId, value.threadId, value.turnId]));
  return { ok: true, value: Object.freeze({ ...value, idempotencyKey }) };
}
function routesOf(value) {
  if (!Array.isArray(value) || value.length > 8) return { ok: false, reason: 'ROUTE_LIST_INVALID', routes: [] };
  const ids = new Set();
  const routes = [];
  for (const route of value) {
    if (!plain(route)) return { ok: false, reason: 'ROUTE_ADAPTER_INVALID', routes: [] };
    const spec = CATALOG[route.routeId];
    if (!spec) return { ok: false, reason: 'ROUTE_ID_NOT_ALLOWLISTED', routes: [] };
    if (spec.role === 'carrier-only') return { ok: false, reason: 'ROUTE_CANNOT_PROVE_NATIVE_REPLY', routes: [] };
    if (ids.has(route.routeId)) return { ok: false, reason: 'ROUTE_ID_DUPLICATED', routes: [] };
    if (route.failureDomain !== spec.failureDomain) return { ok: false, reason: 'ROUTE_FAILURE_DOMAIN_MISMATCH', routes: [] };
    if (route.costClass !== 'zero-cost') return { ok: false, reason: 'ZERO_COST_GUARDRAIL_REJECTED_ROUTE', routes: [] };
    if (!Number.isSafeInteger(route.priority) || route.priority < 0 || route.priority > 1000) return { ok: false, reason: 'ROUTE_PRIORITY_INVALID', routes: [] };
    if (typeof route.sendFn !== 'function' || typeof route.verifyReceiptFn !== 'function') return { ok: false, reason: 'ROUTE_ADAPTER_CONTRACT_INCOMPLETE', routes: [] };
    if (route.healthFn !== undefined && typeof route.healthFn !== 'function') return { ok: false, reason: 'ROUTE_HEALTH_ADAPTER_INVALID', routes: [] };
    if (route.reconcileFn !== undefined && typeof route.reconcileFn !== 'function') return { ok: false, reason: 'ROUTE_RECONCILIATION_ADAPTER_INVALID', routes: [] };
    ids.add(route.routeId);
    routes.push(Object.freeze({ ...route, enabled: route.enabled !== false, failureDomain: spec.failureDomain, role: spec.role }));
  }
  routes.sort((a, b) => a.priority - b.priority || a.routeId.localeCompare(b.routeId));
  return { ok: true, routes };
}
function receiptShape(receipt, route, envelope) {
  return exact(receipt, RECEIPT_KEYS)
    && receipt.routeId === route.routeId && receipt.requestId === envelope.requestId
    && receipt.messageId === envelope.messageId && receipt.threadId === envelope.threadId
    && receipt.turnId === envelope.turnId && receipt.relatedIssue === envelope.relatedIssue
    && receipt.idempotencyKey === envelope.idempotencyKey
    && typeof receipt.receiptId === 'string' && SAFE_ID.test(receipt.receiptId)
    && typeof receipt.replyText === 'string' && !!receipt.replyText.trim() && receipt.replyText.length <= 1200
    && typeof receipt.transportIdentity === 'string' && !!receipt.transportIdentity.trim()
    && typeof receipt.executionSurface === 'string' && !!receipt.executionSurface.trim()
    && receipt.sourceMutationAllowed === false && receipt.commandExecutionAllowed === false
    && receipt.approvalAllowed === false && receipt.mergeAllowed === false
    && typeof receipt.modelResponseProven === 'boolean';
}
async function verify(receipt, route, envelope) {
  if (!route || !receiptShape(receipt, route, envelope)) return false;
  try { return await route.verifyReceiptFn(receipt, envelope) === true; }
  catch { return false; }
}
async function persistAttempt(fn, attempt) {
  if (typeof fn !== 'function') return false;
  try { const result = await fn(Object.freeze({ ...attempt })); return result === true || result?.ok === true; }
  catch { return false; }
}

export function describeSharedConversationRouteInventory(configuredRoutes = []) {
  const normalized = routesOf(configuredRoutes);
  const configured = normalized.ok ? normalized.routes : [];
  const enabled = configured.filter((route) => route.enabled);
  const ids = new Set(enabled.map((route) => route.routeId));
  const domains = [...new Set(enabled.map((route) => route.failureDomain))];
  return Object.freeze({
    schemaVersion: SHARED_CONVERSATION_ROUTE_MESH_SCHEMA,
    configurationValid: normalized.ok,
    configurationReason: normalized.ok ? '' : normalized.reason,
    configuredRouteCount: ids.size,
    independentFailureDomainCount: domains.length,
    failureDomains: Object.freeze(domains),
    routes: Object.freeze(Object.entries(CATALOG).map(([routeId, spec]) => Object.freeze({
      routeId, failureDomain: spec.failureDomain, role: spec.role,
      configured: ids.has(routeId), enabled: enabled.some((route) => route.routeId === routeId),
      costClass: 'zero-cost-required',
    }))),
  });
}

export async function deliverSharedConversationWithFailover({
  envelope: suppliedEnvelope, routes: suppliedRoutes = [], reconcileFn, recordAttemptFn, nowMs = Date.now(),
} = {}) {
  const validated = envelopeOf(suppliedEnvelope);
  if (!validated.ok) return Object.freeze({ ok: false, classification: 'SHARED_CONVERSATION_ROUTE_ENVELOPE_REJECTED', reason: validated.reason, attempts: Object.freeze([]) });
  const normalized = routesOf(suppliedRoutes);
  if (!normalized.ok) return Object.freeze({ ok: false, classification: 'SHARED_CONVERSATION_ROUTE_CONFIGURATION_REJECTED', reason: normalized.reason, attempts: Object.freeze([]) });
  const envelope = validated.value;
  const routes = normalized.routes.filter((route) => route.enabled);
  if (!routes.length) return Object.freeze({
    ok: false, classification: 'SHARED_CONVERSATION_NO_ZERO_COST_ROUTE_AVAILABLE',
    reason: 'NO_ENABLED_ROUTE_ADAPTERS', idempotencyKey: envelope.idempotencyKey,
    attempts: Object.freeze([]), independentFailureDomainCount: 0,
  });
  const byId = new Map(routes.map((route) => [route.routeId, route]));
  const attempts = [];
  const record = async (route, disposition, reason, receipt = null, safeToRetry = false) => {
    const attempt = {
      index: attempts.length + 1, routeId: route.routeId, failureDomain: route.failureDomain,
      disposition, reason: String(reason || '').slice(0, 120), safeToRetry: safeToRetry === true,
      receiptId: receipt?.receiptId || '', timestampUtc: new Date(nowMs).toISOString(),
    };
    attempt.telemetryPersisted = await persistAttempt(recordAttemptFn, attempt);
    attempts.push(Object.freeze(attempt));
  };

  for (const route of routes) {
    if (route.healthFn) {
      let health;
      try { health = await route.healthFn(Object.freeze({ routeId: route.routeId, failureDomain: route.failureDomain })); }
      catch { health = { healthy: false, reason: 'ROUTE_HEALTH_PROBE_FAILED' }; }
      if (health !== true && health?.healthy !== true) {
        await record(route, 'skipped-unhealthy', health?.reason || 'ROUTE_UNHEALTHY');
        continue;
      }
    }
    let outcome;
    try { outcome = await route.sendFn(envelope); }
    catch { outcome = { disposition: 'uncertain', reason: 'ROUTE_SEND_EXCEPTION' }; }
    const disposition = DISPOSITIONS.has(outcome?.disposition) ? outcome.disposition : 'uncertain';
    const reason = String(outcome?.reason || disposition).slice(0, 120);

    if (disposition === 'accepted') {
      const valid = await verify(outcome.receipt, route, envelope);
      await record(route, valid ? 'accepted' : 'receipt-rejected', valid ? '' : 'ROUTE_RECEIPT_IDENTITY_OR_LINEAGE_INVALID', outcome.receipt);
      if (!valid) return Object.freeze({
        ok: false, classification: 'SHARED_CONVERSATION_ROUTE_RECEIPT_REJECTED',
        reason: 'ROUTE_RECEIPT_IDENTITY_OR_LINEAGE_INVALID', idempotencyKey: envelope.idempotencyKey,
        attempts: Object.freeze(attempts), independentFailureDomainCount: new Set(attempts.map((item) => item.failureDomain)).size,
      });
      return Object.freeze({
        ok: true, classification: 'SHARED_CONVERSATION_ROUTE_DELIVERED',
        routeId: route.routeId, failureDomain: route.failureDomain, receipt: outcome.receipt,
        idempotencyKey: envelope.idempotencyKey, attempts: Object.freeze(attempts),
        independentFailureDomainCount: new Set(attempts.map((item) => item.failureDomain)).size,
      });
    }
    if (disposition === 'application-denied') {
      await record(route, disposition, reason);
      return Object.freeze({
        ok: false, classification: 'SHARED_CONVERSATION_APPLICATION_DENIED', reason,
        idempotencyKey: envelope.idempotencyKey, attempts: Object.freeze(attempts),
        independentFailureDomainCount: new Set(attempts.map((item) => item.failureDomain)).size,
      });
    }
    if (disposition === 'transport-failure' && outcome?.safeToRetry === true) {
      await record(route, disposition, reason, null, true);
      continue;
    }

    await record(route, 'uncertain', reason);
    let reconciliation = null;
    try {
      const resolver = route.reconcileFn || reconcileFn;
      if (typeof resolver === 'function') reconciliation = await resolver(Object.freeze({
        envelope, routeId: route.routeId, failureDomain: route.failureDomain,
        idempotencyKey: envelope.idempotencyKey,
      }));
    } catch { reconciliation = null; }
    if (reconciliation?.disposition === 'accepted') {
      const acceptedRoute = byId.get(reconciliation.receipt?.routeId);
      const valid = await verify(reconciliation.receipt, acceptedRoute, envelope);
      if (!valid) return Object.freeze({
        ok: false, classification: 'SHARED_CONVERSATION_RECONCILIATION_RECEIPT_REJECTED',
        reason: 'RECONCILIATION_RECEIPT_IDENTITY_OR_LINEAGE_INVALID',
        idempotencyKey: envelope.idempotencyKey, attempts: Object.freeze(attempts),
        independentFailureDomainCount: new Set(attempts.map((item) => item.failureDomain)).size,
      });
      return Object.freeze({
        ok: true, classification: 'SHARED_CONVERSATION_ROUTE_RECONCILED',
        routeId: acceptedRoute.routeId, failureDomain: acceptedRoute.failureDomain,
        receipt: reconciliation.receipt, idempotencyKey: envelope.idempotencyKey,
        reconciledAfterRouteId: route.routeId, attempts: Object.freeze(attempts),
        independentFailureDomainCount: new Set(attempts.map((item) => item.failureDomain)).size,
      });
    }
    if (reconciliation?.disposition === 'not-accepted' && reconciliation.authoritative === true) {
      await record(route, 'authoritatively-not-accepted', reconciliation.reason || 'ROUTE_NOT_ACCEPTED', null, true);
      continue;
    }
    return Object.freeze({
      ok: false, classification: 'SHARED_CONVERSATION_DELIVERY_UNCERTAIN',
      reason: reconciliation?.reason || 'REMOTE_ACCEPTANCE_NOT_RECONCILED',
      idempotencyKey: envelope.idempotencyKey, attempts: Object.freeze(attempts),
      independentFailureDomainCount: new Set(attempts.map((item) => item.failureDomain)).size,
    });
  }
  return Object.freeze({
    ok: false, classification: 'SHARED_CONVERSATION_ALL_ROUTES_UNAVAILABLE',
    reason: 'ALL_CONFIGURED_ZERO_COST_ROUTES_FAILED_PRE_ACCEPTANCE',
    idempotencyKey: envelope.idempotencyKey, attempts: Object.freeze(attempts),
    independentFailureDomainCount: new Set(attempts.map((item) => item.failureDomain)).size,
  });
}
