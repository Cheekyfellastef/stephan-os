import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const specialistWrapper = new URL('../../scripts/independent-merge-security-review-with-windows-specialist-v1.mjs', import.meta.url);
const personalMerge = new URL('../../scripts/operator-protected-personal-repository-merge.mjs', import.meta.url);

async function source(url) {
  return readFile(url, 'utf8');
}

test('specialist wrapper bridges only a trusted workflow_dispatch preflight into the existing reviewer', async () => {
  const text = await source(specialistWrapper);
  assert.match(text, /buildIndependentReviewWorkflowDispatchBridgeV1/);
  assert.match(text, /eventName === 'pull_request_target'/);
  assert.match(text, /eventName !== 'workflow_dispatch'/);
  assert.match(text, /independent-review-workflow-dispatch-preflight\.json/);
  assert.match(text, /independent-review-workflow-dispatch-reviewer-event\.json/);
  assert.match(text, /GITHUB_EVENT_NAME: bridge\.syntheticEventName/);
  assert.match(text, /GITHUB_EVENT_PATH: syntheticEventPath/);
  assert.match(text, /spawnSync\(process\.execPath, \['scripts\/independent-merge-security-review-v2\.mjs'\]/);
  assert.match(text, /shell: false/);
});

test('personal protected merge authenticates selected dispatch review without weakening artifact validation', async () => {
  const text = await source(personalMerge);
  assert.match(text, /validateIndependentReviewWorkflowDispatchExecutionV1/);
  assert.match(text, /reviewEvent === 'workflow_dispatch'/);
  assert.match(text, /validateIndependentReviewArtifact\(artifact, \{/);
  assert.match(text, /expectedBaseSha: identity\.baseSha/);
  assert.match(text, /artifact\.reviewMode !== 'clean-independent'/);
  assert.match(text, /artifact\.receipt\?\.verdict !== 'clean'/);
  assert.match(text, /artifact\.receipt\.findings\.length !== 0/);
});

test('personal protected merge binds GitHub workflow name and dynamic display title to their correct fields', async () => {
  const text = await source(personalMerge);
  assert.match(text, /text\(run\?\.name\) === text\(definition\.name\)/);
  assert.match(text, /text\(run\?\.display_title\) === expectedDisplayTitle/);
  assert.doesNotMatch(text, /text\(run\?\.name\) === expectedDisplayTitle/);
});
