import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createWindowsSafeMailboxReceiptFilename,
  parseBoundedGitHubJson,
} from './battle-bridge-github-command-mailbox.mjs';

const installerPath = new URL('./windows/install-battle-bridge-github-command-mailbox.ps1', import.meta.url);
const hiddenLauncherPath = new URL('./windows/run-battle-bridge-github-command-mailbox-hidden.ps1', import.meta.url);
const windowlessLauncherPath = new URL('./windows/run-stephanos-scheduled-task-windowless.vbs', import.meta.url);

test('mailbox task uses the fixed windowless launcher instead of allocating a Node console', async () => {
  const [installer, hiddenLauncher, windowlessLauncher] = await Promise.all([
    readFile(installerPath, 'utf8'),
    readFile(hiddenLauncherPath, 'utf8'),
    readFile(windowlessLauncherPath, 'utf8'),
  ]);

  assert.match(installer, /New-ScheduledTaskAction -Execute \$wscriptExe/);
  assert.match(installer, /run-stephanos-scheduled-task-windowless\.vbs/);
  assert.match(installer, /battle-bridge-github-command-mailbox-with-receipt-index\.mjs/);
  assert.match(installer, /receiptIndexEnabled = \$true/);
  assert.match(installer, /\/\/B \/\/NoLogo/);
  assert.match(installer, /github-command-mailbox/);
  assert.doesNotMatch(installer, /New-ScheduledTaskAction -Execute \$(?:node|nodeExe|npm)/);

  assert.match(
    windowlessLauncher,
    /Case "github-command-mailbox"\s+targetPath = fileSystem\.BuildPath\(repoRoot, "scripts\\windows\\run-battle-bridge-github-command-mailbox-hidden\.ps1"\)\s+command = Quote\(powershellExe\) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote\(targetPath\)/,
  );
  assert.match(windowlessLauncher, /shell\.Run\(command, 0, True\)/);
  assert.doesNotMatch(windowlessLauncher, /WScript\.Arguments\(1\)|cmd\.exe|Invoke-Expression/i);

  assert.match(hiddenLauncher, /Documents\\GitHub\\stephan-os/);
  assert.match(hiddenLauncher, /battle-bridge-github-command-mailbox-with-receipt-index\.mjs/);
  assert.doesNotMatch(hiddenLauncher, /scripts\\battle-bridge-github-command-mailbox\.mjs/);
  assert.match(hiddenLauncher, /Get-Command node\.exe/);
  assert.match(hiddenLauncher, /\*> \$null/);
  assert.doesNotMatch(hiddenLauncher, /\[string\]\s*\$|Invoke-Expression|Start-Process|cmd\.exe/i);
});

test('parses a GitHub issue-comment response larger than the diagnostic truncation limit', () => {
  const body = 'x'.repeat(424_551);
  const payload = JSON.stringify([{ id: 4998034338, body, user: { login: 'Cheekyfellastef' } }]);
  const parsed = parseBoundedGitHubJson(payload);
  assert.equal(parsed[0].id, 4998034338);
  assert.equal(parsed[0].body.length, 424_551);
});

test('fails closed when the GitHub response exceeds the bounded intake limit', () => {
  assert.throws(
    () => parseBoundedGitHubJson(JSON.stringify({ body: 'x'.repeat(256) }), 128),
    /GITHUB_RESPONSE_TOO_LARGE/,
  );
});

test('classifies invalid JSON without exposing truncated parser input', () => {
  assert.throws(
    () => parseBoundedGitHubJson('{"comments":'),
    /GITHUB_RESPONSE_JSON_INVALID/,
  );
});

test('derives a deterministic Windows-safe receipt filename for colon-bearing request IDs', () => {
  const requestId = 'proof:2026-07-30T20:00:00Z';
  const filename = createWindowsSafeMailboxReceiptFilename(requestId);
  assert.match(filename, /^request-[0-9a-f]{32}\.json$/);
  assert.doesNotMatch(filename, /[<>:"/\\|?*]/);
  assert.equal(createWindowsSafeMailboxReceiptFilename(requestId), filename);
  assert.equal(createWindowsSafeMailboxReceiptFilename('request-safe-0001'), 'request-safe-0001.json');
});
