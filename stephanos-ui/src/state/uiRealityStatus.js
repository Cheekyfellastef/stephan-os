export function deriveUiRealityStatus({ reality = null, startupStatus = null } = {}) {
  const hasReality = Boolean(reality && typeof reality === 'object');
  const paneShells = hasReality && Array.isArray(reality.paneShells) ? reality.paneShells.length : null;
  const missingCollapseControls = hasReality && Array.isArray(reality.panesMissingCollapseControls)
    ? reality.panesMissingCollapseControls.length
    : null;
  const orphanMoveControls = hasReality ? Number(reality.orphanMoveControlCount || 0) : null;
  const duplicateMoveControls = hasReality && Array.isArray(reality.moveControlGroups)
    ? Math.max(0, reality.moveControlGroups.length - Number(reality.totalFirstClassPanes || 0))
    : null;
  const missingMoveControls = hasReality && Array.isArray(reality.panesMissingMoveControls)
    ? reality.panesMissingMoveControls.length
    : null;
  const moveControlStatus = !hasReality
    ? 'missing'
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

  const failReasons = [];
  const warnReasons = [];
  if (!hasReality) warnReasons.push('ui-reality-unavailable');
  if (sourceDist === 'mismatch') failReasons.push('source-dist-mismatch');
  if (startup === 'error') failReasons.push('startup-error');
  if (orphanMoveControls > 0) failReasons.push('orphan-move-controls');
  if (duplicateMoveControls > 0) failReasons.push('duplicate-move-controls');
  if (missingCollapseControls > 0) failReasons.push('missing-collapse-controls');
  if (missingCollapseControls === null) warnReasons.push('collapse-coverage-unavailable');

  const severity = failReasons.length > 0 ? 'FAIL' : warnReasons.length > 0 ? 'WARN' : 'OK';

  return {
    severity,
    paneShells,
    missingCollapseControls,
    moveControlStatus,
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
  };
}
