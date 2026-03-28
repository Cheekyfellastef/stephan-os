(function () {
  const mountNode = document.getElementById('scenario-lab-root');
  if (!mountNode) {
    return;
  }

  const persistence = window.ScenarioPersistence;
  const appRoot = document.getElementById('root');
  document.body.classList.add('stephanos-scenario-body');
  appRoot?.classList.add('scenario-lab-app-root');

  if (appRoot?.parentNode && mountNode !== appRoot.previousElementSibling) {
    appRoot.parentNode.insertBefore(mountNode, appRoot);
  }

  const scenarios = [
    {
      id: 'base-case',
      title: 'Base Case',
      tag: 'Default',
      summary: 'Placeholder baseline using the cloned Wealth App assumptions with no extra shocks applied.',
      config: {
        'Portfolio return bias': '+0.0% adjustment',
        'Living cost pressure': 'Baseline placeholder',
        'Retirement timing': 'Current simulator values',
      },
    },
    {
      id: 'energy-shock',
      title: 'Energy Shock',
      tag: 'Placeholder',
      summary: 'Local-only scenario preset for future cost-of-living stress tests. No external macro feed is connected.',
      config: {
        'Portfolio return bias': '-1.0% placeholder',
        'Living cost pressure': '+12% placeholder',
        'Retirement timing': 'No automatic change yet',
      },
    },
    {
      id: 'early-retirement-push',
      title: 'Early Retirement Push',
      tag: 'Placeholder',
      summary: 'Sandbox preset to explore retiring sooner. Values are illustrative placeholders only for UI scaffolding.',
      config: {
        'Portfolio return bias': '-0.5% placeholder',
        'Living cost pressure': '+4% placeholder',
        'Retirement timing': 'Bring forward by 2 years',
      },
    },
    {
      id: 'cash-buffer-defense',
      title: 'Cash Buffer Defense',
      tag: 'Placeholder',
      summary: 'Extra local preset to reserve more cash before drawdown modelling is wired up in future iterations.',
      config: {
        'Portfolio return bias': '-0.2% placeholder',
        'Living cost pressure': '+2% placeholder',
        'Retirement timing': 'Hold current timing',
      },
    },
  ];

  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  const createDefaultState = persistence?.createDefaultState || (() => ({ version: 1, selectedScenario: 'base-case', scenarios: {}, ui: {} }));
  let persistedState = createDefaultState();
  let activeScenarioId = scenarioIds.has(persistedState.selectedScenario) ? persistedState.selectedScenario : 'base-case';
  let defaultInputs = null;
  let isApplyingSnapshot = false;
  let decorateFrame = null;
  let saveTimer = null;
  let statusTimer = null;
  let dataPortText = '';

  const setUiState = (uiPatch) => {
    persistedState.ui = {
      ...(persistedState.ui || {}),
      ...uiPatch,
    };
  };

  const decorateWealthApp = () => {
    if (!appRoot) {
      return;
    }

    const appShell = appRoot.firstElementChild;
    if (!appShell) {
      return;
    }

    appShell.classList.add('scenario-sim-app');

    const topLevelChildren = Array.from(appShell.children);
    topLevelChildren.forEach((child, index) => {
      if (child.tagName === 'H1') {
        child.classList.add('scenario-sim-app__title');
      }

      if (child.tagName === 'H2') {
        child.classList.add('scenario-sim-app__section-title');
      }

      if (child.tagName === 'H3') {
        child.classList.add('scenario-sim-app__status');
      }

      if (child.querySelector?.('input[type="number"]')) {
        child.classList.add('scenario-sim-app__asset-grid');
      }

      if (child.querySelector?.('input[type="range"]')) {
        child.classList.add('scenario-sim-app__slider');
        child.firstElementChild?.classList.add('scenario-sim-app__slider-label');
      }

      if (index === topLevelChildren.length - 1 && child.querySelector?.('.recharts-wrapper')) {
        child.classList.add('scenario-sim-app__chart-shell');
        child.firstElementChild?.classList.add('scenario-sim-app__chart-wrapper');
      }
    });

    appShell.querySelectorAll('input[type="number"]').forEach((input) => {
      input.classList.add('scenario-sim-app__number-input');
    });

    appShell.querySelectorAll('input[type="range"]').forEach((input) => {
      input.classList.add('scenario-sim-app__range-input');
    });
  };

  const scheduleDecorate = () => {
    if (decorateFrame) {
      cancelAnimationFrame(decorateFrame);
    }

    decorateFrame = requestAnimationFrame(() => {
      decorateWealthApp();
      decorateFrame = null;
    });
  };

  const getScenarioById = (scenarioId) => scenarios.find((scenario) => scenario.id === scenarioId) || scenarios[0];

  const getAppInputs = () => Array.from(appRoot?.querySelectorAll('input, select, textarea') || []);

  const normalizeLabel = (value) => value.replace(/\s+/g, ' ').trim();

  const getFieldKey = (input) => {
    const dataLabel = input.getAttribute('data-persist-key');
    if (dataLabel) {
      return dataLabel;
    }

    let label = '';
    if (input.type === 'number') {
      const siblingLabel = input.previousElementSibling;
      label = siblingLabel?.textContent || input.name || input.id || input.type;
    } else if (input.type === 'range') {
      const wrapper = input.closest('div');
      label = wrapper?.firstElementChild?.textContent || input.name || input.id || input.type;
      label = label.split(':')[0];
    } else {
      label = input.name || input.id || input.getAttribute('aria-label') || input.type || 'field';
    }

    const normalized = normalizeLabel(label);
    input.setAttribute('data-persist-key', normalized);
    return normalized;
  };

  const coerceInputValue = (input, value) => {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    if (input.type === 'number' || input.type === 'range') {
      const numericValue = Number(value);
      return Number.isFinite(numericValue) ? numericValue : null;
    }

    return String(value);
  };

  const captureCurrentInputs = () => {
    const snapshot = {};

    getAppInputs().forEach((input) => {
      const fieldKey = getFieldKey(input);
      const coercedValue = coerceInputValue(input, input.value);
      if (!fieldKey || coercedValue === null) {
        return;
      }

      snapshot[fieldKey] = coercedValue;
    });

    return snapshot;
  };

  const setReactInputValue = (input, nextValue) => {
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(input, String(nextValue));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const getScenarioSnapshot = (scenarioId) => persistedState.scenarios?.[scenarioId]?.inputs || {};

  const ensureDefaultInputs = () => {
    if (!defaultInputs) {
      const capturedDefaults = captureCurrentInputs();
      if (Object.keys(capturedDefaults).length > 0) {
        defaultInputs = capturedDefaults;
      }
    }

    return defaultInputs;
  };

  const applyScenarioInputs = (scenarioId) => {
    const defaults = ensureDefaultInputs();
    if (!defaults) {
      return;
    }

    const scenarioInputs = getScenarioSnapshot(scenarioId);
    const mergedInputs = { ...defaults, ...scenarioInputs };
    const appInputs = getAppInputs();
    if (!appInputs.length) {
      return;
    }

    isApplyingSnapshot = true;
    appInputs.forEach((input) => {
      const fieldKey = getFieldKey(input);
      if (!Object.prototype.hasOwnProperty.call(mergedInputs, fieldKey)) {
        return;
      }

      const nextValue = coerceInputValue(input, mergedInputs[fieldKey]);
      if (nextValue === null || String(input.value) === String(nextValue)) {
        return;
      }

      setReactInputValue(input, nextValue);
    });
    isApplyingSnapshot = false;
  };

  const flushState = () => {
    persistedState.selectedScenario = activeScenarioId;
    void persistence?.saveState?.(persistedState);
    persistence?.publishAiContextSnapshot?.(persistedState);
  };

  const setStatus = (message = '', tone = 'info') => {
    const statusNode = mountNode.querySelector('[data-scenario-status]');
    if (!statusNode) {
      return;
    }

    statusNode.hidden = !message;
    statusNode.textContent = message;
    statusNode.dataset.tone = tone;
  };

  const showTransientStatus = (message, tone = 'info') => {
    setStatus(message, tone);
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      statusTimer = null;
      setStatus('', tone);
    }, 6000);
  };

  const buildCurrentState = () => {
    saveCurrentScenarioInputs();

    return persistence?.sanitizePersistedState?.({
      version: persistence?.STORAGE_VERSION || 1,
      selectedScenario: activeScenarioId,
      scenarios: persistedState.scenarios,
      ui: persistedState.ui,
    }) || createDefaultState();
  };

  const saveStateDebounced = () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      flushState();
      saveTimer = null;
    }, 180);
  };

  const saveCurrentScenarioInputs = () => {
    const snapshot = captureCurrentInputs();
    if (!Object.keys(snapshot).length) {
      return;
    }

    persistedState.scenarios = persistedState.scenarios || {};
    persistedState.scenarios[activeScenarioId] = { inputs: snapshot };
    saveStateDebounced();
  };

  const waitForAppInputs = (callback, attempts = 0) => {
    if (getAppInputs().length) {
      callback();
      return;
    }

    if (attempts > 120) {
      return;
    }

    window.requestAnimationFrame(() => waitForAppInputs(callback, attempts + 1));
  };

  const handleExport = () => {
    const payload = persistence?.createExportPayload?.(buildCurrentState()) || buildCurrentState();
    dataPortText = `${JSON.stringify(payload, null, 2)}\n`;
    const textarea = mountNode.querySelector('[data-port-text]');
    if (textarea) {
      textarea.value = dataPortText;
    }

    showTransientStatus('Data Port JSON generated below.', 'success');
  };

  const downloadExportJson = () => {
    const textarea = mountNode.querySelector('[data-port-text]');
    const jsonText = textarea?.value?.trim() || dataPortText.trim();
    if (!jsonText) {
      showTransientStatus('Download failed: generate or paste JSON first.', 'error');
      return;
    }

    try {
      const blob = new Blob([`${jsonText}\n`], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `wealth-simulation-scenarios-data-port-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showTransientStatus('JSON download started.', 'success');
    } catch (error) {
      showTransientStatus('Download failed: unable to create JSON file.', 'error');
    }
  };

  const copyExportJson = async () => {
    const textarea = mountNode.querySelector('[data-port-text]');
    const jsonText = textarea?.value?.trim() || dataPortText.trim();
    if (!jsonText) {
      showTransientStatus('Copy failed: generate or paste JSON first.', 'error');
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(jsonText);
      } else if (textarea) {
        textarea.focus();
        textarea.select();
        const didCopy = document.execCommand?.('copy');
        if (!didCopy) {
          throw new Error('Clipboard unavailable');
        }
      } else {
        throw new Error('Clipboard unavailable');
      }

      showTransientStatus('JSON copied to clipboard.', 'success');
    } catch (error) {
      showTransientStatus('Copy failed: clipboard access is unavailable.', 'error');
    }
  };

  const importFromTextarea = () => {
    const textarea = mountNode.querySelector('[data-port-text]');
    const text = textarea?.value || '';
    dataPortText = text;
    const importResult = persistence?.parseImportedText?.(text);
    if (!importResult?.ok) {
      showTransientStatus(importResult?.message || 'Import failed.', 'error');
      return;
    }

    applyImportedState(importResult.state);
    showTransientStatus('Scenario settings imported successfully.', 'success');
  };

  const applyImportedState = (state) => {
    persistedState = persistence?.sanitizePersistedState?.(state) || createDefaultState();
    activeScenarioId = scenarioIds.has(persistedState.selectedScenario) ? persistedState.selectedScenario : 'base-case';

    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }

    flushState();
    render();
    waitForAppInputs(() => {
      applyScenarioInputs(activeScenarioId);
      saveCurrentScenarioInputs();
      flushState();
    });
  };

  const handleImportSelection = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await persistence?.readFileAsText?.(file);
      const importResult = persistence?.parseImportedText?.(text);

      if (!importResult?.ok) {
        showTransientStatus(importResult?.message || 'Import failed.', 'error');
        return;
      }

      applyImportedState(importResult.state);
      showTransientStatus('Scenario settings imported successfully.', 'success');
    } catch (error) {
      showTransientStatus('Import failed: the selected file could not be read.', 'error');
    } finally {
      if (event?.target) {
        event.target.value = '';
      }
    }
  };

  const resetToDefaults = () => {
    const defaults = ensureDefaultInputs();
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }

    persistedState = createDefaultState();
    activeScenarioId = 'base-case';
    if (defaults) {
      isApplyingSnapshot = true;
      getAppInputs().forEach((input) => {
        const fieldKey = getFieldKey(input);
        if (!Object.prototype.hasOwnProperty.call(defaults, fieldKey)) {
          return;
        }

        setReactInputValue(input, defaults[fieldKey]);
      });
      isApplyingSnapshot = false;
    }

    void persistence?.clearState?.();
    setStatus('', 'info');
    render();
  };

  const getUiActiveTab = () => persistedState.ui?.activeTab === 'config' ? 'config' : 'presets';

  const setUiActiveTab = (tab) => {
    setUiState({ activeTab: tab === 'config' ? 'config' : 'presets' });
    flushState();
    render();
  };

  const render = () => {
    const activeScenario = getScenarioById(activeScenarioId);
    const activeTab = getUiActiveTab();
    mountNode.innerHTML = `
      <div class="scenario-lab-shell">
        <section class="scenario-lab-badge" aria-label="Experimental wealth simulation sandbox banner">
          <div class="scenario-lab-badge__eyebrow">Experimental sandbox</div>
          <h1 class="scenario-lab-badge__title">Wealth Simulation Scenarios</h1>
          <p class="scenario-lab-badge__text">
            This app is a separate scenario lab cloned from the stable Wealth App. Presets and config below are local/static placeholders for future modelling only.
          </p>
        </section>
        <aside class="scenario-lab-panel" aria-label="Scenario presets and local configuration scaffold">
          <div class="scenario-lab-panel__eyebrow">Scenario lab</div>
          <div class="scenario-lab-panel__title-row">
            <h2 class="scenario-lab-panel__title">Scenario Presets</h2>
            <button type="button" class="scenario-lab-panel__reset" data-reset-scenarios>
              Reset to Defaults
            </button>
          </div>
          <p class="scenario-lab-panel__description">
            Select a preset to annotate the simulation with sandbox assumptions. Each scenario now remembers its own local input state in this browser only.
          </p>
          <section class="scenario-lab-panel__data-port" aria-label="Data Port">
            <h3 class="scenario-lab-panel__data-port-title">Data Port</h3>
            <div class="scenario-lab-panel__actions" aria-label="Scenario settings actions">
              <button type="button" class="scenario-lab-panel__action-button" data-export-settings>Export JSON</button>
              <button type="button" class="scenario-lab-panel__action-button" data-copy-settings>Copy JSON</button>
              <button type="button" class="scenario-lab-panel__action-button" data-import-settings>Import JSON</button>
              <button type="button" class="scenario-lab-panel__action-button" data-download-settings>Download JSON</button>
              <button type="button" class="scenario-lab-panel__action-button" data-import-file-open>Upload JSON</button>
              <input type="file" accept="application/json,.json" hidden data-import-file />
            </div>
            <div class="scenario-lab-panel__port">
              <label for="scenario-data-port-input" class="scenario-lab-panel__port-label">JSON</label>
              <textarea
                id="scenario-data-port-input"
                class="scenario-lab-panel__port-textarea"
                data-port-text
                spellcheck="false"
                autocapitalize="off"
                autocomplete="off"
                aria-label="Scenario Data Port JSON"
                placeholder='{"app":"wealth-simulation-scenarios","version":1,"exportedAt":"...","state":{...},"ui":{...}}'
              ></textarea>
            </div>
            <p class="scenario-lab-panel__status" data-scenario-status role="status" aria-live="polite" hidden></p>
          </section>
          <div class="scenario-lab-panel__tabs" role="tablist" aria-label="Scenario panel sections">
            <button type="button" class="scenario-lab-panel__tab${activeTab === 'presets' ? ' is-active' : ''}" data-panel-tab="presets" role="tab" aria-selected="${activeTab === 'presets'}">Presets</button>
            <button type="button" class="scenario-lab-panel__tab${activeTab === 'config' ? ' is-active' : ''}" data-panel-tab="config" role="tab" aria-selected="${activeTab === 'config'}">Config</button>
          </div>
          <div class="scenario-lab-panel__content${activeTab === 'presets' ? ' is-active' : ''}" data-panel-content="presets">
            <div class="scenario-lab-panel__grid">
            ${scenarios
              .map(
                (scenario) => `
                  <button
                    type="button"
                    class="scenario-card${scenario.id === activeScenario.id ? ' is-active' : ''}"
                    data-scenario-id="${scenario.id}"
                  >
                    <div class="scenario-card__eyebrow">Scenario preset</div>
                    <div class="scenario-card__title-row">
                      <h3 class="scenario-card__title">${scenario.title}</h3>
                      <span class="scenario-card__pill">${scenario.tag}</span>
                    </div>
                    <p class="scenario-card__summary">${scenario.summary}</p>
                  </button>
                `
              )
              .join('')}
            </div>
          </div>
          <section class="scenario-config${activeTab === 'config' ? ' is-active' : ''}" data-panel-content="config" aria-label="Selected scenario configuration scaffold">
            <div class="scenario-lab-panel__eyebrow">Scenario config</div>
            <h3 class="scenario-config__title">${activeScenario.title}</h3>
            <div class="scenario-config__list">
              ${Object.entries(activeScenario.config)
                .map(
                  ([label, value]) => `
                    <div class="scenario-config__row">
                      <div class="scenario-config__label">${label}</div>
                      <div class="scenario-config__value">${value}</div>
                    </div>
                  `
                )
                .join('')}
            </div>
            <p class="scenario-config__hint" style="margin-top: 12px;">
              Durable simulator data now uses shared backend tile-state storage (<code>/api/tile-state/${persistence?.APP_ID || 'wealth-simulation-scenarios'}</code>) while UI tab state stays local.
            </p>
          </section>
          <div class="scenario-lab-toast">
            Active preset: <strong>${activeScenario.title}</strong>. Future shared helper extraction can happen later once the sandbox proves stable.
          </div>
        </aside>
      </div>
    `;

    mountNode.querySelectorAll('[data-scenario-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextScenarioId = button.getAttribute('data-scenario-id') || 'base-case';
        if (nextScenarioId === activeScenarioId) {
          return;
        }

        saveCurrentScenarioInputs();
        activeScenarioId = scenarioIds.has(nextScenarioId) ? nextScenarioId : 'base-case';
        render();
        waitForAppInputs(() => {
          applyScenarioInputs(activeScenarioId);
          saveStateDebounced();
        });
      });
    });

    mountNode.querySelector('[data-reset-scenarios]')?.addEventListener('click', () => {
      resetToDefaults();
    });

    mountNode.querySelector('[data-export-settings]')?.addEventListener('click', () => {
      handleExport();
    });

    mountNode.querySelector('[data-copy-settings]')?.addEventListener('click', () => {
      copyExportJson();
    });

    mountNode.querySelector('[data-import-settings]')?.addEventListener('click', () => {
      importFromTextarea();
    });
    mountNode.querySelector('[data-download-settings]')?.addEventListener('click', () => {
      downloadExportJson();
    });

    const importFileInput = mountNode.querySelector('[data-import-file]');
    const dataPortTextarea = mountNode.querySelector('[data-port-text]');
    if (dataPortTextarea) {
      dataPortTextarea.value = dataPortText;
    }

    mountNode.querySelector('[data-import-file-open]')?.addEventListener('click', () => {
      importFileInput?.click?.();
    });
    importFileInput?.addEventListener('change', handleImportSelection);

    mountNode.querySelectorAll('[data-panel-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextTab = button.getAttribute('data-panel-tab') || 'presets';
        if (nextTab === getUiActiveTab()) {
          return;
        }

        setUiActiveTab(nextTab);
      });
    });

    scheduleDecorate();
  };

  const observer = appRoot
    ? new MutationObserver(() => {
        scheduleDecorate();
      })
    : null;

  if (observer && appRoot) {
    observer.observe(appRoot, { childList: true, subtree: true });
  }

  appRoot?.addEventListener('input', (event) => {
    if (isApplyingSnapshot) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return;
    }

    saveCurrentScenarioInputs();
  });

  window.addEventListener('beforeunload', () => {
    if (!isApplyingSnapshot) {
      saveCurrentScenarioInputs();
      if (saveTimer) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
      flushState();
    }
  });

  render();
  void persistence?.loadState?.().then((loadedState) => {
    persistedState = persistence?.sanitizePersistedState?.(loadedState) || createDefaultState();
    activeScenarioId = scenarioIds.has(persistedState.selectedScenario) ? persistedState.selectedScenario : 'base-case';
    console.info('[ScenarioPersistence] Loaded tile data state', {
      appId: persistence?.APP_ID || 'wealth-simulation-scenarios',
      durableStorage: 'shared-tile-state-contract',
      localUiStorageKey: 'stephanos.wealth.scenarios.ui.local.v1',
    });
    render();
  });
  waitForAppInputs(() => {
    ensureDefaultInputs();
    applyScenarioInputs(activeScenarioId);
    saveCurrentScenarioInputs();
  });
  scheduleDecorate();
})();
