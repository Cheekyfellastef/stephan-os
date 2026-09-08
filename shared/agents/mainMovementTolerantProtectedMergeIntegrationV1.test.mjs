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

test('protected workflow derives material authorization from the owner comment, never caller workflow inputs', () => {
  assert.doesNotMatch(workflow, /^      authorization_head:\s*$/m);
  assert.doesNotMatch(workflow, /^      authorization_head_tree:\s*$/m);
  assert.doesNotMatch(workflow, /^      authorization_base:\s*$/m);
  assert.match(workflow, /authorization_head:\s*\$\{\{ steps\.authorization\.outputs\.authorization_head \}\}/);
  assert.match(workflow, /authorization_head_tree:\s*\$\{\{ steps\.authorization\.outputs\.authorization_head_tree \}\}/);
  assert.match(workflow, /authorization_base:\s*\$\{\{ steps\.authorization\.outputs\.authorization_base \}\}/);
  assert.match(workflow, /validation\.materialAuthorization\.authorizationHead/);
  assert.match(workflow, /validation\.materialAuthorization\.authorizationHeadTree/);
  assert.match(workflow, /validation\.materialAuthorization\.authorizationBase/);
  assert.match(workflow, /STEPHANOS_AUTHORIZATION_HEAD:\s*\$\{\{ needs\.personal-repository-evidence\.outputs\.authorization_head \}\}/);
  assert.match(workflow, /STEPHANOS_AUTHORIZATION_BASE:\s*\$\{\{ needs\.personal-repository-evidence\.outputs\.authorization_base \}\}/);
  assert.match(workflow, /EXPECTED_BASE/);
  assert.match(workflow, /mainMovementTolerantOperatorAuthorizationV1|main-movement-tolerant/i);
  assert.match(workflow, /expected_base:/);
});

test('canonical #1507 dispatch carries only fresh execution tuple and comment identity into workflow', () => {
  assert.match(mailbox, /authorizationBase/);
  assert.match(mailbox, /expectedBase/);
  assert.doesNotMatch(mailbox, /authorization_head:\s*c\.authorizationHead/);
  assert.doesNotMatch(mailbox, /authorization_head_tree:\s*c\.authorizationHeadTree/);
  assert.doesNotMatch(mailbox, /authorization_base:\s*c\.authorizationBase/);
  assert.match(mailbox, /authorization_comment_id:/);
  assert.match(mailbox, /historicalExecutionIdentity/);
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

test('wiring never introduces a raw merge, force, rebase or runtime authority helper into compatibility policy', async () => {
  const policy = await readFile(new URL('./mainMovementTolerantOperatorAuthorizationV1.mjs', import.meta.url), 'utf8');
  assert.match(policy, /mergeAuthority:\s*false/);
  assert.match(policy, /deploymentAuthority:\s*false/);
  assert.match(policy, /runtimeMutationAuthority:\s*false/);
  assert.doesNotMatch(policy, /merge_pull_request\s*\(|git\s+push\s+--force\b|git\s+reset\s+--hard\b|git\s+rebase\b/i);
});
