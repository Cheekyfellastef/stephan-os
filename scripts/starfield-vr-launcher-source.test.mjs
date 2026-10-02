import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const launcherUrl = new URL('./windows/launch-starfield-vr.ps1', import.meta.url);
const performanceModeUrl = new URL('./windows/starfield-vr-performance-mode.ps1', import.meta.url);
const audioEndpointUrl = new URL('./windows/starfield-vr-audio-endpoint.ps1', import.meta.url);
const splashUrl = new URL('./windows/launch-starfield-vr-with-splash.ps1', import.meta.url);
const aerObserveUrl = new URL('./windows/run-starfield-aer-stabilizer-observe.ps1', import.meta.url);
const aerGuardianUrl = new URL('./windows/starfield-aer-stabilizer-guardian.ps1', import.meta.url);
const installerUrl = new URL('./windows/install-starfield-vr-desktop-shortcut.ps1', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);

test('launcher delegates authority to the canonical shared decision policy through an explicit Node executable', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /scripts\\starfield-vr-launch-decision\.mjs/);
  assert.match(source, /\[string\]\$NodeExecutablePath/);
  assert.match(source, /& \$NodeExecutablePath \$decisionScript/);
  assert.doesNotMatch(source, /& node \$decisionScript/);
  assert.match(source, /Get-FileHash[\s\S]*?-Algorithm SHA256/);
  assert.match(source, /Get-ItemPropertyValue[\s\S]*?Khronos\\OpenXR\\1[\s\S]*?ActiveRuntime/);
  assert.match(source, /Get-Process -Name 'OculusDash'/);
  assert.match(source, /Oculus\\Support\\oculus-client\\Client\.exe/);
  assert.match(source, /\$item\.Length -gt 0/);
  assert.match(source, /function Start-OrReuseVerifiedVorpXCompanion/);
  assert.match(source, /Get-CimInstance Win32_Process -Filter "Name='vorpControl\.exe'"/);
  assert.match(source, /\$candidate\.ExecutablePath/);
  assert.match(source, /ManagementDateTimeConverter.*CreationDate/s);
  assert.match(source, /\$candidateStartedUtc -lt \$expectedItem\.LastWriteTimeUtc/);
  assert.match(source, /vorpx-running-process-predates-verified-binary/);
  assert.match(source, /\$companionReused = \[bool\]\$companionSession\.Reused/);
  assert.match(source, /companionReused = \$companionReused/);
  assert.match(source, /starfield-vr-performance-mode\.ps1/);
  assert.match(source, /-Action Enter/);
  assert.match(source, /-Action', 'Guard'/);
  assert.match(source, /performanceGuardianProcessId/);
  assert.match(source, /if \(-not \$decision\.ok\)[\s\S]*?STARFIELD_VR_LAUNCH_BLOCKED/);
  assert.match(source, /Nothing was changed and flat Starfield was not started/);
});

