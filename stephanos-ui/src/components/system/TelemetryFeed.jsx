import { useMemo, useState } from 'react';
import CollapsiblePanel from '../CollapsiblePanel';
import { COPY_STATE, useClipboardButtonState } from '../../hooks/useClipboardButtonState';
import { writeTextToClipboard } from '../../utils/clipboardCopy';
import { useAIStore } from '../../state/aiStore';

const MISSION_TRACE_STEPS = Object.freeze([
  {
    id: 'intent-captured',
    headline: 'Intent captured',
    owner: 'Stephanos',
    nextAction: 'Confirm the objective and operating constraints.',
    patterns: [/intent/, /objective/, /operator request/, /prompt submitted/],
  },
  {
    id: 'structured-brief-created',
    headline: 'Structured brief created',
    owner: 'Stephanos',
    nextAction: 'Review mission packet framing before assignment.',
    patterns: [/brief/, /mission packet/, /structured/, /packet/],
  },
  {
    id: 'agent-selected',
    headline: 'Agent selected',
    owner: 'Agent',
    nextAction: 'Confirm selected agent role and execution scope.',
    patterns: [/agent selected/, /agent assignment/, /agent:/],
  },
  {
    id: 'plan-generated',
    headline: 'Plan generated',
    owner: 'Agent',
    nextAction: 'Validate plan steps against runtime truth boundaries.',
    patterns: [/plan/, /roadmap/, /execution steps/, /generated/],
  },
  {
    id: 'approval-requested',
    headline: 'Approval requested',
    owner: 'Human',
    nextAction: 'Approve, reject, or request a revision explicitly.',
    patterns: [/approval/, /awaiting-approval/, /operator approval/, /review required/],
  },
  {
    id: 'openclaw-action-prepared',
    headline: 'OpenClaw action prepared',
    owner: 'OpenClaw',
    nextAction: 'Confirm OpenClaw handoff payload and guardrails.',
    patterns: [/openclaw/, /handoff/, /ritual/, /merge console/],
  },
  {
    id: 'codex-execution-started',
    headline: 'Codex execution started',
    owner: 'Codex',
    nextAction: 'Track execution progress and surfaced diagnostics.',
    patterns: [/codex/, /execution started/, /apply patch/, /running/],
  },
  {
    id: 'diff-result-returned',
    headline: 'Diff/result returned',
    owner: 'Codex',
    nextAction: 'Review diff for intent alignment and truth safety.',
    patterns: [/diff/, /patch/, /result/, /response returned/],
  },
  {
    id: 'tests-verification-run',
    headline: 'Tests/verification run',
    owner: 'Codex',
    nextAction: 'Review verification output and unresolved warnings.',
    patterns: [/test/, /verification/, /verify/, /checks run/],
  },
  {
    id: 'completion-state',
    headline: 'Complete / blocked / needs revision',
    owner: 'Human',
    nextAction: 'Close mission or send explicit revision guidance.',
    patterns: [/complete/, /completed/, /blocked/, /needs revision/, /failed/],
  },
]);

const STATUS_CLASS_MAP = Object.freeze({
  pending: 'pending',
  active: 'active',
  passed: 'passed',
  failed: 'failed',
  blocked: 'blocked',
});

function asText(value) {
  return String(value || '').trim();
}

function parseStatusFromText(rawText = '') {
  const text = rawText.toLowerCase();
  if (!text) return '';
  if (/(\bblocked\b|awaiting human|waiting on operator|guarded)/.test(text)) return 'blocked';
  if (/(\bfailed\b|\berror\b|rejected|denied|timeout)/.test(text)) return 'failed';
  if (/(\bactive\b|\brunning\b|\bin-progress\b|\bpreparing\b|awaiting)/.test(text)) return 'active';
  if (/(\bpassed\b|\bsuccess\b|\bcomplete\b|\bcompleted\b|done)/.test(text)) return 'passed';
  return '';
}

