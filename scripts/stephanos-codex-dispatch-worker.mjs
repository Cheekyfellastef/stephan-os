#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_CODEX_TASK_SCHEMA } from '../shared/agents/localCodexExecIntegration.mjs';
import {
  extractCodexThreadId,
  publishRemoteCodexTaskVisibility,
} from '../shared/agents/remoteCodexTaskVisibility.mjs';

const APPROVED_GENERATED_PREFIXES = Object.freeze([
  'apps/stephanos/dist/',
]);
const CANONICAL_BROWSER_PROOF_URL = 'http://127.0.0.1:4173/apps/stephanos/dist/index.html';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function gitCapture(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', shell: false });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error?.message || '',
  };
}

function processCapture(spawnSyncFn, executable, args, options = {}) {
  const result = spawnSyncFn(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120000,
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: String(result.stdout || '').trim().toLowerCase(),
  };
}

export function validateExactHeadAtWorkerStart(task, {
  spawnSyncFn = spawnSync,
  platform = process.platform,
} = {}) {
  if (!task?.exactHeadProof) return Object.freeze({ ok: true, required: false });
  const proof = task.exactHeadProof;
  const expectedHead = String(proof.expectedHead || '').trim().toLowerCase();
  const repository = String(proof.repository || '').trim();
  const prNumber = Number(proof.prNumber);
  if (!/^[0-9a-f]{40}$/.test(expectedHead) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !Number.isSafeInteger(prNumber) || prNumber <= 0) {
    return Object.freeze({ ok: false, required: true, blocker: 'EXACT_HEAD_PROOF_INVALID' });
  }
  const gh = processCapture(
    spawnSyncFn,
    platform === 'win32' ? 'gh.exe' : 'gh',
    ['api', `repos/${repository}/pulls/${prNumber}`, '--jq', '.head.sha'],
  );
  if (!gh.ok || !/^[0-9a-f]{40}$/.test(gh.stdout)) {
    return Object.freeze({ ok: false, required: true, blocker: 'PR_HEAD_LOOKUP_FAILED', expectedHead });
  }
  if (gh.stdout !== expectedHead) {
    return Object.freeze({ ok: false, required: true, blocker: 'PR_HEAD_MISMATCH', expectedHead, pullRequestHead: gh.stdout });
  }
  const git = processCapture(
    spawnSyncFn,
    platform === 'win32' ? 'git.exe' : 'git',
    ['rev-parse', 'HEAD'],
    { cwd: task.repoRoot },
  );
  if (!git.ok || !/^[0-9a-f]{40}$/.test(git.stdout)) {
    return Object.freeze({ ok: false, required: true, blocker: 'LOCAL_HEAD_LOOKUP_FAILED', expectedHead, pullRequestHead: gh.stdout });
  }
  if (git.stdout !== expectedHead) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'EXPECTED_HEAD_MISMATCH',
      expectedHead,
      pullRequestHead: gh.stdout,
      localHead: git.stdout,
    });
  }
  return Object.freeze({
    ok: true,
    required: true,
    expectedHead,
    pullRequestHead: gh.stdout,
    localHead: git.stdout,
  });
}

function boundedText(value = '', limit = 4000) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

export function parseGitStatusEntries(output = '') {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const status = line.slice(0, 2);
      const pathText = line.length > 3 ? line.slice(3).trim() : '';
      if (!pathText) return [];
      return pathText.split(' -> ').map((item) => Object.freeze({
        status,
        path: item.replace(/^"|"$/g, '').replace(/\\/g, '/'),
      }));
    });
}

export function parseGitStatusPaths(output = '') {
  return parseGitStatusEntries(output).map((entry) => entry.path);
}

