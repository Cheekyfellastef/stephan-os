import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const serviceUrl = new URL('./githubPrEvidenceService.js', import.meta.url);

test('goal priority parser preserves established colon labels alongside hyphen aliases', async () => {
  const source = await readFile(serviceUrl, 'utf8');
  const start = source.indexOf('function priorityFromLabels');
  assert.notEqual(start, -1, 'canonical goal priority parser must exist');
  const end = source.indexOf('\nfunction ', start + 1);
  const parser = source.slice(start, end > start ? end : source.length);

  for (const [level, score] of [
    ['critical', 1000],
    ['high', 750],
    ['medium', 500],
    ['low', 250],
  ]) {
    assert.match(parser, new RegExp(`priority[-:]${level}`), `priority ${level} must remain recognized`);
    assert.match(parser, new RegExp(`priority:${level}`), `established priority:${level} label must be accepted`);
    assert.match(parser, new RegExp(`priority-${level}`), `hyphenated priority-${level} alias must remain accepted`);
    assert.match(parser, new RegExp(`(?:return|\\?)\\s*${score}`), `${level} must retain score ${score}`);
  }
});
