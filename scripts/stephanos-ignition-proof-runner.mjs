import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { resolve } from 'node:path';

const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:4173/apps/stephanos/dist/index.html';
const outDir = resolve('tmp/stephanos-ignition');
const transcriptPath = resolve(outDir, 'ignition-proof-runner-transcript.json');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runStep(name, command, args) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    name,
    command: [command, ...args].join(' '),
    startedAt,
    finishedAt: new Date().toISOString(),
    status: result.status,
    signal: result.signal,
    error: result.error ? result.error.message : null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    passed: !result.error && result.status === 0,
  };
}

function runOptionalEvidence(name, command, args) {
  const step = runStep(name, command, args);
  return {
    name: step.name,
    command: step.command,
    status: step.status,
    error: step.error,
    value: step.stdout.trim() || step.stderr.trim(),
    passed: step.passed,
  };
}

function markerSeen(step, marker) {
  return `${step.stdout}\n${step.stderr}`.includes(marker);
}

function buildRuntimeDomSignals(body) {
  const titleMatch = body.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;
  const bodyContainsStephanos = /Stephanos|Command Deck|Galaxians|Wealth/i.test(body);
  const hasHtmlShell = /<html[\s>]/i.test(body) && /<body[\s>]/i.test(body);

  return {
    title,
    bodyContainsStephanos,
    hasHtmlShell,
    contentLength: body.length,
    bodySample: body.replace(/\s+/g, ' ').trim().slice(0, 240),
    passed: bodyContainsStephanos && hasHtmlShell,
  };
}

function emptyRuntimeProbe(url, error = null) {
  return {
    name: 'runtime-url-probe',
    url,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    statusCode: null,
    bodyContainsStephanos: false,
    domSignals: {
      title: null,
      bodyContainsStephanos: false,
      hasHtmlShell: false,
      contentLength: 0,
      bodySample: '',
      passed: false,
    },
    error,
    passed: false,
  };
}

