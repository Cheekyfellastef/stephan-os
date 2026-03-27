import { spawnSync } from 'node:child_process';
import { readLocalBuildState, probeExistingLocalServer } from './stephanos-ignition-preflight.mjs';
import { runIgnitionPlan } from './ignite-stephanos-local-lib.mjs';

const args = new Set(process.argv.slice(2));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runStep(label, command, commandArgs) {
  console.log(`[IGNITION PREFLIGHT] ${label}: ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
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

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  run().catch((error) => {
    console.error(`[IGNITION PREFLIGHT] failed: ${error.message}`);
    process.exit(1);
  });
}
