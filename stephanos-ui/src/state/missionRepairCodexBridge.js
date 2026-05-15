function asText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function asList(value) {
  return Array.isArray(value) ? value.map((item) => asText(item)).filter(Boolean) : [];
}

const REPAIR_STATUSES = new Set(['needs-repair', 'needs-proof', 'blocked']);

const DEFAULT_FORBIDDEN_ACTIONS = [
  'Do not touch unrelated systems',
  'Do not alter backend/provider routing unless required by the failing field',
  'Do not touch pane layout unless the failing field is pane/UI related',
  'Do not hand-edit apps/stephanos/dist/**',
  'Do not mark UI work complete without UI Reality/browser proof',
  'Do not create parallel truth systems',
  'Do not bypass operator approval',
  'Do not auto-dispatch to Codex',
  'Do not auto-create GitHub issues/PR comments',
  'Do not auto-merge',
];

export function buildMissionRepairCodexBridge(input = {}) {
  const missionRepairLoop = input.missionRepairLoop || {};
  const status = asText(missionRepairLoop.status, 'active');
  const shouldCreatePacket = REPAIR_STATUSES.has(status);
  const failingAcceptanceFields = asList(missionRepairLoop.failingAcceptanceFields);
  const proofFieldsRequired = asList(missionRepairLoop.proofFieldsRequired);
  const requiredTests = asList(missionRepairLoop.requiredProof);
  const supportSnapshotFieldsRequired = asList(input.supportSnapshotFieldsRequired?.length ? input.supportSnapshotFieldsRequired : [
    'Mission Repair Codex Bridge Status', 'Mission Repair Codex Bridge Packet Created', 'Mission Repair Codex Bridge Packet ID', 'Mission Repair Codex Bridge Reason', 'Mission Repair Codex Bridge Failing Fields', 'Mission Repair Codex Bridge Next Action',
    'Codex Dispatch Packet Status', 'Codex Dispatch Packet ID', 'Codex Dispatch Mission Title', 'Codex Dispatch Target Subsystems', 'Codex Dispatch Approval Required', 'Codex Dispatch Approval State', 'Codex Dispatch Prompt Available', 'Codex Dispatch Next Action',
  ]);
  if (!shouldCreatePacket) {
    return {
      version: 'mission-repair-codex-bridge.v1',
      status: 'not-required',
      packetCreated: false,
      packetId: 'none',
      reason: 'Mission Repair Loop status passed/active; no repair dispatch packet needed.',
      failingFields: failingAcceptanceFields,
      nextAction: 'No Codex repair packet required.',
      approvalRequired: true,
      dispatchState: 'not-ready',
      codexDispatchPacketDraft: null,
      supportSnapshotFieldsRequired,
    };
  }
  const missingProofFields = proofFieldsRequired.filter((field) => failingAcceptanceFields.includes(field) === false);
  const missionClass = status === 'needs-proof' ? 'proof' : status === 'blocked' ? 'validation' : 'repair';
  const targetSubsystems = asList(input.targetSubsystems?.length ? input.targetSubsystems : [missionRepairLoop.likelySubsystem || 'mission-repair-loop']);
  const requiredBuildVerifyCommands = asList(input.requiredBuildVerifyCommands?.length ? input.requiredBuildVerifyCommands : ['npm run stephanos:build', 'npm run stephanos:verify']);
  const prompt = [
    `Mission: ${asText(missionRepairLoop.title, 'Mission Repair Loop')} (${asText(missionRepairLoop.missionId, 'unknown-mission')})`,
    `Mission Class: ${missionClass}`,
    `Target Subsystems: ${targetSubsystems.join(' | ') || 'mission-repair-loop'}`,
    `Failing Acceptance Fields: ${failingAcceptanceFields.join(' | ') || 'none'}`,
    `Missing Proof Fields: ${missingProofFields.join(' | ') || 'none'}`,
    `Repair Boundary: ${asText(missionRepairLoop.repairBoundary, 'bounded patch only')}`,
    `Forbidden Actions: ${[...new Set([...DEFAULT_FORBIDDEN_ACTIONS, ...asList(missionRepairLoop.forbiddenActions)])].join(' | ')}`,
    `Required Tests: ${requiredTests.join(' | ') || 'none'}`,
    `Required Build/Verify Commands: ${requiredBuildVerifyCommands.join(' | ')}`,
    `Support Snapshot Required Fields: ${supportSnapshotFieldsRequired.join(' | ')}`,
    'Browser/UI Reality Proof: Required for visible UI changes and copy feedback proof.',
    'Source/Dist Truth Rules: source is truth; dist is generated output only; never hand-edit dist.',
    'Expected Codex Report Format: changed-files | tests-run | build-verify-result | support-snapshot-proof | blockers | merge-recommendation',
    `Merge Recommendation: ${asText(missionRepairLoop.mergeRecommendation, 'hold')}`,
    'Operator Approval Required: yes (draft only; no automatic dispatch).',
  ].join('\n');

  return {
    version: 'mission-repair-codex-bridge.v1',
    status: 'ready',
    packetCreated: true,
    packetId: asText(input.packetId, `cdp_bridge_${Date.now()}`),
    reason: `Mission Repair Loop status is ${status}; prepare Codex dispatch draft.` ,
    failingFields: failingAcceptanceFields,
    nextAction: 'Await operator approval before Codex handoff',
    approvalRequired: true,
    dispatchState: 'ready-for-approval',
    supportSnapshotFieldsRequired,
    codexDispatchPacketDraft: {
      missionTitle: asText(missionRepairLoop.title, 'Mission Repair Loop repair'),
      missionClass,
      targetSubsystems,
      failingAcceptanceFields,
      missingProofFields,
      requiredTests,
      requiredBuildVerifyCommands,
      forbiddenActions: [...new Set([...DEFAULT_FORBIDDEN_ACTIONS, ...asList(missionRepairLoop.forbiddenActions)])],
      supportSnapshotFieldsRequired,
      browserUiRealityProofRequired: true,
      operatorApprovalRequired: true,
      dispatchState: 'draft-only',
      codexPrompt: prompt,
      expectedReportFormat: 'changed-files | tests-run | build-verify-result | support-snapshot-proof | blockers | merge-recommendation',
    },
  };
}
