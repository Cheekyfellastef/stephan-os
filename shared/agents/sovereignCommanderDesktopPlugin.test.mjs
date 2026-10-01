import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const marketplace = await readFile(new URL('../../.agents/plugins/marketplace.json', import.meta.url), 'utf8');
const manifest = await readFile(new URL('../../plugins/sovereign-commander/.codex-plugin/plugin.json', import.meta.url), 'utf8');
const mcpTemplate = await readFile(new URL('../../plugins/sovereign-commander/.mcp.json.template', import.meta.url), 'utf8');
const skill = await readFile(new URL('../../plugins/sovereign-commander/skills/use-sovereign-commander/SKILL.md', import.meta.url), 'utf8');

test('desktop marketplace publishes the local Sovereign Commander plugin', () => {
  const catalog = JSON.parse(marketplace);
  const entry = catalog.plugins.find((plugin) => plugin.name === 'sovereign-commander');
  assert.ok(entry);
  assert.equal(entry.source, '../../plugins/sovereign-commander');

  const plugin = JSON.parse(manifest);
  assert.equal(plugin.name, 'sovereign-commander');
  assert.equal(plugin.version, '1.0.0');
});

test('desktop plugin uses the local stdio MCP server and exports no bearer token', () => {
  const config = JSON.parse(mcpTemplate);
  const server = config.mcpServers['sovereign-commander'];
  assert.equal(server.command, 'node');
  assert.deepEqual(server.args, ['__MCP_SERVER_PATH__']);
  assert.equal(server.env.STEPHANOS_REPO_ROOT, '__REPO_ROOT__');
  assert.equal(Object.keys(server.env).some((key) => /token|secret|credential/i.test(key)), false);
  assert.doesNotMatch(mcpTemplate, /18791|Bearer|sovereign-commander-token/i);
});

test('desktop skill preserves the bounded authority contract', () => {
  assert.match(skill, /read-only tools first/i);
  assert.match(skill, /no arbitrary shell/i);
  assert.match(skill, /no arbitrary shell, force-push, merge authority/i);
  assert.match(skill, /iPad and iPhone/i);
  assert.match(skill, /Never put Sovereign Commander bearer tokens/i);
});

test('desktop route remains marketplace-installed rather than adding a new Windows mutation installer', () => {
  assert.doesNotMatch(marketplace, /install-sovereign-commander-chatgpt-desktop-plugin/i);
  assert.match(skill, /This plugin is the direct local desktop route/i);
});
