import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as activationModule from './operatorProtectedMergeConfigurationActivationV1.mjs';

const {
  OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION,
  OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SCHEMA,
  OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SHA256,
  OPERATOR_PROTECTED_MERGE_CONFIGURATION_OBSERVATION_SCHEMA,
  OPERATOR_PROTECTED_MERGE_CONFIGURATION_PROVENANCE_SCHEMA,
  validateOperatorProtectedMergeConfigurationActivation,
} = activationModule;

const SIGNED_EVIDENCE = Object.freeze({
  schema: OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SCHEMA,
  observation: OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION,
  provenance: {
    schema: OPERATOR_PROTECTED_MERGE_CONFIGURATION_PROVENANCE_SCHEMA,
    receiptId: 'github-live-configuration-observation-pr1766-20260812T113058556Z',
    observer: {
      id: 'codex-desktop-battle-bridge',
      class: 'qualified-operator-authenticated-github-live-observer',
      independence: 'external-to-source-contract',
      authority: 'read-only',
    },
    observedAtUtc: '2026-08-12T11:30:58.556Z',
    capture: {
      repository: 'Cheekyfellastef/stephan-os',
      authenticated: true,
      tlsVerified: true,
      surfaces: [
        'github-rest-ruleset-20640195',
        'github-admin-installation-152662199',
        'github-admin-app-stephanos-ruleset-proof-reader',
        'github-admin-app-permissions-stephanos-ruleset-proof-reader',
      ],
    },
    observationSha256: '316b6b76652c340dd09a7d7860a6372157be2544dfa4ce9be96def69b90251a6',
    reviewArtifact: {
      workflow: 'Independent Merge Security Review',
      workflowRunId: 31591316347,
      workflowRunAttempt: 1,
      artifactId: 9139216442,
      artifactName: 'stephanos-independent-review-31591316347-attempt-1',
      artifactDigest: 'sha256:aec8620dc9e21a3cbf823bd641cede05a6872c341a2976c22cd1cc25eae3828f',
      payloadSha256: 'f65acf7914bd1da17320438b3ac9f99f9207d357f8ed98bfdec906bb71236075',
      sourceHead: '5ac8a414c38400f7ff631cc3842bb79150b1c400',
      baseSha: 'ba10365b0c873398ebccc397f64358c7a01fb8cf',
      createdAtUtc: '2026-08-12T11:19:26.603Z',
      expired: false,
    },
    signature: {
      algorithm: 'Ed25519',
      keyId: 'sha256:6facafd823e3d3274218bbe0c7f4228b08e5fca98e057db7ae959300424b559f',
      value: 'cNF+dYoICe1aERyaFbnbhy1g/gfKhB2B3XfOboQgTa/pyH41xTob+d31CSfFp7N1eTniNYiWFTFfVxKgrkISDA==',
    },
  },
});

function evidence() {
  return JSON.parse(JSON.stringify(SIGNED_EVIDENCE));
}

function assertBlocked(value, blocker) {
  const result = validateOperatorProtectedMergeConfigurationActivation(value);
  assert.equal(result.valid, false);
  assert.equal(result.evidenceSha256, null);
  assert.ok(result.blockers.includes(blocker), `${blocker} not found in ${result.blockers.join(', ')}`);
}

test('accepts only the detached-signature-bound exact live observation envelope', () => {
  const result = validateOperatorProtectedMergeConfigurationActivation(evidence());

  assert.equal(SIGNED_EVIDENCE.observation.schema, OPERATOR_PROTECTED_MERGE_CONFIGURATION_OBSERVATION_SCHEMA);
  assert.equal(OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SHA256,
    '316b6b76652c340dd09a7d7860a6372157be2544dfa4ce9be96def69b90251a6');
  assert.equal(result.valid, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.evidenceSha256,
    '419b59c82679b0b5abe31606143c557413755d1a19d4f3232714f73e5aab6094');
});

test('source constants alone cannot manufacture admissible activation evidence', () => {
  assert.equal(activationModule.createOperatorProtectedMergeConfigurationActivationEvidence, undefined);
  assertBlocked(OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION, 'activation-evidence-keys-invalid');

  const unsigned = evidence();
  delete unsigned.provenance.signature;
  assertBlocked(unsigned, 'activation-provenance-keys-invalid');
  assertBlocked(unsigned, 'activation-provenance-signature-invalid');
});

test('rejects malformed, missing and widened top-level evidence', () => {
  for (const malformed of [null, undefined, [], 'evidence', 1, new Date()]) {
    assertBlocked(malformed, 'activation-evidence-malformed');
  }

  const missing = evidence();
  delete missing.provenance;
  assertBlocked(missing, 'activation-evidence-keys-invalid');

  const widened = evidence();
  widened.runtimeAuthority = true;
  assertBlocked(widened, 'activation-evidence-keys-invalid');

  const wrongSchema = evidence();
  wrongSchema.schema = 'stephanos.operator-protected-merge-configuration-activation-evidence.v2';
  assertBlocked(wrongSchema, 'activation-schema-mismatch');
});

