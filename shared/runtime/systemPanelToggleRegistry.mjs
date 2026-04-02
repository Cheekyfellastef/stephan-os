const SYSTEM_PANEL_TOGGLE_DEFINITIONS = Object.freeze([
  { id: 'module-manager-panel', label: 'Modules', type: 'panel' },
  { id: 'module-installer-panel', label: 'Module Installer', type: 'panel' },
  { id: 'agent-console-panel', label: 'Agents Console', type: 'panel' },
  { id: 'command-console-panel', label: 'Debug Console', type: 'panel' },
  { id: 'task-monitor-panel', label: 'Task Monitor', type: 'panel' },
  { id: 'event-monitor-panel', label: 'Event Monitor', type: 'panel' },
  { id: 'service-inspector-panel', label: 'Service Inspector', type: 'panel' },
  { id: 'module-map-panel', label: 'Module Map', type: 'panel' },
  { id: 'knowledge-graph-panel', label: 'Knowledge Graph', type: 'panel' },
  { id: 'system-diagnostics-panel', label: 'System Diagnostics', type: 'panel' },
  { id: 'self-healing-panel', label: 'Auto-Repair', type: 'panel' },
  { id: 'app-installer-panel', label: 'App Installer', type: 'panel' },
  { id: 'dev-console', label: 'Developer Console', type: 'panel' },
  { id: 'stephanos-laws-panel', label: 'Laws Panel', type: 'panel' },
  { id: 'stephanos-build-panel', label: 'Build Panel', type: 'panel' },
  { id: 'runtime-diagnostics', label: 'Runtime Diagnostics', type: 'surface' },
  { id: 'launcher-fingerprint', label: 'Launcher Runtime Fingerprint', type: 'surface' },
  { id: 'truth-panel', label: 'Truth Panel', type: 'surface' },
  { id: 'build-parity-panel', label: 'Build Parity Signals', type: 'surface' },
  { id: 'reality-sync', label: 'Reality Sync / Auto Truth Refresh', type: 'surface' },
]);

const RESTORE_ENABLED_BY_DEFAULT = new Set();

export function getSystemPanelToggleDefinitions() {
  return SYSTEM_PANEL_TOGGLE_DEFINITIONS;
}

export function getSystemPanelRestorablePanelIds() {
  return SYSTEM_PANEL_TOGGLE_DEFINITIONS
    .filter((entry) => entry.type === 'panel')
    .map((entry) => entry.id);
}

export function isSystemPanelDefaultEnabled(panelId = '') {
  return RESTORE_ENABLED_BY_DEFAULT.has(String(panelId));
}
