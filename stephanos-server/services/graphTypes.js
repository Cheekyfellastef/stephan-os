export const GRAPH_NODE_DEFAULT_TYPE = 'note';
export const GRAPH_EDGE_DEFAULT_TYPE = 'relates_to';

export function createNodeId() {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEdgeId() {
  return `edge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeTags(tagsInput) {
  if (!tagsInput) return [];

  const rawTags = Array.isArray(tagsInput)
    ? tagsInput
    : String(tagsInput)
      .split(',')
      .map((tag) => tag.trim());

  return [...new Set(rawTags
    .map((tag) => String(tag || '').trim().toLowerCase())
    .filter(Boolean))];
}

export function sanitizeNodeInput(input = {}) {
  return {
    label: String(input.label ?? '').trim(),
    type: String(input.type ?? GRAPH_NODE_DEFAULT_TYPE).trim().toLowerCase(),
    description: String(input.description ?? '').trim(),
    tags: normalizeTags(input.tags),
    source: String(input.source ?? 'manual').trim().toLowerCase(),
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };
}

export function sanitizeEdgeInput(input = {}) {
  return {
    from: String(input.from ?? '').trim(),
    to: String(input.to ?? '').trim(),
    type: String(input.type ?? GRAPH_EDGE_DEFAULT_TYPE).trim().toLowerCase(),
    label: String(input.label ?? '').trim(),
    weight: Number.isFinite(Number(input.weight)) ? Number(input.weight) : 1,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };
}