test('rejects malformed, missing or widened observation and provenance records', () => {
  const malformedObservation = evidence();
  malformedObservation.observation = [];
  assertBlocked(malformedObservation, 'activation-observation-malformed');

  const widenedObservation = evidence();
  widenedObservation.observation.liveAuthority = true;
  assertBlocked(widenedObservation, 'activation-observation-keys-invalid');

  const malformedProvenance = evidence();
  malformedProvenance.provenance = [];
  assertBlocked(malformedProvenance, 'activation-provenance-malformed');

  const widenedProvenance = evidence();
  widenedProvenance.provenance.refreshAuthority = true;
  assertBlocked(widenedProvenance, 'activation-provenance-keys-invalid');
});

test('rejects self-issued, stale or mismatched live-observation provenance', () => {
  const mutations = [
    ['activation-provenance-receipt-mismatch', (value) => { value.provenance.receiptId = 'self-issued'; }],
    ['activation-provenance-observer-mismatch', (value) => { value.provenance.observer.id = 'source-factory'; }],
    ['activation-provenance-observer-mismatch', (value) => { value.provenance.observer.independence = 'self-issued'; }],
    ['activation-provenance-observer-mismatch', (value) => { value.provenance.observer.authority = 'write'; }],
    ['activation-provenance-time-mismatch', (value) => { value.provenance.observedAtUtc = '2026-08-11T11:30:58.556Z'; }],
    ['activation-provenance-capture-mismatch', (value) => { value.provenance.capture.authenticated = false; }],
    ['activation-provenance-capture-mismatch', (value) => { value.provenance.capture.tlsVerified = false; }],
    ['activation-provenance-capture-mismatch', (value) => { value.provenance.capture.surfaces.pop(); }],
  ];
  for (const [blocker, mutate] of mutations) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, blocker);
    assertBlocked(value, 'activation-provenance-signature-invalid');
  }
});

test('rejects wrong immutable review receipt, artifact, run, attempt, digest or payload hash', () => {
  const mutations = [
    (value) => { value.provenance.reviewArtifact.workflow = 'Lookalike Review'; },
    (value) => { value.provenance.reviewArtifact.workflowRunId += 1; },
    (value) => { value.provenance.reviewArtifact.workflowRunAttempt = 2; },
    (value) => { value.provenance.reviewArtifact.artifactId += 1; },
    (value) => { value.provenance.reviewArtifact.artifactName = 'lookalike-artifact'; },
    (value) => { value.provenance.reviewArtifact.artifactDigest = `sha256:${'0'.repeat(64)}`; },
    (value) => { value.provenance.reviewArtifact.payloadSha256 = '1'.repeat(64); },
    (value) => { value.provenance.reviewArtifact.sourceHead = '2'.repeat(40); },
    (value) => { value.provenance.reviewArtifact.baseSha = '3'.repeat(40); },
    (value) => { value.provenance.reviewArtifact.createdAtUtc = '2026-08-12T11:19:25.000Z'; },
    (value) => { value.provenance.reviewArtifact.expired = true; },
  ];
  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, 'activation-provenance-review-artifact-mismatch');
    assertBlocked(value, 'activation-provenance-signature-invalid');
  }
});

test('rejects missing, malformed or wrong detached signatures', () => {
  const cases = [
    ['activation-provenance-keys-invalid', (value) => { delete value.provenance.signature; }],
    ['activation-provenance-signature-identity-mismatch', (value) => { value.provenance.signature.algorithm = 'RSA-PSS'; }],
    ['activation-provenance-signature-identity-mismatch', (value) => { value.provenance.signature.keyId = `sha256:${'0'.repeat(64)}`; }],
    ['activation-provenance-signature-identity-mismatch', (value) => { value.provenance.signature.value = 'not-base64'; }],
    ['activation-provenance-signature-identity-mismatch', (value) => { value.provenance.signature.extra = true; }],
  ];
  for (const [blocker, mutate] of cases) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, blocker);
    assertBlocked(value, 'activation-provenance-signature-invalid');
  }
});

test('rejects wrong repository identity, all-repository mode and any extra repository', () => {
  const mutations = [
    (value) => { value.observation.repository.owner = 'OtherOwner'; },
    (value) => { value.observation.repository.name = 'other-repo'; },
    (value) => { value.observation.repository.fullName = 'Cheekyfellastef/other-repo'; },
    (value) => { value.observation.repository.selectionMode = 'all'; },
    (value) => { value.observation.repository.selectedRepositories.push('Cheekyfellastef/other-repo'); },
    (value) => { value.observation.repository.extraScope = true; },
  ];
  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, 'activation-repository-mismatch');
    assertBlocked(value, 'activation-provenance-observation-digest-mismatch');
  }
});

