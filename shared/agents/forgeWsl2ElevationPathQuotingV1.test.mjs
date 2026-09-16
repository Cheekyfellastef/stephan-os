import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const scriptUrl = new URL('../../scripts/windows/enable-forge-wsl2-prerequisite-v1.ps1', import.meta.url);

test('Forge WSL2 elevation preserves a self path containing spaces as one PowerShell -File argument', async () => {
  const source = await readFile(scriptUrl, 'utf8');

  assert.match(source, /\$quotedScriptPath = '"\{0\}"' -f \$ScriptPath/);
  assert.match(source, /'-File', \$quotedScriptPath,/);
  assert.doesNotMatch(source, /'-File', \$ScriptPath,/);
});
