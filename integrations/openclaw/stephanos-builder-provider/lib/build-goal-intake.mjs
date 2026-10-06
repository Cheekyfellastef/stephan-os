export const OPENCLAW_BUILD_GOAL_TOOL = 'stephanos_submit_build_goal';
export const OPENCLAW_BUILD_GOAL_RESULT_SCHEMA = 'stephanos.openclaw-build-goal-tool-result.v1';

const SAFE_AGENT_IDS = new Set(['stephanos-scout-coder', 'openclaw-standalone']);
const SAFE_BUILDERS = new Set(['AUTO', 'OPENCLAW_LOCAL', 'OPENCLAW_STANDALONE']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}
function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}
function blocked(reason) {
  return freeze({
    schemaVersion: OPENCLAW_BUILD_GOAL_RESULT_SCHEMA,
    ok: false,
    reason,
    sourceMutationPerformed: false,
    mergeAuthorityUsed: false,
  });
}

export async function submitOpenClawBuildGoal(params = {}, options = {}) {
  const requestedBy = text(params.requestedBy).toLowerCase();
  const preferredBuilder = text(params.preferredBuilder, 'AUTO').toUpperCase();
  if (!SAFE_AGENT_IDS.has(requestedBy)) return blocked('OPENCLAW_BUILD_GOAL_AGENT_INVALID');
  if (!SAFE_BUILDERS.has(preferredBuilder)) return blocked('OPENCLAW_BUILD_GOAL_BUILDER_INVALID');

  const payload = {
    requestedBy,
    preferredBuilder,
    intent: text(params.intent),
    intendedOutcome: text(params.intendedOutcome),
    resourcePaths: list(params.resourcePaths),
    requiredTests: list(params.requiredTests),
    requiredEvidence: list(params.requiredEvidence),
  };
  const fetchFn = options.fetchFn || fetch;
  const baseUrl = text(options.backendBaseUrl || process.env.STEPHANOS_BACKEND_INTERNAL_BASE_URL, 'http://127.0.0.1:8787').replace(/\/$/, '');
  let response;
  try {
    response = await fetchFn(`${baseUrl}/api/mission-operations/goals/intake/openclaw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: options.signal,
    });
  } catch (error) {
    return blocked(`OPENCLAW_BUILD_GOAL_BACKEND_UNREACHABLE:${text(error?.message, 'unknown')}`);
  }
  let result;
  try { result = await response.json(); }
  catch { return blocked('OPENCLAW_BUILD_GOAL_RESPONSE_INVALID'); }
  if (!response.ok || result?.ok !== true) return blocked(text(result?.reason, `OPENCLAW_BUILD_GOAL_HTTP_${response.status}`));
  return freeze({
    schemaVersion: OPENCLAW_BUILD_GOAL_RESULT_SCHEMA,
    ok: true,
    requestId: text(result.requestId),
    goalId: text(result.goalId),
    issueNumber: Number(result.issue?.number) || null,
    issueUrl: text(result.issue?.url),
    created: result.created === true,
    deduped: result.deduped === true,
    finalVerdict: text(result.finalVerdict, 'OPENCLAW_BUILD_GOAL_SUBMITTED'),
    sourceMutationPerformed: false,
    mergeAuthorityUsed: false,
    nextAction: 'Stephanos Goal -> Builder conveyor owns scheduling, builder selection, pickup and execution proof.',
  });
}

export function buildOpenClawBuildGoalTool() {
  return {
    name: OPENCLAW_BUILD_GOAL_TOOL,
    label: 'Submit Stephanos Build Goal',
    description: 'Submit a bounded source build or fix request into the canonical Stephanos Goal -> Builder conveyor. Use this instead of directly editing repository source from OpenClaw app chat.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['requestedBy', 'intent', 'intendedOutcome', 'resourcePaths', 'requiredTests', 'requiredEvidence'],
      properties: {
        requestedBy: { type: 'string', enum: ['stephanos-scout-coder', 'openclaw-standalone'] },
        intent: { type: 'string', minLength: 4, maxLength: 4000 },
        intendedOutcome: { type: 'string', minLength: 4, maxLength: 4000 },
        resourcePaths: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 240 } },
        requiredTests: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 500 } },
        requiredEvidence: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 500 } },
        preferredBuilder: { type: 'string', enum: ['AUTO', 'OPENCLAW_LOCAL', 'OPENCLAW_STANDALONE'], default: 'AUTO' },
      },
    },
    async execute(_id, params, context = {}) {
      const result = await submitOpenClawBuildGoal(params, { signal: context?.signal });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}
