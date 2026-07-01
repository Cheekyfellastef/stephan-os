import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const WINDOWS_LAUNCHER_PS1 = new URL('../windows/Launch-Stephanos-Local.ps1', import.meta.url);
const WINDOWS_LAUNCHER_CMD = new URL('../windows/Launch-Stephanos-Local.cmd', import.meta.url);
const WINDOWS_IGNITE_APPROVAL_PS1 = new URL('../windows/Invoke-Stephanos-Ignite-With-Approval.ps1', import.meta.url);

test('launcher-root mode enables browser auto-open by default', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(
    script,
    /\$autoOpenEnabled = if \(\$Mode -eq 'launcher-root'\) \{\s*\$true\s*\}/m,
    'launcher-root mode must force auto-open enabled by default',
  );
});

test('launcher-root startup command uses canonical stephanos:ignite flow', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(
    script,
    /\$launcherRootCanonicalCommand = 'npm run stephanos:ignite'/m,
    'launcher-root must preserve canonical ignition entrypoint as the safe default',
  );
  assert.doesNotMatch(
    script,
    /\$launcherRootCommand = 'npm run stephanos:serve'/m,
    'launcher-root must not use direct serve entrypoint anymore',
  );
});

test('launcher-root cmd default launch does not require explicit -AutoOpen switch', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_CMD, 'utf8');
  assert.doesNotMatch(
    script,
    /-Mode launcher-root -BootMode cockpit -AutoOpen/,
    'default launcher-root invocation should not require -AutoOpen',
  );
  assert.match(
    script,
    /-Mode launcher-root -BootMode cockpit/,
    'default launcher-root invocation must remain launcher-root cockpit',
  );
});

test('vite-dev localhost launch still uses explicit AutoOpen switch behavior', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(
    script,
    /Ensure-ProcessRunning -StepLabel 'vite-dev ui' -HealthUrl \$viteDevUrl -WindowTitle 'Stephanos Vite Dev' -Command 'npm --prefix stephanos-ui run dev'/m,
    'vite-dev mode must continue to use npm --prefix stephanos-ui run dev',
  );
  assert.match(
    script,
    /elseif \(\$isLocalhostLaunch\) \{\s*\$AutoOpen\.IsPresent\s*\}/m,
    'non-launcher-root localhost launches should still require -AutoOpen',
  );
});


test('launcher-root uses windows-native fallback chain for browser opening', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(
    script,
    /Name = 'cmd-start'[\s\S]*?cmd\.exe \/d \/c start/m,
    'browser open should attempt cmd /c start first for reliable URL shell association',
  );
  assert.match(
    script,
    /Name = 'explorer'[\s\S]*?Start-Process -FilePath 'explorer\.exe'/m,
    'browser open should fall back to explorer.exe',
  );
  assert.match(
    script,
    /Name = 'start-process-url'[\s\S]*?Start-Process -FilePath \$Url/m,
    'browser open should keep Start-Process URL as final fallback',
  );
});

test('launcher-root cockpit mode still resolves launcher and runtime browser surfaces', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(
    script,
    /\[string\]\$BootMode = 'cockpit'/m,
    'launcher-root default boot mode must remain cockpit',
  );
  assert.match(
    script,
    /'cockpit' \{ return @\(\$surfaceMap\.launcher, \$surfaceMap\.runtime\) \}/m,
    'cockpit mode must still open both launcher and runtime surfaces',
  );
});


test('launcher-root delegates desktop Ignite through generated-dist approval helper', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(
    script,
    /\$launcherRootCommand = 'powershell\.exe -ExecutionPolicy Bypass -File \.\\windows\\Invoke-Stephanos-Ignite-With-Approval\.ps1 -RepositoryRoot \.'/m,
    'desktop launcher-root must call the approval helper inside the resolved PR worktree instead of bypassing ignition safety',
  );
});

test('launcher-root resolves PR worktree root before falling back to launcher script root', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(script, /\[string\]\$RepositoryRoot = ''/m, 'launcher must accept an explicit repository root for exact-head proof worktrees');
  assert.match(script, /Resolve-LauncherRepositoryRoot[\s\S]*?\$RequestedRoot[\s\S]*?\$env:STEPHANOS_PROOF_WORKTREE_ROOT[\s\S]*?\$PWD\.Path[\s\S]*?Split-Path -Parent \$PSScriptRoot/m, 'launcher must prefer explicit/env/current PR worktree before script-root fallback');
  assert.match(script, /scripts\/ignite-stephanos-local\.mjs[\s\S]*?windows\/Invoke-Stephanos-Ignite-With-Approval\.ps1/m, 'launcher root resolution must validate the Stephanos ignition and approval helper files');
  assert.match(script, /Start-Process -FilePath 'powershell\.exe' -WorkingDirectory \$repoRoot/m, 'launcher must start child proof windows from the resolved repository root');
  assert.match(script, /Set-Location '\$escapedRepoRoot'/m, 'launcher child command must set location to the resolved PR worktree root');
});

