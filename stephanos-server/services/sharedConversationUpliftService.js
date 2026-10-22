import { readdir, lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveSharedWorkspaceRuntimeConfig } from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import { decodeStephanosSharedConversationTurnRecord } from '../../shared/agents/stephanosSharedConversationThreadV1.mjs';

export const SHARED_CONVERSATION_UPLIFT_SCHEMA_V1 = 'stephanos.shared-conversation-uplift.v1';
export const SHARED_CONVERSATION_THREAD_V1 = 'shared-operator-primary';
const RECORD_NAME = /^shared-turn-[0-9a-f]{24}\.json$/i;
const MAX_FILES = 4096;
const MAX_BYTES = 64 * 1024;
const CACHE_MS = 120_000;
let cached = null;

// The phrases identify REVIEW CANDIDATES, never proven faults or operator approvals.
// "operator" is a protocol role; these records do not establish human authorship.
const REQUEST = /\b(?:can we|could we|we need(?: to)?|i want(?: to)?|please\s+(?:fix|repair|upgrade|build|teach|investigate|check)|fix|repair|upgrade|improve|teach|sort out|still broken|not working|blocked|keep failing)\b/i;
const RULES = Object.freeze([
  { id: 'autonomous-build-conveyor', title: 'Investigate autonomous build pickup and completion', pattern: /\b(?:logical controllers?|goal.to.build|autonomous build|stuck lease|goal conveyor|builder pickup|core daemon)\b/i },
  { id: 'sovereign-commander-parity', title: 'Investigate Sovereign Commander missing capabilities', pattern: /\b(?:sovereign commander|remote commander|desktop commander)\b/i },
  { id: 'github-api-quota', title: 'Investigate recurring GitHub API throttling', pattern: /\b(?:github.{0,32}(?:403|quota|rate.?limit|hammer)|anti.hammer)\b/i },
  { id: 'ai-backend-reachability', title: 'Investigate Stephanos AI backend and routing truth', pattern: /\b(?:backend offline|ai unknown|browser.to.backend|provider routing|backend indicator)\b/i },
  { id: 'skill-forge-uplift', title: 'Investigate skill learning and cross-agent transfer', pattern: /\b(?:skill forge|openclaw.{0,40}skills?|conjur.{0,20}skills?|cross.agent.{0,20}(?:learning|skills?))\b/i },
]);

function validTurn(record, nowMs) {
  // One canonical decoder for all transcript consumers; never weaken lineage,
  // proof reference, shape, freshness or zero-authority checks here.
  const decoded = decodeStephanosSharedConversationTurnRecord(record, {
    workspaceValidationOptions: { nowMs, staleAfterMs: Number.MAX_SAFE_INTEGER },
  });
  if (!decoded.valid || decoded.turn?.threadId !== SHARED_CONVERSATION_THREAD_V1) return null;
  const turn = decoded.turn;
  return {
    id: turn.turnId, role: turn.senderParticipantId,
    text: turn.text, time: Date.parse(turn.timestampUtc),
  };
}

