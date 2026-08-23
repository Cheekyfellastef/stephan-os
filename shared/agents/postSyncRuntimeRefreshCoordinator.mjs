export const POST_SYNC_REFRESH_SCHEMA = 'stephanos.post-sync-runtime-refresh.v1';

export const POST_SYNC_REFRESH_CLASSIFICATIONS = Object.freeze({
  NO_RUNTIME_REFRESH_REQUIRED: 'NO_RUNTIME_REFRESH_REQUIRED',
  REFRESH_READY: 'REFRESH_READY',
  REFRESH_COMPLETE: 'REFRESH_COMPLETE',
  APPROVAL_REQUIRED_OPENCLAW: 'APPROVAL_REQUIRED_OPENCLAW',
  BLOCKED_UNSAFE_CHANGED_PATH: 'BLOCKED_UNSAFE_CHANGED_PATH',
  BLOCKED_UNCLASSIFIED_RUNTIME_PATH: 'BLOCKED_UNCLASSIFIED_RUNTIME_PATH',
  BLOCKED_REFRESH_FAILED: 'BLOCKED_REFRESH_FAILED',
});

export const POST_SYNC_REFRESH_TARGETS = Object.freeze({
  NATURAL_RELOAD: 'natural-reload',
  UI_4173: 'stephanos-ui-4173',
  BACKEND_8787: 'stephanos-backend-8787',
  MISSION_WORKER: 'mission-orchestrator-worker',
});

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9._@+()\-][A-Za-z0-9._@+()\-/ ]{0,500}$/;
const TARGET_ORDER = Object.freeze([
  POST_SYNC_REFRESH_TARGETS.UI_4173,
  POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
  POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
  POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
]);

const NATURAL_EXACT = new Set([
  'shared/agents/battleBridgeGitHubCommandMailbox.mjs',
  'shared/agents/stephanosCapabilityRegistry.mjs',
  'shared/agents/postSyncRuntimeRefreshCoordinator.mjs',
  'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs',
  'shared/agents/windowsAuthorityMailboxRecoveryGuardianReviewV1.mjs',
  'shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
  'scripts/battle-bridge-github-command-mailbox.mjs',
  'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.mjs',
  'scripts/battle-bridge-github-sync-executor.mjs',
  'scripts/battle-bridge-github-sync-and-refresh.mjs',
  'scripts/battle-bridge-post-sync-refresh.mjs',
  'scripts/battle-bridge-shared-workspace-publisher.mjs',
  'scripts/battle-bridge-outbound-health-beacon.mjs',
  'scripts/chatgpt-shared-workspace-github-relay.mjs',
  'scripts/windows/probe-battle-bridge-recovery-mesh.ps1',
  'scripts/windows/run-battle-bridge-recovery-mesh-hidden.ps1',
  'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',
  'scripts/windows/run-battle-bridge-github-command-mailbox-hidden.ps1',
  'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
  'scripts/windows/run-battle-bridge-github-sync-hidden.ps1',
  'scripts/windows/install-battle-bridge-github-sync.ps1',
  'scripts/windows/status-battle-bridge-github-sync.ps1',
  'scripts/windows/uninstall-battle-bridge-github-sync.ps1',
  'scripts/windows/install-battle-bridge-outbound-health-beacon.ps1',
  'scripts/windows/run-battle-bridge-outbound-health-beacon-hidden.ps1',
  'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
]);

const NATURAL_PREFIXES = Object.freeze([
  'scripts/battle-bridge-github-command-mailbox.',
  'scripts/battle-bridge-github-sync-',
  'scripts/chatgpt-shared-workspace-github-relay.',
]);

const NO_RUNTIME_PREFIXES = Object.freeze([
  '.agents/',
  '.codex/',
  '.github/',
  'docs/',
  'tests/',
  'VR-Research-Lab/docs/',
]);

const NO_RUNTIME_EXACT = new Set([
  '.gitignore',
  '.gitattributes',
  'LICENSE',
  'README.md',
  'scripts/publish-battle-bridge-main-advance-signal.mjs',
  'shared/agents/battleBridgeMainAdvanceSignalV1.mjs',
]);

const LAUNCHER_CRITICAL_SOURCE_PATHS = new Set([
  'main.js',
  'modules/command-deck/command-deck.js',
  'system/module_loader.js',
  'system/workspace.js',
]);

