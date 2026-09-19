import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1,
  OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
  OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1,
} from './openClawBuilderProviderSpecialistReviewSuccessorV1.mjs';

const FULL_SHA = '1'.repeat(40);
const BASE_SHA = '2'.repeat(40);

test('specialist successor keeps OC9, hardlink and PR #1639 path catalogues together', () => {
  assert.equal(OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1.length, 1);
  assert.equal(OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1.length, 5);
  assert.deepEqual(MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1, [
    'scripts/windows/install-battle-bridge-monitor-multiplexer.ps1',
    'scripts/windows/run-battle-bridge-monitor-multiplexer-hidden.ps1',
    'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
  ]);
});

test('exact PR #1639 branch is delegated to the qualified multiplexer reviewer', () => {
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1639,
    branch: 'codex/1585-chatgpt-monitor-admission-bridge-v1',
    sourceHead: FULL_SHA,
    baseSha: BASE_SHA,
    analysis: { findings: [] },
  });
  assert.equal(result.schemaVersion, 'stephanos.monitor-multiplexer-pr1639-specialist-review.v1');
  assert.equal(result.finalVerdict, 'MONITOR_MULTIPLEXER_PR1639_SPECIALIST_NOT_APPLICABLE');
});

test('non-PR #1639 traffic remains on the current successor reviewer', () => {
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1654,
    branch: 'agent/1415-openclaw-update-preflight-v1',
    sourceHead: FULL_SHA,
    baseSha: BASE_SHA,
    analysis: { findings: [] },
  });
  assert.equal(result.schemaVersion, 'stephanos.openclaw-builder-provider-specialist-review-successor.v1');
  assert.equal(result.finalVerdict, 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_NOT_APPLICABLE');
});
