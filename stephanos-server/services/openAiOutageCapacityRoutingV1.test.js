import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readMissionControllerCapacityRoutingInput } from './programmeAuthorityService.js';
import { createSharedWorkspaceStatusRecord } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
  MISSION_CONTROLLER_ROUTE,
  createBuildLaneCapacityStatusRecord,
} from '../../shared/agents/missionControllerCapacityRouterV1.mjs';

const NOW = '2026-09-29T12:00:00.000Z';
const REPOSITORY = 'Cheekyfellastef/stephan-os';

function canonicalCodexStatus(overrides = {}) {
  return {
    ...createSharedWorkspaceStatusRecord({
      statusId: 'codex-capacity-current',
      participantId: 'codex-capacity-governor',
      timestampUtc: '2026-09-29T11:59:00.000Z',
      status: 'CURRENT',
      summary: 'Canonical Codex capacity is current and available.',
      proofRefs: ['receipts/codex/capacity.json'],
    }),
    observedAtUtc: '2026-09-29T11:59:00.000Z',
    truthState: 'CURRENT',
    meterTruthUsable: true,
    capacityUsable: true,
    remainingPercent: 80,
    availability: 'AVAILABLE',
    confidence: 'high',
    proofRefs: ['receipts/codex/capacity.json'],
    ...overrides,
  };
}

function canonicalGithubRecord(overrides = {}) {
  const receipt = {
    schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
    receiptId: 'github-builder-capacity-20260929t1159z',
    route: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
    repository: REPOSITORY,
    workerId: 'shared-fabric-chatgpt-github-builder-01',
    state: 'READY',
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    supportedTaskClasses: ['FOCUSED_REPAIR', 'MULTI_MODULE_IMPLEMENTATION'],
    observedAtUtc: '2026-09-29T11:59:00.000Z',
    expiresAtUtc: '2026-09-29T12:14:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: 20,
    authorityReceiptIds: [],
    proofRefs: ['receipts/github-builder/capacity.json'],
    ...(overrides.capacityReceipt || {}),
  };
  return {
    ...createBuildLaneCapacityStatusRecord(receipt, { nowUtc: NOW }),
    ...overrides,
    capacityReceipt: receipt,
  };
}

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
    await writeJson(path.join(status, 'codex-capacity-current.json'), canonicalCodexStatus());
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
    await writeJson(path.join(status, 'codex-capacity-current.json'), canonicalCodexStatus());
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

test('canonical ChatGPT-GitHub record can keep OpenAI overflow available', async () => {
  await fixture(async ({ root, status, repoRoot }) => {
    await writeJson(
      path.join(status, 'chatgpt-github-build-capacity-current.json'),
      canonicalGithubRecord(),
    );
    const result = await readMissionControllerCapacityRoutingInput({
      root, repoRoot, nowUtc: NOW, env: {},
    });
    assert.equal(result.openAiBlackout, false);
    assert.deepEqual(result.openAiCapacityProven, { codex: false, chatgptGithub: true });
  });
});

test('malformed READY-looking ChatGPT status cannot suppress automatic blackout', async () => {
  await fixture(async ({ root, status, repoRoot }) => {
    await writeJson(path.join(status, 'chatgpt-github-build-capacity-current.json'), {
      route: 'CHATGPT_GITHUB',
      state: 'READY',
      expiresAtUtc: '2026-09-29T12:14:00.000Z',
    });
    const result = await readMissionControllerCapacityRoutingInput({
      root, repoRoot, nowUtc: NOW, env: {},
    });
    assert.equal(result.openAiBlackout, true);
    assert.equal(result.openAiCapacityProven.chatgptGithub, false);
  });
});

