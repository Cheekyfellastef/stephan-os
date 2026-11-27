import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SHARED_CONVERSATION_ROUTE_IDS as ROUTES,
  deliverSharedConversationWithFailover,
  describeSharedConversationRouteInventory,
} from './chatGptSharedConversationRouteMeshV1.mjs';

function envelope(overrides = {}) {
  return {
    requestId: 'request-1506-001', messageId: 'shared-turn-001',
    threadId: 'shared-thread-1506', turnId: 'turn-001',
    relatedIssue: '#1506', text: 'Please confirm the existing OpenClaw conversation route.',
    ...overrides,
  };
}
function receipt(routeId, value, overrides = {}) {
  return {
    routeId, requestId: value.requestId, messageId: value.messageId,
    threadId: value.threadId, turnId: value.turnId, relatedIssue: value.relatedIssue,
    idempotencyKey: value.idempotencyKey, receiptId: 'receipt-001',
    replyText: 'OpenClaw received the correlated conversation turn.',
    transportIdentity: routeId + ':instance-1', executionSurface: routeId,
    sourceMutationAllowed: false, commandExecutionAllowed: false,
    approvalAllowed: false, mergeAllowed: false, modelResponseProven: false,
    ...overrides,
  };
}
function route(routeId, failureDomain, priority, sendFn, options = {}) {
  return {
    routeId, failureDomain, priority, costClass: 'zero-cost', sendFn,
    verifyReceiptFn: options.verifyReceiptFn || ((candidate, value) =>
      candidate.routeId === routeId && candidate.requestId === value.requestId
      && candidate.messageId === value.messageId && candidate.threadId === value.threadId
      && candidate.turnId === value.turnId && candidate.idempotencyKey === value.idempotencyKey
      && candidate.sourceMutationAllowed === false && candidate.commandExecutionAllowed === false
      && candidate.approvalAllowed === false && candidate.mergeAllowed === false),
    ...(options.healthFn ? { healthFn: options.healthFn } : {}),
    ...(options.reconcileFn ? { reconcileFn: options.reconcileFn } : {}),
  };
}

test('transport failure before acceptance fails over in priority order with one stable idempotency key', async () => {
  const calls = [];
  const primary = route(ROUTES.OPENCLAW_GATEWAY_RPC, 'openclaw-gateway', 10, async (value) => {
    calls.push(['gateway', value.idempotencyKey]);
    return { disposition: 'transport-failure', safeToRetry: true, reason: 'GATEWAY_PREFLIGHT_UNAVAILABLE' };
  });
  const fallback = route(ROUTES.OPENCLAW_REVERSE_POLL, 'openclaw-runtime', 20, async (value) => {
    calls.push(['reverse-poll', value.idempotencyKey]);
    return { disposition: 'accepted', receipt: receipt(ROUTES.OPENCLAW_REVERSE_POLL, value) };
  });
  const result = await deliverSharedConversationWithFailover({ envelope: envelope(), routes: [fallback, primary] });
  assert.equal(result.ok, true);
  assert.equal(result.routeId, ROUTES.OPENCLAW_REVERSE_POLL);
  assert.deepEqual(calls.map(([name]) => name), ['gateway', 'reverse-poll']);
  assert.equal(calls[0][1], calls[1][1]);
  assert.equal(result.attempts.length, 2);
});

test('unhealthy route is skipped and becomes eligible again after health recovers', async () => {
  let healthy = false;
  let gatewayCalls = 0;
  const gateway = route(ROUTES.OPENCLAW_GATEWAY_RPC, 'openclaw-gateway', 10, async (value) => {
    gatewayCalls += 1;
    return { disposition: 'accepted', receipt: receipt(ROUTES.OPENCLAW_GATEWAY_RPC, value) };
  }, { healthFn: () => ({ healthy }) });
  const fallback = route(ROUTES.OPENCLAW_REVERSE_POLL, 'openclaw-runtime', 20, async (value) => ({
    disposition: 'accepted', receipt: receipt(ROUTES.OPENCLAW_REVERSE_POLL, value),
  }));
  const first = await deliverSharedConversationWithFailover({ envelope: envelope(), routes: [gateway, fallback] });
  assert.equal(first.routeId, ROUTES.OPENCLAW_REVERSE_POLL);
  assert.equal(gatewayCalls, 0);
  healthy = true;
  const second = await deliverSharedConversationWithFailover({
    envelope: envelope({ requestId: 'request-1506-002', messageId: 'shared-turn-002', turnId: 'turn-002' }),
    routes: [gateway, fallback],
  });
  assert.equal(second.routeId, ROUTES.OPENCLAW_GATEWAY_RPC);
  assert.equal(gatewayCalls, 1);
});

