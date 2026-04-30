import test from 'node:test';
import assert from 'node:assert/strict';
import { auditStephanosTilePanes } from './stephanosPaneContract.js';

const panes = [
  { id: 'openClawPanel', title: 'OpenClaw Control' },
  { id: 'agentsPanel', title: 'Agents' },
  { id: 'statusPanel', title: 'Route Status' },
];

test('audit marks canonical panes as first-class with stable ids and titles', () => {
  const audit = auditStephanosTilePanes(panes);
  assert.equal(audit.every((entry) => entry.classification === 'first-class'), true);
  assert.equal(audit.find((entry) => entry.id === 'openClawPanel').title, 'OpenClaw Control');
  assert.equal(audit.find((entry) => entry.id === 'agentsPanel').title, 'Agents');
});

test('audit marks missing id/title as failing', () => {
  const audit = auditStephanosTilePanes([{ id: '', title: '' }]);
  assert.equal(audit[0].classification, 'failing');
});
