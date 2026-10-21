import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runCoreJobCustodyPreflightV1, projectCoreJobCustodyCandidateV1,
  runCorePublicationDirectoryRepairCandidateV1, projectCoreDirectoryRepairCandidateV1 } from './sovereign-core-job-custody-preflight-v1.mjs';

const binding = { requestId: 'custody-request-1234', sourceHead: 'a'.repeat(40), nativeSourceSha256: 'f'.repeat(64) };
const expectedNativeSourceSha256 = createHash('sha256').update(readFileSync(new URL('./windows/SovereignCoreJobCustodyV1.cs', import.meta.url))).digest('hex');
const raw = { SchemaVersion: 'stephanos.core-job-custody-candidate.v1', RequestId: binding.requestId,
  SourceHead: binding.sourceHead, AssignedBeforeExecution: true, ZeroActiveProcessesObserved: true,
  CustodyReleased: true, ActiveProcesses: 0, ChildPid: 1234, CancellationRequested: true,
  CancellationAcknowledged: true, Reason: 'DEADLINE_CANCELLED', Verdict: 'HELD', ExitCode: 0,
  SourceMutationAllowed: false, OriginalR7Authority: false, SpecialistQualified: false, RepairExecuted: false };

const directoryRaw = { ...raw, RepairScope: 'CORE_PUBLICATION_DIRECTORIES_ONLY',
  WorkspaceMutationAttempted: true, RepairExecuted: true, CorePublicationDirectoriesReady: true,
  CancellationRequested: false, Verdict: 'CORE_DIRECTORY_REPAIR_SATISFIED_UNQUALIFIED', Reason: '' };

test('actual bounded directory repair is separate from Core/builder recovery and specialist admission', () => {
  const p = projectCoreDirectoryRepairCandidateV1(directoryRaw, binding);
  assert.equal(p.ok, true); assert.equal(p.repairExecuted, true);
  assert.equal(p.coreHealthProven, false); assert.equal(p.originalBuilderRecovered, false);
  assert.equal(p.originalR7Authority, false); assert.equal(p.sourceMutationAllowed, false);
  assert.equal(p.dispatchAllowed, false); assert.equal(p.specialistQualified, false);
  for (const delta of [{ RepairScope: 'REPAIR_CONTROL_PLANE' }, { CorePublicationDirectoriesReady: false },
    { WorkspaceMutationAttempted: false }, { SourceHead: 'b'.repeat(40) }, { ZeroActiveProcessesObserved: false },
    { ActiveProcesses: 1 }, { CancellationRequested: true }, { SourceMutationAllowed: true },
    { OriginalR7Authority: true }, { SpecialistQualified: true }, { ExitCode: 77 }]) {
    const held = projectCoreDirectoryRepairCandidateV1({ ...directoryRaw, ...delta }, binding);
    assert.equal(held.ok, false);
    assert.equal(held.workspaceMutationState, 'UNPROVEN_RETAIN_ORIGINAL_REQUEST');
  }
});

