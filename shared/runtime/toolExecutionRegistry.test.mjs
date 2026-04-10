import test from 'node:test';
import assert from 'node:assert/strict';
import { listToolExecutions, resolveToolByType } from './toolExecutionRegistry.mjs';

test('tool execution registry resolves deterministic tool types', () => {
  const tools = listToolExecutions();
  assert.equal(tools.length >= 10, true);
  assert.equal(resolveToolByType('generate-patch')?.requiresApproval, true);
  assert.equal(resolveToolByType('inspect-state')?.mutationRisk, 'none');
  assert.equal(resolveToolByType('missing'), null);
});
