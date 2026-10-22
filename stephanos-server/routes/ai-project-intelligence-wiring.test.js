import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const aiRouteUrl = new URL('./ai.js', import.meta.url);

test('canonical AI chat is wired to Project Intelligence grounding', async () => {
  const source = await readFile(aiRouteUrl, 'utf8');
  assert.match(source, /buildProjectIntelligenceGrounding/);
  assert.match(source, /const projectIntelligenceGrounding = buildProjectIntelligenceGrounding\(\{ prompt, liveGoalProjection \}\)/);
  assert.match(source, /projectIntelligenceGrounding\.contextBlock/);
  assert.match(source, /project_intelligence_grounding: projectIntelligenceGrounding/);
});
