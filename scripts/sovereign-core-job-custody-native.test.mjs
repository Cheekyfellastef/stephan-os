import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync, existsSync, renameSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const source = resolve(import.meta.dirname, 'windows/SovereignCoreJobCustodyV1.cs');
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const windows = process.platform === 'win32';
function runner({ mode = 'complete', safe = '$true', cancel = '$false', deadline = 8000, watchInput = false, directoryRoot, terminalWitness } = {}) {
  // Test harness invokes only the checked-in closed probe; no production
  // registry, canonical workspace, services, scheduler or model is accessed.
  const code = `$ErrorActionPreference='Stop'; Add-Type -Path '${source.replaceAll("'", "''")}';
    $script:n=0; $clock=[Diagnostics.Stopwatch]::StartNew();
    $r=${directoryRoot
      ? `[Stephanos.Sovereign.CoreJobCustodyV1].GetMethod('RunProbe',[Reflection.BindingFlags]'NonPublic,Static').Invoke($null,@('custody-fixture-1234','${'a'.repeat(40)}','directories',[Func[bool]]{${safe}},[Func[bool]]{${cancel}},${deadline},$false,'${directoryRoot.replaceAll("'", "''")}'))`
      : watchInput
      ? `[Stephanos.Sovereign.CoreJobCustodyV1]::ProbeWithParentInput('custody-fixture-1234','${'a'.repeat(40)}',[Func[bool]]{${safe}})`
      : `[Stephanos.Sovereign.CoreJobCustodyV1]::Probe('custody-fixture-1234','${'a'.repeat(40)}','${mode}',[Func[bool]]{${safe}},[Func[bool]]{${cancel}},${deadline})`};
    'CORE_JOB_RESULT='+($r|ConvertTo-Json -Compress)`;
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(code, 'utf16le').toString('base64')], {
    windowsHide: true, shell: false, stdio: [watchInput ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', nativePidPublished = false;
  const pid = new Promise(resolvePid => child.stdout.on('data', b => {
    stdout += b;
    const match = stdout.match(/CORE_JOB_CHILD_PID=(\d+)/);
    if (match && !nativePidPublished) {
      nativePidPublished = true;
      const childPid=Number(match[1]);
      if(terminalWitness) {
        writeFileSync(terminalWitness+'.pending',String(childPid),{flag:'wx'});
        renameSync(terminalWitness+'.pending',terminalWitness);
      }
      resolvePid(childPid);
    }
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

function publicationFixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'core-publication-fixture-'));
  return Promise.resolve().then(() => fn(root)).finally(() => {
    assert.ok(root.startsWith(join(tmpdir(), 'core-publication-fixture-')));
    rmSync(root, { recursive: true, force: true });
  });
}

test('fixed Core-only worker restores publication directories without touching any files or R7',
  { skip: !windows, timeout: 20000 }, () => publicationFixture(async root => {
    const sentinel = 'original Core/R7 evidence — must remain identical';
    writeFileSync(join(root, 'original-custody-fixture.json'), sentinel);
    let out = await runner({ directoryRoot: root }).done;
    assert.ok(out.receipt, out.stderr);
    for (const key of ['RepairExecuted','WorkspaceMutationAttempted','CorePublicationDirectoriesReady',
      'ZeroActiveProcessesObserved','CustodyReleased']) assert.equal(out.receipt[key], true, JSON.stringify(out.receipt));
    assert.equal(out.receipt.RepairScope, 'CORE_PUBLICATION_DIRECTORIES_ONLY');
    assert.equal(out.receipt.OriginalR7Authority, false);
    assert.deepEqual(readdirSync(root).sort(), ['original-custody-fixture.json','proof','status']);
    assert.deepEqual(readdirSync(join(root, 'status')), []);
    assert.deepEqual(readdirSync(join(root, 'proof')), []);
    writeFileSync(join(root, 'status', 'source-mutation-lease-current.json'), sentinel);
    writeFileSync(join(root, 'proof', 'stephanos-core-daemon-current.json'), sentinel);
    out = await runner({ directoryRoot: root }).done;
    assert.equal(out.receipt.RepairExecuted, true, JSON.stringify(out.receipt));
    for (const file of ['original-custody-fixture.json', 'status/source-mutation-lease-current.json',
      'proof/stephanos-core-daemon-current.json']) assert.equal(readFileSync(join(root, file), 'utf8'), sentinel);
  }));

test('Core publication repair rejects redirected roots/leaves and regular-file substitutions before launch',
  { skip: !windows, timeout: 20000 }, () => publicationFixture(async root => {
    mkdirSync(join(root, 'outside'));
    symlinkSync(join(root, 'outside'), join(root, 'redirected'), 'junction');
    let out = await runner({ directoryRoot: join(root, 'redirected') }).done;
    assert.equal(out.receipt.ChildPid, 0, JSON.stringify(out.receipt));
    assert.deepEqual(readdirSync(join(root, 'outside')), []);
    mkdirSync(join(root, 'workspace'));
    symlinkSync(join(root, 'outside'), join(root, 'workspace', 'status'), 'junction');
    out = await runner({ directoryRoot: join(root, 'workspace') }).done;
    assert.equal(out.receipt.ChildPid, 0, JSON.stringify(out.receipt));
    assert.equal(existsSync(join(root, 'workspace', 'proof')), false);
    mkdirSync(join(root, 'file-case')); writeFileSync(join(root, 'file-case', 'proof'), 'leave unchanged');
    out = await runner({ directoryRoot: join(root, 'file-case') }).done;
    assert.equal(out.receipt.ChildPid, 0, JSON.stringify(out.receipt));
    assert.equal(readFileSync(join(root, 'file-case', 'proof'), 'utf8'), 'leave unchanged');
    assert.equal(existsSync(join(root, 'file-case', 'status')), false);
  }));

test('Core directory repair pins its root across launch and holds on gaming/cancellation',
  { skip: !windows, timeout: 20000 }, () => publicationFixture(async root => {
    mkdirSync(join(root, 'workspace'));
    const pinned = runner({ directoryRoot: join(root, 'workspace'),
      safe: '[Threading.Thread]::Sleep(500);$true' });
    await Promise.race([pinned.pid, pinned.done.then(x => { throw Error(x.stderr || 'no worker'); })]);
    assert.throws(() => renameSync(join(root, 'workspace'), join(root, 'redirect-target')));
    const success = await pinned.done;
    assert.equal(success.receipt.CorePublicationDirectoriesReady, true, JSON.stringify(success.receipt));
    for (const [name, options] of [['blocked', { safe: '$false' }],
      ['cancel', { safe: '$script:n++;$script:n -lt 4' }]]) {
      mkdirSync(join(root, name));
      const { receipt } = await runner({ directoryRoot: join(root, name), ...options }).done;
      assert.equal(receipt.RepairExecuted, false);
      assert.equal(receipt.OriginalR7Authority, false);
      if (name === 'blocked') {
        assert.equal(receipt.ChildPid, 0); assert.deepEqual(readdirSync(join(root, name)), []);
      } else {
        assert.equal(receipt.CancellationRequested, true);
        assert.equal(receipt.ZeroActiveProcessesObserved, true);
        assert.equal(receipt.CustodyReleased, true);
      }
    }
  }));

test('fast completed directory worker still requires final gaming/cancel acceptance after drain',
  { skip: !windows, timeout: 30000 }, () => publicationFixture(async root => {
    for (const mode of ['game','unknown','cancel']) {
      const target = join(root, mode); mkdirSync(target);
      const proof = join(target, 'proof').replaceAll("'", "''");
      // Fourth governor read is the first post-resume loop check. Hold it
      // until the real worker has made both directories and had time to exit.
      // The old loop then observed an empty Job and accepted without read #5.
      const wait = `$script:n++;if($script:n -eq 4){$until=[DateTime]::UtcNow.AddSeconds(6);`
        + `while(-not [IO.Directory]::Exists('${proof}') -and [DateTime]::UtcNow -lt $until){[Threading.Thread]::Sleep(10)};`
        + `[Threading.Thread]::Sleep(1500)};`;
      const safe = wait + (mode === 'game' ? '$script:n -le 4'
        : mode === 'unknown' ? "if($script:n -gt 4){throw 'unknown governor'};$true" : '$true');
      const { receipt, stderr } = await runner({ directoryRoot: target, safe,
        cancel: mode === 'cancel' ? '$script:n -gt 4' : '$false' }).done;
      assert.ok(receipt, stderr);
      assert.equal(receipt.ExitCode, 0, JSON.stringify(receipt));
      assert.equal(receipt.WorkspaceMutationAttempted, true);
      assert.equal(receipt.RepairExecuted, false); assert.equal(receipt.CorePublicationDirectoriesReady, false);
      assert.equal(receipt.CancellationRequested, true);
      assert.equal(receipt.Reason, mode === 'cancel' ? 'OPERATOR_CANCELLED' : 'GAMING_CANCELLED');
      assert.equal(receipt.ZeroActiveProcessesObserved, true); assert.equal(receipt.CustodyReleased, true);
      assert.equal(existsSync(join(target, 'status')), true); assert.equal(existsSync(join(target, 'proof')), true);
      assert.equal(receipt.OriginalR7Authority, false);
    }
  }));

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

test('common completion admission holds a drained child on deadline, unknown cancel and probe game onset',
  { skip: !windows, timeout: 30000 }, () => publicationFixture(async root => {
    // Join the actual native creator's private PID publication, then wait
    // for that owned child to exit before changing the terminal channel.
    // A fixed sleep could expire the deadline while the child was still live.
    const witness = join(root, 'terminal-child.pid');
    const quoted = witness.replaceAll("'", "''");
    const wait = `$script:n++;if($script:n -eq 4){
      $observer=[Diagnostics.Stopwatch]::StartNew();
      while(-not [IO.File]::Exists('${quoted}') -and $observer.ElapsedMilliseconds -lt 2000){[Threading.Thread]::Sleep(5)}
      if(-not [IO.File]::Exists('${quoted}')){throw 'FIXTURE_NATIVE_PID_NOT_PUBLISHED'}
      $rootPid=[int][IO.File]::ReadAllText('${quoted}');
      try{$owned=[Diagnostics.Process]::GetProcessById($rootPid)}catch [ArgumentException]{$owned=$null}
      if($null -ne $owned){try{if(-not $owned.WaitForExit(3000)){throw 'FIXTURE_ROOT_NOT_TERMINAL'}}finally{$owned.Dispose()}}
    };`;
    for (const [name, options, reason] of [
      ['deadline', { safe: wait + 'if($script:n -ge 5){[Threading.Thread]::Sleep(4000)};$true', deadline: 4000 }, 'DEADLINE_CANCELLED'],
      ['unknown-cancel', { safe: wait + '$true', cancel: 'if($script:n -ge 5){throw "cancel unavailable"};$false' }, 'OPERATOR_CANCELLED'],
      ['probe-game', { mode: 'complete', safe: wait + '$script:n -lt 5' }, 'GAMING_CANCELLED'],
    ]) {
      const directoryRoot = name === 'probe-game' ? undefined : join(root, name);
      if (directoryRoot) mkdirSync(directoryRoot);
      if(existsSync(witness))rmSync(witness);
      const { receipt, status, stderr } = await runner({ directoryRoot, terminalWitness:witness, ...options }).done;
      assert.equal(status, 0, stderr);
      assert.ok(receipt, stderr);
      assert.equal(receipt.ExitCode, 0, JSON.stringify(receipt));
      assert.equal(receipt.Verdict, 'HELD');
      assert.equal(receipt.Reason, reason);
      assert.equal(receipt.CancellationRequested, true);
      assert.equal(receipt.WorkspaceMutationAttempted, !!directoryRoot);
      assert.equal(receipt.CorePublicationDirectoriesReady, false);
      closed(receipt);
      if (directoryRoot) assert.deepEqual(readdirSync(directoryRoot).sort(), ['proof', 'status']);
    }
  }));

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