function eventText(event = {}) {
  return [event.change, event.reason, event.impact, event.subsystem, event.label, event.event]
    .map((value) => asText(value).toLowerCase())
    .filter(Boolean)
    .join(' | ');
}

function projectMissionTrace(events = []) {
  return MISSION_TRACE_STEPS.map((step) => {
    const matched = [...events].reverse().find((event) => step.patterns.some((pattern) => pattern.test(eventText(event))));
    const matchedText = eventText(matched || {});
    const explicitStatus = asText(matched?.status).toLowerCase();
    const inferredStatus = explicitStatus || parseStatusFromText(matchedText) || (matched ? 'passed' : 'pending');
    const status = STATUS_CLASS_MAP[inferredStatus] || 'pending';
    const nextAction = asText(matched?.nextAction || matched?.nextRecommendedAction || step.nextAction);

    return {
      id: step.id,
      headline: step.headline,
      owner: asText(matched?.owner || step.owner),
      status,
      timestamp: asText(matched?.timestamp || '—'),
      evidence: asText(matched?.change || matched?.reason || matched?.impact || (status === 'pending' ? 'No trace evidence yet.' : 'Telemetry evidence available.')),
      details: asText(matched?.impact || matched?.reason || ''),
      nextAction,
    };
  });
}

function buildMissionTraceCopyText(traceEntries = [], { expanded = false, includeRawDebug = false, rawEvents = [] } = {}) {
  const lines = ['Mission Trace / Execution Telemetry'];
  traceEntries.forEach((entry, index) => {
    lines.push(`${index + 1}. [${entry.status}] ${entry.headline}`);
    lines.push(`   owner: ${entry.owner} | timestamp: ${entry.timestamp}`);
    lines.push(`   evidence: ${entry.evidence}`);
    if (expanded && entry.details) {
      lines.push(`   details: ${entry.details}`);
    }
    if (entry.nextAction) {
      lines.push(`   next: ${entry.nextAction}`);
    }
  });

  if (includeRawDebug && rawEvents.length > 0) {
    lines.push('');
    lines.push('Raw telemetry (debug mode)');
    lines.push(JSON.stringify(rawEvents, null, 2));
  }

  return lines.join('\n');
}

function describeCopyFailure(reason = '') {
  const normalized = String(reason || '').trim();
  if (normalized === 'clipboard-permission-denied') return 'Copy failed: clipboard permission denied in this runtime.';
  if (normalized === 'clipboard-unavailable') return 'Copy failed: clipboard unavailable in this runtime.';
  if (normalized === 'clipboard-aborted') return 'Copy failed: clipboard operation aborted. Try again.';
  return 'Copy failed: unable to write mission trace to clipboard.';
}

