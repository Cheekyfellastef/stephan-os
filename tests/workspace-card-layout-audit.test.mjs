/**
 * Read-only geometry tooling for #2664. No application/runtime health verdict.
 * Both exports are closure-free: serialize either function for browser evaluate.
 * Node tests are loaded conditionally so the whole module also imports in a browser.
 */
export function auditCardLayout(snapshot, { tolerance = 1 } = {}) {
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 4)
    throw new TypeError('tolerance must be between 0 and 4 CSS pixels');
  const rect = (r) => {
    if (!r || !['left', 'top', 'right', 'bottom'].every(k => Number.isFinite(r[k]))
      || r.right < r.left || r.bottom < r.top) throw new TypeError('invalid rectangle');
    return r;
  };
  if (!snapshot || !Array.isArray(snapshot.cards)) throw new TypeError('cards required');
  const findings = [], affordances = [];
  const ids = new Set();
  const emit = (code, card, item, extra = {}) =>
    findings.push({ code, cardId: card.id, itemId: item.id, ...extra });
  const outside = (a, b, axis) => axis === 'X'
    ? a.left < b.left - tolerance || a.right > b.right + tolerance
    : a.top < b.top - tolerance || a.bottom > b.bottom + tolerance;
  const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance;
  for (const card of snapshot.cards) {
    if (typeof card.id !== 'string' || !card.id || ids.has(card.id))
      throw new TypeError('unique card ids required');
    ids.add(card.id);
    rect(card.rect);
    if (!Array.isArray(card.items)) throw new TypeError('items required');
    const itemIds = new Set(), visible = [];
    for (const item of card.items) {
      if (typeof item.id !== 'string' || !item.id || itemIds.has(item.id))
        throw new TypeError('unique item ids required');
      itemIds.add(item.id);
      if (!['text', 'badge', 'control', 'card'].includes(item.kind))
        throw new TypeError('invalid item kind');
      rect(item.rect);
      if (item.rect.right === item.rect.left || item.rect.bottom === item.rect.top) continue;
      const pieces = item.rects || [item.rect];
      if (!Array.isArray(pieces) || !pieces.length) throw new TypeError('rects required');
      const painted = [];
      for (const piece of pieces) {
        let current = { ...rect(piece) };
        for (const clip of item.clips || []) {
          rect(clip.rect);
          for (const axis of ['X', 'Y']) {
            const mode = clip[axis.toLowerCase()] || 'visible';
            if (!['visible', 'hidden', 'clip', 'auto', 'scroll'].includes(mode))
              throw new TypeError('invalid overflow mode');
            if (mode === 'visible' || !outside(current, clip.rect, axis)) continue;
            const scroll = mode === 'auto' || mode === 'scroll';
            const ellipsis = axis === 'X' && item.kind === 'text'
              && clip.ellipsis === true && clip.fullValueAvailable === true;
            if (scroll || ellipsis) {
              affordances.push({ cardId: card.id, itemId: item.id, axis,
                type: scroll ? 'SCROLL_REQUIRES_INTERACTION_PROOF' : 'ELLIPSIS_FULL_VALUE' });
            } else emit('CLIPPED_' + axis, card, item, { clipId: clip.id });
            if (axis === 'X') {
              current.left = Math.max(current.left, clip.rect.left);
              current.right = Math.min(current.right, clip.rect.right);
            } else {
              current.top = Math.max(current.top, clip.rect.top);
              current.bottom = Math.min(current.bottom, clip.rect.bottom);
            }
          }
          if (current.right <= current.left || current.bottom <= current.top) break;
        }
        if (current.right <= current.left || current.bottom <= current.top) continue;
        if (outside(current, card.rect, 'X')) emit('ESCAPE_X', card, item);
        if (outside(current, card.rect, 'Y')) emit('ESCAPE_Y', card, item);
        painted.push(current);
      }
      visible.push({ ...item, painted });
    }
    for (let a = 0; a < visible.length; a++) {
      for (let b = a + 1; b < visible.length; b++) {
        const x = visible[a], y = visible[b];
        // A button/badge and its own label are intentionally coincident.
        // Distinct labels inside that same control still collide.
        if ((x.kind !== 'text' && y.ownerId === x.id)
          || (y.kind !== 'text' && x.ownerId === y.id)) continue;
        if (x.painted.some(p => y.painted.some(q => overlap(p, q))))
          emit('COLLISION', card, x, { otherItemId: y.id, kinds: [x.kind, y.kind] });
      }
    }
  }
  const unique = rows => [...new Map(rows.map(row => [JSON.stringify(row), row])).values()];
  const measuredItems = snapshot.cards.reduce((n, c) => n + c.items.length, 0);
  return {
    schemaVersion: 'stephanos.workspace-card-layout-audit.v1',
    evidenceClass: 'GEOMETRY_ONLY',
    coverage: snapshot.cards.length && measuredItems ? 'MEASURED' : 'EMPTY',
    cardCount: snapshot.cards.length, itemCount: measuredItems,
    findings: unique(findings), affordances: unique(affordances),
  };
}

