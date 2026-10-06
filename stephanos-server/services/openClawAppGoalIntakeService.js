import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

import {
  createSharedWorkspaceGoalRecord,
  ensureSharedWorkspaceLayout,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';

export const OPENCLAW_APP_GOAL_INTAKE_SCHEMA = 'stephanos.openclaw-app-goal-intake.v1';
export const OPENCLAW_APP_GOAL_REPOSITORY = 'Cheekyfellastef/stephan-os';

const SAFE_AGENT_IDS = new Set(['stephanos-scout-coder', 'openclaw-standalone']);
const SAFE_PROVIDER_ROUTES = new Set(['AUTO', 'OPENCLAW_LOCAL', 'OPENCLAW_STANDALONE']);
const SAFE_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\/?$/;
const SAFE_TEST = /^node(?:\.exe)?\s+--(?:test|check)(?:\s+[^&|><^`\r\n]+)+$/i;
const MAX_TEXT = 4000;
const MAX_ITEMS = 20;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function unique(value) {
  return [...new Set(value)];
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function safeRequestId(input) {
  const supplied = text(input.requestId).toLowerCase();
  if (/^[a-z0-9][a-z0-9._-]{7,79}$/.test(supplied)) return supplied;
  const digest = createHash('sha256').update(JSON.stringify({
    requestedBy: text(input.requestedBy).toLowerCase(),
    intent: text(input.intent),
    outcome: text(input.intendedOutcome),
    resourcePaths: unique(list(input.resourcePaths)).sort(),
    preferredBuilder: text(input.preferredBuilder, 'AUTO').toUpperCase(),
  })).digest('hex').slice(0, 24);
  return `openclaw-app-${digest}`;
}

function normalizedInput(input = {}) {
  const requestedBy = text(input.requestedBy).toLowerCase();
  const intent = text(input.intent);
  const intendedOutcome = text(input.intendedOutcome, intent);
  const resourcePaths = unique(list(input.resourcePaths).map((path) => path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')));
  const requiredTests = unique(list(input.requiredTests));
  const requiredEvidence = unique(list(input.requiredEvidence));
  const preferredBuilder = text(input.preferredBuilder, 'AUTO').toUpperCase();
  const requestId = safeRequestId({ ...input, requestedBy, intent, intendedOutcome, resourcePaths, preferredBuilder });
  return { requestId, requestedBy, intent, intendedOutcome, resourcePaths, requiredTests, requiredEvidence, preferredBuilder };
}

export function validateOpenClawAppGoalIntake(input = {}) {
  const normalized = normalizedInput(input);
  const blockers = [];
  if (!SAFE_AGENT_IDS.has(normalized.requestedBy)) blockers.push('openclaw-app-requesting-agent-invalid');
  if (normalized.intent.length < 4 || normalized.intent.length > MAX_TEXT) blockers.push('openclaw-app-intent-invalid');
  if (normalized.intendedOutcome.length < 4 || normalized.intendedOutcome.length > MAX_TEXT) blockers.push('openclaw-app-outcome-invalid');
  if (!normalized.resourcePaths.length || normalized.resourcePaths.length > MAX_ITEMS) blockers.push('openclaw-app-resource-scope-required');
  if (normalized.resourcePaths.some((path) => !SAFE_PATH.test(path))) blockers.push('openclaw-app-resource-path-invalid');
  if (!normalized.requiredTests.length || normalized.requiredTests.length > MAX_ITEMS) blockers.push('openclaw-app-required-tests-required');
  if (normalized.requiredTests.some((command) => command.length > 500 || !SAFE_TEST.test(command))) blockers.push('openclaw-app-test-command-unsafe');
  if (!normalized.requiredEvidence.length || normalized.requiredEvidence.length > MAX_ITEMS) blockers.push('openclaw-app-required-evidence-required');
  if (normalized.requiredEvidence.some((entry) => entry.length > 500)) blockers.push('openclaw-app-evidence-requirement-invalid');
  if (!SAFE_PROVIDER_ROUTES.has(normalized.preferredBuilder)) blockers.push('openclaw-app-preferred-builder-invalid');
  return freeze({
    valid: blockers.length === 0,
    blockers: unique(blockers),
    input: normalized,
    finalVerdict: blockers.length ? 'OPENCLAW_APP_GOAL_INTAKE_BLOCKED' : 'OPENCLAW_APP_GOAL_INTAKE_VALID',
  });
}

function issueMarker(requestId) {
  return `stephanos-openclaw-app-goal:${requestId}`;
}

export function buildOpenClawAppGoalIssue(input = {}) {
  const validation = validateOpenClawAppGoalIntake(input);
  if (!validation.valid) return freeze({ ok: false, validation });
  const value = validation.input;
  const marker = issueMarker(value.requestId);
  const title = `Goal: ${value.intendedOutcome}`.slice(0, 240);
  const body = [
    `<!-- ${marker} -->`,
    '',
    '## OpenClaw app operator request',
    '',
    `Requested by: \`${value.requestedBy}\``,
    `Preferred builder: \`${value.preferredBuilder}\``,
    '',
    '### Intent',
    '',
    value.intent,
    '',
    '### Intended outcome',
    '',
    value.intendedOutcome,
    '',
    '### Scheduler-approved source scope',
    '',
    ...value.resourcePaths.map((path) => `- \`${path}\``),
    '',
    '### Required deterministic tests',
    '',
    ...value.requiredTests.map((command) => `- \`${command}\``),
    '',
    '### Required evidence',
    '',
    ...value.requiredEvidence.map((requirement) => `- ${requirement}`),
    '',
    '## Authority boundary',
    '',
    'This intake creates a canonical goal only. It grants no direct source mutation, merge, deployment, arbitrary-shell, credential, or approval-bypass authority.',
    'Source construction must flow through the canonical Stephanos Goal -> Builder conveyor and its exact pickup/execution receipts.',
  ].join('\n');
  return freeze({ ok: true, schemaVersion: OPENCLAW_APP_GOAL_INTAKE_SCHEMA, marker, title, body, request: value });
}

function captureGithub(execFileFn, ghCommand, args, cwd) {
  return new Promise((resolve) => {
    execFileFn(ghCommand, args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout = '', stderr = '') => resolve(freeze({
      ok: !error,
      status: Number.isInteger(error?.code) ? error.code : (error ? null : 0),
      stdout: String(stdout ?? ''),
      stderr: String(stderr ?? error?.message ?? '').slice(0, 1000),
      errorCode: typeof error?.code === 'string' ? error.code : '',
    }))));
  });
}

