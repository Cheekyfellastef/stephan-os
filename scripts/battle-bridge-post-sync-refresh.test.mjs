import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./battle-bridge-post-sync-refresh.mjs', import.meta.url), 'utf8');

test('fresh coordinator compares immutable heads through fixed shell-free git argv', () => {
  assert.match(source, /merge-base', '--is-ancestor'/);
  assert.match(source, /diff', '--name-status', '--find-renames', '--diff-filter=ACDMRT'/);
  assert.match(source, /shell: false/);
  assert.doesNotMatch(source, /reset --hard|git clean|git checkout|git push|Invoke-Expression/);
});

test('runtime adapters are fixed to UI backend worker and natural reload', () => {
  assert.match(source, /refreshStephanosUi4173/);
  assert.match(source, /restart-approved-stephanos-runtime\.ps1/);
  assert.match(source, /target: 'backend'/);
  assert.match(source, /target: 'mission-worker'/);
  assert.match(source, /confirmNaturalReload/);
});

test('workspace publication contains bounded projections and relative proof refs', () => {
  assert.match(source, /receipts', 'post-sync-runtime-refresh'/);
  assert.match(source, /post-sync-runtime-refresh-current\.json/);
  assert.match(source, /buildPostSyncRefreshProjection/);
  assert.doesNotMatch(source, /proofRefs:\s*\[[^\]]*repoRoot/);
});

test('coordinator resumes exact-head target checkpoints without replaying completed work', () => {
  assert.match(source, /loadResumeResults/);
  assert.match(source, /completedResults/);
  assert.match(source, /checkpoint-\$\{results\.length\}/);
  assert.ok(
    source.indexOf('loadResumeResults(paths.workspaceRoot')
      < source.indexOf("phase: 'plan'"),
  );
});

test('CLI accepts only before and after SHAs and emits one result marker', () => {
  assert.match(source, /POST_SYNC_REFRESH_RESULT=/);
  assert.match(source, /POST_SYNC_REFRESH_ARGUMENT_NOT_ALLOWED/);
  assert.match(source, /POST_SYNC_HEADS_INVALID/);
});
