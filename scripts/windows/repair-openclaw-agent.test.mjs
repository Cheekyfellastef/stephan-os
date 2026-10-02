import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('./repair-openclaw-agent.ps1', import.meta.url);

test('OpenClaw repair verb is closed to the two canonical agent identities', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /ValidateSet\('Standalone', 'Local'\)/);
  assert.match(source, /'openclaw-standalone'/);
  assert.match(source, /'stephanos-scout-coder'/);
  assert.match(source, /doctor', '--lint', '--json'/);
  assert.match(source, /doctor', '--fix', '--non-interactive'/);
  assert.match(source, /agents', 'add'/);
  assert.match(source, /'--workspace', \$workspace/);
  assert.match(source, /'--agent-dir', \$agentDir/);
  assert.match(source, /gateway', 'status', '--deep', '--json'/);
  assert.match(source, /gateway', 'restart', '--wait', '20s', '--json'/);
  assert.match(source, /models', 'status', '--agent', \$agentId/);
  assert.doesNotMatch(source, /Invoke-Expression|iex\b/i);
  assert.doesNotMatch(source, /Remove-Item|Format-Volume|Clear-Disk/i);
});
