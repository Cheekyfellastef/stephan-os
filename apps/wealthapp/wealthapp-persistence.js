(function (global) {
  const STORAGE_KEY = 'stephanos.wealth.app';
  const STORAGE_VERSION = 1;
  const WRITE_DEBOUNCE_MS = 180;

  const FIELD_DEFINITIONS = {
    isa: { defaultValue: 2200, min: 0, max: 100000000 },
    wifeIsa: { defaultValue: 0, min: 0, max: 100000000 },
    dormantPension: { defaultValue: 124500, min: 0, max: 100000000 },
    activePension: { defaultValue: 93000, min: 0, max: 100000000 },
    houseSaleValue: { defaultValue: 0, min: 0, max: 100000000 },
    retirementAge: { defaultValue: 60, min: 55, max: 70 },
    desiredIncome: { defaultValue: 30000, min: 20000, max: 50000 },
    combinedStatePensionAnnual: { defaultValue: 23000, min: 0, max: 30000 },
    returnRate: { defaultValue: 0.045, min: 0.02, max: 0.1 },
    isaAnnualContribution: { defaultValue: 20000, min: 0, max: 20000 },
    activePensionContribution: { defaultValue: 14000, min: 0, max: 30000 },
    houseSaleAge: { defaultValue: 75, min: 55, max: 95 },
    yourIsaFromHouse: { defaultValue: 10000, min: 0, max: 20000 },
    wifeIsaFromHouse: { defaultValue: 10000, min: 0, max: 20000 },
    startAge: { defaultValue: 55, min: 50, max: 70 },
    endAge: { defaultValue: 100, min: 80, max: 110 },
    chartWidth: { defaultValue: 1, min: 1, max: 3 },
  };

  const ASSET_LABEL_TO_KEY = {
    ISA: 'isa',
    'Wife ISA': 'wifeIsa',
    'Dormant Pension': 'dormantPension',
    'Active Pension': 'activePension',
    'House Sale Value': 'houseSaleValue',
  };

  const SLIDER_LABEL_TO_KEY = {
    'Retirement Age': 'retirementAge',
    'Desired Income': 'desiredIncome',
    'Combined State Pension (Annual)': 'combinedStatePensionAnnual',
    'Return Rate': 'returnRate',
    'ISA Annual Contribution': 'isaAnnualContribution',
    'Active Pension Contribution': 'activePensionContribution',
    'House Sale Age': 'houseSaleAge',
    'Your ISA From House': 'yourIsaFromHouse',
    'Wife ISA From House': 'wifeIsaFromHouse',
    'Start Age': 'startAge',
    'End Age': 'endAge',
    'Chart Width': 'chartWidth',
  };

  const expectedControlCount = Object.keys(FIELD_DEFINITIONS).length;

  const createDefaultInputs = () => Object.entries(FIELD_DEFINITIONS).reduce((accumulator, [key, definition]) => {
    accumulator[key] = definition.defaultValue;
    return accumulator;
  }, {});

  const createDefaultState = () => ({
    version: STORAGE_VERSION,
    inputs: {},
    ui: {},
  });

  const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

  const sanitizeNumber = (key, value) => {
    const definition = FIELD_DEFINITIONS[key];
    const numericValue = typeof value === 'number' ? value : Number(value);

    if (!definition || !Number.isFinite(numericValue)) {
      return null;
    }

    if (numericValue < definition.min || numericValue > definition.max) {
      return null;
    }

    return numericValue;
  };

  const sanitizeInputMap = (value) => {
    if (!isRecord(value)) {
      return {};
    }

    return Object.entries(value).reduce((accumulator, [key, entry]) => {
      if (typeof key !== 'string' || !key.trim() || !(key in FIELD_DEFINITIONS)) {
        return accumulator;
      }

      const sanitizedValue = sanitizeNumber(key, entry);
      if (sanitizedValue !== null) {
        accumulator[key] = sanitizedValue;
      }

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
      inputs: sanitizeInputMap(value.inputs),
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

  const getInputValue = (input) => {
    const key = input?.dataset?.settingKey;
    if (!key || !(key in FIELD_DEFINITIONS)) {
      return null;
    }

    return sanitizeNumber(key, input.value);
  };

  const readInputsFromDom = (controls) => Array.from(controls).reduce((accumulator, input) => {
    const key = input?.dataset?.settingKey;
    const value = getInputValue(input);

    if (key && value !== null) {
      accumulator[key] = value;
    }

    return accumulator;
  }, {});

  const dispatchControlUpdate = (input) => {
    if (!input || typeof input.dispatchEvent !== 'function' || typeof global.Event !== 'function') {
      return;
    }

    input.dispatchEvent(new global.Event('input', { bubbles: true }));
    input.dispatchEvent(new global.Event('change', { bubbles: true }));
  };

  const applyInputsToDom = (controls, inputs) => {
    Array.from(controls).forEach((input) => {
      const key = input?.dataset?.settingKey;
      if (!key || !(key in FIELD_DEFINITIONS)) {
        return;
      }

      const nextValue = Object.prototype.hasOwnProperty.call(inputs, key)
        ? inputs[key]
        : FIELD_DEFINITIONS[key].defaultValue;

      input.value = String(nextValue);
      dispatchControlUpdate(input);
    });
  };

  const collectControls = (root) => {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return [];
    }

    const controls = [];
    const assetLabels = root.querySelectorAll('.stephanos-wealthapp__asset-grid label');
    assetLabels.forEach((label) => {
      const key = ASSET_LABEL_TO_KEY[label.textContent?.trim() ?? ''];
      const input = label.nextElementSibling;
      if (!key || !input) {
        return;
      }

      input.dataset.settingKey = key;
      controls.push(input);
    });

    const sliderBlocks = root.querySelectorAll('.stephanos-wealthapp__slider');
    sliderBlocks.forEach((block) => {
      const label = block.querySelector('.stephanos-wealthapp__slider-label');
      const input = block.querySelector('input[type="range"]');
      const labelText = label?.textContent?.split(':')[0]?.trim() ?? '';
      const key = SLIDER_LABEL_TO_KEY[labelText];

      if (!key || !input) {
        return;
      }

      input.dataset.settingKey = key;
      controls.push(input);
    });

    return controls;
  };

  const attachResetButton = (root, onReset) => {
    if (!root || typeof root.querySelector !== 'function') {
      return null;
    }

    const existingButton = root.querySelector('[data-wealthapp-reset]');
    if (existingButton) {
      return existingButton;
    }

    const title = root.querySelector('.stephanos-wealthapp__title, h1');
    const toolbar = global.document?.createElement?.('div');
    const button = global.document?.createElement?.('button');

    if (!title || !toolbar || !button) {
      return null;
    }

    toolbar.className = 'stephanos-wealthapp__actions';
    button.type = 'button';
    button.className = 'stephanos-wealthapp__reset-button';
    button.dataset.wealthappReset = 'true';
    button.textContent = 'Reset to Defaults';
    button.addEventListener('click', onReset);
    toolbar.appendChild(button);
    title.insertAdjacentElement('afterend', toolbar);
    return button;
  };

  const setupPersistence = () => {
    const root = global.document?.querySelector?.('.stephanos-wealthapp');
    if (!root) {
      return false;
    }

    const controls = collectControls(root);
    if (controls.length !== expectedControlCount) {
      return false;
    }

    let writeTimer = null;
    let suppressSave = false;

    const flushSave = () => {
      if (suppressSave) {
        return;
      }

      storage.save({
        version: STORAGE_VERSION,
        inputs: readInputsFromDom(controls),
        ui: {},
      });
    };

    const scheduleSave = () => {
      if (suppressSave) {
        return;
      }

      global.clearTimeout?.(writeTimer);
      writeTimer = global.setTimeout?.(() => {
        writeTimer = null;
        flushSave();
      }, WRITE_DEBOUNCE_MS);
    };

    const applyState = (state) => {
      suppressSave = true;
      applyInputsToDom(controls, {
        ...createDefaultInputs(),
        ...state.inputs,
      });
      suppressSave = false;
    };

    const handleReset = () => {
      suppressSave = true;
      global.clearTimeout?.(writeTimer);
      writeTimer = null;
      applyInputsToDom(controls, createDefaultInputs());
      storage.clear();
      suppressSave = false;
    };

    controls.forEach((input) => {
      input.addEventListener('input', scheduleSave);
      input.addEventListener('change', scheduleSave);
    });

    global.addEventListener?.('pagehide', flushSave);
    global.addEventListener?.('beforeunload', flushSave);

    attachResetButton(root, handleReset);
    applyState(storage.load());
    return true;
  };

  let hasInitialized = false;

  const bootstrapPersistence = () => {
    if (hasInitialized) {
      return;
    }

    if (setupPersistence()) {
      hasInitialized = true;
      return;
    }

    if (typeof global.MutationObserver !== 'function') {
      return;
    }

    const observer = new global.MutationObserver(() => {
      if (setupPersistence()) {
        hasInitialized = true;
        observer.disconnect();
      }
    });

    observer.observe(global.document?.body ?? global.document?.documentElement, {
      childList: true,
      subtree: true,
    });
  };

  global.WealthAppPersistence = {
    STORAGE_KEY,
    STORAGE_VERSION,
    FIELD_DEFINITIONS,
    createDefaultInputs,
    createDefaultState,
    sanitizePersistedState,
    loadState: () => storage.load(),
    saveState: (state) => storage.save(state),
    clearState: () => storage.clear(),
    bootstrap: bootstrapPersistence,
  };

  if (global.document?.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', bootstrapPersistence, { once: true });
  } else {
    bootstrapPersistence();
  }
})(window);
