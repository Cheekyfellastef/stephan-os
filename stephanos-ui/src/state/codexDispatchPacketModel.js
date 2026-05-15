const VERSION = 'codex-dispatch-packet.v1';

function asText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((item) => String(item)) : [];
}

export function buildCodexDispatchPacket(input = {}) {
  const operatorIntent = asText(input.operatorIntent || input.chatContextPack?.recommendedResponseMode, 'direct-answer');
  const uiTask = /\b(ui|pane|render|layout|button|console|collapse|arrange)\b/i.test(asText(input.operatorMessage));
  const targetSubsystems = asList(input.targetSubsystems?.length ? input.targetSubsystems : input.chatContextPack?.affectedSubsystems);
  const canonRules = asList(input.chatContextPack?.relevantCanon?.map((rule) => rule.text));
  const requiredTests = asList(input.requiredTests?.length ? input.requiredTests : ['node --test stephanos-ui/src/state/chatContextOrchestrator.test.mjs', 'node --test stephanos-ui/src/state/responsePlanner.test.mjs', 'npm run stephanos:verify']);
  const requiredProof = asList(input.requiredProof?.length ? input.requiredProof : ['Support Snapshot proof fields', uiTask ? 'Browser/UI Reality proof for visible UI work' : 'Proof fields present']);
  const forbiddenActions = asList(input.forbiddenActions?.length ? input.forbiddenActions : [
    'Do not auto-dispatch to Codex',
    'Do not auto-merge',
    'Do not bypass operator approval',
    'Do not hand-edit apps/stephanos/dist/**',
  ]);
  const expectedReportFields = asList(input.expectedReportFields?.length ? input.expectedReportFields : ['changed-files', 'tests-run', 'build-verify-result', 'proof-state', 'merge-gate']);
  const warnings = asList(input.warnings);
  const blockers = asList(input.blockers);
  const approvalRequired = input.approvalRequired !== false;
  const status = blockers.length > 0 ? 'blocked' : (approvalRequired ? 'ready-for-approval' : 'draft');
  const missionTitle = asText(input.missionTitle, 'Codex build/repair mission draft');
  return {
    version: VERSION,
    status,
    packetId: asText(input.packetId, `cdp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    createdAt: asText(input.createdAt, new Date().toISOString()),
    sourceCommandEnvelopeId: asText(input.sourceCommandEnvelopeId, 'unknown'),
    operatorIntent,
    missionTitle,
    missionClass: asText(input.missionClass, operatorIntent === 'codex-prompt' ? 'prompt-only' : 'dispatch-prep'),
    targetSubsystems,
    scope: asText(input.scope, 'bounded mission scope only'),
    forbiddenActions,
    canonRules,
    requiredTests,
    requiredProof,
    supportSnapshotFieldsRequired: asList(input.supportSnapshotFieldsRequired?.length ? input.supportSnapshotFieldsRequired : [
      'Codex Dispatch Packet Status','Codex Dispatch Packet ID','Codex Dispatch Mission Title','Codex Dispatch Target Subsystems','Codex Dispatch Approval Required','Codex Dispatch Approval State','Codex Dispatch Blocker Count','Codex Dispatch Warning Count','Codex Dispatch Prompt Available','Codex Dispatch Next Action',
    ]),
    browserProofRequired: uiTask,
    buildVerifyRequired: true,
    approvalRequired,
    approvalState: asText(input.approvalState, 'pending-operator-approval'),
    codexPrompt: asText(input.codexPrompt, 'Goal: Implement the bounded mission only. Use existing PR when open; otherwise create a new PR. Forbidden: no autonomous execution, no auto-merge, no dist hand edits. Run required tests + npm run stephanos:build + npm run stephanos:verify. Include Support Snapshot proof fields and UI Reality proof for visible UI changes. Report: changed files, tests, proof state, blockers, merge gate.'),
    expectedReportFields,
    warnings,
    blockers,
  };
}
