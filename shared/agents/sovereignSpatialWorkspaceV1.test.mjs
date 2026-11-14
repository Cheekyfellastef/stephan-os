import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPATIAL_PREPARE_ACTION, SPATIAL_PREPARE_SCHEMA, SPATIAL_PREPARE_MARKER,
  SPATIAL_PREPARE_FLAGS, parseSpatialPreparationArgumentsV1,
  parseSpatialPreparationOutputV1, projectSpatialPreparationReceiptV1,
  spatialPrepareBlockedV1, runSpatialPreparationV1,
} from './sovereignSpatialWorkspaceV1.mjs';
import { spatialPreparationProductionAdaptersV1 } from '../../scripts/sovereign-commander-spatial-workspace.mjs';
import { buildSovereignCommanderCommandV1, SOVEREIGN_COMMANDER_OPERATION } from './sovereignCommanderV1.mjs';
import { buildStephanosExecutionCommandEnvelopeV1, buildStephanosExecutionSurfaceCatalogV1,
  STEPHANOS_EXECUTION_SURFACE } from './stephanosExecutionCommandFabricV1.mjs';
import { isSovereignMaintenanceObservationV1, readSovereignMaintenanceTerminalReceiptV1,
  sovereignMaintenanceCustodyUnprovenV1 } from './sovereignMaintenanceAdmissionV1.mjs';

const HEAD = 'a'.repeat(40);
const ROOT = '/trusted/stephan-os';
function ready(extra = {}) {
  return { schemaVersion: SPATIAL_PREPARE_SCHEMA, actionId: SPATIAL_PREPARE_ACTION,
    sourceHead: HEAD, buildId: 'b'.repeat(64), ok: true, blocker: '',
    installationVerified: true, uiReady: true, helperProbePassed: true, nativeProbePassed: true,
    existingHostPreserved: false, createdProbeStopped: true, hostRunningAfter: false,
    mutationAttempted: true, readyForOperatorLaunch: true,
    interactiveAcceptance: false, voiceAcceptance: false, headsetAcceptance: false, ...extra };
}
const output = row => `${SPATIAL_PREPARE_MARKER}${JSON.stringify(row)}\n`;
function options(overrides = {}) {
  return { expectedMain: HEAD, platform: 'win32',
    observeSource: () => ({ ok: true, head: HEAD, branch: 'main' }),
    gamingAdmission: () => ({ ok: true }),
    runWindowsPreparation: () => ({ status: 0, stdout: output(ready()) }), ...overrides };
}
function envelope(payload, operation = SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION) {
  return buildStephanosExecutionCommandEnvelopeV1({
    catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: ROOT }),
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
    actionId: 'spatial-prepare-test', missionId: 'original-1717', operation, targetPaths: [], payload,
  });
}

test('Spatial preparation admits only its fixed action and exact source binding', () => {
  const result = buildSovereignCommanderCommandV1(envelope({ actionId: SPATIAL_PREPARE_ACTION, expectedMain: HEAD }), { repoRoot: ROOT });
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.plan.expectedMain, HEAD);
  assert.deepEqual(result.plan.args.slice(-2), ['--expected-main', HEAD]);
  assert.match(result.plan.args[0], /scripts\/sovereign-commander-spatial-workspace.mjs$/);
  assert.equal(result.plan.timeoutMs, 240000);
  assert.equal(isSovereignMaintenanceObservationV1(SPATIAL_PREPARE_ACTION), false);
  for (const payload of [
    { actionId: SPATIAL_PREPARE_ACTION },
    { actionId: SPATIAL_PREPARE_ACTION, expectedMain: true },
    { actionId: SPATIAL_PREPARE_ACTION, expectedMain: HEAD, command: 'unrestricted shell' },
    { actionId: SPATIAL_PREPARE_ACTION, expectedMain: HEAD, path: '/other' },
    { actionId: SPATIAL_PREPARE_ACTION, expectedMain: `${HEAD};danger` },
  ]) assert.equal(buildSovereignCommanderCommandV1(envelope(payload), { repoRoot: ROOT }).dispatchAllowed, false);
  const generic = envelope({ processId: SPATIAL_PREPARE_ACTION, expectedMain: HEAD }, SOVEREIGN_COMMANDER_OPERATION.START_PROCESS);
  assert.equal(buildSovereignCommanderCommandV1(generic, { repoRoot: ROOT }).dispatchAllowed, false);
});

