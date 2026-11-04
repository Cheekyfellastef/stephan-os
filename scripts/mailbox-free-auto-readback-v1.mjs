#!/usr/bin/env node
// Goal #2315 Stage 4: automatic read-only RECEIPT CHECK after the existing
// Control Tower's owner-authenticated manual run. This is not a task producer,
// mission scheduler, lease, Sovereign command transport or native worker.
import { lstatSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMailboxFreeGoalEvidenceFromGitHubV1 } from '../shared/agents/mailboxFreeGitHubEvidenceReaderV1.mjs';

export const MAILBOX_FREE_AUTO_READBACK_SCHEMA = 'stephanos.mailbox-free-auto-readback-stage4.v1';
export const MAILBOX_FREE_AUTO_READBACK_FILE = 'mailbox-free-goal-readback.json';

const REPO = 'Cheekyfellastef/stephan-os';
const REPO_ID = 1179385578;
const OPERATOR = 'Cheekyfellastef';
const OPERATOR_ID = 267490109;
const WORKFLOW_ID = 398609082;
const WORKFLOW_PATH = '.github/workflows/stephanos-mailbox-free-readonly.yml';
const SHA40 = /^[a-f0-9]{40}$/;
const positive = value => Number.isSafeInteger(value) && value > 0;

function held(blocker, runId = null) {
  return Object.freeze({
    schemaVersion: MAILBOX_FREE_AUTO_READBACK_SCHEMA,
    verdict: 'HELD',
    blocker,
    originRunId: runId,
    goalNumber: null,
    sourceHead: null,
    originalGoalAdmissionGranted: false,
    exclusiveClaimGranted: false,
    executionAuthorized: false,
    sourceMutationAllowed: false,
    protectedMergeAllowed: false,
    nativePickupProven: false,
    independentlyAuthenticatedNativeCustody: false,
  });
}

// Event envelope is an authenticated GitHub Actions trigger, not an owner
// source-grant. Originating run, artifact bytes and current main are separately
// re-read and authenticated by the existing Stage-3 bounded GitHub GET adapter.
export function admitAutomaticReadbackEventV1(event, env = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || env.GITHUB_ACTIONS !== 'true'
    || env.GITHUB_EVENT_NAME !== 'workflow_run'
    || env.GITHUB_JOB !== 'readback') return held('TRUSTED_ACTIONS_EVENT_INVALID');
  const run = event.workflow_run;
  if (env.GITHUB_REPOSITORY !== REPO
    || env.GITHUB_REPOSITORY_OWNER !== OPERATOR
    || env.GITHUB_REF !== 'refs/heads/main'
    || !SHA40.test(String(env.GITHUB_SHA || ''))
    || event.action !== 'completed'
    || event.repository?.full_name !== REPO
    || event.repository?.id !== REPO_ID
    || event.repository?.owner?.login !== OPERATOR
    || !run || typeof run !== 'object'
    || !positive(run.id)
    || run.workflow_id !== WORKFLOW_ID
    || run.path !== WORKFLOW_PATH
    || run.event !== 'workflow_dispatch'
    || run.status !== 'completed'
    || run.conclusion !== 'success'
    || run.run_attempt !== 1
    || run.head_branch !== 'main'
    || !SHA40.test(String(run.head_sha || ''))
    || run.repository?.full_name !== REPO
    || run.repository?.id !== REPO_ID
    || run.actor?.login !== OPERATOR
    || run.actor?.id !== OPERATOR_ID) return held('TRUSTED_ORIGIN_RUN_IDENTITY_INVALID');
  return Object.freeze({
    ok: true, runId: run.id, originatingHead: run.head_sha,
    checkedOutHead: env.GITHUB_SHA,
    originalGoalAdmissionGranted: false,
    executionAuthorized: false,
    protectedMergeAllowed: false,
  });
}

