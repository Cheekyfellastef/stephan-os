(function (global) {
  const STORAGE_KEY = 'stephanos.wealth.scenarios';
  const STORAGE_VERSION = 1;

  const createDefaultState = () => ({
    version: STORAGE_VERSION,
    selectedScenario: 'base-case',
    scenarios: {},
    ui: {},
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
      ui: isRecord(value.ui) ? value.ui : {},
    };
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
    STORAGE_KEY,
    STORAGE_VERSION,
    createDefaultState,
    sanitizePersistedState,
    loadState: () => storage.load(),
    saveState: (state) => storage.save(state),
    clearState: () => storage.clear(),
  };
})(window);
