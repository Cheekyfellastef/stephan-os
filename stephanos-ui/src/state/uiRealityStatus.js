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

  const aiCoreMissionConsoleConfigured = hasReality && reality.aiCoreMissionConsole
    ? reality.aiCoreMissionConsole.configured === true
    : false;
  const aiCoreMissionConsoleRendered = hasReality && reality.aiCoreMissionConsole
    ? reality.aiCoreMissionConsole.rendered === true
    : false;
  const aiCoreMissionConsoleVisible = hasReality && reality.aiCoreMissionConsole
    ? reality.aiCoreMissionConsole.visible === true
    : false;
  const aiCoreMissionConsolePanelId = hasReality && reality.aiCoreMissionConsole
    ? String(reality.aiCoreMissionConsole.panelId || 'unknown')
    : 'unknown';
  const aiCoreMissionConsoleForceOpen = hasReality && reality.aiCoreMissionConsole
    ? reality.aiCoreMissionConsole.forceOpen === true
    : false;
  const dedicatedMissionConsoleRendered = hasReality && reality.dedicatedMissionConsole
    ? reality.dedicatedMissionConsole.rendered === true
    : false;
  const dedicatedMissionConsoleVisible = hasReality && reality.dedicatedMissionConsole
    ? reality.dedicatedMissionConsole.visible === true
    : false;
  const aiCoreRenderReason = hasReality && reality.aiCoreMissionConsole
    ? String(reality.aiCoreMissionConsole.renderReason || (aiCoreMissionConsoleRendered ? 'mounted-active-path' : 'not-mounted'))
    : 'unknown';
  const aiCoreVisibilityReason = hasReality && reality.aiCoreMissionConsole
    ? String(reality.aiCoreMissionConsole.visibilityReason || (aiCoreMissionConsoleVisible ? 'visible' : 'unknown'))
    : 'unknown';
  const dedicatedVisibilityReason = hasReality && reality.dedicatedMissionConsole
    ? String(reality.dedicatedMissionConsole.visibilityReason || (dedicatedMissionConsoleVisible ? 'visible' : 'unknown'))
    : 'unknown';
  const nestedOperationalPaneFacts = hasReality && Array.isArray(reality.agentMissionConsoleNestedOperationalPanes)
    ? reality.agentMissionConsoleNestedOperationalPanes.map(normalizePaneFact).filter(Boolean)
    : [];
  const nestedOperationalPaneIds = nestedOperationalPaneFacts.map((pane) => pane.paneId);
  const nestedOperationalPaneTitles = nestedOperationalPaneFacts.map((pane) => pane.title);
  const aiCoreDomParentPaneId = hasReality ? String(reality?.aiCoreMissionConsole?.domParentPaneId || 'unknown') : 'unknown';
  const aiCoreDomParentPaneTitle = hasReality ? String(reality?.aiCoreMissionConsole?.domParentPaneTitle || 'unknown') : 'unknown';
  const aiCoreInsideAgentMissionConsole = hasReality ? reality?.aiCoreMissionConsole?.insideAgentMissionConsole === true : false;
  const aiCoreDomAncestryPath = hasReality ? String(reality?.aiCoreMissionConsole?.domAncestryPath || 'unknown') : 'unknown';
  const aiCorePlacementReason = hasReality ? String(reality?.aiCoreMissionConsole?.placementReason || 'unknown') : 'unknown';
  const missionConsoleNesting = hasReality
    ? (aiCoreInsideAgentMissionConsole || aiCoreDomParentPaneId === 'missionConsolePanel')
      ? 'nested-in-agent-mission-console'
      : aiCoreMissionConsoleRendered && aiCoreDomParentPaneId === 'aiCoreMissionConsolePanel'
        ? 'first-class-pane'
        : aiCoreMissionConsoleRendered
          ? 'rendered-parent-unverified'
          : 'missing'
    : 'unknown';


  const paneTitleCounts = new Map();
  const paneShellFacts = hasReality && Array.isArray(reality.paneShells) ? reality.paneShells : [];
  const commandDeckPaneFact = paneShellFacts.find((pane) => String(pane?.panelId || '') === 'commandDeck')
    || null;
  const commandDeckPanePresent = Boolean(commandDeckPaneFact);
  const commandDeckPaneId = commandDeckPaneFact ? String(commandDeckPaneFact.panelId || 'unknown') : 'missing';
  const commandDeckPaneTitle = commandDeckPaneFact ? String(commandDeckPaneFact.title || commandDeckPaneId || 'unknown') : 'missing';
  const commandDeckPaneVisible = commandDeckPaneFact ? commandDeckPaneFact.bodyVisible !== false : false;
  const statePaneOrder = hasReality && Array.isArray(reality.renderedPaneOrder) ? reality.renderedPaneOrder : [];
  const domPaneOrder = hasReality && Array.isArray(reality.domPaneOrder) ? reality.domPaneOrder : [];
  const canonicalPaneOrder = domPaneOrder.length > 0 ? domPaneOrder : statePaneOrder;
  const canonicalPaneOrderSource = domPaneOrder.length > 0 ? 'dom-pane-shell-order' : 'rendered-pane-order-state';
  const commandDeckFoundInDomOrder = domPaneOrder.includes('commandDeck');
  const commandDeckFoundInStateOrder = statePaneOrder.includes('commandDeck');
  const commandDeckInPaneOrder = canonicalPaneOrder.includes('commandDeck');
  const commandDeckOrderDetectionSource = domPaneOrder.length > 0 ? 'dom-pane-shell-order' : 'rendered-pane-order-state';
  const commandDeckPaneIndex = canonicalPaneOrder.findIndex((paneId) => paneId === commandDeckPaneId);
  const commandDeckMoveTrace = hasReality && Array.isArray(reality.moveControlTrace)
    ? reality.moveControlTrace.find((trace) => String(trace?.paneId || '') === 'commandDeck') || null
    : null;
  const commandDeckMoveControlsVisible = Boolean(commandDeckMoveTrace?.visible);
  const commandDeckCanMoveUp = commandDeckMoveTrace?.canMoveUp === true;
  const commandDeckCanMoveDown = commandDeckMoveTrace?.canMoveDown === true;
  const commandDeckHasNeighbors = commandDeckPaneIndex > 0 || (commandDeckPaneIndex >= 0 && commandDeckPaneIndex < canonicalPaneOrder.length - 1);
  const commandDeckPlacementStatus = !hasReality
    ? 'WARN'
    : !commandDeckPanePresent
      ? 'FAIL'
      : (commandDeckPaneIndex >= 0 && commandDeckPaneIndex <= 3 && commandDeckPaneVisible)
        ? 'OK'
        : 'WARN';
  for (const pane of paneShellFacts) {
    const t = String(pane?.title || '').trim();
    if (!t) continue;
    paneTitleCounts.set(t, (paneTitleCounts.get(t) || 0) + 1);
  }
  const duplicatePaneTitles = [...paneTitleCounts.entries()].filter(([,count]) => count > 1).map(([title]) => title);
  const missionConsolePaneFacts = paneShellFacts.filter((pane) => ['aiCoreMissionConsolePanel','missionConsolePanel'].includes(String(pane?.panelId || '')));
  const missionConsolePaneIds = missionConsolePaneFacts.map((pane) => String(pane.panelId || 'unknown'));
  const missionConsolePaneTitles = missionConsolePaneFacts.map((pane) => String(pane.title || pane.panelId || 'unknown'));
  const missionConsoleDistinctTitles = new Set(missionConsolePaneTitles.filter(Boolean));
  const duplicateMissionConsoleTitleCount = missionConsolePaneTitles.length - missionConsoleDistinctTitles.size;
  const failReasons = [];
  const warnReasons = [];
  if (!hasReality) warnReasons.push('ui-reality-unavailable');
  if (sourceDist === 'mismatch') failReasons.push('source-dist-mismatch');
  if (startup === 'error') failReasons.push('startup-error');
  if (arrangeMode === 'on' && orphanMoveControls > 0) failReasons.push('orphan-move-controls');
  if (arrangeMode === 'on' && duplicateMoveControls > 0) failReasons.push('duplicate-move-controls');
  if (arrangeMode === 'on' && missingMoveControls > 0) failReasons.push('missing-move-controls');
  if (hasReality && commandDeckPanePresent && !commandDeckInPaneOrder) {
    failReasons.push(commandDeckFoundInDomOrder !== commandDeckFoundInStateOrder
      ? 'command-deck-pane-order-state-dom-mismatch'
      : 'command-deck-visible-missing-pane-order');
  }
  if (arrangeMode === 'on' && commandDeckPanePresent && commandDeckHasNeighbors && commandDeckMoveControlsVisible && !commandDeckCanMoveUp && !commandDeckCanMoveDown) failReasons.push('command-deck-move-controls-disabled-with-neighbors');
  if (missingCollapseControls > 0) failReasons.push('missing-collapse-controls');
  if (missingCollapseControls === null) warnReasons.push('collapse-coverage-unavailable');
  if (hasReality && (!aiCoreMissionConsoleRendered || !aiCoreMissionConsoleVisible)) failReasons.push('ai-core-mission-console-missing');
  if (hasReality && !dedicatedMissionConsoleRendered) failReasons.push('dedicated-mission-console-missing');
  const agentMissionConsoleBodyCollapses = hasReality && reality.agentMissionConsoleCollapse
    ? reality.agentMissionConsoleCollapse.bodyVisibleWhenCollapsed !== true
    : null;
  const deferredExtractionPaneIds = nestedOperationalPaneIds.filter((paneId) => paneId !== 'aiCoreMissionConsolePanel');
  const deferredExtractionPaneFacts = nestedOperationalPaneFacts.filter((pane) => pane.paneId !== 'aiCoreMissionConsolePanel');
  if (hasReality && (nestedOperationalPaneIds.includes('aiCoreMissionConsolePanel') || aiCoreInsideAgentMissionConsole || aiCoreDomParentPaneId === 'missionConsolePanel')) failReasons.push('ai-core-mission-console-nested-in-agent-mission-console');
  if (hasReality && deferredExtractionPaneIds.length > 0) warnReasons.push('deferred-operational-pane-extractions-pending');
  if (hasReality && agentMissionConsoleBodyCollapses === false) failReasons.push('agent-mission-console-collapse-body-visible');
  if (hasReality && duplicateMissionConsoleTitleCount > 0) failReasons.push('duplicate-mission-console-pane-titles');

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
    uiRealityAiCoreMissionConsoleConfigured: aiCoreMissionConsoleConfigured ? 'yes' : 'no',
    uiRealityAiCoreMissionConsoleRendered: aiCoreMissionConsoleRendered ? 'yes' : 'no',
    uiRealityAiCoreMissionConsoleVisible: aiCoreMissionConsoleVisible ? 'yes' : 'no',
    uiRealityAiCoreMissionConsolePanelId: aiCoreMissionConsolePanelId,
    uiRealityAiCoreMissionConsoleForceOpen: aiCoreMissionConsoleForceOpen ? 'yes' : 'no',
    uiRealityDedicatedMissionConsoleRendered: dedicatedMissionConsoleRendered ? 'yes' : 'no',
    uiRealityDedicatedMissionConsoleVisible: dedicatedMissionConsoleVisible ? 'yes' : 'no',
    uiRealityAiCoreMissionConsoleRenderReason: aiCoreRenderReason,
    uiRealityAiCoreMissionConsoleVisibilityReason: aiCoreVisibilityReason,
    uiRealityDedicatedMissionConsoleVisibilityReason: dedicatedVisibilityReason,
    uiRealityAiCoreActivePath: hasReality ? String(reality.aiCoreActivePath || 'unknown') : 'unknown',
    uiRealityAiCoreRenderedPaneOrderContainsAiConsole: hasReality ? (reality.renderedPaneOrderContainsAiConsole ? 'yes' : 'no') : 'unknown',
    uiRealityAiChatCommandDeckPresent: commandDeckPanePresent ? 'yes' : 'no',
    uiRealityAiChatCommandDeckPaneId: commandDeckPaneId,
    uiRealityAiChatCommandDeckPaneTitle: commandDeckPaneTitle,
    uiRealityAiChatCommandDeckVisible: commandDeckPaneVisible ? 'yes' : 'no',
    uiRealityAiChatCommandDeckOrderKey: 'commandDeck',
    uiRealityAiChatCommandDeckInPaneOrder: commandDeckInPaneOrder ? 'yes' : 'no',
    uiRealityRenderedPaneOrder: canonicalPaneOrder,
    uiRealityCanonicalPaneOrderSource: canonicalPaneOrderSource,
    uiRealityCommandDeckOrderDetectionSource: commandDeckOrderDetectionSource,
    uiRealityAiChatCommandDeckFoundInDomOrder: commandDeckFoundInDomOrder ? 'yes' : 'no',
    uiRealityAiChatCommandDeckFoundInStateOrder: commandDeckFoundInStateOrder ? 'yes' : 'no',
    uiRealityAiChatCommandDeckMoveControlsVisible: commandDeckMoveControlsVisible ? 'yes' : 'no',
    uiRealityAiChatCommandDeckCanMoveUp: commandDeckCanMoveUp ? 'yes' : 'no',
    uiRealityAiChatCommandDeckCanMoveDown: commandDeckCanMoveDown ? 'yes' : 'no',
    uiRealityAiChatCommandDeckLastMoveResult: hasReality ? String(reality?.lastPaneMoveResult || 'unknown') : 'unknown',
    uiRealityAiChatCommandDeckMoveStatus: !hasReality
      ? 'UNKNOWN'
      : (!commandDeckPanePresent || !commandDeckInPaneOrder || (arrangeMode === 'on' && commandDeckHasNeighbors && commandDeckMoveControlsVisible && !commandDeckCanMoveUp && !commandDeckCanMoveDown))
        ? 'FAIL'
        : 'OK',
    uiRealityAiChatCommandDeckPlacementStatus: commandDeckPlacementStatus,
    uiRealityAiChatCommandDeckNextAction: !hasReality
      ? 'Capture UI reality diagnostics to validate command deck pane placement.'
      : !commandDeckPanePresent
        ? 'Restore first-class command deck pane mount using canonical AI console surface.'
        : !commandDeckInPaneOrder
          ? 'Register commandDeck in canonical pane order and reconcile persisted pane order.'
        : commandDeckPlacementStatus === 'OK'
          ? 'No operator action required.'
          : 'Move command deck pane near the top of pane order and keep it open by default.',
    uiRealityMissionConsoleMultiSurfaceStatus: !hasReality
      ? 'WARN'
      : (aiCoreMissionConsoleRendered && aiCoreMissionConsoleVisible && dedicatedMissionConsoleRendered ? 'OK' : 'FAIL'),
    uiRealityDuplicatePaneTitleCount: duplicatePaneTitles.length,
    uiRealityDuplicatePaneTitles: duplicatePaneTitles,
    uiRealityDuplicateMissionConsoleTitleCount: duplicateMissionConsoleTitleCount,
    uiRealityMissionConsolePaneIds: missionConsolePaneIds,
    uiRealityMissionConsolePaneTitles: missionConsolePaneTitles,
    uiRealityMissionConsoleIdentityStatus: !hasReality ? 'WARN' : (duplicateMissionConsoleTitleCount > 0 ? 'FAIL' : 'OK'),
    uiRealityMissionConsoleIdentityNextAction: !hasReality
      ? 'Capture UI reality diagnostics to validate mission console pane identity.'
      : (duplicateMissionConsoleTitleCount > 0
        ? 'Assign distinct human-readable titles to aiCoreMissionConsolePanel and missionConsolePanel.'
        : 'No operator action required.'),
    uiRealityMissionConsoleNextAction: !hasReality
      ? 'Capture UI reality diagnostics to validate Mission Console multi-surface mount.'
      : (aiCoreMissionConsoleRendered && aiCoreMissionConsoleVisible && dedicatedMissionConsoleRendered
        ? 'No operator action required.'
        : 'Restore missing Mission Console surface via canonical MissionConsoleTile mount path.'),
    uiRealityAgentMissionConsoleNestedOperationalPaneCount: nestedOperationalPaneIds.length,
    uiRealityAgentMissionConsoleNestedOperationalPaneIds: nestedOperationalPaneIds,
    uiRealityAgentMissionConsoleNestedOperationalPaneTitles: nestedOperationalPaneTitles,
    uiRealityAgentMissionConsoleBodyCollapses: agentMissionConsoleBodyCollapses === null ? 'unknown' : (agentMissionConsoleBodyCollapses ? 'yes' : 'no'),
    uiRealityAgentMissionConsoleCollapseStatus: agentMissionConsoleBodyCollapses === false ? 'FAIL' : 'OK',
    uiRealityAiCoreMissionConsoleDomParentPaneId: aiCoreDomParentPaneId,
    uiRealityAiCoreMissionConsoleDomParentPaneTitle: aiCoreDomParentPaneTitle,
    uiRealityAiCoreMissionConsoleInsideAgentMissionConsole: aiCoreInsideAgentMissionConsole ? 'yes' : 'no',
    uiRealityAiCoreMissionConsoleDomAncestryPath: aiCoreDomAncestryPath,
    uiRealityAiCoreMissionConsolePlacementReason: aiCorePlacementReason,
    uiRealityAiCoreMissionConsoleNesting: missionConsoleNesting,
    uiRealityOperationalPanePlacementStatus: !hasReality
      ? 'WARN'
      : (missionConsoleNesting !== 'first-class-pane' || agentMissionConsoleBodyCollapses === false
        ? 'FAIL'
        : deferredExtractionPaneIds.length > 0
          ? 'NEEDS-FOLLOWUP'
          : 'OK'),
    uiRealityOperationalPanePlacementNextAction: !hasReality
      ? 'Capture UI reality diagnostics to validate operational pane placement.'
      : (missionConsoleNesting !== 'first-class-pane' || agentMissionConsoleBodyCollapses === false
        ? 'Extract aiCoreMissionConsolePanel into a first-class pane and restore Agent Mission Console body collapse boundaries.'
        : deferredExtractionPaneIds.length > 0
          ? 'Proceed with Stage 2B to extract deferred operational panes while preserving canonical tile identity and collapse truth.'
          : 'No operator action required.'),
    uiRealitySuggestedExtractionPlan: deferredExtractionPaneIds.length > 0
      ? `Extract in order: ${deferredExtractionPaneIds.join(' -> ')}.`
      : 'No extraction required.',
    uiRealityDeferredExtractionPaneIds: deferredExtractionPaneIds,
    uiRealityDeferredExtractionPaneTitles: deferredExtractionPaneFacts.map((pane) => pane.title),
    uiRealityDeferredExtractionNextAction: !hasReality
      ? 'Capture UI reality diagnostics to identify deferred extraction candidates.'
      : (deferredExtractionPaneIds.length > 0
        ? 'Stage 2B: extract remaining deferred operational panes from Agent Mission Console.'
        : 'No deferred extraction panes pending.'),
    uiRealityStateDomMismatch: hasReality && reality.stateDomMismatch === true ? 'yes' : 'no',
    uiRealityMismatchReason: hasReality ? String(reality.stateDomMismatchReason || 'none') : 'none',
    ...copyFeedback,
  };
}
