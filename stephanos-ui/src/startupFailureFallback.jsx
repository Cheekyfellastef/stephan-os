import React from 'react';
import { createStephanosLocalUrls } from '../../shared/runtime/stephanosLocalUrls.mjs';
import { getStartupDiagnosticsSnapshot } from '../../shared/runtime/startupLaunchDiagnostics.mjs';

export function resolveStageLabel(stage = '') {
  const normalized = String(stage || '').trim().toLowerCase();
  if (!normalized) {
    return 'unknown';
  }
  return normalized;
}

export function buildStartupFailureSummary(error, stage = 'unknown') {
  const diagnostics = getStartupDiagnosticsSnapshot();
  const directDistUrl = createStephanosLocalUrls().runtimeIndexUrl;
  const launchTrigger = diagnostics.launchTriggers?.[0] || null;
  const stack = String(error?.stack || error?.message || 'No stack trace available.')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);

  return [
    `stage=${resolveStageLabel(stage)}`,
    `message=${String(error?.message || 'unknown startup error')}`,
    `target=${String(launchTrigger?.resolvedTarget || globalThis?.window?.location?.href || '')}`,
    `rootLandingLoaded=${launchTrigger?.rootLandingLoaded === true ? 'yes' : 'no'}`,
    `userInteracted=${launchTrigger?.userInteracted === true ? 'yes' : 'no'}`,
    `directDistUrl=${directDistUrl}`,
    `trace=${stack.join(' | ')}`,
  ].join('\n');
}

export function StartupFailureFallback({ stage = 'unknown', error = null }) {
  const directDistUrl = createStephanosLocalUrls().runtimeIndexUrl;
  const summary = buildStartupFailureSummary(error, stage);
  return (
    <section style={{ margin: '12px auto', width: 'min(1180px, calc(100% - 24px))', padding: '16px', border: '1px solid #7f1d1d', background: '#111827', color: '#f9fafb', borderRadius: '10px' }}>
      <h2 style={{ marginTop: 0 }}>Stephanos failed during startup render</h2>
      <p><strong>Failing stage:</strong> {resolveStageLabel(stage)}</p>
      <p><strong>Operator action:</strong> capture the diagnostic summary, then open the direct dist URL to compare launcher vs direct startup path.</p>
      <p><a href={directDistUrl} style={{ color: '#93c5fd' }}>Open direct Stephanos dist runtime</a></p>
      <label htmlFor="startup-failure-summary"><strong>Diagnostic summary (copy/paste):</strong></label>
      <textarea id="startup-failure-summary" readOnly value={summary} style={{ width: '100%', minHeight: '180px', marginTop: '8px', background: '#030712', color: '#e5e7eb' }} />
    </section>
  );
}
