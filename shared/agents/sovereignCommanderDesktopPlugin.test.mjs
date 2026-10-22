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
  assert.equal(plugin.version, '1.0.8');
  assert.equal(plugin.version, JSON.parse(portableManifest).version);
  assert.notEqual(plugin.version, '1.0.5', 'An added skill requires a fresh cache identity');
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
  assert.equal(plugin.version, '1.0.8');
  assert.equal(plugin.version, JSON.parse(manifest).version);
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
  assert.match(skill, /source-defined canonical mailbox/i);
  assert.match(skill, /battle-bridge-observe/i);
  assert.match(skill, /Do not ask the operator to copy telemetry/i);
});

test('desktop route remains marketplace-installed rather than adding a new Windows mutation installer', () => {
  assert.doesNotMatch(marketplace, /install-sovereign-commander-chatgpt-desktop-plugin/i);
  assert.match(skill, /This plugin is the direct local desktop route/i);
});


test('Plus/cloud orchestration contract is source-pinned to the private plugin skill without authority widening', () => {
  assert.match(skill, /Plus-level intent to sovereign execution \(v1\.0\.3\)/);
  assert.match(skill, /Classify intent as/);
  assert.match(skill, /BOUNDED_MAINTENANCE/);
  assert.match(skill, /MISSION_BUILD/);
  assert.match(skill, /ACCEPTED.*is not terminal completion/i);
  assert.match(skill, /current source-defined canonical GitHub command mailbox/);
  assert.match(skill, /source-binding\/custody\/lease disagreements remain held/i);
  assert.match(skill, /Do not use the public mailbox to transport source file contents/i);
  assert.match(skill, /same execution command fabric/);
  assert.match(skill, /canonical Stephanos Executive Command Plane/);
  assert.match(skill, /GitHub rate limits/);
  assert.match(skill, /original source-binding\/custody\/lease disagreements remain held|source-binding\/custody\/lease disagreements remain held/);
  assert.match(skill, /ChatGPT Plus may assist but is not a required source/);
  assert.doesNotMatch(skill, /bypass the (?:original|protected) lease/i);
});


test('sovereign recovery skill pack is present with explicit boundaries',async()=>{
 for (const relative of ['repair-build-conveyors','repair-sovereign-fast-bridge','commission-original-source-custody']) {
   const skill = await readFile(new URL('../../plugins/sovereign-commander/skills/'+relative+'/SKILL.md', import.meta.url), 'utf8');
   assert.match(skill,/^---\nname: /);
   assert.match(skill,/source|Sovereign|custody|capabilit/i);
 }
});

test('next source release inventories guarded meter-free, parity, repair and runtime-proof skills', async () => {
  const extra = [
    ['meter-free-battle-bridge-files', /public GitHub|public repo/i],
    ['remote-commander-parity', /original|existing.*#2573|canonical issue #2573/i],
    ['repair-stephanos-continuously', /original.*(lease|goal)|protected merge/i],
    ['verify-sovereign-runtime', /ACCEPTED.*terminal|terminal.*ACCEPTED/i],
  ];
  for (const [name, boundary] of extra) {
    const source = await readFile(new URL('../../plugins/sovereign-commander/skills/' + name + '/SKILL.md', import.meta.url), 'utf8');
    assert.match(source, /^---\nname: /);
    assert.match(source, boundary);
    assert.match(source, /not|never|no |without/i);
  }
  assert.equal(JSON.parse(manifest).version, '1.0.8');
  assert.equal(JSON.parse(portableManifest).version, '1.0.8');
});
