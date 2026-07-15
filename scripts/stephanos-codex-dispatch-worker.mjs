#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_CODEX_TASK_SCHEMA } from '../shared/agents/localCodexExecIntegration.mjs';

const APPROVED_GENERATED_PREFIXES = Object.freeze([
  'apps/stephanos/dist/',
]);

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

export function resolveCodexExecInvocation({
  platform = process.platform,
  env = process.env,
  lastMessagePath,
} = {}) {
  const codexCommand = String(env.STEPHANOS_CODEX_COMMAND || 'codex').trim();
  const codexArgs = [
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--sandbox', 'read-only',
    '--ask-for-approval', 'never',
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
  return `You are running as the guarded Stephanos Battle Bridge Codex proof worker.\n\nTASK\n${task.prompt}\n\nNON-NEGOTIABLE SAFETY\n- Work only in ${task.repoRoot}.\n- This is a proof and diagnostics task. Do not modify source files.\n- The child Codex run is read-only and non-interactive. Do not request approval.\n- User configuration is not loaded for this child run, so local MCP and app tools are unavailable by construction.\n- Do not call MCP tools, app tools, or dispatch another Codex task. Use bounded shell diagnostics only.\n- Do not create generated output unless the exact requested proof cannot be completed without it.\n- Do not push, merge, delete branches, run git reset --hard, expose secrets, enable public tunnels, or use broad process-kill commands.\n- Stop only positively identified Stephanos-owned processes.\n- Keep backend, OpenClaw, UI, and transport lifecycle truths separate.\n- Capture exact commands, results, browser evidence when available, and uncertainty.\n- Return a structured PASS/FAIL report with remaining blockers.\n\nREQUESTED PROOF COMMANDS\n${task.requestedProofCommands.length ? task.requestedProofCommands.map((command) => `- ${command}`).join('\n') : '- Use the exact bounded proof commands required by the task.'}\n`;
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

export async function runCodexWorker(taskPath, {
  spawnFn = spawn,
  now = () => new Date().toISOString(),
  platform = process.platform,
  env = process.env,
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
  const sourceHeadBefore = gitCapture(task.repoRoot, ['rev-parse', 'HEAD']);
  const statusBefore = gitCapture(task.repoRoot, ['status', '--porcelain=v1']);
  const dirtBefore = classifyPostTaskDirt(statusBefore.stdout);
  const startedAt = now();
  const invocation = resolveCodexExecInvocation({ platform, env, lastMessagePath });
  const running = {
    ...task,
    status: 'RUNNING',
    startedAt,
    workerPid: process.pid,
    sourceHeadBefore: sourceHeadBefore.stdout,
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

  const prompt = buildGuardedCodexPrompt(task);
  const child = spawnFn(invocation.command, invocation.args, {
    cwd: resolve(task.repoRoot),
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
  const stdoutWriter = streamToFile(child.stdout, stdoutPath);
  const stderrWriter = streamToFile(child.stderr, stderrPath);
  child.stdin?.end?.(prompt);

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
  const sourceHeadUnchanged = sourceHeadBefore.ok && sourceHeadAfter.ok && sourceHeadBefore.stdout === sourceHeadAfter.stdout;
  const sourceSafe = sourceHeadUnchanged && !dirtDelta.sourceMutationDetected;
  const passed = execution.passed && sourceSafe;
  const finalStatus = passed ? 'DONE' : (sourceSafe ? 'FAILED' : 'BLOCKED');
  const result = {
    schemaVersion: LOCAL_CODEX_TASK_SCHEMA,
    kind: 'stephanos.codex_dispatch.local_result',
    taskId: task.taskId,
    jobId: task.jobId,
    issueNumber: task.issueNumber,
    status: finalStatus,
    verdict: passed ? 'PASS' : 'FAIL',
    startedAt,
    completedAt,
    sourceHeadBefore: sourceHeadBefore.stdout,
    sourceHeadAfter: sourceHeadAfter.stdout,
    sourceHeadUnchanged,
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
        : `Inspect the task logs and repair the precise runtime blocker: ${execution.reason || 'CODEX_EXEC_FAILED'}.`),
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
