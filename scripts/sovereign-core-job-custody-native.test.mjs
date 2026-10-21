import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const source = resolve(import.meta.dirname, 'windows/SovereignCoreJobCustodyV1.cs');
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const windows = process.platform === 'win32';
function runner({ mode = 'complete', safe = '$true', cancel = '$false', deadline = 8000, watchInput = false } = {}) {
  // Test harness invokes only the checked-in closed probe; no production
  // registry, canonical workspace, services, scheduler or model is accessed.
  const code = `$ErrorActionPreference='Stop'; Add-Type -Path '${source.replaceAll("'", "''")}';
    $script:n=0; $clock=[Diagnostics.Stopwatch]::StartNew();
    $r=${watchInput
      ? `[Stephanos.Sovereign.CoreJobCustodyV1]::ProbeWithParentInput('custody-fixture-1234','${'a'.repeat(40)}',[Func[bool]]{${safe}})`
      : `[Stephanos.Sovereign.CoreJobCustodyV1]::Probe('custody-fixture-1234','${'a'.repeat(40)}','${mode}',[Func[bool]]{${safe}},[Func[bool]]{${cancel}},${deadline})`};
    'CORE_JOB_RESULT='+($r|ConvertTo-Json -Compress)`;
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(code, 'utf16le').toString('base64')], {
    windowsHide: true, shell: false, stdio: [watchInput ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  const pid = new Promise(resolvePid => child.stdout.on('data', b => {
    stdout += b;
    const match = stdout.match(/CORE_JOB_CHILD_PID=(\d+)/);
    if (match) resolvePid(Number(match[1]));
  }));
  const done = new Promise((resolveDone, reject) => {
    child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject);
    child.on('exit', status => {
      const line = stdout.split(/\r?\n/).find(l => l.startsWith('CORE_JOB_RESULT='));
      resolveDone({ status, stdout, stderr, receipt: line ? JSON.parse(line.slice(16)) : null });
    });
  });
  return { child, pid, done };
}
function closed(receipt) {
  assert.equal(receipt.ZeroActiveProcessesObserved, true);
  assert.equal(receipt.CustodyReleased, true);
  assert.equal(receipt.ActiveProcesses, 0);
  for (const key of ['SourceMutationAllowed', 'OriginalR7Authority', 'SpecialistQualified', 'RepairExecuted'])
    assert.equal(receipt[key], false, key);
}

test('native adapter uses atomic Job assignment and never enables breakaway or command input', () => {
  const code = readFileSync(source, 'utf8');
  assert.match(code, /new IntPtr\(0x2000D\)/);
  assert.match(code, /limits\.basic\.activeLimit=1/);
  assert.match(code, /limits\.basic\.flags=0x2000\|0x400\|0x8/);
  assert.doesNotMatch(code, /AssignProcessToJobObject\(/);
  assert.match(code, /QueryInformationJobObject/);
  assert.match(code, /UseShellExecute=\$false/);
  assert.doesNotMatch(code, /Start-Process -FilePath/);
});

test('native governor reader pins ancestors/file and denies reparse or an existing writer', { skip: !windows, timeout: 20000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'core-governor-fixture-'));
  try {
    mkdirSync(join(root, 'real'));
    const file = join(root, 'real', 'governor.json');
    writeFileSync(file, '{"fixture":true}');
    symlinkSync(join(root, 'real'), join(root, 'redirected'), 'junction');
    const quote = s => s.replaceAll("'", "''");
    const code = `$ErrorActionPreference='Stop'; Add-Type -Path '${quote(source)}';
      $file='${quote(file)}';
      $normal=[Stephanos.Sovereign.CoreJobCustodyV1]::ReadGovernorLocked($file);
      $redirect=[Stephanos.Sovereign.CoreJobCustodyV1]::ReadGovernorLocked('${quote(join(root, 'redirected', 'governor.json'))}');
      $writer=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite);
      try{$busy=[Stephanos.Sovereign.CoreJobCustodyV1]::ReadGovernorLocked($file)}finally{$writer.Dispose()};
      @{normal=($null -ne $normal);redirectDenied=($null -eq $redirect);writerDenied=($null -eq $busy)}|ConvertTo-Json -Compress`;
    const r = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')],
      { encoding: 'utf8', shell: false, windowsHide: true, timeout: 15000 });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { normal: true, redirectDenied: true, writerDenied: true }, r.stderr);
  } finally {
    assert.ok(root.startsWith(join(tmpdir(), 'core-governor-fixture-')));
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows Job contains the fixed worker before execution and witnesses zero processes', { skip: !windows, timeout: 20000 }, async () => {
  const { receipt, status, stderr } = await runner().done;
  assert.equal(status, 0, stderr);
  assert.equal(receipt.AssignedBeforeExecution, true);
  assert.equal(receipt.Verdict, 'PROBE_PASSED_UNQUALIFIED');
  closed(receipt);
});

