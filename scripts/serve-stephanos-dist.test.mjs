import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveContentType } from './serve-stephanos-dist.mjs';

test('resolveContentType serves JavaScript MIME for .mjs and .js files', () => {
  assert.equal(resolveContentType('/apps/stephanos/dist/runtimeStatusModel.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(resolveContentType('/apps/stephanos/dist/assets/index.js'), 'text/javascript; charset=utf-8');
  assert.notEqual(resolveContentType('/apps/stephanos/dist/runtimeStatusModel.mjs'), 'application/octet-stream');
});

test('resolveContentType serves expected MIME types for core web assets', () => {
  assert.equal(resolveContentType('/apps/stephanos/dist/index.html'), 'text/html; charset=utf-8');
  assert.equal(resolveContentType('/apps/stephanos/dist/assets/app.css'), 'text/css; charset=utf-8');
  assert.equal(resolveContentType('/apps/stephanos/dist/stephanos-build.json'), 'application/json; charset=utf-8');
});