test('CLI rejects added modes, paths, duplicate arguments and shell-bearing heads', () => {
  assert.deepEqual(parseSpatialPreparationArgumentsV1(['--expected-main', HEAD]), { ok: true, expectedMain: HEAD });
  for (const args of [[], ['--expected-main', HEAD, '--start'], ['--expected-main', HEAD, '--expected-main', HEAD],
    ['--expected-main', `${HEAD}\nrun`], ['--path', ROOT], ['--expected-main', 123]]) {
    assert.equal(parseSpatialPreparationArgumentsV1(args).ok, false);
  }
});

test('preparation yields launch readiness and never fabricates interactive or headset acceptance', async () => {
  const result = await runSpatialPreparationV1(options());
  assert.equal(result.ok, true);
  assert.equal(result.readyForOperatorLaunch, true);
  assert.equal(result.hostRunningAfter, false);
  for (const key of ['interactiveAcceptance', 'voiceAcceptance', 'headsetAcceptance']) assert.equal(result[key], false);
  const preserved = { ...spatialPrepareBlockedV1(HEAD, 'SPATIAL_PREPARE_PORT_OCCUPIED'),
    buildId: 'b'.repeat(64), existingHostPreserved: true, hostRunningAfter: true };
  assert.deepEqual(parseSpatialPreparationOutputV1(output(preserved), HEAD), preserved);
  assert.equal(projectSpatialPreparationReceiptV1(ready({ existingHostPreserved: true, hostRunningAfter: true }), HEAD), null);
  assert.equal(projectSpatialPreparationReceiptV1(ready({ mutationAttempted: false }), HEAD), null);
});

test('an unproved child stop cannot also claim completed probe cleanup', () => {
  const held = spatialPrepareBlockedV1(HEAD, 'SPATIAL_PREPARE_PROBE_STOP_UNPROVEN', { mutationAttempted: true });
  assert.ok(projectSpatialPreparationReceiptV1(held, HEAD));
  assert.ok(projectSpatialPreparationReceiptV1(spatialPrepareBlockedV1(HEAD, 'SPATIAL_PREPARE_PROBE_STOP_UNPROVEN'), HEAD));
  assert.equal(projectSpatialPreparationReceiptV1({ ...held, createdProbeStopped: true }, HEAD), null);
});

test('failed admission never calls the Windows preparation process', async () => {
  for (const override of [
    { expectedMain: 'bad' }, { platform: 'linux' },
    { observeSource: () => ({ ok: true, head: 'c'.repeat(40), branch: 'main' }) },
    { observeSource: () => ({ ok: true, head: HEAD, branch: 'candidate' }) },
    { observeSource: () => ({ ok: 'true', head: HEAD, branch: 'main' }) },
    { observeSource: () => { throw new Error('PRIVATE_PATH'); } },
    { gamingAdmission: () => ({ ok: false }) }, { gamingAdmission: () => ({ ok: 'true' }) },
    { gamingAdmission: () => { throw new Error('PRIVATE_GOVERNOR'); } },
  ]) {
    let calls = 0;
    const result = await runSpatialPreparationV1(options({ ...override, runWindowsPreparation: () => { calls += 1; throw new Error('unexpected'); } }));
    assert.equal(result.ok, false);
    assert.equal(result.mutationAttempted, false);
    assert.equal(calls, 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PATH|PRIVATE_GOVERNOR/);
  }
});

test('receipt validation rejects partial success, wrong identity and claimed live interaction', () => {
  const changes = [
    { sourceHead: 'c'.repeat(40) }, { buildId: '' }, { actionId: 'repair-goal-builder-flow' },
    { schemaVersion: 'foreign' }, { blocker: 'SPATIAL_PREPARE_FAILED' },
    { installationVerified: false }, { uiReady: false }, { helperProbePassed: false },
    { nativeProbePassed: false }, { createdProbeStopped: false }, { readyForOperatorLaunch: false },
    { hostRunningAfter: true }, { existingHostPreserved: true },
    { interactiveAcceptance: true }, { voiceAcceptance: true }, { headsetAcceptance: true },
    { rawWindows: ['PRIVATE_WINDOW_TITLE'] },
  ];
  for (const change of changes) assert.equal(projectSpatialPreparationReceiptV1(ready(change), HEAD), null);
  for (const key of SPATIAL_PREPARE_FLAGS) {
    for (const value of ['true', 'false', 0, 1, null, undefined]) {
      assert.equal(projectSpatialPreparationReceiptV1(ready({ [key]: value }), HEAD), null, `${key}=${value}`);
    }
  }
});

