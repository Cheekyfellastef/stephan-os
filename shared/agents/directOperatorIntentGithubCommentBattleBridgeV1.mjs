import { spawnSync } from 'node:child_process';

import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import {
  DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_REPOSITORY,
} from './directOperatorIntentStandingAuthorityV1.mjs';
import {
  selectDirectOperatorIntentGithubCommentV1,
} from './directOperatorIntentGithubCommentV1.mjs';

export const DIRECT_OPERATOR_INTENT_GITHUB_BATTLE_BRIDGE_SCHEMA =
  'stephanos.direct-operator-intent-github-battle-bridge.v1';
export const DIRECT_OPERATOR_INTENT_GITHUB_MAX_COMMENT_PAGES = 20;
export const DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_PAGE_SIZE = 100;

const INTEGER = /^[1-9][0-9]*$/;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const raw = text(value);
  if (!INTEGER.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function defaultRun(executable, args, options = {}) {
  return spawnSync(executable, args, {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: options.timeout || 30_000,
    maxBuffer: options.maxBuffer || 4 * 1024 * 1024,
  });
}

function readJson(runCommand, executable, endpoint) {
  const result = runCommand(executable, ['api', endpoint], {});
  if (result?.error || Number(result?.status) !== 0) {
    return Object.freeze({
      ok: false,
      blocker: result?.error?.code === 'ENOENT'
        ? 'direct-intent-github-cli-missing'
        : 'direct-intent-github-read-failed',
      payload: null,
    });
  }
  try {
    return Object.freeze({ ok: true, blocker: '', payload: JSON.parse(String(result.stdout || '')) });
  } catch {
    return Object.freeze({ ok: false, blocker: 'direct-intent-github-json-invalid', payload: null });
  }
}

export function resolveDirectOperatorIntentGithubCommentOnBattleBridgeV1(input = {}, options = {}) {
  const issueNumber = positiveInteger(input.issueNumber);
  if (!issueNumber) {
    return Object.freeze({
      schemaVersion: DIRECT_OPERATOR_INTENT_GITHUB_BATTLE_BRIDGE_SCHEMA,
      ok: false,
      issueNumber: 0,
      blocker: 'direct-intent-goal-issue-invalid',
      evidence: null,
    });
  }

  const runCommand = typeof options.runCommand === 'function' ? options.runCommand : defaultRun;
  const githubCli = text(options.githubCli)
    || text(BATTLE_BRIDGE_WINDOWS_HOST.githubCli)
    || 'gh';
  const repository = DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_REPOSITORY;

  const issue = readJson(runCommand, githubCli, `repos/${repository}/issues/${issueNumber}`);
  if (!issue.ok) {
    return Object.freeze({
      schemaVersion: DIRECT_OPERATOR_INTENT_GITHUB_BATTLE_BRIDGE_SCHEMA,
      ok: false,
      issueNumber,
      blocker: issue.blocker,
      evidence: null,
    });
  }
  if (Number(issue.payload?.number) !== issueNumber
    || text(issue.payload?.repository_url) !== `https://api.github.com/repos/${repository}`) {
    return Object.freeze({
      schemaVersion: DIRECT_OPERATOR_INTENT_GITHUB_BATTLE_BRIDGE_SCHEMA,
      ok: false,
      issueNumber,
      blocker: 'direct-intent-github-issue-identity-mismatch',
      evidence: null,
    });
  }

  const commentCount = Number(issue.payload?.comments || 0);
  if (!Number.isSafeInteger(commentCount) || commentCount < 0) {
    return Object.freeze({
      schemaVersion: DIRECT_OPERATOR_INTENT_GITHUB_BATTLE_BRIDGE_SCHEMA,
      ok: false,
      issueNumber,
      blocker: 'direct-intent-github-comment-count-invalid',
      evidence: null,
    });
  }
  const pageCount = Math.max(1, Math.ceil(commentCount / DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_PAGE_SIZE));
  if (pageCount > DIRECT_OPERATOR_INTENT_GITHUB_MAX_COMMENT_PAGES) {
    return Object.freeze({
      schemaVersion: DIRECT_OPERATOR_INTENT_GITHUB_BATTLE_BRIDGE_SCHEMA,
      ok: false,
      issueNumber,
      blocker: 'direct-intent-github-comment-window-exceeded',
      evidence: null,
    });
  }

  const comments = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const result = readJson(
      runCommand,
      githubCli,
      `repos/${repository}/issues/${issueNumber}/comments?per_page=${DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_PAGE_SIZE}&page=${page}`,
    );
    if (!result.ok || !Array.isArray(result.payload)) {
      return Object.freeze({
        schemaVersion: DIRECT_OPERATOR_INTENT_GITHUB_BATTLE_BRIDGE_SCHEMA,
        ok: false,
        issueNumber,
        blocker: result.ok ? 'direct-intent-github-comments-json-invalid' : result.blocker,
        evidence: null,
      });
    }
    comments.push(...result.payload);
  }

  const evidence = selectDirectOperatorIntentGithubCommentV1(comments, { issueNumber });
  return Object.freeze({
    schemaVersion: DIRECT_OPERATOR_INTENT_GITHUB_BATTLE_BRIDGE_SCHEMA,
    ok: evidence.valid === true,
    issueNumber,
    blocker: evidence.valid === true ? '' : (evidence.blockers?.[0] || 'direct-intent-github-comment-blocked'),
    evidence,
  });
}
