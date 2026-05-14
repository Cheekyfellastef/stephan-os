import { deriveUiRealityStatus } from '../state/uiRealityStatus.js';

export default function UIRealityStatusPanel({ reality = null, startupStatus = null } = {}) {
  const status = deriveUiRealityStatus({ reality, startupStatus });
  return (
    <section className={`ui-reality-status-panel severity-${status.severity.toLowerCase()}`} data-testid="ui-reality-status">
      <p><strong>UI Reality: {status.severity}</strong></p>
      <p>Pane shells: {status.paneShells ?? 'unknown'} · Missing collapse controls: {status.missingCollapseControls ?? 'unknown'}</p>
      <p>Move controls: {status.moveControlStatus} · Orphan move controls: {status.orphanMoveControls ?? 'unknown'} · Duplicate move controls: {status.duplicateMoveControls ?? 'unknown'}</p>
      <p>Source/dist: {status.sourceDist} · Browser proof: {status.browserProof}</p>
      <p>Copy feedback: {status.copyFeedbackStatus} · Success: {status.copySuccessCount} · Failure: {status.copyFailureCount} · Green confirmed: {status.greenSuccessConfirmedCount}</p>
      <details>
        <summary>UI Reality details</summary>
        <ul>
          <li>Current URL/session: {status.url || 'unknown'}</li>
          <li>Pane layout status: {status.layoutStatus}</li>
          <li>Copy-button status: {status.copyButtonStatus}</li>
          <li>Agent Mission Console outer collapse: {status.agentMissionConsoleOuterCollapse}</li>
          <li>Last copy result/source: {status.lastCopyResult} / {status.lastCopySource}</li>
          <li>Copy buttons detected/canonical/non-canonical: {status.copyButtonsDetected ?? 'unknown'} / {status.canonicalCopyButtons} / {status.nonCanonicalCopyButtons}</li>
          <li>Copy feedback next action: {status.copyFeedbackNextAction}</li>
          <li>Startup/boot status: {status.startup}</li>
        </ul>
      </details>
    </section>
  );
}
