import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const assetUrl = new URL('../plugins/stephanos-goal-cockpit/assets/goal-cockpit.html', import.meta.url);

async function readCockpitAsset() {
  return readFile(fileURLToPath(assetUrl), 'utf8');
}

test('goal cockpit app hydrates cached state, then refreshes through its read-only MCP tool', async () => {
  const html = await readCockpitAsset();

  assert.match(html, /widgetState/);
  assert.match(html, /lastSnapshot/);
  assert.match(html, /get_goal_cockpit_current/);
  assert.match(html, /callTool/);
  assert.match(html, /tools\/call/);
  assert.match(html, /setWidgetState/);
  assert.match(html, /30_?000|30000/);
  assert.match(html, /visibilitychange/);
  assert.match(html, /openai:set_globals/);
  assert.match(html, /data-theme/);
  assert.match(html, /prefers-reduced-motion/);
});

test('goal cockpit app has no direct network or mutation escape hatch', async () => {
  const html = await readCockpitAsset();

  assert.doesNotMatch(html, /\bfetch\s*\(/);
  assert.doesNotMatch(html, /\bXMLHttpRequest\b/);
  assert.doesNotMatch(html, /\bWebSocket\b/);
  assert.doesNotMatch(html, /\bEventSource\b/);
  assert.doesNotMatch(html, /<script[^>]+\bsrc\s*=/i);
  assert.doesNotMatch(html, /\.(?:innerHTML|outerHTML)\s*=/);
  assert.doesNotMatch(
    html,
    /\b(?:dispatch_codex_task|sync_codex_dispatch_bridge|update_stephanos_from_chat|merge_pull_request|approve_pull_request)\b/,
  );
});
