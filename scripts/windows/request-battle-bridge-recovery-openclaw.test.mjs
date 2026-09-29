import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./request-battle-bridge-recovery-openclaw.ps1', import.meta.url));
const source = readFileSync(scriptPath, 'utf8');

test('OpenClaw recovery ingress uses process and listener ownership instead of a synthetic /identity endpoint', () => {
  assert.doesNotMatch(source, /127\.0\.0\.1:18789\/identity/i);
  assert.doesNotMatch(source, /Invoke-RestMethod/i);
  assert.match(source, /Get-NetTCPConnection[\s\S]*LocalPort 18789/);
  assert.match(source, /OwningProcess -eq \[int\]\$hostProof\.hostPid/);
  assert.match(source, /CommandLine -notmatch '\(\?i\)openclaw'/);
  assert.match(source, /openclaw-plugin-host:\$\(\$hostProcess\.ProcessId\)/);
});

test('OpenClaw recovery ingress remains a closed-world Recovery Mesh wake', () => {
  assert.match(source, /\$route = 'OPENCLAW_WHATSAPP'/);
  assert.match(source, /\$taskName = 'Stephanos Battle Bridge Recovery Mesh'/);
  assert.match(source, /run-stephanos-scheduled-task-windowless\.vbs/);
  assert.match(source, /recovery-mesh/);
  assert.match(source, /Start-ScheduledTask -TaskName \$taskName/);
  assert.match(source, /arbitraryShellAllowed = \$false/);
  assert.match(source, /arbitraryTaskNameAllowed = \$false/);
  assert.match(source, /sourceMutationAllowed = \$false/);
  assert.doesNotMatch(source, /Invoke-Expression|Start-Process|cmd\.exe|git\.exe|git\s+(?:reset|clean|checkout|stash|rebase)/i);
});

test('host proof is short-lived, replay protected and bound to the authenticated OpenClaw host process', () => {
  assert.match(source, /hostIssuedAt -lt \$hostNow\.AddSeconds\(-60\)/);
  assert.match(source, /hostExpiresAt -le \$hostNow/);
  assert.match(source, /OPENCLAW_HOST_PROOF_ALREADY_CONSUMED/);
  assert.match(source, /\[int\]\$hostProof\.hostPid -ne \[int\]\$hostProcess\.ProcessId/);
  assert.match(source, /OPENCLAW_GATEWAY_PROCESS_OWNERSHIP_INVALID/);
});
