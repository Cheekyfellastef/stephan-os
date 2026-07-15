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

export function parseGitStatusPaths(output = '') {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const pathText = line.length > 3 ? line.slice(3).trim() : '';
      if (!pathText) return [];
      return pathText.split(' -> ').map((item) => item.replace(/^"|"$/g, '').replace(/\\/g, '/'));
    });
}

export function classifyPostTaskDirt(output = '') {
  const paths = [...new Set(parseGitStatusPaths(output))];
  const generated = paths.filter((path) => APPROVED_GENERATED_PREFIXES.some((prefix) => path.startsWith(prefix)));
  const source = paths.filter((path) => !generated.includes(path));
  return Object.freeze({ paths, generated, source, safe: source.length === 0 });
}

export function resolveCodexExecInvocation({
  platform = process.platform,
  env = process.env,
  lastMessagePath,
} = {}) {
  const codexCommand = String(env.STEPHANOS_CODEX_COMMAND || 'codex').trim();
  const codexArgs = ['exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '--output-last-message', lastMessagePath, '-'];
  if (platform === 'win32') {
    return Object.freeze({ command: 'cmd.exe', args: ['/d', '/s', '/c', codexCommand, ...codexArgs], codexCommand, codexArgs });
  }
  return Object.freeze({ command: codexCommand, args: codexArgs, codexCommand, codexArgs });
}

export function buildGuardedCodexPrompt(task) {
  return `You are running as the guarded Stephanos Battle Bridge Codex proof worker.\n\nTASK\n${task.prompt}\n\nNON-NEGOTIABLE SAFETY\n- Work only in ${task.repoRoot}.\n- This is a proof and diagnostics task. Do not modify source files.\n- Generated apps/stephanos/dist output may change only when the existing source-controlled build or ignition path requires it.\n- Do not push, merge, delete branches, run git reset --hard, expose secrets, enable public tunnels, or use broad process-kill commands.\n- Stop only positively identified Stephanos-owned processes.\n- Keep backend, OpenClaw, UI, and transport lifecycle truths separate.\n- Capture exact commands, results, browser evidence when available, and uncertainty.\n- Return a structured PASS/FAIL report with remaining blockers.\n\nREQUESTED PROOF COMMANDS\n${task.requestedProofCommands.length ? task.requestedProofCommands.map((command) => `- ${command}`).join('\n') : '- Use the exact bounded proof commands required by the task.'}\n`;
}

function streamToFile(stream, path) {
  const writer = createWriteStream(path, { flags: 'a', mode: 0o600 });
  stream?.pipe?.(writer);
  return writer;
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
  const startedAt = now();
  const running = {
    ...task,
    status: 'RUNNING',
    startedAt,
    workerPid: process.pid,
    sourceHeadBefore: sourceHeadBefore.stdout,
    dirtBefore: classifyPostTaskDirt(statusBefore.stdout),
    logPaths: { stdoutPath, stderrPath, lastMessagePath },
  };
  writeJson(statusPath, running);
  writeJson(currentPath, running);

  const invocation = resolveCodexExecInvocation({ platform, env, lastMessagePath });
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
  stdoutWriter.end();
  stderrWriter.end();

  const completedAt = now();
  const sourceHeadAfter = gitCapture(task.repoRoot, ['rev-parse', 'HEAD']);
  const statusAfter = gitCapture(task.repoRoot, ['status', '--porcelain=v1']);
  const dirtAfter = classifyPostTaskDirt(statusAfter.stdout);
  let lastMessage = '';
  try { lastMessage = readFileSync(lastMessagePath, 'utf8').trim(); } catch {}
  const sourceHeadUnchanged = sourceHeadBefore.ok && sourceHeadAfter.ok && sourceHeadBefore.stdout === sourceHeadAfter.stdout;
  const exitPassed = exit.code === 0 && !exit.error;
  const passed = exitPassed && sourceHeadUnchanged && dirtAfter.safe;
  const finalStatus = passed ? 'DONE' : (dirtAfter.safe && sourceHeadUnchanged ? 'FAILED' : 'BLOCKED');
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
    dirtBefore: classifyPostTaskDirt(statusBefore.stdout),
    dirtAfter,
    lastMessage,
    logs: {
      stdout: basename(stdoutPath),
      stderr: basename(stderrPath),
      lastMessage: basename(lastMessagePath),
    },
    safety: {
      mergePerformed: false,
      pushPerformed: false,
      sourceMutationDetected: !dirtAfter.safe,
      sourceHeadChanged: !sourceHeadUnchanged,
    },
    nextOperatorAction: passed
      ? 'Review the returned proof and decide whether the owning goal may advance.'
      : (!sourceHeadUnchanged || !dirtAfter.safe
        ? 'Inspect the task logs and source dirt. Do not auto-discard changes.'
        : 'Inspect the task logs and repair the precise runtime blocker before retrying.'),
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
