import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeImportStructureInSource } from '../scripts/guard-import-structure.mjs';

test('import guard passes when imports are at top and bindings are unique', () => {
  const source = [
    "import { a } from 'x';",
    "import b from 'y';",
    '',
    'const value = a + b;',
    'export { value };',
  ].join('\n');

  const violations = analyzeImportStructureInSource(source, 'valid.mjs');
  assert.equal(violations.length, 0);
});

test('import guard fails when an identifier is imported twice', () => {
  const source = [
    "import { a } from 'x';",
    "import { a } from 'x';",
    'const value = a;',
  ].join('\n');

  const violations = analyzeImportStructureInSource(source, 'duplicate.mjs');
  assert.ok(violations.some((violation) => violation.reason === 'duplicate import'));
});

test('import guard catches duplicate binding pattern that previously broke command deck', () => {
  const source = [
    "import { recordStartupLaunchTrigger } from '../../shared/runtime/startupLaunchDiagnostics.mjs';",
    'const ready = true;',
    "import { recordStartupLaunchTrigger } from '../../shared/runtime/startupLaunchDiagnostics.mjs';",
    'export { ready };',
  ].join('\n');

  const violations = analyzeImportStructureInSource(source, 'command-deck-duplicate.mjs');
  assert.ok(violations.some((violation) => violation.reason === 'duplicate import'));
  assert.ok(violations.some((violation) => violation.reason === 'import not at top'));
});

test('import guard fails when an import appears after executable code', () => {
  const source = [
    'const x = 1;',
    "import { a } from 'x';",
    'void x;',
  ].join('\n');

  const violations = analyzeImportStructureInSource(source, 'late-import.mjs');
  assert.ok(violations.some((violation) => violation.reason === 'import not at top'));
});
