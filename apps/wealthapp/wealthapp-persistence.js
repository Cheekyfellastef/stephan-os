(function (global) {
  const APP_ID = 'wealthapp';
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

  const createDefaultUi = () => ({});

  const createDefaultState = () => ({
    version: STORAGE_VERSION,
    inputs: {},
    ui: createDefaultUi(),
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

  const sanitizeUiState = (value) => (isRecord(value) ? value : createDefaultUi());

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
      ui: sanitizeUiState(value.ui),
    };
  };

  const createExportPayload = (state) => {
    const sourceState = isRecord(state) ? state : {};

    return {
      app: APP_ID,
      version: STORAGE_VERSION,
      exportedAt: new Date().toISOString(),
      inputs: sanitizeInputMap(sourceState.inputs),
      ui: sanitizeUiState(sourceState.ui),
    };
  };

  const validateImportPayload = (value) => {
    if (!isRecord(value)) {
      return {
        ok: false,
        code: 'invalid-json',
        message: 'Import failed: the selected file is not a valid Wealthapp settings export.',
      };
    }

    if (value.app !== APP_ID) {
      return {
        ok: false,
        code: 'unsupported-schema',
        message: 'Import failed: this file is not a Wealthapp settings export.',
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
        message: 'Import failed: this settings file was created by a newer Wealthapp version.',
      };
    }

    const state = sanitizePersistedState(value);

    return {
      ok: true,
      state,
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

  const createStateFromDom = (controls) => ({
    version: STORAGE_VERSION,
    inputs: readInputsFromDom(controls),
    ui: createDefaultUi(),
  });

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

  const ensureToolbar = (root) => {
    if (!root || typeof root.querySelector !== 'function') {
      return null;
    }

    const title = root.querySelector('.stephanos-wealthapp__title, h1');
    if (!title) {
      return null;
    }

    let toolbar = root.querySelector('[data-wealthapp-actions]');
    if (!toolbar) {
      toolbar = global.document?.createElement?.('div');
      if (!toolbar) {
        return null;
      }

      toolbar.className = 'stephanos-wealthapp__actions';
      toolbar.dataset.wealthappActions = 'true';
      title.insertAdjacentElement('afterend', toolbar);
    }

    let buttonRow = toolbar.querySelector('[data-wealthapp-action-row]');
    if (!buttonRow) {
      buttonRow = global.document?.createElement?.('div');
      if (!buttonRow) {
        return null;
      }

      buttonRow.className = 'stephanos-wealthapp__action-row';
      buttonRow.dataset.wealthappActionRow = 'true';
      toolbar.appendChild(buttonRow);
    }

    let status = toolbar.querySelector('[data-wealthapp-status]');
    if (!status) {
      status = global.document?.createElement?.('p');
      if (!status) {
        return null;
      }

      status.className = 'stephanos-wealthapp__import-status';
      status.dataset.wealthappStatus = 'true';
      status.hidden = true;
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      toolbar.appendChild(status);
    }

    let fileInput = toolbar.querySelector('[data-wealthapp-import-input]');
    if (!fileInput) {
      fileInput = global.document?.createElement?.('input');
      if (!fileInput) {
        return null;
      }

      fileInput.type = 'file';
      fileInput.accept = 'application/json,.json';
      fileInput.hidden = true;
      fileInput.dataset.wealthappImportInput = 'true';
      toolbar.appendChild(fileInput);
    }

    return { toolbar, buttonRow, status, fileInput };
  };

  const ensureActionButton = (buttonRow, { dataKey, text, className, onClick }) => {
    if (!buttonRow) {
      return null;
    }

    let button = buttonRow.querySelector(`[data-wealthapp-action="${dataKey}"]`);
    if (button) {
      return button;
    }

    button = global.document?.createElement?.('button');
    if (!button) {
      return null;
    }

    button.type = 'button';
    button.className = className;
    button.dataset.wealthappAction = dataKey;
    button.textContent = text;
    button.addEventListener('click', onClick);
    buttonRow.appendChild(button);
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

    const toolbarRefs = ensureToolbar(root);
    if (!toolbarRefs) {
      return false;
    }

    let statusTimer = null;
    let writeTimer = null;
    let suppressSave = false;

    const setStatus = (message, tone = 'info') => {
      const { status } = toolbarRefs;
      if (!status) {
        return;
      }

      status.hidden = !message;
      status.textContent = message || '';
      status.dataset.tone = tone;
    };

    const flushSave = () => {
      if (suppressSave) {
        return;
      }

      storage.save(createStateFromDom(controls));
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

    const showTransientStatus = (message, tone) => {
      setStatus(message, tone);
      global.clearTimeout?.(statusTimer);
      statusTimer = global.setTimeout?.(() => {
        statusTimer = null;
        setStatus('', tone);
      }, 6000);
    };

    const handleReset = () => {
      suppressSave = true;
      global.clearTimeout?.(writeTimer);
      writeTimer = null;
      applyInputsToDom(controls, createDefaultInputs());
      storage.clear();
      suppressSave = false;
      setStatus('', 'info');
    };

    const handleExport = () => {
      const payload = createExportPayload(createStateFromDom(controls));
      const didDownload = downloadTextFile('wealthapp-settings.json', `${JSON.stringify(payload, null, 2)}\n`);

      if (didDownload) {
        showTransientStatus('Settings exported to JSON.', 'success');
      } else {
        showTransientStatus('Export failed: this browser could not start the download.', 'error');
      }
    };

    const importState = (importResult) => {
      if (!importResult?.ok) {
        showTransientStatus(importResult?.message || 'Import failed.', 'error');
        return false;
      }

      global.clearTimeout?.(writeTimer);
      writeTimer = null;
      applyState(importResult.state);
      flushSave();
      showTransientStatus('Settings imported successfully.', 'success');
      return true;
    };

    const handleImportSelection = async (event) => {
      const file = event?.target?.files?.[0];
      if (!file) {
        return;
      }

      try {
        const text = await readFileAsText(file);
        importState(parseImportedText(text));
      } catch (error) {
        showTransientStatus('Import failed: the selected file could not be read.', 'error');
      } finally {
        if (event?.target) {
          event.target.value = '';
        }
      }
    };

    controls.forEach((input) => {
      input.addEventListener('input', scheduleSave);
      input.addEventListener('change', scheduleSave);
    });

    global.addEventListener?.('pagehide', flushSave);
    global.addEventListener?.('beforeunload', flushSave);

    ensureActionButton(toolbarRefs.buttonRow, {
      dataKey: 'export',
      text: 'Export Settings',
      className: 'stephanos-wealthapp__action-button',
      onClick: handleExport,
    });

    ensureActionButton(toolbarRefs.buttonRow, {
      dataKey: 'import',
      text: 'Import Settings',
      className: 'stephanos-wealthapp__action-button',
      onClick: () => toolbarRefs.fileInput?.click?.(),
    });

    ensureActionButton(toolbarRefs.buttonRow, {
      dataKey: 'reset',
      text: 'Reset to Defaults',
      className: 'stephanos-wealthapp__reset-button',
      onClick: handleReset,
    });

    toolbarRefs.fileInput.addEventListener('change', handleImportSelection);

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
    APP_ID,
    STORAGE_KEY,
    STORAGE_VERSION,
    FIELD_DEFINITIONS,
    createDefaultInputs,
    createDefaultState,
    createExportPayload,
    validateImportPayload,
    parseImportedText,
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
