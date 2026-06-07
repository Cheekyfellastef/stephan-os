function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function stableSlug(value = '') {
  return asText(value, 'none')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'none';
}

function stablePacketId({ direction, target, kind, createdFrom, reason }) {
  return [
    'packet',
    stableSlug(direction),
    stableSlug(target),
    stableSlug(kind),
    stableSlug(createdFrom),
    stableSlug(reason).slice(0, 42),
  ].join('-');
}

function cleanCopyText(lines = []) {
  return lines
    .map((line) => asText(line, ''))
    .filter(Boolean)
    .join('\n')
    .replace(/<\s*(?:todo|insert|placeholder|your answer|response)[^>]*>/gi, '')
    .trim();
}

function normalizeKind(taskKind = '') {
  const normalized = asText(taskKind, 'research').toLowerCase();
  if (normalized.includes('browser')) return 'browser-proof';
  if (normalized.includes('cleanup')) return 'cleanup';
  if (normalized.includes('plan')) return 'build-plan';
  if (normalized.includes('verification') || normalized.includes('proof')) return 'proof';
  if (normalized.includes('repair') || normalized.includes('implementation')) return 'repair';
  if (normalized.includes('handoff')) return 'mission-handoff';
  return 'research';
}

function serializePacketPayload(value = {}) {
  if (!value || typeof value !== 'object') return asText(value, '');
  return cleanCopyText([JSON.stringify(value, null, 2)]);
}

function statusFromWorkbenchTarget({ target = '', workbench = {} } = {}) {
  const activeTarget = asText(workbench.activePacketTarget, '').toLowerCase();
  const activeType = asText(workbench.activePacketType, '').toLowerCase();
  const normalizedTarget = asText(target, '').toLowerCase();
  if (!activeTarget && !activeType) return 'ready-to-copy';
  if (normalizedTarget === 'local-ai' && (activeTarget === 'local-ai' || activeType.includes('local-ai'))) {
    return workbench.localAiReviewText || workbench.localAiRunnerRawResponse ? 'result-pasted' : 'awaiting-result';
  }
  if (normalizedTarget === 'openclaw' && (activeTarget === 'openclaw' || activeType.includes('openclaw'))) {
    return workbench.openClawResearchText || workbench.openClawPatchPlanText || workbench.openClawSourcePackOutput ? 'result-pasted' : 'awaiting-result';
  }
  return 'ready-to-copy';
}

function makePacket(input = {}) {
  const packet = {
    id: input.id || stablePacketId(input),
    title: asText(input.title, 'Mission packet'),
    direction: input.direction === 'inbox' ? 'inbox' : 'outbox',
    target: asText(input.target, 'operator'),
    kind: asText(input.kind, 'research'),
    status: asText(input.status, 'draft'),
    summary: asText(input.summary, 'Review mission packet.'),
    reason: asText(input.reason, 'Derived from current mission truth.'),
    requiredProof: asList(input.requiredProof),
    missingProof: asList(input.missingProof),
    approvalRequired: input.approvalRequired !== false,
    mutationAllowed: input.mutationAllowed === true,
    copyText: asText(input.copyText, ''),
    sourceTruths: asList(input.sourceTruths),
    createdFrom: asText(input.createdFrom, 'packet-bay-projection'),
    nextAction: asText(input.nextAction, 'Review packet and keep mutation locked.'),
    autoDispatchAllowed: input.autoDispatchAllowed === true,
  };
  return { ...packet, id: input.id || stablePacketId(packet) };
}

