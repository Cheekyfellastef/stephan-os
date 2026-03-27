// Launcher diagnostics control point.
// Guardrail: product UI (tile launcher) stays first-class; diagnostics are isolated and removable.

const DEFAULT_LAUNCHER_DIAGNOSTICS_ENABLED = false;

function normalizeToggle(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'on', 'yes', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'no', 'disabled'].includes(normalized)) return false;
  return null;
}

export function getLauncherDiagnosticsControl() {
  const queryParam = new URLSearchParams(globalThis.location?.search || '').get('launcherDiagnostics');
  const queryEnabled = normalizeToggle(queryParam);

  const persisted = globalThis.localStorage?.getItem('stephanos.launcherDiagnostics');
  const persistedEnabled = normalizeToggle(persisted);

  const metaContent = globalThis.document
    ?.querySelector('meta[name="stephanos-launcher-diagnostics"]')
    ?.getAttribute('content');
  const metaEnabled = normalizeToggle(metaContent);

  const enabled = queryEnabled ?? persistedEnabled ?? metaEnabled ?? DEFAULT_LAUNCHER_DIAGNOSTICS_ENABLED;

  return {
    enabled,
    source:
      queryEnabled !== null
        ? 'query'
        : persistedEnabled !== null
          ? 'localStorage'
          : metaEnabled !== null
            ? 'meta'
            : 'default',
  };
}
