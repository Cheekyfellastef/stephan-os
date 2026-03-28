import {
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from '../../shared/runtime/stephanosSessionMemory.mjs';
import { getSystemPanelToggleDefinitions } from '../../shared/runtime/systemPanelToggleRegistry.mjs';

export const moduleDefinition = {
  id: 'system-panel',
  version: '1.1',
  description: 'Stephanos system control panel',
};

const TOGGLE_DEFINITIONS = getSystemPanelToggleDefinitions();


function readLayoutState(storage = globalThis.localStorage) {
  const memory = readPersistedStephanosSessionMemory(storage);
  return {
    ...(memory?.session?.ui?.uiLayout || {}),
  };
}

function writeLayoutState(partialLayout = {}, storage = globalThis.localStorage) {
  const current = readPersistedStephanosSessionMemory(storage);
  persistStephanosSessionMemory(
    {
      ...current,
      session: {
        ...current.session,
        ui: {
          ...current.session.ui,
          uiLayout: {
            ...(current.session.ui?.uiLayout || {}),
            ...partialLayout,
          },
        },
      },
    },
    storage,
  );
}

export function createSystemPanelStateController({
  setPanelState = globalThis.setPanelState,
  applySurfaceVisibility = globalThis.applyLauncherSurfaceVisibility,
  setRealitySyncEnabled = globalThis.setRealitySyncEnabled,
  storage = globalThis.localStorage,
} = {}) {
  const layout = readLayoutState(storage);

  function setToggleState(toggleId, enabled) {
    const normalizedEnabled = enabled === true;

    if (toggleId === 'runtime-diagnostics') {
      applySurfaceVisibility?.({ runtimeDiagnosticsVisible: normalizedEnabled });
      writeLayoutState({ runtimeDiagnosticsVisible: normalizedEnabled }, storage);
      return;
    }

    if (toggleId === 'launcher-fingerprint') {
      applySurfaceVisibility?.({ launcherRuntimeFingerprintVisible: normalizedEnabled });
      writeLayoutState({ launcherRuntimeFingerprintVisible: normalizedEnabled }, storage);
      return;
    }

    if (toggleId === 'truth-panel') {
      applySurfaceVisibility?.({ truthPanelVisible: normalizedEnabled });
      writeLayoutState({ truthPanelVisible: normalizedEnabled }, storage);
      return;
    }

    if (toggleId === 'build-parity-panel') {
      applySurfaceVisibility?.({ truthPanelVisible: normalizedEnabled });
      writeLayoutState({ buildParityPanelVisible: normalizedEnabled, truthPanelVisible: normalizedEnabled }, storage);
      return;
    }

    if (toggleId === 'reality-sync') {
      setRealitySyncEnabled?.(normalizedEnabled);
      writeLayoutState({ realitySyncEnabled: normalizedEnabled }, storage);
      return;
    }

    setPanelState?.(toggleId, normalizedEnabled);
    writeLayoutState({ [toggleId]: normalizedEnabled }, storage);
  }

  function getToggleState(toggleId) {
    if (toggleId === 'runtime-diagnostics') {
      return layout.runtimeDiagnosticsVisible === true;
    }

    if (toggleId === 'launcher-fingerprint') {
      return layout.launcherRuntimeFingerprintVisible === true;
    }

    if (toggleId === 'truth-panel') {
      return layout.truthPanelVisible === true;
    }

    if (toggleId === 'build-parity-panel') {
      return layout.buildParityPanelVisible === true || layout.truthPanelVisible === true;
    }

    if (toggleId === 'reality-sync') {
      return layout.realitySyncEnabled !== false;
    }

    return layout[toggleId] === true;
  }

  return {
    toggleDefinitions: TOGGLE_DEFINITIONS,
    getToggleState,
    setToggleState,
  };
}

function renderToggleRow(toggle, checked) {
  return `
    <label class="stephanos-system-toggle">
      <span>${toggle.label}</span>
      <input
        type="checkbox"
        data-toggle-id="${toggle.id}"
        ${checked ? 'checked' : ''}
      >
    </label>
  `;
}

export function installDraggablePanel(panel, handleSelector = '.stephanos-system-panel-header') {
  const handle = panel.querySelector(handleSelector);
  if (!handle) {
    return;
  }

  let dragState = null;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const applyPosition = (x, y) => {
    const panelBounds = panel.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - panelBounds.width - 8);
    const maxY = Math.max(8, window.innerHeight - panelBounds.height - 8);
    panel.style.left = `${clamp(x, 8, maxX)}px`;
    panel.style.top = `${clamp(y, 8, maxY)}px`;
    panel.style.transform = 'none';
  };

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    if (event.target?.closest?.('.stephanos-panel-knob')) {
      return;
    }
    const bounds = panel.getBoundingClientRect();
    applyPosition(bounds.left, bounds.top);
    const normalizedBounds = panel.getBoundingClientRect();
    dragState = {
      offsetX: event.clientX - normalizedBounds.left,
      offsetY: event.clientY - normalizedBounds.top,
    };
    panel.classList.add('stephanos-panel-dragging');
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  handle.addEventListener('pointermove', (event) => {
    if (!dragState) {
      return;
    }
    applyPosition(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
  });

  const clearDragState = () => {
    dragState = null;
    panel.classList.remove('stephanos-panel-dragging');
  };

  handle.addEventListener('pointerup', clearDragState);
  handle.addEventListener('pointercancel', clearDragState);
}

export function init() {
  let panel = document.getElementById('stephanos-system-panel');
  if (panel) {
    return;
  }

  const controller = createSystemPanelStateController();
  panel = document.createElement('div');
  panel.id = 'stephanos-system-panel';
  panel.className = 'stephanos-system-panel';
  panel.style.display = 'none';
  panel.dataset.collapsed = 'false';

  const moduleControls = controller.toggleDefinitions
    .filter((entry) => entry.type === 'panel')
    .map((toggle) => renderToggleRow(toggle, controller.getToggleState(toggle.id)))
    .join('');

  const surfaceControls = controller.toggleDefinitions
    .filter((entry) => entry.type === 'surface')
    .map((toggle) => renderToggleRow(toggle, controller.getToggleState(toggle.id)))
    .join('');

  panel.innerHTML = `
    <header class="stephanos-system-panel-header">
      <button class="stephanos-panel-knob system-panel-knob" type="button" aria-expanded="true" aria-label="Collapse system panel">◉</button>
      <div>
        <h3>Stephanos System</h3>
        <p class="system-panel-subtitle">Operational controls</p>
      </div>
    </header>
    <div class="stephanos-system-panel-content">
      <section>
        <h4>Module Panels</h4>
        ${moduleControls}
      </section>
      <section>
        <h4>Truth & Diagnostics Surfaces</h4>
        ${surfaceControls}
      </section>
      <section>
        <h4>Layout & Sync</h4>
        <button class="system-panel-action" data-system-action="reset-layout" type="button">Reset Panel Layout</button>
        <button class="system-panel-action" data-system-action="reality-check" type="button">Run Reality Sync Check</button>
        <button class="system-panel-action" data-system-action="restart-ignition" type="button">Restart Ignition To Sync</button>
        <p class="system-panel-sync-status" data-system-sync-status>Mirror status: loading…</p>
      </section>
      <hr>
      <button class="system-panel-close" type="button">Close Panel</button>
    </div>
  `;

  const content = panel.querySelector('.stephanos-system-panel-content');
  const knobButton = panel.querySelector('.system-panel-knob');
  const syncStatusNode = panel.querySelector('[data-system-sync-status]');
  const refreshMirrorStatus = () => {
    const mirrorStatus = window.getStephanosMirrorStatus?.();
    if (!syncStatusNode) {
      return;
    }
    if (!mirrorStatus) {
      syncStatusNode.textContent = 'Mirror status: unavailable';
      return;
    }
    const drift = mirrorStatus.localhostMirrorDrift ? 'drift detected' : 'in sync';
    const restart = mirrorStatus.ignitionRestartRequired ? 'restart required' : 'restart not required';
    syncStatusNode.textContent = `Mirror status: ${drift} · ${restart}`;
  };

  knobButton?.addEventListener('click', () => {
    const collapsed = panel.dataset.collapsed !== 'true';
    panel.dataset.collapsed = collapsed ? 'true' : 'false';
    content.style.display = collapsed ? 'none' : 'block';
    knobButton.textContent = collapsed ? '◎' : '◉';
    knobButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });

  panel.querySelector('.system-panel-close')?.addEventListener('click', () => {
    window.openSystemPanel?.();
  });

  panel.querySelectorAll('input[data-toggle-id]').forEach((input) => {
    input.addEventListener('change', () => {
      const toggleId = input.getAttribute('data-toggle-id');
      controller.setToggleState(toggleId, input.checked);
    });
  });
  panel.querySelectorAll('button[data-system-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.getAttribute('data-system-action');
      if (action === 'reset-layout') {
        window.resetStephanosPanelLayout?.();
      } else if (action === 'reality-check') {
        await window.runRealitySyncCheck?.();
      } else if (action === 'restart-ignition') {
        const result = await window.requestStephanosIgnitionRestart?.({ source: 'system-panel' });
        if (syncStatusNode) {
          syncStatusNode.textContent = `Mirror status: restart ${result?.ok ? 'requested' : 'not available'} (${result?.message || 'no details'})`;
        }
      }
      refreshMirrorStatus();
    });
  });

  document.body.appendChild(panel);
  installDraggablePanel(panel);

  window.openSystemPanel = function openSystemPanel() {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    if (panel.style.display !== 'none') {
      refreshMirrorStatus();
    }
  };
}

export function dispose() {
  const panel = document.getElementById('stephanos-system-panel');
  if (panel) {
    panel.remove();
  }
}
