import { normalizeProposalPacket } from '../../../shared/ai/proposalPacketContract.mjs';

const DEFAULT_TEMPLATE = Object.freeze({
  conciseObjective: 'Translate the recommended move into a bounded implementation brief with explicit truth contracts.',
  whyNow: 'Mission synthesis ranked this move highest for current system leverage and readiness.',
  expectedOperatorValue: 'Operator receives a deterministic build brief with no hidden execution escalation.',
  implementationApproach: 'Apply minimal, contract-preserving edits in source truth modules, then project fields to UI/support surfaces.',
  likelyAffectedSubsystems: ['contextAssembly', 'missionSynthesis', 'statusPanel', 'supportSnapshot', 'execution metadata normalization'],
  likelyAffectedFiles: ['stephanos-ui/src/ai/**', 'shared/ai/**', 'stephanos-ui/src/state/**', 'stephanos-ui/src/components/**'],
  dependencyNotes: ['Preserve mission synthesis ranking as upstream truth.', 'Preserve runtime/freshness/provider truth boundaries.'],
  requiredTests: ['targeted deterministic unit tests for translation', 'status projection render tests', 'support snapshot projection tests'],
  nodeCheckTargets: ['node --check stephanos-ui/src/ai/proposalPacket.js'],
  guardrailChecks: ['import guard checks', 'stale-process reuse guard tests'],
  runtimeValidationHints: ['Confirm proposal packet remains advisory and execution_eligible stays false.', 'Confirm copy payload is operator-triggered only.'],
  codexConstraints: [
    'Do not auto-execute any command or mutate files without explicit operator request.',
    'Preserve routing/freshness/provider truth fields; add proposal fields without overloading existing contracts.',
    'Keep implementation deterministic and bounded; no freeform autonomy claims.',
  ],
  codexSuccessCriteria: [
    'Proposal packet truth fields appear in execution metadata and support/status projections.',
    'Codex handoff payload is copyable and explicitly approval-gated.',
    'All targeted tests pass with deterministic output for identical inputs.',
  ],
  humanJudgmentRequired: ['Confirm scope before merge.', 'Approve final execution steps and command sequence.'],
  riskLevel: 'moderate',
  reviewScope: ['contract normalization', 'UI truth projection', 'operator gating language', 'test coverage for partial evidence'],
});

const MOVE_TEMPLATE_OVERRIDES = Object.freeze({
  'proposal-execution-bridge': {
    conciseObjective: 'Formalize proposal-to-execution handoff while preserving operator authority boundaries.',
    whyNow: 'The bridge closes the gap between deterministic planning and disciplined implementation handoff.',
    expectedOperatorValue: 'Operator gets a clean approval workflow and reduced ambiguity for Codex execution.',
  },
  'codex-handoff-generator': {
    conciseObjective: 'Generate a structured, copy-safe Codex handoff payload from ranked mission synthesis output.',
    likelyAffectedSubsystems: ['proposalPacket', 'statusPanel', 'supportSnapshot', 'clipboard integration'],
    likelyAffectedFiles: ['stephanos-ui/src/ai/proposalPacket.js', 'shared/ai/proposalPacketContract.mjs', 'stephanos-ui/src/components/StatusPanel.jsx'],
  },
  'build-test-run-mission-packets': {
    conciseObjective: 'Standardize mission packet build/test/verify framing so operator approvals are executable and auditable.',
    requiredTests: ['mission packet deterministic translation tests', 'verify build + dist truth checks', 'route/freshness guardrail tests'],
    guardrailChecks: ['npm run stephanos:verify', 'stale-process reuse guard tests', 'import guard checks'],
  },
});

function safeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function toLineList(values = []) {
  return Array.isArray(values) ? values.filter(Boolean).map((value) => `- ${value}`) : [];
}

function resolveTemplate(moveId = '') {
  return {
    ...DEFAULT_TEMPLATE,
    ...(MOVE_TEMPLATE_OVERRIDES[moveId] || {}),
  };
}

function resolveConfidence(planningConfidence = 'low', warningCount = 0, evidenceCount = 0) {
  const normalized = safeString(planningConfidence) || 'low';
  if (warningCount >= 3 || evidenceCount === 0) return 'low';
  if (normalized === 'high' && warningCount === 0) return 'high';
  if (normalized === 'high' && warningCount > 0) return 'medium';
  return normalized;
}

