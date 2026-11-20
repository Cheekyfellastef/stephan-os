import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nativeVerifyPackageContractMatches, parseStephanosNativeFocusedTestCommand,
  resolveStephanosNativeFocusedSourceFile,
} from './stephanosNativeFocusedTaskV1.mjs';

const file = 'stephanos-server/services/example.js';
test('native focused source consumes admission expansion without widening the literal', () => {
  for (const scope of [[file], [file, file + '/**'], [file + '/**', file]]) {
    assert.equal(resolveStephanosNativeFocusedSourceFile(scope), file);
    assert.deepEqual(scope.includes(file), true);
  }
});
test('native focused scope rejects broad, malformed and multiple source permissions', () => {
  const sparse = [file]; sparse.length = 2;
  const getter = [file]; Object.defineProperty(getter, '1', { get() { assert.fail('scope getter invoked'); } });
  for (const scope of [undefined, [], ['**'], [file + '/**'], [file, 'other.js'],
    [file, 'other.js/**'], [file, file], [file, file + '/**', file], sparse, getter,
    [file, file + '/**/nested'], ['../escape.js'], ['node_modules/code.js'],
    ['stephanos-server/data/state.js'], ['.env'], ['private.pem'], new Proxy([file], {})]) {
    assert.equal(resolveStephanosNativeFocusedSourceFile(scope), '', String(scope?.length));
  }
});
test('native verification has a fixed node invocation and refuses shell variations', () => {
  assert.deepEqual(parseStephanosNativeFocusedTestCommand('npm run stephanos:verify').args,
    ['scripts/verify-stephanos-dist.mjs']);
  assert.deepEqual(parseStephanosNativeFocusedTestCommand('node --test one.test.mjs two.test.js').args,
    ['--test', 'one.test.mjs', 'two.test.js']);
  for (const command of ['npm run other', 'npm run stephanos:verify -- --write',
    'npm run stephanos:verify && echo done', 'node --test ../escape.test.js',
    'node --test .env', 'cmd /c npm run stephanos:verify']) {
    assert.equal(parseStephanosNativeFocusedTestCommand(command).ok, false);
  }
});
test('fixed verification refuses changed package mapping, lifecycle hooks and editable entrypoints', () => {
  const scripts = {'stephanos:verify': 'node scripts/verify-stephanos-dist.mjs'};
  assert.equal(nativeVerifyPackageContractMatches({scripts}, file), true);
  for (const source of ['package.json', 'scripts/verify-stephanos-dist.mjs'])
    assert.equal(nativeVerifyPackageContractMatches({scripts}, source), false);
  for (const changed of [{}, {'stephanos:verify': 'node other.mjs'},
    {...scripts, 'prestephanos:verify': 'node hook.mjs'},
    {...scripts, 'poststephanos:verify': 'node hook.mjs'}])
    assert.equal(nativeVerifyPackageContractMatches({scripts: changed}, file), false);
});
