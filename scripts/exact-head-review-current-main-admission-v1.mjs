#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-exact-head-review-current-main-admission-v1';
const SHA40 = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function appendOutput(name, value, outputPath = process.env.GITHUB_OUTPUT) {
  const path = text(outputPath);
  if (!path) return;
  fs.appendFileSync(path, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`);
}

export function parseReviewPlanTargets(raw) {
  let parsed;
  try {
    parsed = JSON.parse(text(raw, '[]'));
  } catch {
    throw new Error('review plan targets must be valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('review plan targets must be an array');
  const seen = new Set();
  return parsed.map((entry) => {
    const prNumber = positiveInteger(entry?.prNumber);
    if (!prNumber) throw new Error('every review plan target must contain a positive integer prNumber');
    if (seen.has(prNumber)) throw new Error(`duplicate review plan target rejected: ${prNumber}`);
    seen.add(prNumber);
    return Object.freeze({ prNumber });
  });
}

export function classifyExactCurrentMainReviewTarget({ repository, currentMainSha, pullRequest } = {}) {
  const repo = text(repository);
  const mainSha = text(currentMainSha).toLowerCase();
  const prNumber = positiveInteger(pullRequest?.number);
  const baseRef = text(pullRequest?.base?.ref);
  const baseSha = text(pullRequest?.base?.sha).toLowerCase();
  const headSha = text(pullRequest?.head?.sha).toLowerCase();
  const headRepository = text(pullRequest?.head?.repo?.full_name);
  const state = text(pullRequest?.state).toLowerCase();

  if (!REPOSITORY.test(repo) || !SHA40.test(mainSha) || !prNumber) {
    return Object.freeze({ eligible: false, prNumber, reason: 'INVALID_IDENTITY', currentMainSha: mainSha, baseSha, headSha });
  }
  if (state !== 'open') {
    return Object.freeze({ eligible: false, prNumber, reason: 'PR_NOT_OPEN', currentMainSha: mainSha, baseSha, headSha });
  }
  if (headRepository.toLowerCase() !== repo.toLowerCase()) {
    return Object.freeze({ eligible: false, prNumber, reason: 'CROSS_REPOSITORY_HEAD', currentMainSha: mainSha, baseSha, headSha });
  }
  if (baseRef !== 'main') {
    return Object.freeze({ eligible: false, prNumber, reason: 'BASE_REF_NOT_MAIN', currentMainSha: mainSha, baseSha, headSha });
  }
  if (!SHA40.test(baseSha) || !SHA40.test(headSha)) {
    return Object.freeze({ eligible: false, prNumber, reason: 'HEAD_OR_BASE_UNPROVEN', currentMainSha: mainSha, baseSha, headSha });
  }
  if (baseSha !== mainSha) {
    return Object.freeze({ eligible: false, prNumber, reason: 'BASE_NOT_EXACT_CURRENT_MAIN', currentMainSha: mainSha, baseSha, headSha });
  }
  return Object.freeze({ eligible: true, prNumber, reason: 'EXACT_CURRENT_MAIN', currentMainSha: mainSha, baseSha, headSha });
}

export function filterExactCurrentMainReviewTargets({ repository, currentMainSha, targets = [], pullRequests = [] } = {}) {
  const byNumber = new Map((Array.isArray(pullRequests) ? pullRequests : []).map((pr) => [positiveInteger(pr?.number), pr]));
  const admitted = [];
  const held = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    const prNumber = positiveInteger(target?.prNumber);
    const pullRequest = byNumber.get(prNumber);
    if (!pullRequest) {
      held.push(Object.freeze({ prNumber, reason: 'PR_EVIDENCE_MISSING' }));
      continue;
    }
    const classification = classifyExactCurrentMainReviewTarget({ repository, currentMainSha, pullRequest });
    if (classification.eligible) admitted.push(Object.freeze({ prNumber }));
    else held.push(classification);
  }
  return Object.freeze({ targets: Object.freeze(admitted), held: Object.freeze(held) });
}

async function githubGet(path, { token, fetchFn = globalThis.fetch } = {}) {
  const response = await fetchFn(`https://api.github.com${path}`, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = raw; }
  }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload ? payload.message : raw;
    throw new Error(`GitHub GET ${path} failed (${response.status}): ${text(message, 'unknown error')}`);
  }
  return payload;
}

export async function resolveExactCurrentMainReviewTargets({
  repository,
  rawTargets,
  token,
  fetchFn = globalThis.fetch,
} = {}) {
  const repo = text(repository);
  if (!REPOSITORY.test(repo)) throw new Error('GITHUB_REPOSITORY must be owner/name');
  if (!text(token)) throw new Error('GITHUB_TOKEN is required for bounded read-only target admission');
  const targets = parseReviewPlanTargets(rawTargets);
  if (!targets.length) return Object.freeze({ currentMainSha: '', targets: Object.freeze([]), held: Object.freeze([]) });

  const [owner, name] = repo.split('/');
  const mainRef = await githubGet(`/repos/${owner}/${name}/git/ref/heads/main`, { token, fetchFn });
  const currentMainSha = text(mainRef?.object?.sha).toLowerCase();
  if (!SHA40.test(currentMainSha)) throw new Error('current protected main SHA is unproven');

  const pullRequests = [];
  for (const target of targets) {
    pullRequests.push(await githubGet(`/repos/${owner}/${name}/pulls/${target.prNumber}`, { token, fetchFn }));
  }
  return Object.freeze({ currentMainSha, ...filterExactCurrentMainReviewTargets({ repository: repo, currentMainSha, targets, pullRequests }) });
}

export async function main({ env = process.env, fetchFn = globalThis.fetch, outputPath = env.GITHUB_OUTPUT } = {}) {
  const result = await resolveExactCurrentMainReviewTargets({
    repository: env.GITHUB_REPOSITORY,
    rawTargets: env.STEPHANOS_REVIEW_PLAN_TARGETS,
    token: env.GITHUB_TOKEN,
    fetchFn,
  });
  const targets = JSON.stringify(result.targets);
  const held = JSON.stringify(result.held.map(({ prNumber, reason, baseSha = '', currentMainSha = '' }) => ({ prNumber, reason, baseSha, currentMainSha })));
  console.log(`EXACT_CURRENT_MAIN_REVIEW_TARGETS=${targets}`);
  console.log(`EXACT_CURRENT_MAIN_REVIEW_HELD=${held}`);
  appendOutput('targets', targets, outputPath);
  appendOutput('held', held, outputPath);
  appendOutput('current_main_sha', result.currentMainSha, outputPath);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`).href)) {
  main().catch((error) => {
    console.error(`EXACT_CURRENT_MAIN_REVIEW_ADMISSION_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
