import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMaintenanceInstallerBootstrapCandidateV3, MAINTENANCE_SOURCE_CLOSURE_V3 } from './sovereign-maintenance-installer-source-admission-v3.mjs';

const windows = process.platform === 'win32';
const root = fileURLToPath(new URL('..', import.meta.url));
const native = resolve(root, 'scripts/windows/SovereignCoreJobCustodyV1.cs');
const nativeSource = resolve(root, 'scripts/windows/SovereignMaintenanceSourceJobV3.cs');
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const expected = 'a'.repeat(40);
const literal = s => "'" + s.replaceAll("'", "''") + "'";
const encoded = s => Buffer.from(s, 'utf16le').toString('base64');
function sourceRecords() {
  return MAINTENANCE_SOURCE_CLOSURE_V3.map(path => {
    const bytes = readFileSync(resolve(root, path));
    return { path, blobSha: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'),
      contentBase64: bytes.toString('base64') };
  });
}
function launchFixture(worker, { deadline = 20000, queryFailure = false, hostileEnvironment = false, fixtureExecutable = null, fixtureArguments = null } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'maintenance-source-job-'));
  const script = join(directory, 'fixed-fixture.cjs');
  writeFileSync(script, worker);
  const code = "$ErrorActionPreference='Stop'; Add-Type -Path " + "@(" + literal(native) + "," + literal(nativeSource) + ")" + "; "
    + "$method=[Stephanos.Sovereign.CoreJobCustodyV1].GetMethod('RunMaintenanceSourceProbeV3',[Reflection.BindingFlags]'NonPublic,Static'); "
    + "$clock=[Diagnostics.Stopwatch]::StartNew(); $r=$method.Invoke($null,@($clock,"
    + literal(fixtureExecutable ?? process.execPath) + "," + literal(fixtureArguments ?? '"' + script + '"') + "," + literal(directory) + ","
    + literal(expected) + ",[int]" + deadline + ",[bool]$" + queryFailure + ")); "
    + "[Console]::WriteLine('SOURCE_JOB_RESULT='+($r|ConvertTo-Json -Compress))";
  const child = spawn(powershell, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded(code)],
    { windowsHide: true, shell: false, env: hostileEnvironment ? { ...process.env,
      NODE_OPTIONS: '--import=data:text/javascript,console.log("FORGED_SHA");process.exit(0)',
      NODE_PATH: 'hostile-node-path', OPENSSL_CONF: 'hostile-crypto', GITHUB_TOKEN: 'fixture-only' } : process.env });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const done = new Promise((resolveDone, reject) => {
    child.once('error', reject); child.once('exit', status => {
      const line = stdout.split(/\r?\n/).find(x => x.startsWith('SOURCE_JOB_RESULT='));
      resolveDone({ status, receipt: line ? JSON.parse(line.slice('SOURCE_JOB_RESULT='.length)) : null, stderr });
    });
  });
  return { child, directory, script, done, cleanup() {
    assert.ok(directory.startsWith(join(tmpdir(), 'maintenance-source-job-')));
    rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  } };
}
function assertReleased(r) {
  assert.equal(r.AssignedBeforeExecution, true);
  assert.equal(r.ZeroActiveProcessesObserved, true);
  assert.equal(r.CustodyReleased, true);
  assert.equal(r.ActiveProcesses, 0);
  assert.equal(r.JournalMutationAllowed, false);
  assert.equal(r.MaintenanceCustodyReleased, false);
  assert.ok(r.ChildPid > 0); assert.ok(Number.isFinite(Date.parse(r.ChildCreatedAtUtc)));
}
async function closeOwnedFixture(f) {
  if (f.child.exitCode === null && f.child.signalCode === null) f.child.kill();
  let timer;
  try { await Promise.race([f.done, new Promise((_, reject) => {
    timer=setTimeout(()=>reject(Error('OWNED_FIXTURE_TERMINATION_UNPROVEN')),5000);
  })]); } finally { clearTimeout(timer); }
  f.cleanup();
}
async function resultFixture(worker, options, check) {
  const f = launchFixture(worker, options);
  try { const { receipt, status, stderr } = await f.done; assert.equal(status, 0, stderr); assert.ok(receipt, stderr); check(receipt); }
  finally { await closeOwnedFixture(f); }
}

