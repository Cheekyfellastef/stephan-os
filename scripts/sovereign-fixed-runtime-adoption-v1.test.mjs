import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyFixedRuntimeSourceProofV1} from './sovereign-fixed-runtime-parent-v1.mjs';
import {fixedRuntimeGitClosureSha256V1} from './sovereign-fixed-runtime-installer-candidate-v1.mjs';
import {makeFixedRuntimeSourceProofFixtureV1 as fixture,fixtureGitObject as object,
  fixtureProofWire as wire,fixtureSha256 as hash} from './fixtures/sovereign-fixed-runtime-source-proof-fixture-v1.mjs';

const files=[
  {path:'.gitattributes',content:'* text=auto\n'},
  {path:'scripts/fixture.mjs',content:'export const one = 1;\n'},
  {path:'shared/agents/fixture.mjs',content:'export const two = 2;\n'},
];
const original=fixture({files,extras:[{path:'README.md',content:'before\n'}]});
const updated=fixture({files,extras:[{path:'README.md',content:'after\n'},{path:'docs/unrelated.md',content:'unrelated\n'}]});
const vectors=[];
const add=(name,raw,{valid=false,members=original.members}={})=>vectors.push({name,raw,valid,members,paths:members.map(row=>row.Path)});
const rowBytes=(mode,name,sha)=>Buffer.concat([Buffer.from(mode+' '),Buffer.isBuffer(name)?name:Buffer.from(name),Buffer.from([0]),Buffer.from(sha,'hex')]);
function withRoot(bytes) {
  const root=object('tree',bytes),trees=new Map(original.trees);trees.delete(original.tree);trees.set(root.sha,root.bytes);
  const commit=object('commit','tree '+root.sha+'\nauthor Fixture <fixture@example.invalid> 1 +0000\n\nfixture\n');
  return wire(commit,trees);
}
function commitWith(bytes) {return wire(object('commit',bytes),original.trees);}
add('original exact closure',original.raw,{valid:true});
add('unrelated current-main update preserves reviewed closure',updated.raw,{valid:true});
add('one changed member cannot borrow installed closure',fixture({files:files.map((row,i)=>i===1?{...row,content:'changed\n'}:row)}).raw);
add('executable mode is not the reviewed 100644 mode',fixture({files:files.map((row,i)=>i===1?{...row,mode:'100755'}:row)}).raw);
add('symlink mode refuses',fixture({files:files.map((row,i)=>i===1?{...row,mode:'120000'}:row)}).raw);
add('claimed head is not the commit hash',original.raw.replace(original.head,'a'.repeat(40)));
add('raw bytes cannot borrow tree hash',original.raw.replace(original.trees.get(original.tree).toString('base64'),'YQ=='));
add('missing intermediate tree',wire(original.commit,new Map([...original.trees].filter(([sha])=>sha!==original.entriesByTree.get(original.tree).get('scripts').sha))));
const unused=object('tree',rowBytes('100644','unrelated','a'.repeat(40)));
add('unused object cannot enlarge proof inventory',wire(original.commit,new Map([...original.trees,[unused.sha,unused.bytes]])));
const fields=original.raw.split(' ');
add('duplicate object refuses',[...fields,fields[3]].join(' '));
add('noncanonical object order refuses',[...fields.slice(0,3),...fields.slice(3).reverse()].join(' '));
add('excess object count refuses',[...fields.slice(0,3),...Array(129).fill(fields[3])].join(' '));
add('extra empty field refuses',original.raw+' ');
add('noncanonical base64 refuses',original.raw.replace(fields[2],fields[2]+'='));
add('Unicode wire refuses',original.raw+'\u00a0');
add('embedded newline refuses',original.raw+'\n');
add('wrong wire schema refuses',original.raw.replace('STEPHANOS_FIXED_RUNTIME_SOURCE_V1','FOREIGN_SOURCE_V1'));
add('wire size is bounded','x'.repeat(3145729));
add('commit size is bounded',wire(object('commit',Buffer.alloc(65537,65)),original.trees));
add('duplicate commit tree header refuses',commitWith('tree '+original.tree+'\ntree '+original.tree+'\n\nfixture\n'));
add('commit message is not its tree header',commitWith('author Fixture <fixture@example.invalid> 1 +0000\n\ntree '+original.tree+'\n'));
add('BOM commit is not normalized',commitWith('\ufeff'+original.commit.bytes.toString()));
add('invalid UTF8 commit refuses',commitWith(Buffer.concat([original.commit.bytes,Buffer.from([255])])));
add('truncated binary tree refuses',withRoot(Buffer.from('100644 bad\0')));
add('high-bit mode bytes refuse',withRoot(rowBytes('1\u00b00644','file','a'.repeat(40))));
add('invalid UTF8 tree name refuses',withRoot(rowBytes('100644',Buffer.from([255]),'a'.repeat(40))));
for(const name of ['..','.','a/b','a\\b','a:stream','tail.','tail ','bad\u0001name'])
  add('unsafe tree component '+JSON.stringify(name),withRoot(rowBytes('100644',name,'a'.repeat(40))));
