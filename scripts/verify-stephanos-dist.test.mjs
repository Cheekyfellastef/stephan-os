import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const verifyScriptPath = resolve('scripts/verify-stephanos-dist.mjs');
const metadataPath = resolve('apps/stephanos/dist/stephanos-build.json');

test('verify fails fast when dist metadata is stale', () => {
  const originalMetadataRaw = readFileSync(metadataPath, 'utf8');
  const originalMetadata = JSON.parse(originalMetadataRaw);
  const staleMetadata = {
    ...originalMetadata,
    runtimeMarker: `stale-marker::${Date.now()}`,
  };

  writeFileSync(metadataPath, `${JSON.stringify(staleMetadata, null, 2)}\n`);

  try {
    assert.throws(
      () => execFileSync('node', [verifyScriptPath], { encoding: 'utf8' }),
      /metadata mismatch for runtimeMarker|metadata is stale|inconsistent between dist\/index\.html and stephanos-build\.json/,
    );
  } finally {
    writeFileSync(metadataPath, originalMetadataRaw);
  }
});

test('verify fails when dist metadata git commit marker is stale', () => {
  const originalMetadataRaw = readFileSync(metadataPath, 'utf8');
  const originalMetadata = JSON.parse(originalMetadataRaw);
  const staleMetadata = {
    ...originalMetadata,
    gitCommit: 'stale123',
  };

  writeFileSync(metadataPath, `${JSON.stringify(staleMetadata, null, 2)}\n`);

  try {
    assert.throws(
      () => execFileSync('node', [verifyScriptPath], { encoding: 'utf8' }),
      /commit marker is stale \(served dist appears behind current repository commit\)|metadata mismatch for gitCommit|metadata is stale|inconsistent between dist\/index\.html and stephanos-build\.json/,
    );
  } finally {
    writeFileSync(metadataPath, originalMetadataRaw);
  }
});
