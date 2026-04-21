const DIAGNOSTIC_GLOBAL_KEY = '__stephanosStartupDiagnostics';
const INTERESTING_STORAGE_KEY_PATTERN = /(restore|resume|autolaunch|auto_launch|session|workspace|activeproject|launch|stephanos)/i;

function getGlobalDiagnostics() {
  if (!globalThis[DIAGNOSTIC_GLOBAL_KEY]) {
    globalThis[DIAGNOSTIC_GLOBAL_KEY] = {
      rootLanding: null,
      userInteraction: {
        interacted: false,
        type: null,
        at: null,
      },
      startupSettledAt: null,
      launchTriggers: [],
      renderStages: [],
      fatalRenderError: null,
    };
  }

  return globalThis[DIAGNOSTIC_GLOBAL_KEY];
}

function safeGetStorageEntries(storage, storageKind) {
  if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') {
    return [];
  }

  const entries = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !INTERESTING_STORAGE_KEY_PATTERN.test(String(key))) {
      continue;
    }

    let value = '';
    try {
      value = storage.getItem(key);
    } catch {
      value = '[unreadable]';
    }

    entries.push({
      storageKind,
      key,
      value,
    });
  }

  return entries;
}

function resolveStorageSignals() {
  const localEntries = safeGetStorageEntries(globalThis.localStorage, 'localStorage');
  const sessionEntries = safeGetStorageEntries(globalThis.sessionStorage, 'sessionStorage');
  return [...localEntries, ...sessionEntries];
}

export function markRootLandingLoaded({ href = globalThis.location?.href || '', readyState = globalThis.document?.readyState || '' } = {}) {
  const diagnostics = getGlobalDiagnostics();
  diagnostics.rootLanding = {
    at: new Date().toISOString(),
    href,
    readyState,
  };

  console.info('[StartupAudit] Root landing page loaded', diagnostics.rootLanding);
  return diagnostics.rootLanding;
}

export function attachStartupInteractionListeners(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.addEventListener !== 'function') {
    return () => {};
  }

  const markInteraction = (type) => {
    const diagnostics = getGlobalDiagnostics();
    diagnostics.userInteraction = {
      interacted: true,
      type,
      at: new Date().toISOString(),
    };
  };

  const pointerHandler = () => markInteraction('pointerdown');
  const keyHandler = () => markInteraction('keydown');

  windowRef.addEventListener('pointerdown', pointerHandler, { once: true });
  windowRef.addEventListener('keydown', keyHandler, { once: true });

  return () => {
    windowRef.removeEventListener('pointerdown', pointerHandler);
    windowRef.removeEventListener('keydown', keyHandler);
  };
}

export function markStartupSettled() {
  const diagnostics = getGlobalDiagnostics();
  diagnostics.startupSettledAt = new Date().toISOString();
  return diagnostics.startupSettledAt;
}

export function recordStartupRenderStage({
  stage = 'unknown',
  status = 'info',
  sourceModule = 'unknown',
  sourceFunction = 'unknown',
  details = null,
} = {}) {
  const diagnostics = getGlobalDiagnostics();
  const stageRecord = {
    at: new Date().toISOString(),
    stage: String(stage || 'unknown'),
    status: String(status || 'info'),
    sourceModule,
    sourceFunction,
    details,
  };

  diagnostics.renderStages.unshift(stageRecord);
  if (diagnostics.renderStages.length > 100) {
    diagnostics.renderStages.length = 100;
  }

  if (stageRecord.status === 'fatal') {
    diagnostics.fatalRenderError = stageRecord;
  }

  console.info('[StartupAudit] Render stage observed', stageRecord);
  return stageRecord;
}

export function recordStartupLaunchTrigger({
  sourceModule = 'unknown',
  sourceFunction = 'unknown',
  triggerType = 'unknown',
  triggerPayload = null,
  rawTarget = '',
  resolvedTarget = '',
} = {}) {
  const diagnostics = getGlobalDiagnostics();
  const rememberedSessionSignals = resolveStorageSignals();
  const triggerRecord = {
    at: new Date().toISOString(),
    sourceModule,
    sourceFunction,
    triggerType,
    triggerPayload,
    rawTarget,
    resolvedTarget,
    rootLandingLoaded: Boolean(diagnostics.rootLanding),
    rootLanding: diagnostics.rootLanding,
    startupSettledAt: diagnostics.startupSettledAt,
    userInteracted: diagnostics.userInteraction.interacted,
    userInteraction: diagnostics.userInteraction,
    rememberedSessionStateDetected: rememberedSessionSignals.length > 0,
    rememberedSessionSignals,
  };

  diagnostics.launchTriggers.unshift(triggerRecord);
  if (diagnostics.launchTriggers.length > 50) {
    diagnostics.launchTriggers.length = 50;
  }

  console.info('[StartupAudit] Launch trigger observed', triggerRecord);
  return triggerRecord;
}

export function getStartupDiagnosticsSnapshot() {
  const diagnostics = getGlobalDiagnostics();
  return {
    ...diagnostics,
    launchTriggers: diagnostics.launchTriggers.map((entry) => ({ ...entry })),
    renderStages: diagnostics.renderStages.map((entry) => ({ ...entry })),
    fatalRenderError: diagnostics.fatalRenderError ? { ...diagnostics.fatalRenderError } : null,
  };
}

export function resetStartupDiagnostics() {
  delete globalThis[DIAGNOSTIC_GLOBAL_KEY];
}
