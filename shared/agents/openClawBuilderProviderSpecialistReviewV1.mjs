import {
  OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1,
  OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewV1 as analyzeLegacyOpenClawBuilderProviderSpecialistReviewV1,
} from './openClawBuilderProviderSpecialistReviewLegacyV1.mjs';
import {
  OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1,
  analyzeOpenClawProviderPoolPr1999SpecialistReviewV1,
} from './openClawProviderPoolPr1999SpecialistReviewV1.mjs';
import {
  OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1,
} from './openClawBuilderProviderSpecialistReviewSuccessorV1.mjs';

export {
  OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1,
  OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1,
  OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1,
  OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
};

export function analyzeOpenClawBuilderProviderSpecialistReviewV1(input = {}) {
  const legacy = analyzeLegacyOpenClawBuilderProviderSpecialistReviewV1(input);
  if (legacy.eligible) return legacy;
  const pr1999 = analyzeOpenClawProviderPoolPr1999SpecialistReviewV1(input);
  if (pr1999.eligible) return pr1999;
  return analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input);
}