function buildCodexPrompt({ moveSummary, template, warnings, dependencies, blockers, evidenceSources }) {
  return [
    'You are assisting Stephanos OS with an operator-approved implementation pass.',
    '',
    'Mission packet (deterministic synthesis result):',
    `- Move ID: ${moveSummary.move_id || 'n/a'}`,
    `- Move Title: ${moveSummary.title || 'n/a'}`,
    `- Objective: ${moveSummary.concise_objective || 'n/a'}`,
    `- Why now: ${moveSummary.why_now || 'n/a'}`,
    `- Expected operator value: ${moveSummary.expected_operator_value || 'n/a'}`,
    '',
    'Implementation framing:',
    ...toLineList([template.implementationApproach]),
    ...toLineList(template.likelyAffectedSubsystems),
    ...toLineList(template.likelyAffectedFiles),
    '',
    'Dependencies and blockers:',
    ...toLineList(dependencies),
    ...toLineList(blockers),
    '',
    'Evidence and warnings:',
    ...toLineList(evidenceSources),
    ...toLineList(warnings),
    '',
    'Constraints (mandatory):',
    ...toLineList(template.codexConstraints),
    '',
    'Validation requirements:',
    ...toLineList(template.requiredTests),
    ...toLineList(template.nodeCheckTargets),
    ...toLineList(template.guardrailChecks),
    '',
    'Success criteria:',
    ...toLineList(template.codexSuccessCriteria),
    '',
    'Operator policy: propose and stage only. Do not execute without explicit operator approval.',
  ].join('\n');
}

