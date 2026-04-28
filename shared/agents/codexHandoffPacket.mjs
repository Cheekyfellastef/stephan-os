import { normalizeAgentTaskModel } from './agentTaskModel.mjs';

const MANUAL_PACKET_MODE = 'manual_prompt';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function collectRecommendedFiles(model) {
  const fromSignals = asArray(model.evidence?.sourceSignals)
    .filter((entry) => entry.includes('/') || entry.endsWith('.mjs') || entry.endsWith('.js') || entry.endsWith('.jsx'));
  const fromAllowed = asArray(model.taskConstraints?.allowedFiles).slice(0, 6);
  const combined = [...fromSignals, ...fromAllowed]
    .map((entry) => toText(entry))
    .filter(Boolean);
  return Array.from(new Set(combined)).slice(0, 10);
}

function determineReadiness({ model, approvalPending = [] } = {}) {
  const blockers = [];
  if (model.handoff.handoffMode !== MANUAL_PACKET_MODE) {
    blockers.push(`Handoff mode must be ${MANUAL_PACKET_MODE}.`);
  }
  if (model.handoff.handoffTarget !== 'codex') {
    blockers.push('Handoff target must be codex for Codex packet mode.');
  }
  if (model.agentReadiness.codex === 'unavailable' || model.agentReadiness.codex === 'blocked') {
    blockers.push(`Codex readiness is ${model.agentReadiness.codex}.`);
  }
  if (approvalPending.length > 0) {
    blockers.push(`Pending approval gates: ${approvalPending.join(', ')}.`);
  }
  if (!toText(model.taskIdentity.title)) {
    blockers.push('Task title is required.');
  }
  if (!toText(model.taskIdentity.operatorIntent)) {
    blockers.push('Operator intent is required.');
  }
  return {
    ready: blockers.length === 0,
    blockers,
  };
}

function renderList(lines = [], emptyFallback = '- none') {
  if (!Array.isArray(lines) || lines.length === 0) return emptyFallback;
  return lines.map((line) => `- ${line}`).join('\n');
}

function buildPacketText(packet) {
  return [
    '# Codex Manual Handoff Packet (v1)',
    '',
    `Mode: ${packet.mode}`,
    `Task Title: ${packet.taskTitle}`,
    `Operator Intent: ${packet.operatorIntent}`,
    `Task Type: ${packet.taskType}`,
    `Target Area: ${packet.targetArea}`,
    `Risk Level: ${packet.riskLevel}`,
    '',
    '## Recommended files to inspect',
    renderList(packet.recommendedFiles),
    '',
    '## Allowed files',
    renderList(packet.allowedFiles),
    '',
    '## Blocked files',
    renderList(packet.blockedFiles),
    '',
    '## Required checks',
    renderList(packet.requiredChecks),
    '',
    '## Approval gates',
    renderList(packet.approvalGates),
    '',
    '## Architecture doctrine reminders',
    renderList(packet.architectureReminders),
    '',
    '## Definition of done',
    renderList(packet.definitionOfDone),
    '',
    '## Verification commands',
    renderList(packet.verificationCommands),
    '',
    '## Expected report format',
    renderList(packet.expectedReportFormat),
    '',
    '## Mandatory safety instructions',
    renderList(packet.safetyInstructions),
    '',
    '## Operator notes',
    renderList(packet.operatorNotes),
  ].join('\n');
}

export function buildCodexHandoffPacket({ model = {}, approvalPending = [] } = {}) {
  const normalized = normalizeAgentTaskModel(model);
  const readiness = determineReadiness({ model: normalized, approvalPending });

  const packet = {
    version: 'v1',
    mode: MANUAL_PACKET_MODE,
    taskTitle: normalized.taskIdentity.title,
    operatorIntent: normalized.taskIdentity.operatorIntent,
    taskType: normalized.taskIdentity.taskType,
    targetArea: normalized.taskIdentity.targetArea,
    recommendedFiles: collectRecommendedFiles(normalized),
    allowedFiles: asArray(normalized.taskConstraints.allowedFiles),
    blockedFiles: asArray(normalized.taskConstraints.blockedFiles),
    requiredChecks: asArray(normalized.taskConstraints.requiredChecks),
    riskLevel: normalized.taskConstraints.riskLevel,
    approvalGates: asArray(normalized.approvalGates.required),
    architectureReminders: [
      'Agent Task Layer owns agent/task truth; do not invent canonical truth in UI.',
      'Mission Dashboard consumes Agent Task summary and does not own handoff logic.',
      'Keep runtime routing truth, project progress truth, and agent task truth separate.',
      'Dist output is never source of truth.',
      'Do not claim direct Codex adapter automation exists in manual mode.',
    ],
    definitionOfDone: [
      'Implement only the scoped task with doctrine-safe changes.',
      'Report all files changed and summarize why each change was needed.',
      'Provide test/build/verify command outcomes and any blockers.',
    ],
    expectedReportFormat: [
      'Root cause and approach summary',
      'Files changed with concise purpose per file',
      'Assumptions and confidence boundaries',
      'Regression risks and follow-up hardening ideas',
    ],
    verificationCommands: asArray(normalized.verification.verificationChecks),
    safetyInstructions: [
      'Do not commit secrets, tokens, credentials, or private keys.',
      'Do not bypass Stephanos doctrine, truth gates, or policy constraints.',
      'Do not claim unsupported automation modes (direct adapter/auto PR/auto issue).',
      'Explicitly report assumptions and unresolved unknowns.',
    ],
    operatorNotes: [
      toText(normalized.handoff.handoffPacketSummary, 'No additional operator notes.'),
    ],
    ready: readiness.ready,
    blockers: readiness.blockers,
  };

  return {
    ...packet,
    packetText: buildPacketText(packet),
    packetSummary: readiness.ready
      ? `Codex manual handoff packet ready for task \"${packet.taskTitle}\".`
      : `Codex manual handoff packet blocked: ${readiness.blockers.join(' ')}`,
    nextActionLabel: readiness.ready ? 'Copy packet to Codex' : 'Complete task scope first',
  };
}