test('native compilation units preserve existing Core loader bounds', () => {
  for (const path of [native,nativeSource]) assert.ok(readFileSync(path).length <= 32768);
  assert.doesNotMatch(readFileSync(native,'utf8'), /ReadMaintenanceCanonicalSource|MaintenanceSourceProbeReceiptV3/);
});

test('bootstrap candidate binds each fixed blob, never promotes caller input to independent authority', () => {
  const records = sourceRecords();
  const c = buildMaintenanceInstallerBootstrapCandidateV3({ expectedMain: expected, sourceTree: 'b'.repeat(40), records });
  assert.equal(c.independentSourceAuthorityProven, false); assert.equal(c.operatorApprovalProven, false);
  assert.equal(c.elevationPerformed, false); assert.equal(c.journalRegistered, false);
  assert.ok(c.encodedCommand.length <= 30000);
  assert.match(c.script, /foreach\(\$relative in \$manifest.Keys\)\{\$texts\[\$relative\]=Read-Pinned[\s\S]*Add-Type/);
  assert.match(c.script, /PinDirectoryChain/);
  assert.match(c.script, /FileShare\]::Read/);
  assert.equal(MAINTENANCE_SOURCE_CLOSURE_V3.length, 40);
  for (const bad of [records.slice(1), [...records.slice(1), records[1]],
    records.map((r, i) => i ? r : { ...r, blobSha: '0'.repeat(40) }),
    records.map((r, i) => i ? r : { ...r, path: '../untrusted.ps1' })]) {
    assert.throws(() => buildMaintenanceInstallerBootstrapCandidateV3({ expectedMain: expected, sourceTree: 'b'.repeat(40), records: bad }));
  }
  const installer = readFileSync(resolve(root, 'scripts/windows/install-sovereign-maintenance-journal-v2.ps1'), 'utf8');
  assert.match(installer, /JOURNAL_INSTALL_IMMUTABLE_BOOTSTRAP_REQUIRED/);
  assert.doesNotMatch(installer, /\.Kill\(|WaitForExit\(10000\)|New-MaintenanceSourceProbeStartInfoV2/);
  assert.match(installer, /ReadMaintenanceCanonicalSource\(\$ExpectedMain\)/);
});

test('actual Windows bootstrap parser rejects no syntax and direct production entry refuses before mutation', { skip: !windows }, () => {
  const c = buildMaintenanceInstallerBootstrapCandidateV3({ expectedMain: expected, sourceTree: 'b'.repeat(40), records: sourceRecords() });
  const code = "$errors=$null;$tokens=$null;[void][Management.Automation.Language.Parser]::ParseInput("
    + literal(c.script) + ",[ref]$tokens,[ref]$errors);if($errors.Count){throw 'BOOTSTRAP_PARSE_FAILED'};"
    + "try { & " + literal(resolve(root,'scripts/windows/install-sovereign-maintenance-journal-v2.ps1'))
    + " -OperatorApproved -ExpectedMain " + expected + "; throw 'UNEXPECTED_ACCEPTANCE' } catch {"
    + "if($_.Exception.Message -cne 'JOURNAL_INSTALL_IMMUTABLE_BOOTSTRAP_REQUIRED'){throw};[Console]::WriteLine('DIRECT_ENTRY_REFUSED')}";
  const r = spawnSync(powershell, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded(code)],
    { windowsHide:true, shell:false, encoding:'utf8', timeout:15000 });
  assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/DIRECT_ENTRY_REFUSED/);
});

test('native source proof accepts real normal success beyond the former ten-second envelope', { skip: !windows, timeout:30000 }, () =>
  resultFixture("setTimeout(()=>process.stdout.write('" + expected + "'),11200)", {}, r => {
    assertReleased(r); assert.equal(r.Passed,true,JSON.stringify(r)); assert.equal(r.NormalRootExit,true);
    assert.equal(r.CancellationRequested,false); assert.equal(r.SourceHeadMatched,true);
    assert.ok(r.ElapsedMilliseconds > 10000); assert.ok(r.ElapsedMilliseconds < 20000);
  }));

test('native source process receives no hostile bootstrap, module, crypto or provider environment', { skip: !windows, timeout:20000 }, () =>
  resultFixture("const a=new Set(['SYSTEMROOT','WINDIR','TEMP','TMP','PATH']);"
    + "if(Object.keys(process.env).some(k=>!a.has(k.toUpperCase())))process.exit(7);"
    + "process.stdout.write('" + expected + "')", { hostileEnvironment:true }, r => {
    assertReleased(r); assert.equal(r.Passed,true,JSON.stringify(r)); assert.equal(r.ExitCode,0);
  }));