test('rejects wrong App, installation, permission, event or pending-update truth', () => {
  const mutations = [
    (value) => { value.observation.app.name = 'Lookalike Ruleset Reader'; },
    (value) => { value.observation.app.slug = 'lookalike-ruleset-reader'; },
    (value) => { value.observation.app.appId += 1; },
    (value) => { value.observation.app.installationId += 1; },
    (value) => { value.observation.app.permissions.administration = 'read'; },
    (value) => { delete value.observation.app.permissions.metadata; },
    (value) => { value.observation.app.permissions.contents = 'read'; },
    (value) => { value.observation.app.events.push('repository'); },
    (value) => { value.observation.app.permissionUpdatePending = true; },
  ];
  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, 'activation-app-mismatch');
  }
});

test('rejects stale main and wrong ruleset, bypass or required-check truth', () => {
  const mutations = [
    ['activation-main-identity-mismatch', (value) => { value.observation.admissionBase.headSha = '0'.repeat(40); }],
    ['activation-main-identity-mismatch', (value) => { value.observation.admissionBase.treeSha = '1'.repeat(40); }],
    ['activation-ruleset-mismatch', (value) => { value.observation.ruleset.id += 1; }],
    ['activation-ruleset-mismatch', (value) => { value.observation.ruleset.enforcement = 'disabled'; }],
    ['activation-ruleset-mismatch', (value) => { value.observation.ruleset.bypassActors.push({ actorId: 1 }); }],
    ['activation-ruleset-mismatch', (value) => { value.observation.ruleset.requiredStatusChecks[0].integrationId += 1; }],
    ['activation-ruleset-mismatch', (value) => { value.observation.ruleset.requiredStatusChecks.push({ context: 'extra', integrationId: 15368 }); }],
  ];
  for (const [blocker, mutate] of mutations) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, blocker);
  }
});

test('rejects every wrong failed-dispatch replay identity or terminal state', () => {
  const mutations = [
    (value) => { value.observation.failedDispatch.workflowRunId += 1; },
    (value) => { value.observation.failedDispatch.runAttempt = 2; },
    (value) => { value.observation.failedDispatch.event = 'pull_request'; },
    (value) => { value.observation.failedDispatch.status = 'in_progress'; },
    (value) => { value.observation.failedDispatch.conclusion = 'success'; },
    (value) => { value.observation.failedDispatch.baseHeadSha = '2'.repeat(40); },
  ];
  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, 'activation-failed-dispatch-mismatch');
  }
});

test('rejects widened transport or credential handling authority', () => {
  const mutations = [
    (value) => { value.observation.transportBoundary.allowedMethod = 'POST'; },
    (value) => { value.observation.transportBoundary.requestBody = {}; },
    (value) => { value.observation.transportBoundary.redirectMode = 'follow'; },
    (value) => { value.observation.transportBoundary.allowedRepository = 'Cheekyfellastef/other-repo'; },
    (value) => { value.observation.transportBoundary.allowedPathTemplates.push('/repos/{owner}/{repository}/contents'); },
    (value) => { value.observation.transportBoundary.installationPermission = 'administration:read'; },
    (value) => { value.observation.transportBoundary.environmentJobLocal = false; },
    (value) => { value.observation.transportBoundary.credentialPersistence = true; },
    (value) => { value.observation.transportBoundary.credentialLogging = true; },
    (value) => { value.observation.transportBoundary.credentialArtifacting = true; },
    (value) => { value.observation.transportBoundary.credentialCrossJobForwarding = true; },
  ];
  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, 'activation-transport-boundary-mismatch');
  }
});

test('rejects sparse authoritative arrays instead of normalizing them', () => {
  const cases = [
    ['activation-repository-mismatch', (value) => { value.observation.repository.selectedRepositories = new Array(1); }],
    ['activation-app-mismatch', (value) => { value.observation.app.events = new Array(1); }],
    ['activation-ruleset-mismatch', (value) => { value.observation.ruleset.bypassActors = new Array(1); }],
    ['activation-ruleset-mismatch', (value) => { value.observation.ruleset.requiredStatusChecks = new Array(1); }],
    ['activation-transport-boundary-mismatch', (value) => { value.observation.transportBoundary.allowedPathTemplates = new Array(3); }],
    ['activation-provenance-capture-mismatch', (value) => { value.provenance.capture.surfaces = new Array(4); }],
  ];

  for (const [blocker, mutate] of cases) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, blocker);
  }
});

test('the required protected-merge command executes this activation suite exactly once', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const command = packageJson.scripts['stephanos:operator-merge-approval:test'];
  const testPath = 'shared/agents/operatorProtectedMergeConfigurationActivationV1.test.mjs';
  assert.equal(command.split(testPath).length - 1, 1);
  assert.match(command, /^node --test /);
});
