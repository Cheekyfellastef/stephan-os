function normalizePaneFact(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return { paneId: entry, title: entry };
  if (typeof entry !== 'object') return null;
  const paneId = String(entry.paneId || entry.id || '').trim();
  if (!paneId) return null;
  const title = String(entry.title || paneId).trim() || paneId;
  return { paneId, title };
}

function deriveCopyFeedbackStatus(reality, hasReality) {
  const copyEvents = hasReality && Array.isArray(reality.copyEvents) ? reality.copyEvents : [];
  const lastCopyEvent = hasReality ? reality.lastCopyEvent || copyEvents.at(-1) || null : null;
  const successes = copyEvents.filter((event) => event?.ok === true).length;
  const failures = copyEvents.filter((event) => event?.ok !== true).length;
  const greenConfirmedCount = copyEvents.filter((event) => event?.ok === true && event?.greenConfirmed === true).length;
  const copyButtonsDetected = hasReality && Array.isArray(reality.copyButtons) ? reality.copyButtons.length : null;
  const canonicalSources = hasReality && Array.isArray(reality.canonicalCopyControls) ? reality.canonicalCopyControls : [];
  const observedSources = [...new Set(copyEvents.map((event) => String(event?.source || '').trim()).filter(Boolean))];
  const nonCanonicalSources = observedSources.filter((source) => !canonicalSources.includes(source));
  const diagnosticsAvailable = hasReality && (Array.isArray(reality.copyButtons) || copyEvents.length > 0 || canonicalSources.length > 0);
  let status = 'UNKNOWN';
  let nextAction = 'Capture copy diagnostics.';
  if (!hasReality || !diagnosticsAvailable) {
    status = hasReality ? 'WARN' : 'UNKNOWN';
    nextAction = 'Refresh UI reality and run a copy action to populate diagnostics.';
  } else if (nonCanonicalSources.length > 0) {
    status = 'WARN';
    nextAction = `Align non-canonical copy sources: ${nonCanonicalSources.join(', ')}.`;
  } else if (failures > 0 && successes === 0) {
    status = 'FAIL';
    nextAction = 'Investigate clipboard failure path and retry copy.';
  } else if (copyButtonsDetected > 0 && copyEvents.length === 0) {
    status = 'WARN';
    nextAction = 'Perform a canonical copy action to validate blue-to-green success feedback.';
  } else {
    status = 'OK';
    nextAction = 'No operator action required.';
  }
  return {
    copyFeedbackStatus: status,
    copySuccessCount: successes,
    copyFailureCount: failures,
    lastCopyResult: lastCopyEvent ? (lastCopyEvent.ok === true ? 'success' : 'failure') : 'none',
    lastCopySource: lastCopyEvent?.source || 'none',
    greenSuccessConfirmedCount: greenConfirmedCount,
    copyButtonsDetected,
    canonicalCopyButtons: canonicalSources.length,
    nonCanonicalCopyButtons: nonCanonicalSources.length,
    nonCanonicalCopySources: nonCanonicalSources,
    copyFeedbackNextAction: nextAction,
  };
}

