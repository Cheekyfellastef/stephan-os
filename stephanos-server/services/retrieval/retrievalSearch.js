function tokenize(value = '') {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function buildTermFrequency(tokens = []) {
  const map = new Map();
  for (const token of tokens) {
    map.set(token, (map.get(token) || 0) + 1);
  }
  return map;
}

function computeQueryWeight(tokens = []) {
  const queryTf = buildTermFrequency(tokens);
  const result = new Map();
  for (const [token, tf] of queryTf.entries()) {
    result.set(token, 1 + Math.log(tf));
  }
  return result;
}

export function buildLexicalIndex(chunks = []) {
  const documentCount = chunks.length;
  const docFreq = new Map();
  const chunkTokenFreq = [];

  chunks.forEach((chunk) => {
    const tokens = tokenize(chunk.text);
    const tf = buildTermFrequency(tokens);
    chunkTokenFreq.push(tf);
    for (const token of new Set(tokens)) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  });

  return {
    tokenizerVersion: 1,
    documentCount,
    docFreq: Object.fromEntries(docFreq.entries()),
    chunkTokenFreq: chunkTokenFreq.map((map) => Object.fromEntries(map.entries())),
  };
}

export function searchChunks({ query = '', chunks = [], lexicalIndex = null, maxResults = 4 } = {}) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length || !Array.isArray(chunks) || chunks.length === 0) {
    return [];
  }

  const docFreqMap = new Map(Object.entries(lexicalIndex?.docFreq || {}));
  const tfList = Array.isArray(lexicalIndex?.chunkTokenFreq) ? lexicalIndex.chunkTokenFreq : [];
  const N = Math.max(1, Number(lexicalIndex?.documentCount) || chunks.length || 1);
  const queryWeights = computeQueryWeight(queryTokens);

  const scored = [];

  chunks.forEach((chunk, index) => {
    const tfSource = tfList[index] || {};
    const tfMap = new Map(Object.entries(tfSource));
    let score = 0;

    queryWeights.forEach((queryWeight, token) => {
      const tf = Number(tfMap.get(token) || 0);
      if (!tf) return;
      const df = Number(docFreqMap.get(token) || 0);
      const idf = Math.log((N + 1) / (df + 1)) + 1;
      const chunkWeight = (1 + Math.log(tf)) * idf;
      score += chunkWeight * queryWeight;
    });

    if (score > 0) {
      scored.push({ chunk, score });
    }
  });

  return scored
    .sort((a, b) => b.score - a.score || a.chunk.path.localeCompare(b.chunk.path) || a.chunk.chunkIndex - b.chunk.chunkIndex)
    .slice(0, Math.max(1, Number(maxResults) || 4));
}