test('desktop Ignite approval helper resolves and logs PR worktree root', async () => {
  const script = await readFile(WINDOWS_IGNITE_APPROVAL_PS1, 'utf8');
  assert.match(script, /\[string\]\$RepositoryRoot = ''/m, 'approval helper must accept the launcher-resolved repository root');
  assert.match(script, /Resolve-IgniteRepositoryRoot[\s\S]*?\$RequestedRoot[\s\S]*?\$env:STEPHANOS_PROOF_WORKTREE_ROOT[\s\S]*?\$PWD\.Path[\s\S]*?Split-Path -Parent \$PSScriptRoot/m, 'approval helper must prefer PR worktree inputs before script-root fallback');
  assert.match(script, /Set-Location -LiteralPath \$repoRoot/m, 'approval helper must run npm ignition commands from the resolved PR worktree root');
  assert.match(script, /selected repository root: \$repoRoot/m, 'approval helper must emit deterministic proof of the selected worktree root');
});

test('desktop Ignite approval helper preserves operator-gated recovery safety locks', async () => {
  const script = await readFile(WINDOWS_IGNITE_APPROVAL_PS1, 'utf8');
  assert.match(script, /\$normalIgniteCommand = 'npm run stephanos:ignite'/m, 'normal desktop Ignite must run safe default ignition first');
  assert.match(script, /\$approvedIgniteCommand = 'npm run stephanos:ignite -- --approve-local-merge'/m, 'approved path must run the explicit approved recovery command');
  assert.match(script, /Test-GeneratedDistRecoveryAvailable[\s\S]*?\$Packet\.localOnlyDistOnly -eq \$true[\s\S]*?--approve-local-merge/m, 'approve button must be gated by generated-dist-only recovery availability');
  assert.match(script, /if \(\$approvalAvailable\) \{[\s\S]*?Approve local recovery/m, 'approve button must only be added when recovery is available');
  assert.match(script, /elseif \(\$sourceDivergence\) \{[\s\S]*?View source divergence details[\s\S]*?Copy source merge repair packet[\s\S]*?Start approved source merge check/m, 'source divergence popup must offer assistance instead of generated-dist approval');
  assert.match(script, /Format-ApprovalPacketText[\s\S]*?localOnlyDistOnly -ne \$true[\s\S]*?Format-SourceDivergenceDetails/m, 'source divergence path must not use generated-dist approval copy');
  assert.match(script, /Copy-TextToClipboard -Text \$sourceRepairPacketText[\s\S]*?Copied repair packet/m, 'source divergence can copy a repair packet with confirmation');
  assert.match(script, /operator cancelled or approval unavailable; no generated-dist recovery or source merge completion was run/m, 'cancel/unavailable path must not run recovery');
  assert.match(script, /Popup failed[\s\S]*?run: \$approvedIgniteCommand/m, 'generated-dist popup failure must fall back to clear CLI repair instruction');
  assert.match(script, /Popup failed[\s\S]*?source-merge-repair-packet/m, 'source divergence popup failure must emit a repair packet');
  assert.match(script, /no auto-push[\s\S]*?no Codex auto-dispatch[\s\S]*?no OpenClaw unlock[\s\S]*?no merge-ready flip/m, 'popup must show safety locks remain closed');
  assert.match(script, /\$approvedOpenClawRestartCommand = 'npm run stephanos:ignite -- --approve-openclaw-service-restart'/m, 'OpenClaw recovery must use explicit approved restart command');
  assert.match(script, /Test-OpenClawRestartAvailable[\s\S]*?connectionVerdict -eq 'openclaw-service-running-not-connected'[\s\S]*?details.service.exists -eq \$true[\s\S]*?details.service.verified -eq \$true[\s\S]*?endpointIdentityVerified -eq \$true[\s\S]*?portOwnerVerified -eq \$true/m, 'OpenClaw restart button must be gated by known safe readiness state');
  assert.match(script, /Restart OpenClaw service/m, 'desktop popup must expose the exact safe OpenClaw restart button label');
  assert.match(script, /OpenClaw appears to have started on power-up, but failed readiness\/connection health/m, 'OpenClaw popup must explain startup connect recovery cause');
  assert.match(script, /no OpenClaw mutation[\s\S]*?no OpenClaw task execution[\s\S]*?no auto-push[\s\S]*?no Codex auto-dispatch[\s\S]*?no merge-ready flip/m, 'OpenClaw recovery popup must show service-only safety locks');
});

test('desktop Ignite source merge assistance stays two-step and conflict-safe', async () => {
  const script = await readFile(WINDOWS_IGNITE_APPROVAL_PS1, 'utf8');
  assert.match(script, /\$sourceMergeCheckCommand = 'git merge --no-commit --no-ff origin\/main'/m, 'source merge check must be explicit and non-committing');
  assert.match(script, /Invoke-ApprovedSourceMergeCheck[\s\S]*?git merge --no-commit --no-ff origin\/main[\s\S]*?git diff --name-only --diff-filter=U/m, 'approved check must trial merge and immediately inspect conflicts');
  assert.match(script, /source merge check found conflicts; aborting trial merge[\s\S]*?git merge --abort[\s\S]*?source-merge-repair-packet/m, 'conflicts must abort the trial merge and produce a repair packet');
  assert.match(script, /source merge check found no conflicts; requesting second approval before commit[\s\S]*?Show-SourceMergeCompletionApproval[\s\S]*?git commit -m 'Merge origin\/main after approved source merge check'/m, 'no-conflict check must ask for Complete source merge before commit');
  assert.match(script, /operator declined Complete source merge; aborting uncommitted trial merge[\s\S]*?git merge --abort/m, 'declining second approval must avoid committing and abort the trial merge');
  assert.doesNotMatch(script, /& git push|git push|Set-OpenClaw|Start-Codex|mergeReady\s*=\s*\$true/m, 'source merge assistance must not push or unlock readiness automation');
});

test('ignition button path selects splash/status browser UI before launcher-root process startup', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(script, /\$visiblePowerShellRequired = \$false/m, 'launcher must encode no visible PowerShell requirement');
  assert.match(script, /primaryUi = 'splash-status-browser'/m, 'status model must identify splash/status browser as primary UI');
  assert.match(script, /Show-IgnitionSplashScreen[\s\S]*?\$port4173Before = Get-PortListenerSnapshot -Port 4173/m, 'splash/status UI must be shown before launcher process probing/startup');
});

test('ignition process output is minimized and redirected instead of primary PowerShell wall UI', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(script, /Start-Process -FilePath 'powershell\.exe' -WorkingDirectory \$repoRoot -WindowStyle Minimized -RedirectStandardOutput \$stdoutLog -RedirectStandardError \$stderrLog/m, 'PowerShell process must be minimized and redirected to bounded logs');
  assert.doesNotMatch(script, /Start-Process -FilePath 'powershell\.exe'[\s\S]*?'-NoExit'/m, 'launcher must not keep a visible PowerShell wall open as the primary UI');
});