test('timeout after possible acceptance reconciles and never sends a duplicate turn', async () => {
  let fallbackCalls = 0;
  const primary = route(ROUTES.OPENCLAW_GATEWAY_RPC, 'openclaw-gateway', 10, async () => ({
    disposition: 'uncertain', reason: 'GATEWAY_TIMEOUT_AFTER_SEND',
  }), {
    reconcileFn: async ({ envelope: value, idempotencyKey }) => ({
      disposition: 'accepted',
      receipt: receipt(ROUTES.OPENCLAW_GATEWAY_RPC, { ...value, idempotencyKey }),
    }),
  });
  const fallback = route(ROUTES.OPENCLAW_REVERSE_POLL, 'openclaw-runtime', 20, async () => {
    fallbackCalls += 1;
    return { disposition: 'accepted', receipt: {} };
  });
  const result = await deliverSharedConversationWithFailover({ envelope: envelope(), routes: [primary, fallback] });
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'SHARED_CONVERSATION_ROUTE_RECONCILED');
  assert.equal(result.routeId, ROUTES.OPENCLAW_GATEWAY_RPC);
  assert.equal(fallbackCalls, 0);
});

test('unknown timeout outcome stops rather than risking a duplicate model turn', async () => {
  let fallbackCalls = 0;
  const primary = route(ROUTES.OPENCLAW_GATEWAY_RPC, 'openclaw-gateway', 10, async () => ({
    disposition: 'uncertain', reason: 'REPLY_TIMEOUT',
  }));
  const fallback = route(ROUTES.OPENCLAW_REVERSE_POLL, 'openclaw-runtime', 20, async () => {
    fallbackCalls += 1;
    return { disposition: 'accepted', receipt: {} };
  });
  const result = await deliverSharedConversationWithFailover({ envelope: envelope(), routes: [primary, fallback] });
  assert.equal(result.ok, false);
  assert.equal(result.classification, 'SHARED_CONVERSATION_DELIVERY_UNCERTAIN');
  assert.equal(fallbackCalls, 0);
});

test('application denial is terminal and never fails over', async () => {
  let fallbackCalls = 0;
  const primary = route(ROUTES.OPENCLAW_GATEWAY_RPC, 'openclaw-gateway', 10, async () => ({
    disposition: 'application-denied', reason: 'OPENCLAW_CONVERSATION_NATIVE_CONTEXT_REQUIRED',
  }));
  const fallback = route(ROUTES.OPENCLAW_REVERSE_POLL, 'openclaw-runtime', 20, async () => {
    fallbackCalls += 1;
    return { disposition: 'accepted', receipt: {} };
  });
  const result = await deliverSharedConversationWithFailover({ envelope: envelope(), routes: [primary, fallback] });
  assert.equal(result.classification, 'SHARED_CONVERSATION_APPLICATION_DENIED');
  assert.equal(fallbackCalls, 0);
});

test('wrong thread receipt is rejected without trying a weaker route', async () => {
  let fallbackCalls = 0;
  const primary = route(ROUTES.OPENCLAW_GATEWAY_RPC, 'openclaw-gateway', 10, async (value) => ({
    disposition: 'accepted', receipt: receipt(ROUTES.OPENCLAW_GATEWAY_RPC, value, { threadId: 'wrong-thread' }),
  }));
  const fallback = route(ROUTES.OPENCLAW_REVERSE_POLL, 'openclaw-runtime', 20, async () => {
    fallbackCalls += 1;
    return { disposition: 'accepted', receipt: {} };
  });
  const result = await deliverSharedConversationWithFailover({ envelope: envelope(), routes: [primary, fallback] });
  assert.equal(result.classification, 'SHARED_CONVERSATION_ROUTE_RECEIPT_REJECTED');
  assert.equal(fallbackCalls, 0);
});

