import { execFileSync } from 'node:child_process';
import { CANONICAL_MAILBOX_ISSUE } from '../shared/agents/canonicalMailboxAuthorityV1.mjs';
import {
  CANONICAL_MAILBOX_ROLLOVER_OWNER_GOAL,
  CANONICAL_MAILBOX_ROLLOVER_STATE_MARKER,
  buildCanonicalMailboxCapacityStateBody,
  observeCanonicalMailboxRollover,
} from '../shared/agents/canonicalMailboxRolloverConsumerV1.mjs';

// Called by the already serialized receipt mirror, after canonical event
// admission and trusted main checkout. No new scheduler, workflow or token.
function assertContext(context) {
  if (context.repo.owner !== 'Cheekyfellastef' || context.repo.repo !== 'stephan-os'
    || !['issue_comment', 'push', 'workflow_dispatch'].includes(context.eventName)) {
    throw new Error('CANONICAL_MAILBOX_ROLLOVER_WORKFLOW_CONTEXT_INVALID');
  }
}

export function createCanonicalMailboxRolloverGitHubAdapter({ github, context }) {
  assertContext(context);
  const coordinates = { owner: context.repo.owner, repo: context.repo.repo };
  let stateComments;
  const loadStateComments = async () => {
    if (!stateComments) stateComments = await github.paginate(github.rest.issues.listComments, {
      ...coordinates, issue_number: CANONICAL_MAILBOX_ROLLOVER_OWNER_GOAL, per_page: 100,
    });
    return stateComments;
  };
  const findState = async currentIssue => {
    const marker = `<!-- ${CANONICAL_MAILBOX_ROLLOVER_STATE_MARKER} predecessor=${currentIssue} -->`;
    const existing = (await loadStateComments()).filter(comment => comment.user?.login === 'github-actions[bot]'
      && String(comment.body || '').startsWith(marker));
    if (existing.length > 1) throw new Error('CANONICAL_MAILBOX_CAPACITY_STATE_AMBIGUOUS');
    return existing[0];
  };
  const saveState = async (currentIssue, body) => {
    const existing = await findState(currentIssue);
    if (existing) {
      if (existing.body !== body) await github.rest.issues.updateComment({ ...coordinates, comment_id: existing.id, body });
      existing.body = body;
    } else {
      const created = await github.rest.issues.createComment({ ...coordinates, issue_number: CANONICAL_MAILBOX_ROLLOVER_OWNER_GOAL, body });
      stateComments.push(created.data);
    }
  };
  const adapter = {
    getIssue: async issue_number => (await github.rest.issues.get({ ...coordinates, issue_number })).data,
    listNewerIssues: async current => {
      const issues = [];
      // New issue numbers are monotonic. Enumerate REST creation order through
      // the predecessor, not GitHub's eventually indexed search results.
      for (let page = 1; page <= 20; page++) {
        const response = await github.rest.issues.listForRepo({ ...coordinates,
          state: 'all', sort: 'created', direction: 'desc', per_page: 100, page });
        for (const issue of response.data) {
          if (issue.number <= current) return { complete: true, issues };
          issues.push(issue);
        }
        if (response.data.length < 100) return { complete: true, issues };
      }
      return { complete: false, issues };
    },
    readProvisioningIntent: async () => {
      // Any durable record without a discoverable successor requires owner
      // reconciliation, including a successful nomination subsequently removed.
      return Boolean(await findState(CANONICAL_MAILBOX_ISSUE));
    },
    beginProvisioning: async ({ currentIssue, sourceHead }) => saveState(currentIssue,
      `<!-- ${CANONICAL_MAILBOX_ROLLOVER_STATE_MARKER} predecessor=${currentIssue} -->\nSUCCESSOR_PROVISIONING_INTENT\nSource: ${sourceHead}\n\nNO COMMAND AUTHORITY. A missing or ambiguous create result requires original-owner reconciliation; do not create another successor.\n`),
    createInactiveSuccessor: async data => (await github.rest.issues.create({ ...coordinates, ...data })).data,
    publishState: async status => saveState(status.currentIssue, buildCanonicalMailboxCapacityStateBody(status)),
  };
  return adapter;
}

export async function observeCanonicalMailboxRolloverOnGitHub({ github, context }) {
  assertContext(context);
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const main = await github.rest.repos.getBranch({ owner: context.repo.owner, repo: context.repo.repo, branch: 'main' });
  if (main.data.commit.sha !== sourceHead) throw new Error('CANONICAL_MAILBOX_ROLLOVER_MAIN_MOVED');
  return observeCanonicalMailboxRollover({ sourceHead, adapter: createCanonicalMailboxRolloverGitHubAdapter({ github, context }) });
}
