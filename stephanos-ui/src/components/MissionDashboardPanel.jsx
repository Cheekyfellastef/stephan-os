import { useEffect, useMemo, useRef, useState } from 'react';
import { createStephanosMemory } from '../../../shared/runtime/stephanosMemory.mjs';
import { adjudicateProjectProgress } from '../../../shared/project/projectProgressAdjudicator.mjs';
import { createSeedProjectProgressModel, getProjectStatusLabel } from '../../../shared/project/projectProgressModel.mjs';
import { useAIStore } from '../state/aiStore';
import {
  buildMissionHandoffText,
  buildMissionSummaryMetrics,
  createDefaultMissionDashboardState,
  getMissionStatusLabel,
  normalizeMissionDashboardState,
  normalizeMissionMilestone,
  sortMilestonesForOperations,
  STATUS_VALUES,
} from '../state/missionDashboardModel';
import { normalizeMissionDashboardUiState } from '../state/missionDashboardUiState';
import { writeTextToClipboard } from '../utils/clipboardCopy';
import CollapsiblePanel from './CollapsiblePanel';

const MISSION_RECORD_NAMESPACE = 'mission-dashboard';
const MISSION_RECORD_ID = 'project-progress';

function createEmptyEditor() {
  return {
    status: 'not-started',
    percentComplete: 0,
    notes: '',
    blockerFlag: false,
    blockerDetails: '',
    nextAction: '',
  };
}

function formatTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  if (Number.isNaN(parsed)) {
    return 'unknown';
  }

  return new Date(parsed).toLocaleString();
}

function progressClassName(percent) {
  if (percent >= 90) return 'high';
  if (percent >= 40) return 'medium';
  return 'low';
}

