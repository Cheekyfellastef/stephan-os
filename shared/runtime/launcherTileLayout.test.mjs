import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePaneOrder, moveOrderedId } from './paneOrder.mjs';
import { LAUNCHER_TILE_ORDER_LAYOUT_KEY, LAUNCHER_TILE_DRAG_TIMEOUT_MS, orderLauncherProjects, persistLauncherTileOrder, prepareLauncherTileLayout, readLauncherTileOrder } from './launcherTileLayout.mjs';
import { STEPHANOS_SESSION_MEMORY_STORAGE_KEY, readPersistedStephanosSessionMemory } from './stephanosSessionMemory.mjs';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function event(extra = {}) { return { preventDefault() {}, stopPropagation() {}, ...extra }; }
function fixture(storage = memoryStorage(), timers = globalThis) {
  const doc = { createElement: tag => element(tag) };
  function element(tag = 'div') {
    const node = { tagName: tag.toUpperCase(), ownerDocument: doc, children: [], dataset: {}, attributes: {}, className: '', style: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
      insertBefore(child, existing) { child.parentNode = this; this.children.splice(this.children.indexOf(existing), 0, child); },
      focus() { doc.activeElement = this; },
    };
    node.classList = { add: value => { node.className += ` ${value}`; }, remove: value => { node.className = node.className.split(' ').filter(x => x !== value).join(' '); } };
    return node;
  }
  const parent = element();
  const container = element(); container.id = 'project-registry'; parent.appendChild(container);
  const launched = [];
  let projects = ['a', 'b', 'c'].map(id => ({ id, name: `Tile ${id}`, entry: `${id}.html` }));
  let signature = '';
  function render() {
    const layout = prepareLauncherTileLayout(container, projects, render, { storage, timers });
    if (layout.deferred) return;
    const nextSignature = JSON.stringify([projects, layout.signature]);
    if (nextSignature === signature) return;
    signature = nextSignature;
    layout.beforeRender();
    container.children = [];
    for (const project of layout.projects) {
      const tile = element(); tile.textContent = project.statusMessage || project.name;
      layout.decorateTile(tile, project, () => launched.push(project.id)); container.appendChild(tile);
    }
    layout.afterRender();
  }
  render();
  return { container, parent, doc, storage, launched, render, projects: () => projects, setProjects: value => { projects = value; render(); },
    ids: () => container.children.map(node => node.dataset.tileId),
    tile: id => container.children.find(node => node.dataset.tileId === id),
    toolbar: () => parent.children.find(node => node.className === 'launcher-arrange-toolbar'),
  };
}

test('shared order drops unknown and duplicate IDs and appends newly discovered tiles', () => {
  assert.deepEqual(reconcilePaneOrder(['c', 'obsolete', 'c', 'a'], ['a', 'b', 'b', 'c', 'control-tower']), ['c', 'a', 'b', 'control-tower']);
  const projects = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(orderLauncherProjects(projects, ['c', 'a']).map(x => x.id), ['c', 'a', 'b']);
  assert.deepEqual(projects.map(x => x.id), ['a', 'b', 'c']);
});

test('every bounded move preserves the exact catalogue and does not mutate its input', () => {
  for (const order of [['a', 'b', 'c'], ['c', 'a', 'b'], ['b', 'c', 'a']]) {
    for (const id of order) for (const target of [-100, 0, 1, 2, 100]) {
      const before = [...order]; const moved = moveOrderedId(order, id, target);
      assert.deepEqual(new Set(moved), new Set(order)); assert.equal(moved.length, order.length);
      assert.equal(moved[Math.max(0, Math.min(2, target))], id); assert.deepEqual(order, before);
    }
  }
});