test('ignition records bounded status and log destinations in proof workspace', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(script, /\$ignitionProofRoot = Join-Path \(\[System\.IO\.Path\]::GetTempPath\(\)\) 'stephanos-ignition-proof'/m, 'ignition proof workspace must be deterministic under tmp');
  assert.match(script, /\$ignitionStatusPath = Join-Path \$ignitionProofRoot 'launcher-status\.json'/m, 'status destination must be recorded');
  assert.match(script, /logRoot = \(Join-Path \$ignitionProofRoot 'logs'\)/m, 'log root must be recorded in status payload');
  assert.match(script, /stdoutLog = \$stdoutLog; stderrLog = \$stderrLog/m, 'per-process stdout/stderr log destinations must be recorded');
});

test('ignition failure status preserves exact blocker and next operator action', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(script, /Write-IgnitionStatus -Phase 'blocked' -Message \$Step[\s\S]*blocker = \$Step/m, 'failure status must preserve the exact blocker message');
  assert.match(script, /nextOperatorAction = 'Review the exact blocker in this launcher window and the bounded ignition logs, then resolve it before retrying\.'/m, 'failure status must include operator action');
});


test('launcher-root splash uses detailed ignition stage model', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  for (const stage of [
    'finding-repo',
    'checking-workspace-dirt',
    'classifying-safe-vs-unsafe-dirt',
    'cleaning-generated-runtime-stoppers',
    'checking-dependencies',
    'checking-ports-existing-runtime',
    'starting-local-services',
    'opening-command-deck',
  ]) {
    assert.match(script, new RegExp(`id = '${stage}'`), `missing ignition stage ${stage}`);
  }
  assert.match(script, /ignitionStages = Get-IgnitionStageSnapshot -CurrentStageId \$currentStage/m, 'status payload must project the detailed stage snapshot');
  assert.match(script, /aria-label="Detailed ignition stages"/m, 'splash HTML must render detailed stages as primary browser UI');
});

