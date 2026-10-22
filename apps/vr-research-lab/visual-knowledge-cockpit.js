const WORKSPACE_URL = '../../VR-Research-Lab/lab-workspace.json';
const SOURCES_URL = '../../VR-Research-Lab/knowledge-sources.json';
const READINESS_URL = '../../VR-Research-Lab/capability-readiness.json';
const REFRESH_MS = 5000;

const state = {
  workspace: null,
  sources: null,
  readiness: null,
  selection: null,
};

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function clear(node) {
  node.replaceChildren();
  return node;
}

function compact(text, max = 150) {
  const value = String(text || '').trim();
  return value.length > max ? value.slice(0, max - 1) + '…' : value;
}

function statusClass(status = '') {
  const value = String(status).toLowerCase();
  if (/proven|validated|active|ready|registered-pinned|promoted/.test(value)) return 'good';
  if (/pending|testing|research|idea|awaiting|optional|design/.test(value)) return 'warn';
  return '';
}

function mode(modeName) {
  document.body.classList.remove('vr-lab-visual-mode', 'vr-lab-deep-mode', 'vr-lab-both-mode');
  document.body.classList.add(
    modeName === 'deep' ? 'vr-lab-deep-mode' :
    modeName === 'both' ? 'vr-lab-both-mode' :
    'vr-lab-visual-mode'
  );
  document.querySelectorAll('[data-vr-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.vrMode === modeName);
  });
}

function button(label, modeName) {
  const out = el('button', 'vr-mode-button', label);
  out.type = 'button';
  out.dataset.vrMode = modeName;
  out.addEventListener('click', () => mode(modeName));
  return out;
}

function kpi(label, value = '—') {
  const box = el('div', 'vr-kpi');
  const strong = el('strong', '', value);
  strong.dataset.kpi = label;
  box.append(strong, el('span', '', label));
  return box;
}

function sectionHead(kicker, title, note = '') {
  const head = el('div', 'vr-section-head');
  const left = el('div');
  left.append(el('div', 'vr-section-kicker', kicker), el('h2', '', title));
  head.append(left);
  if (note) head.append(el('div', 'vr-section-note', note));
  return head;
}

