import { execFileSync } from 'node:child_process';
import { readMailboxRotationFence, mailboxRotationWorkflowAllowed } from '../shared/agents/canonicalMailboxRotationFenceV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
export async function readMailboxWorkflowGitHub(path) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('MAILBOX_WORKFLOW_AUTHENTICATED_READ_REQUIRED');
  if (!/^\/(branches\/main|issues\/(2315\/comments\?per_page=100&page=[1-9][0-9]?|comments\/[1-9][0-9]*))$/.test(path)) throw new Error('MAILBOX_WORKFLOW_READ_PATH_DENIED');
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
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
