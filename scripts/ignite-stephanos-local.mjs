import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readLocalBuildState, probeExistingLocalServer } from './stephanos-ignition-preflight.mjs';
import { runIgnitionPlan } from './ignite-stephanos-local-lib.mjs';

const args = new Set(process.argv.slice(2));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function formatStep(label, command, commandArgs) {
  return `[IGNITION PREFLIGHT] ${label}: ${command} ${commandArgs.join(' ')}`;
}

function isWindowsNpmCommand(command, platform = process.platform) {
  if (platform !== 'win32') {
    return false;
  }

  return /(^|[\\/])npm(?:\.cmd)?$/i.test(command);
}

function quoteWindowsCmdArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function escapeWindowsCmdToken(value) {
  const token = String(value);
  const escapedMeta = token.replace(/([&|<>()^])/g, '^$1');

  if (/\s/.test(escapedMeta) || escapedMeta.includes('"')) {
    return quoteWindowsCmdArg(escapedMeta);
  }

  return escapedMeta;
}

export function resolveStepExecution(command, commandArgs, platform = process.platform) {
  if (isWindowsNpmCommand(command, platform)) {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    const npmInvocation = command.toLowerCase().endsWith('.cmd') ? command.slice(0, -4) : command;
    const commandLine = [npmInvocation, ...commandArgs].map(escapeWindowsCmdToken).join(' ');
    return {
      command: comspec,
      commandArgs: ['/d', '/s', '/c', commandLine],
      mode: 'windows-cmd-wrapper',
    };
  }

  return {
    command,
    commandArgs,
    mode: 'direct',
  };
}

