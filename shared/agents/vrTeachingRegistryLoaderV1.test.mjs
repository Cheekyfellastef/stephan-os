import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRegisteredVrTeachingProjectionV1 } from './vrTeachingRegistryLoaderV1.mjs';

test('registry loader follows canonical local_teaching_records without caller-supplied teaching records', async () => {
  const repoRoot = process.cwd();
  const result = await loadRegisteredVrTeachingProjectionV1({
    repoRoot,
    updatedAt: '2026-09-29T04:38:36.6253282+01:00',
    nowMs: Date.parse('2026-09-29T04:38:36.6253282+01:00'),
  });
  assert.ok(result.loadedTeachingRecordCount >= 10);
  assert.ok(result.loadedTeachingPackets.some((packet) => packet.sourceId === 'battle-bridge-installed-vr-corpus'));
});

test('registry loader rejects teaching packet traversal outside the repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vr-teaching-loader-'));
  try {
    await mkdir(join(root, 'VR-Research-Lab'), { recursive: true });
    await writeFile(join(root, 'VR-Research-Lab', 'knowledge-sources.json'), JSON.stringify({
      schema_version: 'test',
      sources: [{ source_id: 'escape', local_teaching_records: '../outside.json' }],
    }));
    await writeFile(join(root, 'VR-Research-Lab', 'lab-workspace.json'), JSON.stringify({ schemaVersion: 'test' }));
    await assert.rejects(
      () => loadRegisteredVrTeachingProjectionV1({ repoRoot: root }),
      /vr-teaching-registered-path-unsafe/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