test('fixed repair wrapper accepts no path/command override and retains partial-cancel uncertainty', async () => {
  const controller = new AbortController();
  let child;
  const outcome = await runCorePublicationDirectoryRepairCandidateV1({ ...binding, platform: 'win32',
    expectedNativeSourceSha256,
    root: 'C:\\attacker', command: 'Restart-Service', signal: controller.signal,
    spawnFn(_exe, args, options) {
      const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      assert.match(script, /::RepairCorePublicationDirectories\(/);
      assert.match(script, /GetFolderPath/);
      assert.doesNotMatch(script, /C:\\attacker|Restart-Service/);
      assert.equal(options.shell, false);
      child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => {};
      let writes = 0;
      child.stdin.on('data', bytes => {
        if (++writes === 1) queueMicrotask(() => controller.abort());
        else { assert.equal(bytes.toString(), 'CANCEL\n'); queueMicrotask(() => child.emit('close', 0)); }
      });
      return child;
    },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.workspaceMutationState, 'UNPROVEN_RETAIN_ORIGINAL_REQUEST');
  assert.equal(outcome.requestId, binding.requestId);
  assert.equal(outcome.sourceMutationAllowed, false);
});

test('repair requires authenticated native digest and refuses captured installed-source drift before launch', async () => {
  for (const expected of [undefined, '', 'f'.repeat(64)]) {
    const result = await runCorePublicationDirectoryRepairCandidateV1({ ...binding, platform: 'win32',
      expectedNativeSourceSha256: expected, spawnFn() { assert.fail('must not compile or launch'); } });
    assert.equal(result.ok, false);
    assert.match(result.reason, /DIGEST_REQUIRED|SOURCE_DRIFT/);
  }
});

test('bound native proof remains candidate-only and cannot enroll a repair executor', () => {
  const projected = projectCoreJobCustodyCandidateV1(raw, binding);
  assert.equal(projected.ok, true);
  assert.equal(projected.status, 'CORE_JOB_CUSTODY_CANDIDATE_UNQUALIFIED');
  assert.equal(projected.dispatchAllowed, false);
  assert.equal(projected.specialistQualified, false);
  assert.equal(projected.repairExecuted, false);
});

test('stale head, forged authority, missing stop acknowledgement or incomplete OS drain HOLD', () => {
  assert.equal(projectCoreJobCustodyCandidateV1(raw, { ...binding, nativeSourceSha256: '' }).ok, false);
  for (const patch of [
    { RequestId: 'other-request' }, { SourceHead: 'b'.repeat(40) }, { ActiveProcesses: 1 },
    { AssignedBeforeExecution: false }, { ZeroActiveProcessesObserved: false },
    { CustodyReleased: false }, { CancellationAcknowledged: false },
    { SourceMutationAllowed: true }, { OriginalR7Authority: true },
    { SpecialistQualified: true }, { RepairExecuted: true }, { ChildPid: 0 }, { ExitCode: null },
  ]) assert.equal(projectCoreJobCustodyCandidateV1({ ...raw, ...patch }, binding).ok, false);
});

test('fixed preflight captures installed source over stdin and strips executable injection', async () => {
  const outcome = await runCoreJobCustodyPreflightV1({ ...binding, platform: 'win32',
    environment: { NODE_OPTIONS: '--import=attacker', PSModulePath: 'attacker', USERPROFILE: 'C:\\fixture' },
    spawnFn(executable, args, options) {
      assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      assert.equal(options.shell, false);
      assert.equal(options.env.NODE_OPTIONS, undefined);
      assert.equal(options.env.PSModulePath, undefined);
      const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      assert.match(script, /ReadGovernorLocked/);
      assert.doesNotMatch(script, /Add-Type -Path|Start-Process|Register-ScheduledTask|Restart-Service/);
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => {};
      child.stdin.once('data', bytes => {
        assert.match(Buffer.from(bytes.toString().trim(), 'base64').toString(), /class CoreJobCustodyV1/);
        queueMicrotask(() => { child.stdout.write('CORE_JOB_RESULT=' + JSON.stringify(raw) + '\n'); child.emit('close', 0); });
      });
      return child;
    },
  });
  assert.equal(outcome.ok, true);
  assert.match(outcome.nativeSourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(outcome.dispatchAllowed, false);
});

test('invalid identity, unsupported host or pre-cancelled request never launches', async () => {
  for (const options of [
    { requestId: 'evil\ncommand', sourceHead: binding.sourceHead, platform: 'win32' },
    { ...binding, platform: 'linux' },
    { ...binding, platform: 'win32', signal: AbortSignal.abort() },
  ]) {
    const out = await runCoreJobCustodyPreflightV1({ ...options, spawnFn() { throw Error('must not run'); } });
    assert.equal(out.ok, false);
  }
});
