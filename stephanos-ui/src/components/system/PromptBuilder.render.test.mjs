import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importBundledModule, srcRoot } from '../../test/renderHarness.mjs';

test('PromptBuilder renders mission input and prompt output area', async () => {
  const { renderPromptBuilder } = await importBundledModule(
    path.join(srcRoot, 'test/renderPromptBuilderEntry.jsx'),
    {},
    'prompt-builder-render',
  );

  const rendered = renderPromptBuilder({
    runtimeStatusModel: { finalRouteTruth: { routeKind: 'cloud', backendReachable: true } },
    telemetryEntries: [{ id: 'evt-1', timestamp: '2026-01-01T00:00:00.000Z', subsystem: 'SYSTEM', change: 'baseline' }],
    actionHints: [{ severity: 'info', subsystem: 'SYSTEM', text: 'All clear.' }],
  });

  assert.match(rendered, /Prompt Builder/);
  assert.match(rendered, /placeholder="Describe the implementation or debugging mission"/);
  assert.match(rendered, /Prompt output/);
  assert.match(rendered, /Copy Prompt/);
  assert.match(rendered, /## CURRENT TRUTH SNAPSHOT/);
  assert.match(rendered, /## RECENT TELEMETRY/);
});

test('PromptBuilder still renders mission-only shell when runtime truth is unavailable', async () => {
  const { renderPromptBuilder } = await importBundledModule(
    path.join(srcRoot, 'test/renderPromptBuilderEntry.jsx'),
    {},
    'prompt-builder-no-truth',
  );

  const rendered = renderPromptBuilder({ runtimeStatusModel: null, telemetryEntries: [], actionHints: [] });
  assert.match(rendered, /## CURRENT MISSION/);
  assert.match(rendered, /## REQUEST/);
});
