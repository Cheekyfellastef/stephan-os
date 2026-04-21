import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importBundledModule, srcRoot } from './test/renderHarness.mjs';
import { recordStartupLaunchTrigger, resetStartupDiagnostics } from '../../shared/runtime/startupLaunchDiagnostics.mjs';

test('startup fallback summary includes failing stage and direct dist URL', async () => {
  resetStartupDiagnostics();
  recordStartupLaunchTrigger({
    sourceModule: 'modules/command-deck/command-deck.js',
    sourceFunction: 'launchProject',
    triggerType: 'user-click',
    rawTarget: '/apps/stephanos/dist/index.html',
    resolvedTarget: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
  });

  const { buildStartupFailureSummary } = await importBundledModule(
    path.join(srcRoot, 'startupFailureFallback.jsx'),
  );
  const summary = buildStartupFailureSummary(new Error('render failed'), 'runtime-store-initialized');

  assert.match(summary, /stage=runtime-store-initialized/);
  assert.match(summary, /message=render failed/);
  assert.match(summary, /directDistUrl=http:\/\/127\.0\.0\.1:4173\/apps\/stephanos\/dist\/index\.html/);
  assert.match(summary, /target=http:\/\/127\.0\.0\.1:4173\/apps\/stephanos\/dist\/index\.html/);
  resetStartupDiagnostics();
});
