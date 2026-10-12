#!/usr/bin/env node
// Read-only local source/candidate producer for Battle Bridge. This is NOT a
// qualified independent specialist or a protected GitHub review author.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { resolveBattleBridgeGitExecution } from
  '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { evaluateSovereignHighRiskCandidateV1 } from
  '../shared/agents/sovereignHighRiskReviewCandidateV1.mjs';
import {
  createSharedWorkspaceStatusRecord, writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = /^[a-f0-9]{40}$/;
const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const text = x => String(x ?? '').trim();

export function captureHighRiskAdvisorySnapshotV1(env = process.env, {
  platform = process.platform, spawn = spawnSync,
  resolveGit = resolveBattleBridgeGitExecution,
  root = repoRoot,
} = {}) {
  const head = text(env.STEPHANOS_REVIEW_EXACT_HEAD).toLowerCase();
  const base = text(env.STEPHANOS_REVIEW_EXACT_BASE).toLowerCase();
  const branch = text(env.STEPHANOS_REVIEW_EXACT_BRANCH);
  if (!SHA.test(head) || !SHA.test(base) || head === base) {
    throw Error('EXACT_HEAD_AND_BASE_REQUIRED');
  }
  const git = args => {
    const execution = resolveGit({ platform, environment: env });
    const result = spawn(execution.executable, [
      ...execution.fixedConfigArgs,
      '--git-dir=' + join(root, '.git'), '--work-tree=' + root, ...args,
    ], {
      encoding: 'utf8', shell: false, windowsHide: true, timeout: 12_000,
      maxBuffer: 512 * 1024, env: execution.environment,
    });
    if (result?.error || result?.status !== 0) throw Error('EXACT_LOCAL_GIT_READ_UNVERIFIED');
    return String(result.stdout || '');
  };
  if (git(['rev-parse','HEAD']).trim().toLowerCase() !== head) throw Error('LOCAL_REVIEW_HEAD_MISMATCH');
  if (git(['symbolic-ref','--quiet','--short','HEAD']).trim() !== branch) {
    throw Error('LOCAL_REVIEW_BRANCH_MISMATCH');
  }
  if (git(['status','--porcelain','--untracked-files=normal']).trim()) throw Error('DIRTY_REVIEW_CHECKOUT');
  if (git(['rev-parse','--verify',base+'^{commit}']).trim().toLowerCase() !== base) {
    throw Error('BASE_COMMIT_NOT_PROVEN');
  }
  git(['merge-base','--is-ancestor',base,head]);
  const changedFiles = git(['diff','--no-ext-diff','--no-textconv','--no-renames',
    '--name-only',base,head,'--']).split('\n').filter(Boolean);
  const diff = git(['diff','--no-ext-diff','--no-textconv','--no-renames',
    '--unified=3',base,head,'--']);
  // Preserve the exact Git diff byte stream, including final newline.
  return Object.freeze({
    repository: text(env.STEPHANOS_REVIEW_REPOSITORY),
    issueNumber: Number(env.STEPHANOS_REVIEW_ISSUE),
    prNumber: Number(env.STEPHANOS_REVIEW_PR),
    branch, sourceHead: head, baseSha: base, changedFiles,
    diff,
    reviewerSessionId: text(env.STEPHANOS_REVIEW_SESSION),
    implementerSessionId: text(env.STEPHANOS_REVIEW_IMPLEMENTER_SESSION),
    implementerProvider: text(env.STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER),
    modelClass: text(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL_CLASS || 'qwen-14b'),
  });
}

export async function localHighRiskModelV1(prompt, _chunk, env = process.env) {
  const model = text(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL || 'qwen:14b');
  if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(model)) throw Error('UNSAFE_LOCAL_MODEL_NAME');
  const response = await fetch(OLLAMA_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      model, prompt, stream:false, format:'json',
      options:{temperature:0,num_ctx:8192},
    }),
    signal:AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw Error('LOCAL_MODEL_REQUEST_FAILED');
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > 64 * 1024) throw Error('LOCAL_MODEL_OUTPUT_TOO_LARGE');
  const parsed = JSON.parse(raw);
  if (typeof parsed?.response !== 'string') throw Error('LOCAL_MODEL_RESULT_INVALID');
  return parsed.response;
}

