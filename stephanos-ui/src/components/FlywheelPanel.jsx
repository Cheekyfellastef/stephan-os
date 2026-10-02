import { useEffect, useMemo, useState } from 'react';
import { useAIStore } from '../state/aiStore';
import CollapsiblePanel from './CollapsiblePanel';
import { requestStephanosBackend } from '../../../shared/runtime/backendClient.mjs';
import { deriveFlywheelTelemetryView } from '../../../shared/runtime/flywheelTelemetryModel.mjs';
import { deriveFlywheelWorkspaceView } from '../../../shared/runtime/upliftWorkspaceProjectionV1.mjs';
import FlywheelWorkspaceCanvas from './FlywheelWorkspaceCanvas';

const REFRESH_INTERVAL_MS = 15000;

function isHostedBrowserSurface() {
  if (typeof window === 'undefined' || !window.location) return false;
  const hostname = String(window.location.hostname || '').toLowerCase();
  return window.location.protocol === 'https:'
    && !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname);
}

export default function FlywheelPanel({ workspaceSurface = false } = {}) {
  const {
    uiLayout,
    togglePanel,
    bridgeTransportTruth,
    homeBridgeUrl,
    runtimeStatusModel,
  } = useAIStore();
  const [telemetry, setTelemetry] = useState({
    state: 'connecting',
    payload: null,
    error: '',
    refreshedAt: '',
    endpoint: '',
  });

  const runtimeContext = useMemo(() => {
    const hostedSurface = isHostedBrowserSurface();
    const hostedExecutionBridgeUrl = String(
      bridgeTransportTruth?.bridgeHostedExecutionBridgeUrl
      || bridgeTransportTruth?.bridgeHostedExecutionTarget
      || '',
    ).trim();
    const directBridgeUrl = String(
      bridgeTransportTruth?.bridgeOperatorTransportUrl
      || runtimeStatusModel?.runtimeContext?.homeNodeBridge?.backendUrl
      || homeBridgeUrl
      || '',
    ).trim();

    return {
      frontendOrigin: typeof window !== 'undefined' ? window.location?.origin || '' : '',
      baseUrl: hostedSurface && hostedExecutionBridgeUrl ? hostedExecutionBridgeUrl : '',
      hostedExecutionBridgeUrl,
      bridgeUrl: directBridgeUrl,
      homeNodeBridge: runtimeStatusModel?.runtimeContext?.homeNodeBridge || null,
    };
  }, [
    bridgeTransportTruth?.bridgeHostedExecutionBridgeUrl,
    bridgeTransportTruth?.bridgeHostedExecutionTarget,
    bridgeTransportTruth?.bridgeOperatorTransportUrl,
    homeBridgeUrl,
    runtimeStatusModel?.runtimeContext?.homeNodeBridge,
  ]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const refresh = async () => {
      try {
        const result = await requestStephanosBackend({
          path: '/api/shared-workspace/dashboard-feed?scope=full-history',
          runtimeContext,
          timeoutMs: 10000,
        });
        if (cancelled) return;
        const view = deriveFlywheelTelemetryView(result.json);
        setTelemetry({
          state: view.valid ? view.feedState : 'unreachable',
          payload: result.json,
          error: view.valid ? '' : view.reason,
          refreshedAt: new Date().toISOString(),
          endpoint: result.url || '',
        });
      } catch (error) {
        if (cancelled) return;
        setTelemetry((previous) => ({
          ...previous,
          state: 'unreachable',
          error: error?.message || 'Live Flywheel telemetry request failed.',
          refreshedAt: new Date().toISOString(),
          endpoint: error?.url || previous.endpoint || '',
        }));
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(refresh, REFRESH_INTERVAL_MS);
        }
      }
    };

    void refresh();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [runtimeContext]);

  const telemetryView = useMemo(
    () => deriveFlywheelTelemetryView(telemetry.payload || {}),
    [telemetry.payload],
  );
  const upliftView = useMemo(
    () => deriveFlywheelWorkspaceView(telemetry.payload || {}),
    [telemetry.payload],
  );

  const statusLabel = telemetry.state === 'connecting'
    ? 'CONNECTING'
    : telemetry.state === 'unreachable'
      ? 'BACKEND UNREACHABLE'
      : telemetryView.statusLabel;

  const connection = useMemo(() => ({
    state: telemetry.state,
    label: statusLabel,
    refreshedAt: telemetry.refreshedAt,
    endpoint: telemetry.endpoint,
    error: telemetry.error,
    bridgeMode: bridgeTransportTruth?.bridgeMode || 'canonical backend route',
  }), [
    bridgeTransportTruth?.bridgeMode,
    statusLabel,
    telemetry.endpoint,
    telemetry.error,
    telemetry.refreshedAt,
    telemetry.state,
  ]);

  const resolvedIsOpen = workspaceSurface ? true : uiLayout.flywheelPanel;
  const resolvedToggle = workspaceSurface ? () => {} : () => togglePanel('flywheelPanel');

  return (
    <CollapsiblePanel
      as="aside"
      panelId="flywheelPanel"
      title="Flywheel"
      description="Mission learning, agent uplift, capability gaps, proof and recursive improvement from the canonical Shared Workspace."
      className={`flywheel-panel${workspaceSurface ? ' flywheel-panel--workspace-surface' : ''}`}
      isOpen={resolvedIsOpen}
      onToggle={resolvedToggle}
      keepMountedWhenClosed={workspaceSurface}
    >
      {!workspaceSurface ? (
        <div className="flywheel-panel__intro" data-testid="flywheel-pane-dashboard">
          <div className="flywheel-live-strip">
            <strong
              className="flywheel-live-state"
              data-state={telemetry.state}
              data-testid="flywheel-live-state"
            >
              {statusLabel}
            </strong>
            <span>
              {telemetry.refreshedAt
                ? `Updated ${new Date(telemetry.refreshedAt).toLocaleTimeString()}`
                : 'Waiting for first telemetry sample'}
            </span>
            <span>{connection.bridgeMode}</span>
          </div>
          <p>
            The flagship workspace below stays visible even when a source is unavailable. Missing evidence is rendered as UNKNOWN rather than hidden.
          </p>
          {telemetry.error ? <p className="flywheel-live-error" role="status">{telemetry.error}</p> : null}
        </div>
      ) : null}

      <FlywheelWorkspaceCanvas
        view={upliftView}
        telemetryView={telemetryView}
        connection={connection}
      />

      {!workspaceSurface && telemetryView.valid ? (
        <details className="flywheel-engineering-details">
          <summary>Engineering telemetry detail</summary>
          <div className="flywheel-state-grid" aria-label="Flywheel live state">
            {telemetryView.stateItems.map((item) => (
              <article className="flywheel-state-card" key={item.id} data-testid={`flywheel-state-${item.id}`}>
                <div className="flywheel-card-header">
                  <h3>{item.label}</h3>
                  <span>{item.source}</span>
                </div>
                <strong>{item.value}</strong>
                <p>{item.summary}</p>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </CollapsiblePanel>
  );
}
