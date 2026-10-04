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
    /evaluateMainMovementTolerantOperatorAuthorizationV1\s*\(/,
    'protected merge base binding must actually invoke the canonical evaluator, not merely mention or import it',
  );
  assert.match(
    baseBindingSource,
    /authorizationReusable|protectedExecutionReady|MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT/,
    'protected merge base binding must consume the evaluator result before treating moved-main authorization as admissible',
  );
  assert.doesNotMatch(
    baseBindingSource,
    /reusableAcrossHeads\s*[:=]\s*true|reusableAcrossBases\s*[:=]\s*true/,
    'integration must not globally weaken exact-head or exact-base receipt binding',
  );
});
