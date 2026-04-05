function asText(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

export function createDefaultMemoryExecutionTruth() {
  return {
    memoryEligible: false,
    memoryPromoted: false,
    memoryReason: 'No memory candidate submitted for adjudication.',
    memorySourceType: 'operator',
    memorySourceRef: '',
    memoryConfidence: 'low',
    memoryClass: 'durable',
  };
}

export function normalizeMemoryExecutionTruth(result = {}) {
  const source = result && typeof result === 'object' ? result : {};
  return {
    memoryEligible: source.memoryEligible === true,
    memoryPromoted: source.memoryPromoted === true,
    memoryReason: asText(source.memoryReason, 'Memory adjudication not evaluated.'),
    memorySourceType: asText(source.memorySourceType, 'operator'),
    memorySourceRef: asText(source.memorySourceRef),
    memoryConfidence: asText(source.memoryConfidence, 'low'),
    memoryClass: asText(source.memoryClass, 'durable'),
  };
}