test('GitHub comment carriers cannot masquerade as native OpenClaw reply routes', async () => {
  let called = false;
  const carrier = route(ROUTES.GITHUB_COMMENT_CARRIER, 'github', 10, async () => {
    called = true;
    return { disposition: 'accepted', receipt: {} };
  });
  const result = await deliverSharedConversationWithFailover({ envelope: envelope(), routes: [carrier] });
  assert.equal(result.classification, 'SHARED_CONVERSATION_ROUTE_CONFIGURATION_REJECTED');
  assert.equal(result.reason, 'ROUTE_CANNOT_PROVE_NATIVE_REPLY');
  assert.equal(called, false);
});

test('paid or unclassified provider routes are rejected before invocation', async () => {
  let called = false;
  const paid = {
    ...route(ROUTES.OPENCLAW_GATEWAY_RPC, 'openclaw-gateway', 10, async () => {
      called = true;
      return { disposition: 'transport-failure', safeToRetry: true };
    }),
    costClass: 'metered',
  };
  const result = await deliverSharedConversationWithFailover({ envelope: envelope(), routes: [paid] });
  assert.equal(result.reason, 'ZERO_COST_GUARDRAIL_REJECTED_ROUTE');
  assert.equal(called, false);
});

test('repeated delivery of the same canonical turn reuses the same idempotency key', async () => {
  const keys = [];
  const adapter = route(ROUTES.OPENCLAW_GATEWAY_RPC, 'openclaw-gateway', 10, async (value) => {
    keys.push(value.idempotencyKey);
    return { disposition: 'accepted', receipt: receipt(ROUTES.OPENCLAW_GATEWAY_RPC, value) };
  });
  const first = await deliverSharedConversationWithFailover({ envelope: envelope(), routes: [adapter] });
  const second = await deliverSharedConversationWithFailover({ envelope: envelope(), routes: [adapter] });
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(keys[0], keys[1]);
});

test('inventory counts independent failure domains rather than multiple GitHub adapters', () => {
  const routes = [
    route(ROUTES.OPENCLAW_GATEWAY_RPC, 'openclaw-gateway', 10, async () => ({})),
    route(ROUTES.GITHUB_SIGNED_REPLY, 'github', 20, async () => ({})),
    route(ROUTES.OPENCLAW_REVERSE_POLL, 'openclaw-runtime', 30, async () => ({})),
  ];
  const inventory = describeSharedConversationRouteInventory(routes);
  assert.equal(inventory.configurationValid, true);
  assert.equal(inventory.configuredRouteCount, 3);
  assert.equal(inventory.independentFailureDomainCount, 3);
  assert.equal(inventory.routes.find((item) => item.routeId === ROUTES.GITHUB_COMMENT_CARRIER).role, 'carrier-only');
  assert.equal(inventory.routes.find((item) => item.routeId === ROUTES.CHATGPT_REMOTE_MCP).configured, false);
});

test('invalid envelope fails before any route is invoked', async () => {
  let called = false;
  const adapter = route(ROUTES.OPENCLAW_GATEWAY_RPC, 'openclaw-gateway', 10, async () => {
    called = true;
    return { disposition: 'accepted', receipt: {} };
  });
  const result = await deliverSharedConversationWithFailover({
    envelope: envelope({ threadId: '../outside' }), routes: [adapter],
  });
  assert.equal(result.reason, 'ROUTE_ENVELOPE_ID_INVALID');
  assert.equal(called, false);
});

test('route attempt telemetry is emitted with persistence status', async () => {
  const attempts = [];
  const first = route(ROUTES.OPENCLAW_GATEWAY_RPC, 'openclaw-gateway', 10, async () => ({
    disposition: 'transport-failure', safeToRetry: true, reason: 'PREFLIGHT_UNAVAILABLE',
  }));
  const second = route(ROUTES.OPENCLAW_REVERSE_POLL, 'openclaw-runtime', 20, async (value) => ({
    disposition: 'accepted', receipt: receipt(ROUTES.OPENCLAW_REVERSE_POLL, value),
  }));
  const result = await deliverSharedConversationWithFailover({
    envelope: envelope(), routes: [first, second],
    recordAttemptFn: async (attempt) => { attempts.push(attempt); return { ok: true }; },
  });
  assert.equal(result.ok, true);
  assert.equal(attempts.length, 2);
  assert.equal(result.attempts.every((attempt) => attempt.telemetryPersisted), true);
});
