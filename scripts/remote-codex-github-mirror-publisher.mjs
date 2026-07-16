#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

import {
  renderRemoteCodexGitHubMirrorComment,
} from '../shared/agents/remoteCodexTaskVisibility.mjs';

export const REMOTE_CODEX_GITHUB_MIRROR_SCHEMA = 'stephanos.remote-codex-github-mirror.v1';
export const REMOTE_CODEX_GITHUB_MIRROR_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const REMOTE_CODEX_GITHUB_MIRROR_ISSUE = 1506;
export const REMOTE_CODEX_GITHUB_MIRROR_COMMENT_ID = 4994605389;
export const REMOTE_CODEX_GITHUB_MIRROR_MARKER = '<!-- stephanos-remote-codex-task-visibility-v1 -->';

const MAX_COMMENT_BYTES = 8 * 1024;
const FORBIDDEN_MIRROR_TEXT = /(?:secret|token|password|credential|private key|\.env|cookie|[a-z]:\\|\\\\|\/(?:users|home|workspace|tmp)\/)/i;

function bounded(value, limit = 500) {
  const text = String(value ?? '').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export function validateRemoteCodexGitHubMirrorBody(body) {
  const text = String(body ?? '');
  const errors = [];
  if (!text.startsWith(REMOTE_CODEX_GITHUB_MIRROR_MARKER)) errors.push('missing-canonical-marker');
  if (Buffer.byteLength(text, 'utf8') > MAX_COMMENT_BYTES) errors.push('mirror-body-too-large');
  if (FORBIDDEN_MIRROR_TEXT.test(text)) errors.push('unsafe-mirror-text');
  return Object.freeze({ valid: errors.length === 0, errors });
}

export function createFixedGitHubMirrorAdapter({
  spawnSyncFn = spawnSync,
  ghCommand = process.env.STEPHANOS_GH_COMMAND || 'gh',
} = {}) {
  return Object.freeze({
    update(body) {
      const validation = validateRemoteCodexGitHubMirrorBody(body);
      if (!validation.valid) {
        return Object.freeze({ ok: false, reason: validation.errors[0], validation });
      }
      const endpoint = `repos/${REMOTE_CODEX_GITHUB_MIRROR_REPOSITORY}/issues/comments/${REMOTE_CODEX_GITHUB_MIRROR_COMMENT_ID}`;
      const args = ['api', '--method', 'PATCH', endpoint, '-f', `body=${body}`];
      const result = spawnSyncFn(ghCommand, args, {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (result.error || result.status !== 0) {
        return Object.freeze({
          ok: false,
          reason: result.error?.code === 'ENOENT' ? 'GH_CLI_NOT_INSTALLED' : 'GH_MIRROR_UPDATE_FAILED',
          status: result.status,
          error: bounded(result.error?.message || result.stderr || result.stdout || ''),
          endpoint,
        });
      }
      return Object.freeze({
        ok: true,
        reason: 'REMOTE_CODEX_GITHUB_MIRROR_UPDATED',
        endpoint,
        repository: REMOTE_CODEX_GITHUB_MIRROR_REPOSITORY,
        issueNumber: REMOTE_CODEX_GITHUB_MIRROR_ISSUE,
        commentId: REMOTE_CODEX_GITHUB_MIRROR_COMMENT_ID,
      });
    },
  });
}

export async function publishRemoteCodexGitHubMirror(slice, {
  adapter = createFixedGitHubMirrorAdapter(),
  nowMs = Date.now(),
} = {}) {
  const body = renderRemoteCodexGitHubMirrorComment(slice, { nowMs });
  const result = adapter.update(body);
  return Object.freeze({
    ...result,
    schemaVersion: REMOTE_CODEX_GITHUB_MIRROR_SCHEMA,
    bodyBytes: Buffer.byteLength(body, 'utf8'),
  });
}
