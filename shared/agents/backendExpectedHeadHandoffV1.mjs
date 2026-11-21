export const BACKEND_EXPECTED_HEAD_HANDOFF_SCHEMA = 'stephanos.backend-expected-head-handoff.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const CANONICAL_BACKEND_TASK_MULTIPLE_INSTANCES = 'IgnoreNew';

function normalizedHead(value) {
  return String(value || '').trim().toLowerCase();
}

function blocked(reason, extra = {}) {
  return Object.freeze({ mutationAllowed: false, reason, ...extra });
}

export function evaluateBackendExpectedHeadHandoffPublication({
  expectedHead = '',
  taskWasRunning = false,
  taskStopped = false,
  taskStateImmediatelyBeforePublish = '',
  taskMultipleInstancesImmediatelyBeforePublish = '',
  listenerWasPresent = false,
  listenerStopped = false,
} = {}) {
  const head = normalizedHead(expectedHead);
  if (!SHA40.test(head)) return blocked('expected-head-invalid', { publishAllowed: false, expectedHead: head });
  if (taskWasRunning && !taskStopped) return blocked('old-task-not-stopped', { publishAllowed: false, expectedHead: head });
  if (taskStateImmediatelyBeforePublish !== 'Disabled') return blocked('task-not-disabled-before-publish', { publishAllowed: false, expectedHead: head });
  if (taskMultipleInstancesImmediatelyBeforePublish !== CANONICAL_BACKEND_TASK_MULTIPLE_INSTANCES) {
    return blocked('task-overlap-policy-not-ignore-new-before-publish', { publishAllowed: false, expectedHead: head });
  }
  if (listenerWasPresent && !listenerStopped) return blocked('old-listener-not-stopped', { publishAllowed: false, expectedHead: head });
  return Object.freeze({
    mutationAllowed: false,
    publishAllowed: true,
    reason: 'old-consumers-stopped',
    expectedHead: head,
  });
}

export function evaluateBackendExpectedHeadHandoffStart({
  expectedHead = '',
  taskMultipleInstancesImmediatelyBeforeStart = '',
} = {}) {
  const head = normalizedHead(expectedHead);
  if (!SHA40.test(head)) return blocked('expected-head-invalid', { startAllowed: false, expectedHead: head });
  if (taskMultipleInstancesImmediatelyBeforeStart !== CANONICAL_BACKEND_TASK_MULTIPLE_INSTANCES) {
    return blocked('task-overlap-policy-not-ignore-new-before-start', { startAllowed: false, expectedHead: head });
  }
  return Object.freeze({
    mutationAllowed: false,
    startAllowed: true,
    reason: 'task-overlap-policy-ignore-new',
    expectedHead: head,
  });
}

export function evaluateBackendExpectedHeadHandoffConsumption({
  handoffObserved = false,
  consumeSucceeded = false,
  schemaVersion = '',
  target = '',
  handoffHead = '',
  issuedAtMs = 0,
  expiresAtMs = 0,
  nowMs = 0,
  currentHead = '',
  canonicalStandaloneSource = false,
} = {}) {
  const observedHead = normalizedHead(currentHead);
  if (!handoffObserved) {
    if (!canonicalStandaloneSource || !SHA40.test(observedHead)) {
      return blocked('standalone-canonical-head-unproven', { bindingSource: 'standalone' });
    }
    return Object.freeze({ mutationAllowed: true, reason: 'standalone-canonical-head', bindingSource: 'standalone', expectedHead: observedHead, observedHead });
  }
  if (!consumeSucceeded) return blocked('handoff-consume-failed', { bindingSource: 'handoff' });
  if (schemaVersion !== BACKEND_EXPECTED_HEAD_HANDOFF_SCHEMA) return blocked('handoff-schema-invalid', { bindingSource: 'handoff' });
  if (target !== 'backend') return blocked('handoff-target-invalid', { bindingSource: 'handoff' });
  const expectedHead = normalizedHead(handoffHead);
  if (!SHA40.test(expectedHead)) return blocked('handoff-head-invalid', { bindingSource: 'handoff' });
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs)) return blocked('handoff-time-invalid', { bindingSource: 'handoff' });
  if (expiresAtMs <= issuedAtMs || issuedAtMs > nowMs + 30_000 || expiresAtMs > issuedAtMs + 125_000) return blocked('handoff-time-invalid', { bindingSource: 'handoff' });
  if (expiresAtMs <= nowMs) return blocked('handoff-expired', { bindingSource: 'handoff' });
  if (observedHead !== expectedHead) return blocked('handoff-head-mismatch', { bindingSource: 'handoff', expectedHead, observedHead });
  return Object.freeze({ mutationAllowed: true, reason: 'handoff-exact-head', bindingSource: 'handoff', expectedHead, observedHead });
}
