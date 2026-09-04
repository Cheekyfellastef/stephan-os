import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('operator merge base binding consumes main-movement-tolerant authorization base', async () => {
  const [baseBindingSource, policySource] = await Promise.all([
    read('./operatorMergeBaseBindingV1.mjs'),
    read('./mainMovementTolerantOperatorAuthorizationV1.mjs'),
  ]);

  assert.match(policySource, /authorizationBase/);
  assert.match(
    baseBindingSource,
    /authorizationBase/,
    'protected merge base binding must distinguish the original authorization base from the fresh execution base',
  );
  assert.match(
    baseBindingSource,
    /mainMovementTolerant|evaluateMainMovementTolerantOperatorAuthorizationV1/,
    'protected merge base binding must consume the canonical main-movement-tolerant authorization policy rather than treating expected_base as operator-judgment freshness',
  );
});