export default function TelemetryFeed({ runtimeStatusModel, telemetryEntries = [] }) {
  const [detailMode, setDetailMode] = useState('compact');
  const [copyNotice, setCopyNotice] = useState('');
  const { copyState, setCopyState } = useClipboardButtonState();
  const { uiLayout, togglePanel, devMode } = useAIStore();
  const finalRouteTruth = runtimeStatusModel?.finalRouteTruth ?? null;
  const events = Array.isArray(telemetryEntries) ? telemetryEntries : [];
  const traceEntries = useMemo(() => projectMissionTrace(events), [events]);
  const isExpanded = detailMode === 'expanded';
  const blockedOrFailed = traceEntries.some((entry) => entry.status === 'blocked' || entry.status === 'failed');

  const handleCopyTrace = async () => {
    const copyPayload = buildMissionTraceCopyText(traceEntries, {
      expanded: isExpanded,
      includeRawDebug: devMode === true,
      rawEvents: events,
    });

    const result = await writeTextToClipboard(copyPayload);
    if (result.ok) {
      setCopyState(COPY_STATE.SUCCESS);
      setCopyNotice('Mission trace copied.');
      return;
    }

    setCopyState(COPY_STATE.FAILURE);
    setCopyNotice(describeCopyFailure(result.reason));
  };

  const copyLabel = copyState === COPY_STATE.SUCCESS
    ? 'Copied'
    : copyState === COPY_STATE.FAILURE
      ? 'Copy failed'
      : 'Copy mission trace';

  return (
    <CollapsiblePanel
      as="aside"
      panelId="telemetryFeedPanel"
      title="Mission Trace / Execution Telemetry"
      description="Operator-visible Stephanos → Agent → OpenClaw → Codex execution chain."
      className="telemetry-feed-panel"
      isOpen={uiLayout.telemetryFeedPanel !== false}
      onToggle={() => togglePanel('telemetryFeedPanel')}
    >
      {!finalRouteTruth ? <p className="muted">No mission trace yet. Start by capturing an operator intent.</p> : null}

      {finalRouteTruth ? (
        <div className="telemetry-trace-shell">
          <div className="telemetry-trace-actions" data-no-drag>
            <button
              type="button"
              className={`ghost-button telemetry-trace-view-toggle ${isExpanded ? 'active' : ''}`}
              onClick={() => setDetailMode((mode) => (mode === 'compact' ? 'expanded' : 'compact'))}
              aria-label={isExpanded ? 'Switch to compact mission trace view' : 'Switch to expanded mission trace view'}
            >
              {isExpanded ? 'Expanded view' : 'Compact view'}
            </button>
            <button
              type="button"
              className={`ghost-button telemetry-trace-copy-button ${copyState}`}
              aria-label="Copy visible mission trace text"
              onClick={handleCopyTrace}
            >
              {copyLabel}
            </button>
          </div>

          {copyNotice ? (
            <p className={`telemetry-trace-copy-notice ${copyState === COPY_STATE.FAILURE ? 'failure' : 'ready'}`} role="status" aria-live="polite">
              {copyNotice}
            </p>
          ) : null}

          <ul className={`telemetry-trace-list ${isExpanded ? 'expanded' : 'compact'}`} aria-live="polite">
            {traceEntries.map((entry, index) => (
              <li key={entry.id} className={`telemetry-trace-entry ${entry.status}`}>
                <p className="telemetry-trace-headline">
                  <span className="telemetry-trace-step-index">{index + 1}.</span>
                  <span>{entry.headline}</span>
                </p>
                <p className="telemetry-trace-meta">
                  <span className={`telemetry-trace-status ${entry.status}`}>{entry.status}</span>
                  <span className="telemetry-trace-owner">{entry.owner}</span>
                  <span className="telemetry-trace-timestamp">{entry.timestamp}</span>
                </p>
                {isExpanded ? (
                  <>
                    <p className="telemetry-trace-detail"><strong>Evidence:</strong> {entry.evidence}</p>
                    {entry.details ? <p className="telemetry-trace-detail"><strong>Details:</strong> {entry.details}</p> : null}
                    {entry.nextAction ? <p className="telemetry-trace-detail"><strong>Next action:</strong> {entry.nextAction}</p> : null}
                  </>
                ) : null}
              </li>
            ))}
          </ul>

          {blockedOrFailed ? (
            <p className="telemetry-trace-blocked" role="status" aria-live="polite">
              Blocked/failure detected in mission trace. Follow the next recommended action on affected steps.
            </p>
          ) : null}

          {isExpanded && events.length > 0 ? (
            <>
              <h4 className="telemetry-feed-legacy-heading">Runtime transition feed</h4>
              <ul className="telemetry-feed-list" aria-live="polite">
                {events.map((event) => (
                  <li key={event.id} className="telemetry-feed-event">
                    <p className="telemetry-feed-primary">
                      <span className="telemetry-feed-time">{event.timestamp}</span>
                      <span className="telemetry-feed-subsystem">{event.subsystem}</span>
                      <span>{event.change}</span>
                    </p>
                    {event.reason ? <p className="telemetry-feed-detail">Reason: {event.reason}</p> : null}
                    {event.impact ? <p className="telemetry-feed-detail">Impact: {event.impact}</p> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </CollapsiblePanel>
  );
}
