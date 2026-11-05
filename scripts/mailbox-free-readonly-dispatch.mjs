#!/usr/bin/env node
// Goal #2315: source-bound GitHub Actions GET-only proof; no command or mutation routes.
import { readFileSync, lstatSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MAILBOX_FREE_DISPATCH_SCHEMA,
  validateMailboxFreeWorkflowDispatchV1,
  projectMailboxFreeGoalObservationV1,
} from '../shared/agents/mailboxFreeWorkflowDispatchV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD_PATTERN = /^[0-9a-f]{40}$/;
function fail(blocker, admission = null) {
  return Object.freeze({
    schemaVersion: MAILBOX_FREE_DISPATCH_SCHEMA, verdict: 'BLOCKED',
    blocker, requestId: admission?.requestId || '',
    goalNumber: admission?.goalNumber || null,
    independentVerificationPerformed: false, executionAuthorized: false,
    nativePickupProven: false, sourceMutationAllowed: false, protectedMergeAllowed: false,
  });
}
function eventFromTrustedRunner(env) {
  const path = env.GITHUB_EVENT_PATH;
  if (typeof path !== 'string' || !path || path.length > 4096) throw new Error('EVENT_UNAVAILABLE');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 131072) throw new Error('EVENT_UNAVAILABLE');
  return JSON.parse(readFileSync(path, 'utf8'));
}
async function readGitHub(path, token) {
  if (!token) throw new Error('READ_CREDENTIAL_UNAVAILABLE');
  const response = await fetch('https://api.github.com/repos/' + REPOSITORY + path, {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'stephanos-mailbox-free-observer-v1',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('GITHUB_READ_UNAVAILABLE');
  const value = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('GITHUB_READ_MALFORMED');
  }
  return value;
}
export async function readMailboxFreeGoalV1(admission, token, read = readGitHub) {
  if (!admission?.ok || admission.mode !== 'READ_GOAL_STATUS') {
    return fail('INGRESS_NOT_ADMITTED', admission);
  }
  try {
    const before = await read('/git/ref/heads/main', token);
    if (!HEAD_PATTERN.test(String(before?.object?.sha ?? ''))
      || before.object.sha !== admission.checkedOutHead) return fail('EXACT_MAIN_CHANGED', admission);
    const issue = await read('/issues/' + admission.goalNumber, token);
    const after = await read('/git/ref/heads/main', token);
    if (after?.object?.sha !== admission.checkedOutHead) return fail('EXACT_MAIN_CHANGED', admission);
    const projected = projectMailboxFreeGoalObservationV1(admission, issue, after.object.sha, new Date().toISOString());
    return projected.verdict === 'READ_ONLY_OBSERVED' ? projected : fail(projected.blocker || 'GOAL_OBSERVATION_INVALID', admission);
  } catch {
    return fail('READ_ONLY_GITHUB_OBSERVATION_FAILED', admission);
  }
}
async function main() {
  let receipt;
  try {
    const event = eventFromTrustedRunner(process.env);
    const admission = validateMailboxFreeWorkflowDispatchV1(event, process.env);
    if (!admission.ok) {
      receipt = fail(admission.blocker);
    } else {
      // The runner must execute the exact checked-out protected main, not merely
      // trust the workflow metadata or mutable ref named by the caller.
      let checkoutSha = '';
      try {
        checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: process.env.GITHUB_WORKSPACE, encoding: 'utf8',
          timeout: 3000, windowsHide: true,
        }).trim();
      } catch {}
      receipt = checkoutSha === admission.checkedOutHead
        ? await readMailboxFreeGoalV1(admission, process.env.GITHUB_TOKEN)
        : fail('CHECKED_OUT_MAIN_MISMATCH', admission);
    }
  } catch {
    receipt = fail('TRUSTED_ACTIONS_EVENT_UNAVAILABLE');
  }
  const json = JSON.stringify(receipt, null, 2) + '\n';
  // Immutable Actions run and its artifact are read-only metadata, not native execution.
  const temp = process.env.RUNNER_TEMP;
  if (typeof temp === 'string' && temp.length && temp.length < 4096) {
    writeFileSync(join(temp, 'stephanos-mailbox-free-readonly-proof.json'), json, { flag: 'w', mode: 0o600 });
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const codeFence = String.fromCharCode(96).repeat(3);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '### Stephanos Control Tower | Mailbox-free observation\n\n' +
      'This is read-only GitHub metadata, not native execution, source approval, lease or merge authority.\n\n' +
      codeFence + 'json\n' + json + codeFence + '\n');
  }
  process.stdout.write('STEPHANOS_MAILBOX_FREE_VERDICT=' + receipt.verdict + '\n');
  if (receipt.verdict !== 'READ_ONLY_OBSERVED') process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