test('ignition status preserves destination paths, blocker actions, and non-primary PowerShell wall truth', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(script, /destinations = \[ordered\]@\{ statusPath = \$ignitionStatusPath; supportSnapshotPath = \$ignitionSupportSnapshotPath; proofTranscriptPath = \$ignitionProofTranscriptPath; splashPath = \$ignitionSplashPath; logRoot = \(Join-Path \$ignitionProofRoot 'logs'\) \}/m, 'status payload must record status, splash, and log destinations');
  assert.match(script, /aria-label="Blocker and operator action"/m, 'splash must reserve browser-visible blocker/operator-action space');
  assert.match(script, /currentStage = 'blocked'; nextOperatorAction = 'Review the exact blocker/m, 'blocked status must preserve next operator action with blocker state');
  assert.match(script, /primaryUi = 'splash-status-browser'/m, 'splash/status browser must remain primary UI');
  assert.match(script, /\$visiblePowerShellRequired = \$false/m, 'VISIBLE_POWERSHELL_REQUIRED=False must remain encoded');
});

test('launcher wait inspects child logs for structured blocker packets', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  for (const packetName of [
    'source-update-status',
    'repair-packet',
    'source-merge-repair-packet',
    'openclaw-recovery-packet',
    'recovery-packet',
  ]) {
    assert.match(script, new RegExp(`'${packetName}'`), `launcher wait must inspect ${packetName}`);
  }
  assert.match(script, /Get-ChildIgnitionBlockedPacket[\s\S]*?ConvertFrom-Json[\s\S]*?\[string\]\$packet\.ignitionStatus -eq 'BLOCKED'/m, 'child packets must be parsed as JSON and checked for BLOCKED ignitionStatus');
  assert.match(script, /Wait-ForUrl[\s\S]*?\$blockedPacket = Get-ChildIgnitionBlockedPacket[\s\S]*?Publish-ChildIgnitionBlocker/m, 'URL wait loop must observe child blockers while polling runtime-status');
});

test('launcher surfaces child repair packet blockers instead of waiting for parent timeout', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(script, /Publish-ChildIgnitionBlocker[\s\S]*?blockerSource = 'child-ignition-structured-packet'/m, 'child repair packets must be identified as the blocker source');
  assert.match(script, /Write-IgnitionStatus -Phase 'blocked' -Message \$blocker/m, 'launcher-status must receive the child blocker as the primary message');
  assert.match(script, /existingChildBlockerRecorded[\s\S]*?blockerSource -eq 'child-ignition-structured-packet'[\s\S]*?Write-IgnitionStatus -Phase 'blocked' -Message \$Step/m, 'generic failure handling must not overwrite an already-surfaced child blocker');
  assert.match(script, /Write-IgnitionSupportSnapshot \$evidence/m, 'support snapshot must receive the child blocker evidence');
  assert.match(script, /launcher-wait-stopped-by-child-blocker/m, 'proof transcript must record that the child blocker stopped the wait');
});

test('missing-upstream child blocker is surfaced from source update truth', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(script, /Get-IgnitionPacketBlockerMessage[\s\S]*?blocked for safety: \$reason\. \$nextSafeAction/m, 'missing-upstream reason and next safe action must become exact operator blocker text');
  assert.match(script, /source-update-status/m, 'source-update-status must be inspected so missing-upstream safety is preserved');
});

test('parent runtime-status timeout remains diagnostic only when child blocker exists', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(script, /parentTimeoutDiagnostic = \$diagnostic/m, 'parent timeout details must be retained as diagnostic evidence');
  assert.match(script, /child blocker stopped the wait before timeout could become the operator-facing cause/m, 'operator-facing message must prefer the child blocker over the parent timeout');
  assert.match(script, /parent-wait-timeout-diagnostic/m, 'plain timeout must remain available only when no child blocker is found');
});

test('blocked child packet updates launcher status, support snapshot, transcript, and splash UI', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(script, /\$ignitionSupportSnapshotPath = Join-Path \$ignitionProofRoot 'support-snapshot\.json'/m, 'support snapshot path must be canonical in proof root');
  assert.match(script, /\$ignitionProofTranscriptPath = Join-Path \$ignitionProofRoot 'ignition-proof-transcript\.jsonl'/m, 'proof transcript path must be canonical in proof root');
  assert.match(script, /Write-IgnitionBlockedSplash -Blocker \$blocker -Evidence \$evidence/m, 'blocked child packet must update the splash HTML');
  assert.match(script, /aria-label="Exact child ignition blocker"/m, 'splash must render the exact child blocker as browser-visible primary UI');
  assert.match(script, /primaryUi = 'splash-status-browser'/m, 'splash remains the primary UI while blocked');
  assert.match(script, /visiblePowerShellRequired = \$visiblePowerShellRequired/m, 'visible PowerShell wall truth must remain false in evidence surfaces');
});