test('deadline, output overflow, foreign SHA and nonzero exit never become successful source proof', { skip: !windows, timeout:30000 }, async () => {
  for (const [worker, options, reason] of [
    ["setInterval(()=>{},1000)", {deadline:400}, 'SOURCE_DEADLINE'],
    ["process.stdout.write('x'.repeat(10000));setInterval(()=>{},1000)", {}, 'SOURCE_OUTPUT_OVERFLOW'],
    ["process.stdout.write('" + 'b'.repeat(40) + "')", {}, 'SOURCE_IDENTITY_UNPROVEN'],
    ["process.stdout.write('" + expected + "');process.exitCode=9", {}, 'SOURCE_TERMINAL_UNPROVEN']
  ]) await resultFixture(worker, options, r => { assertReleased(r); assert.equal(r.Passed,false); assert.equal(r.Reason,reason,JSON.stringify(r)); });
});

test('failed native query remains unknown even if owned-Job cleanup is requested', { skip: !windows, timeout:20000 }, () =>
  resultFixture("process.stdout.write('" + expected + "')", {queryFailure:true}, r => {
    assert.equal(r.Passed,false); assert.equal(r.CustodyReleased,false);
    assert.equal(r.ZeroActiveProcessesObserved,false); assert.equal(r.Reason,'SOURCE_NATIVE_CUSTODY_UNPROVEN');
  }));


const managedWitnessSource = "using System;\nusing System.Diagnostics;\nusing System.IO;\nusing System.Runtime.InteropServices;\nusing System.Text;\nusing System.Threading;\npublic static class MaintenanceSourceWitnessFixture {\n [StructLayout(LayoutKind.Sequential)] struct Startup {\n  public int cb; public IntPtr reserved,desktop,title;\n  public uint x,y,xs,ys,xc,yc,fill,flags;\n  public ushort show,reservedSize; public IntPtr reserved2,input,output,error;\n }\n [StructLayout(LayoutKind.Sequential)] struct Info { public IntPtr process,thread; public uint pid,tid; }\n [DllImport(\"kernel32.dll\",SetLastError=true,CharSet=CharSet.Unicode)]\n static extern bool CreateProcessW(string app,StringBuilder command,IntPtr psa,IntPtr tsa,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out Info info);\n [DllImport(\"kernel32.dll\")] static extern bool CloseHandle(IntPtr handle);\n public static int Main(string[] args) {\n  if(args.Length==1 && args[0]==\"leaf\") { Thread.Sleep(40000); return 0; }\n  if(args.Length!=5 || args[0]!=\"root\" || !System.Text.RegularExpressions.Regex.IsMatch(args[3],\"^[a-f0-9]{40}$\")) return 91;\n  string exe=Process.GetCurrentProcess().MainModule.FileName;\n  var start=new Startup(); start.cb=Marshal.SizeOf(typeof(Startup)); Info child;\n  if(!CreateProcessW(exe,new StringBuilder(\"\\\"\"+exe+\"\\\" leaf\"),IntPtr.Zero,IntPtr.Zero,false,0x8|0x400,IntPtr.Zero,Path.GetDirectoryName(exe),ref start,out child)) return 92;\n  CloseHandle(child.thread); CloseHandle(child.process);\n  File.WriteAllText(args[1],\"{\\\"root\\\":\"+Process.GetCurrentProcess().Id+\",\\\"descendant\\\":\"+child.pid+\"}\");\n  var wait=Stopwatch.StartNew();\n  while(!File.Exists(args[2]) && wait.ElapsedMilliseconds<12000) Thread.Sleep(10);\n  if(!File.Exists(args[2])) return 93;\n  if(args[4]==\"keep\") { Thread.Sleep(40000); return 94; }\n  Console.Write(args[3]); return 0;\n }\n}";
function compileManagedWitness(directory) {
  const source=join(directory,'witness.cs'), exe=join(directory,'witness.exe');
  writeFileSync(source,managedWitnessSource);
  const code="$ErrorActionPreference='Stop';Add-Type -Path " + literal(source)
    + " -OutputAssembly " + literal(exe) + " -OutputType ConsoleApplication";
  const r=spawnSync(powershell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded(code)],
    {windowsHide:true,shell:false,encoding:'utf8',timeout:15000});
  assert.equal(r.status,0,r.stderr);
  return exe;
}

