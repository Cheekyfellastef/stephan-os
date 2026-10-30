import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const after=fs.readFileSync(new URL('../../scripts/windows/install-sovereign-boot-daemon-tasks-elevated.ps1',import.meta.url),'utf8');
const producer=fs.readFileSync(new URL('../../scripts/windows/install-battle-bridge-recovery-mesh.ps1',import.meta.url),'utf8');
const validator=after.slice(after.indexOf('function Test-BootInstallerReceipt {'),after.indexOf('function Get-BootTaskProof {'));
const taskProof=after.slice(after.indexOf('function Get-BootTaskProof {'),after.indexOf('\nAssert-CanonicalSource',after.indexOf('function Get-BootTaskProof {')));
function ps(script){
 const r=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from("$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\nSet-StrictMode -Version Latest\n"+script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:30000});
 assert.ifError(r.error);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim());
}
test('real producer expression exposes original missing-verdict defect and qualifies only complete typed receipts',{skip:process.platform!=='win32'},()=>{
 const rows=ps(`
$taskName='Stephanos Battle Bridge Recovery Mesh';$guardianTaskName='Stephanos Battle Bridge Recovery Mesh Guardian'
$registrationApplied=$true;$registrationMutated=$false;$existingRecoveryTaskCanonical=$true;$startApplied=$true;$taskPresentAfter=$true
$guardianRegistrationApplied=$true;$guardianRegistrationMutated=$false;$guardianReusedCanonicalTask=$true;$guardianStartApplied=$true;$guardianTaskPresentAfter=$true
$RecoveryMeshOnly=$false;$WhatIfPreference=$false
$raw = & { ${producer.slice(producer.lastIndexOf('[pscustomobject]@{'))} } | Out-String
$receipt=$raw|ConvertFrom-Json
$originalThrows=$false
try { [void]$receipt.finalVerdict } catch { $originalThrows=$true }
${validator}
$rows=@([pscustomobject]@{name='actual-producer';pass=(Test-BootInstallerReceipt -Receipt $receipt -Kind RecoveryMesh);originalThrows=$originalThrows})
foreach($field in @('schemaVersion','installed','startedNow','guardianInstalled','guardianStartedNow','taskPresentAfter','guardianTaskPresentAfter','whatIf','recoveryMeshOnly','atStartup','logonType','runLevel','guardianAuthority')){
 foreach($change in @('missing','wrong-type','wrong-value','null')){
  $copy=$raw|ConvertFrom-Json
  if($change -eq 'missing'){$copy.PSObject.Properties.Remove($field)}elseif($change -eq 'wrong-type'){$copy.$field=@($copy.$field)}elseif($change -eq 'null'){$copy.$field=$null}elseif($copy.$field -is [bool]){$copy.$field=-not $copy.$field}else{$copy.$field='FOREIGN'}
  $rows += [pscustomobject]@{name=$field+':'+$change;pass=(Test-BootInstallerReceipt -Receipt $copy -Kind RecoveryMesh)}
 }
}
$rows += [pscustomobject]@{name='array';pass=(Test-BootInstallerReceipt -Receipt @($receipt,$receipt) -Kind RecoveryMesh)}
$rows += [pscustomobject]@{name='null';pass=(Test-BootInstallerReceipt -Receipt $null -Kind RecoveryMesh)}
foreach($field in @('installed','startedNow','guardianInstalled','guardianStartedNow','taskPresentAfter','guardianTaskPresentAfter','whatIf','recoveryMeshOnly','atStartup')){
 $copy=$raw|ConvertFrom-Json;$copy.$field=$copy.$field.ToString()
 $rows += [pscustomobject]@{name=$field+':coerced-string';pass=(Test-BootInstallerReceipt -Receipt $copy -Kind RecoveryMesh)}
}
$rows|ConvertTo-Json -Depth 5
`);
 assert.equal(rows[0].originalThrows,true);assert.equal(rows[0].pass,true);
 for(const r of rows.slice(1))assert.equal(r.pass,false,r.name);
 assert.equal(rows.length,64);
});
test('observed persisted XML default omission requires independently Limited live CIM principal',{skip:process.platform!=='win32'},()=>{
 const rows=ps(`
$wscriptExe='C:\\Windows\\System32\\wscript.exe'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent();$sid=$identity.User.Value;$account=$identity.Name;$identity.Dispose()
$service=New-Object -ComObject 'Schedule.Service';$service.Connect()
$definition=$service.NewTask(0)
$definition.Principal.UserId=$sid;$definition.Principal.LogonType=3;$definition.Principal.RunLevel=0
$definition.Settings.Hidden=$true;$definition.Settings.StartWhenAvailable=$true;$definition.Settings.MultipleInstances=2
$definition.Settings.RestartCount=3;$definition.Settings.RestartInterval='PT1M'
[void]$definition.Triggers.Create(8)
$logon=$definition.Triggers.Create(9);$logon.UserId=$account
$action=$definition.Actions.Create(0);$action.Path=$wscriptExe;$action.Arguments='fixed-arguments'
$serialized=$definition.XmlText
# Live Export-ScheduledTask omitted this default in the real incident. Model that
# observed persisted representation; do not claim a working COM object is a registration.
[xml]$persisted=$serialized
$defaultNode=$persisted.SelectSingleNode("/*[local-name()='Task']/*[local-name()='Principals']/*[local-name()='Principal']/*[local-name()='RunLevel']")
if($null -ne $defaultNode){[void]$defaultNode.ParentNode.RemoveChild($defaultNode)}
$originalXml=$persisted.OuterXml
$hasRunLevel=$originalXml.Contains('<RunLevel>')
$principal=New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
$taskAction=New-ScheduledTaskAction -Execute $wscriptExe -Argument 'fixed-arguments'
$script:fixture=[pscustomobject]@{Actions=@($taskAction);Principal=$principal}
$script:xmlText=$originalXml
function Get-ScheduledTask { param($TaskName,$ErrorAction) $script:fixture }
function Export-ScheduledTask { param($TaskName) $script:xmlText }
${taskProof}
$rows=@()
foreach($case in @('native-default','explicit-limited','xml-highest','duplicate-runlevel','empty-runlevel','foreign-runlevel','foreign-root','cim-highest','cim-missing','cim-string','wrong-user','extra-action','missing-logon','other-s4u')){
 $script:fixture=[pscustomobject]@{Actions=@($taskAction);Principal=$principal};$script:xmlText=$originalXml
 if($case -eq 'explicit-limited'){$script:xmlText=$originalXml.Replace('</Principal>','<RunLevel>LeastPrivilege</RunLevel></Principal>')}
 if($case -eq 'xml-highest'){$script:xmlText=$originalXml.Replace('</Principal>','<RunLevel>HighestAvailable</RunLevel></Principal>')}
 if($case -eq 'duplicate-runlevel'){$script:xmlText=$originalXml.Replace('</Principal>','<RunLevel>LeastPrivilege</RunLevel><RunLevel>HighestAvailable</RunLevel></Principal>')}
 if($case -eq 'empty-runlevel'){$script:xmlText=$originalXml.Replace('</Principal>','<RunLevel /></Principal>')}
 if($case -eq 'foreign-runlevel'){$script:xmlText=$originalXml.Replace('</Principal>','<RunLevel xmlns="urn:foreign">LeastPrivilege</RunLevel></Principal>')}
 if($case -eq 'foreign-root'){$script:xmlText=$originalXml.Replace('http://schemas.microsoft.com/windows/2004/02/mit/task','urn:foreign')}
 if($case -eq 'cim-highest'){$script:fixture.Principal=New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Highest}
 if($case -eq 'cim-missing'){$script:fixture.Principal=$null}
 if($case -eq 'cim-string'){$script:fixture.Principal=[pscustomobject]@{RunLevel='Limited'}}
 if($case -eq 'wrong-user'){$script:xmlText=$originalXml.Replace($sid,'S-1-5-19')}
 if($case -eq 'extra-action'){$script:fixture.Actions=@($taskAction,$taskAction)}
 if($case -eq 'missing-logon'){$script:xmlText=$originalXml -replace '<LogonTrigger[\\s\\S]*?</LogonTrigger>',''}
 if($case -eq 'other-s4u'){$script:xmlText=$originalXml.Replace('InteractiveToken','S4U');$script:fixture.Principal=New-ScheduledTaskPrincipal -UserId $sid -LogonType S4U -RunLevel Limited}
 $ok=$false;$runtime=$false
 try{$proof=Get-BootTaskProof -TaskName 'fixture-only-never-registered' -ExpectedArguments 'fixed-arguments' -RequiresInteractiveOperator:($case -ne 'other-s4u');$ok=$proof.configurationVerified;$runtime=$proof.normalOperatorRuntimeProven}catch{}
 $rows += [pscustomobject]@{name=$case;pass=$ok;runtime=$runtime;nativeXmlContainsRunLevel=$hasRunLevel}
}
$rows|ConvertTo-Json -Depth 5
`);
 assert.equal(rows[0].nativeXmlContainsRunLevel,false);
 for(const r of rows){assert.equal(r.pass,['native-default','explicit-limited','other-s4u'].includes(r.name),r.name);assert.equal(r.runtime,false,r.name);}
});
test('candidate still requires full receipt and actual definition proof before emitting success',()=>{
 assert.match(after,/Test-BootInstallerReceipt -Receipt \$recoveryReceipt -Kind RecoveryMesh/);
 assert.match(after,/BOOT_TASK_DEFINITION_UNREADABLE/);
 assert.match(after,/if \(-not \$allConfigurationsVerified\).*BOOT_TASK_LIFECYCLE_PROOF_FAILED/);
 assert.match(after,/normalOperatorRuntimeProven = \$false/);
});
