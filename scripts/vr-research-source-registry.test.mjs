import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);

async function readJson(path) {
  return JSON.parse(await readFile(resolve(repoRoot, path), 'utf8'));
}

test('canonical VR source registry is valid, unique and locally grounded', async () => {
  const registry = await readJson('VR-Research-Lab/knowledge-sources.json');
  assert.equal(registry.schema_version, '1.8');
  assert.equal(registry.domain, 'vr');
  assert.ok(Array.isArray(registry.sources));
  assert.equal(registry.sources.length, 24);

  const sourceIds = registry.sources.map((source) => String(source.source_id || ''));
  assert.equal(sourceIds.every(Boolean), true);
  assert.equal(new Set(sourceIds).size, sourceIds.length);

  for (const source of registry.sources) {
    assert.match(String(source.priority || ''), /^P[0-9]+$/);
    assert.ok(String(source.status || '').trim(), `${source.source_id}: status required`);
    assert.ok(String(source.licence || '').trim(), `${source.source_id}: licence required`);
    assert.ok(String(source.promotion_rule || '').trim(), `${source.source_id}: promotion rule required`);
    if (source.local_manifest) await access(resolve(repoRoot, source.local_manifest));
    if (source.local_extraction) await access(resolve(repoRoot, source.local_extraction));
  }

  const headsetVr = registry.sources.find((source) => source.source_id === 'creator-headset-vr');
  assert.equal(headsetVr?.status, 'registered-configuration-profile-field-evidence');
  assert.equal(headsetVr?.local_manifest, 'VR-Research-Lab/knowledge-sources/headset-vr/source-manifest.json');
  assert.equal(headsetVr?.local_extraction, 'VR-Research-Lab/knowledge-sources/headset-vr/knowledge-extraction.md');

  const betterVr = registry.sources.find((source) => source.source_id === 'github-crementif-botw-bettervr');
  assert.equal(betterVr?.priority, 'P0');
  assert.equal(betterVr?.repository, 'Crementif/BotW-BetterVR');
  assert.equal(betterVr?.snapshot_commit, '0e1053d58cdfbd592522dc892b1770418a1af009');
  assert.equal(betterVr?.snapshot_release, '0.9.20');
  assert.equal(betterVr?.licence, 'MIT');
  assert.equal(betterVr?.local_manifest, 'VR-Research-Lab/knowledge-sources/botw-bettervr/source-manifest.json');
  assert.equal(betterVr?.local_extraction, 'VR-Research-Lab/knowledge-sources/botw-bettervr/knowledge-extraction.md');
});

test('visible VR Lab workspace reports the same canonical source count', async () => {
  const workspace = await readJson('VR-Research-Lab/lab-workspace.json');
  assert.equal(workspace.schemaVersion, 'stephanos.vr-research-lab.workspace.v4');
  assert.match(workspace.overview.join(' '), /24-source VR knowledge stack/);
  assert.ok(workspace.knowledgeBuckets.includes('24-source canonical registry: provenance, revision, licence, freshness and promotion state'));
  assert.ok(workspace.folderMap.some((entry) => entry.path === 'VR-Research-Lab/knowledge-sources/cyberpunk-vr-port/knowledge-extraction.md'));
  assert.ok(workspace.folderMap.some((entry) => entry.path === 'VR-Research-Lab/knowledge-sources/witcher-3-vr-route/knowledge-extraction.md'));
  assert.ok(workspace.folderMap.some((entry) => entry.path === 'VR-Research-Lab/knowledge-sources/headset-vr/knowledge-extraction.md'));
  assert.ok(workspace.folderMap.some((entry) => entry.path === 'VR-Research-Lab/knowledge-sources/botw-bettervr/knowledge-extraction.md'));
});
