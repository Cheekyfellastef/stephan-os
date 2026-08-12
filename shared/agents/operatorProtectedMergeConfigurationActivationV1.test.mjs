import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION,
  OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SCHEMA,
  OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SHA256,
  createOperatorProtectedMergeConfigurationActivationEvidence,
  validateOperatorProtectedMergeConfigurationActivation,
} from './operatorProtectedMergeConfigurationActivationV1.mjs';

function evidence() {
  return JSON.parse(JSON.stringify(OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION));
}

function assertBlocked(value, blocker) {
  const result = validateOperatorProtectedMergeConfigurationActivation(value);
  assert.equal(result.valid, false);
  assert.equal(result.evidenceSha256, null);
  assert.ok(result.blockers.includes(blocker), `${blocker} not found in ${result.blockers.join(', ')}`);
}

test('accepts only the canonical exact configuration activation evidence', () => {
  const canonical = createOperatorProtectedMergeConfigurationActivationEvidence();
  const result = validateOperatorProtectedMergeConfigurationActivation(canonical);

  assert.equal(canonical.schema, OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SCHEMA);
  assert.equal(result.valid, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.evidenceSha256, OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SHA256);
  assert.match(result.evidenceSha256, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(canonical));
  assert.ok(Object.isFrozen(canonical.app.permissions));
  assert.ok(Object.isFrozen(canonical.transportBoundary.allowedPathTemplates));
});

test('rejects malformed, missing and widened top-level evidence', () => {
  for (const malformed of [null, undefined, [], 'evidence', 1, new Date()]) {
    assertBlocked(malformed, 'activation-evidence-malformed');
  }

  const missing = evidence();
  delete missing.ruleset;
  assertBlocked(missing, 'activation-evidence-keys-invalid');

  const widened = evidence();
  widened.runtimeAuthority = true;
  assertBlocked(widened, 'activation-evidence-keys-invalid');

  const wrongSchema = evidence();
  wrongSchema.schema = 'stephanos.operator-protected-merge-configuration-activation.v2';
  assertBlocked(wrongSchema, 'activation-schema-mismatch');
});

test('rejects wrong repository identity, all-repository mode and any extra repository', () => {
  const mutations = [
    (value) => { value.repository.owner = 'OtherOwner'; },
    (value) => { value.repository.name = 'other-repo'; },
    (value) => { value.repository.fullName = 'Cheekyfellastef/other-repo'; },
    (value) => { value.repository.selectionMode = 'all'; },
    (value) => { value.repository.selectedRepositories.push('Cheekyfellastef/other-repo'); },
    (value) => { value.repository.extraScope = true; },
  ];
  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, 'activation-repository-mismatch');
  }
});

test('rejects wrong App or installation identity', () => {
  const mutations = [
    (value) => { value.app.name = 'Lookalike Ruleset Reader'; },
    (value) => { value.app.slug = 'lookalike-ruleset-reader'; },
    (value) => { value.app.appId = 4547244; },
    (value) => { value.app.installationId = 152662200; },
  ];
  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, 'activation-app-mismatch');
  }
});

test('rejects read-only, missing, malformed or widened App permissions', () => {
  const mutations = [
    (value) => { value.app.permissions.administration = 'read'; },
    (value) => { delete value.app.permissions.metadata; },
    (value) => { value.app.permissions.metadata = 'write'; },
    (value) => { value.app.permissions.contents = 'read'; },
    (value) => { value.app.permissions = ['administration:write', 'metadata:read']; },
  ];
  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, 'activation-app-mismatch');
  }
});

test('rejects event subscriptions and a pending installation permission request', () => {
  const event = evidence();
  event.app.events.push('repository');
  assertBlocked(event, 'activation-app-mismatch');

  const pending = evidence();
  pending.app.permissionUpdatePending = true;
  assertBlocked(pending, 'activation-app-mismatch');
});

test('rejects stale or mismatched main head and tree identities', () => {
  const wrongHead = evidence();
  wrongHead.admissionBase.headSha = '0'.repeat(40);
  assertBlocked(wrongHead, 'activation-main-identity-mismatch');

  const wrongTree = evidence();
  wrongTree.admissionBase.treeSha = '1'.repeat(40);
  assertBlocked(wrongTree, 'activation-main-identity-mismatch');
});

test('rejects wrong ruleset identity, bypass actors and widened required checks', () => {
  const mutations = [
    (value) => { value.ruleset.id = 20640196; },
    (value) => { value.ruleset.enforcement = 'disabled'; },
    (value) => { value.ruleset.bypassActors.push({ actorId: 1 }); },
    (value) => { value.ruleset.requiredStatusChecks[0].context = 'lookalike-source-proof'; },
    (value) => { value.ruleset.requiredStatusChecks[0].integrationId = 15369; },
    (value) => { value.ruleset.requiredStatusChecks.push({ context: 'extra', integrationId: 15368 }); },
  ];
  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, 'activation-ruleset-mismatch');
  }
});

test('rejects every wrong failed-dispatch replay identity or terminal state', () => {
  const mutations = [
    (value) => { value.failedDispatch.workflowRunId = 31583116256; },
    (value) => { value.failedDispatch.runAttempt = 2; },
    (value) => { value.failedDispatch.event = 'pull_request'; },
    (value) => { value.failedDispatch.status = 'in_progress'; },
    (value) => { value.failedDispatch.conclusion = 'success'; },
    (value) => { value.failedDispatch.baseHeadSha = '2'.repeat(40); },
  ];
  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, 'activation-failed-dispatch-mismatch');
  }
});

test('rejects widened methods, bodies, redirects, repositories or paths', () => {
  const mutations = [
    (value) => { value.transportBoundary.allowedMethod = 'POST'; },
    (value) => { value.transportBoundary.requestBody = {}; },
    (value) => { value.transportBoundary.redirectMode = 'follow'; },
    (value) => { value.transportBoundary.allowedRepository = 'Cheekyfellastef/other-repo'; },
    (value) => { value.transportBoundary.allowedPathTemplates.push('/repos/{owner}/{repository}/contents'); },
    (value) => { value.transportBoundary.installationPermission = 'administration:read'; },
  ];
  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, 'activation-transport-boundary-mismatch');
  }
});

test('rejects persistence, logging, artifacting or cross-job credential forwarding', () => {
  for (const field of [
    'credentialPersistence',
    'credentialLogging',
    'credentialArtifacting',
    'credentialCrossJobForwarding',
  ]) {
    const value = evidence();
    value.transportBoundary[field] = true;
    assertBlocked(value, 'activation-transport-boundary-mismatch');
  }

  const nonLocal = evidence();
  nonLocal.transportBoundary.environmentJobLocal = false;
  assertBlocked(nonLocal, 'activation-transport-boundary-mismatch');
});

test('rejects sparse authoritative arrays instead of normalizing them', () => {
  const cases = [
    ['activation-repository-mismatch', (value) => {
      value.repository.selectedRepositories = new Array(1);
    }],
    ['activation-app-mismatch', (value) => {
      value.app.events = new Array(1);
    }],
    ['activation-ruleset-mismatch', (value) => {
      value.ruleset.bypassActors = new Array(1);
    }],
    ['activation-ruleset-mismatch', (value) => {
      value.ruleset.requiredStatusChecks = new Array(1);
    }],
    ['activation-transport-boundary-mismatch', (value) => {
      value.transportBoundary.allowedPathTemplates = new Array(3);
    }],
  ];

  for (const [blocker, mutate] of cases) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, blocker);
  }
});