test('layout round-trips through canonical session memory while preserving unrelated preferences', () => {
  const storage = memoryStorage({ [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: JSON.stringify({ session: { ui: { uiLayout: { runtimeDiagnosticsVisible: true, panelPositions: { laws: { x: 40, y: 25 } } }, operatorPaneLayout: { order: ['status', 'console'] } } }, working: { currentTask: 'Preserve this task' } }) });
  const result = persistLauncherTileOrder(['c', 'a', 'b'], ['a', 'b', 'c'], storage);
  assert.equal(result.saved, true); assert.deepEqual(readLauncherTileOrder(['a', 'b', 'c', 'new'], storage), ['c', 'a', 'b', 'new']);
  const memory = readPersistedStephanosSessionMemory(storage);
  assert.equal(memory.session.ui.uiLayout.runtimeDiagnosticsVisible, true);
  assert.deepEqual(memory.session.ui.uiLayout.panelPositions, { laws: { x: 40, y: 25 } });
  assert.deepEqual(memory.session.ui.operatorPaneLayout.order, ['status', 'console']);
  assert.equal(memory.working.currentTask, 'Preserve this task');
  assert.deepEqual(memory.session.ui.uiLayout[LAUNCHER_TILE_ORDER_LAYOUT_KEY], ['c', 'a', 'b']);
});

test('failed, silent and unreadable storage never claims a successful save', () => {
  const existing = JSON.stringify({ session: { ui: { uiLayout: { launcherTileOrder: ['b', 'a'] } } } });
  const failures = [null,
    { getItem: () => existing, setItem: () => { throw new Error('quota'); } },
    { getItem: () => existing, setItem() {} },
    { getItem: () => { throw new Error('blocked'); }, setItem() { assert.fail('must not overwrite unreadable memory'); } },
    { getItem: () => '{bad-json', setItem() { assert.fail('must not overwrite corrupt session memory'); } },
  ];
  for (const storage of failures) assert.equal(persistLauncherTileOrder(['a', 'b'], ['a', 'b'], storage).saved, false);
});

test('arrange mode suppresses launch and keyboard/move controls save the new order', () => {
  const ui = fixture();
  ui.tile('a').onclick(event()); assert.deepEqual(ui.launched, ['a']);
  ui.toolbar().children[0].onclick();
  ui.tile('a').onclick(event()); assert.deepEqual(ui.launched, ['a']);
  const handle = ui.tile('b').children[0].children[1];
  handle.onkeydown(event({ key: 'ArrowUp' }));
  assert.deepEqual(ui.ids(), ['b', 'a', 'c']);
  assert.deepEqual(readLauncherTileOrder(['a', 'b', 'c'], ui.storage), ['b', 'a', 'c']);
  assert.match(ui.toolbar().children[2].textContent, /Saved in this browser/);
  assert.equal(ui.doc.activeElement, ui.tile('b').children[0].children[1]);
  ui.toolbar().children[0].onclick();
  ui.tile('b').onkeydown(event({ target: ui.tile('b'), key: 'Enter' }));
  assert.deepEqual(ui.launched, ['a', 'b']);
});

test('only this grid drag can reorder; external drag payloads cannot launch or move tiles', () => {
  const ui = fixture(); ui.toolbar().children[0].onclick();
  const drag = { effectAllowed: '', dropEffect: '', setData() {}, getData: () => 'a' };
  ui.tile('c').ondrop(event({ dataTransfer: drag })); assert.deepEqual(ui.ids(), ['a', 'b', 'c']);
  ui.tile('c').children[0].children[1].ondragstart(event({ dataTransfer: drag }));
  ui.tile('a').ondrop(event({ dataTransfer: drag }));
  assert.deepEqual(ui.ids(), ['c', 'a', 'b']); assert.deepEqual(ui.launched, []);
  assert.deepEqual(readLauncherTileOrder(['a', 'b', 'c'], ui.storage), ['c', 'a', 'b']);
});

test('unsaved order survives status rerenders, with explicit failure feedback', () => {
  const ui = fixture({ getItem: () => null, setItem: () => { throw new Error('blocked'); } });
  ui.toolbar().children[0].onclick(); ui.tile('c').children[0].children[0].onclick(event());
  assert.deepEqual(ui.ids(), ['a', 'c', 'b']); assert.match(ui.toolbar().children[2].textContent, /Not saved/);
  ui.render(); assert.deepEqual(ui.ids(), ['a', 'c', 'b']);
  assert.equal(ui.toolbar().children[2].dataset.saveState, 'unsaved');
});

test('live status rebuilds preserve the exact focused control after intervening unchanged renders', () => {
  const ui = fixture(); ui.toolbar().children[0].onclick();
  for (const controlIndex of [0, 1, 2]) {
    const previousTile = ui.tile('b');
    previousTile.children[0].children[controlIndex].focus();
    ui.render(); assert.equal(ui.tile('b'), previousTile, 'unchanged render retains its real DOM');
    ui.setProjects(ui.projects().map(project => project.id === 'a' ? { ...project, statusMessage: `Updated ${controlIndex}` } : project));
    assert.notEqual(ui.tile('b'), previousTile, 'changed status rebuilt the grid');
    assert.equal(ui.doc.activeElement, ui.tile('b').children[0].children[controlIndex]);
  }
  ui.toolbar().children[0].onclick();
  ui.tile('a').focus();
  ui.setProjects(ui.projects().map(project => ({ ...project, statusMessage: 'Next observation' })));
  assert.equal(ui.doc.activeElement, ui.tile('a'), 'ordinary tile keyboard focus also survives refresh');
});

test('active drag keeps its DOM until drop and then renders only the newest pending catalogue', () => {
  const ui = fixture(); ui.toolbar().children[0].onclick();
  const source = ui.tile('c'); const handle = source.children[0].children[1];
  const drag = { setData() {} }; handle.ondragstart(event({ dataTransfer: drag }));
  ui.setProjects(ui.projects().map(project => ({ ...project, statusMessage: 'Older pending observation' })));
  assert.equal(ui.tile('c'), source);
  ui.setProjects([...ui.projects().map(project => ({ ...project, statusMessage: 'Newest observation' })), { id: 'new', name: 'New tile' }]);
  assert.equal(ui.tile('c'), source); assert.deepEqual(ui.ids(), ['a', 'b', 'c']);
  ui.tile('a').ondrop(event({ dataTransfer: drag }));
  assert.deepEqual(ui.ids(), ['c', 'a', 'b', 'new']);
  assert.equal(ui.tile('b').textContent, 'Newest observation');
  assert.equal(ui.container.children.some(tile => /dragging|drop-target/.test(tile.className)), false);
  ui.tile('b').ondrop(event({ dataTransfer: drag }));
  assert.deepEqual(ui.ids(), ['c', 'a', 'b', 'new'], 'completed drag cannot leave a drop armed');
});

test('drag cancellation flushes latest status without saving a move', () => {
  const ui = fixture(); ui.toolbar().children[0].onclick();
  const handle = ui.tile('b').children[0].children[1];
  handle.ondragstart(event({ dataTransfer: { setData() {} } }));
  ui.setProjects(ui.projects().map(project => ({ ...project, statusMessage: 'Latest after cancel' })));
  handle.ondragend();
  assert.deepEqual(ui.ids(), ['a', 'b', 'c']);
  assert.equal(ui.tile('a').textContent, 'Latest after cancel');
  assert.equal(ui.storage.getItem(STEPHANOS_SESSION_MEMORY_STORAGE_KEY), null);
});

test('a bounded drag timeout releases pending updates and disarms later drops', () => {
  let callback; let delay; let cleared = false;
  const timers = { setTimeout(fn, ms) { callback = fn; delay = ms; return 1; }, clearTimeout() { cleared = true; } };
  const ui = fixture(memoryStorage(), timers); ui.toolbar().children[0].onclick();
  const drag = { setData() {} };
  ui.tile('c').children[0].children[1].ondragstart(event({ dataTransfer: drag }));
  ui.setProjects(ui.projects().map(project => ({ ...project, statusMessage: 'Latest after timeout' })));
  assert.equal(delay, LAUNCHER_TILE_DRAG_TIMEOUT_MS); callback();
  assert.equal(cleared, true); assert.equal(ui.tile('a').textContent, 'Latest after timeout');
  assert.match(ui.toolbar().children[2].textContent, /Drag ended/);
  ui.tile('a').ondrop(event({ dataTransfer: drag }));
  assert.deepEqual(ui.ids(), ['a', 'b', 'c']);
});

test('catalogue refresh, temporary omission and reset preserve a safe complete order', () => {
  const storage = memoryStorage(); persistLauncherTileOrder(['c', 'a', 'b'], ['a', 'b', 'c'], storage);
  const ui = fixture(storage);
  ui.setProjects([{ id: 'a', name: 'Tile a' }]); assert.deepEqual(ui.ids(), ['a']);
  ui.setProjects(['a', 'b', 'c', 'control-tower'].map(id => ({ id, name: id })));
  assert.deepEqual(ui.ids(), ['c', 'a', 'b', 'control-tower']);
  ui.toolbar().children[0].onclick(); ui.toolbar().children[1].onclick();
  assert.deepEqual(ui.ids(), ['a', 'b', 'c', 'control-tower']);
  assert.deepEqual(readLauncherTileOrder(['a', 'b', 'c', 'control-tower'], storage), ['a', 'b', 'c', 'control-tower']);
});
