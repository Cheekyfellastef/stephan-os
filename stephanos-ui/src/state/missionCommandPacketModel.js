function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value, fallback = []) {
  if (!Array.isArray(value)) return [...fallback];
  return value.map((entry) => asText(entry)).filter(Boolean);
}

function compactSummary({ status = 'unknown', count = 0, warnings = [], nextAction = 'not reported' } = {}) {
  return {
    status: asText(status, 'unknown'),
    count: Number.isFinite(Number(count)) ? Number(count) : 0,
    warningCount: asList(warnings).length,
    nextAction: asText(nextAction, 'not reported'),
  };
}

export function buildMissionCommandPacket(input = {}, { now = new Date() } = {}) {
  const missionSpec = input.missionSpec || {};
  const verificationJudge = input.verificationJudge || {};
  const missionEvidenceLedger = input.missionEvidenceLedger || {};
  const operatorDecisionConsole = input.operatorDecisionConsole || {};
  const taskFinisherPlan = input.taskFinisherPlan || {};
  const memoryLibrarianQueue = input.memoryLibrarianQueue || {};
  const prEvidenceIntake = input.prEvidenceIntake || {};
  const openClawDelegation = input.openClawDelegation || {};
  const finishAuthority = input.finishAuthority || {};
  const repoArchitectureContext = input.repoArchitectureContext || {};
  const codexPrompt = asText(input.codexPrompt || missionSpec.codexPrompt || missionSpec.codexHandoffPrompt);

  const blockedActions = asList(missionSpec?.approvalBoundary?.blockedActions, ['deploy', 'merge-without-operator-approval']);
  const allowedScope = asText(missionSpec.implementationScope, 'Scoped changes only; no autonomous execution.');
  const warnings = [
    ...asList(verificationJudge.warnings),
    ...asList(missionEvidenceLedger.warnings),
    ...asList(taskFinisherPlan.warnings),
  ];

  const packetId = `mission-command-packet-${asText(missionSpec.missionId, 'unknown')}-${now.getTime()}`;
  const packet = {
    packetId,
    packetVersion: 'v1',
    missionId: asText(missionSpec.missionId, 'unknown-mission'),
    createdAt: now.toISOString(),
    operatorIntent: asText(missionSpec.rawIntent, 'No operator intent supplied.'),
    missionTitle: asText(missionSpec.targetArea, 'Untitled mission'),
    missionStatus: asText(missionSpec.status, 'draft'),
    targetArea: asText(missionSpec.targetArea, 'unspecified-area'),
    currentStage: asText(taskFinisherPlan.planStatus || verificationJudge.readinessLevel, 'planning'),
    missionSummary: asText(missionSpec.summary, `Mission scoped to ${asText(missionSpec.targetArea, 'target area')}.`),
    missionSpecRef: asText(missionSpec.missionId, 'none'),
    safetyDoctrine: asList(missionSpec.doctrineConstraints, ['Operator is final authority.']),
    blockedActions,
    allowedScope,
    verificationContract: asList(missionSpec.verificationCommands, ['npm run stephanos:verify']),
    memoryContextSummary: compactSummary({ status: missionSpec?.missionMemoryContext?.status || 'available', count: missionSpec?.missionMemoryContext?.summary?.memoryCount || missionSpec?.missionMemoryContext?.memories?.length || 0, warnings: missionSpec?.missionMemoryContext?.warnings, nextAction: 'Review memory influence before implementation.' }),
    architectureContextSummary: compactSummary({ status: repoArchitectureContext.riskLevel || 'unknown', count: repoArchitectureContext.affectedSubsystems?.length || 0, warnings: repoArchitectureContext.warnings, nextAction: repoArchitectureContext.nextAction || 'Review impacted subsystems.' }),
    openClawDelegationSummary: compactSummary({ status: openClawDelegation.delegationStatus || 'not_configured', count: openClawDelegation.boundaries?.length || 0, warnings: openClawDelegation.warnings, nextAction: openClawDelegation.nextAction || 'Delegation preview only; no execution.' }),
    finishAuthoritySummary: compactSummary({ status: finishAuthority.finishAuthorityStatus || 'not_granted', count: finishAuthority.blockers?.length || 0, warnings: finishAuthority.warnings, nextAction: finishAuthority.nextAction || 'Await explicit operator authority.' }),
    prEvidenceSummary: compactSummary({ status: prEvidenceIntake.status || 'no_pr_evidence', count: prEvidenceIntake.changedFiles?.length || 0, warnings: prEvidenceIntake.warnings, nextAction: prEvidenceIntake.nextAction || 'Attach PR evidence artifacts.' }),
    verificationJudgeSummary: compactSummary({ status: verificationJudge.judgment || 'no_return', count: verificationJudge.blockers?.length || 0, warnings: verificationJudge.warnings, nextAction: verificationJudge.nextAction || 'Resolve verification blockers.' }),
    taskFinisherSummary: compactSummary({ status: taskFinisherPlan.planStatus || 'unknown', count: taskFinisherPlan.tasks?.length || 0, warnings: taskFinisherPlan.warnings, nextAction: taskFinisherPlan.nextAction || 'Complete remaining operator-approved tasks.' }),
    memoryLibrarianSummary: compactSummary({ status: memoryLibrarianQueue.queueStatus || 'idle', count: memoryLibrarianQueue.pendingCount || 0, warnings: memoryLibrarianQueue.conflicts, nextAction: memoryLibrarianQueue.nextAction || 'Await operator memory decisions.' }),
    evidenceLedgerSummary: compactSummary({ status: missionEvidenceLedger.completeness || 'unknown', count: missionEvidenceLedger.entries?.length || 0, warnings: missionEvidenceLedger.warnings, nextAction: missionEvidenceLedger.nextRequired || 'Collect missing evidence.' }),
    operatorDecisionSummary: compactSummary({ status: operatorDecisionConsole.status || 'pending', count: operatorDecisionConsole.pendingCount || operatorDecisionConsole.decisions?.length || 0, warnings: operatorDecisionConsole.warnings, nextAction: operatorDecisionConsole.nextAction || 'Resolve queued decisions.' }),
    codexHandoffText: asText(codexPrompt, 'No Codex handoff text available yet.'),
    exportWarnings: warnings,
    nextAction: asText(taskFinisherPlan.nextAction || verificationJudge.nextAction || missionEvidenceLedger.nextRequired, 'Await operator decision.'),
    operatorAuthorityStatement: 'Operator final authority required. No autonomous execution, shell execution, GitHub merge/write automation, OpenClaw execution, memory auto-promotion, file deletion, secrets access, or external account actions are authorized.',
  };
  return packet;
}