test('Mutar performance mode parks local AI, applies VR-safe settings, switches Quest audio, records telemetry, and restores state', async () => {
  const source = await readFile(performanceModeUrl, 'utf8');
  assert.equal((source.match(/\[CmdletBinding\(\)\]/g) ?? []).length, 1);
  assert.equal((source.match(/Set-StrictMode -Version Latest/g) ?? []).length, 1);
  assert.equal((source.match(/function Get-NvidiaSample/g) ?? []).length, 1);
  assert.equal((source.match(/if \(\$Action -eq 'Enter'\)/g) ?? []).length, 1);
  assert.ok((source.match(/stephanos\.starfield-vr-performance-summary\.v1/g) ?? []).length >= 2);
  assert.match(source, /function Recover-AbandonedPerformanceSessions[\s\S]*?Write-JsonNoBom -Path \$summaryPath -Value \$summary/);
  assert.match(source, /if \(\$Action -eq 'Enter'\)[\s\S]*?exit 0[\s\S]*?if \(\$Action -eq 'Restore'\)/);

  assert.match(source, /bEnableVsync' -Value '0'/);
  assert.match(source, /bDynamicResolutionEnabled' -Value '0'/);
  assert.match(source, /uiFrameGenerationTech' -Value '0'/);
  assert.match(source, /llama-server\.exe/);
  assert.match(source, /Stop-ProcessIds/);
  assert.match(source, /SwitchToQuest/);
  assert.match(source, /originalEndpointId/);
  assert.match(source, /Get-NvidiaSample/);
  assert.match(source, /if \(\$videoParts\[0\] -match '\^\\d\+\(\?:\\\.\\d\+\)\?\$'\) \{ \$encoderUtilPct = \[double\]\$videoParts\[0\] \}/);
  assert.match(source, /if \(\$videoParts\[1\] -match '\^\\d\+\(\?:\\\.\\d\+\)\?\$'\) \{ \$decoderUtilPct = \[double\]\$videoParts\[1\] \}/);
  assert.doesNotMatch(source, /-match '\^\\d\+\(\?:\\\.\\d\+\)\?\s*\n/);
  assert.match(source, /gpuMemoryUsedMiB/);
  assert.match(source, /starfieldPrivateMiB/);
  assert.match(source, /Get-CimInstance Win32_Process -Filter "Name='Starfield\.exe'"/);
  assert.match(source, /AddSeconds\(-5\)/);
  assert.match(source, /AddSeconds\(30\)/);
  assert.match(source, /starfieldProcessId/);
  assert.match(source, /processHandoffCount/);
  assert.match(source, /observedGameProcessIds/);
  assert.match(source, /finalGameProcessId/);
  assert.match(source, /Restore-Session/);
  assert.match(source, /audioRestored/);
});

test('Quest audio helper captures and restores exact Windows default endpoints without third-party utilities', async () => {
  const source = await readFile(audioEndpointUrl, 'utf8');
  assert.match(source, /GetDefaultAudioEndpoint/);
  assert.match(source, /SetDefaultEndpoint/);
  assert.match(source, /Oculus Virtual Audio Device\|Quest/);
  assert.match(source, /eConsole, ERole\.eMultimedia, ERole\.eCommunications/);
  assert.doesNotMatch(source, /nircmd|SoundVolumeView|AudioDeviceCmdlets/i);
});

test('readiness-only early blockers expose the durable receipt path', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /function Complete-BlockedLaunch[\s\S]*?if \(\$ReadinessOnly\)[\s\S]*?verdict = 'STARFIELD_VR_LAUNCH_BLOCKED'[\s\S]*?receiptPath = \$receiptPath/);
});

test('readiness observations are written as UTF-8 without BOM for the Node decision policy', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /\$observationsJson = \$observations \| ConvertTo-Json -Depth 10/);
  assert.match(source, /\[System\.IO\.File\]::WriteAllText\([\s\S]*?\$observationsPath,[\s\S]*?\$observationsJson,[\s\S]*?New-Object System\.Text\.UTF8Encoding\(\$false\)/);
  assert.doesNotMatch(source, /\$observations\s*\|\s*ConvertTo-Json[\s\S]*?Set-Content -LiteralPath \$observationsPath -Encoding UTF8/);
});

test('launcher drains heavy local AI before Starfield VR starts', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /run-vr-resource-governor\.ps1/);
  assert.match(source, /gaming-resource-local-model-not-blocked/);
  assert.match(source, /gaming-resource-local-model-remained/);
  assert.match(source, /loadedModelsAfter/);
  assert.match(source, /localModelAllowed/);
  assert.match(source, /-Action PrepareGaming -ProcessName 'Starfield' -ProfileName 'vr-maximum'/);
  assert.match(source, /heavyModelAllowed -ne \$false/);
  assert.match(source, /evictionHealthy -ne \$true/);
  assert.match(source, /heavyModelsAfter/);
  assert.match(source, /resourceGovernor = \$resourceGuard/);
});

test('launcher is launch-only and cannot install or download a VR mod', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.doesNotMatch(source, /Invoke-WebRequest|Start-BitsTransfer|Expand-Archive|Copy-Item|Set-ItemProperty/i);
  assert.doesNotMatch(source, /git\s+(reset|clean|checkout)|Remove-Item\s+.*Starfield/i);
  assert.match(source, /LAUNCH_VORPX/);
  assert.match(source, /Start-Process -FilePath \$launchExecutable -WorkingDirectory \$workingDirectory -PassThru/);
});

