import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const tilePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'OpenClawTile.jsx');

test('OpenClaw landing tile layout uses responsive card surface without nested workspace canvas', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('<CollapsiblePanel'), true);
  assert.equal(source.includes('className="openclaw-tile-layout openclaw-tile-root"'), true);
  assert.equal(source.includes('data-layout="openclaw-canonical-grid"'), true);
  assert.equal(source.includes('stephanos-workspace-canvas'), false);
  assert.equal(source.includes('100vw'), false);
});

test('OpenClawTile renders top-level dashboard cards', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  ['OpenClaw Status / Authority','OpenClaw Mission Card','Policy / Guardrails','Proposal / Codex Handoff','Evidence / Readiness'].forEach((label) => {
    assert.equal(source.includes(label), true);
  });
});
