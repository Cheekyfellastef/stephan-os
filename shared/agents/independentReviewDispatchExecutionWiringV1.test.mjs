import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const personalMerge = new URL('../../scripts/operator-protected-personal-repository-merge.mjs', import.meta.url);

async function source(url) {
  return readFile(url, 'utf8');
}

test('personal protected merge authenticates selected dispatch review without weakening artifact validation', async () => {
  const text = await source(personalMerge);
  assert.match(text, /validateIndependentReviewWorkflowDispatchExecutionV1/);
  assert.match(text, /reviewEvent === 'workflow_dispatch'/);
  assert.match(text, /validateIndependentReviewArtifact\(artifact, \{/);
  assert.match(text, /expectedBaseSha: identity\.baseSha/);
  assert.match(text, /workflowRunId: selected\.independentReviewWorkflowRunId/);
  assert.match(text, /workflowRunAttempt: selected\.independentReviewWorkflowRunAttempt/);
  assert.match(text, /artifact\.reviewMode !== 'clean-independent'/);
  assert.match(text, /artifact\.receipt\?\.verdict !== 'clean'/);
  assert.match(text, /artifact\.receipt\.findings\.length !== 0/);
});

test('personal protected merge retains legacy pull_request_target review validation as a separate route', async () => {
  const text = await source(personalMerge);
  assert.match(text, /reviewEvent === 'workflow_dispatch'[\s\S]*validateIndependentReviewWorkflowDispatchExecutionV1[\s\S]*:\s*validateIndependentReviewWorkflowRun/s);
  assert.match(text, /expectedBaseBranch: 'main'/);
  assert.match(text, /expectedBaseSha: identity\.baseSha/);
  assert.match(text, /expectedWorkflowRunName:\s*independentReviewWorkflowDispatchRunNameV1\(\{[\s\S]*prNumber: identity\.prNumber,[\s\S]*sourceHead: identity\.sourceHead,[\s\S]*handoffBindingSha256: 'legacy-pull-request-target'/s);
});

test('personal protected merge binds the exact dynamic run name and display title separately from the static definition', async () => {
  const text = await source(personalMerge);
  assert.match(text, /validatePersonalRepositoryDispatchWorkflowDefinition\(definitions\)/);
  assert.match(text, /text\(run\?\.name\) === expectedDisplayTitle/);
  assert.match(text, /text\(run\?\.display_title\) === expectedDisplayTitle/);
  assert.doesNotMatch(text, /text\(run\?\.name\) === text\(definition\.name\)/);
});
