import { evaluateMemoryEligibility } from './memoryPolicy.js';
import { createDurableMemoryRecord } from './memorySchema.js';
import { durableMemoryStore } from './memoryStore.js';
import { createDefaultMemoryExecutionTruth, normalizeMemoryExecutionTruth } from './memoryTruthModel.js';

export function adjudicateMemoryCandidate(candidate, { store = durableMemoryStore, persist = true } = {}) {
  if (!candidate || typeof candidate !== 'object') {
    return normalizeMemoryExecutionTruth(createDefaultMemoryExecutionTruth());
  }

  const eligibility = evaluateMemoryEligibility(candidate);
  if (!eligibility.eligible) {
    return normalizeMemoryExecutionTruth({
      memoryEligible: false,
      memoryPromoted: false,
      memoryReason: eligibility.reason,
      memorySourceType: eligibility.candidate.sourceType,
      memorySourceRef: eligibility.candidate.sourceRef,
      memoryConfidence: eligibility.confidence,
      memoryClass: eligibility.memoryClass,
    });
  }

  const record = createDurableMemoryRecord(eligibility.candidate);
  const storedRecord = persist ? store.upsert(record) : record;

  return normalizeMemoryExecutionTruth({
    memoryEligible: true,
    memoryPromoted: true,
    memoryReason: eligibility.reason,
    memorySourceType: storedRecord.sourceType,
    memorySourceRef: storedRecord.sourceRef,
    memoryConfidence: storedRecord.memoryConfidence,
    memoryClass: storedRecord.memoryClass,
  });
}
