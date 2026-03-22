import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../apps/wealth-simulation-scenarios/scenario-persistence.js', import.meta.url), 'utf8');

function loadPersistence() {
  const window = {
    document: {
      readyState: 'loading',
      addEventListener() {},
    },
  };

  vm.runInNewContext(source, { window, console, Date, JSON, Number, Object, Array, String, Boolean, Promise, Blob, setTimeout, clearTimeout });
  return window.ScenarioPersistence;
}

test('createExportPayload includes scenario metadata and preserves per-scenario state', () => {
  const persistence = loadPersistence();
  const payload = persistence.createExportPayload({
    selectedScenario: 'energy-shock',
    scenarios: {
      'base-case': {
        inputs: {
          ISA: 12000,
          'Return Rate': 0.05,
        },
      },
      'energy-shock': {
        inputs: {
          'Desired Income': 42000,
          'Include Stress Toggle': true,
          nested: { ignored: true },
        },
      },
    },
    ui: {
      activeTab: 'config',
    },
  });

  assert.equal(payload.app, 'wealth-simulation-scenarios');
  assert.equal(payload.version, 1);
  assert.equal(payload.selectedScenario, 'energy-shock');
  assert.equal(JSON.stringify(payload.scenarios['base-case']), JSON.stringify({
    inputs: {
      ISA: 12000,
      'Return Rate': 0.05,
    },
  }));
  assert.equal(JSON.stringify(payload.scenarios['energy-shock']), JSON.stringify({
    inputs: {
      'Desired Income': 42000,
      'Include Stress Toggle': true,
    },
  }));
  assert.equal(payload.ui.activeTab, 'config');
  assert.match(payload.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('validateImportPayload rejects wrong app and future versions safely', () => {
  const persistence = loadPersistence();

  const wrongApp = persistence.validateImportPayload({
    app: 'wealthapp',
    version: 1,
    scenarios: {},
    ui: {},
  });
  assert.equal(wrongApp.ok, false);
  assert.equal(wrongApp.code, 'unsupported-schema');

  const futureVersion = persistence.validateImportPayload({
    app: 'wealth-simulation-scenarios',
    version: 2,
    scenarios: {},
    ui: {},
  });
  assert.equal(futureVersion.ok, false);
  assert.equal(futureVersion.code, 'unsupported-version');
});

test('parseImportedText sanitizes scenarios and rejects invalid JSON', () => {
  const persistence = loadPersistence();

  const imported = persistence.parseImportedText(JSON.stringify({
    app: 'wealth-simulation-scenarios',
    version: 1,
    exportedAt: '2026-03-22T00:00:00.000Z',
    selectedScenario: 'cash-buffer-defense',
    scenarios: {
      'cash-buffer-defense': {
        inputs: {
          'Return Rate': '0.04',
          'Savings Mode': true,
          unsupported: ['drop'],
        },
      },
      '': {
        inputs: {
          ignored: 1,
        },
      },
    },
    ui: {
      activeTab: 'presets',
    },
  }));

  assert.equal(imported.ok, true);
  assert.equal(JSON.stringify(imported.state), JSON.stringify({
    version: 1,
    selectedScenario: 'cash-buffer-defense',
    scenarios: {
      'cash-buffer-defense': {
        inputs: {
          'Return Rate': '0.04',
          'Savings Mode': true,
        },
      },
    },
    ui: {
      activeTab: 'presets',
    },
  }));

  const badJson = persistence.parseImportedText('{ nope');
  assert.equal(badJson.ok, false);
  assert.equal(badJson.code, 'invalid-json');
});
