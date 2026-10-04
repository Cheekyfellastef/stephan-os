import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('./sovereign-commander-goal-builder-repair.mjs', import.meta.url),
  'utf8',
);

test('goal-builder repair keeps mutating child steps off synchronous proof pipes', () => {
  assert.match(
    source,
    /const captureOutput = step === STEPS\.supervisor \|\| step === STEPS\.controllerLaneStatus;/,
  );
  assert.match(
    source,
    /stdio: captureOutput[\s\S]*?\['ignore', 'pipe', 'pipe'\][\s\S]*?: \['ignore', 'ignore', 'ignore'\]/,
  );
  assert.match(
    source,
    /stdout: captureOutput \? String\(result\?\.stdout \|\| ''\) : ''/,
  );
});