export async function runSovereignHighRiskAdvisoryV1({
  env = process.env, now = new Date(),
  root = repoRoot,
  snapshot = captureHighRiskAdvisorySnapshotV1,
  invokeModel = (prompt, chunk) => localHighRiskModelV1(prompt, chunk, env),
  publish = writeAtomicJson,
} = {}) {
  let result;
  let identity = {};
  try {
    identity = snapshot(env, {root});
    result = await evaluateSovereignHighRiskCandidateV1(identity, {invokeModel});
  } catch {
    result = {
      status: 'SOVEREIGN_HIGH_RISK_REVIEW_HELD',
      reason: 'LOCAL_EXACT_SOURCE_OR_MODEL_UNVERIFIED',
      approvalAuthority: false, mergeAuthority: false,
      specialistAuthority: false, independentAttestationProven: false,
    };
  }
  const candidate = result.candidateEvidence;
  const prNumber = Number(env.STEPHANOS_REVIEW_PR);
  const safePr = Number.isSafeInteger(prNumber) && prNumber > 0 ? prNumber : 0;
  const profile = text(env.USERPROFILE || env.HOME || homedir());
  const workspaceRoot = resolve(env.STEPHANOS_SHARED_AGENT_WORKSPACE
    || join(profile, 'Documents', 'Stephanos-openclaw-workspace'));
  const status = {
    ...createSharedWorkspaceStatusRecord({
      statusId: 'sovereign-high-risk-advisory-' + (safePr || 'unknown'),
      participantId: 'sovereign-high-risk-reviewer',
      relatedIssue: '#1574',
      relatedPr: safePr ? '#' + safePr : '',
      timestampUtc: now.toISOString(),
      status: 'HELD',
      summary: 'Unqualified local high-risk review candidate; protected specialist review still required.',
    }),
    highRiskAdvisory: {
      status: result.status,
      reason: text(result.reason || ''),
      sourceHead: text(identity.sourceHead || ''),
      baseSha: text(identity.baseSha || ''),
      reviewPacketSha256: text(candidate?.reviewPacketSha256 || result.reviewPacketSha256 || ''),
      chunkCount: Number(candidate?.chunkCount || 0),
      findingCount: Number(candidate?.findings?.length || 0),
      independentAttestationProven: false,
      specialistAuthority: false,
      mergeAuthority: false,
      approvalAuthority: false,
    },
  };
  let publication;
  try {
    publication = await publish(workspaceRoot,
      ['status',status.statusId+'.json'],status,{repoRoot:root});
  } catch {
    publication = {ok:false,reason:'SAFE_STATUS_WRITE_UNVERIFIED'};
  }
  return Object.freeze({
    status: result.status,
    reason: text(result.reason || ''),
    reviewPacketSha256: text(candidate?.reviewPacketSha256 || result.reviewPacketSha256 || ''),
    reviewedChunkCount: candidate?.reviewedChunks?.length || 0,
    findingCount: candidate?.findings?.length || 0,
    publicationOk: publication?.ok === true,
    publicationReason: publication?.ok === true ? '' : text(publication?.reason || 'NOT_PUBLISHED'),
    qualification: 'PENDING_INDEPENDENT_SPECIALIST_ATTESTATION',
    mergeAuthority: false, approvalAuthority: false, specialistAuthority: false,
    runtimeDeploymentProven: false,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--once')) {
    process.stderr.write('Usage: node scripts/sovereign-high-risk-advisory-v1.mjs --once\n');
    process.exitCode=2;
  } else {
    const result = await runSovereignHighRiskAdvisoryV1();
    process.stdout.write('SOVEREIGN_HIGH_RISK_ADVISORY_RESULT='+JSON.stringify(result)+'\n');
    if (!result.publicationOk || result.status === 'SOVEREIGN_HIGH_RISK_REVIEW_HELD') process.exitCode=1;
  }
}