test('unknown/active gaming and throwing governor deny before any child creation', { skip: !windows, timeout: 20000 }, async () => {
  for (const safe of ['$false', 'throw "governor unavailable"']) {
    const { receipt, stderr } = await runner({ safe }).done;
    assert.ok(receipt, stderr);
    assert.equal(receipt.Reason, 'GAMING_GUARD_BLOCKED');
    assert.equal(receipt.ChildPid, 0);
    assert.equal(receipt.CustodyReleased, false);
  }
  const { receipt } = await runner({ cancel: 'throw "cancellation channel unavailable"' }).done;
  assert.equal(receipt.Reason, 'CANCELLED_BEFORE_LAUNCH');
  assert.equal(receipt.ChildPid, 0);
});

test('game onset, cancellation and deadline terminate only the owned Job and drain it', { skip: !windows, timeout: 30000 }, async () => {
  for (const [options, reason] of [
    [{ mode: 'wait', safe: '$clock.ElapsedMilliseconds -lt 2500' }, 'GAMING_CANCELLED'],
    [{ mode: 'wait', cancel: '$clock.ElapsedMilliseconds -ge 2500' }, 'OPERATOR_CANCELLED'],
    [{ mode: 'wait', deadline: 2500 }, 'DEADLINE_CANCELLED'],
  ]) {
    const { receipt, stderr } = await runner(options).done;
    assert.ok(receipt, stderr);
    assert.equal(receipt.Reason, reason);
    assert.equal(receipt.CancellationRequested, true);
    assert.equal(receipt.CancellationAcknowledged, true);
    closed(receipt);
  }
});

test('native process limit denies descendant creation, preserving R7 exclusion', { skip: !windows, timeout: 20000 }, async () => {
  const { receipt, stderr } = await runner({ mode: 'descendant', deadline: 8000 }).done;
  assert.ok(receipt, stderr);
  assert.equal(receipt.DescendantAttemptDenied, true, JSON.stringify(receipt));
  closed(receipt);
});

test('parent death closes non-inherited kill Job and leaves no owned worker alive', { skip: !windows, timeout: 20000 }, async () => {
  const r = runner({ mode: 'wait' });
  const timer = setTimeout(() => r.child.kill(), 12000);
  try {
    const childPid = await Promise.race([r.pid, r.done.then(x => { throw Error(x.stderr || 'parent exited before worker'); })]);
    // Only our exact test parent is terminated. The kernel closes its private
    // Job handle; no PID-tree kill or unrelated process operation is used.
    r.child.kill();
    await r.done;
    const until = Date.now() + 3000;
    let alive;
    do {
      try { process.kill(childPid, 0); alive = true; } catch { alive = false; }
      if (alive) await new Promise(resolveWait => setTimeout(resolveWait, 25));
    } while (alive && Date.now() < until);
    assert.equal(alive, false, 'owned worker must die when the Job handle closes');
  } finally { clearTimeout(timer); if (r.child.exitCode === null) r.child.kill(); }
});

test('Commander pipe cancellation or EOF drains the original Job without a fresh request', { skip: !windows, timeout: 20000 }, async () => {
  for (const eof of [false, true]) {
    const r = runner({ watchInput: true });
    const watchdog = setTimeout(() => r.child.kill(), 12000);
    try {
      await Promise.race([r.pid, r.done.then(x => { throw Error(x.stderr || 'no worker'); })]);
      if (eof) r.child.stdin.end(); else r.child.stdin.write('CANCEL\n');
      const { receipt, stderr } = await r.done;
      assert.ok(receipt, stderr);
      assert.equal(receipt.RequestId, 'custody-fixture-1234');
      assert.equal(receipt.CancellationRequested, true);
      assert.ok(['OPERATOR_CANCELLED','CANCELLED_BEFORE_RESUME'].includes(receipt.Reason));
      closed(receipt);
    } finally { clearTimeout(watchdog); if (r.child.exitCode === null) r.child.kill(); }
  }
});
