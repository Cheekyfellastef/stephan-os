import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const REVIEWER = readFileSync(
  new URL('../../scripts/independent-merge-security-review-v2.mjs', import.meta.url),
  'utf8',
);
const WORKFLOW = readFileSync(
  new URL('../../.github/workflows/independent-merge-security-review.yml', import.meta.url),
  'utf8',
);

test('approval-boundary self-change publishes its immutable artifact before the bootstrap receipt', () => {
  assert.match(
    REVIEWER,
    /const bootstrapRequired = deterministicBootstrapRequired \|\| isApprovalBoundaryBootstrapAnalysis\(analysis\);/,
  );

  const artifactBuild = REVIEWER.indexOf('const artifact = buildIndependentReviewArtifact({');
  const artifactWrite = REVIEWER.indexOf('const artifactPath = writeReviewArtifact(artifact);', artifactBuild);
  const displayComment = REVIEWER.indexOf(
    'const comment = await postDisplayComment(owner, repo, prNumber, body);',
    artifactWrite,
  );
  const verdict = REVIEWER.indexOf(
    "INDEPENDENT_SECURITY_REVIEW=${bootstrapRequired ? 'operator-bootstrap-required' : 'clean'}",
    displayComment,
  );

  assert.ok(artifactBuild >= 0, 'reviewer must build the exact immutable review artifact');
  assert.ok(artifactWrite > artifactBuild, 'reviewer must persist the artifact before publication');
  assert.ok(displayComment > artifactWrite, 'bootstrap display receipt must follow immutable artifact persistence');
  assert.ok(verdict > displayComment, 'operator-bootstrap-required verdict must follow publication');
  assert.match(REVIEWER, /approval-boundary review requires protected operator bootstrap/);
  assert.match(REVIEWER, /This receipt contains only approval-boundary self-change findings\./);
});

test('draft source synchronization retains the trusted exact-base pull_request_target review route', () => {
  assert.match(
    WORKFLOW,
    /pull_request_target:\s*\n\s*branches: \[main\]\s*\n\s*types: \[opened, synchronize, reopened, ready_for_review\]/,
  );

  const trustedBaseStep = WORKFLOW.indexOf('- name: Check out trusted exact-base reviewer');
  const dispatchStep = WORKFLOW.indexOf('- name: Check out trusted current-main reviewer');
  assert.ok(trustedBaseStep >= 0, 'workflow must retain the pull_request_target trusted-base checkout');
  assert.ok(dispatchStep > trustedBaseStep, 'event-specific trusted checkouts must remain distinct');

  const baseSection = WORKFLOW.slice(trustedBaseStep, dispatchStep);
  assert.match(baseSection, /if: github\.event_name == 'pull_request_target'/);
  assert.match(baseSection, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(baseSection, /persist-credentials: false/);
  assert.doesNotMatch(baseSection, /pull_request\.head\.sha/);
});