export function classifyPostTaskDirt(output = '') {
  const entries = parseGitStatusEntries(output);
  const paths = [...new Set(entries.map((entry) => entry.path))];
  const generatedEntries = entries.filter((entry) => APPROVED_GENERATED_PREFIXES.some((prefix) => entry.path.startsWith(prefix)));
  const sourceEntries = entries.filter((entry) => !generatedEntries.includes(entry));
  const generated = [...new Set(generatedEntries.map((entry) => entry.path))];
  const source = [...new Set(sourceEntries.map((entry) => entry.path))];
  return Object.freeze({ entries, paths, generatedEntries, sourceEntries, generated, source, safe: source.length === 0 });
}

function stableEntries(entries = []) {
  return entries
    .map((entry) => `${entry.status} ${entry.path}`)
    .sort((a, b) => a.localeCompare(b));
}

export function compareDirtSnapshots(before = {}, after = {}) {
  const sourceBefore = stableEntries(before.sourceEntries || []);
  const sourceAfter = stableEntries(after.sourceEntries || []);
  const generatedBefore = stableEntries(before.generatedEntries || []);
  const generatedAfter = stableEntries(after.generatedEntries || []);
  const sourceMutationDetected = JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter);
  const generatedRuntimeMutationDetected = JSON.stringify(generatedBefore) !== JSON.stringify(generatedAfter);
  const sourcePathsBefore = [...new Set((before.source || []).map(String))].sort();
  const sourcePathsAfter = [...new Set((after.source || []).map(String))].sort();
  return Object.freeze({
    sourceMutationDetected,
    generatedRuntimeMutationDetected,
    sourcePathsBefore,
    sourcePathsAfter,
    newSourcePaths: sourcePathsAfter.filter((path) => !sourcePathsBefore.includes(path)),
    removedSourcePaths: sourcePathsBefore.filter((path) => !sourcePathsAfter.includes(path)),
    preExistingSourceDirt: sourcePathsBefore.length > 0,
    sourceDirtUnchanged: !sourceMutationDetected,
  });
}

export function validateExactHeadSourceTree(task, statusBefore = {}, statusAfter = {}, dirtBefore = {}, dirtAfter = {}) {
  if (!task?.exactHeadProof) return Object.freeze({ ok: true, required: false });
  const sourcePathsBefore = Array.isArray(dirtBefore.source) ? dirtBefore.source : [];
  const sourcePathsAfter = Array.isArray(dirtAfter.source) ? dirtAfter.source : [];
  if (!statusBefore.ok || !statusAfter.ok) {
    return Object.freeze({ ok: false, required: true, blocker: 'SOURCE_TREE_STATUS_FAILED' });
  }
  if (sourcePathsBefore.length > 0 || sourcePathsAfter.length > 0) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'SOURCE_TREE_DIRTY',
      sourcePathsBefore,
      sourcePathsAfter,
    });
  }
  return Object.freeze({ ok: true, required: true, sourcePathsBefore: [], sourcePathsAfter: [] });
}