function ensureCockpit() {
  let root = document.getElementById('vr-visual-cockpit');
  if (root) return root;

  root = el('section', 'panel vr-visual-cockpit');
  root.id = 'vr-visual-cockpit';
  const inner = el('div', 'vr-cockpit-inner');

  const topline = el('div', 'vr-cockpit-topline');
  const live = el('div', 'vr-live-badge');
  live.append(el('span', 'vr-live-dot'), el('span', '', 'CANONICAL KNOWLEDGE SURFACE'));
  const switcher = el('div', 'vr-mode-switch');
  switcher.append(button('Visual cockpit', 'visual'), button('Deep evidence', 'deep'), button('Both', 'both'));
  topline.append(live, switcher);

  const header = el('div', 'vr-cockpit-head');
  const intro = el('div');
  const title = el('h1', 'vr-cockpit-title');
  title.innerHTML = 'See the VR programme as a <span>living system.</span>';
  intro.append(
    title,
    el('p', 'vr-cockpit-copy',
      'Research, playtests, reusable methods, proof gaps and source intelligence are projected here as one navigable map. Click anything to inspect it, then hand that exact context to Stephanos and the Flywheel.')
  );
  header.append(intro);

  const kpis = el('div', 'vr-kpis');
  ['sources', 'reusable', 'techniques', 'experiments', 'testing now', 'proof capabilities'].forEach((label) => kpis.append(kpi(label)));

  const hero = el('div', 'vr-hero-grid');
  const galaxy = el('section', 'vr-glass vr-section');
  galaxy.id = 'vr-knowledge-galaxy';
  galaxy.append(sectionHead('Knowledge constellation', 'Capability Galaxy', 'targets ↔ techniques ↔ experiments'));
  galaxy.append(el('div', 'vr-galaxy-wrap'));
  const inspector = el('aside', 'vr-glass vr-section vr-inspector');
  inspector.id = 'vr-selection-inspector';
  hero.append(galaxy, inspector);

  const lower = el('div', 'vr-lower-grid');
  const river = el('section', 'vr-glass vr-section');
  river.id = 'vr-learning-river';
  river.append(sectionHead('Closed-loop learning', 'Learning River', 'playtest → finding → method → next move'));
  river.append(el('div', 'vr-learning-river'));

  const readiness = el('section', 'vr-glass vr-section');
  readiness.id = 'vr-proof-readiness';
  readiness.append(sectionHead('Truth discipline', 'Proof Ladder', 'design · build · automated · runtime · operator'));
  readiness.append(el('div', 'vr-readiness-list'));
  lower.append(river, readiness);

  const experiments = el('section', 'vr-glass vr-section');
  experiments.id = 'vr-experiment-flightdeck';
  experiments.append(sectionHead('Research motion', 'Experiment Flight Deck', 'ideas move right as evidence hardens'));
  experiments.append(el('div', 'vr-experiment-board'));

  const sources = el('section', 'vr-glass vr-section');
  sources.id = 'vr-source-cloud';
  sources.append(sectionHead('Evidence universe', 'Source Cloud', 'priority and reuse state at a glance'));
  sources.append(el('div', 'vr-source-cloud'));

  inner.append(topline, header, kpis, hero, lower, experiments, sources,
    el('div', 'vr-visual-footer',
      'Visual summaries never replace canonical evidence. Deep Evidence exposes the underlying workspace, source paths, Mission Console and exact research records.')
  );
  root.append(inner);

  const main = document.querySelector('main.shell') || document.querySelector('main') || document.body;
  const headerPanel = main.querySelector(':scope > section.panel');
  if (headerPanel?.nextSibling) main.insertBefore(root, headerPanel.nextSibling);
  else main.prepend(root);
  mode('visual');
  return root;
}

function setKpi(label, value) {
  const node = document.querySelector('[data-kpi="' + label + '"]');
  if (node) node.textContent = String(value ?? '—');
}

function capabilityScore(capability) {
  const weights = { design: 10, implementation: 30, automatedProof: 20, runtimeProof: 20, operatorAcceptance: 20 };
  return Object.entries(weights).reduce((sum, [key, weight]) =>
    sum + (capability?.stages?.[key]?.status === 'proven' ? weight : 0), 0);
}

function sourceReusable(source) {
  const licence = String(source?.licence || '').toLowerCase();
  const status = String(source?.status || '').toLowerCase();
  return /mit|apache|bsd|gpl|lgpl|mpl/.test(licence) && !/metadata-only|reference-only|proprietary/.test(status);
}

function selectionRecord(kind, raw) {
  if (!raw) return null;
  if (kind === 'target') return {
    kind, title: raw.name, status: raw.priority, summary: raw.focus, mode: raw.mode,
    path: null, raw,
  };
  if (kind === 'technique') return {
    kind, title: raw.name, status: raw.status, summary: raw.goal, path: raw.path, raw,
  };
  if (kind === 'experiment') return {
    kind, title: raw.title, status: raw.status, summary: raw.hypothesis, notes: raw.notes,
    related: raw.relatedTechniques, raw,
  };
  if (kind === 'source') return {
    kind, title: raw.title, status: raw.status, summary: raw.promotion_rule || raw.repository || raw.canonical_source,
    path: raw.local_extraction || raw.local_manifest, licence: raw.licence, raw,
  };
  if (kind === 'capability') return {
    kind, title: raw.id.replaceAll('-', ' '), status: raw.visual?.truthLabel || 'capability',
    summary: raw.visual?.deltaSummary, score: capabilityScore(raw), raw,
  };
  return { kind, title: raw.title || raw.name || kind, summary: '', raw };
}

