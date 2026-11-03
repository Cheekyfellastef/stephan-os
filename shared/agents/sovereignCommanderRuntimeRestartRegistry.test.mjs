import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Sovereign runtime restart binds the approved backend target and exact current head', async () => {
  const commander = await readFile(
    new URL('./sovereignCommanderV1.mjs', import.meta.url),
    'utf8',
  );
  const wrapper = await readFile(
    new URL('../../scripts/sovereign-commander-restart-stephanos-runtime.mjs', import.meta.url),
    'utf8',
  );

  assert.match(
    commander,
    /'restart-stephanos-runtime'[\s\S]*sovereign-commander-restart-stephanos-runtime\.mjs[\s\S]*timeoutMs:\s*120_000/,
  );
  assert.doesNotMatch(
    commander,
    /'restart-stephanos-runtime'[\s\S]{0,500}restart-approved-stephanos-runtime\.ps1/,
  );

  assert.match(wrapper, /'branch', '--show-current'/);
  assert.match(wrapper, /'rev-parse', 'HEAD'/);
  assert.match(wrapper, /'-Target', 'backend'/);
  assert.match(wrapper, /'-ExpectedHead', sourceHead/);
  assert.match(wrapper, /'-TimeoutSeconds', '90'/);
});
