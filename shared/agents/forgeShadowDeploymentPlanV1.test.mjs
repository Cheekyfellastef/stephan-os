import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORGE_SHADOW_DEPLOYMENT_PLAN_DECISIONS,
  FORGE_SHADOW_DEPLOYMENT_PLAN_SCHEMA,
  planForgeShadowDeployment,
} from './forgeShadowDeploymentPlanV1.mjs';

const HEAD = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;

function validInput(overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    canonicalMainHead: HEAD,
    image: { component: 'forgejo', digest: DIGEST },
    boundary: {
      kind: 'container',
      boundaryId: 'forge-shadow-1',
      rootless: true,
      privilegeMode: 'unprivileged',
      hostSourceMount: 'none',
      hostSocketMount: 'none',
    },
    network: {
      bindAddress: '127.0.0.1',
      inboundMode: 'loopback-only',
      outboundMode: 'github-fetch-only',
      publicExposure: false,
      tailscaleExposure: false,
    },
    service: {
      mode: 'read-only-shadow',
      signupEnabled: false,
      repositoryCreationEnabled: false,
      pushEnabled: false,
      actionsEnabled: false,
      runnerRegistrationEnabled: false,
      webhooksEnabled: false,
      federationEnabled: false,
      packageRegistryEnabled: false,
    },
    mirror: {
      mode: 'fetch-only',
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: HEAD,
      sourceAuthentication: 'anonymous-public-read',
      automaticSyncEnabled: false,
      pushEnabled: false,
      forceUpdateEnabled: false,
      pruneEnabled: false,
    },
    backup: {
      targetId: 'forge-shadow-backup-1',
      beforeFirstStart: true,
      restoreDrillRequired: true,
      contentAddressed: true,
      retentionCount: 7,
    },
    sharedWorkspace: { publishStatus: true, publishProof: true },
    ...overrides,
  };
}

test('valid M2 input produces a fixed zero-authority runtime request', () => {
  const result = planForgeShadowDeployment(validInput());
  assert.equal(result.schemaVersion, FORGE_SHADOW_DEPLOYMENT_PLAN_SCHEMA);
  assert.equal(result.valid, true);
  assert.equal(result.decision, FORGE_SHADOW_DEPLOYMENT_PLAN_DECISIONS.READY);
  assert.equal(result.phases.length, 6);
  assert.equal(result.runtimeRequest.imageDigest, DIGEST);
  assert.equal(result.runtimeRequest.requiredParitySchema, 'stephanos.forge-shadow-parity.v1');
  assert.equal(result.runtimeRequest.exactRuntimeAuthorizationRequired, true);
  assert.equal(result.runtimeRequest.command, null);
  assert.equal(result.runtimeRequest.executable, null);
  assert.equal(result.authority.deployment, false);
  assert.equal(result.authority.runtimeMutation, false);
  assert.equal(result.authority.credentialCreation, false);
  assert.equal(result.authority.requiresSeparateRuntimeAuthorization, true);
});

test('mutable image references and unknown components fail closed', () => {
  for (const image of [
    { component: 'forgejo', digest: 'forgejo:latest' },
    { component: 'other', digest: DIGEST },
  ]) {
    const result = planForgeShadowDeployment(validInput({ image }));
    assert.equal(result.valid, false);
  }
});

test('rootful, privileged, source-mounted, or socket-mounted boundaries are rejected', () => {
  for (const boundary of [
    { ...validInput().boundary, rootless: false },
    { ...validInput().boundary, privilegeMode: 'privileged' },
    { ...validInput().boundary, hostSourceMount: 'read-write' },
    { ...validInput().boundary, hostSocketMount: 'docker.sock' },
  ]) {
    const result = planForgeShadowDeployment(validInput({ boundary }));
    assert.equal(result.valid, false);
  }
});

test('public, private-overlay, or non-loopback exposure is rejected', () => {
  for (const network of [
    { ...validInput().network, bindAddress: '0.0.0.0' },
    { ...validInput().network, publicExposure: true },
    { ...validInput().network, tailscaleExposure: true },
    { ...validInput().network, inboundMode: 'lan' },
  ]) {
    const result = planForgeShadowDeployment(validInput({ network }));
    assert.equal(result.valid, false);
  }
});

test('every write, runner, action, webhook, federation, signup, or registry surface stays disabled', () => {
  for (const key of [
    'signupEnabled',
    'repositoryCreationEnabled',
    'pushEnabled',
    'actionsEnabled',
    'runnerRegistrationEnabled',
    'webhooksEnabled',
    'federationEnabled',
    'packageRegistryEnabled',
  ]) {
    const service = { ...validInput().service, [key]: true };
    const result = planForgeShadowDeployment(validInput({ service }));
    assert.equal(result.valid, false, key);
  }
});

test('mirror identity, anonymous read, and no automation/push/force/prune are mandatory', () => {
  for (const mirror of [
    { ...validInput().mirror, repository: 'other/repo' },
    { ...validInput().mirror, sourceHead: 'c'.repeat(40) },
    { ...validInput().mirror, sourceAuthentication: 'token' },
    { ...validInput().mirror, automaticSyncEnabled: true },
    { ...validInput().mirror, pushEnabled: true },
    { ...validInput().mirror, forceUpdateEnabled: true },
    { ...validInput().mirror, pruneEnabled: true },
  ]) {
    const result = planForgeShadowDeployment(validInput({ mirror }));
    assert.equal(result.valid, false);
  }
});

test('backup and restore proof are prerequisites, not later promises', () => {
  for (const backup of [
    { ...validInput().backup, beforeFirstStart: false },
    { ...validInput().backup, restoreDrillRequired: false },
    { ...validInput().backup, contentAddressed: false },
    { ...validInput().backup, retentionCount: 2 },
    { ...validInput().backup, retentionCount: 31 },
  ]) {
    const result = planForgeShadowDeployment(validInput({ backup }));
    assert.equal(result.valid, false);
  }
});

test('Shared Workspace status and proof publication are required but not executed', () => {
  for (const sharedWorkspace of [
    { publishStatus: false, publishProof: true },
    { publishStatus: true, publishProof: false },
  ]) {
    const result = planForgeShadowDeployment(validInput({ sharedWorkspace }));
    assert.equal(result.valid, false);
  }
  const ready = planForgeShadowDeployment(validInput());
  assert.equal(ready.runtimeRequest.statusRecord, 'status/forge-shadow-runtime.json');
  assert.equal(ready.runtimeRequest.proofRecord, 'proofs/forge-shadow-parity.json');
});

test('unexpected command, path, secret, or environment fields are rejected by exact schemas', () => {
  for (const candidate of [
    { ...validInput(), command: 'install' },
    { ...validInput(), secret: 'x' },
    { ...validInput(), boundary: { ...validInput().boundary, path: '/host' } },
    { ...validInput(), mirror: { ...validInput().mirror, environment: { TOKEN: 'x' } } },
  ]) {
    const result = planForgeShadowDeployment(candidate);
    assert.equal(result.valid, false);
    assert.ok(result.blockers.some((blocker) => blocker.includes('schema-unbounded')));
  }
});
