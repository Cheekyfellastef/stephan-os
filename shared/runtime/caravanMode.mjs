function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

export function createDefaultCaravanMode() {
  return {
    modeId: 'caravan-mode-v1',
    isActive: false,
    activationReason: 'battle-bridge-authority-available',
    authorityClass: 'battle-bridge-authority',
    localAuthorityAvailable: true,
    hostedCognitionAvailable: false,
    hostedCognitionConfigured: false,
    hostedCognitionExecutable: false,
    hostedWorkerConfigured: false,
    hostedWorkerProvider: 'none',
    hostedWorkerBaseUrl: '',
    hostedWorkerHealth: 'unknown',
    stagingEnabled: true,
    canonCommitAllowed: true,
    promotionDeferred: false,
    routeDependencyState: 'healthy',
    providerExecutionState: 'backend-executable',
    operatorSummary: 'Battle Bridge authority available.',
    nextRecommendedAction: 'Continue normal execution flow.',
  };
}

export function deriveCanonicalCaravanMode({
  sessionKind = 'unknown',
  localAuthorityAvailable = false,
  hostedCognitionConfigured = false,
  hostedCognitionAvailable = false,
  hostedCognitionExecutable = false,
  hostedWorkerProvider = '',
  hostedWorkerBaseUrl = '',
  hostedWorkerHealth = 'unknown',
  routeUsable = false,
  executableProvider = '',
} = {}) {
  const hostedSession = sessionKind === 'hosted-web';
  const active = hostedSession && !localAuthorityAvailable;
  const authorityClass = localAuthorityAvailable ? 'battle-bridge-authority' : 'hosted-cognition-only';
  const routeDependencyState = routeUsable ? 'route-usable' : 'route-degraded';
  const providerExecutionState = localAuthorityAvailable
    ? 'backend-executable'
    : hostedCognitionExecutable
      ? 'hosted-cognition-executable'
      : 'execution-blocked';

  const operatorSummary = localAuthorityAvailable
    ? 'Battle Bridge authority available. Canon execution and commit remain enabled.'
    : hostedCognitionExecutable
      ? 'Caravan Mode active. Hosted cognition is executable while canon authority remains unavailable. Outputs are staged only.'
      : hostedCognitionConfigured
        ? 'Caravan Mode active. Hosted cognition configured but not executable yet. Outputs remain staged only.'
        : 'Caravan Mode active. Configure hosted cognition to continue planning while away from Battle Bridge.';

  const nextRecommendedAction = localAuthorityAvailable
    ? 'Use canonical execution path or promote staged items explicitly.'
    : hostedCognitionExecutable
      ? 'Continue hosted-safe planning/orchestration. Stage outputs until canon authority returns.'
      : hostedCognitionConfigured
        ? 'Run hosted worker health check and resolve worker errors before continuing.'
        : 'Set hosted worker provider and base URL, then run a connection test.';

  return {
    modeId: 'caravan-mode-v1',
    isActive: active,
    activationReason: active ? 'battle-bridge-authority-unavailable' : 'battle-bridge-authority-available',
    authorityClass,
    localAuthorityAvailable,
    hostedCognitionAvailable,
    hostedCognitionConfigured,
    hostedCognitionExecutable,
    hostedWorkerConfigured: hostedCognitionConfigured,
    hostedWorkerProvider: asText(hostedWorkerProvider, hostedCognitionExecutable ? asText(executableProvider, 'none') : 'none'),
    hostedWorkerBaseUrl: asText(hostedWorkerBaseUrl),
    hostedWorkerHealth: asText(hostedWorkerHealth, hostedCognitionExecutable ? 'healthy' : 'unknown'),
    stagingEnabled: true,
    canonCommitAllowed: localAuthorityAvailable,
    promotionDeferred: !localAuthorityAvailable,
    routeDependencyState,
    providerExecutionState,
    operatorSummary,
    nextRecommendedAction,
  };
}

export function normalizeCaravanMode(value = {}) {
  const defaults = createDefaultCaravanMode();
  const source = asObject(value);
  return {
    ...defaults,
    ...source,
    modeId: asText(source.modeId, defaults.modeId),
    activationReason: asText(source.activationReason, defaults.activationReason),
    authorityClass: asText(source.authorityClass, defaults.authorityClass),
    hostedWorkerProvider: asText(source.hostedWorkerProvider, defaults.hostedWorkerProvider),
    hostedWorkerBaseUrl: asText(source.hostedWorkerBaseUrl, defaults.hostedWorkerBaseUrl),
    hostedWorkerHealth: asText(source.hostedWorkerHealth, defaults.hostedWorkerHealth),
    routeDependencyState: asText(source.routeDependencyState, defaults.routeDependencyState),
    providerExecutionState: asText(source.providerExecutionState, defaults.providerExecutionState),
    operatorSummary: asText(source.operatorSummary, defaults.operatorSummary),
    nextRecommendedAction: asText(source.nextRecommendedAction, defaults.nextRecommendedAction),
  };
}