function parseJson(value) {
  try { return JSON.parse(String(value || '')); } catch { return null; }
}

export function createOpenClawAppGithubGoalAdapter(options = {}) {
  const execFileFn = options.execFileFn || execFile;
  const ghCommand = text(options.ghCommand, process.env.STEPHANOS_GH_COMMAND || 'gh');
  const cwd = options.repoRoot || process.cwd();
  return freeze({
    async findByMarker(marker) {
      const query = `repo:${OPENCLAW_APP_GOAL_REPOSITORY} is:issue is:open in:body "${marker}"`;
      const result = await captureGithub(execFileFn, ghCommand, ['api', 'search/issues', '--method', 'GET', '-f', `q=${query}`, '-f', 'per_page=20'], cwd);
      if (!result.ok) return freeze({ ok: false, reason: result.errorCode === 'ENOENT' ? 'OPENCLAW_APP_GH_CLI_MISSING' : 'OPENCLAW_APP_GOAL_SEARCH_FAILED' });
      const payload = parseJson(result.stdout);
      if (!payload || !Array.isArray(payload.items)) return freeze({ ok: false, reason: 'OPENCLAW_APP_GOAL_SEARCH_JSON_INVALID' });
      const found = payload.items.find((item) => text(item?.state).toLowerCase() === 'open' && text(item?.body).includes(marker));
      return freeze({ ok: true, issue: found ? { number: Number(found.number), title: text(found.title), url: text(found.html_url) } : null });
    },
    async createIssue(shape) {
      const result = await captureGithub(execFileFn, ghCommand, ['api', `repos/${OPENCLAW_APP_GOAL_REPOSITORY}/issues`, '--method', 'POST', '-f', `title=${shape.title}`, '-f', `body=${shape.body}`], cwd);
      if (!result.ok) return freeze({ ok: false, reason: result.errorCode === 'ENOENT' ? 'OPENCLAW_APP_GH_CLI_MISSING' : 'OPENCLAW_APP_GOAL_CREATE_FAILED' });
      const payload = parseJson(result.stdout);
      const number = Number(payload?.number);
      if (!Number.isSafeInteger(number) || number < 1) return freeze({ ok: false, reason: 'OPENCLAW_APP_GOAL_CREATE_JSON_INVALID' });
      return freeze({ ok: true, issue: { number, title: text(payload.title, shape.title), url: text(payload.html_url) } });
    },
  });
}

