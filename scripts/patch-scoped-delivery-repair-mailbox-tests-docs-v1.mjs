import fs from 'node:fs';
import path from 'node:path';
import { root, read, write, replaceOnce } from './patch-scoped-delivery-repair-lib-v1.mjs';

const mailboxTestPath = 'shared/agents/battleBridgeGitHubCommandMailbox.test.mjs';
let mailboxTest = read(mailboxTestPath);

mailboxTest = replaceOnce(
  mailboxTest,
`function resetCommand(overrides = {}) {`,
`function scopedDelivery(overrides = {}) {
  return {
    prNumber: 1668,
    mergeCommit: 'b83f7df46d9d52233f0b4f5dc2e034f50c0bae93',
    deploymentRequestId: 'req-1507-0001',
    featureId: 'music-tile-auto-url-artwork',
    ...overrides,
  };
}

function resetCommand(overrides = {}) {`,
  'mailbox-test-scoped-helper',
);

mailboxTest = replaceOnce(
  mailboxTest,
`test('control-plane and banked reset commands are allowlisted', () => {`,
`test('scoped delivery identity is exact, operation-bound and preserved in receipts', () => {
  const validated = validateBattleBridgeGitHubCommand(command({
    scopedDelivery: scopedDelivery(),
  }), { authorLogin: 'Cheekyfellastef', now });
  assert.equal(validated.ok, true);
  assert.equal(validated.command.scopedDelivery.deploymentHead, command().expectedHead);
  assert.equal(validated.command.scopedDelivery.relatedPr, '#1668');

  const receipt = buildBattleBridgeGitHubCommandReceipt({
    command: validated.command,
    state: 'ACCEPTED',
    acceptedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
  });
  assert.equal(receipt.relatedPr, '#1668');
  assert.equal(receipt.mergeCommit, scopedDelivery().mergeCommit);
  assert.equal(receipt.deploymentHead, command().expectedHead);
  assert.equal(receipt.deploymentRequestId, command().requestId);
  assert.equal(receipt.featureId, 'music-tile-auto-url-artwork');

  assert.equal(validateBattleBridgeGitHubCommand(command({
    scopedDelivery: scopedDelivery({ deploymentRequestId: 'req-1507-other1' }),
  }), { authorLogin: 'Cheekyfellastef', now }).blocker, 'SCOPED_DELIVERY_REQUEST_ID_MISMATCH');
  assert.equal(validateBattleBridgeGitHubCommand(command({
    scopedDelivery: scopedDelivery({ mergeCommit: 'short' }),
  }), { authorLogin: 'Cheekyfellastef', now }).blocker, 'SCOPED_DELIVERY_MERGE_COMMIT_INVALID');
  assert.equal(validateBattleBridgeGitHubCommand(command({
    scopedDelivery: scopedDelivery({ command: 'dir' }),
  }), { authorLogin: 'Cheekyfellastef', now }).blocker, 'SCOPED_DELIVERY_FIELD_NOT_ALLOWED');
  assert.equal(validateBattleBridgeGitHubCommand(command({
    operation: 'READ_DEPLOYMENT_STATUS',
    scopedDelivery: scopedDelivery(),
  }), { authorLogin: 'Cheekyfellastef', now }).blocker, 'SCOPED_DELIVERY_FIELD_NOT_ALLOWED');
});

test('control-plane and banked reset commands are allowlisted', () => {`,
  'mailbox-test-scoped-validation',
);

mailboxTest = replaceOnce(
  mailboxTest,
`test('dispatches Windows browser proof only through its named handler', async () => {`,
`test('scoped browser proof fails closed when observed merge identity differs', async () => {
  const proof = validateBattleBridgeGitHubCommand(command({
    operation: 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF',
    prNumber: 1668,
    proofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
    proofTarget: 'MERGED_MAIN',
    pullRequestHead: 'a'.repeat(40),
    scopedDelivery: scopedDelivery(),
  }), { authorLogin: 'Cheekyfellastef', now }).command;
  const result = await executeBattleBridgeGitHubCommand(proof, {
    runExactHeadWindowsBrowserProof: async () => ({
      ok: true,
      expectedHead: proof.expectedHead,
      githubMainHead: proof.expectedHead,
      localHead: proof.expectedHead,
      mergeCommitHead: 'd'.repeat(40),
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SCOPED_DELIVERY_MERGE_COMMIT_MISMATCH');
});

test('dispatches Windows browser proof only through its named handler', async () => {`,
  'mailbox-test-scoped-execution',
);

