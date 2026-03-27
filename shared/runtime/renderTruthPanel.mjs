function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatBoolean(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}

function renderSignalList(items = []) {
  return `<ul class="truth-panel-signal-list">${items
    .map(({ label, value }) => `<li><span>${escapeHtml(label)}</span><b>${escapeHtml(String(value))}</b></li>`)
    .join('')}</ul>`;
}

export function renderTruthPanel(snapshot, documentRef = globalThis.document, options = {}) {
  const mountId = options.mountId || 'launcher-truth-panel-mount';
  const mount = documentRef?.getElementById?.(mountId);
  if (!mount) {
    return false;
  }

  const visible = options.visible === true;
  mount.style.display = visible ? 'block' : 'none';

  if (!visible) {
    mount.innerHTML = '';
    return true;
  }

  const contradictions = Array.isArray(snapshot?.contradictions) ? snapshot.contradictions : [];
  const status = String(snapshot?.status || 'unknown').toLowerCase();

  const launcherSignals = renderSignalList([
    { label: 'mode', value: snapshot?.launcher?.mode || 'unknown' },
    { label: 'shell', value: snapshot?.launcher?.shellStatus || 'unknown' },
    { label: 'tiles (registry/dom)', value: `${snapshot?.launcher?.tileRegistryCount ?? 0}/${snapshot?.launcher?.tileDomCount ?? 0}` },
    { label: 'launcher-critical failures', value: snapshot?.launcher?.launcherCriticalModuleFailureCount ?? 0 },
    { label: 'build proof present', value: formatBoolean(snapshot?.launcher?.buildProofPresent) },
  ]);

  const sourceTruthSignals = renderSignalList([
    { label: 'build marker', value: snapshot?.sourceBuildServed?.buildMarker || 'missing' },
    { label: 'build timestamp', value: snapshot?.sourceBuildServed?.buildTimestamp || 'unknown' },
    { label: 'served source truth', value: formatBoolean(snapshot?.sourceBuildServed?.servedSourceTruthAvailable) },
    { label: 'served dist truth', value: formatBoolean(snapshot?.sourceBuildServed?.servedDistTruthAvailable) },
    { label: 'source/dist parity', value: snapshot?.sourceBuildServed?.sourceDistParityOk == null ? 'unknown' : formatBoolean(snapshot?.sourceBuildServed?.sourceDistParityOk) },
  ]);

  const runtimeSignals = renderSignalList([
    { label: 'runtime diagnostics visible', value: formatBoolean(snapshot?.runtime?.runtimeDiagnosticsEnabled) },
    { label: 'runtime fingerprint visible', value: formatBoolean(snapshot?.runtime?.launcherRuntimeFingerprintVisible) },
    { label: 'truth panel visible', value: formatBoolean(snapshot?.runtime?.truthPanelVisible) },
    { label: 'backend reachable', value: snapshot?.runtime?.backendReachable == null ? 'unknown' : formatBoolean(snapshot?.runtime?.backendReachable) },
    { label: 'final route / kind', value: `${snapshot?.runtime?.finalRoute || 'unknown'} / ${snapshot?.runtime?.routeKind || 'unknown'}` },
    { label: 'localhost mirror drift', value: formatBoolean(snapshot?.runtime?.localhostMirrorDrift) },
    { label: 'ignition restart required', value: formatBoolean(snapshot?.runtime?.ignitionRestartRequired) },
    { label: 'ignition restart supported', value: formatBoolean(snapshot?.runtime?.ignitionRestartSupported) },
  ]);

  const realitySyncSignals = renderSignalList([
    { label: 'reality sync enabled', value: formatBoolean(snapshot?.realitySync?.enabled) },
    { label: 'displayed marker', value: snapshot?.realitySync?.displayedMarker || 'missing' },
    { label: 'latest marker', value: snapshot?.realitySync?.latestMarker || 'missing' },
    { label: 'displayed timestamp', value: snapshot?.realitySync?.displayedTimestamp || 'unknown' },
    { label: 'latest timestamp', value: snapshot?.realitySync?.latestTimestamp || 'unknown' },
    { label: 'latest source', value: snapshot?.realitySync?.latestSource || 'unknown' },
    { label: 'stale display detected', value: formatBoolean(snapshot?.realitySync?.isStale) },
    { label: 'auto-refresh pending', value: formatBoolean(snapshot?.realitySync?.refreshPending) },
    { label: 'last refresh reason', value: snapshot?.realitySync?.lastRefreshReason || 'none' },
    { label: 'last refresh at', value: snapshot?.realitySync?.lastRefreshAt || 'never' },
    { label: 'last restart request', value: snapshot?.realitySync?.lastRestartRequestAt || 'never' },
    { label: 'last restart result', value: snapshot?.realitySync?.lastRestartResult || 'none' },
  ]);

  mount.innerHTML = `
    <section class="runtime-diagnostics-card secondary truth-panel truth-status-${escapeHtml(status)}" aria-label="Stephanos truth panel">
      <header class="truth-panel-header">
        <h3>Truth Panel</h3>
        <span class="truth-panel-pill">status: ${escapeHtml(status)}</span>
      </header>
      <p class="truth-panel-intro">Operational self-audit: launcher, runtime, and source/build/served truth in one view.</p>
      <div class="truth-panel-grid">
        <details open>
          <summary>Launcher truth</summary>
          ${launcherSignals}
        </details>
        <details>
          <summary>Source / build / served truth</summary>
          ${sourceTruthSignals}
        </details>
        <details>
          <summary>Runtime truth</summary>
          ${runtimeSignals}
        </details>
        <details>
          <summary>Reality Sync</summary>
          ${realitySyncSignals}
        </details>
      </div>
      <details class="truth-contradictions" ${contradictions.length > 0 ? 'open' : ''}>
        <summary>Contradictions (${contradictions.length})</summary>
        ${contradictions.length === 0
          ? '<p>No active contradictions detected.</p>'
          : `<ul>${contradictions
            .map((entry) => `<li><b>${escapeHtml(entry.severity || 'unknown')}</b> · ${escapeHtml(entry.message || '')} <code>${escapeHtml(entry.relatedLawId || '')}</code></li>`)
            .join('')}</ul>`}
      </details>
    </section>
  `;

  return true;
}