async function descendantFixture(parentDeath) {
  const directory = mkdtempSync(join(tmpdir(), 'maintenance-source-witness-'));
  const identities = join(directory,'identities.json'), ack = join(directory,'ack');
  const executable=compileManagedWitness(directory);
  const argumentsText='root "'+identities+'" "'+ack+'" '+expected+' '+(parentDeath?'keep':'exit');
  const f=launchFixture('',{deadline:15000,fixtureExecutable:executable,fixtureArguments:argumentsText});
  try {
    const deadline=Date.now()+10000;
    while(!existsSync(identities) && Date.now()<deadline) await new Promise(r=>setTimeout(r,20));
    assert.equal(existsSync(identities),true,'fixture must prove both processes actually launched');
    const ids=JSON.parse(readFileSync(identities,'utf8'));
    const observerCode="$ErrorActionPreference='Stop';$r=[Diagnostics.Process]::GetProcessById(" + ids.root + ");"
      + "$d=[Diagnostics.Process]::GetProcessById(" + ids.descendant + ");try{"
      + "$rh=$r.Handle;$dh=$d.Handle;$birth=$r.StartTime.ToFileTimeUtc();$db=$d.StartTime.ToFileTimeUtc();"
      + "[IO.File]::WriteAllText(" + literal(ack) + ",'handles-open');[Console]::WriteLine('HANDLES_READY');"
      + "$re=$r.WaitForExit(10000);$de=$d.WaitForExit(10000);"
      + "[Console]::WriteLine('WITNESS='+(@{root=$re;descendant=$de;rootBirth=$birth;rootBirthUtc=$r.StartTime.ToUniversalTime().ToString('O');descendantBirth=$db}|ConvertTo-Json -Compress))"
      + "}finally{$r.Dispose();$d.Dispose()}";
    const observer=spawn(powershell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded(observerCode)],
      {windowsHide:true,shell:false});
    let out='',err=''; let ready;
    const readyPromise=new Promise(r=>{ready=r;});
    observer.stdout.on('data',b=>{out+=b;if(out.includes('HANDLES_READY'))ready();});
    observer.stderr.on('data',b=>{err+=b;});
    const observed=new Promise(r=>observer.once('exit',status=>r({status,out,err})));
    let readyTimer; try { await Promise.race([readyPromise,new Promise((_,reject)=>{readyTimer=setTimeout(()=>reject(Error('native handles not acquired')),8000);})]); } finally { clearTimeout(readyTimer); }
    if(parentDeath) f.child.kill();
    const terminal=await f.done;
    const o=await observed; assert.equal(o.status,0,o.err);
    const witness=JSON.parse(o.out.split(/\r?\n/).find(x=>x.startsWith('WITNESS=')).slice(8));
    assert.equal(witness.root,true); assert.equal(witness.descendant,true); assert.ok(witness.descendantBirth>0);
    if(parentDeath) assert.equal(terminal.receipt,null,'parent death cannot manufacture terminal authority');
    else {
      assertReleased(terminal.receipt); assert.equal(terminal.receipt.Passed,false);
      assert.equal(terminal.receipt.ChildPid,ids.root);
      assert.equal(terminal.receipt.Reason,'SOURCE_DESCENDANT_REMAINS');
      assert.equal(terminal.receipt.CancellationRequested,true);
      assert.equal(terminal.receipt.ChildCreatedAtUtc,witness.rootBirthUtc);
    }
  } finally {
    await closeOwnedFixture(f); assert.ok(directory.startsWith(join(tmpdir(),'maintenance-source-witness-')));
    rmSync(directory,{recursive:true,force:true,maxRetries:8,retryDelay:50});
  }
}
test('exact SHA and root exit zero with a live witnessed descendant is refused and natively drained',
  {skip:!windows,timeout:30000},()=>descendantFixture(false));
test('parent death kills the witnessed owned source tree and produces no fabricated terminal receipt',
  {skip:!windows,timeout:30000},()=>descendantFixture(true));