const rootRows=[...original.entriesByTree.get(original.tree).values()];
const sortedRows=rows=>rows.sort((a,b)=>Buffer.compare(Buffer.from(a.name+(a.mode==='40000'?'/':'')),Buffer.from(b.name+(b.mode==='40000'?'/':''))));
add('Windows case alias refuses',withRoot(Buffer.concat(sortedRows([...rootRows,{...rootRows.find(row=>row.name==='scripts'),name:'Scripts'}])
  .map(row=>rowBytes(row.mode,row.name,row.sha)))));
add('duplicate entry refuses',withRoot(Buffer.concat([...rootRows,rootRows[0]].map(row=>rowBytes(row.mode,row.name,row.sha)))));
add('noncanonical entry order refuses',withRoot(Buffer.concat([...rootRows].reverse().map(row=>rowBytes(row.mode,row.name,row.sha)))));
add('missing Git blob pins cannot adopt',original.raw,{members:original.members.map(row=>({...row,GitBlobSha:''}))});
add('missing Git mode pins cannot adopt',original.raw,{members:original.members.map(row=>({...row,GitMode:''}))});
add('case aliased manifest member refuses',original.raw,{members:[...original.members,{...original.members[1],Path:'Scripts/fixture.mjs'}]});
add('empty closure refuses',original.raw,{members:[]});
// Exercise legacy and current bounded Spatial source composition in the same
// Node and independently compiled Windows verifier, including the last member.
const capacityFiles=Array.from({length:296},(_,i)=>({
  path:'scripts/capacity/member-'+String(i+1).padStart(3,'0')+'.mjs',
  content:'export const member = '+(i+1)+';\n',
}));
for(const count of [266,284,295,296]) {
  const proof=fixture({files:capacityFiles.slice(0,count)});
  add(count+' exact members '+(count<=295?'preserve bounded proof':'exceed capacity'),
    proof.raw,{members:proof.members,valid:count<=295});
}
const expanded=fixture({files:capacityFiles.slice(0,295)});
add('unrelated main update preserves all 295 members',
  fixture({files:capacityFiles.slice(0,295),extras:[{path:'README.md',content:'updated\n'}]}).raw,
  {members:expanded.members,valid:true});
add('changed 295th blob cannot borrow installed closure',
  fixture({files:capacityFiles.slice(0,295).map((row,i)=>i===294?{...row,content:'changed last member\n'}:row)}).raw,
  {members:expanded.members});
add('missing 295th member refuses',fixture({files:capacityFiles.slice(0,294)}).raw,
  {members:expanded.members});
add('295th member mode substitution refuses',
  fixture({files:capacityFiles.slice(0,295).map((row,i)=>i===294?{...row,mode:'100755'}:row)}).raw,
  {members:expanded.members});
add('unknown replacement for 295th member refuses',expanded.raw,
  {members:expanded.members.map((row,i)=>i===294?{...row,Path:'scripts/capacity/unknown.mjs'}:row)});
