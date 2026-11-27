import { execFileSync } from 'node:child_process';
import { readMailboxRotationFence, mailboxRotationWorkflowAllowed } from '../shared/agents/canonicalMailboxRotationFenceV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
export const MAILBOX_WORKFLOW_EVENT_SOURCE_POLICY_VERSION = 1;
const exactHead = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const positiveId = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
  && Number.isSafeInteger(Number(value));
const issueCommentCallers = Object.freeze([
  ['mailbox-receipt-index.yml', 'mirror', ['receipt']],
  ['codex-banked-reset-telemetry.yml', 'mirror', ['receipt']],
  ['protected-workflow-dispatch-mailbox.yml', 'dispatch', ['protected']],
  ['battle-bridge-out-of-band-observer-v1.yml', 'observe', ['observer', 'receipt']],
  ['battle-bridge-tailscale-bootstrap-pipe.yml', 'bootstrap-canonical-github-sync', ['bootstrap']],
  ['battle-bridge-tailscale-bootstrap-pipe.yml', 'prerequisite-proof', ['prerequisite']],
].map(([workflow, job, modes]) => Object.freeze({
  workflowPath: `.github/workflows/${workflow}`, job, modes: Object.freeze(modes),
})));

// GitHub's event generation is independent of a later checkout of dynamic main.
// Keep this check in the central admission path so direct and always() publishers
// cannot reuse an earlier event-gate result. This pure export grants no authority.
export function evaluateMailboxWorkflowEventSource({ mode, sourceHead, env } = {}) {
  const result = (admitted, reason, eventHead = '', workflowPath = '', job = '') => Object.freeze({
    admitted, reason, eventHead, workflowPath, job,
  });
  const invalid = () => result(false, 'MAILBOX_WORKFLOW_EVENT_CONTEXT_INVALID');
  if (!env || typeof env !== 'object' || Array.isArray(env) || !exactHead(sourceHead)
    || !['receipt', 'protected', 'observer', 'bootstrap', 'prerequisite'].includes(mode)) return invalid();
  if (env.GITHUB_EVENT_NAME !== 'issue_comment') {
    // Preserve existing non-comment and local admission. Hosted execution must
    // still identify its event; missing metadata is not a non-comment bypass.
    if (env.GITHUB_ACTIONS === 'true' && (!Object.hasOwn(env, 'GITHUB_EVENT_NAME')
      || typeof env.GITHUB_EVENT_NAME !== 'string' || !/^[a-z][a-z_]*$/.test(env.GITHUB_EVENT_NAME))) return invalid();
    return result(true, 'MAILBOX_WORKFLOW_NON_ISSUE_COMMENT_EVENT');
  }
  const required = ['GITHUB_ACTIONS', 'GITHUB_EVENT_NAME', 'GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_ID',
    'GITHUB_REPOSITORY_OWNER', 'GITHUB_REPOSITORY_OWNER_ID', 'GITHUB_REF', 'GITHUB_WORKFLOW_REF',
    'GITHUB_WORKFLOW_SHA', 'GITHUB_SHA', 'GITHUB_JOB', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'];
  if (required.some(key => !Object.hasOwn(env, key) || typeof env[key] !== 'string')
    || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== repository
    || env.GITHUB_REPOSITORY_ID !== '1179385578' || env.GITHUB_REPOSITORY_OWNER !== 'Cheekyfellastef'
    || env.GITHUB_REPOSITORY_OWNER_ID !== '267490109' || env.GITHUB_REF !== 'refs/heads/main'
    || !positiveId(env.GITHUB_RUN_ID) || !positiveId(env.GITHUB_RUN_ATTEMPT)
    || !exactHead(env.GITHUB_SHA) || !exactHead(env.GITHUB_WORKFLOW_SHA)
    || env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA) return invalid();
  const caller = issueCommentCallers.find(item => item.job === env.GITHUB_JOB
    && item.modes.includes(mode)
    && env.GITHUB_WORKFLOW_REF === `${repository}/${item.workflowPath}@refs/heads/main`);
  if (!caller) return invalid();
  if (env.GITHUB_SHA !== sourceHead) return result(false, 'MAILBOX_WORKFLOW_EVENT_SOURCE_STALE');
  return result(true, 'MAILBOX_WORKFLOW_EVENT_SOURCE_ADMITTED', env.GITHUB_SHA, caller.workflowPath, caller.job);
}

export async function readMailboxWorkflowGitHub(path) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('MAILBOX_WORKFLOW_AUTHENTICATED_READ_REQUIRED');
  if (!/^\/(branches\/main|issues\/(2315\/comments\?per_page=100&page=[1-9][0-9]?|comments\/[1-9][0-9]*))$/.test(path)) throw new Error('MAILBOX_WORKFLOW_READ_PATH_DENIED');
  // Preserve the pinned merge-queue job permissions exactly. These fixed
  // public evidence GETs need no issue credential. TLS repository/comment
  // identity and the original owner command/receipt still govern the fence;
  // authenticated main reads and all downstream approval gates remain intact.
  const publicEvidence = process.env.GITHUB_ACTIONS === 'true'
    && process.env.GITHUB_JOB === 'operator-merge-queue-boundary' && path.startsWith('/issues/');
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Accept: 'application/vnd.github+json', ...(!publicEvidence ? { Authorization: `Bearer ${token}` } : {}), 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (response.status !== 200) throw new Error('MAILBOX_WORKFLOW_FRESH_READ_FAILED');
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 2*1024*1024) throw new Error('MAILBOX_WORKFLOW_READ_OVERSIZE');
  return JSON.parse(raw);
}

export async function assertMailboxRotationWorkflowAdmission({ mode, prNumber, head,
  api = readMailboxWorkflowGitHub, checkoutHead = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
} = {}) {
  if (!['receipt', 'protected', 'observer', 'bootstrap', 'prerequisite'].includes(mode)) throw new Error('MAILBOX_WORKFLOW_MODE_INVALID');
  const sourceHead = checkoutHead();
  const before = (await api('/branches/main'))?.commit?.sha;
  if (!/^[a-f0-9]{40}$/.test(sourceHead || '') || before !== sourceHead) throw new Error('MAILBOX_WORKFLOW_SOURCE_STALE');
  const eventSource = evaluateMailboxWorkflowEventSource({ mode, sourceHead, env: process.env });
  if (!eventSource.admitted) throw new Error(eventSource.reason);
  const readComments = async () => {
    const comments = [];
    for (let page=1; page<=30; page++) {
      const batch = await api(`/issues/2315/comments?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('MAILBOX_WORKFLOW_FENCE_HISTORY_INVALID');
      comments.push(...batch);
      if (batch.length < 100) return comments;
    }
    throw new Error('MAILBOX_WORKFLOW_FENCE_HISTORY_INCOMPLETE');
  };
  const fence = await readMailboxRotationFence(readComments, id => api(`/issues/comments/${id}`));
  if (!mailboxRotationWorkflowAllowed(fence, { mode, prNumber, head })) throw new Error('MAILBOX_ROTATION_GLOBAL_FREEZE_ACTIVE');
  if ((await api('/branches/main'))?.commit?.sha !== sourceHead) throw new Error('MAILBOX_WORKFLOW_MAIN_MOVED');
  return { admitted: true, sourceHead, transitionId: fence?.transitionId || '', mergeAuthority: false };
}