const UI_BUILD_AND_PROOF_TOOLCHAIN_PATHS = new Set([
  'scripts/build-stephanos-ui.mjs',
  'scripts/clean-stephanos-dist.mjs',
  'scripts/stephanos-build-utils.mjs',
  'scripts/verify-stephanos-dist.mjs',
  'scripts/serve-stephanos-dist.mjs',
  'scripts/refresh-stephanos-ui-4173.mjs',
  'scripts/battle-bridge-ignition-supervisor.mjs',
]);

function normalizePath(value) {
  const path = String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.startsWith('//') || /^[A-Za-z]:\//.test(path)) return '';
  if (path.split('/').some((part) => part === '..' || part === '')) return '';
  if (!SAFE_RELATIVE_PATH.test(path)) return '';
  return path;
}

export function parseGitChangedPathStatus(stdout) {
  const paths = [];
  for (const line of String(stdout ?? '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    const parts = line.split('\t');
    const status = parts.shift() || '';
    if (!/^[ACDMRT][0-9]*$/.test(status)) {
      return Object.freeze({ ok: false, blocker: 'POST_SYNC_CHANGED_PATH_STATUS_INVALID', paths: Object.freeze([]) });
    }
    const expectedPathCount = /^[CR]/.test(status) ? 2 : 1;
    if (parts.length !== expectedPathCount || parts.some((entry) => !String(entry ?? '').trim())) {
      return Object.freeze({ ok: false, blocker: 'POST_SYNC_CHANGED_PATH_STATUS_INVALID', paths: Object.freeze([]) });
    }
    paths.push(...parts);
  }
  return Object.freeze({ ok: true, paths: Object.freeze([...new Set(paths)]) });
}

function isTestOrDocumentation(path) {
  return NO_RUNTIME_EXACT.has(path)
    || NO_RUNTIME_PREFIXES.some((prefix) => path.startsWith(prefix))
    || /(?:^|\/)[^/]+\.(?:test|spec)\.(?:c?js|mjs|jsx|ts|tsx)$/i.test(path)
    || /\.(?:md|mdx)$/i.test(path);
}

function isOpenClawPath(path) {
  if (NATURAL_EXACT.has(path)) return false;
  return path.startsWith('integrations/openclaw/')
    || path.startsWith('openclaw/')
    || /(?:^|\/)[^/]*openclaw[^/]*\.(?:mjs|js|ps1|vbs|json)$/i.test(path)
    || path === 'scripts/windows/run-stephanos-scheduled-task-windowless.vbs';
}

function isUiPath(path) {
  return LAUNCHER_CRITICAL_SOURCE_PATHS.has(path)
    || UI_BUILD_AND_PROOF_TOOLCHAIN_PATHS.has(path)
    || path.startsWith('stephanos-ui/')
    || path.startsWith('system/apps/')
    || (path.startsWith('apps/') && !path.startsWith('apps/stephanos/dist/'))
    || path.startsWith('shared/ai/')
    || path.startsWith('shared/runtime/')
    || path.startsWith('apps/stephanos/dist/')
    || [
      'apps/stephanos/app.json',
      'apps/index.json',
      'system/apps/app_validator.js',
      'stephanos-ui/package.json',
      'stephanos-ui/package-lock.json',
    ].includes(path)
    || path === 'package.json'
    || path === 'package-lock.json';
}

function isBackendPath(path) {
  if (NATURAL_EXACT.has(path)) return false;
  return path.startsWith('stephanos-server/')
    || path.startsWith('shared/ai/')
    || path.startsWith('shared/runtime/')
    || (path.startsWith('shared/agents/') && !NATURAL_EXACT.has(path))
    || [
      'scripts/windows/start-stephanos-backend.ps1',
      'scripts/windows/install-stephanos-backend-autostart.ps1',
      'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
      'package.json',
      'package-lock.json',
    ].includes(path);
}

function isMissionWorkerPath(path) {
  if (NATURAL_EXACT.has(path)) return false;
  return (path.startsWith('shared/agents/') && !NATURAL_EXACT.has(path))
    || path.startsWith('scripts/mission-orchestrator-worker')
    || path.startsWith('scripts/battle-bridge-worker-watchdog')
    || [
      'scripts/windows/start-mission-orchestrator-worker.ps1',
      'scripts/windows/install-mission-orchestrator-worker-autostart.ps1',
      'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
      'package.json',
      'package-lock.json',
    ].includes(path);
}

function isNaturalReloadPath(path) {
  return NATURAL_EXACT.has(path)
    || NATURAL_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function classifyPostSyncRefresh(changedPaths = []) {
  const safePaths = [];
  const unsafePaths = [];
  for (const rawPath of Array.isArray(changedPaths) ? changedPaths : []) {
    const normalized = normalizePath(rawPath);
    if (normalized) safePaths.push(normalized);
    else unsafePaths.push(String(rawPath ?? ''));
  }

  const targets = new Set();
  const noRuntimePaths = [];
  const unknownPaths = [];
  const openClawPaths = [];

  for (const path of [...new Set(safePaths)]) {
    if (isTestOrDocumentation(path)) {
      noRuntimePaths.push(path);
      continue;
    }
    let classified = false;
    if (isOpenClawPath(path)) {
      openClawPaths.push(path);
      classified = true;
    }
    if (isUiPath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.UI_4173);
      classified = true;
    }
    if (isBackendPath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.BACKEND_8787);
      classified = true;
    }
    if (isMissionWorkerPath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.MISSION_WORKER);
      classified = true;
    }
    if (isNaturalReloadPath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD);
      classified = true;
    }
    if (!classified) unknownPaths.push(path);
  }

  const targetIds = TARGET_ORDER.filter((target) => targets.has(target));
  let classification = POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED;
  if (unsafePaths.length) classification = POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNSAFE_CHANGED_PATH;
  else if (unknownPaths.length) classification = POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH;
  else if (openClawPaths.length) classification = POST_SYNC_REFRESH_CLASSIFICATIONS.APPROVAL_REQUIRED_OPENCLAW;
  else if (targetIds.length) classification = POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY;

  return Object.freeze({
    schemaVersion: POST_SYNC_REFRESH_SCHEMA,
    classification,
    targetIds: Object.freeze(targetIds),
    changedPathCount: safePaths.length + unsafePaths.length,
    safePathCount: safePaths.length,
    noRuntimePathCount: noRuntimePaths.length,
    openClawPathCount: openClawPaths.length,
    unknownPathCount: unknownPaths.length,
    unsafePathCount: unsafePaths.length,
    openClawApprovalRequired: openClawPaths.length > 0,
    automaticExecutionAllowed: unsafePaths.length === 0 && unknownPaths.length === 0,
    internal: Object.freeze({
      safePaths: Object.freeze([...new Set(safePaths)]),
      noRuntimePaths: Object.freeze(noRuntimePaths),
      openClawPaths: Object.freeze(openClawPaths),
      unknownPaths: Object.freeze(unknownPaths),
      unsafePaths: Object.freeze(unsafePaths),
    }),
  });
}

