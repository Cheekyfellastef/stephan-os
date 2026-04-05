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

  const allowHints = ['stephanos', 'routing', 'hosted', 'mission console', 'handoff', 'snapshot', 'debug', 'policy', 'provider', 'home-node', 'scroll'];
  if (allowHints.some((term) => normalized.includes(term))) {
    return { eligible: true, reason: 'Project-memory query eligible for local retrieval.' };
  }

  return { eligible: true, reason: 'Default local retrieval path enabled for non-freshness-sensitive query.' };
}