test('native bootstrap pins refuse changed bytes, write/delete races, hard links and redirected parents', {
  skip: !windows, timeout: 20000
}, () => {
  const directory=mkdtempSync(join(tmpdir(),'maintenance-source-pins-'));
  const file=join(directory,'source.txt'), hard=join(directory,'hard.txt');
  writeFileSync(file,'protected-fixture-source');
  const digest=createHash('sha256').update(readFileSync(file)).digest('hex');
  const candidate=buildMaintenanceInstallerBootstrapCandidateV3({
    expectedMain:expected,sourceTree:'b'.repeat(40),records:sourceRecords()
  });
  const candidatePath=join(directory,'bootstrap-candidate.ps1');
  writeFileSync(candidatePath,candidate.script);
  try {
    const code="$ErrorActionPreference='Stop';Add-Type -Path " + "@(" + literal(native) + "," + literal(nativeSource) + ")" + ";"
      + "$open=[Stephanos.Sovereign.CoreJobCustodyV1].GetMethod('OpenPinnedMaintenanceSourceFileV3',[Reflection.BindingFlags]'NonPublic,Static');"
      + "$f=$open.Invoke($null,@(" + literal(file) + "));try{"
      + "$writeDenied=$false;$deleteDenied=$false;"
      + "try{$w=[IO.File]::OpenWrite(" + literal(file) + ");$w.Dispose()}catch{$writeDenied=$true};"
      + "try{[IO.File]::Move(" + literal(file) + "," + literal(file+'.moved') + ")}catch{$deleteDenied=$true};"
      + "if(-not $writeDenied -or -not $deleteDenied){throw 'SOURCE_PIN_WRITE_OR_REPLACE_ALLOWED'}"
      + "}finally{$f.Dispose()};"
      + "New-Item -ItemType HardLink -Path " + literal(hard) + " -Target " + literal(file) + "|Out-Null;"
      + "try{$f=$open.Invoke($null,@(" + literal(file) + "));$f.Dispose();throw 'HARDLINK_ACCEPTED'}catch{"
      + "if($_.Exception.InnerException.Message -cne 'SOURCE_PIN_IDENTITY_UNPROVEN'){throw}};"
      + "[IO.File]::Delete(" + literal(hard) + ");"
      + "$scriptText=[IO.File]::ReadAllText(" + literal(candidatePath) + ");$tokens=$null;$errors=$null;"
      + "$ast=[Management.Automation.Language.Parser]::ParseInput($scriptText,[ref]$tokens,[ref]$errors);"
      + "$function=$ast.Find({param($a)$a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -ceq 'Read-Pinned'},$true);"
      + ". ([scriptblock]::Create($function.Extent.Text));"
      + "$root=" + literal(directory) + ";$handles=[Collections.Generic.List[IO.FileStream]]::new();$leafPin=$open;"
      + "try{"
      + "$text=Read-Pinned 'source.txt' " + literal(digest) + ";if($text -cne 'protected-fixture-source'){throw 'PIN_READ_FAILED'};"
      + "try{[void](Read-Pinned 'source.txt' " + literal('0'.repeat(64)) + ");throw 'CHANGED_BYTES_ACCEPTED'}"
      + "catch{if($_.Exception.Message -cne 'SOURCE_PIN_DIGEST'){throw}}"
      + "}finally{foreach($h in $handles){$h.Dispose()}};"
      + "$target=[IO.Directory]::CreateDirectory(" + literal(join(directory,'target')) + ");"
      + "New-Item -ItemType Junction -Path " + literal(join(directory,'redirect')) + " -Target $target.FullName|Out-Null;"
      + "$pins=[Collections.Generic.List[Microsoft.Win32.SafeHandles.SafeFileHandle]]::new();"
      + "$chain=[Stephanos.Sovereign.CoreJobCustodyV1].GetMethod('PinDirectoryChain',[Reflection.BindingFlags]'NonPublic,Static');"
      + "try{try{[void]$chain.Invoke($null,@(" + literal(join(directory,'redirect')) + ",$pins));throw 'REDIRECT_ACCEPTED'}"
      + "catch{if($_.Exception.InnerException.Message -cne 'CORE_DIRECTORY_CUSTODY_UNAVAILABLE'){throw}}}"
      + "finally{foreach($h in $pins){$h.Dispose()}};[Console]::WriteLine('NATIVE_SOURCE_PINS_PASS')";
    const r=spawnSync(powershell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded(code)],
      {windowsHide:true,shell:false,encoding:'utf8',timeout:18000});
    assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/NATIVE_SOURCE_PINS_PASS/);
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(),'maintenance-source-pins-')));
    rmSync(directory,{recursive:true,force:true,maxRetries:8,retryDelay:50});
  }
});
