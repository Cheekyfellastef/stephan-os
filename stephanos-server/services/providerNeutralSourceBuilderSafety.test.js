import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('./providerNeutralSourceBuilderService.js', import.meta.url);

test('provider-neutral source builder never uses destructive Git cleanup', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.doesNotMatch(source, /reset\s+--hard|clean\s+-fd|clean\s+-xdf|checkout\s+-f/i);
  assert.match(source, /git\.exe'.*'apply'.*'--reverse'/s);
  assert.match(source, /PROVIDER_NEUTRAL_WORKTREE_NOT_CLEAN/);
  assert.match(source, /PROVIDER_NEUTRAL_PATCH_ROLLBACK_LEFT_CHANGES/);
});
