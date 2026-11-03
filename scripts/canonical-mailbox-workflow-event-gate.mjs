#!/usr/bin/env node
// Source-controlled fail-closed GitHub event ingress gate. A workflow `if:`
// condition triggers a runner but confers no authority. Protected command parsing
// and exact-head approval remain with the existing downstream validators.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CANONICAL_MAILBOX_ISSUE, CANONICAL_MAILBOX_RECEIPT_PREDECESSOR } from '../shared/agents/canonicalMailboxAuthorityV1.mjs';
import { assertMailboxRotationWorkflowAdmission } from './canonical-mailbox-workflow-admission-v1.mjs';
import { extractProtectedWorkflowDispatch } from '../shared/agents/protectedWorkflowDispatchMailboxV1.mjs';

export const CANONICAL_MAILBOX_WORKFLOW_GATE_SCHEMA = 'stephanos.canonical-mailbox-workflow-gate.v1';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const OWNER = 'Cheekyfellastef';
const markers = Object.freeze({
  protected: 'stephanos-protected-workflow-dispatch',
  receipt: '<!-- stephanos-battle-bridge-command-receipt -->',
  observer: 'stephanos-battle-bridge-tailscale-bootstrap-prerequisites',
  bootstrap: 'stephanos-battle-bridge-tailscale-bootstrap',
  prerequisite: 'stephanos-battle-bridge-tailscale-bootstrap-prerequisites',
});
export function evaluateCanonicalMailboxWorkflowEvent(event, {
  mode, repository = REPOSITORY, owner = OWNER,
} = {}) {
  const denied = reason => Object.freeze({
    schemaVersion: CANONICAL_MAILBOX_WORKFLOW_GATE_SCHEMA,
    admitted: false, reason, sourceMutationAuthority: false,
    mergeAuthority: false, protectedApprovalAuthority: false,
  });
  if (!Object.hasOwn(markers, mode)) return denied('INVALID_EVENT_MODE');
  if (repository !== REPOSITORY || owner !== OWNER) return denied('INVALID_OWNER_CONTEXT');
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || event.repository?.full_name !== REPOSITORY
    || (event.issue?.number !== CANONICAL_MAILBOX_ISSUE
      && !(mode === 'receipt' && event.issue?.number === CANONICAL_MAILBOX_RECEIPT_PREDECESSOR))
    || event.issue?.pull_request
    || event.comment?.user?.login !== owner
    || !['created', 'edited'].includes(event.action)
    || (event.action === 'edited' && mode !== 'receipt')) {
    return denied('NON_CANONICAL_OR_UNTRUSTED_EVENT');
  }
  const body = event.comment?.body;
  if (typeof body !== 'string' || body.length > 64000
    || !body.includes(markers[mode])
    || (mode === 'bootstrap' && body.includes(markers.prerequisite))) {
    return denied('COMMAND_CLASS_MISMATCH');
  }
  return Object.freeze({
    schemaVersion: CANONICAL_MAILBOX_WORKFLOW_GATE_SCHEMA,
    admitted: true,
    issueNumber: event.issue.number, mode,
    downstreamExactCommandValidationRequired: true,
    sourceMutationAuthority: false,
    mergeAuthority: false,
    protectedApprovalAuthority: false,
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let evaluation = { admitted: false };
  try {
    const path = process.env.GITHUB_EVENT_PATH;
    if (path && statSync(path).isFile() && statSync(path).size <= 256000) {
      const event = JSON.parse(readFileSync(path, 'utf8'));
      evaluation = evaluateCanonicalMailboxWorkflowEvent(
        event,
        { mode: process.argv[2],
          repository: process.env.GITHUB_REPOSITORY,
          owner: process.env.GITHUB_REPOSITORY_OWNER },
      );
      if (evaluation.admitted) {
        const command = process.argv[2] === 'protected' ? extractProtectedWorkflowDispatch(event.comment.body)?.command : {};
        await assertMailboxRotationWorkflowAdmission({ mode: process.argv[2], prNumber: command?.prNumber, head: command?.expectedHead });
      }
    }
  } catch { evaluation = { admitted: false }; }
  process.stdout.write('CANONICAL_MAILBOX_INGRESS=' +
    (evaluation.admitted ? 'ADMITTED' : 'DENIED') + '\n');
  if (!evaluation.admitted) process.exitCode = 1;
}