function runStep(label, command, commandArgs) {
  console.log(formatStep(label, command, commandArgs));
  const execution = resolveStepExecution(command, commandArgs);
  const result = spawnSync(execution.command, execution.commandArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  if (result.error || result.status !== 0) {
    const details = [
      `executionMode=${execution.mode}`,
      `command=${execution.command}`,
      `args=${JSON.stringify(execution.commandArgs)}`,
      `status=${result.status ?? 'null'}`,
      `signal=${result.signal ?? 'null'}`,
      `error=${result.error ? result.error.message : 'null'}`,
    ].join(', ');
    throw new Error(`${label} failed (${details})`);
  }
}

function runStepCapture(label, command, commandArgs) {
  console.log(formatStep(label, command, commandArgs));
  const execution = resolveStepExecution(command, commandArgs);
  const result = spawnSync(execution.command, execution.commandArgs, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  if (result.error || result.status !== 0) {
    const details = [
      `executionMode=${execution.mode}`,
      `command=${execution.command}`,
      `args=${JSON.stringify(execution.commandArgs)}`,
      `status=${result.status ?? 'null'}`,
      `signal=${result.signal ?? 'null'}`,
      `error=${result.error ? result.error.message : 'null'}`,
      `stderr=${JSON.stringify(result.stderr || '')}`,
    ].join(', ');
    throw new Error(`${label} failed (${details})`);
  }

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

export function isGitWorkingTreeClean(statusOutput) {
  return evaluateGitStatusForIgnition(statusOutput).meaningfulEntries.length === 0;
}

export function shouldAutoPull(argvArgs = args) {
  return !argvArgs.has('--skip-auto-pull');
}

const APPROVED_LOCAL_DIR_PREFIXES = [
  'node_modules/',
  'stephanos-server/node_modules/',
  'stephanos-ui/node_modules/',
  'apps/stephanos/dist/',
];

const APPROVED_LOCAL_FILE_PATHS = new Set([
  'package-lock.json',
  'stephanos-server/package-lock.json',
  'stephanos-ui/package-lock.json',
]);

function normalizeGitPath(rawPath) {
  const trimmed = String(rawPath || '').trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isApprovedLocalDirtPath(path) {
  if (APPROVED_LOCAL_FILE_PATHS.has(path)) {
    return true;
  }

  return APPROVED_LOCAL_DIR_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function parsePorcelainStatusLine(line) {
  const status = line.slice(0, 2);
  const pathSegment = line.slice(3).trim();
  const rawPaths = pathSegment.includes(' -> ') ? pathSegment.split(' -> ') : [pathSegment];
  const paths = rawPaths.map(normalizeGitPath).filter(Boolean);
  return { status, paths, rawLine: line };
}

export function evaluateGitStatusForIgnition(statusOutput) {
  const lines = String(statusOutput || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  const entries = lines.map(parsePorcelainStatusLine);
  const approvedEntries = [];
  const meaningfulEntries = [];

  for (const entry of entries) {
    const approved = entry.paths.every((path) => isApprovedLocalDirtPath(path));
    if (approved) {
      approvedEntries.push(entry);
    }
    else {
      meaningfulEntries.push(entry);
    }
  }

  return {
    entries,
    approvedEntries,
    meaningfulEntries,
  };
}

function runGitPullPreflight() {
  console.log('[IGNITION] git status check starting');
  const statusResult = runStepCapture('git-status', 'git', ['status', '--porcelain']);
  const statusAssessment = evaluateGitStatusForIgnition(statusResult.stdout);

  if (statusAssessment.approvedEntries.length > 0) {
    console.log(`[IGNITION] approved local dirt ignored (${statusAssessment.approvedEntries.length} entries)`);
    for (const entry of statusAssessment.approvedEntries) {
      console.log(`[IGNITION] approved local dirt: ${entry.status} ${entry.paths.join(' -> ')}`);
    }
  }

  if (statusAssessment.meaningfulEntries.length > 0) {
    console.error('[IGNITION] meaningful local dirt detected');
    for (const entry of statusAssessment.meaningfulEntries) {
      console.error(`[IGNITION] meaningful local dirt: ${entry.status} ${entry.paths.join(' -> ')}`);
    }
    console.error('[IGNITION] git pull blocked');
    throw new Error('blocked for safety: local working tree is dirty. Commit/stash/discard local changes before ignition can pull latest remote changes.');
  }

  console.log('[IGNITION] git status clean');
  console.log('[IGNITION] git fetch starting');
  runStep('git-fetch', 'git', ['fetch', '--prune', '--tags']);
  console.log('[IGNITION] git fetch passed');

  console.log('[IGNITION] git pull --ff-only starting');
  try {
    runStep('git-pull-ff-only', 'git', ['pull', '--ff-only']);
  }
  catch (error) {
    console.error('[IGNITION] git pull blocked');
    throw new Error(`blocked for safety: remote pull requires manual merge/rebase or has another fast-forward-only conflict (${error.message}).`);
  }

  console.log('[IGNITION] git pull passed');
}

function printPreflightSummary({ decision, expectedMetadata, distMetadata, buildAction, verifyResult, processResult, finalResult }) {
  console.log('[IGNITION PREFLIGHT] --- summary ---');
  console.log(`[IGNITION PREFLIGHT] source fingerprint: ${expectedMetadata.sourceFingerprint}`);
  console.log(`[IGNITION PREFLIGHT] source marker: ${expectedMetadata.runtimeMarker}`);
  console.log(`[IGNITION PREFLIGHT] dist marker: ${distMetadata?.runtimeMarker || 'missing'}`);
  console.log(`[IGNITION PREFLIGHT] parity state: ${decision.state} (${decision.reason})`);
  console.log(`[IGNITION PREFLIGHT] build action: ${buildAction}`);
  console.log(`[IGNITION PREFLIGHT] verify result: ${verifyResult}`);
  console.log(`[IGNITION PREFLIGHT] process reuse: ${processResult}`);
  console.log(`[IGNITION PREFLIGHT] final launch: ${finalResult}`);
}

export async function run() {
  const preflightState = readLocalBuildState();
  const autoPullEnabled = shouldAutoPull();

  if (args.has('--probe-existing-server')) {
    const probe = await probeExistingLocalServer({
      expectedRuntimeMarker: preflightState.expectedMetadata.runtimeMarker,
    });

    if (probe.reusable) {
      console.log('[IGNITION PREFLIGHT] Existing localhost dist server is current; safe to reuse.');
      process.exit(0);
      return;
    }

    console.error('[IGNITION PREFLIGHT] Existing localhost dist server is stale/untrusted; replacement required.');
    if (probe.observedMarkers) {
      console.error(`[IGNITION PREFLIGHT] expected marker=${probe.observedMarkers.expected || 'missing'}`);
      console.error(`[IGNITION PREFLIGHT] observed health marker=${probe.observedMarkers.health || 'missing'}`);
      console.error(`[IGNITION PREFLIGHT] observed served marker=${probe.observedMarkers.servedIndex || 'missing'}`);
    }
    if (probe.mismatches?.length) {
      console.error(`[IGNITION PREFLIGHT] launcher source mismatches=${probe.mismatches.join(', ')}`);
    }
    process.exit(1);
    return;
  }

  let buildAction = 'required pre-flight build (always-run policy)';
  let verifyResult = 'not-run';

  await runIgnitionPlan({
    preflightState,
    runPreflight: async () => {
      if (autoPullEnabled) {
        runGitPullPreflight();
      }
      else {
        console.log('[IGNITION] git auto-pull skipped (--skip-auto-pull)');
      }

      console.log('[IGNITION] launcher guardrail starting');
      try {
        runStep('guard-launcher-scripts', npmCommand, ['run', 'stephanos:guard:scripts']);
      }
      catch (error) {
        throw new Error(`blocked for safety: guardrail failed (${error.message}).`);
      }
      console.log('[IGNITION] launcher guardrail passed');
    },
    runBuild: async () => {
      console.log('[IGNITION] build starting');
      try {
        runStep('build', npmCommand, ['run', 'stephanos:build']);
      }
      catch (error) {
        throw new Error(`blocked for safety: build failed (${error.message}).`);
      }
      buildAction = `passed (${preflightState.decision.state})`;
      console.log('[IGNITION] build passed');
    },
    runVerify: async () => {
      console.log('[IGNITION] verify starting');
      try {
        runStep('verify', npmCommand, ['run', 'stephanos:verify']);
      }
      catch (error) {
        throw new Error(`blocked for safety: verify failed (${error.message}).`);
      }
      verifyResult = 'passed';
      console.log('[IGNITION] verify passed');
    },
    runServe: async () => {
      console.log('[IGNITION] launch continuing');
      const refreshedState = readLocalBuildState();
      printPreflightSummary({
        ...refreshedState,
        buildAction,
        verifyResult,
        processResult: 'delegated to dist server launch handoff',
        finalResult: 'starting dist server',
      });
      runStep('serve', process.execPath, ['scripts/serve-stephanos-dist.mjs']);
    },
  });
}

export function isMainModule(argv = process.argv, metaUrl = import.meta.url) {
  if (!argv?.[1]) {
    return false;
  }

  return metaUrl === pathToFileURL(resolve(argv[1])).href;
}

if (isMainModule()) {
  run().catch((error) => {
    console.error('[IGNITION] launch blocked');
    console.error(`[IGNITION PREFLIGHT] failed: ${error.message}`);
    process.exit(1);
  });
}
