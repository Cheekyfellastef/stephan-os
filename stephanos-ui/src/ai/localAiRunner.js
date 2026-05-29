const MAX_LOCAL_AI_PACKET_LENGTH = 3600;
const LOCAL_AI_RUNNER_FORBIDDEN_PACKET_PATTERNS = [
  /\b(git\s+(add|commit|push|merge|checkout|reset|clean)|npm\s+version|rm\s+-rf)\b/i,
  /\b(write|mutate|modify|edit|delete|create)\s+(the\s+)?(file|repo|source|code)\b/i,
  /\b(apply|applied)\b[^.\n]*(patch|diff|change|fix)\b/i,
];

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function uniqueModels(models = []) {
  return Array.from(new Set((Array.isArray(models) ? models : [])
    .map((model) => asText(typeof model === 'string' ? model : model?.name, ''))
    .filter(Boolean)));
}

function truncatePacket(value = '') {
  const text = asText(value, '');
  return text.length > MAX_LOCAL_AI_PACKET_LENGTH
    ? `${text.slice(0, MAX_LOCAL_AI_PACKET_LENGTH)}…[bounded-read-only-packet-truncated]`
    : text;
}

export function buildLocalAiReviewPrompt(packet = {}) {
  const boundedPacket = truncatePacket(JSON.stringify(packet || {}, null, 2));
  return [
    'Stephanos Builder Workbench Local AI Runner V1: read-only review only.',
    'You are not allowed to write files, run shell commands, run git commands, apply patches, mutate source, or claim operator approval.',
    'Review only the bounded Builder Workbench packet below and return this exact field format:',
    'Summary: <one concise review summary>',
    'Files suspected: <comma-separated files/areas or none>',
    'Proposed change type: read-only-review',
    'Risk level: low|medium|high|critical|unknown',
    'Tests recommended: <comma-separated tests/checks>',
    'Confidence: <percent or low|medium|high>',
    'Requires Codex fallback: yes|no',
    'Requires operator approval: yes',
    'Mutation requested: no',
    '',
    'Bounded Builder Workbench packet:',
    boundedPacket,
  ].join('\n');
}

export function resolveLocalAiRunnerResponseText(result = {}) {
  const data = result?.data || {};
  return asText(
    data.output_text
      || data.outputText
      || data.response
      || data.data?.output_text
      || data.data?.outputText
      || data.data?.response
      || '',
    '',
  );
}

export function responseContainsMutationLanguage(text = '') {
  return LOCAL_AI_RUNNER_FORBIDDEN_PACKET_PATTERNS.some((pattern) => pattern.test(asText(text, '')));
}

export async function discoverLocalAiRunnerModels({ providerConfigs = {}, runtimeConfig = null, fetchHealth = null } = {}) {
  const resolvedRuntimeConfig = runtimeConfig || {};
  const resolvedFetchHealth = fetchHealth;
  if (typeof resolvedFetchHealth !== 'function') {
    return { ok: false, status: 'blocked', models: [], selectedModel: '', reason: 'Local AI Runner model discovery requires the Stephanos provider health backend route.' };
  }
  const health = await resolvedFetchHealth({
    provider: 'ollama',
    routeMode: 'local-first',
    providerConfigs,
    fallbackEnabled: false,
    fallbackOrder: [],
    devMode: true,
    runtimeContext: resolvedRuntimeConfig,
  }, resolvedRuntimeConfig);
  const snapshot = health?.data || {};
  const ollama = snapshot.ollama || {};
  const models = uniqueModels(ollama.models || snapshot.models || []);
  return {
    ok: health?.ok === true && ollama.ok !== false && models.length > 0,
    status: health?.ok === true && ollama.ok !== false ? 'succeeded' : 'failed',
    models,
    selectedModel: models[0] || '',
    reason: ollama.reason || ollama.detail || (models.length ? 'ollama-models-discovered' : 'no-ollama-models-discovered'),
    rawHealth: snapshot,
  };
}

export async function runLocalAiWorkbenchReview({
  packet = {},
  selectedModel = '',
  availableModels = [],
  runtimeConfig = null,
  sendPromptImpl = null,
} = {}) {
  const resolvedRuntimeConfig = runtimeConfig || {};
  const resolvedSendPrompt = sendPromptImpl;
  if (typeof resolvedSendPrompt !== 'function') {
    return { ok: false, status: 'blocked', selectedModel: asText(selectedModel, ''), blockedReason: 'Local AI Runner requires the Stephanos chat backend route.', responseText: '' };
  }
  const model = asText(selectedModel, '');
  const approvedModels = uniqueModels(availableModels);
  if (!model) {
    return { ok: false, status: 'blocked', blockedReason: 'No approved Ollama model selected.', responseText: '' };
  }
  if (approvedModels.length > 0 && !approvedModels.includes(model)) {
    return { ok: false, status: 'blocked', blockedReason: 'Selected Ollama model is not in the discovered approved model list.', responseText: '' };
  }

  const prompt = buildLocalAiReviewPrompt(packet);
  const result = await resolvedSendPrompt({
    prompt,
    provider: 'ollama',
    uiRequestedProvider: 'ollama',
    requestSideSelectedProvider: 'ollama',
    routerSelectedProvider: 'ollama',
    providerOverrideReason: 'local-ai-runner-read-only-builder-workbench-review',
    routeMode: 'local-first',
    providerConfigs: { ollama: { model } },
    fallbackEnabled: false,
    fallbackOrder: [],
    devMode: true,
    runtimeConfig: resolvedRuntimeConfig,
    freshnessContext: { freshnessNeed: 'low', reason: 'read-only-builder-workbench-local-review' },
    routeDecision: {
      uiSelectedProvider: 'ollama',
      defaultProvider: 'ollama',
      selectedProvider: 'ollama',
      requestedProviderForRequest: 'ollama',
      localRouteAvailable: true,
      staleFallbackPermitted: false,
      selectedAnswerMode: 'local-private',
    },
    streamingMode: 'off',
    ollamaLoadMode: 'balanced',
  });
  const responseText = resolveLocalAiRunnerResponseText(result);
  if (!result?.ok || !responseText) {
    return {
      ok: false,
      status: 'failed',
      selectedModel: model,
      blockedReason: result?.data?.error || 'Local AI review returned no parseable response text.',
      responseText,
      rawResult: result,
    };
  }
  if (responseContainsMutationLanguage(responseText)) {
    return {
      ok: false,
      status: 'blocked',
      selectedModel: model,
      blockedReason: 'Local AI response contained mutation/autonomy language; Workbench intake kept fallback needed.',
      responseText,
      rawResult: result,
    };
  }
  return {
    ok: true,
    status: 'succeeded',
    selectedModel: model,
    blockedReason: '',
    responseText,
    rawResult: result,
  };
}