export function buildProposalPacket({
  missionSynthesis = {},
  contextDiagnostics = {},
  contextAssemblyMetadata = {},
  runtimeTruth = {},
  memoryElevation = {},
} = {}) {
  const recommendedMove = missionSynthesis?.recommendedNextMove || null;
  const planningDetected = missionSynthesis?.planningIntentDetected === true;
  const proposalEligible = missionSynthesis?.proposalEligible === true;
  const hasRecommendedMove = Boolean(recommendedMove?.moveId && recommendedMove?.title);
  const packetActive = planningDetected && proposalEligible && hasRecommendedMove;
  const evidenceSources = Array.isArray(missionSynthesis?.evidenceSources)
    ? missionSynthesis.evidenceSources
    : (Array.isArray(contextDiagnostics?.sourcesUsed) ? contextDiagnostics.sourcesUsed : []);

  if (!packetActive) {
    return normalizeProposalPacket({
      packet_metadata: {
        proposal_active: false,
        proposal_mode: 'inactive',
        proposal_confidence: 'low',
        proposal_truth_preserved: true,
        warnings: planningDetected ? ['planning detected but proposal packet lacked eligible recommended move'] : [],
        bounded_reasoning_notes: [
          'Proposal packet generation is deterministic and advisory-only.',
          'No action execution authority is granted by packet generation.',
        ],
      },
      recommended_move_summary: {},
      execution_framing: {},
      validation_framing: {},
      codex_handoff_payload: {
        codex_eligible: false,
        codex_prompt: '',
        codex_prompt_summary: '',
        codex_constraints: DEFAULT_TEMPLATE.codexConstraints,
        codex_success_criteria: DEFAULT_TEMPLATE.codexSuccessCriteria,
        copyable_payload: '',
      },
      operator_workflow: {
        proposal_eligible: false,
        execution_eligible: false,
        operator_actions: ['Adjust prompt toward self-build/roadmap intent to activate proposal packet generation.'],
        approval_required: true,
        human_judgment_required: DEFAULT_TEMPLATE.humanJudgmentRequired,
      },
      truth_fields: {
        proposal_packet_active: false,
        proposal_packet_mode: 'inactive',
        proposal_packet_confidence: 'low',
        proposal_packet_truth_preserved: true,
        codex_handoff_available: false,
        codex_handoff_eligible: false,
        operator_approval_required: true,
        proposed_move_id: '',
        proposed_move_title: '',
        proposed_move_rationale: '',
        proposal_packet_warnings: [],
      },
    });
  }

  const template = resolveTemplate(recommendedMove.moveId);
  const dependencies = Array.isArray(missionSynthesis?.dependencies)
    ? missionSynthesis.dependencies
    : (Array.isArray(recommendedMove?.dependencies) ? recommendedMove.dependencies : []);
  const blockers = Array.isArray(missionSynthesis?.blockers)
    ? missionSynthesis.blockers
    : (Array.isArray(recommendedMove?.blockers) ? recommendedMove.blockers : []);
  const planningWarnings = Array.isArray(missionSynthesis?.truthWarnings) ? missionSynthesis.truthWarnings : [];
  const memoryInfluencers = Array.isArray(memoryElevation?.top_memory_influencers)
    ? memoryElevation.top_memory_influencers.slice(0, 3)
    : [];
  const recurrenceSignals = Array.isArray(memoryElevation?.recurrence_signals)
    ? memoryElevation.recurrence_signals.slice(0, 3)
    : [];
  const packetWarnings = [
    ...planningWarnings,
    ...(contextAssemblyMetadata?.context_integrity_preserved === false
      ? ['context integrity was degraded in upstream assembly; keep proposal advisory-only']
      : []),
    ...(runtimeTruth?.routeUsableState === 'no' ? ['selected route was not usable; handoff should avoid runtime execution assumptions'] : []),
    ...(memoryElevation?.graph_link_truth_preserved === false ? ['memory/graph link truth was degraded; keep graph claims deferred'] : []),
  ];
  const proposalConfidence = resolveConfidence(missionSynthesis?.planningConfidence, packetWarnings.length, evidenceSources.length);
  const recommendedMoveSummary = {
    move_id: recommendedMove.moveId,
    title: recommendedMove.title,
    concise_objective: template.conciseObjective,
    why_now: [template.whyNow, memoryElevation?.continuity_reason].filter(Boolean).join(' '),
    expected_operator_value: [
      template.expectedOperatorValue,
      memoryInfluencers.length ? `Memory-backed rationale from ${memoryInfluencers.length} elevated influence signal(s).` : '',
    ].filter(Boolean).join(' '),
  };

  const codexEligible = missionSynthesis?.codexHandoffEligible === true;
  const codexPrompt = codexEligible
    ? buildCodexPrompt({
      moveSummary: recommendedMoveSummary,
      template,
      warnings: packetWarnings,
      dependencies,
      blockers,
      evidenceSources,
    })
    : '';
  const copyablePayload = codexEligible
    ? JSON.stringify({
      handoff_type: 'stephanos-proposal-packet',
      proposal_mode: missionSynthesis?.planningMode || 'self-build-mission-synthesis',
      proposal_confidence: proposalConfidence,
      recommended_move: recommendedMoveSummary,
      implementation_approach: template.implementationApproach,
      likely_affected_subsystems: template.likelyAffectedSubsystems,
      likely_affected_files: template.likelyAffectedFiles,
      dependency_notes: dependencies,
      blockers,
      required_tests: template.requiredTests,
      node_check_targets: template.nodeCheckTargets,
      build_verify_steps: ['npm run stephanos:build', 'npm run stephanos:verify'],
      guardrail_checks: template.guardrailChecks,
      codex_constraints: template.codexConstraints,
      codex_success_criteria: template.codexSuccessCriteria,
      warnings: packetWarnings,
      memory_influencers: memoryInfluencers.map((memory) => ({
        summary: memory.summary,
        memory_class: memory.memoryClass,
        source_type: memory.sourceType,
        graph_link_state: Array.isArray(memory.graphLinks) && memory.graphLinks.some((link) => link.state === 'linked') ? 'linked' : 'deferred',
      })),
      recurrence_signals: recurrenceSignals,
      approval_required: true,
      execution_eligible: false,
    }, null, 2)
    : '';

  return normalizeProposalPacket({
    packet_metadata: {
      proposal_active: true,
      proposal_mode: missionSynthesis?.planningMode || 'self-build-mission-synthesis',
      proposal_confidence: proposalConfidence,
      proposal_truth_preserved: true,
      warnings: packetWarnings,
      bounded_reasoning_notes: [
        'Packet is generated from deterministic mission synthesis metadata and static templates.',
        'Packet remains proposal-only; operator approval is mandatory before any execution.',
        memoryElevation?.memory_truth_preserved === true
          ? 'Elevated memory rationale stayed bounded with explicit provenance.'
          : 'Memory truth preservation was degraded; operator review required before trusting memory rationale.',
      ],
    },
    recommended_move_summary: recommendedMoveSummary,
    execution_framing: {
      implementation_approach: template.implementationApproach,
      likely_affected_subsystems: template.likelyAffectedSubsystems,
      likely_affected_files: template.likelyAffectedFiles,
      dependency_notes: template.dependencyNotes,
      blockers,
      risk_level: template.riskLevel,
      review_scope: template.reviewScope,
    },
    validation_framing: {
      required_tests: template.requiredTests,
      node_check_targets: template.nodeCheckTargets,
      build_verify_steps: ['npm run stephanos:build', 'npm run stephanos:verify'],
      guardrail_checks: template.guardrailChecks,
      runtime_validation_hints: template.runtimeValidationHints,
    },
    codex_handoff_payload: {
      codex_eligible: codexEligible,
      codex_prompt: codexPrompt,
      codex_prompt_summary: codexEligible
        ? `Codex handoff prepared for move ${recommendedMove.moveId} with proposal-only constraints.`
        : 'Codex handoff unavailable because move is not Codex-eligible.',
      codex_constraints: template.codexConstraints,
      codex_success_criteria: template.codexSuccessCriteria,
      copyable_payload: copyablePayload,
    },
    operator_workflow: {
      proposal_eligible: true,
      execution_eligible: false,
      operator_actions: missionSynthesis?.operatorActions || [
        `Review recommended move ${recommendedMove.moveId}.`,
        'Approve Codex handoff payload before any implementation commands are run.',
      ],
      approval_required: true,
      human_judgment_required: template.humanJudgmentRequired,
    },
    truth_fields: {
      proposal_packet_active: true,
      proposal_packet_mode: missionSynthesis?.planningMode || 'self-build-mission-synthesis',
      proposal_packet_confidence: proposalConfidence,
      proposal_packet_truth_preserved: true,
      codex_handoff_available: codexEligible && copyablePayload.length > 0,
      codex_handoff_eligible: codexEligible,
      operator_approval_required: true,
      proposed_move_id: recommendedMove.moveId,
      proposed_move_title: recommendedMove.title,
      proposed_move_rationale: missionSynthesis?.recommendationReason || recommendedMove.rationale || '',
      proposal_packet_warnings: packetWarnings,
    },
  });
}
