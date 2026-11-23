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
  const area = r => r.right > r.left && r.bottom > r.top;
  // Structured callers may declare one rectangle. DOM measurements below
  // always supply actual client fragments, with no union-paint fallback.
  const fragments = shape => {
    const bounds = rect(shape.rect);
    const raw = shape.rects === undefined ? [bounds] : shape.rects;
    if (!Array.isArray(raw)) throw new TypeError('paint fragments unavailable');
    const pieces = raw.map(rect).filter(area);
    if (area(bounds) !== Boolean(pieces.length)) throw new TypeError('inconsistent paint geometry');
    return pieces.length ? pieces : null; // null = valid, successfully measured unpainted geometry
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
  let cardCount = 0, measuredItems = 0;
  for (const card of snapshot.cards) {
    if (typeof card.id !== 'string' || !card.id || ids.has(card.id))
      throw new TypeError('unique card ids required');
    ids.add(card.id);
    if (!fragments(card)) continue;
    cardCount += 1;
    if (!Array.isArray(card.items)) throw new TypeError('items required');
    const records = new Map();
    for (const item of card.items) {
      if (typeof item.id !== 'string' || !item.id || records.has(item.id))
        throw new TypeError('unique item ids required');
      if (!['text', 'badge', 'control', 'card'].includes(item.kind))
        throw new TypeError('invalid item kind');
      records.set(item.id, { item, pieces: fragments(item) });
    }
    const ancestors = new Map(), has = (item, key) =>
      Object.prototype.hasOwnProperty.call(item, key);
    for (const { item } of records.values()) {
      const declared = has(item, 'ancestorBoxIds'), legacy = has(item, 'ownerId');
      if (legacy && item.ownerId !== null && (typeof item.ownerId !== 'string' || !item.ownerId))
        throw new TypeError('invalid legacy owner');
      const relation = declared ? item.ancestorBoxIds
        : legacy && item.ownerId !== null ? [item.ownerId] : [];
      if (!Array.isArray(relation)) throw new TypeError('ancestor box ids required');
      const seen = new Set();
      for (const ancestorId of relation) {
        const target = records.get(ancestorId);
        if (typeof ancestorId !== 'string' || !ancestorId || seen.has(ancestorId)
          || ancestorId === item.id || !target || target.item.kind === 'text' || !target.pieces)
          throw new TypeError('invalid ancestor box relation');
        seen.add(ancestorId);
      }
      // New arrays are nearest-first. Compatibility ownerId is a projection
      // of that same relation, never an extra collision-exemption authority.
      if (declared && legacy && item.ownerId !== (relation[0] ?? null))
        throw new TypeError('conflicting ownership metadata');
      ancestors.set(item.id, [...relation]);
    }
    const visited = new Set(), visiting = new Set();
    const visit = id => {
      if (visiting.has(id)) throw new TypeError('cyclic ancestor box relation');
      if (visited.has(id)) return;
      visiting.add(id);
      for (const ancestorId of ancestors.get(id)) visit(ancestorId);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of records.keys()) visit(id);
    const visible = [];
    for (const { item, pieces } of records.values()) {
      if (!pieces) continue;
      measuredItems += 1;
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
      visible.push({ ...item, ancestorBoxIds: ancestors.get(item.id), painted });
    }
    for (let a = 0; a < visible.length; a++) {
      for (let b = a + 1; b < visible.length; b++) {
        const x = visible[a], y = visible[b];
        // Only actual ancestor/descendant coincidence is intentional.
        // Sharing an ancestor never exempts siblings or distinct labels.
        if ((x.kind !== 'text' && y.ancestorBoxIds.includes(x.id))
          || (y.kind !== 'text' && x.ancestorBoxIds.includes(y.id))) continue;
        if (x.painted.some(p => y.painted.some(q => overlap(p, q))))
          emit('COLLISION', card, x, { otherItemId: y.id, kinds: [x.kind, y.kind] });
      }
    }
  }
  const unique = rows => [...new Map(rows.map(row => [JSON.stringify(row), row])).values()];
  return {
    schemaVersion: 'stephanos.workspace-card-layout-audit.v1',
    evidenceClass: 'GEOMETRY_ONLY',
    coverage: cardCount && measuredItems ? 'MEASURED' : 'EMPTY',
    cardCount, itemCount: measuredItems,
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
  const box = r => {
    if (!r || !['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(r[key]))
      || r.right < r.left || r.bottom < r.top) throw new TypeError('invalid rectangle');
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  };
  const area = r => r.right > r.left && r.bottom > r.top;
  // One geometry model for Elements and Ranges: actual nonzero client fragments
  // describe paint. The union rectangle is broad bounds, never a paint fallback.
  const measureGeometry = target => {
    const rect = box(target.getBoundingClientRect());
    const rawRects = [...target.getClientRects()].map(box);
    const rects = rawRects.filter(area);
    if (area(rect) !== Boolean(rects.length)) throw new TypeError('inconsistent paint geometry');
    // Successful empty/all-zero geometry with degenerate bounds is valid
    // UNPAINTED, not unavailable. Missing/throwing APIs and malformed or
    // contradictory measurements still throw before this return.
    return { bounds: rect, geometry: rects.length ? { rect, rects } : null,
      clientRectCount: rawRects.length };
  };
  const styleCache = new Map();
  const style = el => {
    if (!styleCache.has(el)) {
      const s = view.getComputedStyle(el);
      if (!s || typeof s.display !== 'string' || !s.display.trim()
        || !['visible', 'hidden', 'collapse'].includes(s.visibility)
        || typeof s.opacity !== 'string' || !s.opacity.trim()
        || !Number.isFinite(Number(s.opacity)) || Number(s.opacity) < 0 || Number(s.opacity) > 1
        || !['visible', 'hidden', 'auto'].includes(s.contentVisibility)
        || !['static', 'relative', 'sticky', 'absolute', 'fixed'].includes(s.position))
        throw new TypeError('invalid computed render evidence');
      styleCache.set(el, s);
    }
    return styleCache.get(el);
  };
  const elementGeometry = new Map();
  const measureElement = el => {
    if (!elementGeometry.has(el)) elementGeometry.set(el, measureGeometry(el));
    return elementGeometry.get(el).geometry;
  };
  // Shared layout vocabulary is input to distinct paint/containment/clip rules.
  const boxLayouts = new Set([
    'block', 'block flow', 'flow-root', 'block flow-root',
    'inline-block', 'inline flow-root', 'flex', 'block flex',
    'inline-flex', 'inline flex', 'grid', 'block grid', 'inline-grid', 'inline grid',
  ]);
  const nativeLayouts = new Set([
    'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'OPTGROUP', 'PROGRESS', 'METER',
    'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT',
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'COL', 'COLGROUP',
  ]);
  const displayOf = s => s.display.trim().toLowerCase().replace(/\s+/g, ' ');
  const ordinaryHtml = el => el.namespaceURI === 'http://www.w3.org/1999/xhtml'
    && !nativeLayouts.has(el.tagName.toUpperCase());
  const contentSuppressed = el => {
    const s = style(el), display = displayOf(s);
    if (s.contentVisibility === 'visible' || display === 'none') return false;
    // Non-replaced inlines and boxless contents cannot acquire containment.
    if (ordinaryHtml(el) && ['contents', 'inline', 'inline flow'].includes(display)) return false;
    if (!ordinaryHtml(el) || !boxLayouts.has(display))
      throw new TypeError('unsupported content visibility layout');
    if (s.contentVisibility === 'auto')
      throw new TypeError('automatic content skipping requires independent state evidence');
    return true;
  };
  const boundaryEligible = el => {
    for (let p = el; p; p = p.parentElement) {
      const s = style(p), display = displayOf(s);
      if (display === 'none') return false;
      if (Number(s.opacity) === 0) {
        measureElement(p);
        if (!ordinaryHtml(p) || (!boxLayouts.has(display) && !['inline', 'inline flow'].includes(display))
          || !elementGeometry.get(p).clientRectCount)
          throw new TypeError('unsupported zero opacity rendering box');
        return false;
      }
      // Validate active containment on self, but only ancestors suppress its box.
      if (contentSuppressed(p) && p !== el) return false;
    }
    return true;
  };
  const boxPainted = el => boundaryEligible(el) && style(el).visibility === 'visible';
  const contentPainted = el => boxPainted(el) && !contentSuppressed(el);
  const candidates = [...root.querySelectorAll(cardSelector)];
  if (root.matches(cardSelector)) candidates.unshift(root);
  // Selected associated boxes establish layout ownership even when their own
  // visibility is hidden: visible descendants must still be audited inside them.
  const cards = candidates.filter(el => boundaryEligible(el) && measureElement(el) !== null);

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
  // Paint presence, generated boxes and overflow applicability are orthogonal.
  // A zero-area generated block may clip; a boxless or non-replaced inline
  // element does not. Unqualified active clipping fails explicitly.
  const clipEligible = (el, computed) => {
    const display = String(computed.display || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (display === 'contents' || display === 'none') return false;
    measureElement(el);
    if (!elementGeometry.get(el).clientRectCount) return false;
    if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      || nativeLayouts.has(el.tagName.toUpperCase()))
      throw new TypeError('unsupported overflow clip element');
    if (display === 'inline' || display === 'inline flow') return false;
    if (!boxLayouts.has(display)) throw new TypeError('unsupported overflow clip layout: ' + display);
    return true;
  };
  // Text measures contents and retains its own clip. Border-box items must
  // start at the parent: overflow never clips the element's own border box.
  // Overflow ancestry can diverge from DOM ancestry after crossing an
  // associated absolute/fixed box. Do not infer its containing block.
  const outOfFlowBox = el => {
    if (!['absolute', 'fixed'].includes(style(el).position)) return false;
    measureElement(el);
    return elementGeometry.get(el).clientRectCount > 0;
  };

  const clips = (el, { includeSelf = true } = {}) => {
    const result = [];
    let crossedOutOfFlow = !includeSelf && outOfFlowBox(el);
    for (let p = includeSelf ? el : el.parentElement; p; p = p.parentElement) {
      const s = style(p);
      if ((s.overflowX !== 'visible' || s.overflowY !== 'visible') && clipEligible(p, s)) {
        if (crossedOutOfFlow) throw new TypeError('UNSUPPORTED_CONTAINING_BLOCK_PROJECTION');
        const r = elementGeometry.get(p).bounds;
        // client box excludes border and scrollbar; CSS-pixel scaling supports zoom/transforms.
        const sx = p.offsetWidth ? (r.right - r.left) / p.offsetWidth : 1;
        const sy = p.offsetHeight ? (r.bottom - r.top) / p.offsetHeight : 1;
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
      crossedOutOfFlow ||= outOfFlowBox(p);
    }
    return result;
  };
  const describe = el => ({
    tag: el.tagName.toLowerCase(), id: el.id || null,
    classes: typeof el.className === 'string' ? el.className : '',
  });
  const borderBoxItem = (el, kind) => {
    const geometry = measureElement(el);
    return geometry ? { id: id(el), kind, ...geometry,
      clips: clips(el, { includeSelf: false }), element: describe(el) } : null;
  };
  const results = cards.map(card => {
    const items = [], origins = new Map(), boxes = new Map();
    const emitBox = (el, kind) => {
      const item = borderBoxItem(el, kind);
      if (item) { items.push(item); origins.set(item, el); boxes.set(el, item); }
    };
    const nodes = [card, ...card.querySelectorAll('*')];
    for (const el of nodes) {
      if (el !== card && cardSet.has(el)) {
        // Only the immediate nested card is a parent item. Its content is audited separately.
        if (owner(el.parentElement) === card && boxPainted(el))
          emitBox(el, 'card');
        continue;
      }
      if (owner(el) !== card || !boundaryEligible(el)) continue;
      if (el !== card && boxPainted(el) && el.matches(controlSelector + ',' + badgeSelector)) {
        // Every painted box is measured. Intentional ancestry is described
        // afterward; it never suppresses clipping, escape or sibling checks.
        emitBox(el, el.matches(controlSelector) ? 'control' : 'badge');
      }
      if (!contentPainted(el) || ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(el.tagName)) continue;
      for (const node of el.childNodes) {
        if (node.nodeType !== 3 || !norm(node.textContent)) continue;
        const range = doc.createRange();
        range.selectNodeContents(node);
        const geometry = measureGeometry(range).geometry;
        if (!geometry) continue;
        const item = { id: 'text-' + nextId++, kind: 'text',
          ...geometry, clips: clips(el),
          text: norm(node.textContent), element: describe(el) };
        items.push(item);
        origins.set(item, el);
      }
    }
    // One complete emitted-box registry supplies every relation, including
    // nested-card borders inside semantic wrappers. Hidden/boxless nodes are
    // absent from this registry and cannot become painted ancestors.
    for (const item of items) {
      const origin = origins.get(item), ancestorBoxIds = [];
      for (let p = item.kind === 'text' ? origin : origin.parentElement;
        p && p !== card; p = p.parentElement) {
        if (owner(p) !== card) break;
        if (boxes.has(p)) ancestorBoxIds.push(boxes.get(p).id);
      }
      item.ancestorBoxIds = ancestorBoxIds;
      item.ownerId = ancestorBoxIds[0] ?? null;
    }
    return { id: ids.get(card), ...measureElement(card), element: describe(card), items };
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
  const item = (id, kind = 'text', rect = r(5, 5, 40, 20), extra = {}) => ({ id, kind, rect, rects: [rect], ...extra });
  const snapshot = (...items) => { const rect = r(); return { cards: [{ id: 'card', rect, rects: [rect], items }] }; };
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
    const child = { id: 'child', rect: r(10, 30, 80, 70), rects: [r(10, 30, 80, 70)], items: [item('title', 'text', r(15, 35, 50, 50))] };
    const parent = { id: 'parent', rect: r(), rects: [r()], items: [item('child-box', 'card', child.rect)] };
    assert.deepEqual(codes({ cards: [parent, child] }), []);
    Object.assign(child.items[0].rect, r(15, 35, 90, 50));
    assert.equal(auditCardLayout({ cards: [parent, child] }).findings[0].cardId, 'child');
    Object.assign(parent.items[0].rect, r(10, 30, 105, 70));
    assert.ok(codes({ cards: [parent, child] }).includes('ESCAPE_X'));
  });

  test('adversarial edge sweep is translation invariant and does not mutate evidence', () => {
    for (let shift = -5; shift <= 5; shift++) {
      const data = snapshot(item('edge', 'text', r(shift, 5, 50, 20)));
      const before = JSON.stringify(data);
      assert.equal(codes(data).includes('ESCAPE_X'), shift < -1);
      const translated = JSON.parse(before);
      for (const rect of new Set([translated.cards[0].rect, ...translated.cards[0].rects,
        translated.cards[0].items[0].rect, ...translated.cards[0].items[0].rects])) {
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
      const e = { tagName: tag, namespaceURI: 'http://www.w3.org/1999/xhtml', className: classes, id: '', parentElement: parent, hidden: false,
        childNodes: [], css: { display: 'block', visibility: 'visible', opacity: '1', contentVisibility: 'visible', position: 'static',
          overflowX: 'visible', overflowY: 'visible', ...css },
        textContent: '', clientLeft: 0, clientTop: 0, clientWidth: bounds.right - bounds.left,
        clientHeight: bounds.bottom - bounds.top, offsetWidth: bounds.right - bounds.left,
        offsetHeight: bounds.bottom - bounds.top,
        getBoundingClientRect: () => ({ ...bounds, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }),
        getClientRects() { return this.fragments || [this.getBoundingClientRect()]; },
        getAttribute(name) { return name === 'title' ? title : name === 'href' && this.tagName === 'A' ? '#fixture' : null; },
        matches(selector) { return selector.split(',').some(s => s === 'body' ? this.tagName === 'BODY'
          : s === '.card' ? this.className.split(/\s+/).includes('card')
          : s === 'button' ? this.tagName === 'BUTTON'
          : s === 'a[href]' ? this.tagName === 'A' && this.getAttribute('href') !== null
          : s.includes('badge') ? this.className.includes('badge') : false); },
        closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; },
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
          getClientRects: () => selected.rects || [selected === node ? r(5, 5, 95, 20) : r(15, 38, 50, 50)],
          getBoundingClientRect: () => selected.rect || (selected === node ? r(5, 5, 95, 20) : r(15, 38, 50, 50)) };
      } };
    return { doc, root, card, title, nested, button, createElement: el };
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
    if (kind === 'control') element.tagName = 'A'; // A non-replaced control in the qualified clip domain.
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


  // One cross-kind geometry model: the union has an empty lower-right corner.
  // Real client rectangles, rather than node-specific exceptions, decide paint.
  function wrappedFixture(kind, siblingKind = 'badge', siblingRect = r(55, 35, 80, 50)) {
    const fixture = fakeDocument();
    fixture.title.css.display = 'none';
    fixture.nested.css.display = 'none';
    const union = r(10, 10, 90, 50);
    const fragments = [r(10, 10, 10, 10), r(10, 10, 90, 25), r(10, 35, 40, 50)];
    const target = fixture.createElement(kind === 'control' ? 'A' : 'SPAN',
      kind === 'card' ? 'card' : kind === 'badge' ? 'badge' : '', union, fixture.card,
      { display: 'inline' });
    target.id = 'wrapped-target';
    target.fragments = fragments;
    if (kind === 'text') target.childNodes.push({
      nodeType: 3, textContent: 'Wrapped title', rect: union, rects: fragments,
    });
    const sibling = fixture.createElement(siblingKind === 'control' ? 'A' : 'SPAN',
      siblingKind === 'badge' ? 'badge' : '', siblingRect, fixture.card);
    sibling.id = 'corner-sibling';
    if (siblingKind === 'text') sibling.childNodes.push({
      nodeType: 3, textContent: 'Sibling', rect: siblingRect, rects: [siblingRect],
    });
    const extract = () => runInNewContext(
      '(' + extractCardLayout.toString() + ')({cardSelector:".card"})',
      { document: fixture.doc },
    );
    const findTarget = data => data.cards.flatMap(card => card.items)
      .find(item => item.element.id === 'wrapped-target' && item.kind === kind);
    return { fixture, target, sibling, extract, findTarget };
  }

  for (const kind of ['control', 'badge', 'card', 'text']) {
    test(kind + ' fragments leave the short-line corner empty for unrelated siblings', () => {
      for (const siblingKind of ['control', 'badge', 'text']) {
        const model = wrappedFixture(kind, siblingKind);
        const data = model.extract(), target = model.findTarget(data);
        assert.ok(target, 'every measurement kind must use the same fragment model');
        assert.equal(target.rects?.length, 2, 'retain actual nonzero client fragments');
        assert.deepEqual(codes(data), [], 'the union empty corner is not painted');
      }
    });

    test(kind + ' fragments still collide with a sibling in either painted line', () => {
      for (const siblingKind of ['control', 'badge', 'text']) {
        for (const siblingRect of [r(55, 12, 80, 23), r(25, 37, 38, 48)]) {
          const model = wrappedFixture(kind, siblingKind, siblingRect);
          const data = model.extract(), target = model.findTarget(data);
          assert.ok(auditCardLayout(data).findings.some(finding =>
            finding.code === 'COLLISION'
              && [finding.itemId, finding.otherItemId].includes(target.id)),
          'real intersections in either fragment must remain defects');
        }
      }
    });

    test(kind + ' retains ancestor clipping of one wrapped fragment', () => {
      const model = wrappedFixture(kind);
      model.fixture.card.css.overflowX = 'hidden';
      model.fixture.card.clientWidth = 60;
      const data = model.extract(), target = model.findTarget(data);
      assert.ok(auditCardLayout(data).findings.some(finding =>
        finding.itemId === target.id && finding.code === 'CLIPPED_X'));
      assert.equal(target.rects?.length, 2, 'clipping must operate on retained fragments');
    });
  }

  test('cross-kind fragment collision model is invariant under 240 translated/tolerance cases', () => {
    for (const kind of ['control', 'badge', 'card', 'text']) {
      for (const collides of [false, true]) {
        const model = wrappedFixture(kind, 'badge',
          collides ? r(25, 37, 38, 48) : r(55, 35, 80, 50));
        model.fixture.card.css.overflowX = 'auto';
        model.fixture.card.clientWidth = 95;
        const source = model.extract();
        const before = JSON.stringify(source);
        for (const dx of [-321, -5, 0, 6, 411]) {
          for (const dy of [-77, 0, 99]) {
            for (const tolerance of [0, 1]) {
              const data = JSON.parse(before), moved = new Set();
              const move = box => {
                if (!box || moved.has(box)) return;
                moved.add(box);
                box.left += dx; box.right += dx;
                box.top += dy; box.bottom += dy;
              };
              for (const card of data.cards) {
                move(card.rect); card.rects?.forEach(move);
                for (const item of card.items) {
                  move(item.rect); item.rects?.forEach(move);
                  item.clips.forEach(clip => move(clip.rect));
                }
              }
              const result = auditCardLayout(data, { tolerance });
              assert.equal(result.findings.filter(f => f.code === 'COLLISION').length,
                collides ? 1 : 0);
              assert.deepEqual(result.findings, auditCardLayout(source, { tolerance }).findings);
              assert.equal(JSON.stringify(source), before, 'translation cannot mutate the input');
            }
          }
        }
      }
    }
  });

  test('wrapped own labels are exempt only from their control, not from sibling labels', () => {
    const model = wrappedFixture('control');
    const label = { nodeType: 3, textContent: 'Own label',
      rect: r(10, 10, 90, 50), rects: model.target.fragments };
    model.target.childNodes.push(label);
    assert.deepEqual(codes(model.extract()), []);
    model.target.childNodes.push({ ...label, textContent: 'Another label' });
    assert.ok(codes(model.extract()).includes('COLLISION'));
  });

  test('manual geometry rejects malformed or contradictory fragments without requiring them for single boxes', () => {
    for (const extra of [{ rects: null }, { rects: [] }, { rects: [r(5, 5, 5, 20)] }])
      assert.throws(() => auditCardLayout(snapshot(item('bad', 'control', r(5, 5, 40, 20), extra))), TypeError);
    assert.throws(() => auditCardLayout(snapshot(item('bad', 'badge', r(5, 5, 5, 20), { rects: [r(5, 5, 40, 20)] }))), TypeError);
    assert.equal(auditCardLayout({ cards: [{ id: 'zero', rect: r(0, 0, 0, 80), items: [] }] }).coverage, 'EMPTY');
  });

  test('visible boxes fail closed when actual client-fragment geometry is unavailable or invalid', () => {
    for (const kind of ['control', 'badge', 'card']) {
      for (const bad of ['missing-api', [], [r(10, 10, 10, 10)], [r(10, 10, Infinity, 25)], [r(90, 10, 10, 25)]]) {
        const model = wrappedFixture(kind);
        if (bad === 'missing-api') model.target.getClientRects = undefined;
        else model.target.getClientRects = () => bad;
        assert.throws(() => model.extract(), error => error.name === 'TypeError',
          'no union-box fallback may turn missing paint geometry into passing proof');
      }
    }
  });

  test('positive range bounds with empty or entirely degenerate fragments are inconsistent', () => {
    for (const rects of [[], [r(10, 10, 10, 10)]]) {
      const model = wrappedFixture('text');
      model.target.childNodes[0].rects = rects;
      assert.throws(() => model.extract(), error => error.name === 'TypeError');
    }
  });


  function setMeasuredGeometry(element, bounds, clientRects) {
    element.getBoundingClientRect = () => ({
      ...bounds, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top,
    });
    element.getClientRects = () => clientRects;
    element.clientWidth = element.offsetWidth = bounds.right - bounds.left;
    element.clientHeight = element.offsetHeight = bounds.bottom - bounds.top;
  }

  test('valid unpainted SHY, ZWSP and formatting ranges are omitted without aborting siblings', () => {
    for (const text of ['\u00ad', '\u200b', '\u200e']) {
      for (const clientRects of [[], [r(5, 5, 5, 20)]]) {
        const model = wrappedFixture('text');
        Object.assign(model.target.childNodes[0], {
          textContent: text, rect: r(5, 5, 5, 20), rects: clientRects,
        });
        const data = model.extract(), report = auditCardLayout(data);
        assert.equal(model.findTarget(data), undefined);
        assert.deepEqual(report.findings, []);
        assert.equal(report.itemCount, 1, 'painted sibling remains auditable');
      }
    }
  });

  test('unpainted formatting content cannot hide a genuine painted sibling collision', () => {
    for (const text of ['\u00ad', '\u200b', '\u200e']) {
      const model = wrappedFixture('text');
      Object.assign(model.target.childNodes[0], {
        textContent: text, rect: r(5, 5, 5, 20), rects: [r(5, 5, 5, 20)],
      });
      const painted = model.fixture.createElement('SPAN', '', r(55, 35, 80, 50), model.fixture.card);
      painted.childNodes.push({ nodeType: 3, textContent: 'Visible collision',
        rect: r(55, 35, 80, 50), rects: [r(55, 35, 80, 50)] });
      const report = auditCardLayout(model.extract());
      assert.equal(report.findings.filter(f => f.code === 'COLLISION').length, 1);
      assert.equal(report.itemCount, 2);
    }
  });

  test('valid unpainted control, badge and card boxes omit paint without losing unrelated siblings', () => {
    for (const kind of ['control', 'badge', 'card']) {
      for (const clientRects of [[], [r(5, 5, 5, 20)]]) {
        const model = wrappedFixture(kind);
        setMeasuredGeometry(model.target, r(5, 5, 5, 20), clientRects);
        const data = model.extract(), report = auditCardLayout(data);
        assert.equal(model.findTarget(data), undefined);
        assert.deepEqual(report.findings, []);
        assert.equal(report.itemCount, 1);
      }
    }
  });

  test('boxless wrappers retain painted descendant text and its genuine collisions', () => {
    for (const kind of ['control', 'badge', 'card']) {
      const model = wrappedFixture(kind);
      setMeasuredGeometry(model.target, r(5, 5, 5, 20), []);
      model.target.childNodes.push({ nodeType: 3, textContent: 'Painted child',
        rect: r(55, 35, 80, 50), rects: [r(55, 35, 80, 50)] });
      const report = auditCardLayout(model.extract());
      assert.equal(report.findings.filter(f => f.code === 'COLLISION').length, 1);
      assert.equal(report.itemCount, 2, 'unpainted wrapper is not a painted owner or box item');
    }
  });

  test('a selection of only boxless top-level cards has EMPTY geometry coverage', () => {
    const fixture = fakeDocument();
    fixture.nested.css.display = 'none';
    setMeasuredGeometry(fixture.card, r(5, 5, 5, 20), []);
    const data = runInNewContext(
      '(' + extractCardLayout.toString() + ')({cardSelector:".card"})',
      { document: fixture.doc },
    );
    assert.equal(data.cards.length, 0);
    assert.equal(auditCardLayout(data).coverage, 'EMPTY');
  });

  test('missing, throwing and malformed Range APIs remain explicit errors', () => {
    for (const invalid of ['missing-api', 'throws', 'nan', 'infinity', 'inverted']) {
      const model = wrappedFixture('text');
      const createRange = model.fixture.doc.createRange;
      model.fixture.doc.createRange = () => {
        const range = createRange();
        if (invalid === 'missing-api') range.getClientRects = undefined;
        if (invalid === 'throws') range.getClientRects = () => { throw new Error('measurement unavailable'); };
        if (invalid === 'nan') range.getClientRects = () => [r(10, 10, NaN, 20)];
        if (invalid === 'infinity') range.getClientRects = () => [r(10, 10, Infinity, 20)];
        if (invalid === 'inverted') range.getClientRects = () => [r(50, 10, 10, 20)];
        return range;
      };
      assert.throws(() => model.extract());
    }
  });

  test('nonzero client fragments with zero union bounds are contradictory for every kind', () => {
    for (const kind of ['control', 'badge', 'card', 'text']) {
      const model = wrappedFixture(kind);
      if (kind === 'text') model.target.childNodes[0].rect = r(5, 5, 5, 20);
      else setMeasuredGeometry(model.target, r(5, 5, 5, 20), [r(10, 10, 90, 25)]);
      assert.throws(() => model.extract(), error => error.name === 'TypeError');
    }
  });

  test('manual single-rectangle input remains supported and valid unpainted records do not imply coverage', () => {
    const declared = snapshot(item('single'));
    delete declared.cards[0].rects;
    delete declared.cards[0].items[0].rects;
    assert.deepEqual(auditCardLayout(declared).findings, []);
    assert.equal(auditCardLayout(declared).itemCount, 1);
    const unpainted = snapshot(item('zero', 'text', r(5, 5, 5, 20)));
    assert.equal(auditCardLayout(unpainted).coverage, 'EMPTY');
    assert.equal(auditCardLayout(unpainted).itemCount, 0);
    assert.equal(auditCardLayout({ cards: [{ id: 'zero', rect: r(5, 5, 5, 20), items: [] }] }).cardCount, 0);
  });

  test('48 translated/tolerance cases preserve findings after adding remote unpainted records', () => {
    for (const kind of ['control', 'badge', 'card', 'text']) {
      for (const collides of [false, true]) {
        const model = wrappedFixture(kind, 'badge',
          collides ? r(25, 37, 38, 48) : r(55, 35, 80, 50));
        const original = model.extract();
        for (const shift of [-321, 0, 411]) {
          for (const tolerance of [0, 1]) {
            const data = JSON.parse(JSON.stringify(original)), moved = new Set();
            const move = box => {
              if (!box || moved.has(box)) return;
              moved.add(box); box.left += shift; box.right += shift;
              box.top -= shift; box.bottom -= shift;
            };
            for (const card of data.cards) {
              move(card.rect); card.rects?.forEach(move);
              for (const item of card.items) {
                move(item.rect); item.rects?.forEach(move);
                item.clips.forEach(clip => move(clip.rect));
              }
            }
            const zero = r(1000 + shift, 2000 - shift, 1000 + shift, 2010 - shift);
            data.cards[0].items.push({ id: 'remote-unpainted', kind: 'text',
              rect: zero, rects: [zero], clips: [] });
            const result = auditCardLayout(data, { tolerance });
            const before = auditCardLayout(original, { tolerance });
            assert.deepEqual(result.findings, before.findings);
            assert.equal(result.itemCount, before.itemCount);
          }
        }
      }
    }
  });

  test('adding remote zero-area actual client fragments does not change observed paint', () => {
    for (const kind of ['control', 'badge', 'card', 'text']) {
      const model = wrappedFixture(kind);
      const before = auditCardLayout(model.extract());
      model.target.fragments.push(r(1000, 2000, 1000, 2010));
      const after = auditCardLayout(model.extract());
      assert.deepEqual(after.findings, before.findings);
      assert.equal(after.itemCount, before.itemCount);
    }
  });


  function clipWrapperFixture(display, { clipped = false, zeroAxis = '', tag = 'SPAN', namespace } = {}) {
    const fixture = fakeDocument();
    fixture.title.css.display = 'none';
    fixture.nested.css.display = 'none';
    const boxless = display === 'contents' || display === 'none';
    const inline = display === 'inline' || display === 'inline flow';
    const bounds = boxless ? r(0, 0, 0, 0)
      : inline ? r(10, 10, 70, 25)
      : zeroAxis === 'X' ? r(5, 5, 5, 67)
      : zeroAxis === 'Y' ? r(5, 5, 87, 5)
      : r(5, 5, clipped ? 47 : 87, 67);
    const wrapper = fixture.createElement(tag, 'badge', bounds, fixture.card,
      { display, overflowX: 'hidden', overflowY: 'hidden' });
    wrapper.id = 'clip-wrapper';
    if (namespace !== undefined) wrapper.namespaceURI = namespace;
    setMeasuredGeometry(wrapper, bounds, boxless ? [] : [bounds]);
    wrapper.clientLeft = wrapper.clientTop = boxless || inline || zeroAxis ? 0 : 1;
    if (boxless || inline) {
      wrapper.clientWidth = wrapper.clientHeight = 0;
      wrapper.offsetWidth = wrapper.offsetHeight = 0;
    } else {
      wrapper.clientWidth = bounds.right - bounds.left - 2 * wrapper.clientLeft;
      wrapper.clientHeight = bounds.bottom - bounds.top - 2 * wrapper.clientTop;
    }
    wrapper.childNodes.push({ nodeType: 3, textContent: 'Painted label',
      rect: r(10, 10, 70, 25), rects: [r(10, 10, 70, 25)] });
    const extract = () => runInNewContext(
      '(' + extractCardLayout.toString() + ')({cardSelector:".card"})',
      { document: fixture.doc },
    );
    return { fixture, wrapper, extract };
  }

  test('boxless contents wrappers contribute no overflow clip to painted descendant text', () => {
    const model = clipWrapperFixture('contents');
    const data = model.extract();
    assert.deepEqual(auditCardLayout(data).findings, []);
    assert.equal(auditCardLayout(data).itemCount, 1);
  });

  test('real zero-width and zero-height block boxes still clip on the collapsed axis', () => {
    for (const axis of ['X', 'Y']) {
      const model = clipWrapperFixture('block', { zeroAxis: axis });
      assert.ok(auditCardLayout(model.extract()).findings.some(f => f.code === 'CLIPPED_' + axis));
    }
  });

  test('ordinary non-replaced inline boxes do not overflow-clip despite zero client metrics', () => {
    for (const display of ['inline', 'inline flow']) {
      const model = clipWrapperFixture(display);
      assert.deepEqual(auditCardLayout(model.extract()).findings, []);
    }
  });

  const CLIP_LAYOUT_GROUPS = [
    ['block', 'block flow'],
    ['flow-root', 'block flow-root'],
    ['inline-block', 'inline flow-root'],
    ['flex', 'block flex'],
    ['inline-flex', 'inline flex'],
    ['grid', 'block grid'],
    ['inline-grid', 'inline grid'],
  ];

  test('qualified block, flow-root, flex and grid variants retain contained and true-clipped cases', () => {
    for (const display of CLIP_LAYOUT_GROUPS.flat()) {
      assert.deepEqual(auditCardLayout(clipWrapperFixture(display).extract()).findings, []);
      const result = auditCardLayout(clipWrapperFixture(display, { clipped: true }).extract());
      assert.deepEqual(result.findings.map(f => f.code), ['CLIPPED_X']);
    }
  });

  test('supported shorthand and two-keyword displays have equivalent clipping projections', () => {
    for (const [short, expanded] of CLIP_LAYOUT_GROUPS) {
      for (const clipped of [false, true]) {
        const before = auditCardLayout(clipWrapperFixture(short, { clipped }).extract());
        const after = auditCardLayout(clipWrapperFixture(expanded, { clipped }).extract());
        assert.deepEqual(after.findings, before.findings);
        assert.deepEqual(after.affordances, before.affordances);
      }
    }
  });

  test('unqualified active clipping remains an explicit error rather than passing geometry', () => {
    for (const display of ['table', 'inline-table', 'table-cell', 'ruby', 'list-item', 'unknown-layout']) {
      assert.throws(() => clipWrapperFixture(display).extract(), /unsupported overflow clip layout/);
    }
    for (const tag of ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'TABLE']) {
      assert.throws(() => clipWrapperFixture('block', { tag }).extract(), /unsupported overflow clip/);
    }
    assert.throws(() => clipWrapperFixture('block', {
      namespace: 'http://www.w3.org/2000/svg',
    }).extract(), /unsupported overflow clip/);
  });

  test('unqualified layouts with visible overflow do not invent a clipping operation', () => {
    for (const display of ['table', 'ruby', 'unknown-layout']) {
      const model = clipWrapperFixture(display);
      model.wrapper.css.overflowX = model.wrapper.css.overflowY = 'visible';
      assert.deepEqual(auditCardLayout(model.extract()).findings, []);
    }
  });

  test('a genuine clipping ancestor beyond a contents or inline wrapper remains effective', () => {
    for (const display of ['contents', 'inline']) {
      const model = clipWrapperFixture(display);
      const ancestor = model.fixture.createElement('DIV', '', r(5, 5, 47, 67),
        model.fixture.card, { overflowX: 'hidden', overflowY: 'hidden' });
      ancestor.clientLeft = ancestor.clientTop = 1;
      ancestor.clientWidth = 40; ancestor.clientHeight = 60;
      model.wrapper.parentElement = ancestor;
      const data = model.extract();
      const text = data.cards.flatMap(card => card.items).find(item => item.text === 'Painted label');
      const realClip = text.clips.find(clip => clip.rect.left === 6 && clip.rect.right === 46);
      assert.ok(realClip, 'ineligible wrapper must not hide the next qualified ancestor');
      assert.ok(auditCardLayout(data).findings.some(f =>
        f.itemId === text.id && f.code === 'CLIPPED_X' && f.clipId === realClip.id));
    }
  });


  for (const inheritedVisibility of ['hidden', 'collapse']) {
    test('visibility reproduction: selected visible cards survive ' + inheritedVisibility + ' ancestor', () => {
      const fixture = fakeDocument();
      fixture.root.css.visibility = inheritedVisibility;
      const data = runInNewContext('(' + extractCardLayout.toString() + ')({cardSelector:".card"})',
        { document: fixture.doc });
      assert.equal(data.cards.length, 2);
    });
    test('visibility reproduction: visible labels retain clipping/collision under ' + inheritedVisibility + ' wrapper', () => {
      const fixture = fakeDocument();
      fixture.nested.css.display = 'none';
      const wrapper = fixture.createElement('DIV', '', r(), fixture.card, { visibility: inheritedVisibility });
      fixture.title.parentElement = wrapper;
      fixture.title.getAttribute = () => null;
      const sibling = fixture.createElement('SPAN', '', r(5, 5, 60, 20), wrapper);
      sibling.childNodes.push({ nodeType: 3, textContent: 'Visible sibling',
        rect: r(5, 5, 60, 20), rects: [r(5, 5, 60, 20)] });
      const data = runInNewContext('(' + extractCardLayout.toString() + ')({cardSelector:".card"})',
        { document: fixture.doc });
      assert.equal(data.cards[0].items.filter(x => x.kind === 'text').length, 2);
      const findings = auditCardLayout(data).findings;
      assert.ok(findings.some(f => f.code === 'CLIPPED_X'));
      assert.ok(findings.some(f => f.code === 'COLLISION'));
    });
  }

  const extractFixture = fixture => runInNewContext(
    '(' + extractCardLayout.toString() + ')({cardSelector:".card"})', { document: fixture.doc });
  function renderFixture() {
    const fixture = fakeDocument();
    fixture.title.css.display = 'none';
    fixture.nested.css.display = 'none';
    const wrapper = fixture.createElement('DIV', '', r(5, 5, 90, 70), fixture.card);
    const label = fixture.createElement('SPAN', '', r(10, 10, 60, 25), wrapper);
    label.childNodes.push({ nodeType: 3, textContent: 'Visible label',
      rect: r(10, 10, 60, 25), rects: [r(10, 10, 60, 25)] });
    return { fixture, wrapper, label, extract: () => extractFixture(fixture) };
  }

  test('hidden layout card retains visible descendants and their escape/collision evidence', () => {
    const model = renderFixture();
    model.fixture.card.css.visibility = 'hidden';
    model.wrapper.css.visibility = 'hidden';
    model.label.childNodes[0].rect = r(-10, 10, 60, 25);
    model.label.childNodes[0].rects = [r(-10, 10, 60, 25)];
    const sibling = model.fixture.createElement('SPAN', '', r(10, 10, 40, 25), model.wrapper);
    sibling.childNodes.push({ nodeType: 3, textContent: 'Visible sibling',
      rect: r(10, 10, 40, 25), rects: [r(10, 10, 40, 25)] });
    const data = model.extract(), report = auditCardLayout(data);
    assert.equal(data.cards.length, 1, 'visibility must not remove layout ownership');
    assert.equal(data.cards[0].items.filter(x => x.kind === 'text').length, 2);
    assert.ok(report.findings.some(x => x.code === 'ESCAPE_X'));
    assert.ok(report.findings.some(x => x.code === 'COLLISION'));
  });

  test('hidden nested card bounds descendants without painting its border box into the parent', () => {
    const fixture = fakeDocument();
    fixture.nested.css.visibility = 'hidden';
    const data = extractFixture(fixture);
    assert.equal(data.cards.length, 2);
    assert.equal(data.cards[0].items.filter(x => x.kind === 'card').length, 0);
    assert.equal(data.cards[1].items.filter(x => x.kind === 'control').length, 1);
    assert.equal(data.cards[1].items.filter(x => x.kind === 'text').length, 1);
  });

  for (const visibility of ['hidden', 'collapse']) {
    test('own computed ' + visibility + ' omits inherited-hidden text and controls', () => {
      const model = renderFixture();
      model.label.css.visibility = visibility; // computed inheritance, not a raw ancestor flag
      const control = model.fixture.createElement('A', '', r(10, 10, 60, 25), model.wrapper,
        { visibility });
      control.childNodes.push({ nodeType: 3, textContent: 'Invisible direct label' });
      assert.equal(model.extract().cards[0].items.length, 0);
    });
  }

  test('invisible controls cannot grant collision exemptions to visible descendant labels', () => {
    const model = renderFixture();
    const control = model.fixture.createElement('A', '', r(10, 10, 60, 25), model.wrapper,
      { visibility: 'hidden' });
    model.label.parentElement = control;
    const sibling = model.fixture.createElement('SPAN', 'badge', r(15, 12, 40, 23), model.wrapper);
    const data = model.extract();
    const label = data.cards[0].items.find(x => x.kind === 'text');
    assert.equal(label.ownerId, null);
    assert.equal(data.cards[0].items.filter(x => x.kind === 'control').length, 0);
    assert.ok(auditCardLayout(data).findings.some(x => x.code === 'COLLISION'));
    assert.ok(sibling);
  });

  test('hidden ancestor keeps its overflow clip around explicitly visible text', () => {
    const model = renderFixture();
    model.wrapper.css.visibility = 'hidden';
    model.wrapper.css.overflowX = 'hidden';
    model.wrapper.clientWidth = 30;
    const data = model.extract(), label = data.cards[0].items.find(x => x.kind === 'text');
    assert.ok(label.clips.some(x => x.rect.right === 35));
    assert.ok(auditCardLayout(data).findings.some(x => x.code === 'CLIPPED_X'));
  });

  for (const suppression of ['display', 'opacity']) {
    test(suppression + ' subtree suppression survives descendant visible overrides', () => {
      const model = renderFixture();
      model.wrapper.css[suppression] = suppression === 'display' ? 'none' : '0';
      model.label.css.visibility = 'visible';
      model.label.css.display = 'block';
      model.label.css.opacity = '1';
      assert.equal(model.extract().cards[0].items.length, 0);
      model.fixture.card.css[suppression] = suppression === 'display' ? 'none' : '0';
      assert.equal(model.extract().cards.length, 0);
    });
  }

  test('raw hidden attribute yields to effective CSS; effective display:none still suppresses', () => {
    const model = renderFixture();
    model.fixture.card.hidden = true;
    model.wrapper.hidden = true;
    model.label.hidden = true;
    assert.equal(model.extract().cards[0].items.filter(x => x.kind === 'text').length, 1);
    model.wrapper.css.display = 'none';
    assert.equal(model.extract().cards[0].items.length, 0);
    model.fixture.card.css.display = 'none';
    assert.equal(model.extract().cards.length, 0);
  });

  test('content-hidden card retains its layout and nested border box while omitting direct/descendant content', () => {
    const fixture = fakeDocument();
    fixture.nested.css.contentVisibility = 'hidden';
    fixture.button.css.contentVisibility = 'visible'; // cannot restore ancestor-skipped contents
    const data = extractFixture(fixture);
    assert.equal(data.cards.length, 2);
    assert.equal(data.cards[0].items.filter(x => x.kind === 'card').length, 1);
    assert.equal(data.cards[1].items.length, 0);
    fixture.card.css.contentVisibility = 'hidden';
    const rootHidden = extractFixture(fixture);
    assert.equal(rootHidden.cards.length, 1);
    assert.equal(rootHidden.cards[0].items.length, 0);
  });

  test('content-hidden control-like ordinary HTML box retains own paint but suppresses labels', () => {
    const model = renderFixture();
    model.wrapper.tagName = 'A';
    model.wrapper.css.contentVisibility = 'hidden';
    const data = model.extract();
    assert.equal(data.cards[0].items.filter(x => x.kind === 'control').length, 1);
    assert.equal(data.cards[0].items.filter(x => x.kind === 'text').length, 0);
  });

  for (const display of ['contents', 'inline', 'inline flow']) {
    test('content visibility on ineligible ' + display + ' does not suppress descendants', () => {
      for (const contentVisibility of ['hidden', 'auto']) {
        const model = renderFixture();
        model.wrapper.css.display = display;
        model.wrapper.css.contentVisibility = contentVisibility;
        if (display === 'contents') setMeasuredGeometry(model.wrapper, r(5, 5, 5, 5), []);
        assert.equal(model.extract().cards[0].items.filter(x => x.kind === 'text').length, 1);
      }
    });
  }

  test('qualified containment display aliases produce the same suppression model', () => {
    for (const display of CLIP_LAYOUT_GROUPS.flat()) {
      const model = renderFixture();
      model.wrapper.css.display = display;
      model.wrapper.css.contentVisibility = 'hidden';
      assert.equal(model.extract().cards[0].items.length, 0);
    }
  });

  test('unqualified content visibility and uncertain automatic skipping fail explicitly', () => {
    for (const display of ['table', 'table-cell', 'ruby', 'list-item', 'unknown-layout']) {
      const model = renderFixture();
      model.wrapper.css.display = display;
      model.wrapper.css.contentVisibility = 'hidden';
      assert.throws(model.extract, /unsupported content visibility/);
    }
    for (const tag of ['INPUT', 'BUTTON', 'TABLE', 'IMG']) {
      const model = renderFixture();
      model.wrapper.tagName = tag;
      model.wrapper.css.contentVisibility = 'hidden';
      assert.throws(model.extract, /unsupported content visibility/);
    }
    const svg = renderFixture();
    svg.wrapper.namespaceURI = 'http://www.w3.org/2000/svg';
    svg.wrapper.css.contentVisibility = 'hidden';
    assert.throws(svg.extract, /unsupported content visibility/);
    const automatic = renderFixture();
    automatic.wrapper.css.contentVisibility = 'auto';
    assert.throws(automatic.extract, /automatic content skipping/);
  });

  test('zero opacity needs a qualified generated rendering box', () => {
    for (const display of ['block', 'inline', 'inline flow', 'inline-block']) {
      const model = renderFixture();
      model.wrapper.css.display = display;
      model.wrapper.css.opacity = '0';
      assert.equal(model.extract().cards[0].items.length, 0);
    }
    for (const variant of ['contents', 'boxless', 'native', 'svg', 'table']) {
      const model = renderFixture();
      model.wrapper.css.opacity = '0';
      if (variant === 'contents' || variant === 'table') model.wrapper.css.display = variant;
      if (variant === 'boxless') setMeasuredGeometry(model.wrapper, r(5, 5, 5, 5), []);
      if (variant === 'native') model.wrapper.tagName = 'INPUT';
      if (variant === 'svg') model.wrapper.namespaceURI = 'http://www.w3.org/2000/svg';
      assert.throws(model.extract, /unsupported zero opacity/);
    }
  });

  test('malformed computed render evidence fails explicitly', () => {
    const invalid = [
      ['visibility', undefined], ['visibility', 'inherit'], ['display', ''], ['display', null],
      ['opacity', ''], ['opacity', 'NaN'], ['opacity', '2'], ['opacity', '-0.1'],
      ['contentVisibility', undefined], ['contentVisibility', 'unknown'],
    ];
    for (const [property, value] of invalid) {
      const model = renderFixture();
      model.wrapper.css[property] = value;
      assert.throws(model.extract, /invalid computed render evidence/);
    }
  });

  test('visibility model preserves translation and irrelevant hidden-branch invariance', () => {
    for (const visibility of ['visible', 'hidden', 'collapse']) {
      for (const offset of [-321, 0, 654]) {
        const model = renderFixture();
        model.wrapper.css.visibility = visibility;
        const original = auditCardLayout(model.extract());
        const rect = r(10 + offset, 10 + offset, 60 + offset, 25 + offset);
        // Translate every generated box and Range coherently.
        for (const el of [model.fixture.root, model.fixture.card, model.wrapper, model.label]) {
          const before = el.getBoundingClientRect();
          setMeasuredGeometry(el, r(before.left + offset, before.top + offset,
            before.right + offset, before.bottom + offset), [
            r(before.left + offset, before.top + offset, before.right + offset, before.bottom + offset),
          ]);
        }
        model.label.childNodes[0].rect = rect;
        model.label.childNodes[0].rects = [rect];
        const branch = model.fixture.createElement('DIV', '', r(), model.fixture.card,
          { display: 'none' });
        const omitted = model.fixture.createElement('SPAN', 'badge', r(), branch);
        omitted.childNodes.push({ nodeType: 3, textContent: 'Irrelevant hidden branch' });
        const after = auditCardLayout(model.extract());
        assert.deepEqual(after, original);
      }
    }
  });

  function containingBlockFixture(position, { at = 'origin', clip = true } = {}) {
    const model = renderFixture();
    model.fixture.card.css.position = 'relative';
    model.wrapper.css.overflowX = clip ? 'hidden' : 'visible';
    model.wrapper.clientWidth = 20;
    const positioned = at === 'origin' ? model.label : model.wrapper;
    positioned.css.position = position;
    const bounds = r(40, 10, 80, 25);
    setMeasuredGeometry(model.label, bounds, [bounds]);
    model.label.childNodes[0].rect = bounds;
    model.label.childNodes[0].rects = [bounds];
    const sibling = model.fixture.createElement('SPAN', 'badge', r(60, 10, 80, 25), model.fixture.card);
    return { ...model, positioned, sibling };
  }
  const containingBlockError = error => error.name === 'TypeError'
    && error.message === 'UNSUPPORTED_CONTAINING_BLOCK_PROJECTION';

  for (const position of ['static', 'relative', 'sticky']) {
    test(position + ' retains qualified ordinary ancestor clipping', () => {
      const model = containingBlockFixture(position);
      const data = model.extract(), text = data.cards[0].items.find(x => x.kind === 'text');
      assert.ok(text.clips.some(x => x.rect.right === 25));
      const report = auditCardLayout(data);
      assert.ok(report.findings.some(x => x.code === 'CLIPPED_X'));
      assert.equal(report.findings.filter(x => x.code === 'COLLISION').length, 0);
    });
  }

  for (const position of ['absolute', 'fixed']) {
    test(position + ' origin rejects higher eligible clips rather than masking a real collision', () => {
      assert.throws(containingBlockFixture(position).extract, containingBlockError);
    });

    test(position + ' ancestor rejects eligible clips above its boundary', () => {
      const model = containingBlockFixture(position, { at: 'ancestor', clip: false });
      model.fixture.card.css.overflowX = 'hidden';
      assert.throws(model.extract, containingBlockError);
    });

    test(position + ' border-box chain initializes from its origin for control, badge and nested card', () => {
      for (const kind of ['control', 'badge', 'card']) {
        const model = containingBlockFixture(position);
        model.label.childNodes = [];
        model.label.tagName = kind === 'control' ? 'A' : 'SPAN';
        model.label.className = kind === 'control' ? '' : kind;
        assert.throws(model.extract, containingBlockError);
      }
    });

    test(position + ' own text clip is processed before crossing to the parent', () => {
      const model = containingBlockFixture(position, { clip: false });
      model.label.css.overflowX = 'hidden';
      model.label.clientWidth = 20;
      const data = model.extract(), text = data.cards[0].items.find(x => x.kind === 'text');
      assert.ok(text.clips.some(x => x.rect.left === 40 && x.rect.right === 60));
      assert.ok(auditCardLayout(data).findings.some(x => x.code === 'CLIPPED_X'));
    });

    test(position + ' ancestor own clip and descendant clips below the boundary remain supported', () => {
      const model = containingBlockFixture(position, { at: 'ancestor' });
      model.label.css.overflowY = 'hidden';
      model.label.clientHeight = 5;
      const data = model.extract(), text = data.cards[0].items.find(x => x.kind === 'text');
      assert.ok(text.clips.some(x => x.rect.right === 25), 'out-of-flow box own clip still applies');
      assert.ok(text.clips.some(x => x.rect.bottom === 15), 'clip below crossing still applies');
      assert.ok(auditCardLayout(data).findings.some(x => x.code === 'CLIPPED_X'));
    });

    test(position + ' visible-only ancestry retains actual fragments and sibling collision', () => {
      for (const at of ['origin', 'ancestor']) {
        const model = containingBlockFixture(position, { at, clip: false });
        const data = model.extract(), text = data.cards[0].items.find(x => x.kind === 'text');
        assert.equal(text.rects.length, 1);
        assert.equal(text.rects[0].left, 40);
        assert.equal(text.clips.length, 0);
        assert.equal(auditCardLayout(data).findings.filter(x => x.code === 'COLLISION').length, 1);
      }
    });

    test(position + ' crossing survives visible, inline and contents intermediates', () => {
      for (const display of ['block', 'inline', 'inline flow', 'contents']) {
        const model = containingBlockFixture(position);
        model.wrapper.css.display = display;
        model.wrapper.css.overflowX = display === 'block' ? 'visible' : 'hidden';
        if (display === 'contents') setMeasuredGeometry(model.wrapper, r(5, 5, 5, 5), []);
        model.fixture.card.css.overflowX = 'hidden';
        assert.throws(model.extract, containingBlockError);
      }
    });

    test(position + ' crossing never clears at guessed containing-block indicators', () => {
      for (const indicators of [
        { position: 'relative' }, { transform: 'matrix(1, 0, 0, 1, 0, 0)' },
        { filter: 'blur(0px)' }, { contain: 'paint' }, { willChange: 'transform' },
      ]) {
        const model = containingBlockFixture(position, { clip: false });
        Object.assign(model.wrapper.css, indicators);
        model.fixture.card.css.overflowX = 'hidden';
        model.label.offsetParent = model.fixture.card; // never a containing-block authority
        assert.throws(model.extract, containingBlockError);
      }
    });

    test(position + ' boxless declaration adds no boundary, but real zero-area associated box does', () => {
      for (const at of ['origin', 'ancestor']) {
        const model = containingBlockFixture(position, { at, clip: false });
        model.positioned.css.display = 'contents';
        setMeasuredGeometry(model.positioned, r(5, 5, 5, 5), []);
        model.fixture.card.css.overflowX = 'hidden';
        model.fixture.card.clientWidth = 50;
        const data = model.extract(), text = data.cards[0].items.find(x => x.kind === 'text');
        assert.ok(text, 'painted descendant Range survives boxless declaration');
        assert.ok(auditCardLayout(data).findings.some(x => x.itemId === text.id && x.code === 'CLIPPED_X'));

        model.positioned.css.display = 'block';
        setMeasuredGeometry(model.positioned, r(5, 5, 5, 50), [r(5, 5, 5, 50)]);
        assert.throws(model.extract, containingBlockError);
      }
    });
  }

  test('missing and malformed computed position are explicit errors', () => {
    for (const position of [undefined, null, '', 'inherit', 'ABSOLUTE', 'floating', 1]) {
      const model = containingBlockFixture('static');
      model.wrapper.css.position = position;
      assert.throws(model.extract, /invalid computed render evidence/);
    }
  });

  test('out-of-flow qualification and collision outcomes are translation invariant', () => {
    for (const position of ['static', 'relative', 'sticky', 'absolute', 'fixed']) {
      for (const clip of [false, true]) {
        for (const offset of [-321, 0, 654]) {
          const model = containingBlockFixture(position, { clip });
          for (const el of [model.fixture.root, model.fixture.card, model.wrapper, model.label, model.sibling]) {
            const rect = el.getBoundingClientRect();
            const translated = r(rect.left + offset, rect.top - offset,
              rect.right + offset, rect.bottom - offset);
            const metrics = { clientWidth: el.clientWidth, clientHeight: el.clientHeight,
              offsetWidth: el.offsetWidth, offsetHeight: el.offsetHeight };
            setMeasuredGeometry(el, translated, [translated]);
            Object.assign(el, metrics);
          }
          const text = model.label.childNodes[0];
          text.rect = r(40 + offset, 10 - offset, 80 + offset, 25 - offset);
          text.rects = [text.rect];
          if (clip && ['absolute', 'fixed'].includes(position)) {
            assert.throws(model.extract, containingBlockError);
          } else {
            const findings = auditCardLayout(model.extract()).findings;
            assert.equal(findings.filter(x => x.code === 'COLLISION').length, clip ? 0 : 1);
            assert.equal(findings.filter(x => x.code === 'CLIPPED_X').length, clip ? 1 : 0);
          }
        }
      }
    }
  });

  function nestedBoxCoverageFixture() {
    const fixture = fakeDocument();
    fixture.title.css.display = 'none';
    fixture.nested.css.display = 'none';
    const wrapper = fixture.createElement('SPAN', 'badge', r(10, 10, 20, 30), fixture.card);
    wrapper.id = 'wrapper';
    const control = fixture.createElement('A', '', r(80, 10, 120, 30), wrapper);
    control.id = 'nested-control';
    const sibling = fixture.createElement('SPAN', 'badge', r(85, 10, 95, 30), fixture.card);
    sibling.id = 'sibling';
    return { fixture, extract: () => extractFixture(fixture) };
  }

  test('nested-box reproduction: actual visible nested control remains measured', () => {
    const data = nestedBoxCoverageFixture().extract();
    assert.equal(data.cards[0].items.filter(x => x.kind === 'control'
      && x.element.id === 'nested-control').length, 1);
  });

  test('nested-box reproduction: nested control escape remains a finding', () => {
    const report = auditCardLayout(nestedBoxCoverageFixture().extract());
    assert.ok(report.findings.some(x => x.code === 'ESCAPE_X'));
  });

  test('nested-box reproduction: real nested-control sibling collision remains a finding', () => {
    const report = auditCardLayout(nestedBoxCoverageFixture().extract());
    assert.ok(report.findings.some(x => x.code === 'COLLISION'));
  });


  function nestedHierarchyFixture(outerKind = 'badge', innerKind = 'control', { clipped = false } = {}) {
    const fixture = fakeDocument();
    fixture.title.css.display = fixture.nested.css.display = 'none';
    const wrapper = fixture.createElement(outerKind === 'control' ? 'A' : 'SPAN',
      outerKind === 'badge' ? 'badge' : '', clipped ? r(10, 10, 130, 30) : r(10, 10, 20, 30),
      fixture.card, clipped ? { overflowX: 'hidden' } : {});
    wrapper.id = 'wrapper';
    const child = fixture.createElement(innerKind === 'control' ? 'A' : innerKind === 'card' ? 'ARTICLE' : 'SPAN',
      innerKind === 'control' ? '' : innerKind, clipped ? r(80, 10, 140, 30) : r(80, 10, 120, 30), wrapper);
    child.id = 'nested-box';
    const sibling = fixture.createElement('SPAN', 'badge', r(85, 10, 95, 30), fixture.card);
    sibling.id = 'sibling';
    return { fixture, wrapper, child, sibling, extract: () => extractFixture(fixture) };
  }
  const findElementItem = (data, elementId) => data.cards.flatMap(c => c.items)
    .find(x => x.element.id === elementId);
  const plain = value => JSON.parse(JSON.stringify(value));

  for (const outerKind of ['control', 'badge']) {
    for (const innerKind of ['control', 'badge', 'card']) {
      test(outerKind + ' ancestor retains nested ' + innerKind + ' escape and unrelated sibling collision', () => {
        const model = nestedHierarchyFixture(outerKind, innerKind);
        const data = model.extract(), report = auditCardLayout(data);
        const parent = findElementItem(data, 'wrapper'), child = findElementItem(data, 'nested-box');
        const sibling = findElementItem(data, 'sibling');
        assert.ok(child, 'every actual painted nested box must be retained');
        assert.deepEqual(plain(child.ancestorBoxIds), [parent.id]);
        assert.equal(child.ownerId, parent.id);
        assert.ok(report.findings.some(x => x.itemId === child.id && x.code === 'ESCAPE_X'));
        assert.ok(report.findings.some(x => x.code === 'COLLISION'
          && [x.itemId, x.otherItemId].includes(child.id)
          && [x.itemId, x.otherItemId].includes(sibling.id)));
      });
    }
  }

  test('nested box ancestry never suppresses genuine clipping or remaining escape', () => {
    const model = nestedHierarchyFixture('badge', 'control', { clipped: true });
    const data = model.extract(), report = auditCardLayout(data), child = findElementItem(data, 'nested-box');
    assert.ok(report.findings.some(x => x.itemId === child.id && x.code === 'CLIPPED_X'));
    assert.ok(report.findings.some(x => x.itemId === child.id && x.code === 'ESCAPE_X'));
  });

  test('fully contained multi-kind ancestors remain measured without false coincidence collisions', () => {
    const model = nestedHierarchyFixture();
    setMeasuredGeometry(model.wrapper, r(5, 5, 95, 60), [r(5, 5, 95, 60)]);
    setMeasuredGeometry(model.child, r(10, 10, 70, 50), [r(10, 10, 70, 50)]);
    model.sibling.css.display = 'none';
    const inner = model.fixture.createElement('SPAN', 'badge', r(15, 15, 60, 40), model.child);
    inner.id = 'inner';
    inner.childNodes.push({ nodeType: 3, textContent: 'One actual label',
      rect: r(20, 20, 50, 30), rects: [r(20, 20, 50, 30)] });
    const data = model.extract(), report = auditCardLayout(data);
    assert.equal(report.itemCount, 4, 'three boxes and text are all retained');
    assert.deepEqual(report.findings, []);
    const wrapper = findElementItem(data, 'wrapper'), child = findElementItem(data, 'nested-box');
    const innerItem = findElementItem(data, 'inner');
    const label = data.cards[0].items.find(x => x.kind === 'text');
    assert.deepEqual(plain(innerItem.ancestorBoxIds), [child.id, wrapper.id]);
    assert.deepEqual(plain(label.ancestorBoxIds), [innerItem.id, child.id, wrapper.id],
      'text begins at its originating semantic box, inclusive');
    assert.equal(label.ownerId, innerItem.id);
  });

  test('sharing multiple ancestors never exempts sibling boxes or distinct labels', () => {
    const model = nestedHierarchyFixture();
    setMeasuredGeometry(model.wrapper, r(5, 5, 95, 60), [r(5, 5, 95, 60)]);
    setMeasuredGeometry(model.child, r(10, 10, 70, 50), [r(10, 10, 70, 50)]);
    model.sibling.css.display = 'none';
    const a = model.fixture.createElement('SPAN', 'badge', r(20, 20, 50, 40), model.child);
    a.id = 'sibling-a';
    const b = model.fixture.createElement('A', '', r(25, 20, 55, 40), model.child);
    b.id = 'sibling-b';
    model.child.childNodes.push(
      { nodeType: 3, textContent: 'Label A', rect: r(12, 12, 30, 18), rects: [r(12, 12, 30, 18)] },
      { nodeType: 3, textContent: 'Label B', rect: r(12, 12, 30, 18), rects: [r(12, 12, 30, 18)] });
    const data = model.extract(), report = auditCardLayout(data);
    const siblingA = findElementItem(data, 'sibling-a'), siblingB = findElementItem(data, 'sibling-b');
    const labels = data.cards[0].items.filter(x => x.kind === 'text');
    assert.deepEqual(plain(siblingA.ancestorBoxIds), plain(siblingB.ancestorBoxIds));
    assert.ok(report.findings.some(x => x.code === 'COLLISION'
      && [x.itemId, x.otherItemId].includes(siblingA.id)
      && [x.itemId, x.otherItemId].includes(siblingB.id)));
    assert.ok(report.findings.some(x => x.code === 'COLLISION'
      && [x.itemId, x.otherItemId].includes(labels[0].id)
      && [x.itemId, x.otherItemId].includes(labels[1].id)));
  });

  test('hidden and boxless wrappers never become emitted painted ancestors', () => {
    for (const state of ['hidden', 'collapse', 'boxless']) {
      const model = nestedHierarchyFixture();
      if (state === 'boxless') {
        model.wrapper.css.display = 'contents';
        setMeasuredGeometry(model.wrapper, r(10, 10, 10, 10), []);
      } else model.wrapper.css.visibility = state;
      const data = model.extract(), child = findElementItem(data, 'nested-box');
      assert.ok(child);
      assert.equal(findElementItem(data, 'wrapper'), undefined);
      assert.deepEqual(plain(child.ancestorBoxIds), []);
      assert.equal(child.ownerId, null);
      const report = auditCardLayout(data);
      assert.ok(report.findings.some(x => x.itemId === child.id && x.code === 'ESCAPE_X'));
      assert.ok(report.findings.some(x => x.code === 'COLLISION'));
    }
  });

  test('nested-card border ancestry stays in parent while child content stops at nearest card', () => {
    const model = nestedHierarchyFixture('badge', 'card');
    const inside = model.fixture.createElement('A', '', r(82, 12, 110, 25), model.child);
    inside.id = 'inside-child';
    inside.childNodes.push({ nodeType: 3, textContent: 'Nested card label',
      rect: r(84, 14, 105, 23), rects: [r(84, 14, 105, 23)] });
    const data = model.extract();
    const parent = data.cards[0], childCard = data.cards[1];
    const wrapper = findElementItem(data, 'wrapper'), childBorder = findElementItem(data, 'nested-box');
    assert.ok(parent.items.includes(childBorder));
    assert.deepEqual(plain(childBorder.ancestorBoxIds), [wrapper.id]);
    const control = childCard.items.find(x => x.kind === 'control');
    const label = childCard.items.find(x => x.kind === 'text');
    assert.deepEqual(plain(control.ancestorBoxIds), []);
    assert.deepEqual(plain(label.ancestorBoxIds), [control.id]);
    assert.ok(!childCard.items.some(x => x.ancestorBoxIds.includes(wrapper.id)
      || x.ancestorBoxIds.includes(childBorder.id)));
  });

  test('registry-based ancestry survives irrelevant hidden branches and coherent translation', () => {
    for (const outerKind of ['badge', 'control']) {
      for (const innerKind of ['badge', 'control', 'card']) {
        for (const offset of [-321, 0, 654]) {
          const model = nestedHierarchyFixture(outerKind, innerKind);
          const before = auditCardLayout(model.extract());
          for (const el of [model.fixture.root, model.fixture.card, model.wrapper, model.child, model.sibling]) {
            const rect = el.getBoundingClientRect();
            const metrics = { clientWidth: el.clientWidth, clientHeight: el.clientHeight,
              offsetWidth: el.offsetWidth, offsetHeight: el.offsetHeight };
            const moved = r(rect.left + offset, rect.top - offset, rect.right + offset, rect.bottom - offset);
            setMeasuredGeometry(el, moved, [moved]);
            Object.assign(el, metrics);
          }
          const hidden = model.fixture.createElement('SPAN', 'badge', r(), model.fixture.card, { display: 'none' });
          model.fixture.createElement('A', '', r(), hidden);
          assert.deepEqual(auditCardLayout(model.extract()), before);
        }
      }
    }
  });

  function declaredAncestrySnapshot() {
    return snapshot(
      item('outer', 'control', r(5, 5, 95, 70)),
      item('middle', 'badge', r(10, 10, 80, 60), { ancestorBoxIds: ['outer'], ownerId: 'outer' }),
      item('inner', 'control', r(15, 15, 70, 50), { ancestorBoxIds: ['middle', 'outer'], ownerId: 'middle' }),
      item('label', 'text', r(20, 20, 60, 30), { ancestorBoxIds: ['inner', 'middle', 'outer'], ownerId: 'inner' }));
  }

  test('manual multi-level ancestry is validated without mutating declared inputs', () => {
    const data = declaredAncestrySnapshot(), before = JSON.stringify(data);
    assert.deepEqual(codes(data), []);
    assert.equal(JSON.stringify(data), before);
    data.cards[0].items.push(item('sibling-label', 'text', r(20, 20, 60, 30),
      { ancestorBoxIds: ['inner', 'middle', 'outer'] }));
    assert.ok(codes(data).includes('COLLISION'));
  });

  test('legacy ownerId remains a singleton only, while new arrays encode all ancestor pairs', () => {
    const outer = item('outer', 'control', r(5, 5, 95, 70));
    const middle = item('middle', 'badge', r(10, 10, 80, 60), { ownerId: 'outer' });
    const inner = item('inner', 'control', r(15, 15, 70, 50), { ownerId: 'middle' });
    const data = snapshot(outer, middle, inner), before = JSON.stringify(data);
    assert.equal(auditCardLayout(data).findings.filter(x => x.code === 'COLLISION').length, 1,
      'legacy single-owner metadata does not invent missing multi-level DOM ancestry');
    assert.equal(JSON.stringify(data), before);
    inner.ancestorBoxIds = ['middle', 'outer'];
    assert.deepEqual(codes(data), []);
  });

  test('conflicting old and new metadata never unions exemption authorities', () => {
    for (const ownerId of ['outer', null, 'missing']) {
      const data = declaredAncestrySnapshot();
      data.cards[0].items[3].ownerId = ownerId;
      assert.throws(() => auditCardLayout(data), /conflicting ownership metadata/);
    }
    const empty = declaredAncestrySnapshot();
    empty.cards[0].items[3].ancestorBoxIds = [];
    assert.throws(() => auditCardLayout(empty), /conflicting ownership metadata/);
    const consistentEmpty = snapshot(item('box', 'control', r(), { ancestorBoxIds: [], ownerId: null }));
    assert.deepEqual(codes(consistentEmpty), []);
  });

  test('invalid new ancestry shape and duplicate or empty identifiers fail explicitly', () => {
    for (const relation of [null, 'outer', {}, [undefined], [''], ['outer', 'outer'], Array(1)]) {
      const data = snapshot(item('outer', 'control'), item('label', 'text', r(5, 5, 30, 20),
        { ancestorBoxIds: relation }));
      assert.throws(() => auditCardLayout(data), /ancestor box/);
    }
  });

  test('self, text, absent, unpainted and other-card ancestor targets fail explicitly', () => {
    for (const target of ['label', 'text-target', 'absent', 'unpainted', 'other-card-box']) {
      const data = snapshot(
        item('text-target', 'text'),
        item('unpainted', 'badge', r(5, 5, 5, 5), { rects: [] }),
        item('label', 'text', r(10, 10, 30, 20), { ancestorBoxIds: [target] }));
      data.cards.push({ id: 'other-card', rect: r(), items: [item('other-card-box', 'control')] });
      assert.throws(() => auditCardLayout(data), /invalid ancestor box relation/);
    }
  });

  test('cyclic ancestry is rejected for new arrays and legacy owner chains', () => {
    for (const legacy of [false, true]) {
      for (const count of [2, 3]) {
        const boxes = Array.from({ length: count }, (_, index) => item('box-' + index, 'badge', r(),
          legacy ? { ownerId: 'box-' + ((index + 1) % count) }
            : { ancestorBoxIds: ['box-' + ((index + 1) % count)] }));
        assert.throws(() => auditCardLayout(snapshot(...boxes)), /cyclic ancestor box relation/);
      }
    }
  });

  test('malformed legacy owners fail instead of silently granting exemptions', () => {
    for (const ownerId of ['', undefined, 0, false, {}, ['outer']]) {
      const data = snapshot(item('outer', 'control'), item('label', 'text', r(), { ownerId }));
      assert.throws(() => auditCardLayout(data), /invalid legacy owner/);
    }
  });

  test('ancestry exemption never skips individual escape or clipping in manual snapshots', () => {
    const data = snapshot(
      item('outer', 'badge', r(5, 5, 130, 60)),
      item('child', 'control', r(80, 10, 140, 30), { ancestorBoxIds: ['outer'],
        clips: [{ id: 'real-clip', rect: r(5, 5, 130, 60), x: 'hidden', y: 'visible' }] }));
    const report = auditCardLayout(data);
    assert.ok(report.findings.some(x => x.itemId === 'child' && x.code === 'CLIPPED_X'));
    assert.ok(report.findings.some(x => x.itemId === 'child' && x.code === 'ESCAPE_X'));
    assert.equal(report.findings.filter(x => x.code === 'COLLISION').length, 0);
  });
}