test('wire parser rejects additional records, duplicate keys, unbounded output and raw diagnostics', () => {
  const good = output(ready());
  for (const value of [good + good, `PRIVATE_LOG\n${good}`, good + 'PRIVATE_LOG\n',
    good.replace('"ok":true', '"ok":false,"ok":true'),
    `${SPATIAL_PREPARE_MARKER}{broken}`, 'x'.repeat(8193), { stdout: good }]) {
    assert.equal(parseSpatialPreparationOutputV1(value, HEAD), null);
  }
});

test('execution failure preserves uncertainty and does not assert cleanup or installed readiness', async () => {
  for (const execution of [
    { status: null, stdout: output(ready()) }, { status: '0', stdout: output(ready()) },
    { status: 0, signal: 'SIGTERM', stdout: output(ready()) },
    { status: 0, error: new Error('PRIVATE_PATH'), stdout: output(ready()) },
    { status: 2, stdout: output(ready()) }, { status: 0, stdout: 'PRIVATE_COMPILER_OUTPUT' },
  ]) {
    const result = await runSpatialPreparationV1(options({ runWindowsPreparation: () => execution }));
    assert.equal(result.ok, false); assert.equal(result.mutationAttempted, true);
    assert.equal(result.createdProbeStopped, false); assert.equal(result.installationVerified, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  }
});

test('typed prerequisite or preserved-host holds survive without becoming success', async () => {
  const hold = spatialPrepareBlockedV1(HEAD, 'SPATIAL_PREPARE_PORT_OCCUPIED');
  const result = await runSpatialPreparationV1(options({ runWindowsPreparation: () => ({ status: 2, stdout: output(hold) }) }));
  assert.deepEqual(result, hold);
  assert.equal(projectSpatialPreparationReceiptV1({ ...hold, blocker: 'PRIVATE_PATH' }, HEAD), null);
  assert.equal(projectSpatialPreparationReceiptV1({ ...hold, ok: true }, HEAD), null);
});

test('production adapter uses fixed commands and removes inherited loaders and executable search overrides', () => {
  const calls = [];
  const adapter = spatialPreparationProductionAdaptersV1(ROOT, { platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Operator', SYSTEMROOT: 'C:\\Windows',
      PATH: 'C:\\untrusted', NODE_OPTIONS: '--require malicious', GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.sshCommand', GIT_CONFIG_VALUE_0: 'malicious' },
    runner: (exe, args, options) => { calls.push({ exe, args, options }); return { status: 0, stdout: calls.length === 1 ? 'main\n' : HEAD }; },
  });
  assert.deepEqual(adapter.observeSource(), { ok: true, head: HEAD, branch: 'main' });
  assert.ok(calls.some(call => call.args.includes('ls-files') && call.args.includes('--error-unmatch')));
  adapter.runWindowsPreparation(HEAD);
  const call = calls.at(-1);
  assert.equal(call.exe, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(call.args.slice(-2), ['-ExpectedHead', HEAD]);
  assert.equal(call.options.shell, false); assert.equal(call.options.timeout, 210000);
  assert.equal(call.options.env.NODE_OPTIONS, undefined);
  assert.equal(call.options.env.PSModulePath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  assert.doesNotMatch(call.options.env.PATH, /untrusted/);
  assert.equal(call.options.env.GIT_TERMINAL_PROMPT, '0');
  assert.doesNotMatch(JSON.stringify(call.options.env), /malicious/);
});

test('untracked preparation sources block even when git diff reports no tracked changes', () => {
  const adapter = spatialPreparationProductionAdaptersV1(ROOT, { platform: 'win32',
    runner: (_exe, args) => ({ status: args.includes('ls-files') ? 1 : 0,
      stdout: args.includes('symbolic-ref') ? 'main\n' : HEAD }),
  });
  assert.deepEqual(adapter.observeSource(), { ok: false, head: HEAD, branch: 'main' });
});

test('maintenance terminal registration retains mutation admission and exit-status truth', () => {
  const good = ready();
  const receipt = readSovereignMaintenanceTerminalReceiptV1(output(good), SPATIAL_PREPARE_ACTION);
  assert.deepEqual(receipt, good);
  assert.equal(sovereignMaintenanceCustodyUnprovenV1({ status: 0 }, receipt, SPATIAL_PREPARE_ACTION), false);
  assert.equal(sovereignMaintenanceCustodyUnprovenV1({ status: 2 }, receipt, SPATIAL_PREPARE_ACTION), true);
  assert.deepEqual(readSovereignMaintenanceTerminalReceiptV1(output(good) + output(good), SPATIAL_PREPARE_ACTION), { status: null });
});