write(mailboxTestPath, mailboxTest);

const docsPath = 'docs/operations/chatgpt-shared-workspace-live-status.md';
let docs = read(docsPath);
docs = replaceOnce(
  docs,
`3. bind the request to repository, PR number, exact merge commit, deployment request ID and feature ID;
4. answer from the scoped delivery projection, never from the newest global workspace heartbeat;`,
`3. bind the request to repository, PR number, exact feature merge commit, exact deployment head, deployment request ID and feature ID;
4. keep feature merge identity separate from the deployment head: the deployment head may equal the feature merge or be a later reviewed descendant, but neither identity may be omitted, inferred from the other, or replaced by an unrelated latest head;
5. answer from the scoped delivery projection, never from the newest global workspace heartbeat;`,
  'docs-identity-split',
);
docs = replaceOnce(
  docs,
`5. report the complete matrix: GitHub merge, deployment acceptance, Battle Bridge source sync, built dist head, served browser head and feature-specific acceptance;
6. use \`LIVE\` only when the served exact head and all required feature proofs are current;
7. return \`UNKNOWN\`, \`BLOCKED\`, \`STALE_OR_REGRESSED\` or the exact incomplete stage when evidence is absent or stale.`,
`6. report the complete matrix: GitHub merge, deployment acceptance, Battle Bridge source sync, built dist head, served browser head and feature-specific acceptance;
7. use \`LIVE\` only when the served exact deployment head and all required feature proofs are current and every evidence record carries the complete scoped identity tuple;
8. return \`UNKNOWN\`, \`BLOCKED\`, \`STALE_OR_REGRESSED\` or the exact incomplete stage when evidence is absent or stale.`,
  'docs-renumber',
);
write(docsPath, docs);

const temporaryFiles = [
  '.github/workflows/one-shot-scoped-delivery-deployment-head-repair-v1.yml',
  'scripts/patch-scoped-delivery-repair-lib-v1.mjs',
  'scripts/patch-scoped-delivery-repair-source-v1.mjs',
  'scripts/patch-scoped-delivery-repair-tests-v1.mjs',
  'scripts/patch-scoped-delivery-repair-mailbox-v1.mjs',
  'scripts/patch-scoped-delivery-repair-mailbox-tests-docs-v1.mjs',
];
for (const rel of temporaryFiles) {
  const target = path.join(root, rel);
  if (fs.existsSync(target)) fs.rmSync(target);
}

const permanentFiles = [
  'shared/agents/sharedWorkspaceScopedDeliveryStatusV1.mjs',
  'shared/agents/sharedWorkspaceScopedDeliveryStatusV1.test.mjs',
  'shared/agents/chatGptParticipantBridgeV1.test.mjs',
  'scripts/chatgpt-shared-workspace-github-relay.test.mjs',
  'shared/agents/battleBridgeGitHubCommandMailbox.mjs',
  'shared/agents/battleBridgeGitHubCommandMailbox.test.mjs',
  'docs/operations/chatgpt-shared-workspace-live-status.md',
];

for (const rel of permanentFiles) {
  if (!fs.existsSync(path.join(root, rel))) throw new Error(`PERMANENT_FILE_MISSING:${rel}`);
}

console.log(JSON.stringify({
  ok: true,
  finalVerdict: 'SCOPED_DELIVERY_DEPLOYMENT_HEAD_REPAIR_PUBLISHED',
  permanentFiles,
  temporaryFilesRemoved: true,
}));