export function extractCardLayout({
  cardSelector,
  rootSelector = 'body',
  badgeSelector = '[class*="badge"],[class*="pill"],[class*="chip"]',
  controlSelector = 'button,a[href],input,select,textarea,[role="button"]',
} = {}) {
  if (typeof cardSelector !== 'string' || !cardSelector.trim())
    throw new TypeError('explicit cardSelector required');
  const doc = document, root = doc.querySelector(rootSelector);
  if (!root) throw new TypeError('audit root missing');
  const view = doc.defaultView;
  const box = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const area = r => r.right > r.left && r.bottom > r.top;
  const style = el => view.getComputedStyle(el);
  const visible = el => {
    for (let p = el; p; p = p.parentElement) {
      const s = style(p);
      if (p.hidden || s.display === 'none' || s.visibility === 'hidden'
        || s.visibility === 'collapse' || Number(s.opacity) === 0
        || s.contentVisibility === 'hidden') return false;
    }
    return area(el.getBoundingClientRect());
  };
  const cards = [...root.querySelectorAll(cardSelector)].filter(visible);
  if (root.matches(cardSelector) && visible(root)) cards.unshift(root);
  const cardSet = new Set(cards), ids = new Map(), elementIds = new Map();
  cards.forEach((el, i) => ids.set(el, 'card-' + i));
  let nextId = 0;
  const id = el => {
    if (!elementIds.has(el)) elementIds.set(el, 'item-' + nextId++);
    return elementIds.get(el);
  };
  const owner = el => {
    for (let p = el; p; p = p.parentElement) if (cardSet.has(p)) return p;
    return null;
  };
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  // Text measures contents and retains its own clip. Border-box items must
  // start at the parent: overflow never clips the element's own border box.
  const clips = (el, { includeSelf = true } = {}) => {
    const result = [];
    for (let p = includeSelf ? el : el.parentElement; p; p = p.parentElement) {
      const s = style(p), r = p.getBoundingClientRect();
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      // client box excludes border and scrollbar; CSS-pixel scaling supports zoom/transforms.
      const sx = p.offsetWidth ? r.width / p.offsetWidth : 1;
      const sy = p.offsetHeight ? r.height / p.offsetHeight : 1;
      const left = r.left + p.clientLeft * sx, top = r.top + p.clientTop * sy;
      const value = norm(el.textContent);
      result.push({
        id: id(p),
        rect: { left, top, right: left + p.clientWidth * sx, bottom: top + p.clientHeight * sy },
        x: s.overflowX, y: s.overflowY,
        // Only the text's own clipping element can grant ellipsis. An unrelated ancestor
        // tooltip, aria-label or overflow:hidden is never sufficient.
        ellipsis: p === el && s.textOverflow === 'ellipsis' && s.whiteSpace === 'nowrap',
        fullValueAvailable: p === el && value.length > 0 && norm(p.getAttribute('title')) === value,
      });
    }
    return result;
  };
  const describe = el => ({
    tag: el.tagName.toLowerCase(), id: el.id || null,
    classes: typeof el.className === 'string' ? el.className : '',
  });
  const results = cards.map(card => {
    const items = [], nodes = [card, ...card.querySelectorAll('*')];
    for (const el of nodes) {
      if (el !== card && cardSet.has(el)) {
        // Only the immediate nested card is a parent item. Its content is audited separately.
        if (owner(el.parentElement) === card && visible(el))
          items.push({ id: id(el), kind: 'card', rect: box(el.getBoundingClientRect()),
            clips: clips(el, { includeSelf: false }), element: describe(el) });
        continue;
      }
      if (owner(el) !== card || !visible(el)) continue;
      if (el !== card && el.matches(controlSelector + ',' + badgeSelector)) {
        // Nested badge/control wrappers would double-count their descendant boxes.
        const ancestor = el.parentElement?.closest(controlSelector + ',' + badgeSelector);
        if (!ancestor || ancestor === card || owner(ancestor) !== card)
          items.push({ id: id(el), kind: el.matches(controlSelector) ? 'control' : 'badge',
            rect: box(el.getBoundingClientRect()), clips: clips(el, { includeSelf: false }), element: describe(el) });
      }
      if (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(el.tagName)) continue;
      for (const node of el.childNodes) {
        if (node.nodeType !== 3 || !norm(node.textContent)) continue;
        const range = doc.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter(area).map(box);
        if (!rects.length) continue;
        let labelOwner = el.closest(controlSelector + ',' + badgeSelector);
        // Use the outermost item box within this card as the text-label owner.
        while (labelOwner && labelOwner !== card) {
          const parent = labelOwner.parentElement?.closest(controlSelector + ',' + badgeSelector);
          if (!parent || parent === card || owner(parent) !== card) break;
          labelOwner = parent;
        }
        items.push({ id: 'text-' + nextId++, kind: 'text',
          ownerId: labelOwner && labelOwner !== card ? id(labelOwner) : null,
          rect: box(range.getBoundingClientRect()), rects, clips: clips(el),
          text: norm(node.textContent), element: describe(el) });
      }
    }
    return { id: ids.get(card), rect: box(card.getBoundingClientRect()), element: describe(card), items };
  });
  return { cards: results, selection: { cardSelector, rootSelector },
    viewport: { width: view.innerWidth, height: view.innerHeight, devicePixelRatio: view.devicePixelRatio },
    limitations: ['Geometry is not visual, focus, hit-testing or runtime-health proof.',
      'Light DOM only; audit each iframe/shadow root separately. Input values and pseudo-elements need visual inspection.'] };
}

