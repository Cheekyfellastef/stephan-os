import {
  OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
  OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1 as analyzeCurrentSuccessor,
} from './openClawBuilderProviderSpecialistReviewSuccessorOc9V1.mjs';
import {
  MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1 as analyzeMultiplexerSuccessor,
} from './openClawBuilderProviderSpecialistReviewSuccessorMultiplexerV1.mjs';

export {
  MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1,
  OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
  OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1,
};

const MULTIPLEXER_PR = 1639;
const MULTIPLEXER_BRANCH = 'codex/1585-chatgpt-monitor-admission-bridge-v1';
const MULTIPLEXER_SCHEMA = 'stephanos.monitor-multiplexer-pr1639-specialist-review.v1';

export function analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input = {}) {
  const prNumber = Number(input.prNumber);
  const branch = String(input.branch ?? '').trim();
  if (prNumber === MULTIPLEXER_PR && branch === MULTIPLEXER_BRANCH) {
    const result = analyzeMultiplexerSuccessor(input);
    if (result?.schemaVersion === MULTIPLEXER_SCHEMA) return result;
    return Object.freeze({
      schemaVersion: MULTIPLEXER_SCHEMA,
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'MONITOR_MULTIPLEXER_PR1639_SPECIALIST_NOT_APPLICABLE',
    });
  }
  return analyzeCurrentSuccessor(input);
}
