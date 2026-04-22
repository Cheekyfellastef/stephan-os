import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMusicCommand } from './musicCommandParser.js';

test('parseMusicCommand detects discover unseen intent', () => {
  const parsed = parseMusicCommand('show unseen Anyma sets');
  assert.equal(parsed.intent, 'discover');
  assert.equal(parsed.entities.unseen, true);
});

test('parseMusicCommand detects channel suppression command', () => {
  const parsed = parseMusicCommand('hide this channel');
  assert.equal(parsed.intent, 'suppress');
  assert.equal(parsed.entities.target, 'channel');
});
