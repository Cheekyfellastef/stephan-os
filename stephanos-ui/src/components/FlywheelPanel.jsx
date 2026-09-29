import { useEffect, useMemo, useState } from 'react';
import { useAIStore } from '../state/aiStore';
import CollapsiblePanel from './CollapsiblePanel';
import { requestStephanosBackend } from '../../../shared/runtime/backendClient.mjs';
import { deriveFlywheelTelemetryView } from '../../../shared/runtime/flywheelTelemetryModel.mjs';

const REFRESH_INTERVAL_MS = 15000;

function isHostedBrowserSurface() {
  if (typeof window === 'undefined' || !window.location) return false;
  const hostname = String(window.location.hostname || '').toLowerCase();
  return window.location.protocol === 'https:'
    && !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname);
}

export default function FlywheelPanel() {
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
          path: '/api/shared-workspace/dashboard-feed',
          runtimeContext,
          timeoutMs: 10000,
        });
        if (cancelled) return;
        const view = deriveFlywheelTelemetryView(result.json);
        if (!view.valid) {
          setTelemetry({
            state: 'unreachable',
            payload: result.json,
            error: view.reason,
            refreshedAt: new Date().toISOString(),
            endpoint: result.url || '',
          });
        } else {
          setTelemetry({
            state: view.feedState,
            payload: result.json,
            error: '',
            refreshedAt: new Date().toISOString(),
            endpoint: result.url || '',
          });
        }
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

  const view = useMemo(
    () => deriveFlywheelTelemetryView(telemetry.payload || {}),
    [telemetry.payload],
  );

  const statusLabel = telemetry.state === 'connecting'
    ? 'CONNECTING'
    : telemetry.state === 'unreachable'
      ? 'BACKEND UNREACHABLE'
      : view.statusLabel;
  const stateItems = view.valid ? view.stateItems : [];
  const metrics = view.valid ? view.metrics : [];

  return (
    <CollapsiblePanel
      as="aside"
      panelId="flywheelPanel"
      title="Flywheel"
      description="Live mission flywheel telemetry from the canonical Shared Agent Workspace feed."
      className="flywheel-panel"
      isOpen={uiLayout.flywheelPanel}
      onToggle={() => togglePanel('flywheelPanel')}
    >
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
          <span>{bridgeTransportTruth?.bridgeMode || 'canonical backend route'}</span>
        </div>
        <p>
          This pane now reads the same bounded backend projection used by mission control instead of source-controlled placeholder values.
        </p>
        {telemetry.error ? (
          <p className="flywheel-live-error" role="status">
            {telemetry.error}
          </p>
        ) : (
          <p className="muted">
            {view.valid ? view.reason : 'Connecting to the shared workspace telemetry feed.'}
          </p>
        )}
      </div>

      {view.valid ? (
        <>
          <div className="flywheel-state-grid" aria-label="Flywheel live state">
            {stateItems.map((item) => (
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

          <div className="flywheel-metrics-grid" aria-label="Flywheel live metrics">
            {metrics.map((metric) => (
              <article className="flywheel-metric-card" key={metric.label}>
                <span className="flywheel-metric-label">{metric.label}</span>
                <strong>{metric.value}</strong>
                <p>{metric.detail}</p>
              </article>
            ))}
          </div>

          <div className="flywheel-next-action" data-testid="flywheel-next-action">
            <span className="flywheel-metric-label">Published next action</span>
            <strong>{view.exactNextAction}</strong>
          </div>
        </>
      ) : (
        <div className="flywheel-unavailable" data-testid="flywheel-backend-unreachable">
          <strong>No live Flywheel data is being claimed.</strong>
          <p>
            The tile will retry automatically. On a hosted phone surface it requires the persisted HTTPS Home Bridge/Tailscale execution endpoint.
          </p>
        </div>
      )}
    </CollapsiblePanel>
  );
}
