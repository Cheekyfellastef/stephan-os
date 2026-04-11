import { useEffect, useMemo, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import { checkApiHealth } from '../ai/aiClient';
import { useAIStore } from '../state/aiStore';
import {
  normalizeBridgeTransportSelection,
  projectHomeBridgeTransportTruth,
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
    clearHomeBridgeUrl,
    bridgeTransportDefinitions,
    bridgeTransportPreferences,
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
  const transportTruth = useMemo(() => projectHomeBridgeTransportTruth(bridgeTransportPreferences, {
    runtimeBridge: savedBridge,
  }), [bridgeTransportPreferences, savedBridge]);

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

  function handleSaveManual() {
    const result = saveHomeBridgeUrl(bridgeDraft);
    if (!result.ok) {
      setFeedback(`Save failed: ${result.reason || 'invalid-home-bridge-url'}`);
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
    setFeedback(`Saved bridge URL: ${result.normalizedUrl}`);
    setValidationState('valid');
    setValidationReason('Bridge URL passes canonical validation rules.');
    setReachabilityState('unknown');
    setReachabilityReason('Bridge saved. Probe to confirm live reachability.');
  }

  function handleSaveTailscale() {
    updateBridgeTransportConfig('tailscale', {
      backendUrl: tailscaleBackendDraft,
      accepted: false,
      active: false,
      usable: false,
      reachability: 'unknown',
      reason: 'Tailscale bridge configuration saved; acceptance pending runtime validation.',
    });
    setFeedback('Saved Tailscale bridge intent. Validate or probe to confirm runtime reachability.');
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
        <button type="button" className="ghost-button" onClick={selectedTransport === 'tailscale' ? handleSaveTailscale : handleSaveManual}>Save</button>
        <button type="button" className="ghost-button" onClick={handleValidate}>Validate</button>
        <button type="button" className="ghost-button" onClick={handleProbe}>Test Reachability</button>
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