function schedulerRoute(preferredBuilder) {
  if (preferredBuilder === 'OPENCLAW_LOCAL') return 'OPENCLAW_LOCAL';
  if (preferredBuilder === 'OPENCLAW_STANDALONE') return 'OPENCLAW_STANDALONE';
  return 'PROVIDER_NEUTRAL_BUILD';
}

export async function admitOpenClawAppGoal(input = {}, options = {}) {
  const shape = buildOpenClawAppGoalIssue(input);
  if (!shape.ok) return freeze({ ok: false, reason: shape.validation.blockers[0], validation: shape.validation });
  const adapter = options.githubAdapter || createOpenClawAppGithubGoalAdapter(options);
  const existing = await adapter.findByMarker(shape.marker);
  if (existing?.ok !== true) return freeze({ ok: false, reason: text(existing?.reason, 'OPENCLAW_APP_GOAL_SEARCH_FAILED') });
  let issue = existing.issue;
  let created = false;
  if (!issue) {
    const creation = await adapter.createIssue(shape);
    if (creation?.ok !== true) return freeze({ ok: false, reason: text(creation?.reason, 'OPENCLAW_APP_GOAL_CREATE_FAILED') });
    issue = creation.issue;
    created = true;
  }

  const issueNumber = Number(issue?.number);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) return freeze({ ok: false, reason: 'OPENCLAW_APP_GOAL_ISSUE_INVALID' });
  const now = options.now instanceof Date ? options.now : new Date();
  const timestampUtc = now.toISOString();
  const layout = await ensureSharedWorkspaceLayout({ root: options.workspaceRoot, repoRoot: options.repoRoot });
  if (!layout.ok) return freeze({ ok: false, reason: layout.reason });

  const goalRecord = freeze({
    ...createSharedWorkspaceGoalRecord({
      goalId: `goal-${issueNumber}`,
      participantId: shape.request.requestedBy,
      timestampUtc,
      title: issue.title || shape.title,
      status: 'READY',
    }),
    issueNumber,
    repository: OPENCLAW_APP_GOAL_REPOSITORY,
    route: schedulerRoute(shape.request.preferredBuilder),
    prerequisites: freeze([]),
    resourceIds: freeze(shape.request.resourcePaths.map((path) => `repo:cheekyfellastef/stephan-os:path:${path}`)),
    priority: 100,
    criticalPathWeight: 50,
    reversibility: 'HIGH',
    approvalRequired: false,
    operatorPriority: true,
    evidenceAt: timestampUtc,
    requiredTests: freeze([...shape.request.requiredTests]),
    requiredEvidence: freeze([...shape.request.requiredEvidence]),
    operatorIntent: shape.request.intent,
    intendedOutcome: shape.request.intendedOutcome,
    preferredProviderRoute: shape.request.preferredBuilder,
    intakeSource: 'openclaw-app',
    intakeRequestId: shape.request.requestId,
  });
  const validation = validateSharedWorkspaceRecord(goalRecord, { nowMs: now.getTime() });
  if (!validation.valid) return freeze({ ok: false, reason: 'OPENCLAW_APP_GOAL_RECORD_INVALID', validation });

  const write = await (options.writeAtomicJsonFn || writeAtomicJson)(
    layout.root,
    ['goals', `goal-${issueNumber}.json`],
    goalRecord,
    { repoRoot: options.repoRoot, nowMs: now.getTime() },
  );
  if (write?.ok !== true && write?.reason !== 'ATOMIC_JSON_ALREADY_CURRENT') {
    return freeze({ ok: false, reason: text(write?.reason, 'OPENCLAW_APP_GOAL_WRITE_FAILED') });
  }

  return freeze({
    schemaVersion: OPENCLAW_APP_GOAL_INTAKE_SCHEMA,
    ok: true,
    created,
    deduped: !created,
    requestId: shape.request.requestId,
    requestedBy: shape.request.requestedBy,
    issue,
    goalId: goalRecord.goalId,
    goalRecord,
    finalVerdict: created ? 'OPENCLAW_APP_CANONICAL_GOAL_CREATED' : 'OPENCLAW_APP_CANONICAL_GOAL_DEDUPED',
    sourceMutationAuthorityAdded: false,
    mergeAuthorityAdded: false,
    deploymentAuthorityAdded: false,
    arbitraryShellAuthorityAdded: false,
  });
}