export default function MissionDashboardPanel({
  finalAgentView = {},
  orchestrationSelectors = {},
  runtimeStatus = {},
  finalRouteTruth = null,
  agentTaskProjection = null,
} = {}) {
  const {
    uiLayout,
    togglePanel,
    missionDashboardUiState,
    setMissionDashboardUiState,
  } = useAIStore();

  const memoryRef = useRef(null);
  const [dashboardState, setDashboardState] = useState(createDefaultMissionDashboardState());
  const [editorState, setEditorState] = useState(createEmptyEditor());
  const [isHydrating, setIsHydrating] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState({ tone: 'neutral', message: '' });
  const [fallbackCopyText, setFallbackCopyText] = useState('');
  const [layoutMode, setLayoutMode] = useState('desktop');

  const uiState = useMemo(
    () => normalizeMissionDashboardUiState(missionDashboardUiState),
    [missionDashboardUiState],
  );

  useEffect(() => {
    memoryRef.current = createStephanosMemory({
      source: 'mission-dashboard',
    });
  }, []);

  useEffect(() => {
    const evaluateLayout = () => {
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const nextMode = viewportWidth <= 680 ? 'phone' : viewportWidth <= 1080 ? 'tablet' : 'desktop';
      setLayoutMode((prev) => {
        if (prev !== nextMode) {
          console.info(`[MISSION DASHBOARD] responsive layout mode: ${nextMode}`);
        }
        return nextMode;
      });
    };
    evaluateLayout();
    window.addEventListener('resize', evaluateLayout);
    return () => window.removeEventListener('resize', evaluateLayout);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function hydrateDashboard() {
      setIsHydrating(true);
      try {
        const memory = memoryRef.current;
        if (!memory) return;
        const hydration = await memory.hydrate();
        const record = memory.getRecord({ namespace: MISSION_RECORD_NAMESPACE, id: MISSION_RECORD_ID });
        if (record?.payload?.missionDashboard) {
          const normalized = normalizeMissionDashboardState(record.payload.missionDashboard);
          if (isMounted) {
            setDashboardState(normalized);
          }
          console.info('[MISSION DASHBOARD] hydrated from backend durable memory', {
            source: hydration.source,
          });
        } else {
          const seeded = createDefaultMissionDashboardState();
          memory.saveRecord({
            namespace: MISSION_RECORD_NAMESPACE,
            id: MISSION_RECORD_ID,
            type: 'workspace.state',
            summary: 'Mission dashboard project progress',
            payload: { missionDashboard: seeded },
            tags: ['mission-dashboard', 'project-progress'],
            scope: 'runtime',
            importance: 'high',
          });
          if (isMounted) {
            setDashboardState(seeded);
          }
          console.info('[MISSION DASHBOARD] using fallback/default seed');
        }
      } catch (error) {
        if (isMounted) {
          setDashboardState(createDefaultMissionDashboardState());
          setFeedback({ tone: 'error', message: 'Hydration failed. Using safe defaults.' });
        }
        console.error('[MISSION DASHBOARD] hydration failed', error);
      } finally {
        if (isMounted) {
          setIsHydrating(false);
        }
      }
    }

    hydrateDashboard();
    return () => {
      isMounted = false;
    };
  }, []);

  const orderedMilestones = useMemo(() => {
    const source = uiState.showBlockedOnly
      ? dashboardState.milestones.filter((milestone) => milestone.blockerFlag || milestone.status === 'blocked')
      : dashboardState.milestones;
    return sortMilestonesForOperations(source);
  }, [dashboardState.milestones, uiState.showBlockedOnly]);

  const metrics = useMemo(() => buildMissionSummaryMetrics(dashboardState), [dashboardState]);
  const projectProgressProjection = useMemo(() => adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    runtimeStatus,
    finalRouteTruth,
    orchestrationSelectors,
  }), [finalRouteTruth, orchestrationSelectors, runtimeStatus]);
  const liveProjection = useMemo(() => {
    const missionView = finalAgentView?.finalMissionOrchestrationView || {};
    const approvalView = finalAgentView?.finalApprovalQueueView || {};
    const resumeView = finalAgentView?.finalResumeView || {};
    const capabilityPosture = orchestrationSelectors?.capabilityPosture || {};
    return {
      actingAgent: finalAgentView?.actingAgentId || 'intent-engine',
      activeGoals: Array.isArray(missionView.activeGoals) ? missionView.activeGoals : [],
      openTasks: Number(missionView?.taskOwnership?.reduce((sum, entry) => sum + Number((entry?.ownedTaskIds || []).length || 0), 0) || 0),
      blockedItems: Array.isArray(resumeView.blockedQueue) ? resumeView.blockedQueue : [],
      pendingApprovals: Number(approvalView.pendingCount || 0),
      resumableWork: Array.isArray(resumeView.resumableQueue) ? resumeView.resumableQueue : [],
      localAuthorityAvailable: capabilityPosture.localAuthorityAvailable === true,
      hostedSession: capabilityPosture.hostedSafePlanningAvailable === true && capabilityPosture.localAuthorityAvailable !== true,
      mode: capabilityPosture.mode || 'planning-only-degraded',
      postureSummary: capabilityPosture.operatorSummary || 'Capability posture unavailable.',
      routeState: finalRouteTruth?.routeKind || 'unavailable',
      executionAvailability: capabilityPosture.executionAvailable ? 'available' : 'deferred',
      canonicalIntentState: orchestrationSelectors?.currentMissionState?.intentSource || 'unknown',
      missionPacketState: orchestrationSelectors?.currentMissionState?.missionPhase || 'proposed',
      blockedReason: orchestrationSelectors?.blockageExplanation || 'none',
      providerSummary: orchestrationSelectors?.providerExecutionSummary || 'Provider status unavailable.',
      actionLadder: Array.isArray(orchestrationSelectors?.operatorActionLadder) ? orchestrationSelectors.operatorActionLadder : [],
    };
  }, [finalAgentView, finalRouteTruth?.routeKind, orchestrationSelectors?.blockageExplanation, orchestrationSelectors?.capabilityPosture, orchestrationSelectors?.currentMissionState?.intentSource, orchestrationSelectors?.currentMissionState?.missionPhase, orchestrationSelectors?.operatorActionLadder, orchestrationSelectors?.providerExecutionSummary]);
  const agentTaskSummary = useMemo(() => {
    const summary = agentTaskProjection?.readinessSummary || {};
    return {
      agentTaskLayerStatus: summary.agentTaskLayerStatus || 'unknown',
      codexReadiness: summary.codexReadiness || 'unknown',
      openClawReadiness: summary.openClawReadiness || 'unknown',
      nextAgentTaskAction: summary.nextAgentTaskAction || 'Build canonical Agent Task Model',
      blockers: Array.isArray(summary.agentTaskLayerBlockers) ? summary.agentTaskLayerBlockers : [],
      readinessScore: Number.isFinite(Number(summary.readinessScore)) ? Number(summary.readinessScore) : 0,
    };
  }, [agentTaskProjection]);

  const selectedMilestone = orderedMilestones.find((milestone) => milestone.id === uiState.selectedMilestoneId)
    || orderedMilestones[0]
    || null;

  useEffect(() => {
    if (!selectedMilestone) return;
    setEditorState({
      status: selectedMilestone.status,
      percentComplete: selectedMilestone.percentComplete,
      notes: selectedMilestone.notes,
      blockerFlag: selectedMilestone.blockerFlag,
      blockerDetails: selectedMilestone.blockerDetails,
      nextAction: selectedMilestone.nextAction,
    });
  }, [selectedMilestone?.id]);

  useEffect(() => {
    if (!selectedMilestone && orderedMilestones.length > 0) {
      setMissionDashboardUiState((prev) => ({
        ...prev,
        selectedMilestoneId: orderedMilestones[0].id,
      }));
    }
  }, [selectedMilestone, orderedMilestones, setMissionDashboardUiState]);

  async function persistDashboard(nextState) {
    const memory = memoryRef.current;
    if (!memory) {
      throw new Error('Mission dashboard memory not ready');
    }

    memory.saveRecord({
      namespace: MISSION_RECORD_NAMESPACE,
      id: MISSION_RECORD_ID,
      type: 'workspace.state',
      summary: 'Mission dashboard project progress',
      payload: { missionDashboard: nextState },
      tags: ['mission-dashboard', 'project-progress'],
      scope: 'runtime',
      importance: 'high',
    });

    console.info('[MISSION DASHBOARD] durable sync complete');
  }

  function handleSelectMilestone(milestoneId) {
    setMissionDashboardUiState((prev) => {
      const normalized = normalizeMissionDashboardUiState(prev);
      return {
        ...normalized,
        selectedMilestoneId: milestoneId,
        expandedMilestoneIds: normalized.expandedMilestoneIds.includes(milestoneId)
          ? normalized.expandedMilestoneIds
          : [...normalized.expandedMilestoneIds, milestoneId],
      };
    });
    console.info('[MISSION DASHBOARD] ui state restored', { selectedMilestoneId: milestoneId });
  }

  function handleToggleExpanded(milestoneId) {
    setMissionDashboardUiState((prev) => {
      const normalized = normalizeMissionDashboardUiState(prev);
      const expanded = normalized.expandedMilestoneIds.includes(milestoneId)
        ? normalized.expandedMilestoneIds.filter((id) => id !== milestoneId)
        : [...normalized.expandedMilestoneIds, milestoneId];
      return {
        ...normalized,
        expandedMilestoneIds: expanded,
      };
    });
  }

  async function handleSaveMilestone() {
    if (!selectedMilestone) {
      return;
    }

    setIsSaving(true);
    setFeedback({ tone: 'neutral', message: '' });

    try {
      const now = new Date().toISOString();
      const nextState = normalizeMissionDashboardState({
        ...dashboardState,
        overallSummary: {
          ...dashboardState.overallSummary,
          completionEstimate: metrics.overallProgress,
          lastUpdatedAt: now,
        },
        milestones: dashboardState.milestones.map((milestone, index) => {
          if (milestone.id !== selectedMilestone.id) {
            return milestone;
          }

          return normalizeMissionMilestone({
            ...milestone,
            status: editorState.status,
            percentComplete: editorState.percentComplete,
            notes: editorState.notes,
            blockerFlag: editorState.blockerFlag,
            blockerDetails: editorState.blockerDetails,
            nextAction: editorState.nextAction,
            updatedAt: now,
          }, index);
        }),
      });

      await persistDashboard(nextState);
      setDashboardState(nextState);
      setFeedback({ tone: 'success', message: 'Milestone saved.' });
      console.info('[MISSION DASHBOARD] milestone updated', { milestoneId: selectedMilestone.id });
    } catch (error) {
      setFeedback({ tone: 'error', message: 'Save failed.' });
      console.error('[MISSION DASHBOARD] save failed', error);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCopyMissionHandoff() {
    const handoffText = buildMissionHandoffText(dashboardState);
    console.info('[MISSION HANDOFF] generating summary');

    const copyResult = await writeTextToClipboard(handoffText, { navigatorObject: navigator });
    if (copyResult.ok) {
      setFeedback({ tone: 'success', message: 'Mission handoff copied.' });
      console.info('[MISSION HANDOFF] copied to clipboard');
      return;
    }

    try {
      console.warn('[MISSION HANDOFF] clipboard API unavailable, using fallback');
      setFallbackCopyText(handoffText);
      setFeedback({
        tone: 'warning',
        message: copyResult.reason === 'clipboard-unavailable'
          ? 'Clipboard unavailable, manual copy fallback opened.'
          : 'Copy failed. Manual copy fallback opened.',
      });
      console.info('[MISSION HANDOFF] manual copy fallback opened');
      console.info('[MISSION DASHBOARD] editor/fallback sheet opened');
    } catch (error) {
      console.warn('[MISSION HANDOFF] copy failed, using fallback', error);
      setFallbackCopyText(handoffText);
      setFeedback({ tone: 'warning', message: 'Copy failed. Manual copy fallback opened.' });
      console.info('[MISSION DASHBOARD] editor/fallback sheet opened');
    }
  }

  return (
    <CollapsiblePanel
      panelId="missionDashboardPanel"
      title="Mission Dashboard"
      description="Operator pane for project truth, milestone progress, and ChatGPT/Codex handoff export."
      className="mission-dashboard-panel"
      isOpen={uiLayout.missionDashboardPanel}
      onToggle={() => togglePanel('missionDashboardPanel')}
      actions={(
        <button type="button" className="ghost-button" onClick={handleCopyMissionHandoff}>
          Copy Mission Handoff
        </button>
      )}
    >
      <div className="mission-layout-mode" aria-live="polite">Layout mode: <strong>{layoutMode}</strong></div>
      <div className="mission-summary-strip">
        <span>Total: <strong>{metrics.totalMilestones}</strong></span>
        <span>In progress: <strong>{metrics.inProgressCount}</strong></span>
        <span>Blocked: <strong>{metrics.blockedCount}</strong></span>
        <span>Complete: <strong>{metrics.completeCount}</strong></span>
        <span>Overall: <strong>{metrics.overallProgress}%</strong></span>
      </div>
      <p className="mission-health-line">
        Health: <strong>{dashboardState.overallSummary.projectHealth}</strong> · Last updated: <strong>{formatTimestamp(metrics.lastUpdatedAt)}</strong>
      </p>
      <p className="mission-note">{dashboardState.overallSummary.missionNote}</p>
      <section className="mission-project-readiness" aria-label="Project progress and readiness">
        <header className="mission-project-readiness__header">
          <h3>Project Progress &amp; Readiness</h3>
          <span className="mission-score-chip">Readiness {projectProgressProjection.overallReadinessScore}%</span>
        </header>
        <p className="mission-note">
          Current phase: <strong>{projectProgressProjection.phase.label}</strong> · Verification: <strong>{projectProgressProjection.verificationStatus.status}</strong>
        </p>
        <div className="mission-summary-strip">
          <span>Agent readiness: <strong>{getProjectStatusLabel(projectProgressProjection.readiness.agent)}</strong></span>
          <span>Codex readiness: <strong>{getProjectStatusLabel(projectProgressProjection.readiness.codex)}</strong></span>
          <span>OpenClaw readiness: <strong>{getProjectStatusLabel(projectProgressProjection.readiness.openClaw)}</strong></span>
        </div>
        <div className="mission-readiness-lanes">
          {projectProgressProjection.lanes.map((lane) => (
            <article key={lane.id} className="mission-readiness-lane">
              <header className="mission-readiness-lane__header">
                <span className="mission-title">{lane.title}</span>
                <span className={`mission-status-chip mission-status-chip--readiness status-${lane.status}`}>{getProjectStatusLabel(lane.status)}</span>
              </header>
              <p className="mission-note">{lane.why || 'No adjudicated reason available.'}</p>
              {lane.blockers.length > 0 ? <p className="mission-note"><strong>Blocks:</strong> {lane.blockers.join(' · ')}</p> : null}
              {lane.lastMilestone ? <p className="mission-note"><strong>Recent:</strong> {lane.lastMilestone}</p> : null}
              {lane.evidence.length > 0 ? <p className="mission-note"><strong>Evidence:</strong> {lane.evidence.join(', ')}</p> : null}
            </article>
          ))}
        </div>
        <section className="mission-next-best-actions" aria-label="Next best actions">
          <h4>Next Best Actions</h4>
          <ol className="mission-recommendation-list">
            {projectProgressProjection.nextBestActions.map((action) => (
              <li key={action.id} className="mission-recommendation-card">
                <p><strong>{action.title}</strong></p>
                <p className="mission-note">Why this matters: {action.whyThisMatters}</p>
                <p className="mission-note">Reason: {action.reason}</p>
                <p className="mission-note">Blocks: {action.blocks.join(', ')}</p>
              </li>
            ))}
          </ol>
        </section>
        {projectProgressProjection.blockers.length > 0 ? (
          <section aria-label="Current blockers">
            <h4>Current blockers</h4>
            <ul className="compact-list">
              {projectProgressProjection.blockers.map((blocker) => <li key={blocker.id}><strong>{blocker.title}:</strong> {blocker.details.join(' · ')}</li>)}
            </ul>
          </section>
        ) : null}
        {projectProgressProjection.risks.length > 0 ? (
          <section aria-label="Current risks">
            <h4>Current risks</h4>
            <ul className="compact-list">
              {projectProgressProjection.risks.slice(0, 6).map((risk) => <li key={risk.id}><strong>{risk.title}:</strong> {risk.risk}</li>)}
            </ul>
          </section>
        ) : null}
        {projectProgressProjection.doctrineWarnings.length > 0 ? (
          <section aria-label="Doctrine alignment warnings" className="mission-dashboard__banner mission-dashboard__banner--warning">
            <h4>Doctrine alignment warnings</h4>
            <ul className="compact-list">
              {projectProgressProjection.doctrineWarnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </section>
        ) : null}
      </section>
      <section className="mission-live-projection" aria-label="Agent task layer summary">
        <h3>Agent Task Layer Summary</h3>
        <ul className="compact-list">
          <li>Agent layer state: {agentTaskSummary.agentTaskLayerStatus}</li>
          <li>Current recommended next action: {agentTaskSummary.nextAgentTaskAction}</li>
          <li>Codex handoff readiness: {agentTaskSummary.codexReadiness}</li>
          <li>OpenClaw control safety: {agentTaskSummary.openClawReadiness}</li>
          <li>Readiness score: {agentTaskSummary.readinessScore}%</li>
        </ul>
        {agentTaskSummary.blockers.length > 0 ? (
          <p className="mission-note"><strong>Agent layer blockers:</strong> {agentTaskSummary.blockers.join(' · ')}</p>
        ) : null}
      </section>

      <section className="mission-live-projection" aria-label="Live system projection">
        <h3>Live System Projection</h3>
        <p className="mission-note">
          Mode: <strong>{liveProjection.mode}</strong> · Local authority: <strong>{liveProjection.localAuthorityAvailable ? 'available' : 'unavailable'}</strong>
        </p>
        <p className="mission-note">{liveProjection.postureSummary}</p>
        <ul className="compact-list">
          <li>Acting agent: {liveProjection.actingAgent}</li>
          <li>Active goals: {liveProjection.activeGoals.length}</li>
          <li>Open tasks: {liveProjection.openTasks}</li>
          <li>Blocked items: {liveProjection.blockedItems.length}</li>
          <li>Route state: {liveProjection.routeState}</li>
          <li>Execution availability: {liveProjection.executionAvailability}</li>
          <li>Canonical intent: {liveProjection.canonicalIntentState}</li>
          <li>Mission packet state: {liveProjection.missionPacketState}</li>
          <li>Blockage reason: {liveProjection.blockedReason}</li>
          <li>Provider truth: {liveProjection.providerSummary}</li>
          <li>Pending approvals: {liveProjection.pendingApprovals}</li>
          <li>Resumable work: {liveProjection.resumableWork.length}</li>
          <li>Next recommended step: {orchestrationSelectors?.nextRecommendedAction || 'Review mission packet and choose explicit operator decision.'}</li>
        </ul>
        {liveProjection.actionLadder.length > 0 ? (
          <>
            <h4>Next-step ladder</h4>
            <ol className="compact-list">
              {liveProjection.actionLadder.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </>
        ) : null}
      </section>

      <label className="mission-filter-toggle paneFieldGroup">
        <input
          className="paneControl"
          type="checkbox"
          checked={uiState.showBlockedOnly}
          onChange={(event) => setMissionDashboardUiState((prev) => ({ ...normalizeMissionDashboardUiState(prev), showBlockedOnly: event.target.checked }))}
        />
        Show blocked only
      </label>

      {feedback.message ? <p className={`mission-feedback ${feedback.tone}`}>{feedback.message}</p> : null}

      {isHydrating ? <p className="muted">Hydrating mission dashboard…</p> : null}

      <div className="mission-milestone-grid">
        <div className="mission-milestone-list" role="list">
          {orderedMilestones.map((milestone) => {
            const expanded = uiState.expandedMilestoneIds.includes(milestone.id);
            const isSelected = selectedMilestone?.id === milestone.id;
            return (
              <article key={milestone.id} className={`mission-milestone-card ${isSelected ? 'selected' : ''}`}>
                <button type="button" className="mission-milestone-head" onClick={() => handleSelectMilestone(milestone.id)}>
                  <span className="mission-title">{milestone.title}</span>
                  <span className={`mission-status-chip status-${milestone.status}`}>{getMissionStatusLabel(milestone.status)}</span>
                </button>
                <div className="mission-progress-row">
                  <div className="mission-progress-track" aria-hidden="true">
                    <span className={`mission-progress-fill ${progressClassName(milestone.percentComplete)}`} style={{ width: `${milestone.percentComplete}%` }} />
                  </div>
                  <span>{milestone.percentComplete}%</span>
                  <span className="mission-blocker-indicator">{milestone.blockerFlag ? '⚠ blocker' : 'no blocker'}</span>
                </div>
                <button type="button" className="ghost-button mission-expand-button" onClick={() => handleToggleExpanded(milestone.id)}>
                  {expanded ? 'Hide details' : 'Show details'}
                </button>
                {expanded ? (
                  <div className="mission-details">
                    <p>{milestone.description || 'No description yet.'}</p>
                    <p><strong>Dependencies:</strong> {milestone.dependencies.length > 0 ? milestone.dependencies.join(', ') : 'none'}</p>
                    <p><strong>Linked systems/files:</strong> {milestone.linkedSystems.length > 0 ? milestone.linkedSystems.join(', ') : 'none'}</p>
                    <p><strong>Next action:</strong> {milestone.nextAction || 'unset'}</p>
                    <p><strong>Updated:</strong> {formatTimestamp(milestone.updatedAt)}</p>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>

        <section className="mission-editor-pane" aria-label="Mission milestone editor">
          <h3>{selectedMilestone ? `Edit: ${selectedMilestone.title}` : 'Select a milestone'}</h3>
          {selectedMilestone ? (
            <div className="paneFormLayout">
              <label className="paneFieldGroup">
                Status
                <select
                  className="paneSelect paneControl"
                  value={editorState.status}
                  onChange={(event) => setEditorState((prev) => ({ ...prev, status: event.target.value }))}
                >
                  {STATUS_VALUES.map((status) => <option key={status} value={status}>{getMissionStatusLabel(status)}</option>)}
                </select>
              </label>
              <label className="paneFieldGroup">
                Percent complete
                <input
                  className="paneInput paneControl"
                  type="number"
                  min={0}
                  max={100}
                  value={editorState.percentComplete}
                  onChange={(event) => setEditorState((prev) => ({ ...prev, percentComplete: Number(event.target.value) }))}
                />
              </label>
              <label className="paneFieldGroup">
                Next action
                <input
                  className="paneInput paneControl"
                  type="text"
                  value={editorState.nextAction}
                  onChange={(event) => setEditorState((prev) => ({ ...prev, nextAction: event.target.value }))}
                />
              </label>
              <label className="mission-inline-toggle paneFieldGroup">
                <input
                  className="paneControl"
                  type="checkbox"
                  checked={editorState.blockerFlag}
                  onChange={(event) => setEditorState((prev) => ({ ...prev, blockerFlag: event.target.checked }))}
                />
                Blocked
              </label>
              <label className="paneFieldGroup">
                Blocker details
                <textarea
                  className="paneTextarea paneControl"
                  rows={2}
                  value={editorState.blockerDetails}
                  onChange={(event) => setEditorState((prev) => ({ ...prev, blockerDetails: event.target.value }))}
                />
              </label>
              <label className="paneFieldGroup">
                Notes
                <textarea
                  className="paneTextarea paneControl"
                  rows={3}
                  value={editorState.notes}
                  onChange={(event) => setEditorState((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </label>
              <div className="mission-editor-actions">
                <button type="button" onClick={handleSaveMilestone} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save milestone'}</button>
              </div>
            </div>
          ) : (
            <p className="muted">No milestone selected.</p>
          )}
        </section>
      </div>

      {fallbackCopyText ? (
        <div className="mission-copy-fallback" role="dialog" aria-modal="true" aria-label="Manual mission handoff copy">
          <h3>Manual Copy Mission Handoff</h3>
          <p>Clipboard access is unavailable. Copy this text manually.</p>
          <textarea
            className="paneTextarea paneEditorRegion"
            value={fallbackCopyText}
            readOnly
            rows={14}
            onFocus={(event) => event.target.select()}
          />
          <button type="button" onClick={() => setFallbackCopyText('')}>Close</button>
        </div>
      ) : null}
    </CollapsiblePanel>
  );
}