export function derivePacketBayProjection({ builderMeshProjection = {}, supportSnapshot = {}, missionBrainNextAction = {}, agentWorkRoutingProjection = {} } = {}) {
  const packets = [];
  const mesh = builderMeshProjection && typeof builderMeshProjection === 'object' ? builderMeshProjection : {};
  const workbench = mesh.builderWorkbenchProjection || {};
  const sourcePack = workbench.openClawSourcePackRunner || {};
  const requiredProof = Array.from(new Set([
    ...asList(mesh.requiredProof),
    ...asList(mesh.proofRequiredBeforeMerge),
    ...asList(agentWorkRoutingProjection.requiredProof),
  ])).slice(0, 12);
  const missingProof = Array.from(new Set([
    ...asList(mesh.missingProof),
    ...asList(missionBrainNextAction.openEvidenceGaps).map((gap) => gap?.label || gap?.requiredAction || gap).filter(Boolean),
  ])).slice(0, 12);
  const recommendedBuilder = asText(mesh.recommendedBuilder, 'hold');
  const nextAction = asText(mesh.nextBestAction || missionBrainNextAction.nextBestAction, 'No packets waiting. Review Builder Mesh for the next recommended route.');
  const sourceTruths = ['Builder Mesh projection', 'Operator Relief projection'];
  if (Object.keys(workbench).length) sourceTruths.push('Builder Workbench projection');

  if (recommendedBuilder === 'local-ai' && mesh.copyablePacketAvailable !== false) {
    packets.push(makePacket({
      title: 'Local AI read-only verification packet',
      direction: 'outbox',
      target: 'local-ai',
      kind: normalizeKind(mesh.taskKind || 'proof'),
      status: statusFromWorkbenchTarget({ target: 'local-ai', workbench }),
      summary: 'Ask local AI for bounded read-only verification findings; do not write files.',
      reason: asText(mesh.recommendedBuilderReason, 'Builder Mesh recommends local-ai read-only verification.'),
      requiredProof,
      missingProof,
      approvalRequired: true,
      mutationAllowed: false,
      copyText: cleanCopyText([
        'Stephanos Packet: Local AI read-only verification',
        `Mission summary: ${asText(mesh.copyPackets?.localAiReviewPacket?.missionSummary, 'Review current Stephanos mission truth.')}`,
        'Role: local-ai reviewer. Read-only verification only.',
        `Reason: ${asText(mesh.recommendedBuilderReason, 'Builder Mesh recommended local-ai verification.')}`,
        `Required proof: ${requiredProof.join(' | ') || 'targeted checks + support snapshot review'}`,
        `Missing proof: ${missingProof.join(' | ') || 'none reported'}`,
        'Mutation authority: locked',
        'Auto-dispatch: forbidden',
        `Next action: ${nextAction}`,
      ]),
      sourceTruths,
      createdFrom: 'builder-mesh-local-ai-recommendation',
      nextAction,
    }));
  }

  if (recommendedBuilder === 'codex' && mesh.copyablePacketAvailable !== false) {
    packets.push(makePacket({
      title: 'Codex fallback packet',
      direction: 'outbox',
      target: 'codex',
      kind: normalizeKind(mesh.taskKind || 'repair'),
      status: 'ready-to-copy',
      summary: 'Copy a bounded Codex packet only; do not auto-dispatch or auto-merge.',
      reason: asText(mesh.codexReason || mesh.recommendedBuilderReason, 'Codex fallback is available after operator approval.'),
      requiredProof,
      missingProof,
      approvalRequired: true,
      mutationAllowed: false,
      autoDispatchAllowed: false,
      copyText: cleanCopyText([
        'Stephanos Packet: Codex fallback',
        `Reason: ${asText(mesh.codexReason || mesh.recommendedBuilderReason, 'Codex fallback requested.')}`,
        'Operator approval required before mutation.',
        'Auto-dispatch: forbidden',
        'Auto-merge: forbidden',
        'Mutation authority: locked unless explicitly approved in a future approval system.',
        `Required proof: ${requiredProof.join(' | ') || 'targeted tests + build/verify + pr-clean'}`,
        `Missing proof: ${missingProof.join(' | ') || 'none reported'}`,
        `Next action: ${nextAction}`,
      ]),
      sourceTruths,
      createdFrom: 'builder-mesh-codex-recommendation',
      nextAction,
    }));
  }

  if (recommendedBuilder === 'openclaw' && mesh.copyablePacketAvailable !== false) {
    const sourcePackPacket = mesh.copyPackets?.openClawSourcePackPacket || mesh.copyPackets?.openClawResearchPacket || {};
    packets.push(makePacket({
      title: 'OpenClaw read-only Source Pack packet',
      direction: 'outbox',
      target: 'openclaw',
      kind: 'source-pack',
      status: statusFromWorkbenchTarget({ target: 'openclaw', workbench }),
      summary: 'Copy a read-only OpenClaw packet; route output back through Source Pack / Workbench judgment before trust.',
      reason: asText(mesh.recommendedBuilderReason, 'Builder Mesh recommends OpenClaw read-only source-pack routing.'),
      requiredProof: requiredProof.length ? requiredProof : ['source-pack-runner-judged', 'workspace-hygiene-clean'],
      missingProof,
      approvalRequired: true,
      mutationAllowed: false,
      autoDispatchAllowed: false,
      copyText: serializePacketPayload({
        packetType: sourcePackPacket.packetType || 'OpenClaw Source Pack Runner Packet',
        missionSummary: sourcePackPacket.missionSummary || 'Stephanos Builder Mesh read-only packet.',
        requestedOutput: sourcePackPacket.requestedOutput || 'Return bounded source-pack facts only. No mutation.',
        route: sourcePackPacket.route || 'stephanos-scout / llama3.2 CLI',
        model: sourcePackPacket.model || 'ollama/llama3.2:3b',
        mutationAuthority: 'locked',
        autoStart: 'forbidden',
        trustedForCanon: 'no until judged',
        nextAction,
      }),
      sourceTruths: [...sourceTruths, 'OpenClaw Source Pack Runner'],
      createdFrom: 'builder-mesh-openclaw-recommendation',
      nextAction,
    }));
  }

  if (recommendedBuilder === 'github-inspection' && mesh.copyablePacketAvailable !== false) {
    packets.push(makePacket({
      title: 'GitHub inspection packet',
      direction: 'outbox',
      target: 'github',
      kind: 'proof',
      status: 'ready-to-copy',
      summary: 'Copy a read-only GitHub inspection packet for PR/status/diff evidence; no merge action.',
      reason: asText(mesh.recommendedBuilderReason, 'Builder Mesh recommends GitHub read-only inspection.'),
      requiredProof,
      missingProof,
      approvalRequired: true,
      mutationAllowed: false,
      autoDispatchAllowed: false,
      copyText: serializePacketPayload(mesh.copyPackets?.githubInspectionPacket || {
        packetType: 'GitHub Inspection Packet',
        requestedOutput: 'Inspect PR/status/diff/evidence and report proof gaps only. No merge action.',
        mutationAuthority: 'locked',
        autoMerge: 'forbidden',
        nextAction,
      }),
      sourceTruths,
      createdFrom: 'builder-mesh-github-inspection-recommendation',
      nextAction,
    }));
  }

  if (recommendedBuilder === 'operator' && mesh.copyablePacketAvailable !== false) {
    packets.push(makePacket({
      title: 'Operator approval review packet',
      direction: 'inbox',
      target: 'operator',
      kind: 'build-plan',
      status: 'draft',
      summary: 'Operator review is the next gate before any packet can become mutation-authorized.',
      reason: asText(mesh.recommendedBuilderReason, 'Builder Mesh requires operator approval or clarification.'),
      requiredProof: requiredProof.length ? requiredProof : ['operator approval before mutation'],
      missingProof,
      approvalRequired: true,
      mutationAllowed: false,
      autoDispatchAllowed: false,
      copyText: serializePacketPayload(mesh.copyPackets?.operatorApprovalChecklist || {
        packetType: 'Operator Approval Checklist',
        checklist: ['Confirm mutation is necessary.', 'Confirm exact files/scope.', 'Require tests/build/verify/pr-clean and browser proof for UI claims.'],
        mutationAuthority: 'locked',
        nextAction,
      }),
      sourceTruths,
      createdFrom: 'builder-mesh-operator-review-recommendation',
      nextAction,
    }));
  }

  if (sourcePack.sourcePackStatus === 'needs-output') {
    packets.push(makePacket({
      title: 'Source Pack output needed',
      direction: 'inbox',
      target: 'operator',
      kind: 'source-pack',
      status: 'blocked',
      summary: 'Source Pack Runner needs OpenClaw output pasted before it can judge trust.',
      reason: asText(sourcePack.sourcePackReason, 'OpenClaw Source Pack Runner is waiting for output.'),
      requiredProof: ['Paste Source Pack text', 'Paste OpenClaw bounded output', 'Run Source Pack Intake Judgment'],
      missingProof: ['OpenClaw source-pack output'],
      approvalRequired: true,
      mutationAllowed: false,
      copyText: cleanCopyText([
        'Stephanos Packet: Source Pack operator next action',
        'Target: operator',
        'Paste the bounded OpenClaw Source Pack output into Builder Workbench Source Pack Runner.',
        'Run Source Pack Intake Judgment before routing any result into Builder Mesh.',
        'Mutation authority: locked',
        `Next action: ${asText(sourcePack.nextOperatorAction, 'Paste Source Pack output and run intake judgment.')}`,
      ]),
      sourceTruths: [...sourceTruths, 'OpenClaw Source Pack Runner'],
      createdFrom: 'openclaw-source-pack-runner-needs-output',
      nextAction: asText(sourcePack.nextOperatorAction, 'Paste Source Pack output and run intake judgment.'),
    }));
  }

  const inbox = packets.filter((packet) => packet.direction === 'inbox');
  const outbox = packets.filter((packet) => packet.direction === 'outbox');
  const ready = packets.filter((packet) => packet.status === 'ready-to-copy');
  const awaiting = packets.filter((packet) => packet.status === 'awaiting-result');
  const blocked = packets.filter((packet) => packet.status === 'blocked');
  const latestReady = ready[0] || null;
  const missingProofSummary = Array.from(new Set(packets.flatMap((packet) => packet.missingProof))).join(' | ') || 'none';

  return {
    packetBayStatus: packets.length ? 'active' : 'empty-clean',
    inbox,
    outbox,
    packets,
    counts: {
      inbox: inbox.length,
      outbox: outbox.length,
      readyToCopy: ready.length,
      awaitingResult: awaiting.length,
      blocked: blocked.length,
    },
    recommendedNextAction: packets[0]?.nextAction || nextAction,
    projectionSource: packets.length ? 'operator-relief-builder-mesh-source-truth-v1' : 'none',
    mutationAllowed: false,
    openClawMutationLocked: true,
    codexAutoDispatchAllowed: false,
    latestReadyTarget: latestReady?.target || 'none',
    latestReadyKind: latestReady?.kind || 'none',
    latestReadyId: latestReady?.id || 'none',
    missingProofSummary,
    sourceTruths: Array.from(new Set(packets.flatMap((packet) => packet.sourceTruths))),
    emptyState: `No packets waiting. Next recommended route: ${recommendedBuilder}. ${nextAction}`,
    supportSnapshotFields: {
      packet_bay_status: packets.length ? 'active' : 'empty-clean',
      packet_inbox_count: String(inbox.length),
      packet_outbox_count: String(outbox.length),
      packet_ready_to_copy_count: String(ready.length),
      packet_awaiting_result_count: String(awaiting.length),
      packet_blocked_count: String(blocked.length),
      packet_recommended_next_action: packets[0]?.nextAction || nextAction,
      packet_projection_source: packets.length ? 'operator-relief-builder-mesh-source-truth-v1' : 'none',
      packet_mutation_allowed: 'no',
      packet_openclaw_mutation_locked: 'yes',
      packet_codex_auto_dispatch_allowed: 'no',
      packet_latest_ready_target: latestReady?.target || 'none',
      packet_latest_ready_kind: latestReady?.kind || 'none',
      packet_latest_ready_id: latestReady?.id || 'none',
      packet_missing_proof_summary: missingProofSummary,
    },
  };
}
