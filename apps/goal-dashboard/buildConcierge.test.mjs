import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('standalone Goal Dashboard shows V4 implemented and blocked browser-proof truth', () => {
  for (const value of [
    'Build Concierge',
    'V4 Browser Proof Capture',
    'implemented_guarded',
    'V4 browser proof status',
    'blocked_unavailable',
    'V4 proof unavailable blocker',
    'Browser proof runner/runtime unavailable; browser proof is not claimed from this static page.',
    'console errors',
    'caveats',
    'V6 Operator Approval Surface',
    'V6 approval status',
    'awaiting_operator_token',
    'exact-head approval token binds PR number plus current head SHA',
    'no UI merge claim',
    'V6 rejection status',
    'implemented_guarded',
    'V7–V8 planned_guarded',
  ]) {
    assert.equal(html.includes(value), true, `missing standalone Goal Dashboard value: ${value}`);
  }
});
