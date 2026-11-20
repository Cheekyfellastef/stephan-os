import { useCallback, useEffect, useMemo, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import {
  getGamingResourceState,
  runGamingResourceAcceptance,
  setGamingResourceMode,
} from '../ai/aiClient';

function formatVram(value) {
  const mib = Number(value);
  if (!Number.isFinite(mib)) return 'unknown';
  return `${(mib / 1024).toFixed(1)} GB`;
}

export default function GamingResourceTile({ uiLayout, togglePanel }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState('Loading gaming resource state…');

  const refresh = useCallback(async () => {
    try {
      const result = await getGamingResourceState();
      if (!result.ok) {
        setFeedback(result.data?.blocker || 'Gaming resource state unavailable.');
        return;
      }
      setState(result.data?.state || null);
      setFeedback('');
    } catch (error) {
      setFeedback(error?.message || 'Gaming resource state unavailable.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const applyMode = useCallback(async (mode) => {
    setBusy(mode);
    setFeedback(`Applying ${mode.replace('_', ' ')}…`);
    try {
      const result = await setGamingResourceMode(mode);
      if (result.ok) {
        setState(result.data?.state || null);
        setFeedback(`Gaming mode set to ${mode.replace('_', ' ')}.`);
      } else {
        setFeedback(result.data?.blocker || 'Gaming mode change failed.');
      }
    } catch (error) {
      setFeedback(error?.message || 'Gaming mode change failed.');
    } finally {
      setBusy('');
    }
  }, []);

  const runAcceptance = useCallback(async () => {
    setBusy('ACCEPTANCE');
    setFeedback('Running bounded gaming resource self-test…');
    try {
      const result = await runGamingResourceAcceptance();
      setFeedback(result.ok
        ? 'Self-test passed. Preparation, override, telemetry and restoration are healthy.'
        : `Self-test failed: ${result.data?.blocker || result.data?.finalVerdict || 'unknown blocker'}`);
      await refresh();
    } catch (error) {
      setFeedback(error?.message || 'Gaming resource self-test failed.');
    } finally {
      setBusy('');
    }
  }, [refresh]);

  const tone = state?.evictionHealthy === false ? 'RED' : state?.active ? 'GREEN' : 'READY';
  const gameLabel = state?.gameProcessName || (state?.airLinkActive ? 'VR runtime' : 'none');
  const gpuFree = state?.gpuAfter?.memoryFreeMiB ?? state?.gpuBefore?.memoryFreeMiB;
  const currentMode = state?.overrideMode || 'AUTO';
  const summary = useMemo(() => [
    ['State', state?.phase || 'UNKNOWN'],
    ['Protection', tone],
    ['Mode', currentMode],
    ['Game / trigger', gameLabel],
    ['Profile', state?.profile?.name || 'generic-safe'],
    ['Free VRAM', formatVram(gpuFree)],
    ['VRAM released', formatVram(state?.vramReleasedMiB)],
    ['Heavy models', state?.heavyModelAllowed ? 'allowed by profile' : 'parked'],
  ], [currentMode, gameLabel, gpuFree, state, tone]);

  return (
    <CollapsiblePanel
      panelId="gamingResourcePanel"
      title="Gaming Resource Guard"
      description="Automatic VR/flat-game protection with bounded manual override."
      isOpen={uiLayout?.gamingResourcePanel !== false}
      onToggle={() => togglePanel('gamingResourcePanel')}
      className="pane-span-2"
    >
      <section className="capability-radar-banner">
        Best-click-is-no-click mode is <strong>{currentMode}</strong>. Heavy Ollama models are the only processes this guard may evict.
      </section>
      <section className="capability-radar-summary-grid">
        {summary.map(([label, value]) => (
          <article key={label}><strong>{value}</strong><span>{label}</span></article>
        ))}
      </section>
      <section className="capability-radar-filters" aria-label="Gaming resource mode">
        <button type="button" className={currentMode === 'AUTO' ? 'active' : ''} disabled={Boolean(busy)} onClick={() => void applyMode('AUTO')}>AUTO</button>
        <button type="button" className={currentMode === 'FORCE_ON' ? 'active' : ''} disabled={Boolean(busy)} onClick={() => void applyMode('FORCE_ON')}>FORCE ON</button>
        <button type="button" className={currentMode === 'FORCE_OFF' ? 'active' : ''} disabled={Boolean(busy)} onClick={() => void applyMode('FORCE_OFF')}>FORCE OFF</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void runAcceptance()}>Run self-test</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void refresh()}>Refresh</button>
      </section>
      <p className="muted" role="status" aria-live="polite">
        {feedback || `${state?.reason || 'idle'} · ${state?.transition || 'steady'}`}
      </p>
      {state?.cooldownUntilUtc ? <p className="muted">Heavy-model cooldown until {new Date(state.cooldownUntilUtc).toLocaleTimeString()}.</p> : null}
    </CollapsiblePanel>
  );
}
