import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readMissionControllerCapacityRoutingInput } from './programmeAuthorityService.js';

const NOW = '2026-09-29T12:00:00.000Z';

async function fixture(run) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'openai-outage-routing-'));
  const root = path.join(temp, 'workspace');
  const status = path.join(root, 'status');
  await mkdir(status, { recursive: true });
  try {
    await run({ root, status, repoRoot: process.cwd() });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('capacity reader automatically blackouts OpenAI when neither OpenAI build surface is proven', async () => {
  await fixture(async ({ root, status, repoRoot }) => {
    await writeJson(path.join(status, 'codex-capacity-current.json'), {
      observedAtUtc: '2026-09-29T11:59:00.000Z',
      availability: 'UNKNOWN',
      meterTruthUsable: false,
      capacityUsable: false,
    });
    await writeJson(path.join(status, 'chatgpt-github-build-capacity-current.json'), {
      status: 'READY',
      capacityReceipt: {
        route: 'CHATGPT_GITHUB',
        state: 'READY',
        expiresAtUtc: '2026-09-29T11:59:59.000Z',
      },
    });
    const result = await readMissionControllerCapacityRoutingInput({
      root, repoRoot, nowUtc: NOW, env: {},
    });
    assert.equal(result.preferNonOpenAi, true);
    assert.equal(result.openAiBlackout, true);
    assert.equal(result.openAiBlackoutReason, 'OPENAI_BUILD_CAPACITY_UNPROVEN');
    assert.deepEqual(result.openAiCapacityProven, { codex: false, chatgptGithub: false });
  });
});

test('fresh affirmative OpenAI build proof keeps overflow available while non-OpenAI remains preferred', async () => {
  await fixture(async ({ root, status, repoRoot }) => {
    await writeJson(path.join(status, 'codex-capacity-current.json'), {
      observedAtUtc: '2026-09-29T11:59:00.000Z',
      availability: 'AVAILABLE',
      meterTruthUsable: true,
      capacityUsable: true,
    });
    const result = await readMissionControllerCapacityRoutingInput({
      root, repoRoot, nowUtc: NOW, env: {},
    });
    assert.equal(result.preferNonOpenAi, true);
    assert.equal(result.openAiBlackout, false);
    assert.equal(result.openAiBlackoutReason, '');
    assert.deepEqual(result.openAiCapacityProven, { codex: true, chatgptGithub: false });
  });
});

test('operator blackout drill forces OpenAI out even when its capacity proof is healthy', async () => {
  await fixture(async ({ root, status, repoRoot }) => {
    await writeJson(path.join(status, 'codex-capacity-current.json'), {
      observedAtUtc: '2026-09-29T11:59:00.000Z',
      availability: 'AVAILABLE',
      meterTruthUsable: true,
      capacityUsable: true,
    });
    const result = await readMissionControllerCapacityRoutingInput({
      root,
      repoRoot,
      nowUtc: NOW,
      env: { STEPHANOS_OPENAI_BLACKOUT: '1' },
    });
    assert.equal(result.openAiBlackout, true);
    assert.equal(result.openAiBlackoutReason, 'OPERATOR_FORCED_OPENAI_BLACKOUT');
    assert.equal(result.openAiCapacityProven.codex, true);
  });
});