export function projectAutomaticReadbackResultV1(admission, observed) {
  if (!admission?.ok) return held('READBACK_EVENT_NOT_ADMITTED');
  if (observed?.disposition !== 'DISCOVERY_CANDIDATE_ONLY'
    || observed.runId !== admission.runId
    || observed.sourceHead !== admission.originatingHead
    || observed.sourceHead !== admission.checkedOutHead
    || !positive(observed.goalNumber)
    || observed.originalGoalAdmissionGranted !== false
    || observed.exclusiveClaimGranted !== false
    || observed.executionAuthorized !== false
    || observed.sourceMutationAllowed !== false
    || observed.protectedMergeAllowed !== false
    || observed.nativePickupProven !== false
    || observed.independentlyAuthenticatedTransport !== false) {
    return held(
      typeof observed?.blocker === 'string' && /^[A-Z0-9_]{1,100}$/.test(observed.blocker)
        ? observed.blocker || 'READ_ONLY_EVIDENCE_NOT_CURRENT_OR_ADMITTED'
        : 'READ_ONLY_EVIDENCE_NOT_CURRENT_OR_ADMITTED',
      admission.runId,
    );
  }
  return Object.freeze({
    schemaVersion: MAILBOX_FREE_AUTO_READBACK_SCHEMA,
    verdict: 'READ_ONLY_GITHUB_EVIDENCE_CORRELATED',
    blocker: '',
    originRunId: admission.runId,
    goalNumber: observed.goalNumber,
    sourceHead: observed.sourceHead,
    originatingArtifactId: observed.artifactId,
    artifactSha256: observed.archiveSha256,
    sourceProofKind: 'GITHUB_RUN_ARTIFACT_AND_GOAL_GET_VERIFIED',
    originalGoalAdmissionGranted: false,
    exclusiveClaimGranted: false,
    executionAuthorized: false,
    sourceMutationAllowed: false,
    protectedMergeAllowed: false,
    nativePickupProven: false,
    independentlyAuthenticatedNativeCustody: false,
    nextGate: 'ORIGINAL_MISSION_OWNER_SOURCE_LEASE_AND_PICKUP_PROOF',
  });
}

function eventFromRunner() {
  const name = process.env.GITHUB_EVENT_PATH;
  if (typeof name !== 'string' || !name || name.length > 4096) throw Error('EVENT_NOT_AVAILABLE');
  const stat = lstatSync(name);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 131072) throw Error('EVENT_NOT_AVAILABLE');
  return JSON.parse(readFileSync(name, 'utf8'));
}

export async function main() {
  let result;
  try {
    const event = eventFromRunner();
    const admission = admitAutomaticReadbackEventV1(event, process.env);
    if (!admission.ok) {
      result = admission;
    } else {
      const checkout = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: process.env.GITHUB_WORKSPACE, encoding: 'utf8', timeout: 3000, windowsHide: true,
      }).trim();
      if (checkout !== admission.checkedOutHead) {
        result = held('ACTUAL_CHECKED_OUT_MAIN_MISMATCH', admission.runId);
      } else {
        const observed = await readMailboxFreeGoalEvidenceFromGitHubV1({
          runId: admission.runId, token: process.env.GITHUB_TOKEN,
        });
        result = projectAutomaticReadbackResultV1(admission, observed);
      }
    }
  } catch {
    result = held('RUNNER_OR_BOUNDED_READBACK_FAILED');
  }
  const data = JSON.stringify(result, null, 2) + '\n';
  if (typeof process.env.RUNNER_TEMP === 'string' && process.env.RUNNER_TEMP.length > 0) {
    writeFileSync(join(process.env.RUNNER_TEMP, MAILBOX_FREE_AUTO_READBACK_FILE), data, {
      flag: 'w', mode: 0o600,
    });
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '### Stephanos Control Tower | Automatic mailbox-free proof readback\n\n'
      + 'Original request and artifact observed only; no source claim, native command, protected merge or PC pickup.\n\n'
      + 'Verdict: **' + result.verdict + '**'
      + (result.blocker ? ' | Blocker: **' + result.blocker + '**' : '') + '\n');
  }
  process.stdout.write('STEPHANOS_MAILBOX_FREE_AUTO_READBACK=' + result.verdict + '\n');
  if (result.verdict !== 'READ_ONLY_GITHUB_EVIDENCE_CORRELATED') process.exitCode = 1;
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
