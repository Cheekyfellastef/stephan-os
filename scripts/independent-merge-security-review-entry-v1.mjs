#!/usr/bin/env node

import fs from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  buildIndependentReviewExecutionContextV1,
} from '../shared/agents/independentReviewExecutionContextV1.mjs';

const REVIEW_WRAPPER = 'scripts/independent-merge-security-review-with-openclaw-specialist-v1.mjs';
const PREFLIGHT_FILE = 'independent-review-workflow-dispatch-preflight.json';
const SYNTHETIC_EVENT_FILE = 'independent-review-workflow-dispatch-event.json';

function text(value) {
  return String(value ?? '').trim();
}

function exactRunnerTempPath(fileName, requestedPath = '') {
  const runnerTemp = text(process.env.RUNNER_TEMP);
  if (!runnerTemp) throw new Error('RUNNER_TEMP is required for independent review entry');
  const expected = resolve(runnerTemp, fileName);
  if (requestedPath && resolve(requestedPath) !== expected) {
    throw new Error(`${fileName} must use the exact runner-temp path`);
  }
  return expected;
}

function readDispatchPreflight() {
  const requested = text(process.env.STEPHANOS_INDEPENDENT_REVIEW_DISPATCH_PREFLIGHT_PATH);
  const preflightPath = exactRunnerTempPath(PREFLIGHT_FILE, requested);
  if (!requested || !fs.existsSync(preflightPath)) {
    throw new Error('validated workflow-dispatch preflight file is required');
  }
  return JSON.parse(fs.readFileSync(preflightPath, 'utf8'));
}

function writeSyntheticLegacyEvent(context) {
  const eventPath = exactRunnerTempPath(SYNTHETIC_EVENT_FILE);
  const payload = {
    repository: { full_name: context.repository },
    pull_request: context.pullRequest,
  };
  fs.writeFileSync(eventPath, `${JSON.stringify(payload)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return eventPath;
}

function dispatchEnvironment() {
  const preflight = readDispatchPreflight();
  const context = buildIndependentReviewExecutionContextV1({
    eventName: 'workflow_dispatch',
    repository: text(process.env.GITHUB_REPOSITORY),
    job: text(process.env.GITHUB_JOB),
    legacyEvent: null,
    dispatchPreflight: preflight,
  });
  const eventPath = writeSyntheticLegacyEvent(context);
  return {
    eventPath,
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      STEPHANOS_INDEPENDENT_REVIEW_ORIGINAL_EVENT_NAME: 'workflow_dispatch',
      STEPHANOS_INDEPENDENT_REVIEW_HANDOFF_BINDING_SHA256: context.handoffBindingSha256,
      STEPHANOS_INDEPENDENT_REVIEW_HANDOFF_RUN_RECEIPT_SHA256: context.handoffRunReceiptSha256,
    },
  };
}

function launch(env) {
  return spawnSync(process.execPath, [REVIEW_WRAPPER], {
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env,
  });
}

function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('Independent review entry may run only inside GitHub Actions.');
  }
  if (text(process.env.GITHUB_JOB) !== 'independent-security-review') {
    throw new Error('Independent review entry job identity mismatch.');
  }
  const eventName = text(process.env.GITHUB_EVENT_NAME);
  if (eventName === 'pull_request_target') {
    const child = launch(process.env);
    process.exitCode = Number.isInteger(child.status) ? child.status : 1;
    return;
  }
  if (eventName !== 'workflow_dispatch') {
    throw new Error(`Independent review event ${eventName || 'unknown'} is not allowlisted.`);
  }

  const prepared = dispatchEnvironment();
  try {
    const child = launch(prepared.env);
    process.exitCode = Number.isInteger(child.status) ? child.status : 1;
  } finally {
    fs.rmSync(prepared.eventPath, { force: false });
  }
}

main();