function probeRuntime(url = DEFAULT_RUNTIME_URL) {
  return new Promise((resolveProbe) => {
    const startedAt = new Date().toISOString();
    const request = get(url, { timeout: 5000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        const domSignals = buildRuntimeDomSignals(body);
        const httpPassed = response.statusCode >= 200 && response.statusCode < 400;
        resolveProbe({
          name: 'runtime-url-probe',
          url,
          startedAt,
          finishedAt: new Date().toISOString(),
          statusCode: response.statusCode,
          bodyContainsStephanos: domSignals.bodyContainsStephanos,
          domSignals,
          passed: httpPassed && domSignals.passed,
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('runtime probe timed out'));
    });

    request.on('error', (error) => {
      resolveProbe(emptyRuntimeProbe(url, error.message));
    });
  });
}

function buildBlockedTranscript(error, runtimeUrl = process.env.STEPHANOS_IGNITION_RUNTIME_URL || DEFAULT_RUNTIME_URL) {
  const expectedHead = process.env.STEPHANOS_IGNITION_EXPECTED_HEAD || null;
  const gitHead = runOptionalEvidence('git-head', 'git', ['rev-parse', 'HEAD']);
  const gitBranch = runOptionalEvidence('git-branch', 'git', ['branch', '--show-current']);
  const gitStatusBefore = runOptionalEvidence('git-status-before', 'git', ['status', '--porcelain=v1']);
  const exactHeadMatched = expectedHead ? gitHead.value === expectedHead : null;
  const runtime = emptyRuntimeProbe(runtimeUrl, 'proof runner failed before runtime probe completed');

  return {
    marker: 'MILESTONE_5_IGNITION_BROWSER_RUNTIME_PROOF_BLOCKED',
    proofScope: {
      cleanOrCurrentWorkspaceProof: false,
      safeGeneratedDirtProof: false,
      unsafeDirtBlockedProof: false,
      browserRuntimeProof: false,
      browserRuntimeDomProof: false,
      exactHeadProof: expectedHead ? exactHeadMatched : 'not-supplied',
      emergencyTranscriptProof: true,
    },
    exactHead: {
      expected: expectedHead,
      actual: gitHead.value,
      matched: exactHeadMatched,
      branch: gitBranch.value,
    },
    safetyBoundaries: {
      deletesSourceFiles: false,
      hidesBlockers: false,
      autoFixesUnknownDirt: false,
      merges: false,
      exactHeadApprovalRequiredBeforeMerge: true,
    },
    operatorAction: 'Post this blocker transcript to #1281 / PR #1288. Keep the launcher window open if present, then inspect the concierge splash/support snapshot before retrying local proof.',
    evidence: {
      gitHead,
      gitBranch,
      gitStatusBefore,
    },
    steps: [],
    runtime,
    error: error.message,
    transcriptPath,
  };
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  const gitHead = runOptionalEvidence('git-head', 'git', ['rev-parse', 'HEAD']);
  const gitBranch = runOptionalEvidence('git-branch', 'git', ['branch', '--show-current']);
  const gitStatusBefore = runOptionalEvidence('git-status-before', 'git', ['status', '--porcelain=v1']);
  const expectedHead = process.env.STEPHANOS_IGNITION_EXPECTED_HEAD || null;
  const exactHeadMatched = expectedHead ? gitHead.value === expectedHead : null;

  const steps = [
    runStep('ignition-concierge-unit-tests', npmCommand, ['run', 'stephanos:ignition-concierge:test']),
    runStep('ignition-concierge-proof-mode', npmCommand, ['run', 'stephanos:ignition-concierge:proof']),
  ];

  const runtime = await probeRuntime(process.env.STEPHANOS_IGNITION_RUNTIME_URL || DEFAULT_RUNTIME_URL);
  const proofScope = {
    cleanOrCurrentWorkspaceProof: steps[1]?.passed && markerSeen(steps[1], 'STEPHANOS_IGNITION_CONCIERGE_V1'),
    safeGeneratedDirtProof: markerSeen(steps[0], 'classifies generated dist dirt as safe'),
    unsafeDirtBlockedProof: markerSeen(steps[0], 'source dirt as approval-required') || markerSeen(steps[0], 'splash model exposes blocked panel'),
    browserRuntimeProof: runtime.passed,
    browserRuntimeDomProof: Boolean(runtime.domSignals?.passed),
    exactHeadProof: expectedHead ? exactHeadMatched : 'not-supplied',
  };
  const passed = steps.every((step) => step.passed)
    && runtime.passed
    && (!expectedHead || exactHeadMatched);
  const transcript = {
    marker: passed
      ? 'MILESTONE_5_IGNITION_BROWSER_RUNTIME_PROOF_PASSED'
      : 'MILESTONE_5_IGNITION_BROWSER_RUNTIME_PROOF_BLOCKED',
    proofScope,
    exactHead: {
      expected: expectedHead,
      actual: gitHead.value,
      matched: exactHeadMatched,
      branch: gitBranch.value,
    },
    safetyBoundaries: {
      deletesSourceFiles: false,
      hidesBlockers: false,
      autoFixesUnknownDirt: false,
      merges: false,
      exactHeadApprovalRequiredBeforeMerge: true,
    },
    operatorAction: passed
      ? 'Post this transcript to #1281 / PR #1288, then request exact-head approval before merge.'
      : 'Start Stephanos locally with npm run stephanos, then rerun this proof runner. If runtime or exact-head still fails, post the transcript as the blocker.',
    evidence: {
      gitHead,
      gitBranch,
      gitStatusBefore,
    },
    steps,
    runtime,
    transcriptPath,
  };

  writeFileSync(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
  console.log(`${transcript.marker}`);
  console.log(`IGNITION_PROOF_TRANSCRIPT=${transcriptPath}`);
  console.log(`operatorAction=${transcript.operatorAction}`);

  process.exitCode = passed ? 0 : 2;
}

main().catch((error) => {
  mkdirSync(outDir, { recursive: true });
  const transcript = buildBlockedTranscript(error);
  writeFileSync(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
  console.error(error);
  console.log(`${transcript.marker}`);
  console.log(`IGNITION_PROOF_TRANSCRIPT=${transcriptPath}`);
  console.log(`operatorAction=${transcript.operatorAction}`);
  process.exitCode = 1;
});