add('tree object size is bounded',wire(original.commit,new Map([['a'.repeat(40),Buffer.alloc(2097153,65)]])));
function manyRows(count,prefix,padding=0) {
  return Buffer.concat(Array.from({length:count},(_,i)=>rowBytes('100644',prefix+i.toString().padStart(5,'0')+'x'.repeat(padding),'a'.repeat(40))));
}
add('tree entry count is bounded',withRoot(manyRows(32769,'n')));
const hugeOne=object('tree',manyRows(13000,'a',50)),hugeTwo=object('tree',manyRows(13000,'b',50));
add('aggregate tree bytes are bounded',wire(object('commit','tree '+hugeOne.sha+'\n\nfixture\n'),new Map([[hugeOne.sha,hugeOne.bytes],[hugeTwo.sha,hugeTwo.bytes]])));

for(const vector of vectors)test('source membership: '+vector.name,()=>{
  const verify=()=>{
    const observed=verifyFixedRuntimeSourceProofV1(vector.raw,vector.paths);
    assert.equal(observed.gitClosureSha256,fixedRuntimeGitClosureSha256V1(vector.members),'installed closure must match');
    return observed;
  };
  if(vector.valid) {
    const value=verify();assert.equal(value.sourceProofSha256,hash(vector.raw));
    assert.equal(Object.isFrozen(value),true);
    assert.equal(Object.hasOwn(value,'dispatchAllowed'),false);
    assert.equal(Object.hasOwn(value,'currentMainProven'),false);
  } else assert.throws(verify);
});
test('compile identity is stable across a different current commit and root tree',()=>{
  const a=verifyFixedRuntimeSourceProofV1(original.raw,original.paths),b=verifyFixedRuntimeSourceProofV1(updated.raw,updated.paths);
  assert.notEqual(a.head,b.head);assert.notEqual(a.tree,b.tree);
  assert.notEqual(a.sourceProofSha256,b.sourceProofSha256);assert.equal(a.gitClosureSha256,b.gitClosureSha256);
});
test('actual parent integrates existing authority, unique selection and both receipt identities',()=>{
  const out=execFileSync(process.execPath,['--experimental-vm-modules',
    fileURLToPath(new URL('./fixtures/sovereign-fixed-runtime-adoption-parent-fixture-v1.mjs',import.meta.url))],
    {encoding:'utf8',timeout:10000,maxBuffer:65536});
  assert.deepEqual(JSON.parse(out),{cases:26,nativeExecuted:false,productionQualification:false,custodyMutated:false});
});
test('native verifier independently agrees on all membership and rejection vectors',
  {skip:process.platform!=='win32',timeout:60000},()=>{
  const directory=mkdtempSync(join(tmpdir(),'stph-runtime-adoption-'));
  const driver=join(directory,'driver.ps1'),input=join(directory,'vectors.json');
  const literal=value=>"'"+value.replaceAll("'","''")+"'";
  const native=['SovereignCoreJobCustodyV1.cs','SovereignFixedRuntimeJobV1.cs','SovereignFixedRuntimeIdentityV1.cs',
    'SovereignFixedRuntimeAuthorityV1.cs','SovereignFixedRuntimeHostV1.cs','SovereignFixedRuntimeSourceV1.cs'];
  const payload=JSON.stringify(vectors.map(row=>({...row,expectedDigest:hash(row.raw),
    expectedClosure:row.valid?fixedRuntimeGitClosureSha256V1(row.members):''})));
  writeFileSync(input,payload,{encoding:'utf8',flag:'wx'});
  const script=String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$source=(@(__NATIVE__)|ForEach-Object{[IO.File]::ReadAllText($_)}) -join [Environment]::NewLine
Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Web.Extensions','System.Core','System.Management' -ErrorAction Stop
$flags=[Reflection.BindingFlags]'NonPublic,Static'
$type=[Stephanos.Sovereign.CoreJobCustodyV1]
$verify=$type.GetMethod('RuntimeVerifySourceProofV1',$flags)
$bytes=[IO.File]::ReadAllBytes(__INPUT__)
$sha=[Security.Cryptography.SHA256]::Create()
try{$digest=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
if($digest -cne '__INPUT_HASH__'){throw 'FIXTURE_INPUT_CHANGED'}
$json=[Web.Script.Serialization.JavaScriptSerializer]::new()
$json.MaxJsonLength=67108864
$rows=$json.DeserializeObject([Text.UTF8Encoding]::new($false,$true).GetString($bytes))
function Test-ExpectedSourceProofRefusal([Exception]$exception){
 $cause=$exception;$depth=0
 $wrappers=@('System.Reflection.TargetInvocationException','System.Management.Automation.MethodInvocationException')
 while($null -ne $cause -and ($wrappers -ccontains $cause.GetType().FullName)){
  if($depth -ge 4 -or $null -eq $cause.InnerException){return $false}
  $cause=$cause.InnerException;$depth++
 }
 if($null -eq $cause){return $false}
 $kind=$cause.GetType().FullName
 return (($kind -ceq 'System.InvalidOperationException' -and $cause.Message -cmatch '^RUNTIME_SOURCE_PROOF_[A-Z0-9_]{1,64}$') -or
  $kind -ceq 'System.Text.DecoderFallbackException')
}
$refusal=[InvalidOperationException]::new('RUNTIME_SOURCE_PROOF_MEMBER_CHANGED')
$deep=$refusal
for($i=0;$i -lt 5;$i++){$deep=[Reflection.TargetInvocationException]::new($deep)}
$wrapperCases=@(
 @{error=$refusal;expected=$true},
 @{error=[InvalidOperationException]::new('RUNTIME_SOURCE_PROOF_BASE64');expected=$true},
 @{error=[Reflection.TargetInvocationException]::new($refusal);expected=$true},
 @{error=[Reflection.TargetInvocationException]::new([Reflection.TargetInvocationException]::new($refusal));expected=$true},
 @{error=[Text.DecoderFallbackException]::new('fixture');expected=$true},
 @{error=[Exception]::new('RUNTIME_SOURCE_PROOF_MEMBER_CHANGED');expected=$false},
 @{error=[Exception]::new('unknown wrapper',$refusal);expected=$false},
 @{error=[InvalidOperationException]::new('UNRELATED_FAILURE');expected=$false},
 @{error=$deep;expected=$false}
)
$wrapperCount=0
foreach($case in $wrapperCases){
 if((Test-ExpectedSourceProofRefusal $case.error) -ne [bool]$case.expected){throw 'NATIVE_SOURCE_WRAPPER_FIXTURE_FAILED'}
 $wrapperCount++
}
# Capture the actual PowerShell adapter around this exact reflection boundary.
# Only the two known wrappers above may be unwrapped; unknown chains still fail.
$observedWrapper=$null
$invalidArgs=[object[]]::new(2)
$invalidArgs[0]='invalid wire'
$invalidArgs[1]=[Stephanos.Sovereign.FixedRuntimeManifestFileV1[]]::new(0)
try{[void]$verify.Invoke($null,$invalidArgs)}
catch{$observedWrapper=$_.Exception}
if($null -eq $observedWrapper -or -not (Test-ExpectedSourceProofRefusal $observedWrapper)){throw 'NATIVE_SOURCE_ACTUAL_WRAPPER_UNPROVEN'}
[Console]::WriteLine('NATIVE_SOURCE_WRAPPER_OBSERVED:'+$observedWrapper.GetType().FullName)
$wrapperCount++
[Console]::WriteLine('NATIVE_SOURCE_WRAPPER_FIXTURE_PASS_'+$wrapperCount)
$count=0
foreach($row in $rows){
 $count++;$indexText=$count.ToString([Globalization.CultureInfo]::InvariantCulture)
 $label=[string]$row['name']
 if($label.Length -lt 1 -or $label.Length -gt 120 -or $label -cmatch '[^\x20-\x7e]'){throw 'NATIVE_SOURCE_VECTOR_LABEL_UNPROVEN'}
 [Console]::WriteLine('NATIVE_SOURCE_VECTOR_START_'+$indexText+':'+$label)
 $members=[Collections.Generic.List[Stephanos.Sovereign.FixedRuntimeManifestFileV1]]::new()
 foreach($item in $row['members']){
  $member=[Stephanos.Sovereign.FixedRuntimeManifestFileV1]::new()
  $member.Path=[string]$item['Path'];$member.GitBlobSha=[string]$item['GitBlobSha'];$member.GitMode=[string]$item['GitMode']
  $members.Add($member)
 }
 $accepted=$false;$proof=$null
 try{$proof=$verify.Invoke($null,@([string]$row['raw'],$members.ToArray()));$accepted=$true}
 catch{
  if(-not (Test-ExpectedSourceProofRefusal $_.Exception)){
   [Console]::WriteLine('NATIVE_SOURCE_VECTOR_RESULT_'+$indexText+':UNEXPECTED_EXCEPTION:'+$label)
   throw 'NATIVE_SOURCE_VECTOR_UNEXPECTED_EXCEPTION'
  }
 }
 $disposition=if($accepted){'ACCEPTED'}else{'REJECTED'}
 [Console]::WriteLine('NATIVE_SOURCE_VECTOR_RESULT_'+$indexText+':'+$disposition+':'+$label)
 if($accepted -ne [bool]$row['valid']){throw ('NATIVE_MEMBERSHIP_VECTOR_FAILED:'+ $row['name'])}
 if($accepted){
  $instance=[Reflection.BindingFlags]'NonPublic,Instance'
  if($proof.GetType().GetField('Digest',$instance).GetValue($proof) -cne [string]$row['expectedDigest']){throw 'NATIVE_PROOF_DIGEST_CHANGED'}
  if($proof.GetType().GetField('Closure',$instance).GetValue($proof) -cne [string]$row['expectedClosure']){throw 'NATIVE_CLOSURE_CHANGED'}
 }
}
[Console]::WriteLine('NATIVE_SOURCE_MEMBERSHIP_FIXTURE_PASS_'+$count)
`.replace('__NATIVE__',native.map(name=>literal(fileURLToPath(new URL('./windows/'+name,import.meta.url)))).join(','))
    .replace('__INPUT__',literal(input)).replace('__INPUT_HASH__',hash(payload));
  writeFileSync(driver,script,{encoding:'utf8',flag:'wx'});
  const bootstrap="$ErrorActionPreference='Stop';$b=[IO.File]::ReadAllBytes("+literal(driver)+");"
    +"$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};"
    +"if($h -cne '"+hash(script)+"'){throw 'FIXTURE_DRIVER_CHANGED'};& ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($b)))";
  let out;
  try {out=execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(bootstrap,'utf16le').toString('base64')],
    {encoding:'utf8',windowsHide:true,timeout:55000,maxBuffer:65536});}
  catch(error) {
    // Report bounded fixture labels and outcomes, never proof payloads or the
    // encoded invocation. Unknown driver failures remain failures.
    const diagnostics=String(error.stdout??'').split(/\r?\n/)
      .filter(line=>/^NATIVE_SOURCE_(?:VECTOR_(?:START|RESULT)_[0-9]+:|WRAPPER_)/.test(line))
      .map(line=>line.slice(0,240)).slice(-8);
    const codes=[...new Set(String(error.stderr??'').match(/\b(?:NATIVE_SOURCE|FIXTURE)_[A-Z_]{1,80}\b/g)??[])].slice(0,8);
    throw new Error(['NATIVE_SOURCE_DRIVER_FAILED_EXIT_'+String(error.status??'UNKNOWN'),...diagnostics,...codes].join('\n'));
  }
  finally {unlinkSync(driver);unlinkSync(input);rmdirSync(directory);}
  const lines=out.trim().split(/\r?\n/);
  assert.match(lines[0],/^NATIVE_SOURCE_WRAPPER_OBSERVED:(?:System\.Reflection\.TargetInvocationException|System\.Management\.Automation\.MethodInvocationException|System\.InvalidOperationException)$/);
  assert.equal(lines[1],'NATIVE_SOURCE_WRAPPER_FIXTURE_PASS_10');
  assert.equal(lines.length,3+2*vectors.length);
  for(const [index,vector]of vectors.entries()) {
    assert.equal(lines[2+2*index],'NATIVE_SOURCE_VECTOR_START_'+(index+1)+':'+vector.name);
    assert.equal(lines[3+2*index],'NATIVE_SOURCE_VECTOR_RESULT_'+(index+1)+':'+(vector.valid?'ACCEPTED':'REJECTED')+':'+vector.name);
  }
  assert.equal(lines.at(-1),'NATIVE_SOURCE_MEMBERSHIP_FIXTURE_PASS_'+vectors.length);
});
