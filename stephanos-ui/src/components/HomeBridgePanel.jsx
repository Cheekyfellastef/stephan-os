import { useEffect, useMemo, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import { checkApiHealth } from '../ai/aiClient';
import { useAIStore } from '../state/aiStore';
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
    uiLayout,
    togglePanel,
    runtimeStatusModel,
  } = useAIStore();
  const [bridgeDraft, setBridgeDraft] = useState(homeBridgeUrl || '');
  const [validationState, setValidationState] = useState('unknown');
  const [validationReason, setValidationReason] = useState('Not checked yet.');
  const [reachabilityState, setReachabilityState] = useState('unknown');
  const [reachabilityReason, setReachabilityReason] = useState('Not checked yet.');
  const [lastCheckedAt, setLastCheckedAt] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    setBridgeDraft(homeBridgeUrl || '');
  }, [homeBridgeUrl]);

  const savedBridge = useMemo(() => runtimeStatusModel?.runtimeContext?.homeNodeBridge || {}, [runtimeStatusModel?.runtimeContext?.homeNodeBridge]);

  useEffect(() => {
    if (!homeBridgeUrl) {
      setValidationState('unknown');
      setValidationReason('No bridge URL saved.');
      setReachabilityState('unknown');
      setReachabilityReason('No bridge URL saved.');
      return;
    }

    const validation = validateStephanosHomeBridgeUrl(homeBridgeUrl, {
      frontendOrigin: typeof window !== 'undefined' ? window.location?.origin || '' : '',
      requireHttps: true,
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
  }, [homeBridgeUrl, savedBridge.reachability, savedBridge.reason]);

  function handleSave() {
    const result = saveHomeBridgeUrl(bridgeDraft);
    if (!result.ok) {
      setFeedback(`Save failed: ${result.reason || 'invalid-home-bridge-url'}`);
      setValidationState('invalid');
      setValidationReason(result.reason || 'Invalid bridge URL.');
      setReachabilityState('invalid');
      setReachabilityReason(result.reason || 'Probe blocked by invalid bridge URL.');
      return;
    }

    setFeedback(`Saved bridge URL: ${result.normalizedUrl}`);
    setValidationState('valid');
    setValidationReason('Bridge URL passes canonical validation rules.');
    setReachabilityState('unknown');
    setReachabilityReason('Bridge saved. Probe to confirm live reachability.');
  }

  function handleValidate() {
    const validation = validateStephanosHomeBridgeUrl(bridgeDraft, {
      frontendOrigin: typeof window !== 'undefined' ? window.location?.origin || '' : '',
      requireHttps: true,
    });
    setValidationState(validation.ok ? 'valid' : 'invalid');
    setValidationReason(validation.ok ? 'Bridge URL passes canonical validation rules.' : (validation.reason || 'Invalid bridge URL.'));
    if (!validation.ok) {
      setReachabilityState('invalid');
      setReachabilityReason(validation.reason || 'Probe blocked by invalid bridge URL.');
    }
  }

  async function handleProbe() {
    const validation = validateStephanosHomeBridgeUrl(homeBridgeUrl || bridgeDraft, {
      frontendOrigin: typeof window !== 'undefined' ? window.location?.origin || '' : '',
      requireHttps: true,
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
    } catch (error) {
      setReachabilityState('unreachable');
      setReachabilityReason(error?.message || 'Bridge probe request failed before a response was received.');
      setLastCheckedAt(new Date().toISOString());
      setFeedback('Bridge probe failed.');
    }
  }

  function handleClear() {
    clearHomeBridgeUrl();
    setBridgeDraft('');
    setValidationState('unknown');
    setValidationReason('No bridge URL saved.');
    setReachabilityState('unknown');
    setReachabilityReason('No bridge URL saved.');
    setLastCheckedAt('');
    setFeedback('Bridge URL cleared.');
  }

  const configured = Boolean(homeBridgeUrl);

  return (
    <CollapsiblePanel
      panelId="homeBridgePanel"
      title="Home Bridge"
      description="Remote route to the battle bridge backend. Use a secure tunnel URL so hosted surfaces can reach your home-node backend."
      className="home-bridge-panel"
      isOpen={uiLayout.homeBridgePanel !== false}
      onToggle={() => togglePanel('homeBridgePanel')}
    >
      <p className="home-bridge-guidance">Bridge URL is required for off-network home-node bridge routing.</p>
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

      <div className="home-bridge-actions" data-no-drag>
        <button type="button" className="ghost-button" onClick={handleSave}>Save</button>
        <button type="button" className="ghost-button" onClick={handleValidate}>Validate</button>
        <button type="button" className="ghost-button" onClick={handleProbe}>Test Reachability</button>
        <button type="button" className="ghost-button" onClick={handleClear}>Clear</button>
      </div>

      <div className="home-bridge-status-grid" aria-live="polite">
        <span className={`home-bridge-chip ${toStatusTone(configured ? 'yes' : 'no', 'yes')}`}>Configured: {configured ? 'yes' : 'no'}</span>
        <span className={`home-bridge-chip ${toStatusTone(validationState, 'valid')}`}>Validation: {validationState}</span>
        <span className={`home-bridge-chip ${toStatusTone(reachabilityState, 'reachable')}`}>Reachability: {reachabilityState}</span>
      </div>

      <p className="home-bridge-detail">Saved URL: <strong>{homeBridgeUrl || 'none'}</strong></p>
      <p className="home-bridge-detail">Validation reason: <strong>{validationReason}</strong></p>
      <p className="home-bridge-detail">Reachability reason: <strong>{reachabilityReason}</strong></p>
      <p className="home-bridge-detail">Last checked: <strong>{formatTime(lastCheckedAt)}</strong></p>
      {feedback ? <p className="home-bridge-feedback">{feedback}</p> : null}
    </CollapsiblePanel>
  );
}
