import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { discoverApps } from '../system/apps/app_discovery.js';
import { launchProject } from '../modules/command-deck/command-deck.js';

const destination = 'https://stephanos-control-tower.timelesspearl.chatgpt.site';
const manifest = JSON.parse(readFileSync('apps/control-tower/app.json', 'utf8'));
const html = readFileSync('apps/control-tower/index.html', 'utf8');

test('Control Tower is registered once and discovery preserves explicit top-level navigation', async () => {
  const catalogue = JSON.parse(readFileSync('apps/index.json', 'utf8'));
  assert.equal(catalogue.filter(id => id === 'control-tower').length, 1);
  const originalFetch = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    if (url === './apps/index.json') return new Response(JSON.stringify(['control-tower', 'ordinary']));
    if (url === './apps/control-tower/app.json') return new Response(JSON.stringify(manifest));
    if (url === './apps/ordinary/app.json') return new Response(JSON.stringify({ name: 'Ordinary', entry: 'index.html' }));
    return new Response('local entry');
  };
  try {
    const { apps } = await discoverApps();
    const tower = apps.find(app => app.id === 'control-tower');
    assert.equal(tower.launchStrategy, 'navigate'); assert.equal(tower.entry, 'apps/control-tower/index.html');
    assert.equal(apps.find(app => app.id === 'ordinary').launchStrategy, 'workspace');
    assert.ok(requests.every(url => !url.startsWith('https:')), 'discovery must not treat the private Site as a health probe');
  } finally { globalThis.fetch = originalFetch; }
});

test('shortcut launch navigates the top-level local entry instead of creating a workspace iframe', () => {
  const originalWindow = globalThis.window; let assigned = '';
  globalThis.window = { location: { href: 'http://127.0.0.1:4173/', origin: 'http://127.0.0.1:4173', pathname: '/', assign: value => { assigned = value; } }, document: { querySelector: () => null } };
  try {
    launchProject({ id: 'control-tower', entry: 'apps/control-tower/index.html', launchStrategy: 'navigate', name: 'Control Tower' }, { workspace: { open: () => assert.fail('private Site must not be framed') } }, { type: 'user-click' });
    assert.equal(new URL(assigned).pathname, '/apps/control-tower/index.html');
  } finally { globalThis.window = originalWindow; }
});

test('fixed redirect opens only the requested Site and does not forward launcher query data', () => {
  assert.match(html, new RegExp(`href="${destination.replaceAll('.', '\\.')}"`));
  assert.match(html, /target="_top"/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  let replaced = '';
  const window = { location: { href: 'https://launcher.example/?redirect=https://unrelated.example', replace: value => { replaced = value; } } };
  window.self = window; window.top = window;
  const document = { getElementById: () => ({ href: destination }) };
  runInNewContext(script, { window, document }); assert.equal(replaced, destination);
  replaced = ''; window.top = {};
  runInNewContext(script, { window, document }); assert.equal(replaced, '', 'embedded fallback must keep its explicit top-level link rather than frame private sign-in');
});