export function parseCodexJsonEvents(output = '') {
  const events = [];
  const invalidLines = [];
  for (const line of String(output || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    try {
      events.push(JSON.parse(line));
    } catch {
      invalidLines.push(line.slice(0, 240));
    }
  }
  return Object.freeze({ events, invalidLines });
}

export function classifyCodexExecution({
  exit = {},
  events = [],
  lastMessage = '',
  stderr = '',
} = {}) {
  const failureEvent = events.find((event) => (
    event?.type === 'turn.failed'
    || event?.type === 'error'
    || event?.type === 'item.failed'
    || event?.item?.status === 'failed'
  )) || null;
  const turnCompleted = events.some((event) => event?.type === 'turn.completed');
  const stderrExcerpt = boundedText(stderr);
  const failureText = `${lastMessage}\n${stderrExcerpt}\n${failureEvent ? JSON.stringify(failureEvent) : ''}`;
  const cancelled = /(?:user\s+)?cancel(?:led|ed)(?:\s+by\s+user)?|tool call.*cancel(?:led|ed)/i.test(failureText);
  const exitPassed = exit.code === 0 && !exit.error;
  const passed = exitPassed && turnCompleted && !failureEvent && !cancelled;
  let reason = '';
  if (!exitPassed) {
    reason = exit.error || (events.length === 0 ? 'CODEX_CLI_STARTUP_FAILED' : `codex-exit-${exit.code ?? 'unknown'}`);
  } else if (cancelled) {
    reason = 'CODEX_EXEC_CANCELLED';
  } else if (failureEvent) {
    reason = `CODEX_EVENT_${String(failureEvent.type || 'FAILED').toUpperCase().replaceAll('.', '_')}`;
  } else if (!turnCompleted) {
    reason = 'CODEX_TURN_COMPLETION_MISSING';
  }
  return Object.freeze({
    passed,
    exitPassed,
    turnCompleted,
    cancelled,
    failureEventType: failureEvent?.type || '',
    reason,
    eventCount: events.length,
    stderrExcerpt,
  });
}

export function validateBrowserProofVerdict(lastMessage, task = {}, browserRuntimeProof = null) {
  if (!task?.exactHeadProof) return Object.freeze({ ok: true, required: false });
  const expectedScenario = String(task.exactHeadProof.proofScenario || '');
  let payload;
  try {
    const normalized = String(lastMessage || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    payload = JSON.parse(normalized);
  } catch {
    return Object.freeze({ ok: false, required: true, blocker: 'BROWSER_PROOF_VERDICT_INVALID' });
  }
  if (payload?.verdict !== 'PASS' || payload?.proofScenario !== expectedScenario) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: payload?.verdict === 'FAIL' ? 'BROWSER_PROOF_FAILED' : 'BROWSER_PROOF_VERDICT_INVALID',
    });
  }
  const evidence = payload.evidence || {};
  const requiredTrue = [
    'listeningDeckIframeIdentityPreserved',
    'discoveryIframeIdentityPreserved',
    'legacyRankingChanged',
  ];
  if (!requiredTrue.every((key) => evidence[key] === true) || !Array.isArray(evidence.consoleErrors)) {
    return Object.freeze({ ok: false, required: true, blocker: 'BROWSER_PROOF_EVIDENCE_INCOMPLETE' });
  }
  const expectedHead = String(task.exactHeadProof.expectedHead || '').trim().toLowerCase();
  const runtimeSourceHead = String(evidence.runtimeSourceHead || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(runtimeSourceHead)) {
    return Object.freeze({ ok: false, required: true, blocker: 'BROWSER_PROOF_RUNTIME_HEAD_MISSING' });
  }
  if (runtimeSourceHead !== expectedHead) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_PROOF_RUNTIME_HEAD_MISMATCH',
      expectedHead,
      runtimeSourceHead,
    });
  }
  if (browserRuntimeProof?.required === true) {
    if (browserRuntimeProof.ok !== true) {
      return Object.freeze({
        ok: false,
        required: true,
        blocker: browserRuntimeProof.blocker || 'BROWSER_RUNTIME_EXACT_HEAD_PROOF_FAILED',
      });
    }
    if (runtimeSourceHead !== browserRuntimeProof.runtimeSourceHead) {
      return Object.freeze({
        ok: false,
        required: true,
        blocker: 'BROWSER_PROOF_RUNTIME_HEAD_MISMATCH',
        expectedHead,
        runtimeSourceHead: browserRuntimeProof.runtimeSourceHead,
      });
    }
  }
  if (evidence.consoleErrors.length > 0) {
    return Object.freeze({ ok: false, required: true, blocker: 'BROWSER_PROOF_CONSOLE_ERRORS' });
  }
  if (!Array.isArray(payload.blockers) || payload.blockers.length > 0) {
    return Object.freeze({ ok: false, required: true, blocker: 'BROWSER_PROOF_BLOCKERS_REMAIN' });
  }
  return Object.freeze({
    ok: true,
    required: true,
    proofScenario: expectedScenario,
    expectedHead,
    runtimeSourceHead,
    evidence,
  });
}