function select(kind, raw) {
  state.selection = selectionRecord(kind, raw);
  globalThis.__STEPHANOS_VR_RESEARCH_SELECTION__ = state.selection;
  window.dispatchEvent(new CustomEvent('stephanos:vr-research-selection', { detail: state.selection }));
  renderInspector();
}

function addMeta(parent, label, value) {
  if (value == null || value === '') return;
  const row = el('div', 'vr-inspector-meta-row');
  row.append(el('span', '', label), el('div', '', String(value)));
  parent.append(row);
}

function handToMissionConsole(intent) {
  const selected = state.selection;
  const prompt = document.getElementById('prompt-input');
  if (!prompt || !selected) return;
  const context = [
    'Selected VR Research Lab object:',
    'type=' + selected.kind,
    'title=' + selected.title,
    'status=' + (selected.status || 'unknown'),
    'summary=' + (selected.summary || ''),
    selected.path ? 'evidence_path=' + selected.path : '',
    selected.licence ? 'licence=' + selected.licence : '',
  ].filter(Boolean).join('\n');

  prompt.value = intent === 'iterate'
    ? context + '\n\nCompare this against the newest canonical VR evidence and live playtest/Flywheel signals. Identify contradictions, the highest-value next experiment, what evidence would change our mind, and what reusable method should be promoted if proven.'
    : context + '\n\nExplain what this means, what is proven versus inferred, and the most useful next question to answer.';
  mode('both');
  const consoleNode = document.querySelector('.mission-console');
  consoleNode?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  prompt.focus();
}

function renderInspector() {
  const box = document.getElementById('vr-selection-inspector');
  if (!box) return;
  clear(box);
  const selected = state.selection;
  if (!selected) {
    box.append(
      el('div', 'vr-section-kicker', 'Selection inspector'),
      el('h2', '', 'Click the galaxy'),
      el('p', 'vr-inspector-copy',
        'Pick a target, method, experiment, source or proof capability. The Lab will turn it into a human-sized explanation and preserve the exact context for the Mission Console.')
    );
    return;
  }

  const chips = el('div', 'vr-mini-pills');
  chips.append(el('span', 'vr-chip ' + statusClass(selected.status), selected.kind.toUpperCase()));
  if (selected.status) chips.append(el('span', 'vr-chip ' + statusClass(selected.status), String(selected.status)));
  if (selected.score != null) chips.append(el('span', 'vr-chip good', selected.score + '% proof'));
  if (selected.licence) chips.append(el('span', 'vr-chip', compact(selected.licence, 32)));

  const meta = el('div', 'vr-inspector-meta');
  addMeta(meta, 'Meaning', selected.summary);
  addMeta(meta, 'Mode', selected.mode);
  addMeta(meta, 'Notes', selected.notes);
  addMeta(meta, 'Related', Array.isArray(selected.related) ? selected.related.join(', ') : selected.related);
  addMeta(meta, 'Evidence', selected.path);

  const actions = el('div', 'vr-inspector-actions');
  const ask = el('button', '', 'Ask Stephanos');
  ask.addEventListener('click', () => handToMissionConsole('explain'));
  const iterate = el('button', 'secondary', 'Run iteration question');
  iterate.addEventListener('click', () => handToMissionConsole('iterate'));
  actions.append(ask, iterate);

  box.append(
    el('div', 'vr-section-kicker', 'Selection inspector'),
    el('h2', '', selected.title),
    chips,
    el('p', 'vr-inspector-copy', compact(selected.summary, 360)),
    meta,
    actions
  );
}

