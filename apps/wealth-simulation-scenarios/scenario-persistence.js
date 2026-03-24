(function (global) {
  const APP_ID = 'wealth-simulation-scenarios';
  const STORAGE_KEY = 'stephanos.wealth.scenarios';
  const STORAGE_VERSION = 1;

  const createDefaultUi = () => ({});

  const createDefaultState = () => ({
    version: STORAGE_VERSION,
    selectedScenario: 'base-case',
    scenarios: {},
    ui: createDefaultUi(),
  });

  const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

  const sanitizeInputMap = (value) => {
    if (!isRecord(value)) {
      return {};
    }

    return Object.entries(value).reduce((accumulator, [key, entry]) => {
      if (typeof key !== 'string' || !key.trim()) {
        return accumulator;
      }

      if (typeof entry === 'number' && Number.isFinite(entry)) {
        accumulator[key] = entry;
        return accumulator;
      }

      if (typeof entry === 'string') {
        accumulator[key] = entry;
        return accumulator;
      }

      if (typeof entry === 'boolean') {
        accumulator[key] = entry;
      }

      return accumulator;
    }, {});
  };

  const sanitizeScenarioMap = (value) => {
    if (!isRecord(value)) {
      return {};
    }

    return Object.entries(value).reduce((accumulator, [scenarioId, scenarioState]) => {
      if (typeof scenarioId !== 'string' || !scenarioId.trim()) {
        return accumulator;
      }

      const inputs = isRecord(scenarioState) ? sanitizeInputMap(scenarioState.inputs) : {};
      accumulator[scenarioId] = { inputs };
      return accumulator;
    }, {});
  };

  const sanitizeUiState = (value) => (isRecord(value) ? { ...value } : createDefaultUi());

  const sanitizePersistedState = (value) => {
    if (!isRecord(value)) {
      return createDefaultState();
    }

    const version = Number(value.version);
    if (!Number.isFinite(version) || version > STORAGE_VERSION) {
      return createDefaultState();
    }

    return {
      version: STORAGE_VERSION,
      selectedScenario: typeof value.selectedScenario === 'string' && value.selectedScenario.trim()
        ? value.selectedScenario
        : 'base-case',
      scenarios: sanitizeScenarioMap(value.scenarios),
      ui: sanitizeUiState(value.ui),
    };
  };

  const createExportPayload = (state) => {
    const sanitizedState = sanitizePersistedState(state);
    const statePayload = {
      selectedScenario: sanitizedState.selectedScenario,
      scenarios: sanitizeScenarioMap(sanitizedState.scenarios),
    };

    return {
      app: APP_ID,
      version: STORAGE_VERSION,
      exportedAt: new Date().toISOString(),
      state: statePayload,
      ui: sanitizeUiState(sanitizedState.ui),
    };
  };

  const validateImportPayload = (value) => {
    if (!isRecord(value)) {
      return {
        ok: false,
        code: 'invalid-json',
        message: 'Import failed: the selected file is not a valid scenario settings export.',
      };
    }

    if (value.app !== APP_ID) {
      return {
        ok: false,
        code: 'unsupported-schema',
        message: 'Import failed: this file is not a Wealth Simulation Scenarios settings export.',
      };
    }

    const version = Number(value.version);
    if (!Number.isFinite(version) || version < 1) {
      return {
        ok: false,
        code: 'unsupported-schema',
        message: 'Import failed: the settings file schema is unsupported.',
      };
    }

    if (version > STORAGE_VERSION) {
      return {
        ok: false,
        code: 'unsupported-version',
        message: 'Import failed: this settings file was created by a newer Wealth Simulation Scenarios version.',
      };
    }

    if (!isRecord(value.state)) {
      return {
        ok: false,
        code: 'unsupported-schema',
        message: 'Import failed: the settings file is missing state data.',
      };
    }

    return {
      ok: true,
      state: sanitizePersistedState({
        version: STORAGE_VERSION,
        selectedScenario: value.state.selectedScenario,
        scenarios: value.state.scenarios,
        ui: value.ui,
      }),
    };
  };

  const downloadTextFile = (filename, contents) => {
    if (!global.document?.createElement || typeof global.URL?.createObjectURL !== 'function') {
      return false;
    }

    const blob = new global.Blob([contents], { type: 'application/json' });
    const downloadUrl = global.URL.createObjectURL(blob);
    const anchor = global.document.createElement('a');

    anchor.href = downloadUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    global.document.body?.appendChild?.(anchor);
    anchor.click();
    anchor.remove?.();
    global.setTimeout?.(() => {
      global.URL.revokeObjectURL?.(downloadUrl);
    }, 0);
    return true;
  };

  const readFileAsText = (file) => {
    if (!file) {
      return Promise.reject(new Error('No file selected.'));
    }

    if (typeof file.text === 'function') {
      return file.text();
    }

    if (typeof global.FileReader !== 'function') {
      return Promise.reject(new Error('File reading is not supported in this browser.'));
    }

    return new Promise((resolve, reject) => {
      const reader = new global.FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(new Error('Unable to read the selected file.'));
      reader.readAsText(file);
    });
  };

  const parseImportedText = (text) => {
    try {
      return validateImportPayload(JSON.parse(text));
    } catch (error) {
      return {
        ok: false,
        code: 'invalid-json',
        message: 'Import failed: the selected file contains invalid or corrupted JSON.',
      };
    }
  };

  const storage = {
    get() {
      try {
        return global.localStorage;
      } catch (error) {
        return null;
      }
    },
    load() {
      const target = this.get();
      if (!target) {
        return createDefaultState();
      }

      try {
        const raw = target.getItem(STORAGE_KEY);
        if (!raw) {
          return createDefaultState();
        }

        return sanitizePersistedState(JSON.parse(raw));
      } catch (error) {
        try {
          target.removeItem(STORAGE_KEY);
        } catch (removeError) {
          // Ignore local-only cleanup failures.
        }
        return createDefaultState();
      }
    },
    save(state) {
      const target = this.get();
      if (!target) {
        return false;
      }

      try {
        target.setItem(STORAGE_KEY, JSON.stringify(sanitizePersistedState(state)));
        return true;
      } catch (error) {
        return false;
      }
    },
    clear() {
      const target = this.get();
      if (!target) {
        return false;
      }

      try {
        target.removeItem(STORAGE_KEY);
        return true;
      } catch (error) {
        return false;
      }
    },
  };

  global.ScenarioPersistence = {
    APP_ID,
    STORAGE_KEY,
    STORAGE_VERSION,
    createDefaultState,
    createExportPayload,
    validateImportPayload,
    parseImportedText,
    sanitizePersistedState,
    downloadTextFile,
    readFileAsText,
    loadState: () => storage.load(),
    saveState: (state) => storage.save(state),
    clearState: () => storage.clear(),
  };
})(window);
