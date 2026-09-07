import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(
  new URL('../../.github/workflows/operator-merge-approval-gate.yml', import.meta.url),
  'utf8',
);
const mailbox = await readFile(
  new URL('./protectedWorkflowDispatchMailboxV1.mjs', import.meta.url),
  'utf8',
);
const baseBinding = await readFile(
  new URL('./operatorMergeBaseBindingV1.mjs', import.meta.url),
  'utf8',
);
const personalMerge = await readFile(
  new URL('./operatorPersonalRepositoryMergeV1.mjs', import.meta.url),
  'utf8',
);

test('protected workflow distinguishes operator authorization base from fresh execution base', () => {
  assert.match(workflow, /authorization_base:/);
  assert.match(workflow, /AUTHORIZATION_BASE/);
  assert.match(workflow, /EXPECTED_BASE/);
  assert.match(workflow, /mainMovementTolerantOperatorAuthorizationV1|main-movement-tolerant/i);
  assert.match(workflow, /expected_base:/);
});

test('canonical #1507 protected dispatch carries authorizationBase separately from expectedBase', () => {
  assert.match(mailbox, /authorizationBase/);
  assert.match(mailbox, /authorization_base/);
  assert.match(mailbox, /expectedBase/);
  assert.match(mailbox, /expected_base/);
});

test('base-binding policy explicitly consumes main-movement compatibility instead of globally weakening base checks', () => {
  assert.match(baseBinding, /mainMovementTolerantOperatorAuthorizationV1|main-movement-tolerant/i);
  assert.match(baseBinding, /authorizationBase/);
  assert.match(baseBinding, /executionBase|expectedBase/);
  assert.doesNotMatch(baseBinding, /reusableAcrossHeads:\s*true/);
});

test('personal-repository executor remains exact on the fresh execution tuple', () => {
  assert.match(personalMerge, /liveMainRef/);
  assert.match(personalMerge, /baseSha/);
  assert.match(personalMerge, /sourceHead/);
  assert.match(personalMerge, /sourceTree/);
  assert.match(personalMerge, /mergeable|mergeStateStatus/);
});

test('wiring never introduces a raw merge, force, rebase or runtime authority helper into the compatibility policy', async () => {
  const policy = await readFile(new URL('./mainMovementTolerantOperatorAuthorizationV1.mjs', import.meta.url), 'utf8');
  assert.match(policy, /mergeAuthority:\s*false/);
  assert.match(policy, /deploymentAuthority:\s*false/);
  assert.match(policy, /runtimeMutationAuthority:\s*false/);
  assert.doesNotMatch(policy, /merge_pull_request\s*\(|git\s+push\s+--force\b|git\s+reset\s+--hard\b|git\s+rebase\b/i);
});
