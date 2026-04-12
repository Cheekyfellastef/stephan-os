import { isExplicitRetrievalQuery, isProjectRelevantQuery, isTrivialNonProjectQuery } from '../assistantQueryClassifier.js';

export function createDefaultRetrievalTruth() {
  return {
    retrievalMode: 'none',
    retrievalEligible: false,
    retrievalUsed: false,
    retrievalReason: 'Retrieval not evaluated.',
    retrievedChunkCount: 0,
    retrievedSources: [],
    retrievalQuery: '',
    retrievalIndexStatus: 'missing',
  };
}

export function determineRetrievalEligibility({ prompt = '', freshnessContext = null } = {}) {
  const query = String(prompt || '').trim();
  if (!query) {
    return { eligible: false, reason: 'Prompt is empty.' };
  }

  const freshnessNeed = String(freshnessContext?.freshnessNeed || 'low').toLowerCase();
  if (freshnessNeed === 'high') {
    return { eligible: false, reason: 'Freshness-sensitive request; local RAG cannot claim current web truth.' };
  }

  const denyKeywords = ['current prime minister', 'latest score', 'stock price today', 'breaking news', 'today weather'];
  const normalized = query.toLowerCase();
  if (denyKeywords.some((term) => normalized.includes(term))) {
    return { eligible: false, reason: 'Fresh/current query pattern detected; retrieval withheld to prevent stale truth claims.' };
  }

  if (isTrivialNonProjectQuery(query)) {
    return { eligible: false, reason: 'Trivial non-project query; retrieval suppressed.' };
  }

  if (isProjectRelevantQuery(query)) {
    return { eligible: true, reason: 'Project-memory query eligible for local retrieval.' };
  }

  if (isExplicitRetrievalQuery(query)) {
    return { eligible: true, reason: 'Explicit retrieval intent detected for local context.' };
  }

  return { eligible: false, reason: 'Query is non-project and not explicitly retrieval-worthy.' };
}
