import { buildOpenClawControlBridgeProjection } from '../../../shared/agents/openClawControlBridge.mjs';
import { buildOpenClawWebResearchIntakeProjection, OPENCLAW_VR_RESEARCH_PROMPT } from '../../../shared/agents/openClawWebResearchIntake.mjs';
import { buildOpenClawWorkspaceHygieneProjection } from '../../../shared/agents/openClawWorkspaceHygiene.mjs';
import { OPENCLAW_SOURCE_PACK_CLI_PROMPT, OPENCLAW_SOURCE_PACK_MODEL, OPENCLAW_SOURCE_PACK_ROUTE, OPENCLAW_SOURCE_PACK_TEMPLATE, buildOpenClawSourcePackRunnerProjection, isOpenClawSourcePackRouteEligible } from '../../../shared/agents/openClawSourcePackRunner.mjs';
import { derivePacketBayProjection } from './packetBayProjection.js';
import { buildProjectAwarenessProjection } from './projectAwarenessProjection.js';
import { deriveMissionEvidenceLedgerProjection, deriveMissionEvidenceContextSummary } from './missionEvidenceLedgerModel.js';
function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}
function asList(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
export const HARNESS_AGENT_VERSION = 'v1.2';

export const OPENCLAW_PATCH_PLANNER_PROMPT = [
  'You are OpenClaw acting as a read-only Stephanos patch planner/reviewer.',
  'Do not edit files, run commands, commit, push, start services, store secrets, or claim mutation authority.',
  'Return a bounded patch plan using these fields exactly:',
  'Summary:',
  'Likely files:',
  'Required tests:',
  'Risk level: low|medium|high',
  'Patch scope: docs-only|source-only|ui-runtime|backend|mixed',
  'Browser proof required: yes|no|unknown',
  'Requires Codex fallback: yes|no|unknown',
  'Codex fallback reason:',
  'Requires operator approval: yes',
  'Mutation authority: locked',
  'Auto-start: forbidden',
  'Next operator action:',
  'Keep the plan specific to source files/tests and proposal-only until the operator approves mutation.',
].join('\n');

const UI_BROWSER_CHECKLIST = ['Mission Console opens from landing tile','Operator Relief panel visible','idle state renders','active/fixture state renders','merge safety verdict visible','browser proof gaps visible','repair prompt visible/copyable','no red console errors','no broken chevron/collapse','existing Mission Console controls still work'];
const AI_CONSOLE_AUTOSCROLL_PROOF_ID = 'aiconsole-answer-pane-autoscroll';
const MAX_GAP_REASON_LENGTH = 240;
const MAX_REPAIR_PROMPT_LENGTH = 4000;
const MAX_QUEUE_PAYLOAD_LENGTH = 2400;



const MAX_WORKBENCH_RAW_TEXT_LENGTH = 2400;
const WORKBENCH_FORBIDDEN_ACTION_PATTERNS = [
  /\b(i\s+)?(edited|modified|changed|wrote|created|deleted|removed|renamed)\b[^.\n]*(file|repo|source|code|component|module|test)/i,
  /\b(applied|apply)\b[^.\n]*(patch|diff|change|fix)/i,
  /\b(git\s+(add|commit|push|merge|checkout|reset|clean)|npm\s+version|rm\s+-rf)\b/i,
  /\b(write|mutate|modify|edit|delete|create)\s+(the\s+)?(file|repo|source|code)/i,
  /\b(i\s+)?(ran|executed|started|launched)\b[^.\n]*(npm|node|git|command|test|build|verify|openclaw)/i,
  /\b(no\s+approval\s+needed|without\s+operator\s+approval|approval\s+not\s+required)\b/i,
];
const WORKBENCH_RISK_VALUES = ['low', 'medium', 'high', 'critical'];

function truncateWorkbenchText(value) {
  const text = asText(value, '');
  return text.length > MAX_WORKBENCH_RAW_TEXT_LENGTH ? `${text.slice(0, MAX_WORKBENCH_RAW_TEXT_LENGTH)}…[truncated]` : text;
}

function escapeWorkbenchRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractWorkbenchField(text, names = []) {
  for (const name of names) {
    const escaped = escapeWorkbenchRegex(name);
    const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:${escaped})\\s*[:=-]\\s*([^\\n]+)`, 'i'));
    if (match) return asText(match[1], '');
  }
  return '';
}

function parseWorkbenchListField(text, names = []) {
  const field = extractWorkbenchField(text, names);
  if (!field) return [];
  return field.split(/[,;|]/).map((item) => asText(item, '')).filter(Boolean).slice(0, 12);
}

function parseWorkbenchYesNo(text, names = [], fallback = 'unknown') {
  const field = extractWorkbenchField(text, names).toLowerCase();
  if (/\b(yes|true|required|needed)\b/.test(field)) return 'yes';
  if (/\b(no|false|not required|not needed)\b/.test(field)) return 'no';
  return fallback;
}

function parseWorkbenchRisk(text) {
  const field = extractWorkbenchField(text, ['risk level', 'risk', 'patch plan risk']).toLowerCase();
  const found = WORKBENCH_RISK_VALUES.find((risk) => field.includes(risk));
  if (found) return found;
  if (/\b(small|safe|minor)\b/.test(field)) return 'low';
  if (/\b(broad|protected|destructive|command deck|provider routing)\b/.test(text.toLowerCase())) return 'high';
  return 'unknown';
}

function parseWorkbenchConfidence(text) {
  const field = extractWorkbenchField(text, ['confidence']);
  if (!field) return 'unknown';
  const percent = field.match(/\b(\d{1,3})\s*%/);
  if (percent) return `${Math.min(100, Number(percent[1]))}%`;
  const word = field.match(/\b(low|medium|high|strong|weak)\b/i);
  return word ? word[1].toLowerCase() : field.slice(0, 80);
}


const WORKBENCH_FILE_PATH_PATTERN = /(?:^|[\s'"`(])((?:[A-Za-z0-9_.-]+\/)+(?:[A-Za-z0-9_.-]+)(?:\.[A-Za-z0-9_.-]+)?)(?=$|[\s'"`).,;:])/g;
const WORKBENCH_TEST_COMMAND_PATTERN = /\b((?:npm|pnpm|yarn)\s+run\s+[A-Za-z0-9:_.-]+(?:\s+--\s+[^\n,;]+)?|node\s+--test\s+[^\n,;]+|npx\s+[^\n,;]+|vitest\s+[^\n,;]*|playwright\s+test\s+[^\n,;]*)/gi;
const WORKBENCH_PLACEHOLDER_PATTERN = /<\s*(?:your\s+)?(?:answer|response|end-tool)\s*>|<\s*(?:file|path|test|summary|todo|insert|example)[^>]*>|\{\{[^}]+\}\}|TODO_PLACEHOLDER/i;
const WORKBENCH_GENERIC_PLAN_PATTERN = /\b(update the files|make the changes|run the tests|fix the bug|implement the feature|review the code|ensure everything works|as needed|appropriate files|relevant tests)\b/i;

const OPENCLAW_CANONICAL_WINDOWS_REPO_PATH = 'c:\\users\\stephan callear\\documents\\github\\stephan-os';
const OPENCLAW_SANITY_EXPECTED_PAYLOAD = 'OPENCLAW_SANITY_PASS';
const OPENCLAW_TEMPLATE_LEAKAGE_PATTERN = /<\s*(?:your\s+)?(?:response|answer|end-tool)\s*>|your question or action request|\bsay next\b|as a language model/i;
const OPENCLAW_EXACT_RESPONSE_FAILURE_PATTERN = /as a language model[\s\S]{0,240}(?:say next|your question or action request)|##\s*<\s*(?:your\s+)?response\s*>|<\s*(?:your\s+)?(?:response|answer|end-tool)\s*>|your response\s*---/i;
const OPENCLAW_WINDOWS_PATH_PATTERN = /[a-z]:\\[^\n`'")]+/gi;

function normalizeOpenClawPath(value = '') {
  return String(value).trim().replace(/\\+/g, '\\').replace(/\/+$/, '').toLowerCase();
}

function extractOpenClawWindowsPaths(text = '') {
  return uniqueWorkbenchItems(Array.from(String(text).matchAll(OPENCLAW_WINDOWS_PATH_PATTERN)).map((match) => match[0].replace(/[.,;:]+$/, '')), 8);
}


function extractOpenClawSanityPayload(rawText = '') {
  const lines = String(rawText).split(/\r?\n/).map((line) => asText(line, '')).filter(Boolean);
  const payloadLine = [...lines].reverse().find((line) => !/^[-=\s]+$/.test(line) && !/^openclaw\b.*\b(banner|cli|scout|workspace|session)\b/i.test(line)) || '';
  return payloadLine.replace(/^```(?:text|markdown)?/i, '').replace(/```$/i, '').trim();
}

function judgeOpenClawExactResponse(rawText = '') {
  const raw = truncateWorkbenchText(rawText);
  if (!raw) return { exactResponseStatus: 'unknown', exactResponsePayload: 'none', exactResponseExpected: OPENCLAW_SANITY_EXPECTED_PAYLOAD, cliBannerIgnored: 'no' };
  const payload = extractOpenClawSanityPayload(raw);
  const hasExpectedPayload = payload === OPENCLAW_SANITY_EXPECTED_PAYLOAD || /(?:^|\n)\s*OPENCLAW_SANITY_PASS\s*(?:\n|$)/.test(raw);
  const leakage = OPENCLAW_EXACT_RESPONSE_FAILURE_PATTERN.test(raw);
  const bannerIgnored = hasExpectedPayload && payload === OPENCLAW_SANITY_EXPECTED_PAYLOAD && raw.split(/\r?\n/).filter((line) => asText(line, '')).length > 1 ? 'yes' : 'no';
  return {
    exactResponseStatus: hasExpectedPayload && !leakage ? 'passed' : (leakage ? 'failed' : 'unknown'),
    exactResponsePayload: payload || 'none',
    exactResponseExpected: OPENCLAW_SANITY_EXPECTED_PAYLOAD,
    cliBannerIgnored: bannerIgnored,
  };
}

function inferOpenClawRoute(rawText = '', workbenchInput = {}) {
  const explicit = asText(workbenchInput.openClawRouteId || workbenchInput.openClawRoute || workbenchInput.openClawRouteName || '', '').toLowerCase();
  const lower = `${rawText} ${explicit}`.toLowerCase();
  if (/qwen14|qwen:14b|stephanos-scout-qwen14/.test(lower)) return { routeId: 'cli-qwen14', routeLabel: 'stephanos-scout-qwen14 / qwen:14b' };
  if (/llama3\.2|llama3\.2:3b|ollama\/llama3\.2|stephanos-scout/.test(lower)) return { routeId: 'cli-llama3.2', routeLabel: 'stephanos-scout / llama3.2 CLI' };
  if (/dashboard|browser|openclaw dashboard/.test(lower)) return { routeId: 'dashboard', routeLabel: 'OpenClaw dashboard route' };
  return { routeId: 'dashboard', routeLabel: 'OpenClaw dashboard route' };
}

function judgeOpenClawTaskFrame(rawText = '', workbenchInput = {}) {
  const explicit = asText(workbenchInput.openClawTaskFrameStatus || workbenchInput.openClawRouteTaskFrameStatus || '', '').toLowerCase();
  if (['passed', 'failed', 'unknown'].includes(explicit)) {
    return { taskFrameStatus: explicit, taskFrameFailureReason: explicit === 'failed' ? 'Explicit route task-frame proof failed.' : 'none' };
  }
  const raw = truncateWorkbenchText(rawText);
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'NO') return { taskFrameStatus: 'failed', taskFrameFailureReason: 'Dashboard returned only "NO" when structured output was required.' };
  if (!raw) return { taskFrameStatus: 'unknown', taskFrameFailureReason: 'none' };
  if (raw.trim() === OPENCLAW_SANITY_EXPECTED_PAYLOAD || /OPENCLAW_SANITY_PASS/.test(raw)) {
    return { taskFrameStatus: 'exact-response-only', taskFrameFailureReason: 'Exact-response sanity proves only basic route obedience, not research, source-pack, or patch-planning task-frame adherence.' };
  }
  const hasSourcePackFrame = ['source_pack_status', 'summary', 'useful_facts', 'unknowns', 'stephanos_handoff_packet']
    .filter((field) => new RegExp(`(?:^|\n)\s*${field}\s*:`, 'i').test(raw)).length >= 5;
  if (hasSourcePackFrame) return { taskFrameStatus: 'passed', taskFrameFailureReason: 'none' };
  const hasStructuredPatchFrame = ['summary', 'likely files', 'required tests', 'risk level', 'requires codex fallback']
    .filter((field) => new RegExp(`(?:^|\\n)\\s*${field}\\s*:`, 'i').test(raw)).length >= 4;
  if (hasStructuredPatchFrame) return { taskFrameStatus: 'passed', taskFrameFailureReason: 'none' };
  return { taskFrameStatus: 'unknown', taskFrameFailureReason: 'No route-specific task-frame proof is available for this OpenClaw output.' };
}


function collectOpenClawStatusText(rawText = '', workbenchInput = {}) {
  return [
    rawText,
    workbenchInput.openClawDoctorText,
    workbenchInput.openClawStatusText,
    workbenchInput.openClawRouteStatusText,
    workbenchInput.openClawSessionStatusText,
  ].map((value) => truncateWorkbenchText(value || '')).filter(Boolean).join('\n');
}

function buildOpenClawRouteSessionDiagnostics(rawText = '', workbenchInput = {}) {
  const statusText = collectOpenClawStatusText(rawText, workbenchInput);
  const explicitSessionId = asText(workbenchInput.openClawSessionId || workbenchInput.openClawRouteSessionId || '', '');
  const routeSessionMatch = statusText.match(/\b(agent:[A-Za-z0-9_.:-]+)/i);
  const sessionId = explicitSessionId || routeSessionMatch?.[1] || 'unknown';
  const activeSessionCount = Number(statusText.match(/\b(\d+)\s+active sessions?\b/i)?.[1] || workbenchInput.openClawActiveSessionCount || 0);
  const oldSessionRisk = activeSessionCount > 1 || /\bold\s+(?:dashboard|qwen|sessions?)\b/i.test(statusText);
  const modelMismatchWarnings = uniqueWorkbenchItems(Array.from(statusText.matchAll(/\b(agent:[^\s:]+(?::[^\s:]+){1,3})[^\n]*?pinned\s+to\s+([^\s,.;]+)[^\n]*?(?:config\s+primary\s+is|primary\s+is)\s+([^\s,.;]+)/gi)).map((match) => `${match[1]} pinned ${match[2]} but primary ${match[3]}`), 6);
  const explicitPinned = asText(workbenchInput.openClawPinnedModel || workbenchInput.openClawRoutePinnedModel || '', '');
  const explicitPrimary = asText(workbenchInput.openClawConfigPrimaryModel || workbenchInput.openClawRoutePrimaryModel || '', '');
  const explicitMismatch = explicitPinned && explicitPrimary && explicitPinned !== explicitPrimary ? [`${sessionId} pinned ${explicitPinned} but primary ${explicitPrimary}`] : [];
  const mismatchWarnings = uniqueWorkbenchItems([...modelMismatchWarnings, ...explicitMismatch], 6);
  const plaintextTokenWarning = /plaintext[^\n]{0,80}(?:gateway\s+)?tokens?|(?:gateway\s+)?tokens?[^\n]{0,80}plaintext|openclaw\.json[^\n]{0,120}tokens?/i.test(statusText) ? 'yes' : 'no';
  const doctorNonBlockingFindings = [];
  if (/gateway\s+(?:local\s+)?(?:is\s+)?reachable|ws:\/\/127\.0\.0\.1:18789/i.test(statusText)) doctorNonBlockingFindings.push('gateway-local-reachable');
  if (/dashboard\s+(?:is\s+)?reachable|http:\/\/127\.0\.0\.1:18789/i.test(statusText)) doctorNonBlockingFindings.push('dashboard-reachable');
  if (/gateway service[^\n]*(?:not installed|missing)|node service[^\n]*(?:not installed|missing)|service[^\n]*(?:not installed|missing)/i.test(statusText)) doctorNonBlockingFindings.push('service-not-installed-intentional-no-autostart');
  if (/channels?[^\n]*(?:not configured|missing|unconfigured)/i.test(statusText)) doctorNonBlockingFindings.push('channels-not-configured-manual-local-ok');
  if (/command owner[^\n]*(?:not configured|missing|unconfigured)/i.test(statusText)) doctorNonBlockingFindings.push('command-owner-not-configured-manual-local-ok');
  if (/memory search[^\n]*(?:disabled|explicitly disabled)/i.test(statusText)) doctorNonBlockingFindings.push('memory-search-disabled-not-builder-blocker');
  const activeSessionContaminationRisk = oldSessionRisk || mismatchWarnings.length > 0 ? 'yes' : 'no';
  return {
    routeSessionId: sessionId,
    activeSessionCount: String(activeSessionCount || 0),
    activeSessionContaminationRisk,
    sessionContaminationRiskReason: activeSessionContaminationRisk === 'yes'
      ? `OpenClaw status indicates ${activeSessionCount || 'multiple/old'} active sessions or model pin overrides; require fresh route/session proof before Builder Mesh trust.`
      : 'none',
    routeModelPinned: explicitPinned || (mismatchWarnings[0]?.match(/ pinned ([^\s]+) but primary /)?.[1]) || 'unknown',
    routeModelConfiguredPrimary: explicitPrimary || (mismatchWarnings[0]?.match(/ but primary ([^\s]+)/)?.[1]) || 'unknown',
    routeModelMismatchDetected: mismatchWarnings.length > 0 ? 'yes' : 'no',
    modelPinMismatchWarnings: mismatchWarnings,
    plaintextTokenSecurityWarning: plaintextTokenWarning,
    doctorNonBlockingFindings: uniqueWorkbenchItems(doctorNonBlockingFindings, 8),
  };
}

function buildOpenClawSanityGate(rawText = '', workbenchInput = {}) {
  const raw = truncateWorkbenchText(rawText);
  const exactResponseInput = judgeOpenClawExactResponse(raw);
  const manualExactStatus = asText(workbenchInput.openClawExactResponseStatus || workbenchInput.openClawRouteExactResponseStatus || '', '').toLowerCase();
  const exactResponse = ['passed', 'failed', 'unknown'].includes(manualExactStatus)
    ? { ...exactResponseInput, exactResponseStatus: manualExactStatus, exactResponsePayload: manualExactStatus === 'passed' ? OPENCLAW_SANITY_EXPECTED_PAYLOAD : exactResponseInput.exactResponsePayload }
    : exactResponseInput;
  const route = inferOpenClawRoute(raw, workbenchInput);
  const taskFrame = judgeOpenClawTaskFrame(raw, workbenchInput);
  const sessionDiagnostics = buildOpenClawRouteSessionDiagnostics(raw, workbenchInput);
  const exactResponseFailureDetected = exactResponse.exactResponseStatus === 'failed' ? 'yes' : 'no';
  const templateLeakageDetected = raw && OPENCLAW_TEMPLATE_LEAKAGE_PATTERN.test(raw) ? 'yes' : 'no';
  const windowsPaths = extractOpenClawWindowsPaths(raw);
  const wrongRepoPaths = windowsPaths.filter((path) => !normalizeOpenClawPath(path).startsWith(OPENCLAW_CANONICAL_WINDOWS_REPO_PATH));
  const wrongRepoPathDetected = wrongRepoPaths.length > 0 ? 'yes' : 'no';
  const dashboardFailureExamples = route.routeId === 'dashboard' && raw.trim().toUpperCase() === 'NO' ? ['NO'] : [];
  const failureReasons = [];
  if (exactResponseFailureDetected === 'yes') failureReasons.push('Exact/template wrapper response failure detected in OpenClaw output.');
  if (templateLeakageDetected === 'yes') failureReasons.push('OpenClaw template/tool leakage detected.');
  if (wrongRepoPathDetected === 'yes') failureReasons.push(`OpenClaw claimed non-canonical repo path(s): ${wrongRepoPaths.join(', ')}.`);
  if (taskFrame.taskFrameStatus === 'failed') failureReasons.push(taskFrame.taskFrameFailureReason);
  const routeDefaultTrust = route.routeId === 'dashboard' || route.routeId === 'cli-qwen14' ? 'untrusted-by-default' : (route.routeId === 'cli-llama3.2' ? (exactResponse.exactResponseStatus === 'passed' ? 'basic-sanity-pass' : 'sanity-only') : 'unknown');
  const routeTrustOverride = asText(workbenchInput.openClawRouteTrustStatus || '', '').toLowerCase();
  const explicitRouteTrusted = routeTrustOverride === 'trusted';
  const routeSanityStatus = exactResponse.exactResponseStatus === 'passed' ? 'passed' : (failureReasons.length ? 'failed' : 'unknown');
  const routeTaskFrameStatus = taskFrame.taskFrameStatus;
  const sessionRiskClear = sessionDiagnostics.activeSessionContaminationRisk === 'no' && sessionDiagnostics.routeModelMismatchDetected === 'no';
  const routeTrustStatus = failureReasons.length
    ? 'failed'
    : (explicitRouteTrusted && routeSanityStatus === 'passed' && routeTaskFrameStatus === 'passed' && sessionRiskClear
      ? 'trusted-for-builder-routing'
      : routeDefaultTrust);
  const trustedForResearch = routeTrustStatus === 'trusted-for-builder-routing' ? 'yes' : 'no';
  const trustedForPatchPlanning = routeTrustStatus === 'trusted-for-builder-routing' && routeTaskFrameStatus === 'passed' ? 'yes' : 'no';
  const sanityStatus = raw ? (failureReasons.length ? 'failed' : (routeSanityStatus === 'passed' ? 'passed' : 'needs-route-proof')) : 'idle';
  const minimumViableRouteRecommendation = 'Use stephanos-scout / llama3.2 CLI for bounded source-pack processing only; OpenClaw cannot mutate files; do not trust dashboard or qwen14 for builder routing until route sanity and task-frame proof pass; Codex remains fallback implementation lane and operator approval is required before mutation.';
  const routeTrustReason = failureReasons.length
    ? failureReasons.join(' ')
    : (trustedForPatchPlanning === 'yes'
      ? 'Route has explicit trust plus route sanity, task-frame proof, and no session/model contamination warnings.'
      : (sessionDiagnostics.activeSessionContaminationRisk === 'yes' || sessionDiagnostics.routeModelMismatchDetected === 'yes'
        ? `${route.routeLabel} has session/model contamination risk; no Builder Mesh trust until a fresh route/session proof clears model pins and old sessions.`
        : (route.routeId === 'cli-llama3.2' && exactResponse.exactResponseStatus === 'passed'
        ? 'CLI llama3.2 is basic-sanity-pass from exact-response proof only; research and patch planning remain untrusted until task-frame proof passes.'
        : `${route.routeLabel} is ${routeDefaultTrust}; no global OpenClaw builder trust is granted.`)));
  return {
    sanityStatus,
    routeId: route.routeId,
    routeLabel: route.routeLabel,
    routeTrustStatus,
    routeTrustReason,
    routeSanityStatus,
    routeTaskFrameStatus,
    routeSessionId: sessionDiagnostics.routeSessionId,
    activeSessionCount: sessionDiagnostics.activeSessionCount,
    activeSessionContaminationRisk: sessionDiagnostics.activeSessionContaminationRisk,
    sessionContaminationRiskReason: sessionDiagnostics.sessionContaminationRiskReason,
    routeModelPinned: sessionDiagnostics.routeModelPinned,
    routeModelConfiguredPrimary: sessionDiagnostics.routeModelConfiguredPrimary,
    routeModelMismatchDetected: sessionDiagnostics.routeModelMismatchDetected,
    modelPinMismatchWarnings: sessionDiagnostics.modelPinMismatchWarnings,
    plaintextTokenSecurityWarning: sessionDiagnostics.plaintextTokenSecurityWarning,
    doctorNonBlockingFindings: sessionDiagnostics.doctorNonBlockingFindings,
    taskFrameFailureReason: taskFrame.taskFrameFailureReason,
    exactResponseStatus: exactResponse.exactResponseStatus,
    exactResponsePayload: exactResponse.exactResponsePayload,
    exactResponseExpected: exactResponse.exactResponseExpected,
    cliBannerIgnored: exactResponse.cliBannerIgnored,
    exactResponseFailureDetected,
    templateLeakageDetected,
    wrongRepoPathDetected,
    wrongRepoPaths,
    dashboardFailureExamples,
    failureReason: failureReasons.join(' ') || 'none',
    trustedForResearch,
    trustedForPatchPlanning,
    trustedForBuilderRouting: trustedForPatchPlanning,
    minimumViableRouteRecommendation,
    nextOperatorAction: failureReasons.length
      ? 'Do not route this OpenClaw result into Builder Mesh. Reset/clear the route/session/template and paste clean route sanity plus task-frame proof before retrying.'
      : (trustedForPatchPlanning === 'yes'
        ? 'OpenClaw route sanity and task-frame proof passed; continue with read-only Workbench intake and operator approval gates.'
        : minimumViableRouteRecommendation),
  };
}

function uniqueWorkbenchItems(items = [], limit = 16) {
  const seen = new Set();
  return items.map((item) => asText(item, '').replace(/[.)\]]+$/, '')).filter((item) => {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function extractWorkbenchFilePaths(text = '') {
  return uniqueWorkbenchItems(Array.from(String(text).matchAll(WORKBENCH_FILE_PATH_PATTERN)).map((match) => match[1]), 20);
}

function extractWorkbenchTestCommands(text = '') {
  const explicit = parseWorkbenchListField(text, ['required tests', 'tests required', 'tests recommended', 'recommended tests', 'tests']);
  const commands = Array.from(String(text).matchAll(WORKBENCH_TEST_COMMAND_PATTERN)).map((match) => match[1]);
  return uniqueWorkbenchItems([...explicit, ...commands], 16);
}

function normalizePatchPlannerRisk(risk = 'unknown') {
  const normalized = asText(risk, 'unknown').toLowerCase();
  if (normalized === 'critical') return 'high';
  return ['low', 'medium', 'high'].includes(normalized) ? normalized : 'unknown';
}

function inferPatchScope(text = '', files = []) {
  const lower = `${text}\n${files.join('\n')}`.toLowerCase();
  const docs = files.length > 0 && files.every((file) => /(^|\/)docs\/|\.mdx?$|\.txt$/.test(file.toLowerCase()));
  const ui = /stephanos-ui\/src|\.jsx$|\.tsx$|css|browser proof|ui|runtime/.test(lower);
  const backend = /server|backend|api\/|\.mjs|\.cjs|express|route/.test(lower) && !ui;
  if (docs) return 'docs-only';
  if (ui && backend) return 'mixed';
  if (ui) return 'ui-runtime';
  if (backend) return 'backend';
  if (files.length > 0) return 'source-only';
  return 'unknown';
}

function inferPlanSpecificity({ raw = '', files = [], tests = [], placeholderLeakageDetected = 'no' } = {}) {
  if (!raw) return 'unknown';
  if (placeholderLeakageDetected === 'yes') return 'low';
  const specificSignals = files.length + tests.length + (extractWorkbenchField(raw, ['summary', 'plan summary']) ? 1 : 0) + (extractWorkbenchField(raw, ['codex fallback reason']) ? 1 : 0);
  if (specificSignals >= 5) return 'high';
  if (files.length >= 1 && tests.length >= 1) return 'medium';
  if (WORKBENCH_GENERIC_PLAN_PATTERN.test(raw) || raw.length < 160) return 'low';
  return 'unknown';
}

function buildOpenClawPatchPlannerIntake(openClawResearch = null, workbenchInput = {}, openClawResearchIntake = {}, openClawSanityGate = {}) {
  const raw = openClawResearch?.rawText || truncateWorkbenchText(workbenchInput.openClawPatchPlanText || workbenchInput.openClawResearchText || '');
  const likelyFiles = uniqueWorkbenchItems([...(openClawResearch?.filesSuspected || []), ...extractWorkbenchFilePaths(raw)], 20);
  const requiredTests = extractWorkbenchTestCommands(raw);
  const forbiddenActionsDetected = (openClawResearch?.forbiddenActionsDetected || []).length > 0 ? 'yes' : 'no';
  const placeholderLeakageDetected = WORKBENCH_PLACEHOLDER_PATTERN.test(raw) || openClawResearchIntake?.placeholderLeakageDetected === 'yes' || openClawSanityGate?.templateLeakageDetected === 'yes' ? 'yes' : 'no';
  const browserProofRequired = parseWorkbenchYesNo(raw, ['browser proof required', 'browser proof', 'ui proof required'], /\b(ui|browser|visual|jsx|css|mission console|command deck)\b/i.test(raw) ? 'yes' : 'unknown');
  const riskLevel = normalizePatchPlannerRisk(parseWorkbenchRisk(raw));
  const patchScope = extractWorkbenchField(raw, ['patch scope', 'scope'])?.toLowerCase().match(/docs-only|source-only|ui-runtime|backend|mixed/)?.[0]
    || inferPatchScope(raw, likelyFiles);
  const planSpecificity = inferPlanSpecificity({ raw, files: likelyFiles, tests: requiredTests, placeholderLeakageDetected });
  const explicitFallback = parseWorkbenchYesNo(raw, ['requires codex fallback', 'codex fallback needed', 'codex fallback', 'codex required'], 'unknown');
  const judged = Boolean(workbenchInput.openClawPatchPlanJudgedAt || workbenchInput.patchPlanJudgedAt);
  const rawPresent = Boolean(raw);
  let patchPlannerStatus = rawPresent ? (judged ? 'needs-review' : 'plan-pasted') : (workbenchInput.openClawPatchPlanRequested || workbenchInput.openClawResearchRequested ? 'awaiting-plan' : 'idle');
  const sanityFailed = openClawSanityGate?.sanityStatus === 'failed';
  const hardFail = sanityFailed || forbiddenActionsDetected === 'yes' || placeholderLeakageDetected === 'yes' || planSpecificity === 'low';
  if (rawPresent && judged) {
    patchPlannerStatus = hardFail ? 'failed' : (planSpecificity === 'medium' || planSpecificity === 'high' ? 'passed' : 'needs-review');
  }
  let codexFallbackNeeded = explicitFallback;
  let codexFallbackReason = extractWorkbenchField(raw, ['codex fallback reason', 'fallback reason']) || 'unknown until a specific safe plan is pasted and judged.';
  if (hardFail) {
    codexFallbackNeeded = 'yes';
    codexFallbackReason = sanityFailed
      ? `OpenClaw sanity gate failed: ${openClawSanityGate.failureReason || 'untrusted OpenClaw output.'}`
      : (forbiddenActionsDetected === 'yes'
        ? 'Forbidden mutation/command language was detected in the OpenClaw plan.'
        : (placeholderLeakageDetected === 'yes'
          ? 'Placeholder/template leakage was detected in the OpenClaw plan.'
          : 'Plan specificity is too low for operator-ready handoff.'));
  } else if (explicitFallback === 'no' && rawPresent && (planSpecificity === 'medium' || planSpecificity === 'high')) {
    codexFallbackNeeded = 'no';
    codexFallbackReason = codexFallbackReason === 'unknown until a specific safe plan is pasted and judged.'
      ? 'OpenClaw supplied a specific read-only patch plan and did not request Codex fallback; operator approval is still required before mutation.'
      : codexFallbackReason;
  }
  const nextOperatorAction = patchPlannerStatus === 'idle'
    ? 'Copy the OpenClaw Patch Planner Prompt and run it externally/read-only.'
    : (patchPlannerStatus === 'awaiting-plan'
      ? 'Paste the OpenClaw patch-plan result into the existing Builder Workbench field.'
      : (patchPlannerStatus === 'plan-pasted'
        ? 'Run Patch Plan Intake Judgment before trusting the handoff.'
        : (patchPlannerStatus === 'passed'
          ? 'Review the cleaned handoff and operator approval checklist; trusted-for-patch remains no until approval.'
          : 'Reject or revise the OpenClaw patch plan before any implementation fallback.')));
  return {
    patchPlannerStatus,
    likelyFiles,
    requiredTests,
    riskLevel,
    patchScope,
    browserProofRequired,
    forbiddenActionsDetected,
    placeholderLeakageDetected,
    planSpecificity,
    codexFallbackNeeded,
    codexFallbackReason,
    mutationAuthority: 'locked',
    autoStart: 'forbidden',
    operatorApprovalRequired: 'yes',
    sanityStatus: openClawSanityGate?.sanityStatus || 'idle',
    trustedForPatch: 'no',
    nextOperatorAction,
    cleanedPatchPlanHandoff: [
      'OpenClaw Patch Plan Handoff (read-only, operator approval required)',
      `Status: ${patchPlannerStatus}`,
      `Risk level: ${riskLevel}`,
      `Patch scope: ${patchScope}`,
      `Likely files: ${likelyFiles.join(', ') || 'none'}`,
      `Required tests: ${requiredTests.join(', ') || 'none'}`,
      `Browser proof required: ${browserProofRequired}`,
      `Codex fallback needed: ${codexFallbackNeeded}`,
      `Codex fallback reason: ${codexFallbackReason}`,
      'Mutation authority: locked',
      'Auto-start: forbidden',
      'Trusted for patch: no until operator approval',
      `Next operator action: ${nextOperatorAction}`,
    ].join('\n'),
  };
}

export function parseBuilderWorkbenchResult(rawText = '', { source = 'local-ai-review' } = {}) {
  const raw = truncateWorkbenchText(rawText);
  const lower = raw.toLowerCase();
  const forbiddenActionsDetected = WORKBENCH_FORBIDDEN_ACTION_PATTERNS
    .filter((pattern) => pattern.test(raw))
    .map((pattern) => String(pattern));
  const fallbackSummary = raw.split(/\n+/).map((line) => asText(line, '')).find(Boolean) || 'No review text provided.';
  const riskLevel = parseWorkbenchRisk(raw);
  const requiresCodexFallback = parseWorkbenchYesNo(raw, ['requires codex fallback', 'codex fallback', 'codex required'], 'unknown');
  const requiresOperatorApproval = parseWorkbenchYesNo(raw, ['requires operator approval', 'operator approval', 'approval required'], 'yes') === 'no' ? 'yes' : 'yes';
  const proposedChangeType = extractWorkbenchField(raw, ['proposed change type', 'change type', 'plan type'])
    || (/\b(read[- ]only|review only|research only)\b/.test(lower) ? 'read-only-review' : (/\b(patch|implementation|fix)\b/.test(lower) ? 'patch-plan' : 'unknown'));
  return {
    source,
    resultStatus: raw ? (forbiddenActionsDetected.length ? 'blocked-forbidden-action' : 'parsed') : 'empty',
    safeForWorkbench: Boolean(raw) && forbiddenActionsDetected.length === 0,
    summary: extractWorkbenchField(raw, ['summary', 'finding summary', 'review summary', 'plan summary']) || fallbackSummary.slice(0, 320),
    filesSuspected: parseWorkbenchListField(raw, ['files suspected', 'suspected files', 'files', 'target files']),
    proposedChangeType,
    riskLevel,
    testsRecommended: parseWorkbenchListField(raw, ['tests recommended', 'recommended tests', 'tests']),
    confidence: parseWorkbenchConfidence(raw),
    requiresCodexFallback,
    requiresOperatorApproval,
    forbiddenActionsDetected,
    rawText: raw,
  };
}

function buildBuilderWorkbenchProjection({ builderMeshBase = {}, workbenchInput = {}, implementationRequested = false, supportSnapshot = {} } = {}) {
  const localRaw = asText(workbenchInput.localAiReviewText || workbenchInput.localAiReviewResult || workbenchInput.localAiRunnerRawResponse || '', '');
  const openClawRaw = asText(workbenchInput.openClawResearchText || workbenchInput.openClawResearchResult || workbenchInput.openClawPatchPlanText || '', '');
  const localAiRunnerRawResponse = truncateWorkbenchText(workbenchInput.localAiRunnerRawResponse || localRaw || '');
  const runnerParseStatusInput = asText(workbenchInput.localAiRunnerParseResultStatus || '', '');
  const runnerParseAttempted = asText(workbenchInput.localAiRunnerParseAttempted || (localAiRunnerRawResponse ? 'yes' : 'no'), 'no');
  const runnerParseSucceeded = runnerParseStatusInput === 'parsed' || (!runnerParseStatusInput && localRaw && !workbenchInput.localAiRunnerRawResponse);
  const localAiReviewSource = workbenchInput.localAiRunnerRawResponse ? 'local-ai-runner' : 'local-ai-review';
  const localAiReview = localRaw && runnerParseSucceeded ? parseBuilderWorkbenchResult(localRaw, { source: localAiReviewSource }) : null;
  const localAiRunnerParseInputLength = localAiRunnerRawResponse.length || localRaw.length || 0;
  const localAiRunnerParseResultStatus = runnerParseStatusInput
    || (localAiReview ? (localAiReview.safeForWorkbench ? 'parsed' : (localAiReview.resultStatus || 'malformed-or-blocked')) : (localAiRunnerRawResponse ? 'malformed-or-unparsed' : 'empty'));
  const localAiRunnerStatus = asText(workbenchInput.localAiRunnerStatus || (workbenchInput.localAiRunnerRequested ? 'running' : 'idle'), 'idle');
  const localAiRunnerLastRunResult = asText(workbenchInput.localAiRunnerLastRunResult || (localAiReview ? localAiReview.resultStatus : 'none'), 'none');
  const localAiRunnerLastRunBlockedReason = asText(workbenchInput.localAiRunnerLastRunBlockedReason || (localAiReview && !localAiReview.safeForWorkbench ? 'Local AI response failed Workbench safety parsing.' : ''), '');
  const localAiRunnerErrorMessage = asText(workbenchInput.localAiRunnerErrorMessage || '', '');
  const localAiRunnerDispatchAttempted = asText(workbenchInput.localAiRunnerDispatchAttempted || (workbenchInput.localAiReviewRequested ? 'yes' : 'no'), 'no');
  const localAiRunnerRequestSent = asText(workbenchInput.localAiRunnerRequestSent || 'no', 'no');
  const openClawSourcePackDiagnostics = {
    textTextareaMounted: asText(workbenchInput.openClawSourcePackTextTextareaMounted || 'unknown', 'unknown'),
    outputTextareaMounted: asText(workbenchInput.openClawSourcePackOutputTextareaMounted || 'unknown', 'unknown'),
    textDomValueLength: asText(workbenchInput.openClawSourcePackTextDomValueLength ?? '0', '0'),
    outputDomValueLength: asText(workbenchInput.openClawSourcePackOutputDomValueLength ?? '0', '0'),
    outputOnChangeFired: asText(workbenchInput.openClawSourcePackOutputOnChangeFired || 'no', 'no'),
    outputStateLength: asText(workbenchInput.openClawSourcePackOutputStateLength ?? String((workbenchInput.openClawSourcePackOutput || '').length), '0'),
    judgmentButtonClicked: asText(workbenchInput.openClawSourcePackJudgmentButtonClicked || 'no', 'no'),
    judgmentReadOutputLength: asText(workbenchInput.openClawSourcePackJudgmentReadOutputLength ?? '0', '0'),
    judgmentReadSource: asText(workbenchInput.openClawSourcePackJudgmentReadSource || 'not-run', 'not-run'),
    activeSurface: asText(workbenchInput.openClawSourcePackActiveSurface || workbenchInput.panelId || 'missionConsolePanel', 'missionConsolePanel'),
    runnerRenderGate: asText(workbenchInput.openClawSourcePackRunnerRenderGate || 'unknown', 'unknown'),
    runnerRenderBlocker: asText(workbenchInput.openClawSourcePackRunnerRenderBlocker || 'unknown', 'unknown'),
    parentPanelId: asText(workbenchInput.openClawSourcePackParentPanelId || workbenchInput.panelId || 'missionConsolePanel', 'missionConsolePanel'),
    controlsMountedCount: asText(workbenchInput.openClawSourcePackControlsMountedCount ?? '0', '0'),
  };
  const rawOpenClawSourcePackRunner = buildOpenClawSourcePackRunnerProjection({
    rawResult: workbenchInput.openClawSourcePackOutput || workbenchInput.openClawSourcePackResult || '',
    sourcePackText: workbenchInput.openClawSourcePackText || '',
    openClawSourcePackJudgedAt: workbenchInput.openClawSourcePackJudgedAt || '',
    openClawSourcePackLastJudgedText: workbenchInput.openClawSourcePackJudgedAt ? (workbenchInput.openClawSourcePackLastJudgedText ?? '') : (workbenchInput.openClawSourcePackLastJudgedText ?? workbenchInput.openClawSourcePackText ?? ''),
    openClawSourcePackLastJudgedOutput: workbenchInput.openClawSourcePackJudgedAt ? (workbenchInput.openClawSourcePackLastJudgedOutput ?? '') : (workbenchInput.openClawSourcePackLastJudgedOutput ?? workbenchInput.openClawSourcePackOutput ?? workbenchInput.openClawSourcePackResult ?? ''),
  });
  const openClawSourcePackRunner = openClawSourcePackDiagnostics.outputTextareaMounted === 'no'
    ? {
      ...rawOpenClawSourcePackRunner,
      sourcePackStatus: 'needs-output',
      nextOperatorAction: `Source Pack Output textarea is not mounted in the active Builder Workbench surface; render blocker: ${openClawSourcePackDiagnostics.runnerRenderBlocker || 'unknown'}.`,
      trustedForCanon: 'no',
      trustedForResearch: 'no',
    }
    : rawOpenClawSourcePackRunner;
  const openClawResearchIntake = buildOpenClawWebResearchIntakeProjection({ rawResult: openClawRaw, requestedTaskFrame: 'vr-research' });
  const openClawSanityGate = buildOpenClawSanityGate(openClawRaw || workbenchInput.openClawSourcePackOutput || workbenchInput.openClawSourcePackResult || '', workbenchInput);
  const sourcePackEligibility = isOpenClawSourcePackRouteEligible({
    routeId: openClawSanityGate.routeId,
    routeLabel: openClawSanityGate.routeLabel,
    exactResponseStatus: openClawSanityGate.exactResponseStatus,
    routeTaskFrameStatus: openClawSanityGate.routeTaskFrameStatus,
    sourcePackStatus: openClawSourcePackRunner.sourcePackStatus,
  });
  const openClawResearch = openClawRaw ? parseBuilderWorkbenchResult(openClawRaw, { source: 'openclaw-research-patch-plan' }) : null;
  const openClawPatchPlanner = buildOpenClawPatchPlannerIntake(openClawResearch, workbenchInput, openClawResearchIntake, openClawSanityGate);
  const openClawWorkspaceHygiene = buildOpenClawWorkspaceHygieneProjection({
    ...supportSnapshot,
    ...workbenchInput,
    diagnosticText: [
      supportSnapshot.diagnosticText,
      supportSnapshot.housekeepOutput,
      workbenchInput.openClawWorkspaceDiagnosticText,
      workbenchInput.openClawResearchText,
      workbenchInput.openClawPatchPlanText,
      workbenchInput.openClawSourcePackText,
      workbenchInput.openClawSourcePackOutput,
    ].filter(Boolean).join('\n'),
  });
  const parsedResults = [localAiReview, openClawResearch].filter(Boolean);
  const forbidden = parsedResults.flatMap((result) => result.forbiddenActionsDetected || []);
  const safeResults = parsedResults.filter((result) => result.safeForWorkbench && (!String(result.source || '').includes('openclaw') || openClawSanityGate.trustedForBuilderRouting === 'yes'));
  const patchPlanPresent = Boolean(openClawResearch && /patch|plan|implementation|fix/i.test(openClawResearch.proposedChangeType || openClawResearch.rawText || '')) || ['plan-pasted', 'passed', 'failed', 'needs-review'].includes(openClawPatchPlanner.patchPlannerStatus);
  const patchPlanRisk = openClawPatchPlanner.riskLevel !== 'unknown' ? openClawPatchPlanner.riskLevel : (openClawResearch?.riskLevel || localAiReview?.riskLevel || 'unknown');
  const resultRequestsFallback = parsedResults.some((result) => result.requiresCodexFallback === 'yes') || openClawPatchPlanner.codexFallbackNeeded === 'yes';
  const resultDeniesFallback = safeResults.length > 0 && parsedResults.every((result) => result.requiresCodexFallback !== 'yes') && openClawPatchPlanner.codexFallbackNeeded !== 'yes';
  let codexFallbackStillNeeded = Boolean(builderMeshBase.recommendedBuilder === 'codex');
  let codexFallbackReason = builderMeshBase.codexReason || 'Codex fallback remains optional unless a safe workbench result proves it is needed.';
  if (forbidden.length > 0) {
    codexFallbackStillNeeded = true;
    codexFallbackReason = 'Workbench intake detected forbidden mutation/autonomy language; use operator review and Codex fallback only after explicit approval.';
  } else if (resultRequestsFallback) {
    codexFallbackStillNeeded = true;
    codexFallbackReason = 'Workbench result says local/OpenClaw cannot safely proceed without Codex fallback.';
  } else if (resultDeniesFallback) {
    codexFallbackStillNeeded = false;
    codexFallbackReason = 'Safe workbench review/patch plan is present and does not require Codex fallback; operator approval checklist is the next gate.';
  }
  const blockers = [];
  const warnings = [];
  if (forbidden.length > 0) blockers.push('Forbidden mutation/autonomy language detected in pasted workbench result.');
  if (openClawResearchIntake.forbiddenLeakageDetected === 'yes') blockers.push('OpenClaw Web Research Intake detected forbidden mutation/command/autostart language.');
  if (openClawResearchIntake.placeholderLeakageDetected === 'yes') blockers.push('OpenClaw Web Research Intake detected placeholder/template leakage.');
  if (openClawResearchIntake.taskFrameAdherence === 'fail') blockers.push('OpenClaw Web Research Intake detected task-frame drift.');
  if (openClawSanityGate.sanityStatus === 'failed') blockers.push('OpenClaw Sanity Gate failed; block OpenClaw from Builder Mesh routing until the session/template is reset.');
  if (openClawWorkspaceHygiene.workspaceBlocksIgnition === 'yes') blockers.push('OpenClaw workspace dirt is blocking ignition; stash only the known OpenClaw workspace paths before routing OpenClaw again.');
  if (openClawPatchPlanner.patchPlannerStatus === 'failed') blockers.push('OpenClaw Patch Planner intake failed; revise plan before handoff.');
  if (openClawSourcePackRunner.sourcePackStatus === 'failed') blockers.push('OpenClaw Source Pack Runner intake failed; reset the route/session or use the stricter prompt.');
  if (openClawSourcePackRunner.sourcePackStatus === 'stale') blockers.push('OpenClaw Source Pack Runner judgment is stale; rerun judgment before routing research, canon, or planning trust.');
  if (patchPlanPresent && !['low', 'medium'].includes(patchPlanRisk)) warnings.push('Patch plan risk is not low/medium; operator should review scope before any mutation approval.');
  if (openClawPatchPlanner.patchPlannerStatus === 'needs-review') warnings.push('OpenClaw Patch Planner intake needs operator review before fallback decisions.');
  if (openClawSourcePackRunner.sourcePackStatus === 'needs-review') warnings.push('OpenClaw Source Pack Runner intake needs operator review before research routing.');
  warnings.push(...asList(openClawResearchIntake.warnings));
  if (!parsedResults.length) warnings.push('No local AI/OpenClaw workbench result has been pasted yet.');
  const nextBestAction = openClawWorkspaceHygiene.workspaceBlocksIgnition === 'yes'
    ? openClawWorkspaceHygiene.workspaceNextOperatorAction
    : (openClawSourcePackRunner.sourcePackStatus === 'failed'
    ? openClawSourcePackRunner.nextOperatorAction
    : (forbidden.length > 0
    ? 'Reject the pasted result for mutation authority and request a read-only review/patch plan only.'
    : (safeResults.length > 0
      ? 'Review safe workbench findings, then use the Operator Approval Checklist before any patch is applied.'
      : 'Copy Local AI/OpenClaw packets and paste bounded read-only results into the Workbench.')));
  return {
    workbenchStatus: 'ready',
    activePacketType: workbenchInput.activePacketType || (openClawRaw ? 'openclaw-research-patch-plan' : (localRaw ? 'local-ai-review' : 'none')),
    activePacketTarget: workbenchInput.activePacketTarget || builderMeshBase.recommendedBuilder || 'zero-cost-builder-mesh',
    localAiReviewRequested: workbenchInput.localAiReviewRequested === true || Boolean(workbenchInput.localAiReviewRequestedAt) || false,
    localAiRunnerStatus,
    localAiRunnerSelectedModel: asText(workbenchInput.localAiRunnerSelectedModel, 'none'),
    localAiRunnerAvailableModels: asList(workbenchInput.localAiRunnerAvailableModels),
    localAiRunnerLastRunResult: forbidden.length > 0 && localAiReview ? 'blocked' : localAiRunnerLastRunResult,
    localAiRunnerLastRunBlockedReason: forbidden.length > 0 && localAiReview ? 'Forbidden mutation/autonomy language detected in Local AI Runner response.' : (localAiRunnerLastRunBlockedReason || 'none'),
    localAiRunnerErrorMessage: localAiRunnerErrorMessage || 'none',
    localAiRunnerDispatchAttempted,
    localAiRunnerRequestSent,
    localAiRunnerParsedResultPresent: Boolean(localAiReview && localAiReview.safeForWorkbench),
    localAiRunnerResponseRetained: asText(workbenchInput.localAiRunnerResponseRetained || (localAiRunnerRawResponse ? 'yes' : 'no'), 'no'),
    localAiRunnerParseAttempted: runnerParseAttempted,
    localAiRunnerParseInputLength,
    localAiRunnerParseResultStatus,
    localAiRunnerRawResponse,
    workbenchAnswerContextUsed: 'no',
    workbenchAnswerSource: 'builder-workbench-projection',
    workbenchParsedResultSource: localAiReview?.source || openClawResearch?.source || 'none',
    workbenchOutputViewportStatus: 'usable-css-hooks-present',
    openClawResearchRequested: workbenchInput.openClawResearchRequested === true || Boolean(workbenchInput.openClawResearchRequestedAt) || false,
    openClawWebResearchPrompt: OPENCLAW_VR_RESEARCH_PROMPT,
    openClawPatchPlannerPrompt: OPENCLAW_PATCH_PLANNER_PROMPT,
    openClawSourcePackPrompt: OPENCLAW_SOURCE_PACK_CLI_PROMPT,
    openClawSourcePackTemplate: OPENCLAW_SOURCE_PACK_TEMPLATE,
    openClawSourcePackDiagnostics,
    openClawSourcePackRunner: { ...openClawSourcePackRunner, routeEligibility: sourcePackEligibility, diagnostics: openClawSourcePackDiagnostics },
    openClawWebResearchIntake: openClawResearchIntake,
    openClawSanityGate,
    openClawPatchPlanner,
    openClawWorkspaceHygiene,
    localAiReviewResultPresent: Boolean(localAiReview),
    openClawResearchResultPresent: Boolean(openClawResearch),
    openClawSourcePackResultPresent: openClawSourcePackRunner.sourcePackResultPresent === 'yes',
    patchPlanPresent,
    patchPlanRisk,
    approvalRequiredBeforePatch: true,
    codexFallbackStillNeeded,
    codexFallbackReason,
    nextBestAction,
    blockers,
    warnings,
    localAiReview,
    openClawResearch,
    patchPlanSummary: openClawResearch?.summary || 'none',
    likelyFiles: openClawPatchPlanner.likelyFiles,
    requiredTests: openClawPatchPlanner.requiredTests,
    verdict: codexFallbackStillNeeded ? 'fallback-needed-or-hold' : (safeResults.length ? 'operator-review-before-patch' : 'awaiting-results'),
    implementationRequested,
  };
}

const PROTECTED_CANON_CLAUSE_CATALOG = Object.freeze({
  COMMAND_DECK: [
    'Preserve Answer Delivery Contract.',
    'Preserve final_assistant_message_id → deliveryAnchoredAssistantAnswerId binding.',
    'Preserve data-assistant-answer-id, data-answer-role, data-answer-final, and data-delivery-anchored attributes.',
    'Preserve delivered-answer reveal/scroll diagnostics.',
    'Preserve inner answer-history scroll.',
    'Preserve no-jump nearest outer reveal behavior.',
    'Preserve tuned viewport clamp: min-height clamp(20rem, 46vh, 34rem) and max-height clamp(28rem, 66vh, 50rem).',
    'Preserve composer/input/execute visibility.',
    'Preserve canonical copy button behavior with green success state after successful clipboard write.',
  ],
  IGNITION: [
    'Preserve Windows desktop Ignite button path: Launch-Stephanos-Local.cmd → Launch-Stephanos-Local.ps1 → npm run stephanos:ignite.',
    'Preserve automatic Housekeeper preflight before normal ignition startup.',
    'Preserve safe generated/runtime cleanup only.',
    'Preserve source dirt, hard-block, secrets, unknown binaries blocking startup.',
    'Preserve build + verify in ignition path.',
    'Preserve compact default ignition output.',
    'Preserve filesystem debug crawl only behind --debug or STEPHANOS_DEBUG=1.',
    'Preserve vite-dev path behavior.',
  ],
  PR_HYGIENE: [
    'Preserve source-only PR rule.',
    'Forbid apps/stephanos/dist/**, runtime/**, node_modules/**, secrets/**, root data/** unless explicitly allowlisted.',
    'Never use git add .',
    'Require npm run stephanos:guard:pr-clean.',
    'Require generated dist/runtime dirt cleanup after build/verify.',
  ],
  PROVIDER_ROUTING: [
    'Preserve requested vs selected vs executable vs actual provider separation.',
    'Preserve route reachability vs usability vs browser compatibility separation.',
    'Preserve stale/fresh answer truth.',
    'Preserve zero-cost fresh capability rules.',
    'Preserve truthful degradation when fresh route is unavailable.',
  ],
  MEMORY_RETRIEVAL: [
    'Preserve memory write gates.',
    'Preserve provenance requirements for durable memory.',
    'Preserve retrieval as context augmentation only.',
    'Do not promote transient/freshness-sensitive facts into durable memory without approval.',
    'Preserve operator approval for important durable project-law changes.',
  ],
  MISSION_BRAIN: [
    'Preserve Harness Agent as read-only/adjudication only.',
    'Preserve Operator Relief / Mission Brain as the existing surface.',
    'Do not create duplicate panes or parallel authority.',
    'Preserve operator as final merge approver.',
    'Preserve merge recommendation as advisory, not automatic merge.',
  ],
});

function deriveProtectedSubsystems(changedFiles = []) {
  const files = asList(changedFiles).map((f) => String(f).toLowerCase());
  const subsystems = new Set();
  if (files.some((f) => /commanddeck|aiconsole|answerdelivery|useaiconsole|missioncommanddeck/.test(f))) subsystems.add('COMMAND_DECK');
  if (files.some((f) => /ignite-stephanos-local|windows-launcher|launch-stephanos-local|housekeep|vite-dev/.test(f))) subsystems.add('IGNITION');
  if (files.some((f) => /provider|backend|routing|route/.test(f))) subsystems.add('PROVIDER_ROUTING');
  if (files.some((f) => /memory|retrieval|session/.test(f))) subsystems.add('MEMORY_RETRIEVAL');
  if (files.some((f) => /operatorrelief|operator-relief|missionconsole|mission-console|harness/.test(f))) subsystems.add('MISSION_BRAIN');
  if (files.length > 0) subsystems.add('PR_HYGIENE');
  return Array.from(subsystems);
}

function deriveProtectedCanonClauses({ riskLevel = 'low', changedFiles = [] } = {}) {
  const subsystems = deriveProtectedSubsystems(changedFiles);
  const clauseKeys = new Set(subsystems);
  const hasUnknownSubsystem = clauseKeys.size === 0 || (clauseKeys.size === 1 && clauseKeys.has('PR_HYGIENE'));
  const unknownBuildOrchestrationContext = asList(changedFiles).length === 0;

  if (riskLevel === 'high' && hasUnknownSubsystem) {
    ['PR_HYGIENE', 'MISSION_BRAIN', 'COMMAND_DECK', 'IGNITION'].forEach((k) => clauseKeys.add(k));
    if (unknownBuildOrchestrationContext) ['PROVIDER_ROUTING', 'MEMORY_RETRIEVAL'].forEach((k) => clauseKeys.add(k));
  }

  const protectedCanonClauses = Array.from(clauseKeys).flatMap((k) => PROTECTED_CANON_CLAUSE_CATALOG[k] || []);
  const fallbackApplied = riskLevel === 'high' && hasUnknownSubsystem && protectedCanonClauses.length > 0;
  const protectedCanonWarning = fallbackApplied
    ? 'Affected subsystem unknown; conservative protected canon fallback applied.'
    : (protectedCanonClauses.length === 0 ? 'Protected canon clauses are empty; operator review required before high-risk execution.' : '');

  return { protectedCanonClauses, protectedSubsystems: Array.from(clauseKeys), protectedCanonWarning, fallbackApplied, hasUnknownSubsystem };
}

function truncateText(value, max = MAX_GAP_REASON_LENGTH) {
  const text = asText(value, '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}


export const MUSIC_FAILURE_SCENARIO_PACK = Object.freeze({
  spotify_resolver_not_configured: { evidenceType: 'runtime/provider_status', likelyBlocker: 'Spotify resolver missing or disconnected.', requiredProof: 'Provider configured + Spotify open link works.', nextAction: 'Configure Spotify resolver and rerun browser smoke.', mergeSafe: false, lessonCandidate: 'Spotify resolver must be configured before claiming music proof.' },
  ai_suggested_fake_track: { lessonCandidate:'AI-generated music candidates remain unverified until catalog validation.' },
  build_journey_froze: { requiredProof:'Build Journey completes in browser without freeze.' },
  wrong_spotify_url: { lessonCandidate:'Spotify search URLs must never become playable refs.' },
  false_canon_invention: { lessonCandidate:'Canon means extract from working surface first.' },
});

function buildEvidenceGaps({ testsRequired, testsPassed, parsed, browserRequired, browserMissing, runtimeEvidence, verification, operatorDecisions, repairPromptAvailable, codexChangedFiles }) {
  const gaps = [];
  if (testsRequired.length > 0 && testsPassed === 0) gaps.push({ id: 'targeted-tests-missing', severity: 'high', label: 'Targeted tests missing', reason: 'Mission marks targeted tests as required but no runs are recorded.', requiredAction: 'run-targeted-tests', source: 'intent_to_build/proof_of_done' });
  if (!parsed.buildRun) gaps.push({ id: 'build-missing', severity: 'high', label: 'Build evidence missing', reason: 'Build run evidence is missing.', requiredAction: 'run-build', source: 'proof_of_done.verificationJudge' });
  if (!parsed.verifyRun) gaps.push({ id: 'verify-missing', severity: 'high', label: 'Verify evidence missing', reason: 'Verify run evidence is missing.', requiredAction: 'run-verify', source: 'proof_of_done.verificationJudge' });
  if (browserRequired && browserMissing.length > 0) gaps.push({ id: 'browser-proof-missing', severity: 'high', label: 'Browser proof missing', reason: `Missing ${browserMissing.length} required browser proof checks.`, requiredAction: 'run-browser-proof', source: 'proof_of_done.browserChecksObserved' });
  if (runtimeEvidence.routeStatus === 'unknown' || runtimeEvidence.providerStatus === 'unknown') gaps.push({ id: 'runtime-status-unknown', severity: 'medium', label: 'Runtime/route truth incomplete', reason: 'Route/provider truth is unknown.', requiredAction: 'collect-runtime-snapshot', source: 'support_snapshot.runtimeStatus' });
  if (runtimeEvidence.consoleErrors.length > 0) gaps.push({ id: 'console-runtime-errors', severity: 'high', label: 'Console/runtime errors detected', reason: truncateText(runtimeEvidence.consoleErrors.join(' | ')), requiredAction: 'request-codex-repair', source: 'proof_of_done.consoleErrors' });
  if (verification.mergeReadyCandidate && operatorDecisions.length === 0) gaps.push({ id: 'operator-decision-missing', severity: 'medium', label: 'Operator decision missing', reason: 'Merge candidate still requires explicit operator decision.', requiredAction: 'approve-merge', source: 'operator_decision_queue' });
  if (gaps.some((g) => g.id.includes('missing') || g.id.includes('errors')) && !repairPromptAvailable) gaps.push({ id: 'repair-prompt-missing', severity: 'medium', label: 'Repair prompt missing', reason: 'Evidence indicates repair flow but no repair prompt is available.', requiredAction: 'review-repair-prompt', source: 'operator_relief' });
  if (codexChangedFiles.some((f) => /(?:memory|session|event).*\.(?:json|log)$/i.test(f))) gaps.push({ id: 'local-runtime-files-staged', severity: 'high', label: 'Local runtime files staged', reason: 'Staged files appear to include local runtime memory/event artifacts.', requiredAction: 'remove-local-runtime-files', source: 'pr_evidence.changedFiles' });
  return gaps;
}

function deriveAiConsoleAutoscrollProof(supportSnapshot = {}) {
  const scroll = supportSnapshot?.aiConsoleScrollDiagnostics || supportSnapshot?.supportSnapshot?.aiConsoleScrollDiagnostics || {};
  const checks = [
    ['one answer pane', Number(scroll.answerPaneCount) === 1],
    ['latest final assistant answer present', scroll.latestFinalAssistantAnswerPresent === true],
    ['autoscroll requested', scroll.requested === 'yes'],
    ['request reason final-assistant-answer-rendered', scroll.requestReason === 'final-assistant-answer-rendered'],
    ['target kind latest-assistant-answer-pane', scroll.targetKind === 'latest-assistant-answer-pane'],
    ['target found', scroll.targetFound === 'yes'],
    ['container found', scroll.containerFound === 'yes'],
    ['container scrollable', scroll.containerScrollable === 'yes'],
    ['scroll method container-scroll', scroll.scrollMethod === 'container-scroll'],
    ['scroll completed', scroll.scrollCompleted === 'yes'],
    ['skip reason none', scroll.skipReason === 'none'],
    ['no stale/pending/prompt-row targeting', scroll.targetHasPromptRow !== 'yes' && scroll.targetHasPendingRow !== 'yes' && scroll.targetHasStaleRow !== 'yes'],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);
  return { complete: missing.length === 0, missing, source: 'support_snapshot.aiConsoleScrollDiagnostics' };
}

function buildAgentWorkRoutingProjection({ missionBrainNextAction = {}, missionSpec = {}, supportSnapshot = {}, harnessAgentProjection = {} } = {}) {
  const nextAction = asText(missionBrainNextAction.nextBestAction, '').toLowerCase();
  const gaps = asList(missionBrainNextAction.openEvidenceGaps || []);
  const blockers = [];
  const warnings = [];
  const browserProofNeeded = /browser|proof|visual/.test(nextAction) || gaps.some((gap) => String(gap.id || '').includes('browser'));
  const routeUnknown = /unknown|n\/a/.test(asText(supportSnapshot?.routeStatus, 'unknown'));
  const hasHarnessClauses = !harnessAgentProjection || Object.keys(harnessAgentProjection).length === 0
    ? true
    : asList(harnessAgentProjection.protectedCanonClauses).length > 0;
  const hasForbiddenFiles = asList(harnessAgentProjection.forbiddenFiles).length > 0;
  const openClawExecutionReady = false;

  if (!hasHarnessClauses) blockers.push('Harness Agent protected canon clauses missing.');
  if (routeUnknown) warnings.push('Runtime route/provider truth is partially unknown.');
  if (hasForbiddenFiles) warnings.push('Forbidden file scopes are present and must remain untouched.');

  let recommendedRoute = 'codex';
  let workRoutingStatus = 'ready';
  let recommendedRouteReason = 'Bounded source/test/projection work packet is available and approval-gated for Codex.';

  if (!hasHarnessClauses) {
    recommendedRoute = 'hold';
    workRoutingStatus = 'blocked';
    recommendedRouteReason = 'Hold until Harness Agent clauses and proof boundaries are present.';
  } else if (browserProofNeeded) {
    recommendedRoute = 'manual-operator';
    workRoutingStatus = 'degraded';
    recommendedRouteReason = 'Manual operator/browser proof is required before final merge claims.';
  } else if (/audit|discover|map|research/.test(nextAction)) {
    recommendedRoute = 'openclaw-research';
    workRoutingStatus = 'degraded';
    recommendedRouteReason = 'Task is reconnaissance/audit oriented and should remain read-only.';
  }

  const codexReady = recommendedRoute === 'codex' ? 'yes' : 'no';
  const openClawResearchReady = recommendedRoute === 'openclaw-research' ? 'yes' : 'no';
  if (!openClawExecutionReady) warnings.push('OpenClaw execution: not ready; research/audit only unless policy harness approves.');

  const missionSummary = asText(missionBrainNextAction.missionObjective, missionSpec.objective || 'Mission summary unavailable.');
  const smallestNextWorkPacket = asText(missionBrainNextAction.nextBestAction, 'Review mission evidence and prepare bounded patch packet.');
  const requiredProof = browserProofNeeded
    ? ['targeted tests', 'build', 'verify', 'browser proof checklist', 'pr-clean']
    : ['targeted tests', 'build', 'verify', 'pr-clean'];
  const protectedSubsystems = Array.from(new Set(asList(harnessAgentProjection.protectedSubsystems).concat(['MISSION_BRAIN', 'COMMAND_DECK', 'IGNITION'])));
  const allowedScopeSummary = 'Bounded source-only edits in mission/operator-relief projections, mission console surface, context wiring, and tests.';
  const forbiddenScopeSummary = 'No dist/runtime/root-data/node_modules/secrets; no provider/backend execution routing rewires; no new panes; no branch choreography burden.';
  const nextOperatorAction = recommendedRoute === 'hold'
    ? 'Hold and restore proof/canon boundaries first.'
    : 'Approve/copy the bounded Codex packet for the smallest integration step, or hold. Do not manually juggle branches.';

  const codexPacket = {
    missionSummary,
    smallestNextWorkPacket,
    allowedFiles: asList(harnessAgentProjection.allowedFileScopes),
    forbiddenFiles: asList(harnessAgentProjection.forbiddenFileScopes),
    harnessAgentClauses: asList(harnessAgentProjection.protectedCanonClauses),
    requiredTests: asList(harnessAgentProjection.requiredTests).length ? asList(harnessAgentProjection.requiredTests) : ['node --test tests/operator-relief-projection.test.mjs tests/mission-console-operator-relief-panel.test.mjs', 'npm run stephanos:build', 'npm run stephanos:verify'],
    requiredProof,
    definitionOfDone: asList(harnessAgentProjection.definitionOfDone),
    finalReportRequirements: asList(harnessAgentProjection.finalReportRequirements),
    operatorWorkflowPreference: 'main-first/main-only',
  };
  const openClawResearchPacket = {
    researchObjective: 'Read-only audit/recon for mission routing and proof state; no execution.',
    allowedReadOnlyScope: ['stephanos-ui/src/state/**', 'stephanos-ui/src/components/**', 'tests/**', 'scripts/**'],
    forbiddenMutations: ['no writes', 'no branch/merge actions', 'no provider/backend execution changes'],
    proofToCollect: requiredProof,
    approvalGateReminder: 'Operator approval required before any execution-oriented handoff.',
    stopConditions: ['scope ambiguity', 'canon/proof contradiction', 'forbidden file touch detected'],
    killSwitchPolicyReminder: 'OpenClaw execution remains blocked until explicit policy/readiness true.',
  };

  return {
    workRoutingStatus,
    recommendedRoute,
    recommendedRouteReason,
    codexReady,
    openClawResearchReady,
    openClawExecutionReady: openClawExecutionReady ? 'yes' : 'no',
    operatorApprovalRequired: 'yes',
    approvalRequired: true,
    riskLevel: asText(missionBrainNextAction.riskLevel, 'medium'),
    protectedSubsystems,
    allowedScopeSummary,
    forbiddenScopeSummary,
    requiredProof,
    smallestNextWorkPacket,
    requiredTests: asList(harnessAgentProjection.requiredTests).length ? asList(harnessAgentProjection.requiredTests) : ['node --test tests/operator-relief-projection.test.mjs tests/mission-console-operator-relief-panel.test.mjs', 'npm run stephanos:build', 'npm run stephanos:verify'],
    copyCodexPacketAvailable: 'yes',
    copyOpenClawPacketAvailable: 'yes',
    blockers,
    warnings,
    nextOperatorAction,
    copyCodexWorkPacket: codexPacket,
    copyOpenClawResearchPacket: openClawResearchPacket,
    sourceEvidence: asList(missionBrainNextAction.sourceEvidence),
  };
}


function buildCoBuilderLoopProjection({ missionIntelligenceSummary = {}, harnessAgentProjection = {}, agentWorkRoutingProjection = {}, verificationReturnIntake = {}, missionBrainNextAction = {}, supportSnapshot = {} } = {}) {
  const maxRounds = 3;
  const loopRound = Number(supportSnapshot?.coBuilderLoopRound || supportSnapshot?.loopRound || 1) || 1;
  const blockers = [];
  const warnings = [];
  if (!asList(harnessAgentProjection.protectedCanonClauses).length) blockers.push('Harness clauses missing.');
  if (!asList(agentWorkRoutingProjection.requiredProof).length) blockers.push('Proof requirements are unclear.');
  const exceededRounds = loopRound > maxRounds;
  if (exceededRounds) blockers.push('Max rounds exceeded; route to operator/hold.');
  const proofMissing = asList(verificationReturnIntake.missingEvidence);
  const repairNeeded = verificationReturnIntake.mergeRecommendation === 'needs-repair' || proofMissing.length > 0;
  const blocked = blockers.length > 0;
  const coBuilderStatus = blocked ? 'blocked' : (repairNeeded ? 'repair-needed' : (verificationReturnIntake.evidenceCompleteness === 'complete' ? 'ready' : 'awaiting-proof'));
  const recommendedLead = blocked ? 'hold' : (repairNeeded ? 'codex-repair' : (agentWorkRoutingProjection.recommendedRoute === 'openclaw-research' ? 'openclaw-research' : 'codex-implementation'));
  return {
    coBuilderStatus, loopRound, maxRounds,
    currentObjective: missionIntelligenceSummary.currentMissionSummary || missionBrainNextAction.missionObjective || 'unknown',
    recommendedLead,
    recommendedNextWorker: recommendedLead === 'hold' ? 'hold' : (recommendedLead.startsWith('openclaw') ? 'openclaw' : 'codex'),
    recommendedNextAction: blocked ? 'hold and restore canon/proof boundaries' : (repairNeeded ? 'copy repair packet and request bounded codex repair' : 'copy next packet and request approval-gated execution'),
    operatorApprovalRequired: 'yes',
    codexPacketAvailable: 'yes',
    openClawResearchPacketAvailable: 'yes',
    openClawExecutionPacketAvailable: agentWorkRoutingProjection.openClawExecutionReady === 'yes' ? 'yes' : 'no',
    verificationPacketAvailable: 'yes',
    repairPacketAvailable: repairNeeded ? 'yes' : 'no',
    requiredProof: asList(agentWorkRoutingProjection.requiredProof),
    acceptanceCriteria: asList(harnessAgentProjection.definitionOfDone),
    protectedCanonSummary: asList(harnessAgentProjection.protectedCanonClauses),
    allowedScopeSummary: agentWorkRoutingProjection.allowedScopeSummary || 'Bounded source-only scope.',
    forbiddenScopeSummary: agentWorkRoutingProjection.forbiddenScopeSummary || 'No generated/runtime artifacts or duplicate systems.',
    blockers, warnings,
    stopConditions: ['maxRounds exceeded', 'harness/proof contradictions', 'forbidden scope touched'],
    finalOperatorDecisionNeeded: 'approve | hold | copy packet',
    copyOpenClawResearchPacket: { objective: missionIntelligenceSummary.nextBestAction || missionBrainNextAction.nextBestAction || 'Read-only audit and proof collection.', readOnlyScope: ['stephanos-ui/src/state/**', 'stephanos-ui/src/components/**', 'tests/**', 'scripts/**'], filesOrAreasToInspect: ['operatorReliefProjection', 'MissionConsoleTile', 'chatContextOrchestrator', 'supportSnapshot'], canonToPreserve: asList(harnessAgentProjection.protectedCanonClauses), proofToCollect: asList(agentWorkRoutingProjection.requiredProof), explicitForbiddenActions: ['No source mutation.', 'No branch/merge choreography.', 'No auto-dispatch.'], noMutationReminder: 'Read-only audit only.', outputFormatRequired: 'Findings + file map + proof checklist + blockers/warnings.', stopConditions: ['Harness/proof contradictions', 'forbidden file touch risk', 'scope ambiguity'], operatorApprovalReminder: 'Operator approval required before any execution handoff.' },
    copyCodexImplementationPacket: { objective: missionIntelligenceSummary.nextBestAction || missionBrainNextAction.nextBestAction || 'Bounded implementation packet.', auditFindingsToUse: asList(agentWorkRoutingProjection.sourceEvidence), allowedFiles: asList(harnessAgentProjection.allowedFileScopes), forbiddenFiles: asList(harnessAgentProjection.forbiddenFileScopes).concat(asList(harnessAgentProjection.forbiddenFiles)), protectedCanonClauses: asList(harnessAgentProjection.protectedCanonClauses), smallestBoundedChange: agentWorkRoutingProjection.smallestNextWorkPacket || 'Fix the smallest correct thing.', requiredTests: asList(harnessAgentProjection.requiredTests), buildVerifyPrCleanRequirements: ['npm run stephanos:build', 'npm run stephanos:verify', 'npm run stephanos:guard:pr-clean'], noGeneratedRuntimeArtifacts: 'Do not stage dist/runtime/root data/node_modules/secrets.', finalReportRequirements: asList(harnessAgentProjection.finalReportRequirements), operatorWorkflowPreference: 'main-first/main-only' },
    copyVerificationPacket: { requiredChecks: asList(agentWorkRoutingProjection.requiredTests).concat(asList(agentWorkRoutingProjection.requiredProof)), snapshotBrowserProofRequirements: ['Support Snapshot projection fields', 'browser proof checklist for UI claims'], exactFieldsToConfirm: ['coBuilderStatus', 'recommendedLead', 'requiredProof', 'Mission Planning Prompt Context Used', 'Project Awareness Prompt Sources'], expectedPassFailOutcomes: ['pass when checks + proof complete and no forbidden files', 'fail when evidence gaps remain'], proofFailureAction: 'Generate repair packet preserving Harness contract.' },
    copyRepairPacket: repairNeeded ? { failingProof: proofMissing, likelyRepairBoundary: 'mission/operator-relief projection + related tests only', allowedFiles: asList(harnessAgentProjection.allowedFileScopes), forbiddenFiles: asList(harnessAgentProjection.forbiddenFileScopes).concat(asList(harnessAgentProjection.forbiddenFiles)), requiredTests: asList(harnessAgentProjection.requiredTests), rule: 'Fix smallest correct thing; do not broaden scope.' } : null,
  };
}



function inferBuilderMeshTaskKind({ missionBrainNextAction = {}, supportSnapshot = {}, prEvidenceModel = {} } = {}) {
  const explicit = asText(supportSnapshot.builderMeshTaskKind || supportSnapshot.nextBuilderTaskKind || supportSnapshot.taskKind, '').toLowerCase();
  if (['research', 'planning', 'implementation', 'verification', 'browser-proof', 'cleanup', 'unknown'].includes(explicit)) return explicit;
  if (explicit === 'read-only' || explicit === 'github-inspection') return 'research';
  if (explicit === 'mutation' || explicit === 'high-risk-mutation') return 'implementation';
  if (explicit === 'approval' || explicit === 'hold') return 'unknown';
  const text = [
    missionBrainNextAction.missionObjective,
    missionBrainNextAction.nextBestAction,
    supportSnapshot.operatorMessage,
    supportSnapshot.builderMeshOperatorPrompt,
    supportSnapshot.activeMissionStage,
    asList(prEvidenceModel.changedFiles).join(' '),
  ].map((v) => asText(v, '')).join(' ').toLowerCase();
  if (/browser proof|ui proof|screenshot|visual proof/.test(text)) return 'browser-proof';
  if (/cleanup|housekeep|workspace dirt|stash|quarantine/.test(text)) return 'cleanup';
  if (/verify|verification|test|build|guard|checks|evidence|proof/.test(text)) return 'verification';
  if (/implement|build|fix|repair|code change|patch|mutation|write files|edit files|apply patch|merge|high risk/.test(text)) return 'implementation';
  if (/plan|planning|design|scope|architecture/.test(text)) return 'planning';
  if (/research|inspect|audit|cross-check|review|github|pull request|\bpr\b|diff|status|changed files|who should work|avoid using codex|meter|local ai|openclaw/.test(text)) return 'research';
  return 'unknown';
}

function buildBuilderMeshProjection({
  missionIntelligenceSummary = {},
  harnessAgentProjection = {},
  agentWorkRoutingProjection = {},
  coBuilderLoopProjection = {},
  verificationReturnIntake = {},
  missionBrainNextAction = {},
  supportSnapshot = {},
  prEvidenceModel = {},
  browserProof = {},
  builderWorkbenchInput = {},
} = {}) {
  const protectedCanonClauses = asList(harnessAgentProjection.protectedCanonClauses);
  const requiredProof = Array.from(new Set([
    ...asList(agentWorkRoutingProjection.requiredProof),
    ...asList(verificationReturnIntake.missingEvidence),
    ...(browserProof.required === true ? ['browser/UI proof before merge'] : []),
    'targeted tests for touched subsystem',
    'npm run stephanos:build',
    'npm run stephanos:verify',
    'npm run stephanos:guard:pr-clean',
  ].filter(Boolean)));
  const localAiReady = supportSnapshot.localAiConnected === true
    || supportSnapshot.localAvailable === true
    || supportSnapshot.localNodeReachable === true
    || String(supportSnapshot.provider || supportSnapshot.selectedProvider || supportSnapshot.effectiveProvider || '').toLowerCase() === 'ollama';
  const openClawBlocked = supportSnapshot.openClawKillSwitchEngaged === true
    || supportSnapshot.openClawKillSwitchState === 'engaged'
    || supportSnapshot.openClawKillSwitchMode === 'engaged'
    || supportSnapshot.openClawApprovalGateOpen === false;
  const openClawReady = !openClawBlocked;
  const githubReady = supportSnapshot.githubIntegrationStatus === 'connected'
    || supportSnapshot.githubConnected === true
    || Boolean(prEvidenceModel.prUrl || prEvidenceModel.pullRequestUrl || prEvidenceModel.branch || prEvidenceModel.prBranch)
    || asList(prEvidenceModel.changedFiles).length > 0;
  const openClawControlBridge = buildOpenClawControlBridgeProjection(supportSnapshot.openClawControlBridge || {});
  const taskKind = inferBuilderMeshTaskKind({ missionBrainNextAction, supportSnapshot, prEvidenceModel });
  const blockers = [];
  const warnings = [];
  if (!protectedCanonClauses.length) blockers.push('Harness protected canon clauses are missing; hold before routing mutation work.');
  if (openClawBlocked) warnings.push('OpenClaw approval gate or kill switch blocks execution; use read-only packets only.');
  if (!localAiReady) warnings.push('Local AI readiness is not reality-proven; packet remains copy-only until a local route is verified.');
  if (!githubReady) warnings.push('GitHub inspection route is not connected; use GitHub packet externally only.');
  if (browserProof.required === true && asList(browserProof.missingItems).length > 0) warnings.push('Browser/UI proof is still required before merge.');

  const highRiskApprovalRequested = /high-risk|approval/.test(String(supportSnapshot.builderMeshTaskKind || supportSnapshot.nextBuilderTaskKind || supportSnapshot.taskKind || '').toLowerCase());
  const implementationRequested = taskKind === 'implementation';
  const proofMissing = Array.from(new Set([
    ...asList(verificationReturnIntake.missingEvidence).filter((item) => item !== '- n/a'),
    ...asList(browserProof.missingItems).filter((item) => item !== '- n/a'),
  ]));
  const approvalRequiredBeforeMutation = true;
  const localMutationProven = supportSnapshot.localBuilderCanImplement === true
    || supportSnapshot.localMutationPathProven === true
    || supportSnapshot.localAiMutationApproved === true;
  const localAiEligible = localAiReady && (taskKind !== 'implementation' || localMutationProven);
  const codexEligible = implementationRequested || supportSnapshot.operatorExplicitlyRequestedCodex === true;
  const localAiCanHelp = localAiReady ? (localMutationProven ? 'yes-approved-local-mutation' : 'yes-read-only-review') : 'copy-packet-only-not-proven';
  const openClawCanHelp = openClawReady ? 'llama3.2-cli-bounded-source-pack-only-after-proof' : 'blocked-by-approval-or-kill-switch';
  const githubCanHelp = githubReady ? 'yes-read-only-pr-diff-status-evidence' : 'copy-packet-only-not-connected';
  let recommendedBuilder = 'hold';
  let recommendedBuilderReason = 'Task kind is unknown; operator clarification is required before routing.';
  let codexReason = 'Codex remains fallback only; Builder Mesh must prove why local/read-only routes cannot safely continue.';
  const workbenchPreview = buildBuilderWorkbenchProjection({
    builderMeshBase: { recommendedBuilder, codexReason },
    workbenchInput: builderWorkbenchInput,
    implementationRequested,
    supportSnapshot,
  });
  const sourcePack = workbenchPreview.openClawSourcePackRunner || {};
  const sanity = workbenchPreview.openClawSanityGate || {};
  const hygiene = workbenchPreview.openClawWorkspaceHygiene || {};
  const sourcePackClean = sourcePack.sourcePackStatus === 'passed'
    && sourcePack.sourcePackJudgmentStale !== 'yes'
    && sourcePack.sourceBounded === 'yes'
    && sourcePack.hallucinatedSourcesDetected !== 'yes'
    && sourcePack.templateLeakageDetected !== 'yes'
    && sourcePack.mutationClaimDetected !== 'yes';
  const sourcePackRouteEligible = sourcePack.routeEligibility?.eligible === 'yes' || sourcePackClean;
  const openClawSanityPassed = sanity.sanityStatus === 'passed' || sanity.routeSanityStatus === 'passed' || sanity.exactResponseStatus === 'passed';
  const openClawReadOnlyOnly = !openClawSanityPassed;
  const openClawEligible = openClawReady
    && hygiene.workspaceBlocksIgnition !== 'yes'
    && sourcePackClean
    && sourcePackRouteEligible
    && ['research', 'planning'].includes(taskKind);

  if (hygiene.workspaceBlocksIgnition === 'yes') {
    blockers.push('OpenClaw workspace dirt blocks ignition; Builder Mesh must hold until the operator stashes/quarantines only the known OpenClaw workspace paths.');
    recommendedBuilder = 'hold';
    recommendedBuilderReason = 'OpenClaw workspace hygiene is blocked; no builder should receive more work until cleanup proof is collected.';
    codexReason = 'Workspace hygiene is a hard proof blocker; Codex remains fallback only after cleanup and operator approval.';
  } else if (sourcePack.sourcePackStatus === 'failed') {
    blockers.push('OpenClaw Source Pack Runner failed judgment; OpenClaw cannot be used for canon/build routing.');
  } else if (sourcePack.sourcePackStatus === 'stale' || sourcePack.sourcePackJudgmentStale === 'yes') {
    blockers.push('OpenClaw Source Pack Runner judgment is stale; OpenClaw cannot be used for canon/build routing.');
  } else if (sourcePack.sourcePackResultPresent === 'yes' && !sourcePackClean) {
    blockers.push('OpenClaw Source Pack Runner is not clean/trusted; OpenClaw cannot be recommended for canon/build routing.');
  }

  if (openClawReadOnlyOnly) {
    warnings.push('OpenClaw sanity is failed or unknown; OpenClaw is limited to bounded read-only research/intake and never mutation.');
  }
  if (taskKind === 'unknown') {
    recommendedBuilder = 'hold';
    recommendedBuilderReason = 'Task kind is unknown; operator clarification is required before routing.';
  } else if (proofMissing.length > 0 && !implementationRequested && !openClawEligible && !localAiEligible) {
    recommendedBuilder = 'hold';
    recommendedBuilderReason = 'Required proof is missing; collect operator/runtime proof before routing more work.';
  } else if (highRiskApprovalRequested) {
    recommendedBuilder = 'operator';
    recommendedBuilderReason = 'High-risk or approval-gated implementation requires operator approval before any builder route.';
  } else if (hygiene.workspaceBlocksIgnition !== 'yes') {
    if (implementationRequested) {
      if (localMutationProven) {
        recommendedBuilder = 'local-ai';
        recommendedBuilderReason = 'Implementation is requested and a local mutation path is proven; route locally only within operator-approved scope.';
        codexReason = 'A proven local mutation path exists; Codex is not the default.';
      } else {
        recommendedBuilder = 'codex';
        recommendedBuilderReason = 'Implementation is requested but no proven local mutation path exists; Codex is the fallback implementation specialist.';
        codexReason = 'Implementation is requested but no approved local/OpenClaw mutation path is proven; use Codex only as an operator-approved fallback specialist.';
      }
    } else if (openClawEligible && taskKind === 'research') {
      recommendedBuilder = 'openclaw';
      recommendedBuilderReason = 'Clean bounded Source Pack proof and eligible llama3.2 CLI route allow OpenClaw for read-only research/intake only.';
      codexReason = 'Read-only research can use OpenClaw Source Pack proof; Codex remains fallback, not default.';
    } else if (localAiEligible && ['research', 'planning', 'verification', 'browser-proof', 'cleanup'].includes(taskKind)) {
      recommendedBuilder = 'local-ai';
      recommendedBuilderReason = 'Local AI is eligible for read-only review/planning/proof triage; mutation remains approval-gated.';
    } else if (['verification', 'browser-proof', 'cleanup', 'planning'].includes(taskKind)) {
      recommendedBuilder = 'operator';
      recommendedBuilderReason = 'Operator proof collection or clarification is the safest next route for this non-implementation task.';
    }
  }
  if (workbenchPreview.openClawPatchPlanner?.patchPlannerStatus === 'failed') {
    recommendedBuilder = 'codex';
    recommendedBuilderReason = workbenchPreview.openClawPatchPlanner.codexFallbackReason || 'OpenClaw patch planner failed; Codex is the fallback after operator approval.';
    codexReason = recommendedBuilderReason;
  } else if (workbenchPreview.openClawPatchPlanner?.patchPlannerStatus === 'passed') {
    recommendedBuilder = 'operator';
    recommendedBuilderReason = 'OpenClaw patch planner produced a read-only plan; operator approval is the next gate before mutation.';
    codexReason = workbenchPreview.openClawPatchPlanner.codexFallbackReason || codexReason;
  } else if (workbenchPreview.codexFallbackStillNeeded === false && (workbenchPreview.localAiReviewResultPresent === true || workbenchPreview.openClawResearchResultPresent === true)) {
    recommendedBuilder = 'operator';
    recommendedBuilderReason = 'A safe workbench result is present; operator approval checklist is the next gate.';
    codexReason = workbenchPreview.codexFallbackReason || codexReason;
  }
  if (blockers.length > 0 && !implementationRequested) {
    recommendedBuilder = 'hold';
    recommendedBuilderReason = blockers[0];
  }
  const codexRequired = false;
  const zeroCostRouteAvailable = ['local-ai', 'openclaw', 'github-inspection', 'operator'].includes(recommendedBuilder)
    || localAiReady || openClawReady || githubReady;
  const safeReadOnlyActions = [
    'Ask local AI for review findings only; do not write files.',
    'Ask OpenClaw only for bounded llama3.2 CLI source-pack processing unless route-specific research proof exists; no browsing or mutation.',
    'Inspect GitHub PR/status/diff/evidence when connected.',
    'Collect proof gaps and next checks from Operator Relief / Mission Brain.',
  ];
  const workspaceBlocksIgnition = workbenchPreview.openClawWorkspaceHygiene?.workspaceBlocksIgnition === 'yes';
  const nextBestAction = workspaceBlocksIgnition
    ? workbenchPreview.openClawWorkspaceHygiene.workspaceNextOperatorAction
    : (recommendedBuilder === 'hold'
    ? 'Hold and resolve Builder Mesh blockers/proof gaps before routing more work.'
    : (recommendedBuilder === 'operator' && workbenchPreview.localAiReviewResultPresent === true
      ? 'Review the parsed Local AI Runner findings and use the Operator Approval Checklist before any patch or Codex fallback.'
      : (recommendedBuilder === 'codex'
      ? 'Copy the Codex Fallback Packet only after operator approval confirms no proven local mutation route exists.'
      : `Copy the ${recommendedBuilder === 'openclaw' ? 'OpenClaw Source Pack Runner Packet' : recommendedBuilder === 'operator' ? 'Operator Approval Checklist' : 'Local AI Review Packet'} and keep the route read-only until mutation approval.`)));
  const builderWorkbenchProjection = buildBuilderWorkbenchProjection({
    builderMeshBase: { recommendedBuilder, codexReason },
    workbenchInput: builderWorkbenchInput,
    implementationRequested,
    supportSnapshot,
  });
  const packetBase = {
    missionSummary: missionIntelligenceSummary.currentMissionSummary || missionBrainNextAction.missionObjective || 'Stephanos Zero-Cost Builder Mesh mission.',
    recommendedBuilder,
    recommendedBuilderReason,
    taskKind,
    openClawEligible,
    localAiEligible,
    codexEligible,
    operatorApprovalRequired: true,
    mutationAllowed: false,
    requiredProof,
    missingProof: proofMissing,
    copyablePacketKind: recommendedBuilder === 'openclaw' ? 'openClawSourcePackPacket' : recommendedBuilder === 'codex' ? 'codexFallbackPacket' : recommendedBuilder === 'operator' ? 'operatorApprovalChecklist' : recommendedBuilder === 'local-ai' ? 'localAiReviewPacket' : 'none',
    copyablePacketAvailable: recommendedBuilder !== 'hold',
    builderMeshProjectionSource: 'operator-relief-existing-truth-v1',
    zeroCostRouteAvailable,
    approvalRequiredBeforeMutation,
    proofRequiredBeforeMerge: requiredProof,
    protectedCanonClauses,
    safeReadOnlyActions,
    explicitForbiddenActions: ['Do not mutate repo files.', 'Do not stage generated dist/runtime artifacts.', 'Do not bypass zero-cost policy.', 'Do not auto-merge.'],
  };
  return {
    builderMeshStatus: blockers.length ? 'blocked-read-only' : 'ready-read-only',
    recommendedBuilder,
    recommendedBuilderReason,
    taskKind,
    openClawEligible,
    localAiEligible,
    codexEligible,
    operatorApprovalRequired: true,
    mutationAllowed: false,
    requiredProof,
    missingProof: proofMissing,
    copyablePacketKind: recommendedBuilder === 'openclaw' ? 'openClawSourcePackPacket' : recommendedBuilder === 'codex' ? 'codexFallbackPacket' : recommendedBuilder === 'operator' ? 'operatorApprovalChecklist' : recommendedBuilder === 'local-ai' ? 'localAiReviewPacket' : 'none',
    copyablePacketAvailable: recommendedBuilder !== 'hold',
    builderMeshProjectionSource: 'operator-relief-existing-truth-v1',
    zeroCostRouteAvailable,
    codexRequired,
    codexReason,
    localAiCanHelp,
    openClawCanHelp: workbenchPreview.openClawWorkspaceHygiene?.workspaceBlocksIgnition === 'yes' ? 'blocked-workspace-dirt' : (openClawEligible ? 'yes-read-only-source-pack-research' : (workbenchPreview.openClawSanityGate?.sanityStatus === 'failed' ? 'blocked-sanity-failed' : (workbenchPreview.openClawResearchResultPresent ? 'blocked-route-untrusted' : openClawCanHelp))),
    githubCanHelp,
    safeReadOnlyActions,
    approvalRequiredBeforeMutation,
    proofRequiredBeforeMerge: requiredProof,
    blockers,
    warnings,
    nextBestAction,
    builderWorkbenchProjection,
    openClawControlBridge,
    openClawWebResearchIntake: builderWorkbenchProjection.openClawWebResearchIntake,
    openClawWorkspaceHygiene: builderWorkbenchProjection.openClawWorkspaceHygiene,
    openClawSanityGate: builderWorkbenchProjection.openClawSanityGate,
    openClawResearchScoutGuidance: builderWorkbenchProjection.openClawSanityGate?.minimumViableRouteRecommendation || 'OpenClaw is route-specific only: dashboard/qwen routes are untrusted by default, CLI llama3.2 exact-response sanity is not enough for research or patch planning, mutation remains locked, and operator approval is required before canon/build promotion.',
    copyPackets: {
      localAiReviewPacket: { ...packetBase, packetType: 'Local AI Review Packet', requestedOutput: 'Bounded findings, risks, tests, and proof gaps only. No file writes.' },
      openClawResearchPacket: { ...packetBase, packetType: 'OpenClaw Research Packet', requestedOutput: 'Blocked for autonomous research unless route-specific research proof exists. Prefer Source Pack Runner.', webResearchIntakeRequired: true, defaultPromptName: 'VR Research Lab web research prompt', openClawCanHelp, openClawControlBridge: { gatewayTarget: openClawControlBridge.gatewayTarget, dashboardUrl: openClawControlBridge.dashboardUrl, localScoutProofStatus: openClawControlBridge.localScoutProofStatus, mutationAuthority: openClawControlBridge.mutationAuthority, autoStart: openClawControlBridge.autoStart, operatorApprovalRequired: openClawControlBridge.operatorApprovalRequired } },
      openClawSourcePackPacket: { ...packetBase, packetType: 'OpenClaw Source Pack Runner Packet', requestedOutput: OPENCLAW_SOURCE_PACK_CLI_PROMPT, route: OPENCLAW_SOURCE_PACK_ROUTE, model: OPENCLAW_SOURCE_PACK_MODEL, routeEligibility: builderWorkbenchProjection.openClawSourcePackRunner?.routeEligibility, mutationAuthority: 'locked', autoStart: 'forbidden', trustedForCanon: 'no', trustedForResearch: 'no' },
      openClawPatchPlannerPacket: { ...packetBase, packetType: 'OpenClaw Patch Planner Packet', requestedOutput: OPENCLAW_PATCH_PLANNER_PROMPT, patchPlannerIntakeRequired: true, mutationAuthority: 'locked', autoStart: 'forbidden', trustedForPatch: 'no' },
      githubInspectionPacket: { ...packetBase, packetType: 'GitHub Inspection Packet', requestedOutput: 'Inspect PR/status/diff/evidence and report proof gaps only. No merge action.', githubCanHelp, prEvidence: { branch: prEvidenceModel.branch || prEvidenceModel.prBranch || 'unknown', prUrl: prEvidenceModel.prUrl || prEvidenceModel.pullRequestUrl || 'unknown', changedFiles: asList(prEvidenceModel.changedFiles) } },
      codexFallbackPacket: { ...packetBase, packetType: 'Codex Fallback Packet', requestedOutput: 'Bounded specialist implementation only after operator approval and after zero-cost routes cannot safely produce a plan.', codexReason, codexRequired },
      operatorApprovalChecklist: { ...packetBase, packetType: 'Operator Approval Checklist', checklist: ['Confirm mutation is necessary.', 'Confirm local/OpenClaw/GitHub read-only routes were considered.', 'Approve exact files/scope before mutation.', 'Require tests/build/verify/pr-clean and UI/browser proof for UI claims.'] },
    },
  };
}

function buildBuilderHarnessProjection({
  missionIntelligenceSummary = {},
  harnessAgentProjection = {},
  agentWorkRoutingProjection = {},
  coBuilderLoopProjection = {},
  verificationReturnIntake = {},
  missionBrainNextAction = {},
  supportSnapshot = {},
  prEvidenceModel = {},
  browserProof = {},
} = {}) {
  const warnings = [];
  const blockers = [];
  const protectedCanonClauses = asList(harnessAgentProjection.protectedCanonClauses);
  const requiredProof = Array.from(new Set([
    ...asList(agentWorkRoutingProjection.requiredProof),
    ...asList(verificationReturnIntake.missingEvidence),
  ]));
  const localAiConnected = supportSnapshot.localAiConnected === true
    || supportSnapshot.localAvailable === true
    || supportSnapshot.localNodeReachable === true
    || String(supportSnapshot.provider || supportSnapshot.selectedProvider || supportSnapshot.effectiveProvider || '').toLowerCase() === 'ollama';
  const githubInspectable = Boolean(
    supportSnapshot.githubIntegrationStatus === 'connected'
    || supportSnapshot.githubConnected === true
    || prEvidenceModel.prUrl
    || prEvidenceModel.pullRequestUrl
    || prEvidenceModel.branch
    || prEvidenceModel.prBranch
    || asList(prEvidenceModel.changedFiles).length > 0
  );
  const killSwitchEngaged = supportSnapshot.openClawKillSwitchEngaged === true
    || supportSnapshot.openClawKillSwitchState === 'engaged'
    || supportSnapshot.openClawKillSwitchMode === 'engaged';

  if (!protectedCanonClauses.length) blockers.push('Harness protected canon clauses are missing.');
  if (killSwitchEngaged) warnings.push('OpenClaw kill switch is engaged; keep builder harness read-only and execution disabled.');
  if (!localAiConnected) warnings.push('Local AI connection is not reality-proven; review packet is copy-only until a local model is verified.');
  if (!githubInspectable) warnings.push('GitHub/PR inspection is not connected; use copied packet with an external GitHub review route.');
  if (browserProof.required === true && asList(browserProof.missingItems).length > 0) blockers.push('Browser proof is required and missing.');

  const repoInspectionCapability = protectedCanonClauses.length > 0 ? 'available-read-only' : 'blocked-missing-harness-contract';
  const patchPlanningCapability = blockers.length === 0 ? 'available-proposal-only' : 'limited-until-blockers-clear';
  const testExecutionCapability = 'operator-approved-command-only';
  const browserProofCapability = browserProof.required === true ? 'required-operator-browser-proof' : 'available-when-ui-claim-exists';
  const builderHarnessStatus = blockers.length > 0 ? 'blocked-read-only' : 'ready-read-only';
  const connectedLocalAiStatus = localAiConnected ? 'connected-read-only-review' : 'not-proven-copy-packet-only';
  const githubIntegrationStatus = githubInspectable ? 'inspectable-read-only' : 'not-connected-copy-packet-only';
  const nextBestAction = blockers.length > 0
    ? 'Resolve blockers, then copy the appropriate read-only builder packet for operator-approved review.'
    : 'Copy OpenClaw/local AI/GitHub builder packet for read-only review or proposal planning; operator approval remains required before any repo mutation.';

  const packetBase = {
    missionSummary: missionIntelligenceSummary.currentMissionSummary || missionBrainNextAction.missionObjective || 'Stephanos builder harness mission.',
    nextBestAction,
    allowedReadOnlyScope: asList(harnessAgentProjection.allowedFileScopes),
    forbiddenMutations: ['No uncontrolled repo writes.', 'No generated dist/runtime artifacts.', 'No auto-merge.', 'No execution without explicit existing approval route.'],
    protectedCanonClauses,
    requiredProof,
    operatorApprovalRequired: true,
  };

  return {
    builderHarnessStatus,
    connectedLocalAiStatus,
    githubIntegrationStatus,
    repoInspectionCapability,
    patchPlanningCapability,
    testExecutionCapability,
    browserProofCapability,
    approvalRequired: true,
    nextBestAction,
    blockers,
    warnings,
    canOpenClawBuild: patchPlanningCapability === 'available-proposal-only' ? 'proposal-only-read-only' : 'blocked',
    canLocalAisHelp: localAiConnected ? 'yes-review-only' : 'not-proven-copy-packet-only',
    canGithubBeInspected: githubInspectable ? 'yes-read-only' : 'not-connected-copy-packet-only',
    canPatchBeProposed: patchPlanningCapability === 'available-proposal-only' ? 'yes-proposal-only' : 'blocked',
    approvalNeeded: 'Operator approval required before mutation, execution, or merge.',
    noAutoMerge: true,
    mutationAllowed: false,
    codexRole: 'fallback-specialist-only',
    copyLocalAiReviewPacket: {
      ...packetBase,
      packetType: 'local_ai_review_packet',
      localAiStatus: connectedLocalAiStatus,
      requestedOutput: 'Review findings, risk notes, suggested tests, and proof gaps only. Do not write files.',
    },
    copyOpenClawPatchPlanPacket: {
      ...packetBase,
      packetType: 'openclaw_patch_plan_packet',
      openClawStatus: builderHarnessStatus,
      requestedOutput: 'Bounded patch plan with file map, risks, tests, and browser proof plan. Proposal only; no mutation.',
      existingPolicyHarnessPreserved: true,
      killSwitchRespected: true,
    },
    copyGithubPrInspectionPacket: {
      ...packetBase,
      packetType: 'github_pr_inspection_packet',
      githubIntegrationStatus,
      requestedOutput: 'Inspect changed files, PR hygiene, generated artifact risk, and review proof gaps. No merge action.',
      prEvidence: {
        branch: prEvidenceModel.branch || prEvidenceModel.prBranch || 'unknown',
        prUrl: prEvidenceModel.prUrl || prEvidenceModel.pullRequestUrl || 'unknown',
        changedFiles: asList(prEvidenceModel.changedFiles),
      },
    },
    copyCodexFallbackPacket: {
      ...packetBase,
      packetType: 'codex_fallback_specialist_packet',
      codexRole: 'fallback-specialist-only',
      requestedOutput: 'Use Codex only for bounded specialist implementation after operator approval and after non-Codex review packets are considered.',
      requiredCommands: asList(coBuilderLoopProjection.requiredProof).concat(['targeted tests', 'npm run stephanos:build', 'npm run stephanos:verify', 'npm run stephanos:guard:pr-clean']),
    },
  };
}

export function buildAgentRealityLoopProjection({
  missionState = 'active',
  missionBrainNextAction = {},
  harnessAgentProjection = {},
  agentWorkRoutingProjection = {},
  verificationReturnIntake = {},
  missionIntelligenceSummary = {},
  lessonCandidates = [],
  browserProof = {},
  packetBayProjection = {},
  builderMeshProjection = {},
  builderWorkbenchProjection = {},
  openClawSourcePackRunner = {},
  uiRealityTruth = {},
  openClawWorkspaceHygiene = {},
  missionConsoleTruth = {},
  codexDispatchTruth = {},
  supportSnapshot = {},
  projectAwarenessProjection = {},
  missionEvidenceContextSummary = {},
} = {}) {
  const packetBay = packetBayProjection && typeof packetBayProjection === 'object' ? packetBayProjection : {};
  const evidenceContext = missionEvidenceContextSummary && typeof missionEvidenceContextSummary === 'object' ? missionEvidenceContextSummary : {};
  const evidenceAvailable = evidenceContext.available === true;
  const packetCounts = packetBay.counts || {};
  const packets = asList(packetBay.packets);
  const readyPackets = packets.filter((packet) => packet?.status === 'ready-to-copy' && asText(packet.copyText, ''));
  const awaitingPackets = packets.filter((packet) => packet?.status === 'awaiting-result');
  const blockedPackets = packets.filter((packet) => packet?.status === 'blocked');
  const nonEvidenceReadyPackets = readyPackets.filter((packet) => packet.createdFrom !== 'mission-evidence-context-v1b');
  const localAiReadyPacket = nonEvidenceReadyPackets.find((packet) => asText(packet.target, '').toLowerCase() === 'local-ai');
  const openClawReadyPacket = nonEvidenceReadyPackets.find((packet) => asText(packet.target, '').toLowerCase() === 'openclaw');
  const codexReadyPacket = nonEvidenceReadyPackets.find((packet) => asText(packet.target, '').toLowerCase() === 'codex');
  const githubReadyPacket = nonEvidenceReadyPackets.find((packet) => asText(packet.target, '').toLowerCase() === 'github');
  const operatorReadyPacket = nonEvidenceReadyPackets.find((packet) => asText(packet.target, '').toLowerCase() === 'operator');
  const nextPacket = localAiReadyPacket || openClawReadyPacket || codexReadyPacket || githubReadyPacket || operatorReadyPacket || null;
  const mesh = builderMeshProjection && typeof builderMeshProjection === 'object' ? builderMeshProjection : {};
  const workbench = Object.keys(builderWorkbenchProjection || {}).length ? builderWorkbenchProjection : (mesh.builderWorkbenchProjection || {});
  const sourcePack = Object.keys(openClawSourcePackRunner || {}).length ? openClawSourcePackRunner : (workbench.openClawSourcePackRunner || {});
  const workspaceHygiene = Object.keys(openClawWorkspaceHygiene || {}).length ? openClawWorkspaceHygiene : (workbench.openClawWorkspaceHygiene || mesh.openClawWorkspaceHygiene || {});
  const uiRealityStatus = asText(
    uiRealityTruth.status
      || uiRealityTruth.uiRealityStatus
      || supportSnapshot.uiRealityStatus
      || supportSnapshot.chatContextUiRealityStatus
      || supportSnapshot.executionMetadata?.chat_context_ui_reality_status,
    'unknown',
  );
  const sourceTruths = Array.from(new Set([
    ...asList(packetBay.sourceTruths),
    Object.keys(packetBay).length ? 'Packet Bay projection' : '',
    Object.keys(mesh).length ? 'Builder Mesh projection' : '',
    Object.keys(workbench).length ? 'Builder Workbench truth' : '',
    Object.keys(sourcePack).length ? 'OpenClaw Source Pack Runner truth' : '',
    Object.keys(verificationReturnIntake).length ? 'Mission Verification truth' : '',
    Object.keys(uiRealityTruth).length || uiRealityStatus !== 'unknown' ? 'UI Reality truth' : '',
    Object.keys(workspaceHygiene).length ? 'OpenClaw Workspace Hygiene truth' : '',
    'OpenClaw mutation lock truth',
    'Codex dispatch lock truth',
    Object.keys(projectAwarenessProjection || {}).length ? 'Project Awareness projection' : '',
    evidenceAvailable ? 'Mission Evidence Context V1B' : '',
  ].filter(Boolean)));

  const proofRequired = Array.from(new Set([
    ...asList(packetBay.packets).flatMap((packet) => asList(packet.requiredProof)),
    ...asList(packetBay.requiredProof),
    ...asList(mesh.requiredProof),
    ...asList(mesh.proofRequiredBeforeMerge),
    ...asList(agentWorkRoutingProjection.requiredProof),
    ...asList(harnessAgentProjection.requiredTests),
  ])).slice(0, 18);
  const missingProof = Array.from(new Set([
    ...asList(packetBay.packets).flatMap((packet) => asList(packet.missingProof)),
    ...asList(mesh.missingProof),
    ...asList(verificationReturnIntake.missingEvidence),
    ...asList(missionBrainNextAction.openEvidenceGaps).map((gap) => gap?.label || gap?.requiredAction || gap).filter(Boolean),
    ...(evidenceAvailable && evidenceContext.missingProofSummary !== 'none' ? String(evidenceContext.missingProofSummary).split('|').map((item) => asText(item, '')).filter(Boolean) : []),
  ])).slice(0, 18);
  const blockers = Array.from(new Set([
    ...asList(agentWorkRoutingProjection.blockers),
    ...asList(mesh.blockers),
    ...blockedPackets.map((packet) => packet.summary || packet.reason || packet.title).filter(Boolean),
  ])).slice(0, 18);
  const warnings = Array.from(new Set([
    ...asList(mesh.warnings),
    ...asList(workbench.warnings),
  ])).slice(0, 18);

  const sourcePackNeedsOutput = asText(sourcePack.sourcePackStatus, '') === 'needs-output';
  const missionConsoleCollapsed = missionConsoleTruth.agentMissionConsoleCollapsed === true
    || missionConsoleTruth.missionConsoleCollapsed === true
    || missionConsoleTruth.isCollapsed === true
    || asText(missionConsoleTruth.agentMissionConsoleState || missionConsoleTruth.missionConsoleState, '').toLowerCase() === 'collapsed'
    || supportSnapshot.agentMissionConsoleCollapsed === true
    || supportSnapshot.missionConsoleCollapsed === true;
  if (sourcePackNeedsOutput && missionConsoleCollapsed) {
    blockers.push('OpenClaw Source Pack Runner needs output, but Agent Mission Console is collapsed/unmounted.');
    missingProof.push('OpenClaw source-pack output');
  }
  const workspaceDirty = workspaceHygiene.workspaceDirtDetected === 'yes'
    || workspaceHygiene.workspaceBlocksIgnition === 'yes'
    || Number(workspaceHygiene.workspaceDirtCount || 0) > 0;
  if (workspaceDirty) blockers.push('OpenClaw workspace hygiene is dirty; housekeep known OpenClaw workspace paths before routing.');
  const uiRealityNotOk = uiRealityStatus !== 'unknown' && !['ok', 'OK', 'ready', 'healthy', 'pass', 'passed'].includes(uiRealityStatus);
  if (uiRealityNotOk) {
    blockers.push('UI Reality is not OK; browser/UI proof must be repaired before the Agent Reality Loop can proceed.');
    missingProof.push('browser/UI proof');
  }

  let status = sourceTruths.length <= 2 && packets.length === 0 && !Object.keys(mesh).length ? 'unavailable' : 'idle';
  let phase = 'observe';
  let recommendedLead = 'hold';
  let recommendedLeadReason = 'No usable Packet Bay or Builder Mesh truth is available; holding rather than inventing state.';
  let nextAction = 'Hold for current runtime truth; refresh Support Snapshot / Builder Mesh / Packet Bay evidence.';
  let awaitingResultFrom = 'none';
  let expectedResultKind = 'none';

  if (awaitingPackets.length > 0) {
    const awaiting = awaitingPackets[0];
    status = 'awaiting-result';
    phase = 'awaiting-result';
    recommendedLead = asText(awaiting.target, 'operator');
    awaitingResultFrom = asText(awaiting.target, 'unknown');
    expectedResultKind = asText(awaiting.kind, 'result');
    recommendedLeadReason = `Packet Bay is awaiting a ${expectedResultKind} result from ${awaitingResultFrom}.`;
    nextAction = `Paste the ${awaitingResultFrom} result back into the Builder Workbench / Packet Bay evidence path.`;
  } else if (blockers.length > 0) {
    status = 'blocked';
    phase = 'blocked';
    recommendedLead = workspaceDirty ? 'operator' : 'hold';
    recommendedLeadReason = workspaceDirty
      ? 'OpenClaw workspace hygiene blocks routing and requires operator housekeeping; mutation remains locked.'
      : 'Runtime proof blockers prevent safe routing.';
    nextAction = workspaceDirty
      ? asText(workspaceHygiene.workspaceNextOperatorAction || workspaceHygiene.workspaceRecommendedCleanup, 'Housekeep known OpenClaw workspace dirt, then rerun ignition/support proof.')
      : (sourcePackNeedsOutput && missionConsoleCollapsed
        ? 'Expand Agent Mission Console / mount Source Pack Runner, paste OpenClaw output, and run intake judgment.'
        : (uiRealityNotOk ? 'Collect/repair browser UI Reality proof before routing an agent.' : 'Resolve blockers before copying or routing the next packet.'));
  } else if (nextPacket) {
    status = 'ready';
    phase = 'packet-ready';
    recommendedLead = asText(nextPacket.target, 'operator');
    recommendedLeadReason = asText(nextPacket.reason, `Packet Bay has a ready-to-copy ${recommendedLead} packet.`);
    nextAction = asText(nextPacket.nextAction, packetBay.recommendedNextAction || 'Copy the ready packet and keep mutation locked.');
    expectedResultKind = asText(nextPacket.kind, 'result');
  } else if (missingProof.length > 0) {
    status = 'needs-operator-decision';
    phase = 'judge-result';
    recommendedLead = 'operator';
    recommendedLeadReason = 'Required proof is missing and needs an operator decision/proof collection path.';
    nextAction = 'Collect missing proof or choose a read-only packet route; mutation remains locked.';
  }

  if (recommendedLead === 'openclaw') {
    recommendedLeadReason = `${recommendedLeadReason} OpenClaw is read-only only; mutation remains locked.`;
  }
  if (recommendedLead === 'codex') {
    recommendedLeadReason = `${recommendedLeadReason} Codex is a copyable handoff only; auto-dispatch is forbidden.`;
  }

  const operatorDecisionRequired = status === 'needs-operator-decision' || status === 'blocked' || recommendedLead === 'operator' || missingProof.length > 0;
  const projectionSource = packets.length || Object.keys(mesh).length ? 'agent-reality-loop-v1-runtime-truth-projection' : 'none';
  const copyPacketsAvailable = readyPackets.length > 0;
  const confidence = status === 'unavailable' ? 'low' : (blockers.length || missingProof.length ? 'medium' : 'high');

  const legacyCodexPacket = {
    boundedFileScope: asList(harnessAgentProjection.allowedFileScopes),
    forbiddenFiles: asList(harnessAgentProjection.forbiddenFileScopes).concat(asList(harnessAgentProjection.forbiddenFiles)),
    requiredTestsBuildVerify: asList(harnessAgentProjection.requiredTests).concat(['npm run stephanos:build', 'npm run stephanos:verify']),
    browserProofRequiredWhenUiOrRuntimeChanges: browserProof.required === true ? 'yes' : 'no',
    rules: ['No generated dist hand edits.', 'Do not use git add .', 'Preserve protected Command Deck canon.'],
    nextBestAction: nextAction,
  };
  const legacyOpenClawPacket = {
    liveProofFirst: 'Capture Support Snapshot / UI Reality before patching.',
    classifyFailureBeforePatching: 'yes',
    noSpeculationWithoutEvidence: 'Do not speculate when Support Snapshot evidence is missing.',
    operatorApprovalRequiredBeforeBroadOrDestructiveWork: 'yes',
    requiredProof: proofRequired,
  };
  return {
    status,
    phase,
    recommendedLead,
    recommendedLeadReason,
    nextAction,
    nextBestAction: nextAction,
    nextPacketId: nextPacket?.id || 'none',
    nextPacketTarget: nextPacket?.target || 'none',
    nextPacketKind: nextPacket?.kind || 'none',
    copyPacketsAvailable,
    awaitingResultFrom,
    expectedResultKind,
    proofRequired,
    requiredProof: proofRequired,
    missingProof,
    blockers,
    warnings,
    operatorDecisionRequired,
    operatorApprovalRequired: operatorDecisionRequired,
    mutationAllowed: false,
    openClawMutationLocked: true,
    codexAutoDispatchAllowed: false,
    sourceTruths,
    projectionSource,
    confidence,
    currentMissionPhase: missionBrainNextAction.currentPhase || 'unknown',
    readinessState: status,
    protectedCanonAtRisk: asList(harnessAgentProjection.protectedCanonAtRisk),
    mergeRecommendation: uiRealityNotOk || (browserProof.required === true && asList(browserProof.missingItems).length > 0) ? 'hold-browser-proof-missing' : (verificationReturnIntake.mergeRecommendation || harnessAgentProjection.mergeRecommendation || 'review-required'),
    lessonCandidates: asList(lessonCandidates).map((candidate) => ({ id: candidate.id, title: candidate.title, approvalRequired: true })),
    copyCodexPacket: codexReadyPacket ? { packetId: codexReadyPacket.id, copyText: codexReadyPacket.copyText, autoDispatchAllowed: false, nextBestAction: nextAction } : legacyCodexPacket,
    copyOpenClawPacket: openClawReadyPacket ? { packetId: openClawReadyPacket.id, copyText: openClawReadyPacket.copyText, mutationAuthority: 'locked', liveProofFirst: 'Capture Support Snapshot / UI Reality before patching.' } : legacyOpenClawPacket,
    copyOperatorProofChecklist: proofRequired.concat(missingProof.map((proof) => `MISSING: ${proof}`)).join('\n'),
    hasDuplicatePaneRisk: 'no',
    projectAwarenessContextSource: Object.keys(projectAwarenessProjection || {}).length ? (projectAwarenessProjection.projectionSource || 'project-awareness') : 'none',
    projectAwarenessContextInjected: Object.keys(projectAwarenessProjection || {}).length ? 'yes' : 'no',
    evidenceContextSource: evidenceAvailable ? evidenceContext.source : 'none',
    evidenceNextRequired: evidenceAvailable ? evidenceContext.nextRequiredEvidence : 'none',
    evidenceMissingProofSummary: evidenceAvailable ? evidenceContext.missingProofSummary : 'none',
    evidenceTrustedForMerge: evidenceAvailable && evidenceContext.trustedForMerge === true,
    evidenceTrustedForCanon: evidenceAvailable && evidenceContext.trustedForCanon === true,
    supportSnapshotFields: {
      agent_reality_loop_status: status,
      agent_reality_loop_phase: phase,
      agent_reality_loop_projection_available: projectionSource === 'none' ? 'no' : 'yes',
      agent_reality_loop_recommended_lead: recommendedLead,
      agent_reality_loop_recommended_lead_reason: recommendedLeadReason,
      agent_reality_loop_next_action: nextAction,
      agent_reality_loop_next_packet_id: nextPacket?.id || 'none',
      agent_reality_loop_next_packet_target: nextPacket?.target || 'none',
      agent_reality_loop_next_packet_kind: nextPacket?.kind || 'none',
      agent_reality_loop_copy_packets_available: copyPacketsAvailable ? 'yes' : 'no',
      agent_reality_loop_awaiting_result_from: awaitingResultFrom,
      agent_reality_loop_expected_result_kind: expectedResultKind,
      agent_reality_loop_missing_proof_summary: missingProof.join(' | ') || 'none',
      agent_reality_loop_blocker_count: String(blockers.length),
      agent_reality_loop_warning_count: String(warnings.length),
      agent_reality_loop_operator_decision_required: operatorDecisionRequired ? 'yes' : 'no',
      agent_reality_loop_mutation_allowed: 'no',
      agent_reality_loop_openclaw_mutation_locked: 'yes',
      agent_reality_loop_codex_auto_dispatch_allowed: 'no',
      agent_reality_loop_projection_source: projectionSource,
      agent_reality_loop_confidence: confidence,
      agent_reality_loop_context_source: Object.keys(projectAwarenessProjection || {}).length ? (projectAwarenessProjection.projectionSource || 'project-awareness') : 'none',
      agent_reality_loop_context_injected: Object.keys(projectAwarenessProjection || {}).length ? 'yes' : 'no',
      agent_reality_loop_evidence_context_source: evidenceAvailable ? evidenceContext.source : 'none',
      agent_reality_loop_evidence_next_required: evidenceAvailable ? evidenceContext.nextRequiredEvidence : 'none',
      agent_reality_loop_evidence_missing_proof_summary: evidenceAvailable ? evidenceContext.missingProofSummary : 'none',
      agent_reality_loop_evidence_trusted_for_merge: evidenceAvailable && evidenceContext.trustedForMerge === true ? 'yes' : 'no',
      agent_reality_loop_evidence_trusted_for_canon: evidenceAvailable && evidenceContext.trustedForCanon === true ? 'yes' : 'no',
    },
  };
}

function buildOperatorApprovedRepairLoopProjection({
  missionRepairLoop = {},
  supportSnapshot = {},
  agentRealityLoopProjection = {},
  verificationReturnIntake = {},
  harnessAgentProjection = {},
  missionIntelligenceSummary = {},
} = {}) {
  const approvedMissionId = asText(missionRepairLoop.approvedMissionId || missionRepairLoop.missionId, 'none');
  const approvedMissionTitle = asText(missionRepairLoop.approvedMissionTitle || missionIntelligenceSummary.currentMissionSummary, 'Unapproved mission');
  const approvedScopeSummary = asText(missionRepairLoop.approvedScopeSummary, 'Bounded source-only repair scope.');
  const forbiddenScopeSummary = asText(missionRepairLoop.forbiddenScopeSummary, 'No protected Command Deck reveal/scroll behavior; no provider/backend/routing/ignition edits; no generated/runtime/secrets staging.');
  const retryCount = Number(missionRepairLoop.retryCount || 0);
  const maxRetries = Number(missionRepairLoop.maxRetries || 3);
  const bridgeDrop = asText(supportSnapshot?.executionMetadata?.operator_relief_bridge_drop_boundary, 'none');
  const arlProjectionAvailable = asText(supportSnapshot?.executionMetadata?.agent_reality_loop_projection_available, 'unknown');
  const arlBlocker = asText(supportSnapshot?.executionMetadata?.agent_reality_loop_availability_blocker, 'none');
  const protectedCanonAtRisk = asText(missionRepairLoop.protectedCanonAtRisk, 'no');
  const scopeChangeRequired = retryCount > maxRetries || protectedCanonAtRisk === 'yes' ? 'yes' : 'no';
  const failureClass = (arlProjectionAvailable === 'no' && /projection|bridge|command-deck-path/.test(`${arlBlocker} ${bridgeDrop}`.toLowerCase()))
    ? 'projection-bridge-loss'
    : (verificationReturnIntake.buildObserved === false ? 'build-failed'
      : (verificationReturnIntake.verifyObserved === false ? 'verify-failed'
        : (asList(verificationReturnIntake.missingEvidence).length > 0 ? 'check-failed' : 'unknown')));
  const operatorApprovalStillValid = scopeChangeRequired === 'yes' ? 'no' : (approvedMissionId === 'none' ? 'no' : 'yes');
  const status = operatorApprovalStillValid === 'no'
    ? (scopeChangeRequired === 'yes' ? 'scope-change-required' : 'awaiting-approval')
    : (failureClass === 'unknown' && verificationReturnIntake.evidenceCompleteness === 'complete' ? 'ready-for-merge-review' : 'proof-failed');
  const recommendedLead = status === 'ready-for-merge-review' ? 'operator' : (failureClass === 'projection-bridge-loss' ? 'openclaw' : 'codex');
  const requiredProofLines = ['targeted tests pass', 'build pass', 'verify pass', 'Support Snapshot required lines pass', 'live UI/Snapshot proof attached'];
  const missingProofLines = requiredProofLines.filter((line) => line.includes('Support Snapshot') ? failureClass === 'projection-bridge-loss' : false);
  const nextAction = recommendedLead === 'openclaw'
    ? 'Inspect and prove the failed bridge hop before patching; patch only the proven source-only hop.'
    : (recommendedLead === 'operator' ? 'Operator review/merge decision.' : 'Apply bounded deterministic repair and rerun required checks.');
  const copyMissionContract = `Approved mission: ${approvedMissionTitle}\nScope: ${approvedScopeSummary}\nForbidden: ${forbiddenScopeSummary}\nRe-ask operator only on scope expansion/protected canon risk/merge request/destructive action.`;
  return {
    status,
    approvedMissionId,
    approvedMissionTitle,
    approvedScopeSummary,
    forbiddenScopeSummary,
    operatorApprovalStillValid,
    approvalInvalidReason: operatorApprovalStillValid === 'no' ? (scopeChangeRequired === 'yes' ? 'scope-expanded-or-protected-canon-risk' : 'approval-missing') : 'none',
    failureClass,
    recommendedLead,
    recommendedLeadReason: recommendedLead === 'openclaw' ? 'Live/projection contradiction requires OpenClaw-first bridge tracing.' : (recommendedLead === 'operator' ? 'All required checks passed; operator decides merge.' : 'Deterministic boundary already known and bounded.'),
    nextAction,
    retryCount,
    maxRetries,
    scopeChangeRequired,
    protectedCanonAtRisk,
    mergeAllowed: 'no',
    liveProofRequired: 'yes',
    requiredProofLines,
    missingProofLines,
    currentBlocker: failureClass === 'projection-bridge-loss' ? (arlBlocker || bridgeDrop || 'projection-bridge-loss') : 'none',
    previousAttemptSummary: asText(agentRealityLoopProjection.nextBestAction, 'No prior attempt summary.'),
    lessonCandidate: 'When classifier intent succeeds but projection path fails, route OpenClaw-first to prove bridge hop.',
    copyOpenClawContinuationPacket: { missionId: approvedMissionId, failureClass, nextAction, boundedPatchRule: 'Only proven failed hop; source-only; no protected surfaces.', requiredChecks: ['tests', 'build', 'verify', 'Support Snapshot proof'] },
    copyCodexContinuationPacket: recommendedLead === 'codex' ? { missionId: approvedMissionId, nextAction, boundedScope: approvedScopeSummary, requiredChecks: ['tests', 'build', 'verify', 'Support Snapshot proof'] } : null,
    copyOperatorProofChecklist: requiredProofLines.join('\n'),
    copyMissionContract,
  };
}
function buildVerificationReturnIntake({ prEvidenceModel = {}, parsed = {}, missionState = 'active', missionBrainNextAction = {} } = {}) {
  const changedFiles = asList(prEvidenceModel.changedFiles || prEvidenceModel.files);
  const forbiddenPattern = /(apps\/stephanos\/dist\/|node_modules\/|runtime\/|root data\/|secret|token)/i;
  const forbiddenArtifactRisk = changedFiles.some((file) => forbiddenPattern.test(file));
  const buildObserved = parsed.buildRun === true;
  const verifyObserved = parsed.verifyRun === true;
  const browserProofObserved = missionBrainNextAction?.openEvidenceGaps?.some((gap) => gap.id === 'browser-proof-missing') ? 'missing' : 'reported';
  const missingEvidence = [];
  if (!buildObserved) missingEvidence.push('build evidence missing');
  if (!verifyObserved) missingEvidence.push('verify evidence missing');
  if (browserProofObserved === 'missing') missingEvidence.push('browser proof missing for UI mission');
  const technicallyCleanButProofPending = buildObserved && verifyObserved && !forbiddenArtifactRisk && browserProofObserved === 'missing';
  const returnStatus = forbiddenArtifactRisk
    ? 'blocked-forbidden-artifacts'
    : technicallyCleanButProofPending
      ? 'technically-clean-but-proof-pending'
      : (missingEvidence.length === 0 ? 'merge-candidate-operator-approval-required' : missionState);
  const mergeRecommendation = forbiddenArtifactRisk
    ? 'blocked'
    : technicallyCleanButProofPending
      ? 'blocked-pending-browser-proof'
      : (missingEvidence.length === 0 ? 'review-required' : 'needs-repair');
  return {
    returnStatus,
    evidenceCompleteness: missingEvidence.length === 0 ? 'complete' : 'incomplete',
    changedFiles,
    testsObserved: asList(parsed.testsRun),
    buildObserved,
    verifyObserved,
    browserProofObserved,
    forbiddenArtifactRisk,
    mergeRecommendation,
    requiredOperatorAction: mergeRecommendation === 'needs-repair' ? 'request-repair' : 'operator-review-and-approve',
    missingEvidence,
    repairPromptCandidate: mergeRecommendation === 'needs-repair' ? `Repair required.\nMissing evidence: ${missingEvidence.join(' | ') || 'none'}\nEnsure source-only files, rerun tests/build/verify, and include browser proof checklist for UI changes.` : '',
    sourceEvidence: ['proof_of_done.verificationJudge', 'pr_evidence.changedFiles', 'operator_relief.missionBrainNextAction'],
  };
}

function buildMissionApprovalQueue({ missionBrainNextAction = {}, agentWorkRoutingProjection = {}, verificationReturnIntake = {}, repairPrompt = {}, missionState = 'active', browserProof = {}, missionHandoff = {}, tests = {} } = {}) {
  const queue = [];
  const blockedReason = verificationReturnIntake.mergeRecommendation === 'blocked-pending-browser-proof'
    ? 'Browser proof is required before merge approval.'
    : (verificationReturnIntake.mergeRecommendation === 'blocked' ? 'Forbidden artifacts or policy risk present.' : asText(missionBrainNextAction.blockedReason, ''));
  const requiredProofBeforeApproval = Array.from(new Set([...(missionBrainNextAction.proofRequiredBeforeMerge || []), ...(verificationReturnIntake.missingEvidence || [])]));
  const base = {
    riskLevel: asText(missionBrainNextAction.riskLevel, 'medium'),
    approvalRequired: true,
    requiredProofBeforeApproval,
    blockedReason,
    allowedOperatorChoices: ['approve', 'hold', 'needs-repair', 'copy-prompt', 'mark-proof-pending'],
  };
  if (missionState === 'needs-browser-proof' || verificationReturnIntake.mergeRecommendation === 'blocked-pending-browser-proof') queue.push({ ...base, id: 'mq-run-browser-proof', title: 'Run browser proof checklist before approval', actionType: 'run-browser-proof', recommendedDecision: 'mark-proof-pending', reason: 'UI proof checklist is incomplete and merge review is blocked pending browser proof.', sourceEvidence: ['mission_brain.next_action', 'verification_return_intake', 'proof_of_done.browserChecksObserved'], copyPayload: truncateText(JSON.stringify({ actionType: 'run-browser-proof', checklist: browserProof?.missingItems || [], requiredProofBeforeApproval }, null, 2), MAX_QUEUE_PAYLOAD_LENGTH) });
  if (verificationReturnIntake.forbiddenArtifactRisk) queue.push({ ...base, id: 'mq-hold-merge', title: 'Hold merge and request source-truth repair', actionType: 'hold-merge', recommendedDecision: 'needs-repair', riskLevel: 'high', reason: 'Verification intake detected forbidden artifact risk.', sourceEvidence: verificationReturnIntake.sourceEvidence || [], copyPayload: truncateText(JSON.stringify({ actionType: 'hold-merge', changedFiles: verificationReturnIntake.changedFiles || [], reason: 'Forbidden artifacts present in staged files.' }, null, 2), MAX_QUEUE_PAYLOAD_LENGTH) });
  if ((verificationReturnIntake.missingEvidence || []).length > 0) queue.push({ ...base, id: 'mq-request-repair', title: 'Request repair packet for missing evidence', actionType: 'request-repair', recommendedDecision: 'needs-repair', reason: 'Evidence gaps remain unresolved and repair packet is required before approval.', sourceEvidence: verificationReturnIntake.sourceEvidence || [], copyPayload: truncateText(verificationReturnIntake.repairPromptCandidate || repairPrompt?.prompt || '', MAX_QUEUE_PAYLOAD_LENGTH) });
  if (agentWorkRoutingProjection.recommendedRoute === 'codex') queue.push({ ...base, id: 'mq-approve-codex-packet', title: 'Approve Codex packet draft for manual handoff', actionType: 'approve-codex-packet', recommendedDecision: 'approve', reason: 'Work routing produced a bounded Codex packet candidate that remains operator-gated.', sourceEvidence: agentWorkRoutingProjection.sourceEvidence || [], copyPayload: truncateText(JSON.stringify(agentWorkRoutingProjection || {}, null, 2), MAX_QUEUE_PAYLOAD_LENGTH) });
  if (verificationReturnIntake.mergeRecommendation === 'review-required') queue.push({ ...base, id: 'mq-approve-merge-review', title: 'Approve merge-review step', actionType: 'approve-merge-review', recommendedDecision: 'approve', reason: 'Verification indicates merge candidate readiness, pending explicit operator decision only.', sourceEvidence: verificationReturnIntake.sourceEvidence || [], copyPayload: truncateText(JSON.stringify({ actionType: 'approve-merge-review', mergeRecommendation: verificationReturnIntake.mergeRecommendation, requiredOperatorAction: verificationReturnIntake.requiredOperatorAction }, null, 2), MAX_QUEUE_PAYLOAD_LENGTH), blockedReason: '' });
  queue.push({ ...base, id: 'mq-update-handoff', title: 'Update mission handoff payload', actionType: 'update-handoff', recommendedDecision: 'copy-prompt', reason: 'Create bounded handoff/update payload for continuity and explicit operator actions.', sourceEvidence: ['mission_handoff', 'mission_brain.next_action', 'verification_return_intake'], copyPayload: truncateText(JSON.stringify({ currentLayer: missionBrainNextAction.currentPhase || 'unknown', completedSystems: ['Layer 3/4 Mission Brain', 'Layer 5 Work Routing Candidate', 'Layer 6 Verification Return Intake', 'Layer 7 Mission Approval Queue (read-only/operator-gated)'], pendingProof: requiredProofBeforeApproval, nextOperatorAction: queue[0]?.title || 'Review mission evidence', mergeRecommendation: verificationReturnIntake.mergeRecommendation || 'unknown', risks: [asText(missionBrainNextAction.riskLevel, 'medium'), blockedReason || 'none'], testsBuildVerifyStatus: { testsPassed: tests.passed || 0, buildPassed: tests.buildPassed === true, verifyPassed: tests.verifyPassed === true }, browserProofStatus: { required: browserProof.required === true, missingItems: browserProof.missingItems || [] } }, null, 2), MAX_QUEUE_PAYLOAD_LENGTH) });
  queue.push({ ...base, id: 'mq-manual-ignition', title: 'Manual ignition checkpoint', actionType: 'manual-ignition', recommendedDecision: 'hold', reason: 'Execution remains manual-only and operator intent must be explicit.', sourceEvidence: ['mission_brain.next_action'], copyPayload: truncateText(JSON.stringify({ actionType: 'manual-ignition', status: 'operator-gated-no-execution', nextAction: missionBrainNextAction.nextBestAction || 'Review evidence' }, null, 2), MAX_QUEUE_PAYLOAD_LENGTH) });
  return { queue, topRecommendation: queue[0] || null, approvalRequired: true };
}

function buildTopProblemsProjection({ missionBrainNextAction = {}, supportSnapshot = {}, verificationReturnIntake = {}, browserMissing = [] } = {}) {
  const problems = [];
  if (browserMissing.length > 0) {
    problems.push({
      id: 'browser-proof-pending',
      title: 'Command Deck browser proof still pending',
      severity: 'high',
      layer: 'ui-proof',
      whyItMatters: 'Protected cockpit canon cannot be merged without live browser proof.',
      evidence: [`missingBrowserChecks:${browserMissing.length}`, 'proof_of_done.browserChecksObserved'],
      nextBestAction: 'Run browser checklist and paste a fresh Support Snapshot.',
      recommendedAgent: 'manual-operator',
      proofRequired: 'browser-proof-checklist',
      blockedReason: 'Browser evidence missing.',
      professionalisationOpportunity: 'Replace telemetry-only claims with reality proof.',
      codexPromptCandidate: '',
      operatorDecisionRequired: true,
    });
  }
  if (asText(supportSnapshot?.runtimeStatus?.ignitionCleanlinessVerdict || supportSnapshot?.ignitionCleanlinessVerdict, 'unknown').toLowerCase() !== 'ready') {
    problems.push({
      id: 'ignition-cleanliness-not-ready',
      title: 'Ignition cleanliness requires operator attention',
      severity: 'high',
      layer: 'ignition',
      whyItMatters: 'Generated/runtime dirt repeatedly blocks safe startup and PR flow.',
      evidence: ['support_snapshot.runtimeStatus.ignitionCleanlinessVerdict', 'ignitionStatusModel'],
      nextBestAction: asText(supportSnapshot?.runtimeStatus?.ignitionNextOperatorAction || supportSnapshot?.ignitionNextOperatorAction, 'Review ignition cleanliness report and clear blockers.'),
      recommendedAgent: 'manual-operator',
      proofRequired: 'ignition-cleanliness-status',
      blockedReason: asText(supportSnapshot?.runtimeStatus?.ignitionBlockedReason || supportSnapshot?.ignitionBlockedReason, 'Ignition status not ready.'),
      professionalisationOpportunity: 'Keep ignition deterministic with autoclean/checkpoint guardrails.',
      codexPromptCandidate: '',
      operatorDecisionRequired: true,
    });
  }
  if ((verificationReturnIntake?.missingEvidence || []).length > 0) {
    problems.push({
      id: 'evidence-gaps-open',
      title: 'Verification evidence gaps remain open',
      severity: 'medium',
      layer: 'verification',
      whyItMatters: 'Missing proof creates repeated regressions and ambiguous merge readiness.',
      evidence: verificationReturnIntake?.missingEvidence || [],
      nextBestAction: 'Close missing build/verify/proof evidence before approval.',
      recommendedAgent: 'codex',
      proofRequired: 'build-verify-proof-complete',
      blockedReason: 'Verification return intake reports missing evidence.',
      professionalisationOpportunity: 'Promote compact, operator-readable proof summaries.',
      codexPromptCandidate: asText(missionBrainNextAction?.codexPromptCandidate, ''),
      operatorDecisionRequired: true,
    });
  }
  return problems.slice(0, 3);
}

function deriveHarnessRiskLevel(changedFiles = []) {
  const files = asList(changedFiles).map((file) => String(file).toLowerCase());
  if (files.length === 0) return 'high';
  const hasHigh = files.some((file) => /commanddeck|aiconsole|answerdelivery|answerdeliverytruth|useaiconsole|ignite-stephanos-local|guard-pr-clean|windows-launcher|provider|backend|routing|memory|session/.test(file));
  if (hasHigh) return 'high';
  const hasMedium = files.some((file) => /missionconsole|mission-console|stephanos-ui\/src\/components|scripts\/.*ignite|routing|metadata/.test(file));
  if (hasMedium) return 'medium';
  return 'low';
}

export function deriveOperatorReliefProjection(models = {}) {
  const { intentToBuildModel = {}, taskFinisherModel = {}, missionEvidenceLedgerModel = {}, prEvidenceModel = {}, proofOfDoneModel = {}, operatorDecisionQueue = {}, memoryLibrarianQueue = {}, supportSnapshot = {}, missionRepairLoopModel = {} } = models;
  const missionSpec = intentToBuildModel?.missionSpec || {};
  const verification = proofOfDoneModel?.verificationJudge || {};
  const parsed = verification.parsed || {};
  const testsRequired = asList(missionSpec?.repoArchitectureContext?.testsLikelyRequired);
  const testsPassed = asList(parsed.testsRun).length;
  const browserObserved = asList(proofOfDoneModel?.browserChecksObserved);
  const uiTouched = true;
  const browserRequired = uiTouched;
  const browserMissing = UI_BROWSER_CHECKLIST.filter((i) => !browserObserved.includes(i));
  const runtimeEvidence = { consoleErrors: asList(proofOfDoneModel?.consoleErrors), routeStatus: asText(supportSnapshot.routeStatus || supportSnapshot.runtimeStatus?.routeStatus, 'unknown'), providerStatus: asText(supportSnapshot.providerStatus || supportSnapshot.runtimeStatus?.providerStatus, 'unknown'), tileStatus: asText(supportSnapshot.tileStatus || supportSnapshot.runtimeStatus?.tileStatus, 'unknown'), warnings: [...asList(verification.warnings), ...asList(taskFinisherModel.warnings), ...asList(prEvidenceModel.evidenceWarnings)] };
  const operatorDecisionQueueV2 = asList(operatorDecisionQueue.decisions).map((entry, i) => ({ id: entry.id || `decision-${i + 1}`, decisionType: entry.decisionType || 'defer', label: entry.label || entry.title || 'Operator decision', reason: entry.reason || 'Operator approval gate.', choices: asList(entry.choices).length ? asList(entry.choices) : ['approve-merge','request-repair','reject','defer','promote-lesson'], recommendedChoice: entry.recommendedChoice || 'defer', destructiveOrHighRisk: entry.destructiveOrHighRisk === true, approvalRequired: true }));

  let missionState = 'active';
  if (parsed.hasFailure || runtimeEvidence.consoleErrors.length > 0) missionState = 'needs-repair';
  else if (!parsed.buildRun) missionState = 'needs-build';
  else if (!parsed.verifyRun) missionState = 'needs-verify';
  else if (testsRequired.length > 0 && testsPassed === 0) missionState = 'needs-tests';
  else if (browserRequired && browserMissing.length > 0) missionState = 'needs-browser-proof';
  else if (verification.mergeReadyCandidate) missionState = 'merge-candidate';
  if (verification.mergeReadyCandidate && operatorDecisionQueueV2.some((d) => d.decisionType === 'approve-merge')) missionState = 'ready-for-operator';

  const repairPromptAvailable = ['needs-repair', 'needs-tests', 'needs-build', 'needs-verify', 'needs-browser-proof'].includes(missionState);
  const evidenceGaps = buildEvidenceGaps({ testsRequired, testsPassed, parsed, browserRequired, browserMissing, runtimeEvidence, verification, operatorDecisions: operatorDecisionQueueV2, repairPromptAvailable, codexChangedFiles: asList(prEvidenceModel.changedFiles || prEvidenceModel.files) });
  const aiConsoleAutoscrollProof = deriveAiConsoleAutoscrollProof(supportSnapshot);
  if (!aiConsoleAutoscrollProof.complete) {
    evidenceGaps.push({ id: 'missing-live-proof', label: 'AIConsole autoscroll live proof missing', severity: 'high', reason: `Missing proof signals: ${aiConsoleAutoscrollProof.missing.join(', ')}.`, requiredAction: 'capture-support-snapshot-with-final-assistant-answer', source: aiConsoleAutoscrollProof.source });
  }

  const actions = [];
  if (missionState === 'needs-tests') actions.push({ id: 'run-targeted-tests', label: 'Run targeted tests', reason: 'Required tests are missing.', actionType: 'command', commandOrPromptAvailable: true, operatorApprovalRequired: false });
  if (missionState === 'needs-build') actions.push({ id: 'run-build', label: 'Run stephanos build', reason: 'Build evidence is required.', actionType: 'command', commandOrPromptAvailable: true, operatorApprovalRequired: false });
  if (missionState === 'needs-verify') actions.push({ id: 'run-verify', label: 'Run stephanos verify', reason: 'Verify evidence is required.', actionType: 'command', commandOrPromptAvailable: true, operatorApprovalRequired: false });
  if (missionState === 'needs-browser-proof') actions.push({ id: 'run-browser-proof', label: 'Run browser proof checklist', reason: 'UI-facing evidence is missing.', actionType: 'manual-proof', commandOrPromptAvailable: true, operatorApprovalRequired: true });
  if (missionState === 'needs-repair') actions.push({ id: 'request-codex-repair', label: 'Request Codex repair', reason: 'Failures or runtime errors detected.', actionType: 'repair', commandOrPromptAvailable: true, operatorApprovalRequired: true });
  if (missionState === 'merge-candidate' || missionState === 'ready-for-operator') actions.push({ id: 'approve-merge', label: 'Approve merge candidate', reason: 'All required evidence present; operator approval still required.', actionType: 'approval', commandOrPromptAvailable: false, operatorApprovalRequired: true });

  const nextBestAction = actions[0] || { id: 'defer', label: 'Defer', reason: 'No immediate action derived.', actionType: 'decision', commandOrPromptAvailable: false, operatorApprovalRequired: true };
  const completedProofs = [];
  if (aiConsoleAutoscrollProof.complete) completedProofs.push({ id: AI_CONSOLE_AUTOSCROLL_PROOF_ID, label: 'AIConsole answer pane autoscroll live proof complete', source: aiConsoleAutoscrollProof.source });
  if (parsed.buildRun) completedProofs.push({ id: 'build-proof', label: 'stephanos build recorded', source: 'proof_of_done.verificationJudge' });
  if (parsed.verifyRun) completedProofs.push({ id: 'verify-proof', label: 'stephanos verify recorded', source: 'proof_of_done.verificationJudge' });
  const layerStatus = {
    0: 'complete',
    1: parsed.buildRun && parsed.verifyRun ? 'complete' : 'incomplete',
    2: aiConsoleAutoscrollProof.complete ? 'complete' : 'incomplete',
    3: 'in_progress',
    4: 'in_progress',
    5: 'pending',
    6: 'pending',
    7: 'pending',
  };
  const currentPhase = layerStatus[2] === 'complete' ? 'Layer 3 → Layer 4 climb' : 'Layer 2 proof collection';
  const missionObjective = asText(missionSpec.objective, missionSpec.rawIntent || 'Not provided');
  const codexPromptCandidate = truncateText([
    'Stephanos OS / Reality Forge — Mission Brain Layer 3 + Layer 4 follow-up.',
    `Mission objective: ${missionObjective}`,
    `Current phase: ${currentPhase}`,
    `Completed proofs: ${completedProofs.map((p) => p.label).join(' | ') || 'none'}`,
    `Evidence gaps: ${evidenceGaps.map((g) => `${g.id}:${g.label}`).join(' | ') || 'none'}`,
    'Inspect first: stephanos-ui/src/state/operatorReliefProjection.js, stephanos-ui/src/components/MissionConsoleTile.jsx, tests/operator-relief-projection.test.mjs, tests/mission-console-operator-relief-panel.test.mjs.',
    'Constraints: keep runtime truth canonical; no duplicate Mission Console surfaces; no autoscroll refactor unless failing test; read-only projection only; no dist hand edits.',
    'Tests required: node --test tests/operator-relief-projection.test.mjs tests/mission-console-operator-relief-panel.test.mjs stephanos-ui/src/components/AIConsole.render.test.mjs; npm run stephanos:build; npm run stephanos:verify.',
    'Definition of done: compact Mission Brain / Next Action summary present, evidence gaps classified, Layer 2 proof promoted when diagnostics support it, Layer 3/4 next action generated, copy payload bounded.',
    'Staging restrictions: do not stage runtime data/root data/node_modules/secrets/tokens/generated dist.',
  ].join('\n'), 3500);
  const missionBrainNextAction = {
    missionObjective,
    currentPhase,
    layerStatus,
    completedProofs,
    openEvidenceGaps: evidenceGaps,
    nextBestAction: nextBestAction.label,
    codexPromptCandidate,
    operatorActionCandidate: nextBestAction.label,
    mergeReadiness: evidenceGaps.length === 0 ? 'review-required' : 'blocked',
    riskLevel: evidenceGaps.some((g) => g.severity === 'high') ? 'high' : evidenceGaps.length > 0 ? 'medium' : 'medium',
    blockedReason: evidenceGaps[0]?.reason || 'Operator approval required.',
    proofRequiredBeforeMerge: evidenceGaps.map((gap) => gap.requiredAction),
    sourceEvidence: [...new Set([...completedProofs.map((p) => p.source), ...evidenceGaps.map((g) => g.source)])],
  };
  const agentWorkRoutingProjection = buildAgentWorkRoutingProjection({ missionBrainNextAction, missionSpec, supportSnapshot });
  const verificationReturnIntake = buildVerificationReturnIntake({ prEvidenceModel, parsed, missionState, missionBrainNextAction });
  const lessonCandidates = asList(memoryLibrarianQueue.queue).map((c, i) => ({ id: c.id || `lesson-${i + 1}`, title: c.title || c.summary || 'Lesson candidate', reason: c.reason || 'Derived from mission evidence.', source: c.source || 'memory_librarian', approvalRequired: true }));
  const repairPromptBodyRaw = repairPromptAvailable ? [`Mission objective: ${asText(missionSpec.objective, missionSpec.rawIntent || 'unknown')}`,`Current state: ${missionState}`,`Failing layer: ${evidenceGaps[0]?.label || 'unknown'}`,`Evidence gaps: ${evidenceGaps.map((g) => g.label).join(' | ') || 'none'}`, runtimeEvidence.consoleErrors.length ? `Observed runtime/browser errors: ${runtimeEvidence.consoleErrors.join(' | ')}` : null,'Constraint: Do not create new canon; audit existing working surface first.','Acceptance criteria: close all evidence gaps, keep operator approval required, no auto-merge.','Required tests: node --test ... operator relief + mission console suites.','Build/verify: npm run stephanos:build && npm run stephanos:verify',`Browser proof required: ${browserRequired ? 'yes' : 'no'}.`].join('\n') : '';
  const repairPromptBody = truncateText(repairPromptBodyRaw, MAX_REPAIR_PROMPT_LENGTH);

  const missionHandoff = { title: asText(missionSpec.title, 'Mission handoff'), objective: asText(missionSpec.objective, missionSpec.rawIntent || 'Not provided'), currentState: missionState, mergeSafety: verification.mergeReadyCandidate ? 'merge-candidate' : 'blocked', nextBestAction, evidenceSummary: { testsPassed, buildRun: parsed.buildRun === true, verifyRun: parsed.verifyRun === true, browserObserved: browserObserved.length }, evidenceGaps, repairPrompt: { available: repairPromptAvailable, title: 'Operator Relief V2 Repair Prompt', body: repairPromptBody, sourceEvidence: evidenceGaps.map((g) => g.source), copyLabel: 'Copy Repair Prompt' }, browserProofChecklist: { required: browserRequired, reason: browserRequired ? 'UI-facing mission requires browser proof before merge.' : 'Non-UI mission.', checklistItems: UI_BROWSER_CHECKLIST, observedItems: browserObserved, missingItems: browserMissing }, operatorDecisionQueue: operatorDecisionQueueV2, canonConstraints: ['No duplicate Mission Console shells/panes.', 'Merge is never automatic.', 'Operator remains final approver.'], requiredCommands: ['node --test tests/operator-relief-projection.test.mjs tests/operator-relief-merge-safety.test.mjs tests/operator-relief-repair-prompt.test.mjs tests/operator-relief-music-failure-pack.test.mjs tests/mission-console-operator-relief-panel.test.mjs','node --test stephanos-ui/src/components/MissionConsoleTile.render.test.mjs stephanos-ui/src/components/AIConsole.render.test.mjs stephanos-ui/src/components/AnswerPaneCopyButton.test.mjs stephanos-ui/src/components/MissionCommandDeck.render.test.mjs stephanos-ui/src/components/CollapsiblePanel.render.test.mjs stephanos-ui/src/components/stephanosPaneCanon.test.mjs','npm run stephanos:build','npm run stephanos:verify'] };
  const missionApprovalQueue = buildMissionApprovalQueue({ missionBrainNextAction, agentWorkRoutingProjection, verificationReturnIntake, repairPrompt: { prompt: repairPromptBody }, missionState, browserProof: missionHandoff.browserProofChecklist, missionHandoff, tests: { passed: testsPassed, buildPassed: parsed.buildRun === true, verifyPassed: parsed.verifyRun === true } });
  const topProblemsProjection = buildTopProblemsProjection({ missionBrainNextAction, supportSnapshot, verificationReturnIntake, browserMissing });
  const changedFiles = asList(prEvidenceModel.changedFiles || prEvidenceModel.files);
  const harnessRiskLevel = deriveHarnessRiskLevel(changedFiles);
  const protectedCanonTouched = changedFiles.filter((file) => /commanddeck|aiconsole|answerdelivery|ignite-stephanos-local|guard-pr-clean|windows-launcher|provider|backend|routing|memory|operatorrelief|mission-console|harness/i.test(file));
  const { protectedCanonClauses, protectedSubsystems, protectedCanonWarning, fallbackApplied, hasUnknownSubsystem } = deriveProtectedCanonClauses({ riskLevel: harnessRiskLevel, changedFiles });
  const protectedCanonAtRisk = protectedSubsystems.map((k) => k.toLowerCase());
  const browserProofRequired = browserRequired && changedFiles.some((file) => file.startsWith('stephanos-ui/'));

  const missionIntelligenceSummary = {
    missionIntelligenceStatus: missionState,
    currentMissionSummary: `${missionHandoff.title}: ${missionObjective}`,
    currentBlockers: evidenceGaps.map((gap) => gap.label),
    nextBestAction: nextBestAction.label,
    operatorDecisionRequired: true,
    codexReady: agentWorkRoutingProjection.codexReady || (evidenceGaps.length === 0 ? 'yes' : 'no'),
    openClawReady: agentWorkRoutingProjection.openClawResearchReady || (evidenceGaps.length === 0 ? 'yes' : 'no'),
    harnessContractAvailable: true,
    protectedCanonSummary: protectedCanonClauses.join(' | ') || 'No additional protected canon clauses derived.',
    proofRequiredSummary: missionHandoff.browserProofChecklist.required ? 'browser-proof + targeted tests + build/verify + pr-clean' : 'targeted tests + build/verify + pr-clean',
    relevantPaneTarget: 'missionConsoleOperatorReliefPanel',
    commandDeckContextAvailable: true,
    aiContextWarnings: [
      ...(runtimeEvidence.warnings || []),
      ...(verificationReturnIntake.missingEvidence || []).slice(0, 2),
    ].filter(Boolean),
  };

  const harnessAgentProjection = {
    harnessVersion: HARNESS_AGENT_VERSION,
    harnessStatus: harnessRiskLevel === 'high' ? 'blocked-until-proof' : 'read-only-advisory',
    currentMissionSummary: `${missionObjective} (${currentPhase})`,
    protectedCanonTouched,
    protectedCanonAtRisk,
    allowedFileScopes: ['stephanos-ui/src/state/**', 'stephanos-ui/src/components/**', 'tests/**', 'docs/**', 'shared/**'],
    forbiddenFileScopes: ['apps/stephanos/dist/**', 'runtime/**', 'node_modules/**', 'secrets/**', '*.bin'],
    generatedArtifactRisk: verificationReturnIntake.forbiddenArtifactRisk,
    browserProofRequired,
    sourceOnlyRequired: true,
    requiredTests: Array.from(new Set([...(missionHandoff.requiredCommands || []).filter((command) => command.startsWith('node --test'))])),
    requiredBuildVerify: true,
    requiredPrClean: true,
    protectedCanonClauses,
    protectedSubsystems,
    protectedCanonWarning,
    forbiddenFiles: ['apps/stephanos/dist/**', 'runtime/**', 'node_modules/**', 'secrets/**', 'root data/**'],
    definitionOfDone: ['preserve-canon-truth-boundaries', 'tests-build-verify-pr-clean-pass', 'copy-contract-is-actionable'],
    finalReportRequirements: ['audit-findings', 'files-changed', 'clause-catalogue', 'risk-to-clause-rules', 'example-contract-payload', 'tests-and-check-results', 'browser-proof-status', 'next-operator-action'],
    mergeRecommendation: (harnessRiskLevel === 'high' && (hasUnknownSubsystem || protectedCanonClauses.length === 0 || verificationReturnIntake.missingEvidence.length > 0 || browserProofRequired))
      ? 'hold-for-operator-review'
      : ((protectedCanonWarning || harnessRiskLevel === 'high') ? 'hold-for-operator-review' : verificationReturnIntake.mergeRecommendation),
    repairPromptRequired: evidenceGaps.length > 0,
    repairPromptCandidate: repairPromptBody,
    nextOperatorAction: (harnessRiskLevel === 'high' && hasUnknownSubsystem)
      ? 'Review conservative canon fallback, provide/approve mission scope, then proceed.'
      : (protectedCanonWarning ? 'Protected canon clauses need review before merge recommendation.' : (missionApprovalQueue.topRecommendation?.title || 'Review harness contract.')),
  };
  const coBuilderLoopProjection = buildCoBuilderLoopProjection({ missionIntelligenceSummary, harnessAgentProjection, agentWorkRoutingProjection, verificationReturnIntake, missionBrainNextAction, supportSnapshot });
  const builderMeshProjection = buildBuilderMeshProjection({
    missionIntelligenceSummary,
    harnessAgentProjection,
    agentWorkRoutingProjection,
    coBuilderLoopProjection,
    verificationReturnIntake,
    missionBrainNextAction,
    supportSnapshot,
    prEvidenceModel,
    browserProof: missionHandoff.browserProofChecklist,
    builderWorkbenchInput: supportSnapshot.builderWorkbenchInput || models.builderWorkbenchInput || {},
  });
  const preliminaryMissionEvidenceLedgerProjection = deriveMissionEvidenceLedgerProjection({
    builderMeshProjection,
    builderWorkbenchProjection: builderMeshProjection.builderWorkbenchProjection || {},
    openClawSourcePackRunner: builderMeshProjection.builderWorkbenchProjection?.openClawSourcePackRunner || {},
    openClawWorkspaceHygiene: builderMeshProjection.builderWorkbenchProjection?.openClawWorkspaceHygiene || {},
    missionVerification: verificationReturnIntake,
    prEvidence: prEvidenceModel,
    uiRealityTruth: supportSnapshot.uiRealityTruth || { status: supportSnapshot.uiRealityStatus },
  });
  const preliminaryMissionEvidenceContextSummary = deriveMissionEvidenceContextSummary(preliminaryMissionEvidenceLedgerProjection);
  const packetBayProjection = derivePacketBayProjection({
    builderMeshProjection,
    supportSnapshot,
    missionBrainNextAction,
    agentWorkRoutingProjection,
    missionEvidenceLedgerProjection: preliminaryMissionEvidenceLedgerProjection,
    missionEvidenceContextSummary: preliminaryMissionEvidenceContextSummary,
  });
  const builderHarnessProjection = buildBuilderHarnessProjection({
    missionIntelligenceSummary,
    harnessAgentProjection,
    agentWorkRoutingProjection,
    coBuilderLoopProjection,
    verificationReturnIntake,
    missionBrainNextAction,
    supportSnapshot,
    prEvidenceModel,
    browserProof: missionHandoff.browserProofChecklist,
  });
  let agentRealityLoopProjection = buildAgentRealityLoopProjection({
    missionState,
    missionBrainNextAction,
    harnessAgentProjection,
    agentWorkRoutingProjection,
    verificationReturnIntake,
    missionIntelligenceSummary,
    lessonCandidates,
    browserProof: missionHandoff.browserProofChecklist,
    packetBayProjection,
    builderMeshProjection,
    builderWorkbenchProjection: builderMeshProjection.builderWorkbenchProjection || {},
    openClawSourcePackRunner: builderMeshProjection.builderWorkbenchProjection?.openClawSourcePackRunner || {},
    uiRealityTruth: supportSnapshot.uiRealityTruth || supportSnapshot.uiRealityStatus || {},
    openClawWorkspaceHygiene: builderMeshProjection.builderWorkbenchProjection?.openClawWorkspaceHygiene || {},
    missionConsoleTruth: supportSnapshot.missionConsoleTruth || {},
    codexDispatchTruth: supportSnapshot.codexDispatchTruth || {},
    supportSnapshot,
    missionEvidenceContextSummary: preliminaryMissionEvidenceContextSummary,
  });
  const projectAwarenessProjection = buildProjectAwarenessProjection({
    activeMission: supportSnapshot.activeMission || models.activeMission || {},
    missionPacket: supportSnapshot.missionPacket || models.missionPacket || {},
    intentToBuild: intentToBuildModel,
    builderMeshProjection,
    packetBayProjection,
    agentRealityLoopProjection,
    builderWorkbenchProjection: builderMeshProjection.builderWorkbenchProjection || {},
    openClawSourcePackRunner: builderMeshProjection.builderWorkbenchProjection?.openClawSourcePackRunner || {},
    missionVerification: verificationReturnIntake,
    prEvidence: prEvidenceModel,
    uiRealityTruth: supportSnapshot.uiRealityTruth || { status: supportSnapshot.uiRealityStatus },
    openClawWorkspaceHygiene: builderMeshProjection.builderWorkbenchProjection?.openClawWorkspaceHygiene || {},
    operatorProfile: supportSnapshot.operatorProfile || models.operatorProfile || {},
    missionIntelligence: missionIntelligenceSummary,
    supportSnapshot,
    missionEvidenceContextSummary: preliminaryMissionEvidenceContextSummary,
  });
  agentRealityLoopProjection = {
    ...agentRealityLoopProjection,
    projectAwarenessContextSource: projectAwarenessProjection.projectionSource,
    projectAwarenessContextInjected: projectAwarenessProjection.status !== 'unavailable' ? 'yes' : 'no',
    supportSnapshotFields: {
      ...(agentRealityLoopProjection.supportSnapshotFields || {}),
      agent_reality_loop_context_source: projectAwarenessProjection.status !== 'unavailable' ? projectAwarenessProjection.projectionSource : 'none',
      agent_reality_loop_context_injected: projectAwarenessProjection.status !== 'unavailable' ? 'yes' : 'no',
    },
  };
  const missionEvidenceLedgerProjection = deriveMissionEvidenceLedgerProjection({
    projectAwarenessProjection,
    agentRealityLoopProjection,
    packetBayProjection,
    builderMeshProjection,
    builderWorkbenchProjection: builderMeshProjection.builderWorkbenchProjection || {},
    openClawSourcePackRunner: builderMeshProjection.builderWorkbenchProjection?.openClawSourcePackRunner || {},
    openClawWorkspaceHygiene: builderMeshProjection.builderWorkbenchProjection?.openClawWorkspaceHygiene || {},
    missionVerification: verificationReturnIntake,
    prEvidence: prEvidenceModel,
    uiRealityTruth: supportSnapshot.uiRealityTruth || { status: supportSnapshot.uiRealityStatus },
  });
  const operatorApprovedRepairLoopProjection = buildOperatorApprovedRepairLoopProjection({
    missionRepairLoop: missionRepairLoopModel,
    supportSnapshot,
    agentRealityLoopProjection,
    verificationReturnIntake,
    harnessAgentProjection,
    missionIntelligenceSummary,
  });

  return { status: missionState,
    harnessVersion: HARNESS_AGENT_VERSION, mission: { title: missionHandoff.title, objective: missionHandoff.objective, currentPhase: asText(taskFinisherModel.finishPlanStatus, 'draft') }, codex: { prTitle: asText(prEvidenceModel.prTitle, 'unknown'), branch: asText(prEvidenceModel.branch || prEvidenceModel.prBranch, 'unknown'), deltaSummary: asText(prEvidenceModel.prTitle || missionEvidenceLedgerModel?.summary?.missionReadyNarrative, 'Codex delta pending PR evidence.') }, tests: { required: testsRequired, passed: testsPassed, failed: parsed.hasFailure ? 1 : 0, buildPassed: parsed.buildRun === true, verifyPassed: parsed.verifyRun === true }, browserProof: missionHandoff.browserProofChecklist, runtimeEvidence, mergeSafety: { verdict: missionState === 'needs-build' || missionState === 'needs-verify' ? 'needs-tests' : (missionState === 'needs-browser-proof' ? 'needs-browser-proof' : (verification.mergeReadyCandidate ? 'safe-to-merge' : 'not-safe')), requiredApprovals: ['Operator approval required for merge.'] }, evidenceGaps, nextBestAction, nextActions: actions, repairPrompt: { ...missionHandoff.repairPrompt, prompt: missionHandoff.repairPrompt.body }, operatorDecisionQueue: operatorDecisionQueueV2, operatorDecision: { required: true, options: ['approve-merge','request-repair','reject','defer','promote-lesson'], recommendedOption: missionState === 'merge-candidate' ? 'approve-merge' : 'request-repair' }, lessonCandidates, missionHandoff, missionTitle: missionHandoff.title, missionObjective: missionHandoff.objective, codexDeltaSummary: asText(prEvidenceModel.prTitle || missionEvidenceLedgerModel?.summary?.missionReadyNarrative, 'Codex delta pending PR evidence.'), missionBrainNextAction, agentWorkRoutingProjection, verificationReturnIntake, missionApprovalQueue, topProblemsProjection, harnessAgentProjection, missionIntelligenceSummary, coBuilderLoopProjection, builderMeshProjection, packetBayProjection, builderHarnessProjection, agentRealityLoopProjection, projectAwarenessProjection, missionEvidenceLedgerProjection, operatorApprovedRepairLoopProjection };
}
