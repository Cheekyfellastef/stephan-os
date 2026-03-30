export const AI_ACTION_MODES = Object.freeze({
  NEXT_MOVE: 'next_move',
  BLOCKERS: 'blockers',
  CODEX_PROMPT: 'codex_prompt',
  MISSION_UPDATE: 'mission_update',
});

const ACTION_INSTRUCTIONS = {
  [AI_ACTION_MODES.NEXT_MOVE]: {
    label: 'Best Next Move',
    objective: 'Recommend the single highest-value next move for the operator now.',
    outputShape: [
      'recommended_next_action',
      'why_highest_priority',
      'dependencies_or_prerequisites',
      'not_now_scope',
      'confidence',
    ],
  },
  [AI_ACTION_MODES.BLOCKERS]: {
    label: 'Top Blockers',
    objective: 'Summarize highest-priority blockers grounded in mission/runtime context.',
    outputShape: [
      'top_blockers: [{title, severity, layer(foundational|downstream), evidence}]',
      'critical_path_impact',
      'immediate_unblock_suggestions',
      'confidence',
    ],
  },
  [AI_ACTION_MODES.CODEX_PROMPT]: {
    label: 'Suggest Codex Prompt',
    objective: 'Draft a concise Codex-ready prompt for the current mission state.',
    outputShape: [
      'codex_prompt',
      'assumptions_to_verify',
      'missing_context_to_request',
      'confidence',
    ],
  },
  [AI_ACTION_MODES.MISSION_UPDATE]: {
    label: 'Suggest Mission Update',
    objective: 'Propose mission dashboard update notes for operator approval.',
    outputShape: [
      'milestones_affected',
      'suggested_progress_update',
      'suggested_blocker_update',
      'rationale',
      'confidence',
    ],
  },
};

export function getAiActionInstruction(mode) {
  return ACTION_INSTRUCTIONS[mode] || null;
}

export function buildMissionActionPrompt({ mode, context }) {
  const instruction = getAiActionInstruction(mode);
  if (!instruction) {
    throw new Error(`Unsupported AI action mode: ${mode}`);
  }

  return [
    'You are Stephanos AI-butler operating inside Mission Console.',
    `Action mode: ${mode} (${instruction.label}).`,
    `Objective: ${instruction.objective}`,
    'Rules:',
    '- Ground every claim in the provided Stephanos context only.',
    '- If context is missing, explicitly say what is missing.',
    '- Do not claim that changes were applied; only propose operator actions.',
    '- Keep response concise, operator-facing, and execution-ready.',
    `Output fields (in order): ${instruction.outputShape.join('; ')}.`,
    '',
    'Stephanos context JSON:',
    JSON.stringify(context, null, 2),
  ].join('\n');
}

export function validateAiActionContext(context = {}) {
  const missionMissing = context?.missingContext?.missionState === true;
  const runtimeMissing = context?.missingContext?.runtimeState === true;
  const workspaceMissing = context?.missingContext?.workspaceState === true;
  return {
    missionMissing,
    runtimeMissing,
    workspaceMissing,
    hasRequiredCore: !runtimeMissing,
  };
}