export function buildMissionCommandPacketJson(packet = {}) {
  return JSON.stringify(packet, null, 2);
}

export function buildMissionCommandPacketMarkdown(packet = {}) {
  const lines = [
    '# Mission Command Packet',
    '## Mission',
    `- Packet Version: ${asText(packet.packetVersion, 'v1')}`,
    `- Mission ID: ${asText(packet.missionId, 'unknown')}`,
    `- Status: ${asText(packet.missionStatus, 'draft')}`,
    `- Created At: ${asText(packet.createdAt, 'unknown')}`,
    `- Summary: ${asText(packet.missionSummary, 'n/a')}`,
    '## Operator Intent',
    asText(packet.operatorIntent, 'n/a'),
    '## Safety Doctrine',
    ...asList(packet.safetyDoctrine, ['n/a']).map((entry) => `- ${entry}`),
    '## Allowed Scope',
    asText(packet.allowedScope, 'n/a'),
    '## Blocked Actions',
    ...asList(packet.blockedActions, ['n/a']).map((entry) => `- ${entry}`),
    '## Memory Context',
    `- ${asText(packet.memoryContextSummary?.status, 'unknown')} (${packet.memoryContextSummary?.count || 0})`,
    '## Architecture Impact',
    `- ${asText(packet.architectureContextSummary?.status, 'unknown')} (${packet.architectureContextSummary?.count || 0})`,
    '## OpenClaw Delegation',
    `- ${asText(packet.openClawDelegationSummary?.status, 'unknown')}`,
    '## Finish Authority',
    `- ${asText(packet.finishAuthoritySummary?.status, 'unknown')}`,
    '## PR Evidence',
    `- ${asText(packet.prEvidenceSummary?.status, 'unknown')}`,
    '## Verification Judge',
    `- ${asText(packet.verificationJudgeSummary?.status, 'unknown')}`,
    '## Task Finisher',
    `- ${asText(packet.taskFinisherSummary?.status, 'unknown')}`,
    '## Memory Librarian',
    `- ${asText(packet.memoryLibrarianSummary?.status, 'unknown')}`,
    '## Evidence Ledger',
    `- ${asText(packet.evidenceLedgerSummary?.status, 'unknown')}`,
    '## Operator Decisions',
    `- ${asText(packet.operatorDecisionSummary?.status, 'unknown')}`,
    '## Codex Handoff',
    'This Mission Command Packet is the bounded context. Do not expand scope beyond it without returning a decision request.',
    asText(packet.codexHandoffText, 'n/a'),
    '## Next Action',
    asText(packet.nextAction, 'Await operator decision.'),
  ];
  return `${lines.join('\n')}\n`;
}
