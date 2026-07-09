export const LAUNCHER_READINESS_SCHEMA = 'stephanos.launcher-readiness-plan.v1';

export const REQUIRED_SERVICES = Object.freeze([
  Object.freeze({ id: 'backend', label: 'backend', port: 8787, proof: 'HTTP health proof for http://127.0.0.1:8787/api/health' }),
  Object.freeze({ id: 'stephanos-ui', label: 'Stephanos UI', port: 4173, proof: 'Served launcher/runtime proof for http://127.0.0.1:4173/' }),
  Object.freeze({ id: 'openclaw-gateway', label: 'OpenClaw gateway', port: 18789, proof: 'OpenClaw gateway readiness/identity proof for port 18789' }),
  Object.freeze({ id: 'shared-workspace', label: 'shared workspace publisher/status', port: null, proof: 'Fresh shared workspace publisher/status records' }),
]);

export const FORBIDDEN_ACTIONS = Object.freeze([
  'start-services-during-readiness-planning',
  'kill-processes',
  'execute-arbitrary-shell',
  'mutate-runtime-files',
  'pull-merge-push',
  'claim-live-health-without-runtime-proof',
]);

const ALLOWED_COMMAND_PATTERNS = Object.freeze([
  /^powershell(?:\.exe)?\s+-ExecutionPolicy\s+Bypass\s+-File\s+\.\\windows\\Launch-Stephanos-Local\.ps1\s+-Mode\s+(launcher-root|vite-dev)\s+-BootMode\s+(launcher|runtime|cockpit)$/i,
  /^\.\\windows\\Launch-Stephanos-Local\.cmd$/i,
  /^npm\s+run\s+stephanos:ignite(?::launcher-root|:vite-dev)?$/i,
]);

export function createLauncherConfigFacts(input = {}) {
  const launcherMode = input.launcherMode || input.mode || 'launcher-root';
  const bootMode = input.bootMode || 'cockpit';
  return {
    launcherMode,
    bootMode,
    allowedStartCommands: [
      `powershell.exe -ExecutionPolicy Bypass -File .\\windows\\Launch-Stephanos-Local.ps1 -Mode ${launcherMode} -BootMode ${bootMode}`,
      '.\\windows\\Launch-Stephanos-Local.cmd',
      launcherMode === 'vite-dev' ? 'npm run stephanos:ignite:vite-dev' : 'npm run stephanos:ignite:launcher-root',
    ],
  };
}

function normalizeObservedServices(observed = {}) {
  return Object.fromEntries(REQUIRED_SERVICES.map((service) => {
    const fact = observed[service.id] ?? observed[service.label] ?? observed[String(service.port)] ?? false;
    return [service.id, { ...service, ready: fact === true || fact?.ready === true, evidence: fact?.evidence || null }];
  }));
}

function isRuntimeOnlyPath(path) {
  return /^runtime-activity\//.test(path) || /^\.runtime\//.test(path) || /^apps\/stephanos\/dist\//.test(path);
}

export function isAllowedLauncherStartCommand(command) {
  return typeof command === 'string' && ALLOWED_COMMAND_PATTERNS.some((pattern) => pattern.test(command.trim()));
}

export function planLauncherReadiness({ observedFacts = {}, launcherConfigFacts = {}, sourceFacts = {}, requestedStartCommand = null } = {}) {
  const config = { ...createLauncherConfigFacts(launcherConfigFacts), ...launcherConfigFacts };
  const observedServices = normalizeObservedServices(observedFacts.services || observedFacts.observedServices || {});
  const missingServices = Object.values(observedServices).filter((service) => !service.ready).map((service) => service.id);
  const staleWorkspaceRecords = observedFacts.staleWorkspaceRecords || observedFacts.workspace?.staleRecords || [];
  const dirtyPaths = sourceFacts.dirtyPaths || [];
  const sourceDirtyPaths = dirtyPaths.filter((path) => !isRuntimeOnlyPath(path));
  const runtimeOnlyDirt = dirtyPaths.filter(isRuntimeOnlyPath);
  const unsafeCommand = requestedStartCommand && !isAllowedLauncherStartCommand(requestedStartCommand);
  const safetyBlockers = [];

  if (sourceDirtyPaths.length) safetyBlockers.push({ id: 'dirty-source', detail: 'Commit/stash/discard source dirt before launcher repair.', paths: sourceDirtyPaths });
  if (unsafeCommand) safetyBlockers.push({ id: 'unsafe-launcher-command', detail: 'Readiness planner only describes allowlisted launcher start commands.', command: requestedStartCommand });
  if (staleWorkspaceRecords.length) safetyBlockers.push({ id: 'stale-workspace-records', detail: 'Shared workspace current records are stale/UNKNOWN.', records: staleWorkspaceRecords });

  let finalVerdict = 'blocked-needs-supervisor-repair';
  if (sourceDirtyPaths.length) finalVerdict = 'blocked-dirty-source';
  else if (unsafeCommand) finalVerdict = 'blocked-unsafe-launcher-command';
  else if (staleWorkspaceRecords.length) finalVerdict = 'stale-workspace';
  else if (missingServices.includes('openclaw-gateway')) finalVerdict = 'partial-openclaw-missing';
  else if (missingServices.includes('stephanos-ui')) finalVerdict = observedServices.backend.ready ? 'partial-ui-missing' : 'blocked-needs-supervisor-repair';
  else if (observedServices.backend.ready && missingServices.length === 2 && missingServices.includes('stephanos-ui') && missingServices.includes('shared-workspace')) finalVerdict = 'partial-backend-only';
  else if (missingServices.length === 0) finalVerdict = 'ready';

  return {
    schema: LAUNCHER_READINESS_SCHEMA,
    requiredServices: REQUIRED_SERVICES,
    observedServices,
    missingServices,
    staleWorkspaceRecords,
    launcherMode: config.launcherMode,
    bootMode: config.bootMode,
    allowedStartCommands: config.allowedStartCommands,
    forbiddenActions: FORBIDDEN_ACTIONS,
    safetyBlockers,
    caveats: runtimeOnlyDirt.length ? [{ id: 'runtime-only-dirt', paths: runtimeOnlyDirt, detail: 'Runtime-only dirt is a caveat, not a source repair blocker.' }] : [],
    requiredProofs: REQUIRED_SERVICES.map((service) => service.proof),
    smallestNextOperatorAction: finalVerdict === 'ready' ? 'Collect browser/runtime proof; do not claim health without it.' : 'Run the allowlisted launcher command after resolving blockers, then rerun readiness proof.',
    nextOwner: finalVerdict.startsWith('blocked') || finalVerdict === 'stale-workspace' ? 'operator' : 'battle-bridge-supervisor',
    finalVerdict,
  };
}