test('splash is presentation-only, requires provider selection, and delegates readiness plus launch to the canonical launcher', async () => {
  const source = await readFile(splashUrl, 'utf8');
  assert.match(source, /Add-Type -AssemblyName System\.Windows\.Forms/);
  assert.match(source, /STARFIELD VR/);
  assert.match(source, /Choose a VR provider/);
  assert.match(source, /CHOOSE YOUR VERIFIED VR ROUTE/);
  assert.match(source, /VorpX Baseline/);
  assert.match(source, /Mutar \/ OpenXR/);
  assert.match(source, /Hybrid \/ Stephanos VR/);
  assert.match(source, /Checking Quest 3 route/);
  assert.match(source, /Checking Meta Air Link/);
  assert.match(source, /Checking OpenXR runtime/);
  assert.match(source, /Checking verified VR provider/);
  assert.match(source, /Ready to launch/);
  assert.match(source, /Launching Starfield VR/);
  assert.match(source, /Start-StarfieldVrLauncherProcess -SelectedProfilePath \$processState\.ProfilePath -ReadinessOnly/);
  assert.match(source, /Start-StarfieldVrLauncherProcess/);
  assert.match(source, /\$processState = \[pscustomobject\]/);
  assert.match(source, /\$processState\.Readiness = Start-StarfieldVrLauncherProcess -SelectedProfilePath \$processState\.ProfilePath -ReadinessOnly/);
  assert.doesNotMatch(source, /\$script:readinessProcess\s*=/);
  assert.match(source, /\$detailsButton\.Enabled = \$true/);
  assert.match(source, /Choose a provider\. No game will launch until you make a selection and the canonical readiness gate passes\./);
  assert.match(source, /\$readinessPollTimer = New-Object System\.Windows\.Forms\.Timer/);
  assert.match(source, /\$readinessPollTimer\.Add_Tick/);
  assert.match(source, /\$launchPollTimer = New-Object System\.Windows\.Forms\.Timer/);
  assert.match(source, /\$launchPollTimer\.Add_Tick/);
  assert.match(source, /\.HasExited/);
  assert.doesNotMatch(source, /WaitForExit\(\)/);
  assert.doesNotMatch(source, /\$form\.Add_Shown\(\{\s*Start-ReadinessCheck/);
  assert.match(source, /\$vorpxButton\.Add_Click/);
  assert.match(source, /\$mutarButton\.Add_Click/);
  assert.match(source, /\$dragState = \[pscustomobject\]/);
  assert.match(source, /Add_MouseDown\(\$beginDrag\)/);
  assert.match(source, /Add_MouseMove\(\$moveDrag\)/);
  assert.match(source, /\$form\.Location = New-Object System\.Drawing\.Point/);
  assert.doesNotMatch(source, /System\.ComponentModel\.BackgroundWorker|RunWorkerAsync|readiness-worker-failed/);
  assert.match(source, /STARFIELD_VR_LAUNCH_READY/);
  assert.match(source, /Flat Starfield was not started/);
  assert.match(source, /Show details/);
  assert.match(source, /\$closeButton\.Text = 'Close'/);
  assert.match(source, /\$closeButton\.Add_Click\(\{ \$form\.Close\(\) \}\)/);
  assert.doesNotMatch(source, /Invoke-WebRequest|Start-BitsTransfer|Expand-Archive|Copy-Item|Set-ItemProperty/i);
  assert.doesNotMatch(source, /Start-Process\s+-FilePath\s+.*Starfield|sfse_loader\.exe|dxgi\.dll/i);
});

test('AER observe mode auto-records behind the splash and rolls back to the public MutaR baseline', async () => {
  const splash = await readFile(splashUrl, 'utf8');
  const observe = await readFile(aerObserveUrl, 'utf8');
  const guardian = await readFile(aerGuardianUrl, 'utf8');

  assert.match(splash, /AER OBSERVE \/ AUTO RECORD/);
  assert.match(splash, /BASELINE/);
  assert.match(splash, /OBSERVE/);
  assert.match(splash, /PROTECT/);
  assert.match(splash, /ADAPTIVE/);
  assert.match(splash, /modeTraffic/);
  assert.match(splash, /Start-AerObserveProcess/);
  assert.match(splash, /AER_OBSERVE/);

  assert.match(observe, /-ReadinessOnly/);
  assert.match(observe, /expectedBaselineHash = '63db15c370d3b8f15faa292a95d5c3abd4c6571cef0d35a45310d998adfeae41'/);
  assert.match(observe, /expectedCustomHash = 'b0046baf0e4487c76d6a7c85c04b338e402f50f7557189e5e46a5b8c0932a76c'/);
  assert.match(observe, /Copy-Item -LiteralPath \$customDll -Destination \$liveDll -Force/);
  assert.match(observe, /starfield-aer-stabilizer-guardian\.ps1/);
  assert.match(observe, /modeTraffic = \[ordered\]@\{/);
  assert.match(observe, /protectFlagPresent/);
  assert.match(observe, /ValidateOnly[\s\S]*?ready = -not \[bool\]\$validated\.protectFlagPresent/);
  assert.match(observe, /SIMULATED_READINESS_ONLY/);
  assert.match(observe, /simulated readiness is test-only/);
  assert.match(observe, /routeIdentity = \$readinessReceipt\.routeIdentity/);
  assert.match(observe, /provider -ne 'mutar-openxr'/);
  assert.match(observe, /-Action PrepareGaming -ProcessName 'Starfield' -ProfileName 'vr-maximum'/);
  assert.match(observe, /loadedModelsAfter/);
  assert.match(observe, /VR gaming resource preflight did not fully park local AI/);
  assert.match(observe, /-Provider 'mutar-openxr'/);
  assert.match(observe, /-ProfileSha256 \$profileSha256/);
  assert.match(observe, /-LaunchSessionId \$launchSessionId/);
  assert.match(observe, /-SourceHead \$sourceHead/);

  assert.match(guardian, /Safety-critical rollback happens before optional evidence archival/);
  assert.match(guardian, /Copy-Item -LiteralPath \(\[string\]\$session\.baselineBackupPath\) -Destination \(\[string\]\$session\.liveDllPath\) -Force[\s\S]*?archiveError/);
  assert.match(guardian, /sequenceFaultCount/);
  assert.match(guardian, /protectThreshold = 3/);
  assert.match(guardian, /protect = if \(\$protectReady\) \{ 'yellow' \} else \{ 'grey' \}/);
  assert.match(guardian, /adaptive = 'grey'/);
  assert.match(observe, /sharedWorkspaceRoot = \$workspaceRoot/);
  assert.match(observe, /repoRoot = \$repoRoot/);
  assert.match(observe, /routeIdentity = \[ordered\]@\{/);
  assert.match(observe, /resourceGovernor = \$resourceGuard/);
  assert.match(guardian, /vr-playtest-flywheel-bridge\.mjs/);
  assert.match(guardian, /Raw session evidence remains canonical/);
  assert.match(guardian, /flywheel-bridge-receipt\.json/);
});

test('installer creates exactly one current-user shortcut named Starfield VR through the splash wrapper', async () => {
  const source = await readFile(installerUrl, 'utf8');
  assert.match(source, /\[Environment\]::GetFolderPath\(\[Environment\+SpecialFolder\]::Desktop\)/);
  assert.match(source, /Join-Path \$desktopPath 'Starfield VR\.lnk'/);
  assert.match(source, /launch-starfield-vr-with-splash\.ps1/);
  assert.match(source, /\$arguments = [\s\S]*\$splashLauncherScript/);
  assert.match(source, /New-Object -ComObject WScript\.Shell/);
  assert.match(source, /SupportsShouldProcess = \$true/);
  assert.match(source, /-WindowStyle Hidden/);
  assert.match(source, /splashLauncherScript = \$splashLauncherScript/);
  assert.doesNotMatch(source, /AllUsersDesktop|Public\\Desktop|RunAs|Verb\s*=\s*'runas'/i);
});

test('package scripts expose installation readiness and focused regression checks', async () => {
  const pkg = JSON.parse(await readFile(packageUrl, 'utf8'));
  assert.match(pkg.scripts['starfield-vr:install-shortcut'], /install-starfield-vr-desktop-shortcut\.ps1/);
  assert.match(pkg.scripts['starfield-vr:status'], /launch-starfield-vr\.ps1 -ReadinessOnly/);
  assert.match(pkg.scripts['starfield-vr:test'], /starfieldVrLaunchPolicy\.test\.mjs/);
  assert.match(pkg.scripts['starfield-vr:test'], /starfield-vr-launcher-source\.test\.mjs/);
});


test('AER Observe persists prelaunch failure details for Commander diagnosis', async () => {
  const source = await readFile(aerObserveUrl, 'utf8');
  assert.match(source, /status = 'PRELAUNCH_FAILED'/);
  assert.match(source, /\$state\.error = \$_\.Exception\.Message/);
  assert.match(source, /Write-JsonNoBom \$modeStatePath \$state/);
});
