import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./windowsAuthorityBattleBridgeLifeboatActivationReviewV1.mjs', import.meta.url),
  'utf8',
);

const FRESH_IDEMPOTENT_BRANCH = 'if ($null -ne $activeState -and $activeBankFreshHealthy -and $manifestSha256 -eq [string]$activeState.manifestSha256) {';
const STALE_IDEMPOTENT_BRANCH = 'if ($null -ne $activeState -and $manifestSha256 -eq [string]$activeState.manifestSha256) {';

test('Lifeboat idempotent specialist binds the healthy-current branch to active heartbeat freshness', () => {
  assert.match(
    source,
    /activeBankFreshHealthy/,
    'the specialist must explicitly bind idempotent acceptance to active heartbeat freshness',
  );
  assert.ok(
    source.includes(FRESH_IDEMPOTENT_BRANCH),
    'the bounded idempotent branch anchor must match the freshness-hardened #2162 installer guard',
  );
  assert.equal(
    source.includes(`source.indexOf('${STALE_IDEMPOTENT_BRANCH}')`),
    false,
    'the specialist must not keep anchoring its bounded branch to the pre-freshness guard',
  );
  assert.match(source, /lifeboat-idempotent-bounded-branch-missing/);
});
