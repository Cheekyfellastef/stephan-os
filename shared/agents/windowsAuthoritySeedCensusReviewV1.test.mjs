import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {analyzeWindowsAuthoritySeedCensusReviewV1 as analyze,SEED_CENSUS_SPECIALIST_PATHS_V1,SEED_CENSUS_SPECIALIST_BLOB_V1} from './windowsAuthoritySeedCensusReviewV1.mjs';
import {analyzeWindowsAuthoritySpecialistReview as router} from './windowsAuthoritySpecialistReviewV1.mjs';
const SOURCE="# Candidate read-only Windows process census for seed #3096.\n# Not installed or commissioned. Never terminates a process, starts a model,\n# signs custody evidence, validates Windows Job membership, or proves GPU eviction.\n[CmdletBinding()]\nparam(\n    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$RouterPid\n)\nSet-StrictMode -Version Latest\n$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n\nfunction Format-Utc {\n    param([datetime]$Value)\n    return $Value.ToUniversalTime().ToString(\n        'yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)\n}\n\n$enumerationStarted = Format-Utc -Value ([datetime]::UtcNow)\n$complete = $true\n$records = @()\n$routerHash = $null\ntry {\n    # This is a process-wide read-only enumeration, not a targeted kill query.\n    $all = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)\n    if ($all.Count -gt 8192) { throw 'Census exceeds safe bound' }\n    foreach ($process in $all) {\n        if ($null -eq $process.CreationDate) {\n            $complete = $false\n            continue\n        }\n        $records += [pscustomobject]@{\n            pid = [int]$process.ProcessId\n            parentPid = [int]$process.ParentProcessId\n            startedAtUtc = Format-Utc -Value ([datetime]$process.CreationDate)\n        }\n        if ([int]$process.ProcessId -eq $RouterPid) {\n            if ([string]::IsNullOrWhiteSpace([string]$process.ExecutablePath)) {\n                $complete = $false\n            } else {\n                try {\n                    $routerHash = ([string](Get-FileHash -LiteralPath $process.ExecutablePath -Algorithm SHA256 -ErrorAction Stop).Hash).ToLowerInvariant()\n                } catch { $complete = $false }\n            }\n        }\n    }\n} catch {\n    # On failed enumeration no partial list is authoritative.\n    $complete = $false\n    $records = @()\n    $routerHash = $null\n}\n$enumerationFinished = Format-Utc -Value ([datetime]::UtcNow)\n$result = [ordered]@{\n    schemaVersion = 'stephanos.llama-windows-census.v1'\n    observedAtUtc = $enumerationFinished\n    enumerationStartedAtUtc = $enumerationStarted\n    enumerationFinishedAtUtc = $enumerationFinished\n    enumerationComplete = [bool]$complete\n    processes = @($records)\n    routerExecutableSha256 = $routerHash\n    # No positive custody or no-residency claim is possible from this script.\n    windowsJobVerified = $false\n    gpuResidencyMeasured = $false\n    independentSignerVerified = $false\n    physicalCustodyQualified = $false\n}\n$result | ConvertTo-Json -Depth 5 -Compress\n",PATH=SEED_CENSUS_SPECIALIST_PATHS_V1[0],HEAD='c5b043146527b5e04280f82096f4b06aa71414d5';
const hash=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function input(overrides={}){
 return {repository:'Cheekyfellastef/stephan-os',prNumber:3138,
 branch:'seed-parallel/3096-llamacpp-governor-contract-v1',
 sourceHead:HEAD,baseSha:'b2b3391456f8adbb768a9b27b094af17bb84f891',
 analysis:{findings:[{severity:'P0',code:'unsupported-high-risk-surface',path:PATH}],
 counts:{P0:1,P1:0,P2:0}},
 sources:[{schemaVersion:'stephanos.windows-authority-source.v1',
 repository:'Cheekyfellastef/stephan-os',path:PATH,ref:HEAD,
 exists:true,size:Buffer.byteLength(SOURCE),blobSha:hash(SOURCE),content:SOURCE}],
 ...overrides};
}
test('exact original Seed script and existing router qualify only read-only source bytes',()=>{
 assert.equal(hash(SOURCE),SEED_CENSUS_SPECIALIST_BLOB_V1);
 assert.match(SOURCE,/Get-CimInstance -ClassName Win32_Process/);
 assert.match(SOURCE,/physicalCustodyQualified = \$false/);
 const r=router(input());assert.equal(r.eligible,true);assert.equal(r.clean,true);
 assert.deepEqual(r.reviewedPaths,[PATH]);
 for(const k of ['sourceMutationAllowed','mergeAuthority','runtimeMutationAllowed',
 'providerQualificationAuthority','independentSignerVerified',
 'physicalCustodyQualified','gpuResidencyMeasured','safetyHoldMayBeRemoved'])
 assert.equal(r[k],false,k);
});
test('mutated bytes, synthetic digest, swapped ref, extra source and forged custody stay P0',()=>{
 const x=input().sources[0];
 for(const altered of [
 {...x,content:SOURCE+'\nStop-Process -Id 42'},
 {...x,blobSha:'f'.repeat(40)}, {...x,ref:'f'.repeat(40)},
 {...x,size:999}, {...x,path:'scripts/windows/other.ps1'},
 {...x,exists:false},
 ]){
 const r=analyze(input({sources:[altered]}));
 assert.equal(r.eligible,true);assert.equal(r.clean,false);assert.equal(r.findings[0].severity,'P0');
 assert.equal(r.safetyHoldMayBeRemoved,false);
 }
 assert.equal(analyze(input({sources:[x,x]})).clean,false);
});
test('different source owner or P0 inventory never receives specialist relief',()=>{
 const normal=input();
 for(const change of [{prNumber:42},{branch:'another'},{repository:'evil/repo'},
 {sourceHead:'bad'},{baseSha:'bad'},
 {analysis:{findings:[],counts:{P0:0,P1:0,P2:0}}},
 {analysis:{findings:[normal.analysis.findings[0],normal.analysis.findings[0]],counts:{P0:2,P1:0,P2:0}}}]){
 const r=analyze(input(change));assert.equal(r.eligible,false);assert.equal(r.clean,false);
 assert.equal(r.mergeAuthority,false);
 }
});
