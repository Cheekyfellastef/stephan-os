import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const marketplace = await readFile(new URL('../../.agents/plugins/marketplace.json', import.meta.url), 'utf8');
const manifest = await readFile(new URL('../../plugins/sovereign-commander/.codex-plugin/plugin.json', import.meta.url), 'utf8');
const mcp = await readFile(new URL('../../plugins/sovereign-commander/.mcp.json', import.meta.url), 'utf8');
const portableManifest = await readFile(new URL('../../plugins/sovereign-commander/plugin.json', import.meta.url), 'utf8');
const portableMcp = await readFile(new URL('../../plugins/sovereign-commander/mcp.json', import.meta.url), 'utf8');
const skill = await readFile(new URL('../../plugins/sovereign-commander/skills/use-sovereign-commander/SKILL.md', import.meta.url), 'utf8');
const appManifest = await readFile(new URL('../../plugins/sovereign-commander/.app.json', import.meta.url), 'utf8');

test('desktop marketplace publishes the local Sovereign Commander plugin using the current local source shape', () => {
  const catalog = JSON.parse(marketplace);
  const entry = catalog.plugins.find((plugin) => plugin.name === 'sovereign-commander');
  assert.ok(entry);
  assert.deepEqual(entry.source, {
    source: 'local',
    path: './plugins/sovereign-commander',
  });
  assert.equal(entry.policy.installation, 'AVAILABLE');
  assert.equal(entry.policy.authentication, 'ON_INSTALL');

  const plugin = JSON.parse(manifest);
  assert.equal(plugin.name, 'sovereign-commander');
  assert.equal(plugin.version, '1.0.2');
  assert.equal(plugin.mcpServers, './.mcp.json');
  assert.equal(plugin.skills, './skills');
  assert.equal(plugin.interface.displayName, 'Sovereign Commander');
});

test('compatibility desktop MCP uses native stdio shape and exports no bearer token', () => {
  const config = JSON.parse(mcp);
  const server = config.mcpServers['sovereign-commander'];
  assert.equal(Object.prototype.hasOwnProperty.call(server, 'type'), false);
  assert.equal(server.command, 'node');
  assert.deepEqual(server.args, [
    'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os\\scripts\\sovereign-commander-mcp.mjs',
  ]);
  assert.equal(
    server.env.STEPHANOS_REPO_ROOT,
    'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os',
  );
  assert.equal(Object.keys(server.env).some((key) => /token|secret|credential/i.test(key)), false);
  assert.doesNotMatch(mcp, /18791|Bearer|sovereign-commander-token/i);
});

test('portable package declares the Agent Plugins stdio transport explicitly', () => {
  const plugin = JSON.parse(portableManifest);
  const config = JSON.parse(portableMcp);
  assert.equal(plugin.name, 'sovereign-commander');
  assert.equal(plugin.version, '1.0.2');
  assert.equal(plugin.skills, './skills/');
  assert.equal(plugin.extensions['com.openai'].apps, './.app.json');
  assert.equal(plugin.extensions['com.openai'].interface.displayName, 'Sovereign Commander');
  assert.equal(config.mcpServers['sovereign-commander'].type, 'stdio');
  assert.equal(config.mcpServers['sovereign-commander'].command, 'node');
});

test('portable package declares the optional GitHub cloud fallback dependency', () => {
  const dependency = JSON.parse(appManifest);
  assert.deepEqual(dependency.apps.github, {
    id: 'connector_1p_1a69035c238881919c4190932b2df699',
    optional: true,
  });
});

test('desktop skill preserves the bounded authority contract', () => {
  assert.match(skill, /read-only tools first/i);
  assert.match(skill, /no arbitrary shell/i);
  assert.match(skill, /no arbitrary shell, force-push, merge authority/i);
  assert.match(skill, /iPad and iPhone/i);
  assert.match(skill, /Never put Sovereign Commander bearer tokens/i);
  assert.match(skill, /canonical issue #2590 mailbox/i);
  assert.match(skill, /battle-bridge-observe/i);
  assert.match(skill, /Do not ask the operator to copy telemetry/i);
});

test('desktop route remains marketplace-installed rather than adding a new Windows mutation installer', () => {
  assert.doesNotMatch(marketplace, /install-sovereign-commander-chatgpt-desktop-plugin/i);
  assert.match(skill, /This plugin is the direct local desktop route/i);
});
