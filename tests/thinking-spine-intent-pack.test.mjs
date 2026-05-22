import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
const northStar = readFileSync(new URL('../docs/STEPHANOS_NORTH_STAR.md', import.meta.url), 'utf8');
const canon = readFileSync(new URL('../docs/STEPHANOS_CANON.md', import.meta.url), 'utf8');
const antiNative = readFileSync(new URL('../docs/ANTI_NATIVE_DOCTRINE.md', import.meta.url), 'utf8');

test('Project Intent Pack docs exist with required doctrine anchors', () => {
  assert.match(agents, /Stephanos OS North Star/);
  assert.match(agents, /PR hygiene rules/);
  assert.match(northStar, /human-AI mission operating system/i);
  assert.match(canon, /dist\/\*\*.*generated output/i);
});

test('Anti-native doctrine explicitly warns about one-off local and duplicate canon risks', () => {
  assert.match(antiNative, /Local state replacing canonical projections/i);
  assert.match(antiNative, /Duplicate Mission Console surfaces or duplicate answer panes/i);
});