function buildLinks(workspace) {
  const targetByName = new Map((workspace.targets || []).map((target) => [target.name, target]));
  const techniqueByName = new Map((workspace.techniques || []).map((tech) => [tech.name, tech]));
  const links = [];
  for (const exp of workspace.experiments || []) {
    const text = (exp.title + ' ' + exp.hypothesis).toLowerCase();
    const target = [...targetByName.values()].find((candidate) => {
      const token = candidate.name.toLowerCase().split(/\s+/)[0];
      if (token === 'resistant') return /resistant|offline|reconstruction/.test(text);
      if (token === 'stephanos') return /spatial|workspace|bridge/.test(text);
      return text.includes(token);
    });
    if (!target) continue;
    for (const techniqueName of exp.relatedTechniques || []) {
      if (techniqueByName.has(techniqueName)) links.push([target.name, techniqueName]);
    }
  }
  return links;
}

function renderGalaxy() {
  const wrap = document.querySelector('#vr-knowledge-galaxy .vr-galaxy-wrap');
  if (!wrap || !state.workspace) return;
  clear(wrap);

  const width = 900;
  const height = 440;
  const cx = width / 2;
  const cy = height / 2;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Interactive map of VR targets and reusable techniques');

  for (const radius of [92, 160, 206]) {
    const ring = document.createElementNS(svg.namespaceURI, 'circle');
    ring.setAttribute('cx', cx); ring.setAttribute('cy', cy); ring.setAttribute('r', radius);
    ring.setAttribute('class', 'vr-galaxy-ring');
    svg.append(ring);
  }

  const targets = state.workspace.targets || [];
  const techniques = state.workspace.techniques || [];
  const positions = new Map();

  targets.forEach((target, index) => {
    const angle = (Math.PI * 2 * index / Math.max(1, targets.length)) - Math.PI / 2;
    positions.set(target.name, { x: cx + Math.cos(angle) * 188, y: cy + Math.sin(angle) * 188, kind: 'target', raw: target });
  });
  techniques.forEach((tech, index) => {
    const angle = (Math.PI * 2 * index / Math.max(1, techniques.length)) - Math.PI / 2 + .18;
    const radius = index % 2 ? 128 : 105;
    positions.set(tech.name, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, kind: 'technique', raw: tech });
  });

  for (const [a, b] of buildLinks(state.workspace)) {
    const p1 = positions.get(a);
    const p2 = positions.get(b);
    if (!p1 || !p2) continue;
    const line = document.createElementNS(svg.namespaceURI, 'line');
    line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y);
    line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
    line.setAttribute('class', 'vr-galaxy-edge');
    svg.append(line);
  }

  const core = document.createElementNS(svg.namespaceURI, 'circle');
  core.setAttribute('cx', cx); core.setAttribute('cy', cy); core.setAttribute('r', 54);
  core.setAttribute('class', 'vr-galaxy-core');
  svg.append(core);
  const coreText = document.createElementNS(svg.namespaceURI, 'text');
  coreText.setAttribute('x', cx); coreText.setAttribute('y', cy - 3);
  coreText.setAttribute('text-anchor', 'middle'); coreText.setAttribute('class', 'vr-galaxy-core-label');
  coreText.textContent = 'VR CAPABILITY';
  const coreText2 = document.createElementNS(svg.namespaceURI, 'text');
  coreText2.setAttribute('x', cx); coreText2.setAttribute('y', cy + 14);
  coreText2.setAttribute('text-anchor', 'middle'); coreText2.setAttribute('class', 'vr-galaxy-core-label');
  coreText2.textContent = 'FACTORY';
  svg.append(coreText, coreText2);

  for (const [name, pos] of positions) {
    const group = document.createElementNS(svg.namespaceURI, 'g');
    group.setAttribute('class', 'vr-galaxy-node ' + pos.kind);
    group.setAttribute('tabindex', '0');
    group.setAttribute('role', 'button');
    group.setAttribute('aria-label', pos.kind + ': ' + name);

    const circle = document.createElementNS(svg.namespaceURI, 'circle');
    const radius = pos.kind === 'target' ? 25 : 17;
    circle.setAttribute('cx', pos.x); circle.setAttribute('cy', pos.y); circle.setAttribute('r', radius);

    const label = document.createElementNS(svg.namespaceURI, 'text');
    label.setAttribute('x', pos.x);
    label.setAttribute('y', pos.y + radius + 13);
    label.setAttribute('text-anchor', 'middle');
    label.textContent = compact(name, 24);

    const activate = () => {
      svg.querySelectorAll('.vr-galaxy-node').forEach((node) => node.classList.remove('selected'));
      group.classList.add('selected');
      select(pos.kind, pos.raw);
    };
    group.addEventListener('click', activate);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
    });
    group.append(circle, label);
    svg.append(group);
  }

  wrap.append(svg);
}