function validHead(value) {
  return SHA_PATTERN.test(String(value ?? ''));
}

function resultPass(result, expectedHead) {
  return result?.ok === true
    && result?.exactHeadProofOk === true
    && String(result?.sourceHead || '').toLowerCase() === String(expectedHead).toLowerCase();
}

export async function executePostSyncRefreshPlan({
  beforeHead,
  afterHead,
  changedPaths,
  adapters = {},
  completedResults = [],
  onTargetComplete,
} = {}) {
  if (!validHead(beforeHead) || !validHead(afterHead) || beforeHead === afterHead) {
    return Object.freeze({
      ok: false,
      classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
      blocker: 'POST_SYNC_HEADS_INVALID',
      exactHeadProofOk: false,
      results: Object.freeze([]),
    });
  }

  const plan = classifyPostSyncRefresh(changedPaths);
  if (!plan.automaticExecutionAllowed) {
    return Object.freeze({
      ok: false,
      classification: plan.classification,
      blocker: plan.classification,
      plan,
      exactHeadProofOk: false,
      results: Object.freeze([]),
    });
  }

  const resumable = new Map((Array.isArray(completedResults) ? completedResults : [])
    .filter((entry) => plan.targetIds.includes(entry?.targetId) && resultPass(entry, afterHead))
    .map((entry) => [entry.targetId, Object.freeze({ ...entry, resumed: true })]));
  const results = [];
  const handlers = {
    [POST_SYNC_REFRESH_TARGETS.UI_4173]: adapters.refreshUi,
    [POST_SYNC_REFRESH_TARGEЛђђPТСS‘ООЧN€Y\\њЛњ™\Э\ќXЪЩ[™€ФФХФЦSђЧФ‘Q”‘TТХT‘СUЛ“RTФТSУ—ХУФ’СT—N€Y\\њЛњ™\Э\ќZ\ЬЪ[Ы•ЫЬљЩ\‹€ФФХФЦSђЧФ‘Q”‘TТХT‘СUЛ“ђUTђSФ‘SРQN€Y\\њЛЫЫ™љ\›S]\[™[ШY€NВ‚€›Ь€
ЫЫњЭ\™Щ]YЩ€[‹ќ\™Щ]YКHВ€Y€
™\Э[XX›Kљ\К\™Щ]Y
JHВ€™\Э[Лњ\Ъ
™\Э[XX›K™Щ]
\™Щ]Y
JNВ€ЫЫќ[ќYNВ€B€ЫЫњЭ[™\€H[™\њЦЭ\™Щ]YNВ€Y€
\[Щ€[™\€OOH	Щќ[Э[Ы‰КHВ€™]\›€Шљ™XЭ™њ™Y^™JВ€ЪО€[ЩK€Ы\ЬЪYљXШ][ЫЋ€ФХФЦSђЧФ‘Q”‘TТРУTФТQ’PРUSУ”Лђ“РТСQФ‘Q”‘TТСђRSQ€›ШЪЩ\Ћ€‘Q”‘TТТS‘T—УRTФТS‘О‰Э\™Щ]YX€[‹€^XЭXY›ЫЩ“ЪО€[ЩK€™\Э[О€Шљ™XЭ™њ™Y^™J™\Э[КK€JNВ€B€ћHВ€ЫЫњЭ™\Э[H]ШZ][™\ЉИ™Y›Ь™RXYYќ\’XY\™Щ]Y[€JNВ€ЫЫњЭЫЫ\]YHШљ™XЭ™њ™Y^™JИ\™Щ]Y‹‹њ™\Э[JNВ€™\Э[Лњ\Ъ
ЫЫ\]Y
NВ€Y€
\™\Э[\ЬК™\Э[Yќ\’XY
JHВ€™]\›€Шљ™XЭ™њ™Y^™JВ€ЪО€[ЩK€Ы\ЬЪYљXШ][ЫЋ€ФХФЦSђЧФ‘Q”‘TТРУTФТQ’PРUSУ”Лђ“РТСQФ‘Q”‘TТСђRSQ€›ШЪЩ\Ћ€™\Э[Л›ШЪЩ\€‘Q”‘TТФ“УС—СђRSQ‰Э\™Щ]YX€[‹€^XЭXY›ЫЩ“ЪО€[ЩK€™\Э[О€Шљ™XЭ™њ™Y^™J™\Э[КK€JNВ€B€Y€
\[Щ€Ы•\™Щ]ЫЫ\]HOOH	Щќ[Э[Ы‰КHВ€]ШZ]Ы•\™Щ]ЫЫ\]JШљ™XЭ™њ™Y^™JЛ‹‹њ™\Э[ЧJJNВ€B€HШ]Ъ
\њ›ЬЉHВ€™]\›€Шљ™XЭ™њ™Y^™JВ€ЪО€[ЩK€Ы\ЬЪYљXШ][ЫЋ€ФХФЦSђЧФ‘Q”‘TТРУTФТQ’PРUSУ”Лђ“РТСQФ‘Q”‘TТСђRSQ€›ШЪЩ\Ћ€‘Q”‘TТСVPХUSУ—СђRSQ‰Э\™Щ]YX€\њ›ЬЋ€\њ›ЬЏЛ›Y\ЬШYЩHЭљ[™К\њ›ЬЉK€[‹€^XЭXY›ЫЩ“ЪО€[ЩK€™\Э[О€Шљ™XЭ™њ™Y^™J™\Э[КK€JNВ€B€B‚€Y€
[‹›Ь[ђЫ]Р\›Э[™\]Z\™Y
HВ€™]\›€Шљ™XЭ™њ™Y^™JВ€ЪО€[ЩK€Ы\ЬЪYљXШ][ЫЋ€ФХФЦSђЧФ‘Q”‘TТРУTФТQ’PРUSУ”ЛђT“ХђSФ‘TURT‘QУФSђУUЛ€›ШЪЩ\Ћ€	УФSђУUЧФ‘Q”‘TТРT“ХђSФ‘TURT‘Q	Л€[‹€^XЭXY›ЫЩ“ЪО€[ЩK€ШY™T™Yњ™\Ъ\РЫЫ\]Y€ќYK€™\Э[О€Шљ™XЭ™њ™Y^™J™\Э[КK€JNВ€B‚€™]\›€Шљ™XЭ™њ™Y^™JВ€ЪО€ќYK€Ы\ЬЪYљXШ][ЫЋ€[‹ќ\™Щ]YЛ›[™Э€ИФХФЦSђЧФ‘Q”‘TТРУTФТQ’PРUSУ”Л”‘Q”‘TТРУУTUB€€ФХФЦSђЧФ‘Q”‘TТРУTФТQ’PРUSУ”Л““ЧФ•S•SQWФ‘Q”‘TТФ‘TURT‘Q€›ШЪЩ\Ћ€	ЙЛ€[‹€^XЭXY›ЫЩ“ЪО€ќYK€ЫЭ\ЩRXY€Эљ[™КYќ\’XY
KќУЭЩ\ђШ\ЩJ
K€™\Э[О€Шљ™XЭ™њ™Y^™J™\Э[КK€љ[[™\™XЭ€	ФФХФЦSђЧФ•S•SQWФ‘Q”‘TТФTФЙЛ€JNВџB‚™^Ьќќ[Э[Ы€ќZ[ЬЭЮ[Ф™Yњ™\Ъ›Ъ™XЭ[ЫЉ™\Э[HЯKИ™Y›Ь™RXYH	ЙЛYќ\’XYH	ЙИHHЯJHВ€ЫЫњЭ[€H™\Э[њ[€ЯNВ€™]\›€Шљ™XЭ™њ™Y^™JВ€ШЪ[XU™\њЪ[ЫЋ€ФХФЦSђЧФ‘Q”‘TТФРТSPK€™Y›Ь™RXY€[YXY
™Y›Ь™RXY
HИЭљ[™К™Y›Ь™RXY
KќУЭЩ\ђШ\ЩJ
H€	ЙЛ€Yќ\’XY€[YXY
Yќ\’XY
HИЭљ[™КYќ\’XY
KќУЭЩ\ђШ\ЩJ
H€	ЙЛ€Ы\ЬЪYљXШ][ЫЋ€™\Э[Ы\ЬЪYљXШ][Ы€[‹Ы\ЬЪYљXШ][Ы€ФХФЦSђЧФ‘Q”‘TТРУTФТQ’PРUSУ”Лђ“РТСQФ‘Q”‘TТСђRSQ€›ШЪЩ\Ћ€Эљ[™К™\Э[›ШЪЩ\€	ЙКK€\™Щ]YО€\њ^Kљ\Р\њ^J[‹ќ\™Щ]YКHИЛ‹‹њ[‹ќ\™Щ]YЧH€ЧK€Ъ[™ЩY]ЫЭ[ќ€ќ[X™\Љ[‹Ъ[™ЩY]ЫЭ[ќ
K€›Фќ[ќ[YT]ЫЭ[ќ€ќ[X™\Љ[‹››Фќ[ќ[YT]ЫЭ[ќ
K€Ь[ђЫ]Ф]ЫЭ[ќ€ќ[X™\Љ[‹›Ь[ђЫ]Ф]ЫЭ[ќ
K€[љЫ›ЭЫ”]ЫЭ[ќ€ќ[X™\Љ[‹ќ[љЫ›ЭЫ”]ЫЭ[ќ
K€[њШY™T]ЫЭ[ќ€ќ[X™\Љ[‹ќ[њШY™T]ЫЭ[ќ
K€^XЭXY›ЫЩ“ЪО€™\Э[™^XЭXY›ЫЩ“ЪИOOHќYK€ШY™T™Yњ™\Ъ\РЫЫ\]Y€™\Э[њШY™T™Yњ™\Ъ\РЫЫ\]YOOHќYK€™\Э[\™Щ]О€\њ^Kљ\Р\њ^J™\Э[њ™\Э[КHИ™\Э[њ™\Э[Л›X\

[ќћJHO€
В€\™Щ]Y€[ќћKќ\™Щ]Y€ЪО€[ќћK›ЪИOOHќYK€^XЭXY›ЫЩ“ЪО€[ќћK™^XЭXY›ЫЩ“ЪИOOHќYK€ЫЭ\ЩRXY€[YXY
[ќћKњЫЭ\ЩRXY
HИЭљ[™К[ќћKњЫЭ\ЩRXY
KќУЭЩ\ђШ\ЩJ
H€	ЙЛ€›ШЪЩ\Ћ€Эљ[™К[ќћK›ШЪЩ\€	ЙКK€JJH€ЧK€\љ]\ћTЪ[[ЭЩY€[ЩK€\љ]\ћTЭЩ\”Ъ[[ЭЩY€[ЩK€\ЭќXЭ]™QЪ][ЭЩY€[ЩK€[њ™[]Y\ЪУ]]][Ыђ[ЭЩY€[ЩK€]™SЬ[ђЫ]Х\]P[ЭЩY€[ЩK€][Y\ФX›\ЪY€[ЩK€љ[[™\™XЭ€™\Э[›ЪИOOHќYHИ	ФФХФЦSђЧФ•S•SQWФ‘Q”‘TТФTФЙИ€	ФФХФЦSђЧФ•S•SQWФ‘Q”‘TТР“РТСQ	Л€JNВџB