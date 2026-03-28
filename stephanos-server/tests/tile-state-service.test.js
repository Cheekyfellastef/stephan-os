import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TileStateService } from '../services/tileStateService.js';

test('tile state service persists shared durable tile state across restarts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stephanos-tile-state-'));
  const file = path.join(tempDir, 'tile-state.json');

  const service = new TileStateService(file);
  const saved = service.set('wealthapp', {
    schemaVersion: 1,
    state: { version: 1, inputs: { isa: 3500 }, ui: {} },
    source: 'tile-runtime',
  });

  assert.equal(saved.appId, 'wealthapp');
  assert.equal(saved.state.inputs.isa, 3500);

  const reloaded = new TileStateService(file);
  const fromDisk = reloaded.get('wealthapp');

  assert.ok(fromDisk);
  assert.equal(fromDisk.state.inputs.isa, 3500);
  assert.equal(fromDisk.source, 'tile-runtime');
});

