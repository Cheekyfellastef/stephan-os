const MAX_TEXT = 320;
const MAX_LIST_ITEMS = 12;

function safeString(value = '') {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function safeBoolean(value) {
  return value === true;
}

function safeArray(value, limit = MAX_LIST_ITEMS) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, Math.max(0, Number(limit) || MAX_LIST_ITEMS));
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRecommendedMove(move = {}) {
  const source = safeObject(move);
  return {
    move_id: safeString(source.move_id),
    title: safeString(source.title).slice(0, MAX_TEXT),
    concise_objective: safeString(source.concise_objective).slice(0, MAX_TEXT),
    why_now: safeString(source.why_now).slice(0, MAX_TEXT),
    expected_operator_value: safeString(source.expected_operator_value).slice(0, MAX_TEXT),
  };
}

export function normalizeProposalPacket(input = {}) {
  const source = safeObject(input);
  const packetMetadata = safeObject(source.packet_metadata);
  const executionFraming = safeObject(source.execution_framing);
  const validationFraming = safeObject(source.validation_framing);
  const codexHandoff = safeObject(source.codex_handoff_payload);
  const operatorWorkflow = safeObject(source.operator_workflow);
  const truthFields = safeObject(source.truth_fields);

  return {
    packet_metadata: {
      proposal_active: safeBoolean(packetMetadata.proposal_active),
      proposal_mode: safeString(packetMetadata.proposal_mode) || 'inactive',
      proposal_confidence: safeString(packetMetadata.proposal_confidence) || 'low',
      proposal_truth_preserved: packetMetadata.proposal_truth_preserved !== false,
      warnings: safeArray(packetMetadata.warnings),
      bounded_reasoning_notes: safeArray(packetMetadata.bounded_reasoning_notes),
    },
    recommended_move_summary: normalizeRecommendedMove(source.recommended_move_summary),
    execution_framing: {
      implementation_approach: safeString(executionFraming.implementation_approach).slice(0, MAX_TEXT),
      likely_affected_subsystems: safeArray(executionFraming.likely_affected_subsystems),
      likely_affected_files: safeArray(executionFraming.likely_affected_files),
      dependency_notes: safeArray(executionFraming.dependency_notes),
      blockers: safeArray(executionFraming.blockers),
      risk_level: safeString(executionFraming.risk_level) || 'moderate',
      review_scope: safeArray(executionFraming.review_scope),
    },
    validation_framing: {
      required_tests: safeArray(validationFraming.required_tests),
      node_check_targets: safeArray(validationFraming.node_check_targets),
      build_verify_steps: safeArray(validationFraming.build_verify_steps),
      guardrail_checks: safeArray(validationFraming.guardrail_checks),
      runtime_validation_hints: safeArray(validationFraming.runtime_validation_hints),
    },
    codex_handoff_payload: {
      codex_eligible: safeBoolean(codexHandoff.codex_eligible),
      codex_prompt: safeString(codexHandoff.codex_prompt),
      codex_prompt_summary: safeString(codexHandoff.codex_prompt_summary).slice(0, MAX_TEXT),
      codex_constraints: safeArray(codexHandoff.codex_constraints),
      codex_success_criteria: safeArray(codexHandoff.codex_success_criteria),
      copyable_payload: safeString(codexHandoff.copyable_payload),
    },
    operator_workflow: {
      proposal_eligible: safeBoolean(operatorWorkflow.proposal_eligible),
      execution_eligible: safeBoolean(operatorWorkflow.execution_eligible),
      operator_actions: safeArray(operatorWorkflow.operator_actions),
      approval_required: operatorWorkflow.approval_required !== false,
      human_judgment_required: safeArray(operatorWorkflow.human_judgment_required),
    },
    truth_fields: {
      proposal_packet_active: safeBoolean(truthFields.proposal_packet_active),
      proposal_packet_mode: safeString(truthFields.proposal_packet_mode) || 'inactive',
      proposal_packet_confidence: safeString(truthFields.proposal_packet_confidence) || 'low',
      proposal_packet_truth_preserved: truthFields.proposal_packet_truth_preserved !== false,
      codex_handoff_available: safeBoolean(truthFields.codex_handoff_available),
      codex_handoff_eligible: safeBoolean(truthFields.codex_handoff_eligible),
      operator_approval_required: truthFields.operator_approval_required !== false,
      proposed_move_id: safeString(truthFields.proposed_move_id),
      proposed_move_title: safeString(truthFields.proposed_move_title).slice(0, MAX_TEXT),
      proposed_move_rationale: safeString(truthFields.proposed_move_rationale).slice(0, MAX_TEXT),
      proposal_packet_warnings: safeArray(truthFields.proposal_packet_warnings),
    },
  };
}
