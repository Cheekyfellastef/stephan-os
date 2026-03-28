import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../apps/wealthapp/wealthapp-persistence.js', import.meta.url), 'utf8');

function createLocalStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function loadPersistence(overrides = {}) {
  const window = {
    document: {
      readyState: 'loading',
      addEventListener() {},
    },
    localStorage: createLocalStorage(),
    ...overrides,
  };

  vm.runInNewContext(source, { window, console, Date, JSON, Number, Object, Array, String, setTimeout, clearTimeout });
  return window.WealthAppPersistence;
}

test('createExportPayload uses Wealthapp metadata and sanitized values', () => {
  const persistence = loadPersistence();
  const payload = persistence.createExportPayload({
    version: 999,
    inputs: {
      isa: 5000,
      desiredIncome: 999999,
      chartWidth: 2,
    },
    ui: ['ignored'],
  });

  assert.equal(payload.app, 'wealthapp');
  assert.equal(payload.version, 1);
  assert.equal(payload.inputs.isa, 5000);
  assert.equal(payload.inputs.chartWidth, 2);
  assert.equal(payload.inputs.desiredIncome, undefined);
  assert.equal(JSON.stringify(payload.ui), '{}');
  assert.match(payload.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('validateImportPayload rejects non-Wealthapp and future-version exports', () => {
  const persistence = loadPersistence();

  const wrongApp = persistence.validateImportPayload({
    app: 'other-app',
    version: 1,
    inputs: {},
    ui: {},
  });
  assert.equal(wrongApp.ok, false);
  assert.equal(wrongApp.code, 'unsupported-schema');

  const futureVersion = persistence.validateImportPayload({
    app: 'wealthapp',
    version: 2,
    inputs: {},
    ui: {},
  });
  assert.equal(futureVersion.ok, false);
  assert.equal(futureVersion.code, 'unsupported-version');
});

test('parseImportedText sanitizes supported imports and rejects bad JSON safely', () => {
  const persistence = loadPersistence();

  const imported = persistence.parseImportedText(JSON.stringify({
    app: 'wealthapp',
    version: 1,
    exportedAt: '2026-03-22T00:00:00.000Z',
    inputs: {
      isa: 8100,
      startAge: 52,
      desiredIncome: 15000,
      unknownKey: 123,
    },
    ui: {},
  }));

  assert.equal(imported.ok, true);
  assert.equal(JSON.stringify(imported.state.inputs), JSON.stringify({
    isa: 8100,
    startAge: 52,
  }));

  const badJson = persistence.parseImportedText('{ nope');
  assert.equal(badJson.ok, false);
  assert.equal(badJson.code, 'invalid-json');
});

test('loadStateWithMeta prefers shared backend state over legacy/default and keeps UI state local-only', async () => {
  const localStorage = createLocalStorage({
    'stephanos.wealth.app': JSON.stringify({
      version: 1,
      inputs: {
        isa: 901,
      },
      ui: {
        ignored: true,
      },
    }),
    'stephanos.wealth.app.ui.local.v1': JSON.stringify({
      activeTab: 'projections',
    }),
  });

  const persistence = loadPersistence({
    localStorage,
    StephanosTileDataContract: {
      client: {
        apiBaseUrl: 'http://192.168.0.198:8787',
        async loadDurableState() {
          return {
            source: 'shared-backend',
            state: {
              version: 1,
              inputs: {
                isa: 12000,
                startAge: 57,
              },
              ui: {
                shouldNotPersist: true,
              },
            },
            diagnostics: { status: 200 },
          };
        },
      },
    },
  });

  const loaded = await persistence.loadStateWithMeta();
  assert.equal(loaded.meta.source, 'shared-backend');
  assert.equal(loaded.state.inputs.isa, 12000);
  assert.equal(loaded.state.inputs.startAge, 57);
  assert.deepEqual(loaded.state.ui, { activeTab: 'projections' });
});
