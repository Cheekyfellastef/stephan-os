import { useMemo, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import { useAIStore } from '../state/aiStore';
import { classifyOperatorIntent } from '../ai/intentEngine.js';

const INTENT_CLASSES = ['plan', 'research', 'prepare', 'execute-later', 'review'];

function asText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function deriveMissionTasks({ missionPacket = {}, selectors = {} } = {}) {
  const blockers = Array.isArray(missionPacket.blockers) ? missionPacket.blockers : [];
  const continuity = Array.isArray(missionPacket.continuityNotes) ? missionPacket.continuityNotes : [];
  const nextAction = asText(selectors?.nextRecommendedAction, 'Review packet and choose explicit lifecycle action.');

  return [
    {
      taskId: 'intent-clarity',
      title: 'Intent clarification and objective lock',
      summary: `Objective: ${asText(selectors?.currentMissionState?.intentLabel, 'unknown')}`,
      requiresBattleBridge: false,
      reason: 'Hosted-safe planning and mission intent shaping can run without local execution authority.',
    },
    {
      taskId: 'packet-review',
      title: 'Mission packet review',
      summary: asText(missionPacket.missionSummary, 'No mission packet summary established yet.'),
      requiresBattleBridge: false,
      reason: 'Packet review/decomposition is projection-only and remains available in hosted mode.',
    },
    {
      taskId: 'blocker-triage',
      title: 'Execution blocker triage',
      summary: blockers.length > 0 ? blockers.join(' · ') : 'No explicit blockers recorded.',
      requiresBattleBridge: blockers.length > 0,
      reason: blockers.length > 0
        ? 'Current blockers indicate execution dependency that requires Battle Bridge or local authority.'
        : 'No explicit blocker requires immediate local execution.',
    },
    {
      taskId: 'continuity-handoff',
      title: 'Resumable continuity packet',
      summary: continuity.length > 0 ? continuity.join(' · ') : nextAction,
      requiresBattleBridge: false,
      reason: 'Continuity capture/export is hosted-safe and can be resumed later on Battle Bridge.',
    },
  ];
}

export default function IntentEnginePanel({
  canonicalCurrentIntent = {},
  canonicalMissionPacket = {},
  orchestrationSelectors = {},
  runtimeStatus = {},
  finalRouteTruth = null,
} = {}) {
  const { uiLayout, togglePanel } = useAIStore();
  const [intentText, setIntentText] = useState('');
  const [intentClass, setIntentClass] = useState('plan');
  const [taskExecutionMap, setTaskExecutionMap] = useState({});
  const [decompositionDecision, setDecompositionDecision] = useState('pending-review');

  const intentPreview = useMemo(() => classifyOperatorIntent({
    prompt: intentText,
    projectContext: {
      requestedClass: intentClass,
      missionPhase: orchestrationSelectors?.currentMissionState?.missionPhase,
    },
  }), [intentClass, intentText, orchestrationSelectors?.currentMissionState?.missionPhase]);

  const missionTasks = useMemo(() => deriveMissionTasks({
    missionPacket: canonicalMissionPacket,
    selectors: orchestrationSelectors,
  }), [canonicalMissionPacket, orchestrationSelectors]);

  const hostedSession = runtimeStatus?.runtimeContext?.sessionKind === 'hosted-web';
  const localAuthorityAvailable = finalRouteTruth?.backendReachable === true && hostedSession === false;
  const executionDeferred = hostedSession && !localAuthorityAvailable;

  return (
    <CollapsiblePanel
      panelId="intentEnginePanel"
      title="Intent Engine Interface"
      description="Operator-facing intent capture, decomposition review, and hosted-safe execution planning."
      className="intent-engine-panel"
      isOpen={uiLayout?.intentEnginePanel !== false}
      onToggle={() => togglePanel('intentEnginePanel')}
    >
      <p className="mission-note">
        Mode: <strong>{executionDeferred ? 'hosted-safe orchestration' : 'battle-bridge execution-capable'}</strong> · Acting agent: <strong>{asText(orchestrationSelectors?.currentMissionState?.intentLabel, 'intent-engine')}</strong>
      </p>
      <p className="mission-note">
        Local authority: <strong>{localAuthorityAvailable ? 'available' : 'unavailable'}</strong> · Execution deferred to Battle Bridge: <strong>{executionDeferred ? 'yes' : 'no'}</strong>
      </p>

      <label>
        Mission intent
        <textarea rows={3} value={intentText} onChange={(event) => setIntentText(event.target.value)} placeholder="Describe mission intent for decomposition and handoff..." />
      </label>
      <label>
        Intent class
        <select value={intentClass} onChange={(event) => setIntentClass(event.target.value)}>
          {INTENT_CLASSES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </select>
      </label>

      <section className="agents-region">
        <h4>Interpreted Mission Packet</h4>
        <ul className="compact-list">
          <li>Canonical intent: {asText(canonicalCurrentIntent?.operatorIntent?.label, 'unknown')} ({asText(canonicalCurrentIntent?.operatorIntent?.source, 'unknown')})</li>
          <li>Live mission: {asText(canonicalMissionPacket?.missionTitle, 'not established')}</li>
          <li>Phase: {asText(orchestrationSelectors?.currentMissionState?.missionPhase, 'proposed')}</li>
          <li>Intent preview type: {asText(intentPreview?.intentType, 'unknown')} · confidence {Number(intentPreview?.confidence || 0).toFixed(2)}</li>
          <li>Reason: {asText(intentPreview?.reason, 'No interpreted reason yet.')}</li>
        </ul>
      </section>

      <section className="agents-region">
        <h4>Proposed Task Decomposition</h4>
        <ul className="compact-list">
          {missionTasks.map((task) => {
            const selection = taskExecutionMap[task.taskId] || (task.requiresBattleBridge ? 'battle-bridge-required' : 'hosted-safe-only');
            return (
              <li key={task.taskId}>
                <strong>{task.title}</strong> — {task.summary}
                <br />
                <small>{task.reason}</small>
                <br />
                <label>
                  Execution posture
                  <select
                    value={selection}
                    onChange={(event) => setTaskExecutionMap((prev) => ({ ...prev, [task.taskId]: event.target.value }))}
                  >
                    <option value="hosted-safe-only">hosted-safe-only</option>
                    <option value="battle-bridge-required">battle-bridge-required</option>
                  </select>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="status-panel-copy-actions" data-no-drag>
        <button type="button" onClick={() => setDecompositionDecision('accepted')}>Accept decomposition</button>
        <button type="button" onClick={() => setDecompositionDecision('rejected')}>Reject decomposition</button>
        <button type="button" onClick={() => setDecompositionDecision('refine-requested')}>Refine decomposition</button>
      </section>

      <p className="muted">
        Decision: <strong>{decompositionDecision}</strong> · Pending approvals: <strong>{orchestrationSelectors?.commandReadiness?.['accept-mission']?.approvalRequired ? 'yes' : 'no'}</strong> · Resumable work: <strong>{orchestrationSelectors?.missionResumability?.resumableMissionCount || 0}</strong>
      </p>
      <p className="muted">
        Next recommended step: {asText(orchestrationSelectors?.nextRecommendedAction, 'Review mission packet and choose explicit lifecycle action.')}.
      </p>
    </CollapsiblePanel>
  );
}