if (typeof process !== 'undefined' && process.versions?.node) {
  const { default: test } = await import('node:test');
  const { default: assert } = await import('node:assert/strict');
  const { runInNewContext } = await import('node:vm');
  const r = (left = 0, top = 0, right = 100, bottom = 80) => ({ left, top, right, bottom });
  const item = (id, kind = 'text', rect = r(5, 5, 40, 20), extra = {}) => ({ id, kind, rect, ...extra });
  const snapshot = (...items) => ({ cards: [{ id: 'card', rect: r(), items }] });
  const codes = data => auditCardLayout(data).findings.map(f => f.code);
  const clip = (extra = {}) => ({ id: 'clip', rect: r(0, 0, 70, 70), x: 'hidden', y: 'visible', ...extra });

  test('empty selection is explicit and malformed geometry fails closed', () => {
    assert.equal(auditCardLayout({ cards: [] }).coverage, 'EMPTY');
    assert.equal(auditCardLayout(snapshot()).coverage, 'EMPTY');
    for (const value of [-1, NaN, Infinity, 5])
      assert.throws(() => auditCardLayout(snapshot(), { tolerance: value }), TypeError);
    assert.throws(() => auditCardLayout(snapshot(item('bad', 'text', r(20, 0, 10, 20)))), TypeError);
    assert.throws(() => auditCardLayout(snapshot(item('bad', 'text', r(0, 0, Infinity, 20)))), TypeError);
    assert.throws(() => auditCardLayout(snapshot(item('same'), item('same'))), TypeError);
    assert.throws(() => auditCardLayout({ cards: [snapshot().cards[0], snapshot().cards[0]] }), TypeError);
  });

  test('contained multiline title uses fragments, not its union box for collision', () => {
    const title = item('title', 'text', r(5, 5, 80, 40), { rects: [r(5, 5, 80, 18), r(5, 25, 40, 40)] });
    assert.deepEqual(codes(snapshot(title, item('badge', 'badge', r(50, 26, 80, 40)))), []);
  });

  test('detects all four edge escapes and respects bounded fractional tolerance', () => {
    for (const rect of [r(-2, 5, 40, 20), r(5, 5, 102, 20)])
      assert.deepEqual(codes(snapshot(item('hash', 'text', rect))), ['ESCAPE_X']);
    for (const rect of [r(5, -2, 40, 20), r(5, 70, 40, 82)])
      assert.deepEqual(codes(snapshot(item('status', 'text', rect))), ['ESCAPE_Y']);
    assert.deepEqual(codes(snapshot(item('rounding', 'text', r(-0.8, 0, 100.8, 80.8)))), []);
    assert.equal(auditCardLayout(snapshot(item('rounding', 'text', r(-0.8, 0, 40, 20))), { tolerance: 0 }).findings[0].code, 'ESCAPE_X');
  });

  test('long titles, truthful unavailable states and hashes cannot be silently clipped', () => {
    for (const text of ['A very long agent title '.repeat(12), 'UNKNOWN / STALE / UNREACHABLE', 'f'.repeat(40)]) {
      assert.deepEqual(codes(snapshot(item('long', 'text', r(5, 5, 95, 20), { text, clips: [clip()] }))), ['CLIPPED_X']);
      assert.deepEqual(codes(snapshot(item('long', 'text', r(5, 5, 40, 78), { text,
        clips: [clip({ y: 'clip', x: 'visible' })] }))), ['CLIPPED_Y']);
    }
  });

  test('ellipsis needs both CSS evidence and an explicit complete value; never excuses height', () => {
    const make = c => snapshot(item('title', 'text', r(5, 5, 95, 78), { clips: [c] }));
    assert.ok(codes(make(clip({ ellipsis: true }))).includes('CLIPPED_X'));
    assert.ok(codes(make(clip({ fullValueAvailable: true }))).includes('CLIPPED_X'));
    const result = auditCardLayout(make(clip({ ellipsis: true, fullValueAvailable: true, y: 'hidden' })));
    assert.deepEqual(result.findings.map(f => f.code), ['CLIPPED_Y']);
    assert.equal(result.affordances[0].type, 'ELLIPSIS_FULL_VALUE');
  });

  test('intentional scroll clips only its own axis and retains interaction-proof debt', () => {
    for (const mode of ['auto', 'scroll']) {
      const result = auditCardLayout(snapshot(item('log', 'text', r(0, 0, 160, 100),
        { clips: [clip({ x: mode, y: 'visible' })] })));
      assert.deepEqual(result.findings.map(f => f.code), ['ESCAPE_Y']);
      assert.equal(result.affordances[0].type, 'SCROLL_REQUIRES_INTERACTION_PROOF');
    }
  });

  test('scroll or ellipsis never masks a second hidden ancestor or an escaping control', () => {
    const clips = [clip({ x: 'auto', rect: r(0, 0, 90, 70) }), clip()];
    assert.ok(codes(snapshot(item('nested', 'text', r(5, 5, 150, 20), { clips }))).includes('CLIPPED_X'));
    assert.ok(codes(snapshot(item('button', 'control', r(90, 5, 120, 30)))).includes('ESCAPE_X'));
  });

  test('badge/text/control and control/control collisions are reported', () => {
    for (const [a, b] of [['text', 'badge'], ['text', 'control'], ['badge', 'control'], ['control', 'control'], ['text', 'text']])
      assert.ok(codes(snapshot(item('a', a), item('b', b))).includes('COLLISION'));
    assert.deepEqual(codes(snapshot(item('a'), item('b', 'badge', r(40, 5, 60, 20)))), []);
  });

  test('labels inside controls are allowed, but sibling labels and unrelated text still collide', () => {
    const button = item('button', 'control');
    const label = item('label', 'text', r(6, 6, 30, 18), { ownerId: 'button' });
    assert.deepEqual(codes(snapshot(button, label)), []);
    assert.ok(codes(snapshot(button, label, item('other-label', 'text', label.rect, { ownerId: 'button' }))).includes('COLLISION'));
    assert.ok(codes(snapshot(button, item('unrelated'))).includes('COLLISION'));
  });

  test('nested cards own content independently while their outer boundary remains checked', () => {
    const child = { id: 'child', rect: r(10, 30, 80, 70), items: [item('title', 'text', r(15, 35, 50, 50))] };
    const parent = { id: 'parent', rect: r(), items: [item('child-box', 'card', child.rect)] };
    assert.deepEqual(codes({ cards: [parent, child] }), []);
    child.items[0].rect = r(15, 35, 90, 50);
    assert.equal(auditCardLayout({ cards: [parent, child] }).findings[0].cardId, 'child');
    parent.items[0].rect = r(10, 30, 105, 70);
    assert.ok(codes({ cards: [parent, child] }).includes('ESCAPE_X'));
  });

  test('adversarial edge sweep is translation invariant and does not mutate evidence', () => {
    for (let shift = -5; shift <= 5; shift++) {
      const data = snapshot(item('edge', 'text', r(shift, 5, 50, 20)));
      const before = JSON.stringify(data);
      assert.equal(codes(data).includes('ESCAPE_X'), shift < -1);
      const translated = JSON.parse(before);
      for (const rect of [translated.cards[0].rect, translated.cards[0].items[0].rect]) {
        rect.left += 321; rect.right += 321; rect.top -= 77; rect.bottom -= 77;
      }
      assert.deepEqual(codes(translated), codes(data));
      assert.equal(JSON.stringify(data), before);
    }
  });

  // A deterministic light-DOM double verifies the serialized extractor's API usage.
  // It is deliberately not browser/layout-engine proof.
  function fakeDocument() {
    const elements = [];
    function el(tag, classes, bounds, parent = null, css = {}, title = null) {
      const e = { tagName: tag, className: classes, id: '', parentElement: parent, hidden: false,
        childNodes: [], css: { display: 'block', visibility: 'visible', opacity: '1',
          overflowX: 'visible', overflowY: 'visible', ...css },
        textContent: '', clientLeft: 0, clientTop: 0, clientWidth: bounds.right - bounds.left,
        clientHeight: bounds.bottom - bounds.top, offsetWidth: bounds.right - bounds.left,
        offsetHeight: bounds.bottom - bounds.top,
        getBoundingClientRect: () => ({ ...bounds, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }),
        getAttribute: name => name === 'title' ? title : null,
        matches(selector) { return selector.split(',').some(s => s === 'body' ? tag === 'BODY'
          : s === '.card' ? classes.includes('card')
          : s === 'button' ? tag === 'BUTTON'
          : s.includes('badge') ? classes.includes('badge') : false); },
        closest(selector) { return this.matches(selector) ? this : parent?.closest(selector) || null; },
        querySelectorAll(selector) { return elements.filter(x => x !== this && x.closestAncestor(this) && (selector === '*' || x.matches(selector))); },
        closestAncestor(ancestor) { for (let p = this.parentElement; p; p = p.parentElement) if (p === ancestor) return true; return false; },
      };
      elements.push(e); return e;
    }
    const root = el('BODY', '', r(0, 0, 500, 500));
    const card = el('ARTICLE', 'card', r(), root);
    const title = el('SPAN', '', r(5, 5, 70, 20), card,
      { overflowX: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, 'Long title');
    title.textContent = 'Long title';
    const node = { nodeType: 3, textContent: 'Long title' };
    title.childNodes.push(node);
    const nested = el('ARTICLE', 'card', r(5, 30, 90, 70), card);
    const button = el('BUTTON', '', r(10, 35, 70, 55), nested);
    button.textContent = 'Open';
    button.childNodes.push({ nodeType: 3, textContent: 'Open' });
    const doc = { defaultView: { getComputedStyle: e => e.css, innerWidth: 500, innerHeight: 500, devicePixelRatio: 1 },
      querySelector: s => s === 'body' ? root : null,
      createRange() {
        let selected;
        return { selectNodeContents: n => { selected = n; },
          getClientRects: () => [selected === node ? r(5, 5, 95, 20) : r(15, 38, 50, 50)],
          getBoundingClientRect: () => selected === node ? r(5, 5, 95, 20) : r(15, 38, 50, 50) };
      } };
    return { doc, root, card, title, nested, button };
  }

  test('both helpers survive serialization; extraction preserves nested ownership, text and full-value evidence', () => {
    const fixture = fakeDocument();
    const extracted = runInNewContext('(' + extractCardLayout.toString() + ')({cardSelector:".card"})', { document: fixture.doc });
    assert.equal(extracted.cards.length, 2);
    assert.equal(extracted.cards[0].items.filter(x => x.kind === 'text').length, 1);
    assert.equal(extracted.cards[0].items.filter(x => x.kind === 'card').length, 1);
    assert.equal(extracted.cards[1].items.filter(x => x.kind === 'control').length, 1);
    const result = runInNewContext('(' + auditCardLayout.toString() + ')(snapshot)', { snapshot: extracted });
    assert.equal(result.findings.length, 0);
    assert.equal(result.affordances[0].type, 'ELLIPSIS_FULL_VALUE');
    fixture.title.getAttribute = () => 'unrelated tooltip';
    const noAffordance = runInNewContext('(' + extractCardLayout.toString() + ')({cardSelector:".card"})', { document: fixture.doc });
    assert.ok(codes(noAffordance).includes('CLIPPED_X'));
  });

  test('extractor rejects absent scope and excludes ancestor-hidden cards', () => {
    const fixture = fakeDocument();
    assert.throws(() => extractCardLayout(), /cardSelector/);
    fixture.root.css.display = 'none';
    const extracted = runInNewContext('(' + extractCardLayout.toString() + ')({cardSelector:".card"})', { document: fixture.doc });
    assert.equal(extracted.cards.length, 0);
  });

  function setBoxBorder(element, border, { x = 'hidden', y = 'hidden' } = {}) {
    element.css.overflowX = x;
    element.css.overflowY = y;
    element.clientLeft = border;
    element.clientTop = border;
    element.clientWidth = element.offsetWidth - 2 * border;
    element.clientHeight = element.offsetHeight - 2 * border;
  }

  function borderedFixture(kind, border) {
    const fixture = fakeDocument();
    const element = kind === 'control' ? fixture.button
      : kind === 'card' ? fixture.nested : fixture.title;
    if (kind === 'badge') {
      element.className = 'badge';
      const originalMatches = element.matches.bind(element);
      element.matches = selector => selector.split(',').some(part => part.includes('badge'))
        || originalMatches(selector);
      element.childNodes = [];
      element.textContent = '';
    }
    setBoxBorder(element, border);
    const data = runInNewContext(
      '(' + extractCardLayout.toString() + ')({cardSelector:".card"})',
      { document: fixture.doc },
    );
    const boxItem = data.cards.flatMap(card => card.items).find(item => item.kind === kind);
    assert.ok(boxItem, 'fixture must extract the intended border-box item');
    return { fixture, data, boxItem };
  }

  for (const kind of ['control', 'badge', 'card']) {
    for (const { border, tolerance } of [
      { border: 2, tolerance: 1 },
      { border: 1, tolerance: 0 },
      { border: 2, tolerance: 0 },
    ]) {
      test(kind + ' border box excludes its own clip (' + border + 'px border, tolerance ' + tolerance + ')', () => {
        const { data, boxItem } = borderedFixture(kind, border);
        const result = auditCardLayout(data, { tolerance });
        assert.deepEqual(result.findings.filter(finding =>
          finding.itemId === boxItem.id && finding.code.startsWith('CLIPPED_')), [],
        'overflow clips contents, not the element own border box');
        assert.ok(!boxItem.clips.some(clip => clip.id === boxItem.id),
          'a measured border box must start its clipping chain at the parent');
      });
    }

    test(kind + ' border box still respects a real clipping ancestor', () => {
      const { fixture } = borderedFixture(kind, 2);
      fixture.card.css.overflowX = 'hidden';
      fixture.card.clientWidth = 45;
      const data = runInNewContext(
        '(' + extractCardLayout.toString() + ')({cardSelector:".card"})',
        { document: fixture.doc },
      );
      const boxItem = data.cards.flatMap(card => card.items).find(item => item.kind === kind);
      const result = auditCardLayout(data);
      assert.ok(result.findings.some(finding =>
        finding.itemId === boxItem.id && finding.code === 'CLIPPED_X'),
      'removing self-clipping must not suppress true ancestor clipping');
    });
  }

  test('text fragments retain their originating element client clip', () => {
    const fixture = fakeDocument();
    setBoxBorder(fixture.title, 2, { x: 'hidden', y: 'visible' });
    fixture.title.getAttribute = () => 'unrelated tooltip';
    const data = runInNewContext(
      '(' + extractCardLayout.toString() + ')({cardSelector:".card"})',
      { document: fixture.doc },
    );
    const text = data.cards.flatMap(card => card.items).find(item => item.text === 'Long title');
    assert.ok(text.clips.some(clip => clip.rect.right === 68),
      'text must retain the originating element content clip, including its border inset');
    assert.ok(auditCardLayout(data).findings.some(finding =>
      finding.itemId === text.id && finding.code === 'CLIPPED_X'));
  });

}