export function runBrowserRuntimeExactHeadProof(task, {
  spawnSyncFn = spawnSync,
  runnerPath = resolve(fileURLToPath(new URL('./browser-proof-runner.mjs', import.meta.url))),
} = {}) {
  if (!task?.exactHeadProof) return Object.freeze({ ok: true, required: false });
  const expectedHead = String(task.exactHeadProof.expectedHead || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedHead)) {
    return Object.freeze({ ok: false, required: true, blocker: 'EXACT_HEAD_PROOF_INVALID' });
  }
  let execution;
  try {
    execution = spawnSyncFn(process.execPath, [
      runnerPath,
      '--url',
      CANONICAL_BROWSER_PROOF_URL,
      '--expected-head',
      expectedHead,
      '--no-artifacts',
      '--machine-json',
    ], {
      cwd: task.repoRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 120000,
    });
  } catch {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_RUNTIME_EXACT_HEAD_PROOF_FAILED',
      expectedHead,
      runtimeSourceHead: '',
    });
  }
  let payload = null;
  try {
    payload = JSON.parse(String(execution?.stdout || '').trim());
  } catch {}
  const runtimeUrl = String(payload?.url || '').trim();
  const observedRuntimeUrl = String(payload?.observedUrl || '').trim();
  const runtimeSourceHead = String(payload?.runtimeSourceHead || '').trim().toLowerCase();
  if (runtimeSourceHead && runtimeSourceHead !== expectedHead) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_PROOF_RUNTIME_HEAD_MISMATCH',
      expectedHead,
      runtimeSourceHead,
    });
  }
  if (
    runtimeUrl !== CANONICAL_BROWSER_PROOF_URL
    || observedRuntimeUrl !== CANONICAL_BROWSER_PROOF_URL
  ) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_RUNTIME_URL_MISMATCH',
      expectedHead,
      runtimeUrl,
      observedRuntimeUrl,
    });
  }
  if (
    execution?.error
    || execution?.status !== 0
    || payload?.schemaVersion !== 'stephanos.browser-runtime-exact-head-proof.v1'
    || payload?.accepted !== true
    || payload?.expectedHead !== expectedHead
    || payload?.expectedHeadMatch !== true
    || runtimeSourceHead !== expectedHead
  ) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_RUNTIME_EXACT_HEAD_PROOF_FAILED',
      expectedHead,
      runtimeSourceHead,
    });
  }
  return Object.freeze({
    ok: true,
    required: true,
    expectedHead,
    runtimeSourceHead,
    runtimeUrl,
    observedRuntimeUrl,
    schemaVersion: payload.schemaVersion,
  });
}

export function resolveCodexExecInvocation({
  platform = process.platform,
  env = process.env,
  lastMessagePath,
} = {}) {
  const codexCommand = String(env.STEPHANOS_CODEX_COMMAND || 'codex').trim();
  const codexArgs = [
    '--ask-for-approval', 'never',
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--sandbox', 'read-only',
    '--output-last-message', lastMessagePath,
    '-',
  ];
  if (platform === 'win32') {
    return Object.freeze({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', codexCommand, ...codexArgs],
      codexCommand,
      codexArgs,
    });
  }
  return Object.freeze({ command: codexCommand, args: codexArgs, codexCommand, codexArgs });
}