function experimentLane(status = '') {
  const value = String(status).toLowerCase();
  if (/validated|complete|proven|accepted/.test(value)) return 'Proven';
  if (/testing|runtime|playtest/.test(value)) return 'Testing';
  if (/research|awaiting|extract|source/.test(value)) return 'Researching';
  return 'Ideas';
}

function renderExperiments() {
  const board = document.querySelector('#vr-experiment-flightdeck .vr-experiment-board');
  if (!board || !state.workspace) return;
  clear(board);
  const lanes = ['Ideas', 'Researching', 'Testing', 'Proven'];
  const grouped = Object.fromEntries(lanes.map((lane) => [lane, []]));
  for (const exp of state.workspace.experiments || []) grouped[experimentLane(exp.status)].push(exp);

  for (const lane of lanes) {
    const column = el('div', 'vr-exp-lane');
    const head = el('div', 'vr-exp-lane-head');
    head.append(el('span', '', lane), el('span', 'vr-chip', grouped[lane].length));
    const stack = el('div', 'vr-exp-stack');
    for (const exp of grouped[lane]) {
      const card = el('div', 'vr-exp-card');
      card.tabIndex = 0;
      card.append(el('strong', '', exp.title), el('small', '', compact(exp.hypothesis, 110)));
      card.addEventListener('click', () => select('experiment', exp));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') select('experiment', exp);
      });
      stack.append(card);
    }
    if (!grouped[lane].length) stack.append(el('div', 'vr-section-note', 'No items'));
    column.append(head, stack);
    board.append(column);
  }
}

function renderSources() {
  const cloud = document.querySelector('#vr-source-cloud .vr-source-cloud');
  if (!cloud || !state.sources) return;
  clear(cloud);
  const sources = state.sources.sources || [];
  const ordered = [...sources].sort((a, b) => {
    const priority = (a.priority === 'P0' ? -1 : 0) - (b.priority === 'P0' ? -1 : 0);
    return priority || String(a.title).localeCompare(String(b.title));
  });
  for (const source of ordered) {
    const orb = el('button', 'vr-source-orb' + (source.priority === 'P0' ? ' p0' : '') + (sourceReusable(source) ? ' reusable' : ''), source.title);
    orb.type = 'button';
    orb.title = [source.status, source.licence].filter(Boolean).join(' · ');
    orb.addEventListener('click', () => select('source', source));
    cloud.append(orb);
  }
}

function renderReadiness() {
  const list = document.querySelector('#vr-proof-readiness .vr-readiness-list');
  if (!list || !state.readiness) return;
  clear(list);
  const capabilities = [...(state.readiness.capabilities || [])].sort((a, b) => capabilityScore(b) - capabilityScore(a));
  for (const capability of capabilities.slice(0, 8)) {
    const row = el('div', 'vr-readiness-row');
    row.tabIndex = 0;
    row.append(el('div', '', capability.id.replaceAll('-', ' ')));
    const track = el('div', 'vr-proof-track');
    ['design', 'implementation', 'automatedProof', 'runtimeProof', 'operatorAcceptance'].forEach((key) => {
      track.append(el('span', 'vr-proof-cell ' + (capability.stages?.[key]?.status === 'proven' ? 'proven' : '')));
    });
    row.append(track, el('div', 'vr-readiness-score', capabilityScore(capability) + '%'));
    row.addEventListener('click', () => select('capability', capability));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') select('capability', capability);
    });
    list.append(row);
  }
}

