param([string]$Directory,[string]$ManifestSha256)
$ErrorActionPreference='Stop'
Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
$utf8=[Text.UTF8Encoding]::new($false,$true)
function Digest([byte[]]$b){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
$base=[IO.Path]::Combine([IO.Path]::GetTempPath(),'StephanosMobileEnrollmentFixture-')
if(-not $Directory.StartsWith($base,[StringComparison]::Ordinal) -or $Directory.Substring($base.Length) -cnotmatch '^[a-f0-9]{32}$'){throw 'FIXTURE_DIRECTORY_REFUSED'}
$manifestBytes=[IO.File]::ReadAllBytes([IO.Path]::Combine($Directory,'manifest.json'))
if((Digest $manifestBytes) -cne $ManifestSha256){throw 'FIXTURE_MANIFEST_CHANGED'}
$manifest=$utf8.GetString($manifestBytes)|ConvertFrom-Json
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
try{if($identity.User.Value -cne $manifest.operatorSid -or -not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ACTUAL_FIXTURE_ADMIN_REQUIRED'}}finally{$identity.Dispose()}
$attempt=[DateTime]::UtcNow.Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
$resultName='result-'+$attempt+'.json'
$results=[Collections.Generic.List[object]]::new()
foreach($row in $manifest.rows) {
 $record=@{phase=$row.phase;id=$row.id;ok=$false;productionMutation=$false;cleanupComplete=$false}
 $createdRoot=$false;$createdLog=$false;$createdTask=$false;$createdTaskReceipt=$null;$outerRetainedTask=$false;$outerRetainedXml=$null
 try {
  $id=[string]$row.id
  if($id -cnotmatch '^[a-f0-9]{32}$' -or $row.root -cne ('C:\Program Files\Stephanos\MobileInstallFixture-'+$id) -or
   $row.key -cne ('Stephanos.MobileInstallFixture.'+$id+'.Receipt') -or $row.log -cne ('CF'+$id) -or
   $row.source -cne ('StephanosFixture'+$id) -or $row.task -cne ('Stephanos Mobile Installer Fixture '+$id)){throw 'FIXTURE_CLOSED_TARGET_REQUIRED'}
  if([IO.Directory]::Exists($row.root) -or [IO.File]::Exists($row.root) -or
   [Security.Cryptography.CngKey]::Exists($row.key,[Security.Cryptography.CngProvider]::MicrosoftSoftwareKeyStorageProvider,[Security.Cryptography.CngKeyOpenOptions]::MachineKey) -or
   [Diagnostics.EventLog]::SourceExists($row.source) -or [Diagnostics.EventLog]::Exists($row.log)){throw 'FIXTURE_EXISTING_OBJECT_COLLISION'}
  # This outer regression owns a retained task; the attempted harness run
  # must reject it before effects and preserve it. Outer cleanup is separate.
  if($row.phase -ceq 'TASK_COLLISION') {
   $outerService=[Activator]::CreateInstance([Type]::GetTypeFromProgID('Schedule.Service',$true));$outerFolder=$null;$outerTask=$null
   try {
    $outerService.Connect();$outerFolder=$outerService.GetFolder('\');$definition=$outerService.NewTask(0)
    $definition.RegistrationInfo.URI='urn:stephanos:retained-fixture:'+$id
    $definition.Principal.UserId=$manifest.operatorSid;$definition.Principal.LogonType=3;$definition.Principal.RunLevel=0;$definition.Settings.Enabled=$false
    $action=$definition.Actions.Create(0);$action.Path='C:\Windows\System32\cmd.exe';$action.Arguments='/c exit 0'
    $outerTask=$outerFolder.RegisterTaskDefinition($row.task,$definition,0x12,$manifest.operatorSid,$null,3,'O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)')
    $outerRetainedXml=[string]$outerTask.Xml;$outerRetainedTask=$true
   }finally{foreach($com in @($outerTask,$outerFolder,$outerService)){if($null -ne $com -and [Runtime.InteropServices.Marshal]::IsComObject($com)){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($com)}}}
  }
  # Admission is per-object. Log creation never grants task cleanup ownership.
  $collisionService=[Activator]::CreateInstance([Type]::GetTypeFromProgID('Schedule.Service',$true));$collisionFolder=$null;$collisionTask=$null
  try {
   $collisionService.Connect();$collisionFolder=$collisionService.GetFolder('\')
   try{$collisionTask=$collisionFolder.GetTask($row.task)}catch{if($_.Exception.HResult -ne -2147024894){throw}}
   if($null -ne $collisionTask){throw 'FIXTURE_EXISTING_TASK_COLLISION'}
  }finally{foreach($com in @($collisionTask,$collisionFolder,$collisionService)){if($null -ne $com -and [Runtime.InteropServices.Marshal]::IsComObject($com)){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($com)}}}
  $payloadBytes=[IO.File]::ReadAllBytes([IO.Path]::Combine($Directory,$id+'.json'))
  if((Digest $payloadBytes) -cne $row.payloadSha256){throw 'FIXTURE_PAYLOAD_CHANGED'}
  $data=$utf8.GetString($payloadBytes)|ConvertFrom-Json
  if($data.SourceHead -cne $row.head -or $data.SourceTree -cne $row.tree){throw 'FIXTURE_SOURCE_CHANGED'}
  # Log registration happens in a separate bounded test process. Native
  # production enrollment still consumes its already-existing retained journal.
  $logSetup=@'
param([string]$log,[string]$source,[string]$sid)
$ErrorActionPreference='Stop'
if($log -cnotmatch '^CF[a-f0-9]{32}$' -or $source -cne ('StephanosFixture'+$log.Substring(2)) -or $sid -cnotmatch '^S-1-5-21-[0-9-]+$'){throw 'FIXTURE_LOG_CREATOR_TARGET_REFUSED'}
$row=@{log=$log;source=$source};$manifest=@{operatorSid=$sid}
  $creation=[Diagnostics.EventSourceCreationData]::new($row.source,$row.log)
  [Diagnostics.EventLog]::CreateEventSource($creation);
  $config=[Diagnostics.Eventing.Reader.EventLogConfiguration]::new($row.log)
  try {
   $config.LogMode=[Diagnostics.Eventing.Reader.EventLogMode]::Retain;$config.MaximumSizeInBytes=67108864
   $config.SecurityDescriptor='O:BAG:SYD:P(A;;0xf0007;;;SY)(A;;0xf0007;;;BA)(A;;0x3;;;'+$manifest.operatorSid+')'
   $config.SaveChanges()
  }finally{$config.Dispose()}
  # Preserve the OS-created registry read permissions. The unchanged native
  # verifier independently rejects any disallowed writer/owner on either key.
  $writer=[Diagnostics.EventLog]::new($row.log);$writer.Source=$row.source
  try{$writer.WriteEntry('SOVEREIGN_MAINTENANCE_BOOTSTRAP_V2=NON_AUTHORITY',[Diagnostics.EventLogEntryType]::Information,62516)}finally{$writer.Dispose()}

'@
  $createCommand='& {'+$logSetup+"} -log '"+$row.log+"' -source '"+$row.source+"' -sid '"+$manifest.operatorSid+"'"
  $createInfo=[Diagnostics.ProcessStartInfo]::new('C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe')
  $createInfo.Arguments='-NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($createCommand))
  $createInfo.UseShellExecute=$false;$createInfo.CreateNoWindow=$true;$createInfo.RedirectStandardError=$true
  $createdLog=$true;$creator=[Diagnostics.Process]::Start($createInfo)
  try{if(-not $creator.WaitForExit(20000)){$creator.Kill();throw 'OWN_ISOLATED_LOG_CREATOR_TIMEOUT'};if($creator.ExitCode -ne 0){throw ('FIXTURE_LOG_CREATION_FAILED:'+ $creator.StandardError.ReadToEnd())}}finally{$creator.Dispose()}
  $auditClock=[Diagnostics.Stopwatch]::StartNew()
  do {
   $auditQuery=[Diagnostics.Eventing.Reader.EventLogQuery]::new($row.log,[Diagnostics.Eventing.Reader.PathType]::LogName,'*')
   $auditReader=[Diagnostics.Eventing.Reader.EventLogReader]::new($auditQuery)
   try{$auditRow=$auditReader.ReadEvent([TimeSpan]::FromSeconds(1));try{if($null -ne $auditRow){$record.bootstrap=@{recordId=$auditRow.RecordId;eventId=$auditRow.Id;source=$auditRow.ProviderName;count=$auditRow.Properties.Count;xml=$auditRow.ToXml()}}}finally{if($null -ne $auditRow){$auditRow.Dispose()}}}finally{$auditReader.Dispose()}
   if($null -eq $record.bootstrap){[Threading.Thread]::Sleep(100)}
  }while($null -eq $record.bootstrap -and $auditClock.ElapsedMilliseconds -lt 20000)
  if($null -eq $record.bootstrap){throw 'ISOLATED_LOG_BOOTSTRAP_NOT_MATERIALIZED'}
  $script:MobileInstallerEnrollmentPinnedBootstrapV1=$data
  $entry=@($data.Records|Where-Object{$_.Path -ceq 'scripts/windows/install-battle-bridge-mobile-installer-v1.ps1'})
  if($entry.Count -ne 1){throw 'FIXTURE_ENTRY_NOT_UNIQUE'}
  $source=$utf8.GetString([Convert]::FromBase64String($entry[0].ContentBase64))
  if((Digest ([Convert]::FromBase64String($entry[0].ContentBase64))) -cne $entry[0].Sha256){throw 'FIXTURE_ENTRY_CHANGED'}
  $script:MobileEnrollmentFixtureTaskCreatedV2=$null
  $outcome='';$stopped='';$priorConsole=[Console]::Out;$setupOutput=[IO.StringWriter]::new()
  try {[Console]::SetOut($setupOutput);$outcome=(& ([scriptblock]::Create($source)) -OperatorApproved -ExpectedMain $row.head)|Out-String;$outcome+=$setupOutput.ToString()}
  catch {$e=$_.Exception;while($null -ne $e.InnerException){$e=$e.InnerException};$stopped=$e.GetType().FullName+':'+$e.Message}
  finally{[Console]::SetOut($priorConsole);$setupOutput.Dispose();$script:MobileInstallerEnrollmentPinnedBootstrapV1=$null;$createdRoot=[IO.Directory]::Exists($row.root);$createdTaskReceipt=$script:MobileEnrollmentFixtureTaskCreatedV2;$createdTask=$null -ne $createdTaskReceipt;$script:MobileEnrollmentFixtureTaskCreatedV2=$null}
  $record.stopped=$stopped;$record.staged=$outcome.Contains('MOBILE_INSTALLER_ENROLLMENT_STAGED_V1=')
  $inspectService=$null;$inspectFolder=$null;$inspectTask=$null
  try {
   $inspectService=[Activator]::CreateInstance([Type]::GetTypeFromProgID('Schedule.Service',$true));$inspectService.Connect();$inspectFolder=$inspectService.GetFolder('\')
   try{$inspectTask=$inspectFolder.GetTask($row.task)}catch{if($_.Exception.HResult -ne -2147024894){throw}}
   if($null -ne $inspectTask){$d=$inspectTask.Definition;$a=$d.Actions.Item(1);$record.taskObserved=@{sddl=$inspectTask.GetSecurityDescriptor(7);principal=$d.Principal.UserId;logon=$d.Principal.LogonType;runLevel=$d.Principal.RunLevel;actionCount=$d.Actions.Count;triggers=$d.Triggers.Count;multipleInstances=$d.Settings.MultipleInstances;enabled=$d.Settings.Enabled;actionType=$a.Type;path=$a.Path;arguments=$a.Arguments;directory=$a.WorkingDirectory}}
  }finally{foreach($com in @($inspectTask,$inspectFolder,$inspectService)){if($null -ne $com -and [Runtime.InteropServices.Marshal]::IsComObject($com)){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($com)}}}
  if($row.phase -ceq 'COMPLETE'){if($stopped -ne '' -or -not $record.staged){throw ('COMPLETE_SETUP_FAILED:'+ $stopped)}}
  elseif($stopped -cne ('System.Management.Automation.RuntimeException:ISOLATED_STOP_'+$row.phase) -and $stopped -cne ('System.Management.Automation.RuntimeException:ISOLATED_STOP_'+$row.phase)){throw ('UNEXPECTED_PHASE_FAILURE:'+ $stopped)}
  $record.keyPresent=[Security.Cryptography.CngKey]::Exists($row.key,[Security.Cryptography.CngProvider]::MicrosoftSoftwareKeyStorageProvider,[Security.Cryptography.CngKeyOpenOptions]::MachineKey)
  $qualified=$false
  if([IO.File]::Exists([IO.Path]::Combine($row.root,'installer.exe'))) {
   $start=[Diagnostics.ProcessStartInfo]::new([IO.Path]::Combine($row.root,'installer.exe'))
   $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true;$start.EnvironmentVariables['STEPHANOS_ISOLATED_PROOF']=$id
   $child=[Diagnostics.Process]::Start($start)
   try {
    if(-not $child.WaitForExit(15000)){$child.Kill();throw 'OWN_ISOLATED_PROOF_CHILD_TIMEOUT'}
    $text=$child.StandardOutput.ReadToEnd();$errorText=$child.StandardError.ReadToEnd()
    $qualified=$child.ExitCode -eq 0 -and $text.Contains('ISOLATED_NATIVE_QUALIFIED_READBACK_OK')
    $record.nativeExit=$child.ExitCode;$record.nativeError=$errorText;$record.nativeOutput=$text
   }finally{$child.Dispose()}
  }
  $record.nativeQualified=$qualified
  $expectedQualified=$row.phase -cin @('CERTIFICATE','READBACK','COMPLETE')
  if($qualified -ne $expectedQualified){throw 'ACTUAL_NATIVE_QUALIFICATION_PHASE_MISMATCH'}
  $recoveryBytes=[IO.File]::ReadAllBytes([IO.Path]::Combine($Directory,$id+'-recovery.json'))
  if((Digest $recoveryBytes) -cne $row.recoverySha256){throw 'ISOLATED_RECOVERY_SOURCE_CHANGED'}
  $recovery=$utf8.GetString($recoveryBytes)|ConvertFrom-Json
  $retirementEntry=@($recovery.records|Where-Object{$_.Path -ceq 'scripts/windows/retire-battle-bridge-mobile-key-v1.ps1'})
  if($retirementEntry.Count -ne 1){throw 'ISOLATED_RETIREMENT_ENTRY_REQUIRED'}
  $retirementText=$utf8.GetString([Convert]::FromBase64String($retirementEntry[0].ContentBase64))
  function Invoke-IsolatedRetirement([string]$Mode,[string]$KeyHash,[string]$Fingerprint) {
   $script:MobileInstallerKeyRetirementPinnedV1=[pscustomobject]@{SourceHead=$row.head;SourceTree=$row.tree;OperatorSid=$manifest.operatorSid;MachineHash=$manifest.machineHash;Mode=$Mode;Fingerprint=$Fingerprint;KeySha256=$KeyHash;Records=$recovery.records}
   $previous=[Console]::Out;$captured=[IO.StringWriter]::new()
   try {
    [Console]::SetOut($captured)
    if($Mode -ceq 'Retire'){& ([scriptblock]::Create($retirementText)) -Mode $Mode -OperatorApproved -ExpectedMain $row.head -ExpectedFingerprint $Fingerprint -ExpectedKeySha256 $KeyHash}
    else{& ([scriptblock]::Create($retirementText)) -Mode $Mode -ExpectedMain $row.head -ExpectedKeySha256 $KeyHash}
    return ($captured.ToString()|ConvertFrom-Json)
   }finally{[Console]::SetOut($previous);$captured.Dispose();$script:MobileInstallerKeyRetirementPinnedV1=$null}
  }
  $keyHash='0'*64
  if($record.keyPresent) {
   $publicKey=[Security.Cryptography.CngKey]::Open($row.key,[Security.Cryptography.CngProvider]::MicrosoftSoftwareKeyStorageProvider,[Security.Cryptography.CngKeyOpenOptions]::MachineKey)
   try{$blob=$publicKey.Export([Security.Cryptography.CngKeyBlobFormat]::EccPublicBlob);$spki=[byte[]]@(0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x03,0x42,0x00,0x04)+$blob[8..71];$keyHash=Digest $spki}finally{$publicKey.Dispose()}
  }
  $observation=$null;$retirementRefused=$false
  try{$observation=Invoke-IsolatedRetirement 'Observe' $keyHash ''}catch{$retirementRefused=$true;$e=$_.Exception;while($null -ne $e.InnerException){$e=$e.InnerException};$record.retirementHold=$e.Message}
  $record.keyOnlyRetirementEligible=$null -ne $observation
  if($row.phase -cin @('KEY','KEY_RETIRE_UNKNOWN')) {
   if($retirementRefused -or $null -eq $observation -or $observation.status -cne 'EXACT_UNQUALIFIED_KEY_RETIREMENT_REVIEW_REQUIRED'){throw 'ISOLATED_KEY_ONLY_RETIREMENT_NOT_ELIGIBLE'}
   $mismatchRefused=$false;try{[void](Invoke-IsolatedRetirement 'Retire' $keyHash ('f'*64))}catch{$mismatchRefused=$true}
   if(-not $mismatchRefused -or -not [Security.Cryptography.CngKey]::Exists($row.key,[Security.Cryptography.CngProvider]::MicrosoftSoftwareKeyStorageProvider,[Security.Cryptography.CngKeyOpenOptions]::MachineKey)){throw 'ISOLATED_WRONG_FINGERPRINT_MUTATED_KEY'}
   $record.exactFingerprintRefusal=$true
   $retired=$null;$unknown=''
   try{$retired=Invoke-IsolatedRetirement 'Retire' $keyHash $observation.fingerprint}catch{$e=$_.Exception;while($null -ne $e.InnerException){$e=$e.InnerException};$unknown=$e.Message}
   if($row.phase -ceq 'KEY_RETIRE_UNKNOWN'){if($unknown -cne 'MOBILE_RETIRE_UNKNOWN_INSPECT_ONLY_NO_RETRY'){throw ('ISOLATED_UNKNOWN_NOT_HELD:'+ $unknown)};$record.uncertainRetirementHeld=$true}
   elseif($null -eq $retired -or -not $retired.keyRetired -or $unknown -ne ''){throw ('ISOLATED_RETIREMENT_NOT_PROVEN:'+ $unknown)}
   if([Security.Cryptography.CngKey]::Exists($row.key,[Security.Cryptography.CngProvider]::MicrosoftSoftwareKeyStorageProvider,[Security.Cryptography.CngKeyOpenOptions]::MachineKey)){throw 'ISOLATED_RETIRED_KEY_STILL_EXISTS'}
   $replayRefused=$false;try{[void](Invoke-IsolatedRetirement 'Retire' $keyHash $observation.fingerprint)}catch{$replayRefused=$true}
   if(-not $replayRefused){throw 'ISOLATED_RETIREMENT_REPLAY_ACCEPTED'};$record.retirementReplayRefused=$true;$record.retirementFilesPreserved=[IO.File]::Exists([IO.Path]::Combine($row.root,'installer.exe'))
  }elseif(-not $retirementRefused){throw 'ISOLATED_UNSUPPORTED_PHASE_RETIREMENT_ACCEPTED'}
  $record.ok=$true
 }catch{
  if($row.phase -ceq 'TASK_COLLISION' -and $_.Exception.Message -ceq 'FIXTURE_EXISTING_TASK_COLLISION'){$record.expectedCollisionHeld=$true}
  else{$record.error=$_.Exception.ToString();$record.errorPosition=$_.InvocationInfo.PositionMessage;$record.errorStack=$_.ScriptStackTrace}
 }
 finally {
  # Only this freshly collision-checked closed GUID fixture is eligible for cleanup.
  # No production path, key, task, log or existing quarantine is admitted here.
  try {
   if($row.id -cnotmatch '^[a-f0-9]{32}$' -or $row.root -cne ('C:\Program Files\Stephanos\MobileInstallFixture-'+$row.id) -or
    $row.key -cne ('Stephanos.MobileInstallFixture.'+$row.id+'.Receipt') -or $row.task -cne ('Stephanos Mobile Installer Fixture '+$row.id) -or
    $row.log -cne ('CF'+$row.id)){throw 'FIXTURE_CLEANUP_TARGET_REFUSED'}
   if($createdLog) {
    $service=[Activator]::CreateInstance([Type]::GetTypeFromProgID('Schedule.Service',$true));$folder=$null
    try{
     $service.Connect();$folder=$service.GetFolder('\')
     if($createdTask) {
      $task=$folder.GetTask($row.task)
      try {
       if($createdTaskReceipt.Path -cne ('\'+$row.task) -or [string]$task.Xml -cne $createdTaskReceipt.Xml -or
        [string]$task.Definition.RegistrationInfo.URI -cne $createdTaskReceipt.Marker -or $createdTaskReceipt.Marker -cne ('urn:stephanos:mobile-fixture:'+$row.id)){throw 'FIXTURE_TASK_CREATION_OWNERSHIP_CHANGED'}
      }finally{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($task)}
      $folder.DeleteTask($row.task,0)
     }
    }
    finally{foreach($com in @($folder,$service)){if($null -ne $com){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($com)}}}
    if([Security.Cryptography.CngKey]::Exists($row.key,[Security.Cryptography.CngProvider]::MicrosoftSoftwareKeyStorageProvider,[Security.Cryptography.CngKeyOpenOptions]::MachineKey)) {
     $key=[Security.Cryptography.CngKey]::Open($row.key,[Security.Cryptography.CngProvider]::MicrosoftSoftwareKeyStorageProvider,[Security.Cryptography.CngKeyOpenOptions]::MachineKey);try{$key.Delete()}finally{$key.Dispose()}
    }
    if($createdRoot){if(([IO.Path]::GetFullPath($row.root)) -cne ('C:\Program Files\Stephanos\MobileInstallFixture-'+$row.id)){throw 'FIXTURE_RESOLVED_ROOT_REFUSED'};[IO.Directory]::Delete($row.root,$true)}
    [Diagnostics.EventLog]::Delete($row.log)
   }
   if($outerRetainedTask) {
    $outerService=[Activator]::CreateInstance([Type]::GetTypeFromProgID('Schedule.Service',$true));$outerFolder=$null;$outerTask=$null
    try {
     $outerService.Connect();$outerFolder=$outerService.GetFolder('\');$outerTask=$outerFolder.GetTask($row.task)
     if(-not $record.expectedCollisionHeld -or $createdLog -or $createdRoot -or $createdTask -or
      [string]$outerTask.Xml -cne $outerRetainedXml -or [string]$outerTask.Definition.RegistrationInfo.URI -cne ('urn:stephanos:retained-fixture:'+$row.id) -or
      [IO.Directory]::Exists($row.root) -or [IO.File]::Exists($row.root) -or [Diagnostics.EventLog]::Exists($row.log) -or
      [Security.Cryptography.CngKey]::Exists($row.key,[Security.Cryptography.CngProvider]::MicrosoftSoftwareKeyStorageProvider,[Security.Cryptography.CngKeyOpenOptions]::MachineKey)){throw 'RETAINED_TASK_COLLISION_NOT_PRESERVED_WITHOUT_EFFECTS'}
     $record.retainedTaskPreservedBeforeOuterCleanup=$true
     [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($outerTask);$outerTask=$null
     $outerFolder.DeleteTask($row.task,0);$record.ok=$true
    }finally{foreach($com in @($outerTask,$outerFolder,$outerService)){if($null -ne $com -and [Runtime.InteropServices.Marshal]::IsComObject($com)){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($com)}}}
   }
   $record.cleanupComplete=$true
  }catch{$record.cleanupError=$_.Exception.ToString();$record.ok=$false}
  $results.Add($record)
  [IO.File]::WriteAllText([IO.Path]::Combine($Directory,$resultName),(@{schemaVersion='stephanos.isolated-mobile-enrollment-phase-proof.v1';suite=$manifest.suite;productionMutation=$false;rows=@($results.ToArray())}|ConvertTo-Json -Depth 12),$utf8)
 }
 if(-not $record.ok){break}
}
[Console]::WriteLine([IO.Path]::Combine($Directory,$resultName))
if($results.Count -ne $manifest.rows.Count -or @($results|Where-Object{-not $_.ok}).Count -gt 0){exit 1}
exit 0