export function buildGuardedCodexPrompt(task) {
  const verdictContract = task.exactHeadProof
    ? `\nMACHINE-READABLE FINAL VERDICT\nReturn only one JSON object as your final message. It must use exactly this evidence shape:\n{"verdict":"PASS|FAIL","proofScenario":"${task.exactHeadProof.proofScenario}","evidence":{"runtimeSourceHead":"40-character Git Commit copied from the live Edge DOM","listeningDeckIframeIdentityPreserved":true|false,"discoveryIframeIdentityPreserved":true|false,"legacyRankingChanged":true|false,"consoleErrors":[]},"blockers":[]}\nPASS is forbidden unless runtimeSourceHead exactly equals ${task.exactHeadProof.expectedHead}, every boolean is true, and consoleErrors and blockers are explicitly empty arrays.`
    : '\nReturn a structured PASS/FAIL report with remaining blockers.';
  return `You are running as the guarded Stephanos Battle Bridge Codex proof worker.\n\nTASK\n${task.prompt}\n\nNON-NEGOTIABLE SAFETY\n- Work only in ${task.repoRoot}.\n- This is a proof and diagnostics task. Do not modify source files.\n- The child Codex run is read-only and non-interactive. Do not request approval.\n- User configuration is not loaded for this child run, so local MCP and app tools are unavailable by construction.\n- Do not call MCP tools, app tools, or dispatch another Codex task. Use bounded shell diagnostics only.\n- Do not create generated output unless the exact requested proof cannot be completed without it.\n- Do not push, merge, delete branches, run git reset --hard, expose secrets, enable public tunnels, or use broad process-kill commands.\n- Stop only positively identified Stephanos-owned processes.\n- Keep backend, OpenClaw, UI, and transport lifecycle truths separate.\n- Capture exact commands, results, browser evidence when available, and uncertainty.${verdictContract}\n\nREQUESTED PROOF COMMANDS\n${task.requestedProofCommands.length ? task.requestedProofCommands.map((command) => `- ${command}`).join('\n') : '- Use the exact bounded proof commands required by the task.'}\n`;
}

function streamToFile(stream, path) {
  const writer = createWriteStream(path, { flags: 'a', mode: 0o600 });
  stream?.pipe?.(writer);
  return writer;
}

function waitForWriter(writer, timeoutMs = 2000) {
  if (!writer || writer.writableFinished || writer.closed) return Promise.resolve();
  return new Promise((resolveWait) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolveWait();
    };
    writer.once('finish', settle);
    writer.once('close', settle);
    writer.once('error', settle);
    const timeout = setTimeout(settle, timeoutMs);
    timeout.unref?.();
  });
}

