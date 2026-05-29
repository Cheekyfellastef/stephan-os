import { parseBuilderWorkbenchResult } from '../state/operatorReliefProjection.js';

const MAX_LOCAL_AI_PACKET_LENGTH = 3600;
const MAX_LOCAL_AI_RAW_RESPONSE_LENGTH = 2400;
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

function truncateRawResponse(value = '') {
  const text = asText(value, '');
  return text.length > MAX_LOCAL_AI_RAW_RESPONSE_LENGTH
    ? `${text.slice(0, MAX_LOCAL_AI_RAW_RESPONSE_LENGTH)}…[bounded-local-ai-response-truncated]`
    : text;
}

export function buildLocalAiReviewPrompt(packet = {}) {
  const boundedPacket = truncatePacket(JSON.stringify(packet || {}, null, 2));
  return [
    'Respond as a read-only Builder Workbench review.',
    'Do not edit files.',
    'Do not apply patches.',
    'Do not run shell commands.',
    'Do not run git commands.',
    'Do not claim mutation authority.',
    '',
    'Return exactly:',
    'Summary:',
    'Suspected files:',
    'Proposed change type:',
    'Risk level:',
    'Tests recommended:',
    'Confidence:',
    'Requires Codex fallback: yes/no',
    'Requires operator approval: yes',
    'Forbidden actions detected: none',
    'Reasoning:',
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

const LOCAL_AI_RUNNER_REQUIRED_FIELDS = [
  ['summary'],
  ['suspected files', 'files suspected'],
  ['proposed change type'],
  ['risk level'],
  ['tests recommended'],
  ['confidence'],
  ['requires codex fallback'],
  ['requires operator approval'],
  ['forbidden actions detected'],
  ['reasoning'],
];

function hasLocalAiRunnerField(text, names = []) {
  return names.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)\\s*(?:${escaped})\\s*[:=-]\\s*\\S`, 'i').test(text);
  });
}

export function parseLocalAiRunnerWorkbenchReview(responseText = '') {
  const boundedResponse = truncateRawResponse(responseText);
  if (!boundedResponse) {
    return { ok: false, status: 'empty', parsedResult: null, reason: 'Local AI response was empty.', boundedResponse };
  }
  if (responseContainsMutationLanguage(boundedResponse)) {
    return { ok: false, status: 'mutation-language-blocked', parsedResult: null, reason: 'Local AI response contained mutation/autonomy language.', boundedResponse };
  }
  const missingFields = LOCAL_AI_RUNNER_REQUIRED_FIELDS.filter((names) => !hasLocalAiRunnerField(boundedResponse, names));
  if (missingFields.length > 0) {
    return {
      ok: false,
      status: 'malformed',
      parsedResult: null,
      reason: `Local AI response missing required Workbench field(s): ${missingFields.map((names) => names[0]).join(', ')}.`,
      boundedResponse,
    };
  }
  const parsedResult = parseBuilderWorkbenchResult(boundedResponse, { source: 'local-ai-runner' });
  if (!parsedResult.safeForWorkbench) {
    return { ok: false, status: parsedResult.resultStatus || 'blocked', parsedResult, reason: 'Local AI response failed Workbench safety parsing.', boundedResponse };
  }
  return { ok: true, status: 'parsed', parsedResult, reason: 'parsed', boundedResponse };
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
    status: health?.ok === true && ollama.ok !== false && models.length > 0 ? 'ready' : 'failed',
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
    return { ok: false, status: 'blocked', selectedModel: asText(selectedModel, ''), dispatchAttempted: true, requestSent: false, responseRetained: 'no', parseAttempted: 'no', parseResultStatus: 'blocked', blockedReason: 'Local AI Runner requires the Stephanos chat backend route.', errorMessage: '', responseText: '' };
  }
  const model = asText(selectedModel, '');
  const approvedModels = uniqueModels(availableModels);
  if (!model) {
    return { ok: false, status: 'blocked', selectedModel: model, dispatchAttempted: true, requestSent: false, responseRetained: 'no', parseAttempted: 'no', parseResultStatus: 'blocked', blockedReason: 'No approved Ollama model selected.', errorMessage: '', responseText: '' };
  }
  if (approvedModels.length > 0 && !approvedModels.includes(model)) {
    return { ok: false, status: 'blocked', selectedModel: model, dispatchAttempted: true, requestSent: false, responseRetained: 'no', parseAttempted: 'no', parseResultStatus: 'blocked', blockedReason: 'Selected Ollama model is not in the discovered approved model list.', errorMessage: '', responseText: '' };
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
  const responseText = truncateRawResponse(resolveLocalAiRunnerResponseText(result));
  if (!result?.ok) {
    return {
      ok: false,
      status: 'failed',
      selectedModel: model,
      dispatchAttempted: true,
      requestSent: true,
      responseRetained: responseText ? 'yes' : 'no',
      parseAttempted: 'no',
      parseResultStatus: 'blocked',
      blockedReason: result?.data?.error || 'Local AI review request failed.',
      errorMessage: result?.data?.error || 'Local AI review request failed.',
      responseText,
      rawResult: result,
    };
  }
  const parsed = parseLocalAiRunnerWorkbenchReview(responseText);
  if (!parsed.ok) {
    const mutationBlocked = parsed.status === 'mutation-language-blocked';
    return {
      ok: false,
      status: mutationBlocked ? 'blocked' : 'parse-failed',
      selectedModel: model,
      dispatchAttempted: true,
      requestSent: true,
      responseRetained: responseText ? 'yes' : 'no',
      parseAttempted: 'yes',
      parseResultStatus: parsed.status,
      blockedReason: mutationBlocked ? 'mutation-language-blocked' : parsed.reason,
      errorMessage: mutationBlocked ? '' : parsed.reason,
      responseText: parsed.boundedResponse,
      parsedResult: parsed.parsedResult,
      rawResult: result,
    };
  }
  return {
    ok: true,
    status: 'succeeded',
    selectedModel: model,
    dispatchAttempted: true,
    requestSent: true,
    responseRetained: 'yes',
    parseAttempted: 'yes',
    parseResultStatus: 'parsed',
    blockedReason: 'none',
    errorMessage: '',
    responseText: parsed.boundedResponse,
    parsedResult: parsed.parsedResult,
    rawResult: result,
  };
}