export function deriveSharedConversationUpliftV1(records = [], { nowMs = Date.now(), complete = true } = {}) {
  const turns = new Map();
  let rejectedTurnCount = 0;
  for (const record of records) {
    const turn = validTurn(record, nowMs);
    if (!turn || turns.has(turn.id)) {
      rejectedTurnCount += 1;
      continue;
    }
    turns.set(turn.id, turn);
  }
  const historyComplete = complete && rejectedTurnCount === 0;
  const ordered = [...turns.values()].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const candidates = RULES.map(rule => {
    const matches = ordered.filter(turn => turn.role === 'operator'
      && REQUEST.test(turn.text) && rule.pattern.test(turn.text));
    const refs = matches.slice(-4).map(turn =>
      'workspace://shared-thread/' + SHARED_CONVERSATION_THREAD_V1 + '/' + turn.id);
    return Object.freeze({
      id: rule.id,
      title: rule.title,
      mentionCount: matches.length,
      sourceTurnRefs: Object.freeze(refs),
      classification: 'CONVERSATION_HINT_REVIEW_REQUIRED',
      // A conversation can suggest a gap, never demonstrate a missing executable tool.
      eligibleForBoundedInvestigation: historyComplete && matches.length >= 2 && refs.length >= 2,
      provenCapabilityFailure: false,
      reviewed: false,
      authorityGranted: false,
    });
  }).filter(candidate => candidate.mentionCount > 0);
  return Object.freeze({
    schemaVersion: SHARED_CONVERSATION_UPLIFT_SCHEMA_V1,
    threadId: SHARED_CONVERSATION_THREAD_V1,
    state: historyComplete ? 'ready' : 'partial',
    sourceTruth: historyComplete ? 'REPORTED_NOT_VERIFIED' : 'INCOMPLETE_HISTORY',
    rejectedTurnCount,
    turnCount: ordered.length,
    protocolRoleCounts: Object.freeze({
      operator: ordered.filter(turn => turn.role === 'operator').length,
      stephanos: ordered.filter(turn => turn.role === 'stephanos').length,
      chatgptBridge: ordered.filter(turn => turn.role === 'chatgpt-bridge').length,
    }),
    candidates: Object.freeze(candidates),
    admittedBuilds: 0,
    completedBuilds: 0,
    note: 'Protocol roles are not verified human authorship. Conversation hints require independent investigation and normal goal admission, review and execution proof.',
  });
}

// Read the canonical inbox; do not use the AI context tail (24), Canvas view
// (64), or continuity loader (256). Nothing is copied to a new truth store.
export async function readSharedConversationUpliftV1({
  root, repoRoot = process.cwd(), env = process.env, nowMs = Date.now(),
  useCache = true,
} = {}) {
  const resolved = resolveSharedWorkspaceRuntimeConfig({ root, repoRoot, env });
  if (!resolved.ok) return Object.freeze({
    schemaVersion: SHARED_CONVERSATION_UPLIFT_SCHEMA_V1,
    state: 'unavailable', reason: resolved.reason, turnCount: 0, candidates: [],
  });
  if (useCache && cached?.root === resolved.root && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  let names;
  try {
    names = (await readdir(join(resolved.root, 'inbox')))
      .filter(name => RECORD_NAME.test(name));
  } catch {
    return Object.freeze({
      schemaVersion: SHARED_CONVERSATION_UPLIFT_SCHEMA_V1,
      state: 'unavailable', reason: 'SHARED_CONVERSATION_INBOX_UNREADABLE',
      turnCount: 0, candidates: [],
    });
  }
  // Never label a truncated hash-ordered sample as the complete history.
  if (names.length > MAX_FILES) return Object.freeze({
    schemaVersion: SHARED_CONVERSATION_UPLIFT_SCHEMA_V1,
    state: 'partial', reason: 'CONVERSATION_INDEX_CAPACITY_REACHED',
    scannedFileCount: 0, totalFileCount: names.length, turnCount: 0, candidates: [],
  });
  const records = [];
  let unreadable = 0;
  for (const name of names) {
    try {
      const path = join(resolved.root, 'inbox', name);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) {
        unreadable += 1; continue;
      }
      records.push(JSON.parse(await readFile(path, 'utf8')));
    } catch { unreadable += 1; }
  }
  const value = Object.freeze({
    ...deriveSharedConversationUpliftV1(records, { nowMs, complete: unreadable === 0 }),
    scannedFileCount: names.length,
    unreadableFileCount: unreadable,
    ...(unreadable ? { reason: 'CONVERSATION_RECORDS_INCOMPLETE' } : {}),
  });
  if (useCache) cached = { root: resolved.root, value, expiresAt: Date.now() + CACHE_MS };
  return value;
}
