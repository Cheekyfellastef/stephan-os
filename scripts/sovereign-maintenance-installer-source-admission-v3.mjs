// Pure candidate builder for the EXISTING manually operator-approved GitHub/native route.
// The authenticated caller must independently prove GitHub tree membership and
// exact operator approval BEFORE executing these bytes. Inputs alone are no authority.
import { createHash } from 'node:crypto';
export const MAINTENANCE_SOURCE_CLOSURE_V3 = Object.freeze([
  "scripts/battle-bridge-github-sync-policy.mjs",
  "scripts/battle-bridge-ignition-supervisor.mjs",
  "scripts/battle-bridge-shared-workspace-publisher.mjs",
  "scripts/battle-bridge-ui-4173-repair.mjs",
  "scripts/git-branch-intelligence.mjs",
  "scripts/ignite-stephanos-local-lib.mjs",
  "scripts/ignite-stephanos-local.mjs",
  "scripts/ignition-cockpit-model.mjs",
  "scripts/launcher-readiness-live-facts.mjs",
  "scripts/launcher-readiness-planner.mjs",
  "scripts/launcher-readiness-report.mjs",
  "scripts/sovereign-maintenance-custody-store-v1.mjs",
  "scripts/sovereign-maintenance-journal-source-proof-v2.mjs",
  "scripts/sovereign-maintenance-os-anchor-v1.mjs",
  "scripts/sovereign-maintenance-owner-observation-v2.mjs",
  "scripts/stephanos-build-utils.mjs",
  "scripts/stephanos-ignition-preflight.mjs",
  "shared/agents/battleBridgeExecutionBoundaryV1.mjs",
  "shared/agents/battleBridgeGitConfigurationDiagnosticV1.mjs",
  "shared/agents/battleBridgeGitProbeContextV1.mjs",
  "shared/agents/battleBridgePublisher.mjs",
  "shared/agents/battleBridgeWindowsHosts.mjs",
  "shared/agents/closedLoopLearningV1.mjs",
  "shared/agents/engineeringIncidentMethodMemoryV1.mjs",
  "shared/agents/goalDiscoveryWorkspaceV1.mjs",
  "shared/agents/openClawGatewayStartup.mjs",
  "shared/agents/openClawStartupRecovery.mjs",
  "shared/agents/openClawWorkspaceHygiene.mjs",
  "shared/agents/sharedAgentWorkspace.mjs",
  "shared/agents/sharedAgentWorkspaceStore.mjs",
  "shared/agents/sharedWorkspaceHeadTruthV1.mjs",
  "shared/agents/sharedWorkspaceOperationalFactsV1.mjs",
  "shared/agents/sharedWorkspaceRuntimeConfig.mjs",
  "shared/agents/sovereignMaintenanceSourceDiagnosticV1.mjs",
  "shared/agents/verificationHarness.mjs",
  "shared/runtime/stephanosLocalUrls.mjs",
  "scripts/windows/SovereignCoreJobCustodyV1.cs",
  "scripts/windows/SovereignMaintenanceSourceJobV3.cs",
  "scripts/windows/sovereign-maintenance-journal-policy-v2.ps1",
  "scripts/windows/install-sovereign-maintenance-journal-v2.ps1",
  "package.json",
  ".gitattributes"
]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function buildMaintenanceInstallerBootstrapCandidateV3({ expectedMain, sourceTree, records } = {}) {
  if (!/^[a-f0-9]{40}$/.test(expectedMain ?? '') || !/^[a-f0-9]{40}$/.test(sourceTree ?? '')
      || !Array.isArray(records) || records.length !== MAINTENANCE_SOURCE_CLOSURE_V3.length)
    throw new Error('MAINTENANCE_BOOTSTRAP_EXACT_SOURCE_REQUIRED');
  const captured = new Map();
  for (const record of records) {
    if (!record || Object.keys(record).sort().join(',') !== 'blobSha,contentBase64,path'
        || !MAINTENANCE_SOURCE_CLOSURE_V3.includes(record.path) || captured.has(record.path)
        || !/^[a-f0-9]{40}$/.test(record.blobSha ?? '') || typeof record.contentBase64 !== 'string'
        || record.contentBase64.length > 2796208 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.contentBase64))
      throw new Error('MAINTENANCE_BOOTSTRAP_SOURCE_RECORD_INVALID');
    const bytes = Buffer.from(record.contentBase64, 'base64');
    const gitBlob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    if (gitBlob !== record.blobSha || bytes.length > 2097152)
      throw new Error('MAINTENANCE_BOOTSTRAP_BLOB_MISMATCH');
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    captured.set(record.path, sha256(bytes));
  }
  const manifest = MAINTENANCE_SOURCE_CLOSURE_V3.map(path => ({ path, sha256: captured.get(path) }));
  const manifestSha256 = sha256(JSON.stringify(manifest));
  const declarations = "$expectedMain='" + expectedMain + "'\n$sourceTree='" + sourceTree + "'\n$manifest=@{\n"
    + manifest.map(row => "'" + row.path + "'='" + row.sha256 + "'").join('\n') + "\n}\n";
  const script = "$ErrorActionPreference='Stop'\n$PSModuleAutoLoadingPreference='None'\nImport-Module 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop\n$root='C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os'\n$handles=[Collections.Generic.List[IO.FileStream]]::new()\n$directories=[Collections.Generic.List[Microsoft.Win32.SafeHandles.SafeFileHandle]]::new()\n$texts=@{}\n$leafPin=$null\nfunction Read-Pinned([string]$relative,[string]$expected) {\n $path=[IO.Path]::Combine($root,$relative.Replace('/','\\'))\n if($null -eq $leafPin){$f=[IO.FileStream]::new($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)}else{$f=$leafPin.Invoke($null,@($path))}\n $handles.Add($f)\n if($f.Length -gt 2097152){throw 'SOURCE_PIN_SIZE'}\n $bytes=[byte[]]::new([int]$f.Length)\n $offset=0\n while($offset -lt $bytes.Length){$n=$f.Read($bytes,$offset,$bytes.Length-$offset);if($n -le 0){throw 'SOURCE_PIN_READ'};$offset+=$n}\n $sha=[Security.Cryptography.SHA256]::Create()\n try {$actual=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose()}\n if($actual -cne $expected){throw 'SOURCE_PIN_DIGEST'}\n return [Text.UTF8Encoding]::new($false,$true).GetString($bytes)\n}\ntry {\n" + declarations + "\n # Authenticate the COMPLETE closure snapshot before compiling any workspace C#.\n foreach($relative in $manifest.Keys){$texts[$relative]=Read-Pinned $relative $manifest[$relative]}\n $native='scripts/windows/SovereignCoreJobCustodyV1.cs'\n $nativeText=$texts[$native]+[Environment]::NewLine+$texts['scripts/windows/SovereignMaintenanceSourceJobV3.cs']\n Add-Type -TypeDefinition $nativeText -ErrorAction Stop\n $leafPin=[Stephanos.Sovereign.CoreJobCustodyV1].GetMethod('OpenPinnedMaintenanceSourceFileV3',[Reflection.BindingFlags]'NonPublic,Static')\n if($null -eq $leafPin){throw 'SOURCE_PIN_LEAF_PRIMITIVE_MISSING'}\n # Pin every physical parent using the existing native no-redirection adapter.\n $pin=[Stephanos.Sovereign.CoreJobCustodyV1].GetMethod('PinDirectoryChain',[Reflection.BindingFlags]'NonPublic,Static')\n if($null -eq $pin){throw 'SOURCE_PIN_NATIVE_PRIMITIVE_MISSING'}\n foreach($relative in $manifest.Keys){\n  $parent=[IO.Path]::GetDirectoryName([IO.Path]::Combine($root,$relative.Replace('/','\\')))\n  [void]$pin.Invoke($null,@($parent,$directories))\n }\n # Keep canonical source identity/config/index immobile through registry mutation.\n # These are fixed metadata paths, never caller-selected files or source evidence.\n foreach($relative in @('.git','.git/refs/heads')){\n  [void]$pin.Invoke($null,@([IO.Path]::Combine($root,$relative.Replace('/','\\')),$directories))\n }\n foreach($relative in @('.git/HEAD','.git/index','.git/config','.git/refs/heads/main')){\n  $f=$leafPin.Invoke($null,@([IO.Path]::Combine($root,$relative.Replace('/','\\'))));$handles.Add($f)\n  if($relative -eq '.git/refs/heads/main' -or $relative -eq '.git/HEAD'){\n   $reader=[IO.StreamReader]::new($f,[Text.Encoding]::UTF8,$true,1024,$true)\n   try {$value=$reader.ReadToEnd().Trim()}finally{$reader.Dispose()}\n   if(($relative -eq '.git/HEAD' -and $value -cne 'ref: refs/heads/main') -or ($relative -ne '.git/HEAD' -and $value -cne $expectedMain)){throw 'SOURCE_PIN_REF_CHANGED'}\n  }\n }\n if([IO.File]::Exists([IO.Path]::Combine($root,'.git/config.worktree'))){$handles.Add($leafPin.Invoke($null,@([IO.Path]::Combine($root,'.git/config.worktree'))))}\n # Reopen and authenticate the complete immutable closure AFTER directory pinning.\n foreach($relative in $manifest.Keys){$texts[$relative]=Read-Pinned $relative $manifest[$relative]}\n . ([scriptblock]::Create($texts['scripts/windows/sovereign-maintenance-journal-policy-v2.ps1']))\n $script:MaintenanceInstallerPinnedBootstrapV3=[pscustomobject]@{ExpectedMain=$expectedMain;SourceTree=$sourceTree;ClosureCount=$manifest.Count;Handles=$handles;Directories=$directories}\n . ([scriptblock]::Create($texts['scripts/windows/install-sovereign-maintenance-journal-v2.ps1'])) -OperatorApproved -ExpectedMain $expectedMain\n} catch {\n [Console]::Error.WriteLine('MAINTENANCE_INSTALLER_PINNED_BOOTSTRAP_REFUSED')\n exit 2\n} finally {\n $script:MaintenanceInstallerPinnedBootstrapV3=$null\n for($i=$handles.Count-1;$i -ge 0;$i--){$handles[$i].Dispose()}\n for($i=$directories.Count-1;$i -ge 0;$i--){$directories[$i].Dispose()}\n}\n";
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
  if (encodedCommand.length > 30000) throw new Error('MAINTENANCE_BOOTSTRAP_COMMAND_BUDGET');
  return Object.freeze({ schemaVersion: 'stephanos.maintenance-installer-bootstrap-candidate.v3',
    expectedMain, sourceTree, manifestSha256, scriptSha256: sha256(script), encodedCommand, script,
    powershellExecutable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    independentSourceAuthorityProven: false, operatorApprovalProven: false,
    elevationPerformed: false, journalRegistered: false, custodyReleased: false });
}
