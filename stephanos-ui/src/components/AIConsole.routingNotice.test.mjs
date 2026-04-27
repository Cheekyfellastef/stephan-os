import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const componentPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'AIConsole.jsx');

test('AIConsole documents assistant-router scope and points operators to Agent Mission Console for mission packets', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.equal(source.includes('This console uses the assistant/provider router. Use Agent Mission Console for mission packets and agent orchestration.'), true);
  assert.equal(source.includes('title="Stephanos Mission Console"'), true);
});