function renderLearningRiver() {
  const river = document.querySelector('#vr-learning-river .vr-learning-river');
  if (!river) return;
  clear(river);
  const feed = globalThis.__STEPHANOS_VR_PLAYTEST_LIVE_FEED__;
  const spatial = globalThis.__STEPHANOS_SPATIAL_WORKSPACE_TELEMETRY__;
  const latest = feed?.vrResearchLab?.latest;
  const intelligence = feed?.intelligence;

  const steps = [
    {
      title: '1 · Observe',
      text: latest
        ? latest.game + ' / ' + latest.mode + ' · AER faults ' + latest.sequenceFaultCount + ' · rollback ' + latest.rollback
        : 'Waiting for the next completed headset playtest packet.'
    },
    {
      title: '2 · Extract',
      text: latest?.reusableFindings?.[0] || 'Reusable findings appear here when playtest evidence is promoted.'
    },
    {
      title: '3 · Generalise',
      text: latest?.techniqueCandidate || 'The Flywheel turns repeated evidence into reusable technique candidates.'
    },
    {
      title: '4 · Iterate',
      text: intelligence?.vrResearchAgent?.action
        ? 'VR Research Agent: ' + intelligence.vrResearchAgent.action + ' · corpus correlations ' + (intelligence.correlationCandidates?.length || 0)
        : spatial?.latest?.evidence
          ? 'Spatial telemetry present · ' + Number(spatial.latest.evidence.frame?.estimatedFps || 0).toFixed(1) + ' fps observed'
          : 'Stephanos compares the result against the canonical source corpus and proposes the next move.'
    },
  ];

  for (const step of steps) {
    const box = el('div', 'vr-river-step');
    box.append(el('strong', '', step.title), el('p', '', compact(step.text, 190)));
    river.append(box);
  }
}

function renderKpis() {
  const sources = state.sources?.sources || [];
  const techniques = state.workspace?.techniques || [];
  const experiments = state.workspace?.experiments || [];
  const capabilities = state.readiness?.capabilities || [];
  setKpi('sources', sources.length);
  setKpi('reusable', sources.filter(sourceReusable).length);
  setKpi('techniques', techniques.length);
  setKpi('experiments', experiments.length);
  setKpi('testing now', experiments.filter((exp) => experimentLane(exp.status) === 'Testing').length);
  setKpi('proof capabilities', capabilities.length);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(url + ' returned ' + response.status);
  return response.json();
}

async function loadCanonical() {
  const [workspace, sources, readiness] = await Promise.all([
    fetchJson(WORKSPACE_URL),
    fetchJson(SOURCES_URL),
    fetchJson(READINESS_URL),
  ]);
  state.workspace = workspace;
  state.sources = sources;
  state.readiness = readiness;
  renderKpis();
  renderGalaxy();
  renderExperiments();
  renderSources();
  renderReadiness();
  renderLearningRiver();

  if (!state.selection) {
    const testing = (workspace.experiments || []).find((exp) => experimentLane(exp.status) === 'Testing');
    select('experiment', testing || workspace.targets?.[0] || workspace.techniques?.[0]);
  }
}

ensureCockpit();
renderInspector();
loadCanonical().catch((error) => {
  const inspector = document.getElementById('vr-selection-inspector');
  if (inspector) {
    clear(inspector);
    inspector.append(
      el('div', 'vr-section-kicker', 'Canonical feed unavailable'),
      el('h2', '', 'Visual cockpit is waiting for evidence'),
      el('p', 'vr-inspector-copy', String(error?.message || error))
    );
  }
});

setInterval(() => {
  renderLearningRiver();
}, REFRESH_MS);
