import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildAcceptancePowerShell,
  buildMigrationManifest,
  runWorkbench,
  scanRuntimeProducers,
} from './runtime-boundary-workbench.mjs';

test('scanner identifies a likely runtime writer', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-boundary-scan-'));
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'writer.mjs'), "await fs.writeFile('memory/.dreams/latest.json', '{}');\n");
  const findings = await scanRuntimeProducers(root);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].likelyWriter, true);
  assert.deepEqual(findings[0].registryKeys, ['dreams']);
});

test('migration manifest is non-destructive', () => {
  const registry = {
    entries: {
      dreams: {
        key: 'dreams',
        rootKind: 'openclaw-workspace',
        legacyPrefixes: ['memory/.dreams/'],
        resolvedExternalPath: '/runtime/memory/dreams',
        preservation: 'required',
        reconciliation: 'copy-hash-verify-before-switch',
      },
    },
  };
  const manifest = buildMigrationManifest([], registry);
  assert.equal(manifest.safety.destructiveGitCommandsAllowed, false);
  assert.equal(manifest.safety.sha256Required, true);
  assert.equal(manifest.migrations[0].rootKind, 'openclaw-workspace');
});

test('acceptance packet checks repository cleanliness and read-only migration plan', () => {
  const script = buildAcceptancePowerShell({ runtimeRoot: 'C:\\Runtime', openClawWorkspaceRoot: 'C:\\OpenClaw' });
  assert.match(script, /git status --porcelain=v1/);
  assert.match(script, /migrate-dream-runtime-boundary\.mjs/);
  assert.match(script, /sourceCleanAfter/);
  assert.doesNotMatch(script, /git reset|git clean|git stash|git rebase/i);
});

test('workbench emits the complete accelerator packet', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-boundary-repo-'));
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-boundary-output-'));
  await fs.writeFile(path.join(repoRoot, 'producer.mjs'), "writeFile('logs/current.log', 'ok');\n");
  const result = await runWorkbench({ repoRoot, outputRoot });
  assert.equal(result.inventory.findingCount, 1);
  const names = await fs.readdir(outputRoot);
  assert.deepEqual(names.sort(), [
    'battle-bridge-runtime-boundary-acceptance.ps1',
    'migration-manifest.json',
    'runtime-boundary-plan.md',
    'runtime-path-registry.json',
    'runtime-producer-inventory.json',
    'test-plan.md',
  ]);
});
