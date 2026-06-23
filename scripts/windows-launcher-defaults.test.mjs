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
    /\$launcherRootCommand = 'powershell\.exe -ExecutionPolicy Bypass -File \.\\windows\\Invoke-Stephanos-Ignite-With-Approval\.ps1'/m,
    'desktop launcher-root must call the local approval helper instead of bypassing ignition safety',
  );
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
