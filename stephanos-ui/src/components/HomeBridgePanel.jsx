import { useEffect, useMemo, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import { checkApiHealth } from '../ai/aiClient';
import { useAIStore } from '../state/aiStore';
import {
  normalizeBridgeTransportSelection,
  resolveBridgeValidationTruth,
  resolveBridgeUrlRequireHttps,
} from '../../../shared/runtime/homeBridgeTransport.mjs';
import { validateStephanosHomeBridgeUrl } from '../../../shared/runtime/stephanosHomeNode.mjs';

function toStatusTone(value = '', positiveValue = '') {
  return value === positiveValue ? 'ready' : value === 'unknown' ? 'unknown' : 'degraded';
}

function formatTime(timestamp = '') {
  if (!timestamp) return 'not yet';
  const asDate = new Date(timestamp);
  if (Number.isNaN(asDate.getTime())) return 'not yet';
  return asDate.toLocaleString();
}

export default function HomeBridgePanel() {
  const {
    homeBridgeUrl,
    saveHomeBridgeUrl,
    saveBridgeTransportConfig,
    clearHomeBridgeUrl,
    bridgeTransportDefinitions,
    bridgeTransportPreferences,
    bridgeTransportTruth,
    bridgeMemory,
    bridgeAutoRevalidation,
    revalidateRememberedBridge,
    setBridgeTransportSelection,
    updateBridgeTransportConfig,
    uiLayout,
    togglePanel,
    runtimeStatusModel,
  } = useAIStore();

  const selectedTransport = normalizeBridgeTransportSelection(bridgeTransportPreferences?.selectedTransport);
  const transportDefinitions = Array.isArray(bridgeTransportDefinitions) ? bridgeTransportDefinitions : [];
  const [bridgeDraft, setBridgeDraft] = useState(homeBridgeUrl || '');
  const [tailscaleBackendDraft, setTailscaleBackendDraft] = useState(bridgeTransportPreferences?.transports?.tailscale?.backendUrl || '');
  const [validationState, setValidationState] = useState('unknown');
  const [validationReason, setValidationReason] = useState('Not checked yet.');
  const [reachabilityState, setReachabilityState] = useState('unknown');
  const [reachabilityReason, setReachabilityReason] = useState('Not checked yet.');
  const [lastCheckedAt, setLastCheckedAt] = useState('');
  const [feedback, setFeedback] = useState('');
  const [saveInFlight, setSaveInFlight] = useState(false);

  useEffect(() => {
    setBridgeDraft(homeBridgeUrl || '');
  }, [homeBridgeUrl]);

  useEffect(() => {
    setTailscaleBackendDraft(bridgeTransportPreferences?.transports?.tailscale?.backendUrl || '');
  }, [bridgeTransportPreferences?.transports?.tailscale?.backendUrl]);

  const savedBridge = useMemo(() => runtimeStatusModel?.runtimeContext?.homeNodeBridge || {}, [runtimeStatusModel?.runtimeContext?.homeNodeBridge]);
  const routeCandidates = useMemo(
    () => Array.isArray(runtimeStatusModel?.runtimeContext?.routeCandidates) ? runtimeStatusModel.runtimeContext.routeCandidates : [],
    [runtimeStatusModel?.runtimeContext?.routeCandidates],
  );
  const routeWinner = runtimeStatusModel?.runtimeContext?.routeCandidateWinner || null;
  const bridgeValidationTruth = useMemo(() => resolveBridgeValidationTruth({
    runtimeStatusModel,
    selectedTransport,
  }), [runtimeStatusModel, selectedTransport]);
  const requireHttps = useMemo(() => resolveBridgeUrlRequireHttps({
    sessionKind: bridgeValidationTruth.sessionKind,
    selectedTransport,
    fallbackRequireHttps: bridgeValidationTruth.requireHttps,
  }), [bridgeValidationTruth.requireHttps, bridgeValidationTruth.sessionKind, selectedTransport]);
  const transportTruth = useMemo(
    () => (bridgeTransportTruth && typeof bridgeTransportTruth === 'object' ? bridgeTransportTruth : {}),
    [bridgeTransportTruth],
  );
  const reconciliationState = transportTruth.bridgeMemoryReconciliationState || 'no-remembered-bridge';
  const rememberedBridgeStatusLabel = useMemo(() => {
    if (!transportTruth.bridgeMemoryPresent) return 'No saved bridge config';
    if (transportTruth.bridgeMemoryAutoValidationState === 'validating' || transportTruth.bridgeMemoryAutoValidationState === 'probing') {
      return 'Remembered and auto-validation in progress';
    }
    if (transportTruth.bridgeMemoryPromotedToRouteCandidate) return 'Remembered, validated, and promoted into route candidates';
    if (reconciliationState === 'remembered-revalidated') return 'Remembered and validated on this surface';
    if (reconciliationState === 'remembered-unreachable') return 'Remembered but unreachable on this surface';
    if (reconciliationState === 'remembered-validation-failed') return 'Remembered but validation failed on this surface';
    if (reconciliationState === 'remembered-execution-incompatible') return 'Remembered but blocked by hosted browser execution constraints';
    if (transportTruth.bridgeMemoryNeedsValidation) return 'Remembered and awaiting validation on this surface';
    return 'Remembered bridge loaded';
  }, [
    reconciliationState,
    transportTruth.bridgeMemoryAutoValidationState,
    transportTruth.bridgeMemoryNeedsValidation,
    transportTruth.bridgeMemoryPresent,
    transportTruth.bridgeMemoryPromotedToRouteCandidate,
  ]);
  const reconciliationDetail = useMemo(() => {
    if (transportTruth.bridgeMemoryAutoValidationState === 'validating' || transportTruth.bridgeMemoryAutoValidationState === 'probing') {
      return 'Remembered config is being auto-validated and probed on this surface.';
    }
    if (transportTruth.bridgeMemoryPromotedToRouteCandidate) return transportTruth.bridgeMemoryPromotionReason || 'Remembered config validated and promoted.';
    if (reconciliationState === 'remembered-revalidated') return 'Remembered config has been auto-revalidated and matches live bridge truth.';
    if (reconciliationState === 'remembered-validation-failed') return 'Remembered config exists but failed canonical validation on this surface.';
    if (reconciliationState === 'remembered-unreachable') return 'Remembered config validates structurally but is unreachable from this surface.';
    if (reconciliationState === 'remembered-superseded-by-live-config') return 'Remembered config exists, but current live accepted config supersedes it.';
    if (reconciliationState === 'remembered-awaiting-validation') return 'Remembered config is present and waiting for canonical revalidation.';
    return 'No remembered bridge config currently exists.';
  }, [
    reconciliationState,
    transportTruth.bridgeMemoryAutoValidationState,
    transportTruth.bridgeMemoryPromotedToRouteCandidate,
    transportTruth.bridgeMemoryPromotionReason,
  ]);
  const routeRecoveryRecommendedAction = useMemo(() => {
    if (!transportTruth.bridgeMemoryPresent) return 'No remembered bridge found. Add bridge target and save.';
    if (transportTruth.bridgeMemoryPromotedToRouteCandidate) return 'Remembered bridge validated and promoted. Continue with mission intent capture.';
    if (transportTruth.bridgeAutoRevalidationState === 'backoff') return 'Backoff active. Retry validation now, or edit bridge target/transport before retrying.';
    if (reconciliationState === 'remembered-validation-failed') return 'Fix bridge target details, then re-probe and retry validation.';
    if (reconciliationState === 'remembered-unreachable') return 'Re-probe remembered bridge; if still unreachable, switch transport or edit target.';
    return 'Probe remembered bridge and retry validation to recover executable route.';
  }, [
    reconciliationState,
    transportTruth.bridgeAutoRevalidationState,
    transportTruth.bridgeMemoryPresent,
    transportTruth.bridgeMemoryPromotedToRouteCandidate,
  ]);

  useEffect(() => {
    const activeUrl = selectedTransport === 'tailscale'
      ? (bridgeTransportPreferences?.transports?.tailscale?.backendUrl || tailscaleBackendDraft)
      : homeBridgeUrl;
    if (!activeUrl) {
      setValidationState('unknown');
      setValidationReason('No bridge URL saved.');
      setReachabilityState('unknown');
      setReachabilityReason('No bridge URL saved.');
      return;
    }

    const validation = validateStephanosHomeBridgeUrl(activeUrl, {
      frontendOrigin: typeof window !== 'undefined' ? window.location?.origin || '' : '',
      requireHttps,
    });

    if (!validation.ok) {
      setValidationState('invalid');
      setValidationReason(validation.reason || 'Invalid bridge URL.');
      setReachabilityState('invalid');
      setReachabilityReason(validation.reason || 'Probe blocked by invalid bridge URL.');
      return;
    }

    setValidationState('valid');
    setValidationReason('Bridge URL passes canonical validation rules.');
    if (savedBridge.reachability === 'reachable' || savedBridge.reachability === 'unreachable') {
      setReachabilityState(savedBridge.reachability);
      setReachabilityReason(savedBridge.reason || 'Runtime bridge diagnostics available.');
    }
  }, [homeBridgeUrl, requireHttps, savedBridge.reachability, savedBridge.reason, selectedTransport, bridgeTransportPreferences?.transports?.tailscale?.backendUrl, tailscaleBackendDraft]);

  function resolvePersistenceFeedback(result = {}, fallbackSuccess = '') {
    const persistenceResult = result?.persistenceResult || null;
    if (persistenceResult?.attempted !== true) {
      return result?.ok ? fallbackSuccess : `Failed ✗ ${result?.reason || 'save-not-attempted'}`;
    }
    if (persistenceResult.succeeded === true) {
      return `Saved ✓ ${fallbackSuccess}`;
    }
    return `Failed ✗ ${persistenceResult?.error?.message || result?.reason || 'durable-persistence-failed'}`;
  }

  function handleSaveManual() {
    setSaveInFlight(true);
    setFeedback('Saving…');
    const result = saveHomeBridgeUrl(bridgeDraft);
    setSaveInFlight(false);
    if (!result.ok) {
      setFeedback(resolvePersistenceFeedback(result, ''));
      setValidationState('invalid');
      setValidationReason(result.reason || 'Invalid bridge URL.');
      setReachabilityState('invalid');
      setReachabilityReason(result.reason || 'Probe blocked by invalid bridge URL.');
      return;
    }

    updateBridgeTransportConfig('manual', {
      backendUrl: result.normalizedUrl,
      accepted: true,
      reason: 'Manual/LAN bridge URL saved by operator.',
    });
    setFeedback(resolvePersistenceFeedback(result, `Saved bridge URL: ${result.normalizedUrl}`));
    setValidationState('valid');
    setValidationReason('Bridge URL passes canonical validation rules.');
    setReachabilityState('unknown');
    setReachabilityReason('Bridge saved. Probe to confirm live reachability.');
  }

  function handleSaveTailscale() {
    setSaveInFlight(true);
    setFeedback('Saving…');
    const result = saveBridgeTransportConfig('tailscale', tailscaleBackendDraft, {
      accepted: false,
      active: false,
      usable: false,
      reachability: 'unknown',
      reason: 'Tailscale bridge configuration saved; acceptance pending runtime validation.',
    });
    setSaveInFlight(false);
    if (!result.ok) {
      setFeedback(resolvePersistenceFeedback(result, ''));
      setValidationState('invalid');
      setValidationReason(result.reason || 'Invalid Tailscale bridge URL.');
      setReachabilityState('invalid');
      setReachabilityReason(result.reason || 'Probe blocked by invalid bridge URL.');
      return;
    }
    setFeedback(resolvePersistenceFeedback(result, `Saved Tailscale bridge intent: ${result.normalizedUrl}`));
    setValidationState('valid');
    setValidationReason('Bridge URL passes canonical validation rules.');
    setReachabilityState('unknown');
    setReachabilityReason('Bridge saved. Probe to confirm live reachability.');
  }

  function handleValidate() {
    const activeUrl = selectedTransport === 'tailscale' ? tailscaleBackendDraft : bridgeDraft;
    const validation = validateStephanosHomeBridgeUrl(activeUrl, {
      frontendOrigin: typeof window !== 'undefined' ? window.location?.origin || '' : '',
      requireHttps,
    });
    setValidationState(validation.ok ? 'valid' : 'invalid');
    setValidationReason(validation.ok ? 'Bridge URL passes canonical validation rules.' : (validation.reason || 'Invalid bridge URL.'));
    if (!validation.ok) {
      setReachabilityState('invalid');
      setReachabilityReason(validation.reason || 'Probe blocked by invalid bridge URL.');
    }
  }

  async function handleProbe() {
    const candidate = selectedTransport === 'tailscale'
      ? (bridgeTransportPreferences?.transports?.tailscale?.backendUrl || tailscaleBackendDraft)
      : (homeBridgeUrl || bridgeDraft);
    const validation = validateStephanosHomeBridgeUrl(candidate, {
      frontendOrigin: typeof window !== 'undefined' ? window.location?.origin || '' : '',
      requireHttps,
    });
    if (!validation.ok) {
      setReachabilityState('invalid');
      setReachabilityReason(validation.reason || 'Probe blocked by invalid bridge URL.');
      setFeedback('Probe skipped due to invalid bridge URL.');
      return;
    }

    try {
      const probe = await checkApiHealth({ baseUrl: validation.normalizedUrl, timeoutMs: 12000 });
      const serviceOk = probe.ok && probe.data?.service === 'stephanos-server';
      const nextState = serviceOk ? 'reachable' : 'unreachable';
      setReachabilityState(nextState);
      setReachabilityReason(serviceOk
        ? 'Bridge health endpoint responded with stephanos-server.'
        : (probe.data?.error || `Health probe failed (status ${probe.status}).`));
      setLastCheckedAt(new Date().toISOString());
      setFeedback(serviceOk ? 'Bridge is reachable from this surface.' : 'Bridge probe failed.');
      updateBridgeTransportConfig(selectedTransport, {
        reachability: nextState,
        accepted: serviceOk,
        active: serviceOk,
        usable: serviceOk,
        reason: serviceOk
          ? `${selectedTransport} bridge validated by health probe.`
          : `${selectedTransport} bridge probe failed.`,
      });
    } catch (error) {
      setReachabilityState('unreachable');
      setReachabilityReason(error?.message || 'Bridge probe request failed before a response was received.');
      setLastCheckedAt(new Date().toISOString());
      setFeedback('Bridge probe failed.');
      updateBridgeTransportConfig(selectedTransport, {
        reachability: 'unreachable',
        accepted: false,
        active: false,
        usable: false,
        reason: `${selectedTransport} bridge probe failed before a response was received.`,
      });
    }
  }

  function handleClear() {
    if (selectedTransport === 'tailscale') {
      updateBridgeTransportConfig('tailscale', {
        enabled: false,
        backendUrl: '',
        accepted: false,
        active: false,
        usable: false,
        reachability: 'unknown',
        reason: 'Tailscale transport cleared.',
      });
      setTailscaleBackendDraft('');
      setFeedback('Tailscale transport settings cleared.');
      return;
    }
    clearHomeBridgeUrl();
    setBridgeDraft('');
    setValidationState('unknown');
    setValidationReason('No bridge URL saved.');
    setReachabilityState('unknown');
    setReachabilityReason('No bridge URL saved.');
    setLastCheckedAt('');
    setFeedback('Bridge URL cleared.');
  }

  const configured = transportTruth.configuredTransport !== 'none';
  const tailscale = bridgeTransportPreferences?.transports?.tailscale || {};

  return (
    <CollapsiblePanel
      panelId="homeBridgePanel"
      title="Home Bridge"
      description="Remote route control plane for home-node bridge transports."
      className="home-bridge-panel"
      isOpen={uiLayout.homeBridgePanel !== false}
      onToggle={() => togglePanel('homeBridgePanel')}
    >
      <p className="home-bridge-guidance">Select transport, then configure and validate truthful bridge readiness.</p>
      {bridgeAutoRevalidation?.state && bridgeAutoRevalidation.state !== 'idle' ? (
        <p className="home-bridge-guidance">
          Auto revalidation: <strong>{bridgeAutoRevalidation.state}</strong> — {bridgeAutoRevalidation.reason || 'No details available.'}
        </p>
      ) : null}
      <div className="home-bridge-transport-selector" data-no-drag>
        {transportDefinitions.map((transport) => (
          <button
            key={transport.key}
            type="button"
            className={`provider-toggle-button ${selectedTransport === transport.key ? 'active' : ''}`}
            onClick={() => setBridgeTransportSelection(transport.key)}
            disabled={transport.status === 'planned'}
            title={transport.status === 'planned' ? 'Planned transport (coming later).' : transport.description}
          >
            {transport.label}
          </button>
        ))}
      </div>

      {selectedTransport === 'tailscale' ? (
        <div className="provider-form-grid">
          <label>
            <span>Tailscale Backend URL</span>
            <input type="url" value={tailscaleBackendDraft} onChange={(event) => setTailscaleBackendDraft(event.target.value)} placeholder="https://100.64.0.10" />
          </label>
          <label>
            <span>Device Name</span>
            <input type="text" value={tailscale.deviceName || ''} onChange={(event) => updateBridgeTransportConfig('tailscale', { deviceName: event.target.value, enabled: true })} placeholder="stephanos-home-node" />
          </label>
          <label>
            <span>Tailnet IP</span>
            <input type="text" value={tailscale.tailnetIp || ''} onChange={(event) => updateBridgeTransportConfig('tailscale', { tailnetIp: event.target.value, enabled: true })} placeholder="100.x.y.z" />
          </label>
          <label>
            <span>Hostname Override</span>
            <input type="text" value={tailscale.hostOverride || ''} onChange={(event) => updateBridgeTransportConfig('tailscale', { hostOverride: event.target.value, enabled: true })} placeholder="home-node.tailnet.ts.net" />
          </label>
        </div>
      ) : (
        <label className="home-bridge-field">
          <span>Bridge URL</span>
          <input
            type="url"
            value={bridgeDraft}
            onChange={(event) => setBridgeDraft(event.target.value)}
            placeholder="https://your-bridge.example.com"
            autoComplete="off"
            spellCheck="false"
          />
        </label>
      )}

      <div className="home-bridge-actions" data-no-drag>
        <button type="button" className="ghost-button" onClick={selectedTransport === 'tailscale' ? handleSaveTailscale : handleSaveManual}>{saveInFlight ? 'Saving…' : 'Save'}</button>
        <button type="button" className="ghost-button" onClick={handleValidate}>Validate</button>
        <button type="button" className="ghost-button" onClick={handleProbe}>Re-probe Remembered Bridge</button>
        <button type="button" className="ghost-button" onClick={() => revalidateRememberedBridge('panel-retry')} disabled={!transportTruth.bridgeMemoryPresent}>Retry Bridge Validation Now</button>
        <button type="button" className="ghost-button" onClick={() => setBridgeTransportSelection(selectedTransport === 'tailscale' ? 'manual' : 'tailscale')}>Switch Transport</button>
        <button
          type="button"
          className="ghost-button"
          disabled={!transportTruth.bridgeMemoryValidatedOnThisSurface || transportTruth.bridgeMemoryPromotedToRouteCandidate}
          onClick={() => revalidateRememberedBridge('operator-promote-validated')}
        >
          Promote Validated Bridge
        </button>
        <button type="button" className="ghost-button" onClick={handleClear}>Clear</button>
      </div>

      <div className="home-bridge-status-grid" aria-live="polite">
        <span className={`home-bridge-chip ${toStatusTone(configured ? 'yes' : 'no', 'yes')}`}>Configured: {configured ? 'yes' : 'no'}</span>
        <span className={`home-bridge-chip ${toStatusTone(validationState, 'valid')}`}>Validation: {validationState}</span>
        <span className={`home-bridge-chip ${toStatusTone(reachabilityState, 'reachable')}`}>Reachability: {reachabilityState}</span>
      </div>

      <p className="home-bridge-detail">Selected transport: <strong>{transportTruth.selectedTransport}</strong></p>
      <p className="home-bridge-detail">Transport state: <strong>{transportTruth.state}</strong></p>
      <p className="home-bridge-detail">Transport detail: <strong>{transportTruth.detail}</strong></p>
      <p className="home-bridge-detail">Transport source: <strong>{transportTruth.source}</strong></p>
      <p className="home-bridge-detail">Saved URL: <strong>{selectedTransport === 'tailscale' ? (tailscale.backendUrl || 'none') : (homeBridgeUrl || 'none')}</strong></p>
      <p className="home-bridge-detail">Remembered status: <strong>{rememberedBridgeStatusLabel}</strong></p>
      <p className="home-bridge-detail">Route recovery recommended action: <strong>{routeRecoveryRecommendedAction}</strong></p>
      <p className="home-bridge-detail">Remembered bridge: <strong>{transportTruth.bridgeMemoryPresent ? transportTruth.bridgeMemoryTransport : 'none'}</strong></p>
      <p className="home-bridge-detail">Remembered URL: <strong>{transportTruth.bridgeMemoryUrl || 'none'}</strong></p>
      <p className="home-bridge-detail">Remembered at: <strong>{formatTime(transportTruth.bridgeMemoryRememberedAt || bridgeMemory?.rememberedAt)}</strong></p>
      <p className="home-bridge-detail">Remembered state: <strong>{reconciliationState}</strong></p>
      <p className="home-bridge-detail">Remembered state detail: <strong>{reconciliationDetail}</strong></p>
      <p className="home-bridge-detail">Memory validation state: <strong>{transportTruth.bridgeMemoryValidationState || 'absent'}</strong></p>
      <p className="home-bridge-detail">Memory needs validation: <strong>{transportTruth.bridgeMemoryNeedsValidation ? 'yes' : 'no'}</strong></p>
      <p className="home-bridge-detail">Memory reason: <strong>{transportTruth.bridgeMemoryReason || 'No remembered Home Bridge transport.'}</strong></p>
      <p className="home-bridge-detail">Memory reconciliation: <strong>{transportTruth.bridgeMemoryReconciliationState || 'no-remembered-bridge'}</strong></p>
      <p className="home-bridge-detail">Reconciliation reason: <strong>{transportTruth.bridgeMemoryReconciliationReason || 'n/a'}</strong></p>
      <p className="home-bridge-detail">Auto revalidation state: <strong>{transportTruth.bridgeAutoRevalidationState || 'idle'}</strong></p>
      <p className="home-bridge-detail">Auto revalidation reason: <strong>{transportTruth.bridgeAutoRevalidationReason || 'n/a'}</strong></p>
      <p className="home-bridge-detail">Backoff active: <strong>{transportTruth.bridgeAutoRevalidationState === 'backoff' ? 'yes' : 'no'}</strong></p>
      <p className="home-bridge-detail">Retry eligible now: <strong>{transportTruth.bridgeAutoRevalidationState === 'probing' ? 'no' : 'yes'}</strong></p>
      <p className="home-bridge-detail">Last probe target: <strong>{bridgeAutoRevalidation?.executionTarget || transportTruth.bridgeMemoryUrl || 'none'}</strong></p>
      <p className="home-bridge-detail">Probe failure reason: <strong>{bridgeAutoRevalidation?.executionReason || transportTruth.bridgeMemoryReconciliationReason || 'n/a'}</strong></p>
      <p className="home-bridge-detail">Auto validation attempted: <strong>{transportTruth.bridgeMemoryAutoValidationAttempted ? 'yes' : 'no'}</strong></p>
      <p className="home-bridge-detail">Validated on this surface: <strong>{transportTruth.bridgeMemoryValidatedOnThisSurface ? 'yes' : 'no'}</strong></p>
      <p className="home-bridge-detail">Reachable on this surface: <strong>{transportTruth.bridgeMemoryReachableOnThisSurface ? 'yes' : 'no'}</strong></p>
      <p className="home-bridge-detail">Promoted to route candidates: <strong>{transportTruth.bridgeMemoryPromotedToRouteCandidate ? 'yes' : 'no'}</strong></p>
      <p className="home-bridge-detail">Promotion reason: <strong>{transportTruth.bridgeMemoryPromotionReason || 'n/a'}</strong></p>
      <p className="home-bridge-detail">Validation reason: <strong>{validationReason}</strong></p>
      <p className="home-bridge-detail">Reachability reason: <strong>{reachabilityReason}</strong></p>
      <p className="home-bridge-detail">Last checked: <strong>{formatTime(lastCheckedAt)}</strong></p>
      <p className="home-bridge-detail">Route winner: <strong>{routeWinner ? `${routeWinner.routeKind}/${routeWinner.transportKind}` : 'none'}</strong></p>
      <p className="home-bridge-detail">WireGuard status: <strong>planned / not yet configured</strong></p>
      {routeCandidates.length ? (
        <ul className="home-bridge-detail">
          {routeCandidates.slice(0, 6).map((candidate) => (
            <li key={candidate.candidateKey}>
              {candidate.candidateKey}: {candidate.usable ? 'usable' : candidate.reachable ? 'reachable' : candidate.configured ? 'configured' : 'not configured'} (score {candidate.score})
            </li>
          ))}
        </ul>
      ) : null}
      {transportTruth.tailscale?.diagnostics?.length ? (
        <ul className="home-bridge-detail">
          {transportTruth.tailscale.diagnostics.map((entry) => <li key={entry}>{entry}</li>)}
        </ul>
      ) : null}
      {feedback ? <p className="home-bridge-feedback">{feedback}</p> : null}
    </CollapsiblePanel>
  );
}