export function deriveUiRealityStatus({ reality = null, startupStatus = null } = {}) {
  const hasReality = Boolean(reality && typeof reality === 'object');
  const paneShells = hasReality && Array.isArray(reality.paneShells) ? reality.paneShells.length : null;
  const missingCollapsePaneFacts = hasReality && Array.isArray(reality.panesMissingCollapseControls)
    ? reality.panesMissingCollapseControls.map(normalizePaneFact).filter(Boolean)
    : [];
  const missingCollapseControls = hasReality ? missingCollapsePaneFacts.length : null;
  const orphanMoveControls = hasReality ? Number(reality.orphanMoveControlCount || 0) : null;
  const duplicateMoveControls = hasReality && Array.isArray(reality.moveControlGroups)
    ? Math.max(0, reality.moveControlGroups.length - Number(reality.totalFirstClassPanes || 0))
    : null;
  const missingMovePaneFacts = hasReality && Array.isArray(reality.panesMissingMoveControls)
    ? reality.panesMissingMoveControls.map(normalizePaneFact).filter(Boolean)
    : [];
  const missingMoveControls = hasReality ? missingMovePaneFacts.length : null;
  const arrangeMode = !hasReality
    ? 'unknown'
    : typeof reality.arrangeMode === 'boolean'
      ? (reality.arrangeMode ? 'on' : 'off')
      : 'on';
  const moveControlDetailState = !hasReality
    ? 'unavailable'
    : String(reality.moveControlDetailState || '').trim()
      || (missingMoveControls > 0 ? 'missing' : Number(reality.totalMoveControlsVisible || 0) > 0 ? 'visible' : 'intentionally-hidden');
  const moveControlStatus = !hasReality
    ? 'missing'
    : arrangeMode === 'off'
      ? 'intentionally-hidden'
      : orphanMoveControls > 0
      ? 'orphaned'
      : missingMoveControls > 0
        ? 'missing'
        : Number(reality.totalMoveControlsVisible || 0) > 0
          ? 'visible'
          : 'hidden';

  const metadata = hasReality ? reality.metadata || {} : {};
  const sourceDist = metadata?.sourceDistAlignment
    || (metadata?.sourceFingerprint && metadata?.buildRuntimeMarker ? 'aligned' : 'unknown');
  const startup = startupStatus || metadata?.startupStatus || 'unknown';
  const copyButtonStatus = hasReality && Array.isArray(reality.copyButtons)
    ? (reality.copyButtons.length > 0 ? 'available' : 'unavailable')
    : 'unavailable';
  const browserProof = hasReality ? 'available' : 'needs operator proof';

  const aiCoreMissionConsolePresent = hasReality && reality.aiCoreMissionConsole
    ? reality.aiCoreMissionConsole.present === true
    : false;
  const aiCoreMissionConsolePanelId = hasReality && reality.aiCoreMissionConsole
    ? String(reality.aiCoreMissionConsole.panelId || 'unknown')
    : 'unknown';
  const aiCoreMissionConsoleForceOpen = hasReality && reality.aiCoreMissionConsole
    ? reality.aiCoreMissionConsole.forceOpen === true
    : false;
  const dedicatedMissionConsolePresent = hasReality && reality.dedicatedMissionConsole
    ? reality.dedicatedMissionConsole.present === true
    : (hasReality ? Boolean(reality.agentMissionConsoleOuter) : false);

  const failReasons = [];
  const warnReasons = [];
  if (!hasReality) warnReasons.push('ui-reality-unavailable');
  if (sourceDist === 'mismatch') failReasons.push('source-dist-mismatch');
  if (startup === 'error') failReasons.push('startup-error');
  if (arrangeMode === 'on' && orphanMoveControls > 0) failReasons.push('orphan-move-controls');
  if (arrangeMode === 'on' && duplicateMoveControls > 0) failReasons.push('duplicate-move-controls');
  if (arrangeMode === 'on' && missingMoveControls > 0) failReasons.push('missing-move-controls');
  if (missingCollapseControls > 0) failReasons.push('missing-collapse-controls');
  if (missingCollapseControls === null) warnReasons.push('collapse-coverage-unavailable');
  if (hasReality && !aiCoreMissionConsolePresent) failReasons.push('ai-core-mission-console-missing');
  if (hasReality && !dedicatedMissionConsolePresent) failReasons.push('dedicated-mission-console-missing');

  const severity = failReasons.length > 0 ? 'FAIL' : warnReasons.length > 0 ? 'WARN' : 'OK';
  const copyFeedback = deriveCopyFeedbackStatus(reality, hasReality);

  return {
    severity,
    paneShells,
    missingCollapseControls,
    missingCollapseControlIds: missingCollapsePaneFacts.map((pane) => pane.paneId),
    missingCollapseControlTitles: missingCollapsePaneFacts.map((pane) => pane.title),
    moveControlStatus,
    moveControlDetailState,
    arrangeMode,
    totalMoveControlsVisible: hasReality ? Number(reality.totalMoveControlsVisible || 0) : null,
    panesMissingMoveControls: missingMovePaneFacts.map((pane) => pane.paneId),
    orphanMoveControls,
    duplicateMoveControls,
    sourceDist: sourceDist || 'unknown',
    browserProof,
    copyButtonStatus,
    startup,
    agentMissionConsoleOuterCollapse: hasReality && reality.agentMissionConsoleOuter
      ? (reality.agentMissionConsoleOuter.bodyVisible === false ? 'collapsed' : 'expanded')
      : 'unknown',
    layoutStatus: hasReality && reality.layout ? 'available' : 'unknown',
    failReasons,
    warnReasons,
    url: hasReality ? reality.url || null : null,
    metadata,
    uiRealityAiCoreMissionConsolePresent: aiCoreMissionConsolePresent ? 'yes' : 'no',
    uiRealityAiCoreMissionConsolePanelId: aiCoreMissionConsolePanelId,
    uiRealityAiCoreMissionConsoleForceOpen: aiCoreMissionConsoleForceOpen ? 'yes' : 'no',
    uiRealityDedicatedMissionConsolePresent: dedicatedMissionConsolePresent ? 'yes' : 'no',
    uiRealityMissionConsoleMultiSurfaceStatus: !hasReality
      ? 'WARN'
      : (aiCoreMissionConsolePresent && dedicatedMissionConsolePresent ? 'OK' : 'FAIL'),
    uiRealityMissionConsoleNextAction: !hasReality
      ? 'Capture UI reality diagnostics to validate Mission Console multi-surface mount.'
      : (aiCoreMissionConsolePresent && dedicatedMissionConsolePresent
        ? 'No operator action required.'
        : 'Restore missing Mission Console surface via canonical MissionConsoleTile mount path.'),
    ...copyFeedback,
  };
}
