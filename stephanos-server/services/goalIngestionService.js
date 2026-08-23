import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { goalReceiptToCandidate } from './buildConciergeGoalService.js';

export const GOAL_IMPORT_SCHEMA = 'stephanos.goal-ingestion.imported-goal.v1';
const MAX_BYTES = 1024 * 1024;
const OPEN_STATUSES = new Set(['open', 'pending', 'blocked', 'in_progress', 'in-progress', 'running', 'todo', 'unfinished', 'unknown']);
const ALLOWED_IMPORT_KEYS = ['title', 'intent', 'source', 'status', 'lastKnownPR', 'blockers', 'nextAction', 'receiptId'];

function text(value, fallback = '') { const normalized = String(value ?? '').trim(); return normalized || fallback; }
function list(value) { return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : text(value).split(/\r?\n|;/).map((item) => item.trim()).filter(Boolean); }
function slug(value) { return text(value, 'goal').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'goal'; }
function stableKey(goal = {}) { return [goal.title, goal.source, goal.lastKnownPR, goal.receiptId].map((part) => text(part).toLowerCase()).join('|'); }
function hashGoal(goal = {}) { return createHash('sha256').update(stableKey(goal) || JSON.stringify(goal)).digest('hex').slice(0, 16); }

export function resolveGoalIngestionDirectory(env = process.env) {
  return resolve(text(env.STEPHANOS_GOAL_INGESTION_DIR, join(process.cwd(), '.stephanos', 'goal-ingestion', 'imports')));
}

export function normalizeImportedGoal(raw = {}, index = 0, now = new Date()) {
  const unsupported = Object.keys(raw || {}).filter((key) => !ALLOWED_IMPORT_KEYS.includes(key));
  const goal = {
    title: text(raw.title),
    intent: text(raw.intent),
    source: text(raw.source, 'manual-paste'),
    status: text(raw.status, 'unknown').toLowerCase(),
    lastKnownPR: text(raw.lastKnownPR),
    blockers: list(raw.blockers),
    nextAction: text(raw.nextAction, 'unknown'),
    sourceReceiptId: text(raw.receiptId),
  };
  const errors = [];
  if (!goal.title) errors.push(`goals[${index}].title is required.`);
  if (!goal.intent) errors.push(`goals[${index}].intent is required.`);
  if (unsupported.length) errors.push(`goals[${index}] unsupported fields: ${unsupported.join(', ')}.`);
  const hash = hashGoal(goal);
  return { ...goal, importHash: hash, importedAt: now.toISOString(), validationErrors: errors };
}

function importedGoalToReceipt(goal = {}) {
  const goalId = `imported-goal-${slug(goal.title)}-${goal.importHash}`;
  return {
    schemaVersion: GOAL_IMPORT_SCHEMA,
    receiptId: goal.sourceReceiptId || `${goalId}-receipt`,
    receiptType: 'goal-ingestion-imported-unverified',
    source: 'stephanos-goal-ingestion-service',
    status: 'imported_unverified',
    importedAt: goal.importedAt,
    createdAt: goal.importedAt,
    verificationState: 'imported_unverified',
    liveProofClaim: 'none',
    commandExecutionAllowed: false,
    mergeAllowed: false,
    codexDispatchAllowed: false,
    dedupeKey: stableKey(goal),
    goal: {
      id: goalId,
      title: goal.title,
      intent: goal.intent,
      priority: 'normal',
      requestedBy: 'operator-import',
      sourceSurface: goal.source,
      historicalStatus: goal.status,
      lastKnownPR: goal.lastKnownPR,
      blockers: goal.blockers,
      nextAction: goal.nextAction,
      verificationState: 'imported_unverified',
    },
  };
}

export function parsePastedGoalSummaries(input = {}) {
  if (Array.isArray(input.goals)) return input.goals;
  if (typeof input === 'string') return parsePastedGoalSummaries({ text: input });
  const pasted = text(input.text || input.pastedText);
  if (!pasted) return [];
  try {
    const parsed = JSON.parse(pasted);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.goals)) return parsed.goals;
  } catch {}
  const chunks = pasted.split(/\n\s*---+\s*\n|\n\s*\n/).map((chunk) => chunk.trim()).filter(Boolean);
  return chunks.map((chunk) => Object.fromEntries(chunk.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*[-*]?\s*([A-Za-z][A-Za-z0-9 ]+):\s*(.*)$/);
    return match ? [match[1].replace(/\s+/g, '').replace(/^lastknownpr$/i, 'lastKnownPR'), match[2]] : null;
  }).filter(Boolean)));
}

export async function readImportedGoalReceipts(options = {}) {
  const directory = options.directory || resolveGoalIngestionDirectory(options.env || process.env);
  let entries = [];
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return { directory, receipts: [], candidates: [] }; }
  const receipts = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.json'))) {
    const path = join(directory, entry.name);
    const metadata = await stat(path);
    if (metadata.size > MAX_BYTES) continue;
    try {
      const receipt = JSON.parse(await readFile(path, 'utf8'));
      if (receipt.schemaVersion === GOAL_IMPORT_SCHEMA) receipts.push({ ...receipt, path });
    } catch {}
  }
  receipts.sort((a, b) => Date.parse(b.importedAt || b.createdAt || 0) - Date.parse(a.importedAt || a.createdAt || 0));
  return { directory, receipts, candidates: receipts.map((receipt) => ({ ...goalReceiptToCandidate(receipt), status: 'imported_unverified', verificationState: 'imported_unverified', blockers: [...(receipt.goal?.blockers || []), 'Imported historical goal is unverified until fresh proof or receipt exists.'] })) };
}

export async function importGoalSummaries(input = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const directory = options.directory || resolveGoalIngestionDirectory(options.env || process.env);
  const existing = await readImportedGoalReceipts({ directory });
  const seen = new Set(existing.receipts.map((receipt) => receipt.dedupeKey || stableKey(receipt.goal || receipt)));
  const normalized = parsePastedGoalSummaries(input).map((goal, index) => normalizeImportedGoal(goal, index, now));
  const errors = normalized.flatMap((goal) => goal.validationErrors);
  if (errors.length) return { ok: false, status: 400, errors, imported: [], duplicates: [] };
  await mkdir(directory, { recursive: true });
  const imported = [];
  const duplicates = [];
  for (const goal of normalized) {
    const key = stableKey(goal);
    if (seen.has(key)) { duplicates.push(goal); continue; }
    seen.add(key);
    if (!OPEN_STATUSES.has(goal.status)) continue;
    const receipt = importedGoalToReceipt(goal);
    const path = join(directory, `${slug(receipt.receiptId)}.json`);
    await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    imported.push({ ...receipt, path });
  }
  return { ok: true, status: 201, directory, imported, duplicates, candidates: imported.map(goalReceiptToCandidate) };
}
