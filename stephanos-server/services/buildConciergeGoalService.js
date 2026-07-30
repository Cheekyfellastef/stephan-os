import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { buildConciergeQueue } from '../../shared/agents/battleBridgeBuildConciergeV2.mjs';

const SCHEMA = 'stephanos.build-concierge.goal-request.v1';
const MAX_FIELD = 2000;
const ALLOWED_KEYS = new Set(['title', 'intent', 'priority', 'requestedBy', 'sourceSurface']);
const FORBIDDEN = /(\b(?:sudo|curl|wget|bash|sh|powershell|cmd\.exe|git\s+(?:merge|push|pull|checkout|reset)|npm\s+(?:run|install|test)|node\s|rm\s+-|mv\s|cp\s|chmod\s|ssh\b|token|secret|password|api[_-]?key|authorization|bearer|approval[_ -]?token)\b|(?:^|\s)(?:\.\.?\/|~\/|[A-Za-z]:\\|\/)[^\s]*|&&|\|\||;|`|\$\()/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function slug(value) {
  return text(value, 'goal').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'goal';
}

export function resolveBuildConciergeReceiptDirectory(env = process.env) {
  return resolve(text(env.STEPHANOS_BUILD_CONCIERGE_RECEIPT_DIR, join(process.cwd(), '.stephanos', 'build-concierge', 'receipts')));
}

export function validateBuildConciergeGoalRequest(body = {}) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) errors.push('Request body must be an object.');
  const keys = Object.keys(body || {});
  for (const key of keys) if (!ALLOWED_KEYS.has(key)) errors.push(`Unsupported field: ${key}.`);
  const fields = Object.fromEntries([...ALLOWED_KEYS].map((key) => [key, text(body?.[key])]));
  if (!fields.title) errors.push('title is required.');
  if (!fields.intent) errors.push('intent is required.');
  for (const [key, value] of Object.entries(fields)) {
    if (value.length > MAX_FIELD) errors.push(`${key} exceeds ${MAX_FIELD} characters.`);
    if (value && FORBIDDEN.test(value)) errors.push(`${key} contains blocked command, path, secret, merge, or approval-token text.`);
  }
  return { ok: errors.length === 0, errors, fields };
}

export function goalReceiptToCandidate(receipt = {}) {
  const goal = receipt.goal || receipt;
  return {
    id: text(goal.id || receipt.receiptId),
    candidateId: text(goal.id || receipt.receiptId),
    candidateType: 'goal',
    title: text(goal.title, 'Untitled Build Concierge goal'),
    intent: text(goal.intent, 'unknown'),
    priority: text(goal.priority, 'normal'),
    requestedBy: text(goal.requestedBy, 'unknown'),
    sourceSurface: text(goal.sourceSurface, 'unknown'),
    createdAt: text(goal.createdAt || receipt.createdAt),
    updatedAt: text(goal.updatedAt || receipt.updatedAt || goal.createdAt || receipt.createdAt),
    state: 'OPEN',
    status: 'open',
    mergeable: null,
    requiredChecksClean: false,
    headSha: '',
    proofCommands: [],
    blockers: ['Live-created goals are queued as supplied candidates only; exact head, checks, proof commands, and operator approval remain unknown.'],
  };
}

export async function createBuildConciergeGoalRequest(body = {}, options = {}) {
  const validation = validateBuildConciergeGoalRequest(body);
  if (!validation.ok) return { ok: false, status: 400, errors: validation.errors };
  const now = options.now instanceof Date ? options.now : new Date();
  const idHash = createHash('sha256').update(`${now.toISOString()}\n${JSON.stringify(validation.fields)}`).digest('hex').slice(0, 12);
  const goalId = `bc-goal-${slug(validation.fields.title)}-${idHash}`;
  const receipt = {
    schemaVersion: SCHEMA,
    receiptId: `${goalId}-receipt`,
    receiptType: 'build-concierge-goal-create',
    source: 'stephanos-build-concierge-live-adapter',
    status: 'queued_candidate_created',
    createdAt: now.toISOString(),
    commandExecutionAllowed: false,
    mergeAllowed: false,
    codexDispatchAllowed: false,
    liveProofClaim: 'none',
    goal: { id: goalId, ...validation.fields },
  };
  const directory = options.directory || resolveBuildConciergeReceiptDirectory(options.env || process.env);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${receipt.receiptId}.json`);
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  const candidate = goalReceiptToCandidate(receipt);
  return { ok: true, status: 201, receipt: { ...receipt, path }, candidate, queue: buildConciergeQueue({ goals: [candidate] }) };
}

export async function readBuildConciergeGoalReceipts(options = {}) {
  const directory = options.directory || resolveBuildConciergeReceiptDirectory(options.env || process.env);
  let entries = [];
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return { directory, receipts: [], candidates: [] }; }
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  const receipts = [];
  for (const entry of files) {
    const path = join(directory, entry.name);
    const metadata = await stat(path);
    if (metadata.size > 1024 * 1024) continue;
    try {
      const receipt = JSON.parse(await readFile(path, 'utf8'));
      if (receipt.schemaVersion === SCHEMA) receipts.push({ ...receipt, path });
    } catch {}
  }
  receipts.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  return { directory, receipts, candidates: receipts.map(goalReceiptToCandidate) };
}

export function buildConciergeLiveAdapterStatus(input = {}) {
  const available = input.available === true;
  return {
    available,
    route: '/api/build-concierge/goals',
    status: available ? 'available' : 'blocked_unavailable',
    blockerText: available ? '' : 'Build Concierge live adapter unavailable: backend route /api/build-concierge/goals has not returned availability proof; create goals manually and keep queue truth unknown until a durable receipt exists.',
    commandExecutionAllowed: false,
    mergeAllowed: false,
    codexDispatchAllowed: false,
  };
}
