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

export function resolveStepExecution(command, commandArgs, platform = process.platform) {
  if (isWindowsNpmCommand(command, platform)) {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    const commandLine = [command, ...commandArgs].map(quoteWindowsCmdArg).join(' ');
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

  let buildAction = `skipped (${preflightState.decision.reason})`;
  let verifyResult = 'not-run';

  await runIgnitionPlan({
    preflightState,
    runBuild: async () => {
      buildAction = `rebuilt (${preflightState.decision.state})`;
      runStep('build', npmCommand, ['run', 'stephanos:build']);
    },
    runVerify: async () => {
      runStep('verify', npmCommand, ['run', 'stephanos:verify']);
      verifyResult = 'passed';
    },
    runServe: async () => {
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
    console.error(`[IGNITION PREFLIGHT] failed: ${error.message}`);
    process.exit(1);
  });
}