async function publishVisibilitySafely(publisher, task, snapshot) {
  try {
    return await publisher(task.workspaceRoot, {
      ...snapshot,
      jobId: task.jobId,
      taskId: task.taskId,
      issueNumber: task.issueNumber,
      proofRefs: task.proofRefs,
    }, { repoRoot: task.repoRoot });
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
}

export async function runCodexWorker(taskPath, {
  spawnFn = spawn,
  now = () => new Date().toISOString(),
  platform = process.platform,
  env = process.env,
  heartbeatIntervalMs = 15_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  visibilityPublisher = publishRemoteCodexTaskVisibility,
  spawnSyncFn = spawnSync,
} = {}) {
  const task = readJson(taskPath);
  if (task?.schemaVersion !== LOCAL_CODEX_TASK_SCHEMA) throw new Error('Unsupported local Codex task schema.');
  if (task?.taskType !== 'battle-bridge-proof') throw new Error(`Unsupported local Codex task type: ${task?.taskType || 'missing'}`);

  const taskRoot = dirname(taskPath);
  const statusPath = join(taskRoot, 'status.json');
  const resultPath = join(taskRoot, 'result.json');
  const stdoutPath = join(taskRoot, 'codex.stdout.jsonl');
  const stderrPath = join(taskRoot, 'codex.stderr.log');
  const lastMessagePath = join(taskRoot, 'codex-last-message.txt');
  const currentPath = join(dirname(dirname(taskRoot)), 'current.json');
  const exactHeadValidation = validateExactHeadAtWorkerStart(task, { spawnSyncFn, platform });
  if (!exactHeadValidation.ok) {
    const completedAt = now();
    const result = {
      ...task,
      kind: 'stephanos.codex_dispatch.local_result',
      status: 'BLOCKED',
      verdict: 'FAIL',
      resultAvailable: true,
      resultVerdict: 'FAIL',
      workerAlive: false,
      heartbeatUtc: completedAt,
      startedAt: completedAt,
      completedAt,
      exactHeadValidation,
      blocker: exactHeadValidation.blocker,
      nextOperatorAction: `Repair the exact-head blocker before retrying: ${exactHeadValidation.blocker}.`,
    };
    writeJson(resultPath, result);
    writeJson(statusPath, result);
    writeJson(currentPath, result);
    await publishVisibilitySafely(visibilityPublisher, task, result);
    return result;
  }
  const browserRuntimeProofBefore = runBrowserRuntimeExactHeadProof(task, { spawnSyncFn });
  if (!browserRuntimeProofBefore.ok) {
    const completedAt = now();
    const result = {
      ...task,
      kind: 'stephanos.codex_dispatch.local_result',
      status: 'BLOCKED',
      verdict: 'FAIL',
      resultAvailable: true,
      resultVerdict: 'FAIL',
      workerAlive: false,
      heartbeatUtc: completedAt,
      startedAt: completedAt,
      completedAt,
      exactHeadValidation,
      browserRuntimeProofBefore,
      blocker: browserRuntimeProofBefore.blocker,
      nextOperatorAction: `Repair the browser runtime exact-head blocker before retrying: ${browserRuntimeProofBefore.blocker}.`,
    };
    writeJson(resultPath, result);
    writeJson(statusPath, result);
    writeJson(currentPath, result);
    await publishVisibilitySafely(visibilityPublisher, task, result);
    return result;
  }
  const sourceHeadBefore = gitCapture(task.repoRoot, ['rev-parse', 'HEAD']);
  const statusBefore = gitCapture(task.repoRoot, ['status', '--porcelain=v1']);
  const dirtBefore = classifyPostTaskDirt(statusBefore.stdout);
  const startedAt = now();
  const invocation = resolveCodexExecInvocation({ platform, env, lastMessagePath });
  let running = {
    ...task,
    status: 'RUNNING',
    startedAt,
    heartbeatUtc: startedAt,
    workerAlive: true,
    resultAvailable: false,
    workerPid: process.pid,
    sourceHeadBefore: sourceHeadBefore.stdout,
    exactHeadValidation,
    browserRuntimeProofBefore,
    dirtBefore,
    executionPolicy: {
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
      ignoreUserConfig: true,
      nestedDispatchMcpEnabled: false,
      isolationMechanism: 'ignore-user-config',
    },
    invocation: {
      command: invocation.command,
      codexCommand: invocation.codexCommand,
      codexArgs: invocation.codexArgs,
    },
    logPaths: { stdoutPath, stderrPath, lastMessagePath },
  };
  writeJson(statusPath, running);
  writeJson(currentPath, running);
  const startedVisibility = await publishVisibilitySafely(visibilityPublisher, task, running);
  running = {
    ...running,
    visibilityPublication: {
      ok: startedVisibility.ok === true,
      reason: startedVisibility.reason || '',
    },
  };
  writeJson(statusPath, running);
  writeJson(currentPath, running);

  const prompt = buildGuardedCodexPrompt(task);
  let child;
  try {
    child = spawnFn(invocation.command, invocation.args, {
      cwd: resolve(task.repoRoot),
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    if (!child || typeof child.once !== 'function') throw new Error('Codex child process unavailable');
  } catch {
    const completedAt = now();
    const result = {
      ...task,
      kind: 'stephanos.codex_dispatch.local_result',
      status: 'FAILED',
      verdict: 'FAIL',
      resultAvailable: true,
      resultVerdict: 'FAIL',
      workerAlive: false,
      heartbeatUtc: completedAt,
      startedAt,
      completedAt,
      exactHeadValidation,
      browserRuntimeProofBefore,
      sourceHeadBefore: sourceHeadBefore.stdout,
      blocker: 'CODEX_CLI_STARTUP_FAILED',
      nextOperatorAction: 'Repair the local Codex CLI launch path, then submit a fresh bounded request.',
    };
    writeJson(resultPath, result);
    writeJson(statusPath, result);
    writeJson(currentPath, result);
    await publishVisibilitySafely(visibilityPublisher, task, result);
    return result;
  }
  const stdoutWriter = streamToFile(child.stdout, stdoutPath);
  const stderrWriter = streamToFile(child.stderr, stderrPath);
  child.stdin?.end?.(prompt);

  let heartbeatChain = Promise.resolve();
  const queueHeartbeat = () => {
    heartbeatChain = heartbeatChain.then(async () => {
      let stdoutEvents = '';
      try { stdoutEvents = readFileSync(stdoutPath, 'utf8'); } catch {}
      const parsedEvents = parseCodexJsonEvents(stdoutEvents);
      const heartbeatUtc = now();
      running = {
        ...running,
        heartbeatUtc,
        workerAlive: true,
        codexThreadId: extractCodexThreadId(parsedEvents.events),
        eventCount: parsedEvents.events.length,
      };
      writeJson(statusPath, running);
      writeJson(currentPath, running);
      const publication = await publishVisibilitySafely(visibilityPublisher, task, {
        ...running,
        events: parsedEvents.events,
      });
      running = {
        ...running,
        visibilityPublication: {
          ok: publication.ok === true,
          reason: publication.reason || '',
        },
      };
      writeJson(statusPath, running);
      writeJson(currentPath, running);
    }).catch(() => {});
    return heartbeatChain;
  };
  const heartbeatTimer = Number.isFinite(heartbeatIntervalMs) && heartbeatIntervalMs > 0
    ? setIntervalFn(() => { void queueHeartbeat(); }, heartbeatIntervalMs)
    : null;
  heartbeatTimer?.unref?.();

  const exit = await new Promise((resolveExit) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolveExit(value);
    };
    child.once?.('error', (error) => settle({ code: null, signal: null, error: error?.message || String(error) }));
    child.once?.('exit', (code, signal) => settle({ code, signal, error: '' }));
  });
  if (heartbeatTimer) clearIntervalFn(heartbeatTimer);
  await heartbeatChain;
  await Promise.all([waitForWriter(stdoutWriter), waitForWriter(stderrWriter)]);

  const completedAt = now();
  const sourceHeadAfter = gitCapture(task.repoRoot, ['rev-parse', 'HEAD']);
  const statusAfter = gitCapture(task.repoRoot, ['status', '--porcelain=v1']);
  const dirtAfter = classifyPostTaskDirt(statusAfter.stdout);
  const dirtDelta = compareDirtSnapshots(dirtBefore, dirtAfter);
  let lastMessage = '';
  let stdoutEvents = '';
  let stderrText = '';
  try { lastMessage = readFileSync(lastMessagePath, 'utf8').trim(); } catch {}
  try { stdoutEvents = readFileSync(stdoutPath, 'utf8'); } catch {}
  try { stderrText = readFileSync(stderrPath, 'utf8'); } catch {}
  const parsedEvents = parseCodexJsonEvents(stdoutEvents);
  const execution = classifyCodexExecution({
    exit,
    events: parsedEvents.events,
    lastMessage,
    stderr: stderrText,
  });
  const browserRuntimeProofAfter = runBrowserRuntimeExactHeadProof(task, { spawnSyncFn });
  const browserProof = validateBrowserProofVerdict(lastMessage, task, browserRuntimeProofAfter);
  const sourceTreeProof = validateExactHeadSourceTree(task, statusBefore, statusAfter, dirtBefore, dirtAfter);
  const sourceHeadUnchanged = sourceHeadBefore.ok && sourceHeadAfter.ok && sourceHeadBefore.stdout === sourceHeadAfter.stdout;
  const expectedHead = exactHeadValidation.required ? exactHeadValidation.expectedHead : '';
  const sourceHeadBound = !exactHeadValidation.required
    || (sourceHeadBefore.stdout === expectedHead && sourceHeadAfter.stdout === expectedHead);
  const sourceSafe = sourceHeadUnchanged && sourceHeadBound && sourceTreeProof.ok && !dirtDelta.sourceMutationDetected;
  const passed = execution.passed && browserProof.ok && sourceSafe;
  const finalStatus = passed ? 'DONE' : (sourceSafe ? 'FAILED' : 'BLOCKED');
  let result = {
    schemaVersion: LOCAL_CODEX_TASK_SCHEMA,
    kind: 'stephanos.codex_dispatch.local_result',
    taskId: task.taskId,
    jobId: task.jobId,
    issueNumber: task.issueNumber,
    status: finalStatus,
    verdict: passed ? 'PASS' : 'FAIL',
    resultAvailable: true,
    resultVerdict: passed ? 'PASS' : 'FAIL',
    workerAlive: false,
    heartbeatUtc: completedAt,
    codexThreadId: extractCodexThreadId(parsedEvents.events),
    startedAt,
    completedAt,
    sourceHeadBefore: sourceHeadBefore.stdout,
    sourceHeadAfter: sourceHeadAfter.stdout,
    sourceHeadUnchanged,
    sourceHeadBound,
    browserRuntimeProofBefore,
    browserRuntimeProofAfter,
    sourceTreeProof,
    browserProof,
    exit,
    execution,
    eventParsing: {
      eventCount: parsedEvents.events.length,
      invalidLineCount: parsedEvents.invalidLines.length,
      invalidLines: parsedEvents.invalidLines,
    },
    invocation: {
      command: invocation.command,
      codexCommand: invocation.codexCommand,
      codexArgs: invocation.codexArgs,
    },
    dirtBefore,
    dirtAfter,
    dirtDelta,
    lastMessage,
    logs: {
      stdout: basename(stdoutPath),
      stderr: basename(stderrPath),
      lastMessage: basename(lastMessagePath),
      stderrExcerpt: execution.stderrExcerpt,
    },
    safety: {
      mergePerformed: false,
      pushPerformed: false,
      sourceMutationDetected: dirtDelta.sourceMutationDetected,
      generatedRuntimeMutationDetected: dirtDelta.generatedRuntimeMutationDetected,
      preExistingSourceDirt: dirtDelta.preExistingSourceDirt,
      sourceHeadChanged: !sourceHeadUnchanged,
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
      nestedDispatchMcpEnabled: false,
      isolationMechanism: 'ignore-user-config',
    },
    nextOperatorAction: passed
      ? 'Review the returned proof and decide whether the owning goal may advance.'
      : (!sourceSafe
        ? 'Inspect the task logs and source dirt. Do not auto-discard changes.'
        : `Inspect the task logs and repair the precise runtime blocker: ${browserProof.blocker || execution.reason || 'CODEX_EXEC_FAILED'}.`),
  };
  writeJson(resultPath, result);
  writeJson(statusPath, result);
  writeJson(currentPath, result);
  const finalVisibility = await publishVisibilitySafely(visibilityPublisher, task, {
    ...result,
    events: parsedEvents.events,
    sourceHead: sourceHeadAfter.stdout || sourceHeadBefore.stdout,
  });
  result = {
    ...result,
    visibilityPublication: {
      ok: finalVisibility.ok === true,
      reason: finalVisibility.reason || '',
    },
  };
  writeJson(resultPath, result);
  writeJson(statusPath, result);
  writeJson(currentPath, result);
  return result;
}

function taskArg(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--task');
  return index >= 0 ? argv[index + 1] : '';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const taskPath = taskArg();
  if (!taskPath) {
    console.error('Usage: node scripts/stephanos-codex-dispatch-worker.mjs --task <task.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = await runCodexWorker(taskPath);
      process.exitCode = result.verdict === 'PASS' ? 0 : 1;
    } catch (error) {
      console.error(error?.stack || error?.message || String(error));
      process.exitCode = 1;
    }
  }
}
