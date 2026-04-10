import test from 'node:test';
import assert from 'node:assert/strict';
import { getAgentRole, listAgentRoles } from './agentRoleRegistry.mjs';

test('agent role registry returns deterministic built-in roles', () => {
  const roles = listAgentRoles();
  assert.equal(roles.length >= 8, true);
  assert.equal(roles[0].id, 'architect');
  assert.equal(getAgentRole('builder')?.mutationAllowed, true);
  assert.equal(getAgentRole('unknown'), null);
});
