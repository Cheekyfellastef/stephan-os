import { loadVrPlaytestLiveFeed } from '../../shared/vr/vrPlaytestLiveFeedClient.mjs';
import { deriveStarfieldVrCapabilityMap } from './capability-map-model.mjs';

const REFRESH_MS = 30000;
let selectedCapabilityId = 'stereo-stability';
let latestMap = deriveStarfieldVrCapabilityMap({});

const nodes = {
  tabReference: document.querySelector('[data-lab-tab="reference"]'),
  tabCapability: document.querySelector('[data-lab-tab="capability"]'),
  view: document.getElementById('capability-map-view'),
  targetState: document.getElementById('cap-target-state'),
  sourceState: document.getElementById('cap-source-state'),
  currentRoute: document.getElementById('cap-current-route'),
  biggestBlocker: document.getElementById('cap-biggest-blocker'),
  graph: document.getElementById('capability-graph'),
  bottlenecks: document.getElementById('capability-bottlenecks'),
  evidence: document.getElementById('capability-evidence'),
  heatmap: document.getElementById('capability-heatmap'),
  detail: document.getElementById('capability-detail'),
  routeCompare: document.getElementById('capability-route-compare'),
  refreshStatus: document.getElementById('capability-refresh-status'),
};

function element(tag, text = '', className = '') {
  const out = document.createElement(tag);
  if (text) out.textContent = text;
  if (className) out.className = className;
  return out;
}

function setView(name) {
  const capability = name === 'capability';
  document.body.dataset.labView = capability ? 'capability' : 'reference';
  nodes.tabReference?.setAttribute('aria-selected', capability ? 'false' : 'true');
  nodes.tabCapability?.setAttribute('aria-selected', capability ? 'true' : 'false');
  nodes.tabReference?.classList.toggle('is-active', !capability);
  nodes.tabCapability?.classList.toggle('is-active', capability);
  if (capability) history.replaceState(null, '', '#capability-map');
  else if (location.hash === '#capability-map') history.replaceState(null, '', location.pathname + location.search);
}

function stateLabel(state) {
  return String(state || 'UNKNOWN').replace('_', ' ');
}

function stateClass(state) {
  return 'state-' + String(state || 'UNKNOWN').toLowerCase().replaceAll('_', '-');
}

function selectedCapability(map = latestMap) {
  return map.capabilities.find((entry) => entry.id === selectedCapabilityId)
    || map.capabilities[0]
    || null;
}

function renderMission(map) {
  nodes.targetState.textContent = stateLabel(map.targetState);
  nodes.targetState.className = 'cap-state-badge ' + stateClass(map.targetState);
  nodes.sourceState.textContent = map.currentEvidence ? 'LIVE EVIDENCE' : map.sourceState;
  nodes.sourceState.className = 'cap-state-badge ' + (map.currentEvidence ? 'state-healthy' : 'state-unknown');
  nodes.currentRoute.textContent = map.route === 'UNKNOWN' ? 'Awaiting route proof' : map.route + (map.mode !== 'UNKNOWN' ? ' · ' + map.mode : '');
  nodes.biggestBlocker.textContent = map.biggestBlocker
    ? map.biggestBlocker.label + ' · ' + stateLabel(map.biggestBlocker.state)
    : 'No blocker published';
}

function renderGraph(map) {
  nodes.graph.replaceChildren();
  const northStar = element('div', '', 'cap-north-star ' + stateClass(map.targetState));
  northStar.append(
    element('span', 'NORTH STAR', 'cap-overline'),
    element('strong', map.target, 'cap-north-title'),
    element('span', map.evidenceBoundary, 'cap-north-copy'),
  );
  nodes.graph.appendChild(northStar);

  const lines = element('div', '', 'cap-graph-lines');
  lines.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 7; i += 1) lines.appendChild(element('span'));
  nodes.graph.appendChild(lines);

  const grid = element('div', '', 'cap-node-grid');
  for (const capability of map.capabilities) {
    const button = element('button', '', 'cap-node ' + stateClass(capability.state));
    button.type = 'button';
    button.dataset.capabilityId = capability.id;
    button.classList.toggle('is-selected', capability.id === selectedCapabilityId);
    button.setAttribute('aria-pressed', capability.id === selectedCapabilityId ? 'true' : 'false');
    button.append(
      element('span', capability.icon, 'cap-node-icon'),
      element('strong', capability.label, 'cap-node-title'),
      element('span', stateLabel(capability.state), 'cap-node-state'),
    );
    if (capability.dependencies.length) {
      button.appendChild(element('span', 'depends on ' + capability.dependencies.length, 'cap-node-deps'));
    }
    button.addEventListener('click', () => {
      selectedCapabilityId = capability.id;
      renderGraph(latestMap);
      renderDetail(latestMap);
    });
    grid.appendChild(button);
  }
  nodes.graph.appendChild(grid);
}

function renderBottlenecks(map) {
  nodes.bottlenecks.replaceChildren();
  for (const [index, capability] of map.bottlenecks.entries()) {
    const card = element('button', '', 'cap-bottleneck ' + stateClass(capability.state));
    card.type = 'button';
    card.append(
      element('span', String(index + 1), 'cap-bottleneck-rank'),
      element('strong', capability.label),
      element('span', stateLabel(capability.state), 'cap-bottleneck-state'),
      element('small', capability.reason),
    );
    card.addEventListener('click', () => {
      selectedCapabilityId = capability.id;
      renderGraph(latestMap);
      renderDetail(latestMap);
    });
    nodes.bottlenecks.appendChild(card);
  }
}

function postureLevel(state) {
  if (state === 'HEALTHY') return 5;
  if (state === 'NEEDS_WORK') return 3;
  if (state === 'BLOCKED') return 1;
  return 0;
}

function renderHeatmap(map) {
  nodes.heatmap.replaceChildren();
  for (const capability of map.capabilities) {
    const row = element('button', '', 'cap-heat-row');
    row.type = 'button';
    row.appendChild(element('span', capability.label, 'cap-heat-label'));
    const cells = element('span', '', 'cap-heat-cells');
    const level = postureLevel(capability.state);
    for (let i = 1; i <= 5; i += 1) {
      const cell = element('i', '', i <= level ? stateClass(capability.state) : 'state-empty');
      cells.appendChild(cell);
    }
    row.append(cells, element('span', stateLabel(capability.state), 'cap-heat-state'));
    row.addEventListener('click', () => {
      selectedCapabilityId = capability.id;
      renderGraph(latestMap);
      renderDetail(latestMap);
    });
    nodes.heatmap.appendChild(row);
  }
}

function renderDetail(map) {
  const capability = selectedCapability(map);
  nodes.detail.replaceChildren();
  if (!capability) return;

  const title = element('div', '', 'cap-detail-title');
  title.append(
    element('span', capability.icon, 'cap-detail-icon'),
    element('div'),
  );
  title.lastElementChild.append(
    element('span', 'SELECTED CAPABILITY', 'cap-overline'),
    element('h3', capability.label),
  );
  nodes.detail.append(
    title,
    element('span', stateLabel(capability.state), 'cap-state-badge ' + stateClass(capability.state)),
    element('p', capability.reason, 'cap-detail-reason'),
  );

  const dependencyTitle = element('h4', 'Dependencies');
  const deps = element('div', '', 'cap-chip-row');
  if (capability.dependencies.length) {
    for (const dependency of capability.dependencies) {
      const match = map.capabilities.find((entry) => entry.id === dependency);
      deps.appendChild(element('span', match ? match.label : dependency, 'cap-chip'));
    }
  } else {
    deps.appendChild(element('span', 'No upstream dependency in this map', 'cap-chip'));
  }

  const evidenceTitle = element('h4', 'Current evidence');
  const evidence = element('ul', '', 'cap-detail-list');
  const entries = capability.evidence.length ? capability.evidence : ['No current proof attached.'];
  for (const entry of entries.slice(0, 6)) evidence.appendChild(element('li', entry));

  nodes.detail.append(dependencyTitle, deps, evidenceTitle, evidence);
}

function renderEvidence(map) {
  nodes.evidence.replaceChildren();
  if (!map.findings.length) {
    nodes.evidence.appendChild(element('p', 'No current headset findings. The map will stay conservative until a playtest packet arrives.', 'cap-empty-copy'));
    return;
  }
  for (const finding of map.findings.slice(0, 5)) {
    const item = element('div', '', 'cap-evidence-item');
    item.append(element('span', '●', 'cap-evidence-dot'), element('p', finding));
    nodes.evidence.appendChild(item);
  }
  if (map.provenanceRef) nodes.evidence.appendChild(element('code', map.provenanceRef, 'cap-provenance'));
}

function renderRouteCompare(map) {
  nodes.routeCompare.replaceChildren();
  const live = element('article', '', 'cap-route-card is-live');
  live.append(
    element('span', 'CURRENT', 'cap-overline'),
    element('h3', map.route === 'UNKNOWN' ? 'No route proved' : map.route),
    element('p', 'Mode ' + map.mode + ' · next ' + map.nextMode + ' · rollback ' + map.rollback),
  );

  const comparisonName = /vorpx/i.test(map.route) ? 'MutaR' : 'VorpX';
  const compare = element('article', '', 'cap-route-card');
  compare.append(
    element('span', 'COMPARISON', 'cap-overline'),
    element('h3', comparisonName),
    element('p', 'No comparable current session is promoted. The Lab will not declare a winner without matched evidence.'),
  );
  nodes.routeCompare.append(live, compare);
}

function render(map) {
  latestMap = map;
  if (!map.capabilities.some((entry) => entry.id === selectedCapabilityId)) {
    selectedCapabilityId = map.capabilities[0]?.id || '';
  }
  renderMission(map);
  renderGraph(map);
  renderBottlenecks(map);
  renderHeatmap(map);
  renderDetail(map);
  renderEvidence(map);
  renderRouteCompare(map);
}

async function refresh() {
  nodes.refreshStatus.textContent = 'Refreshing evidence…';
  try {
    const feed = await loadVrPlaytestLiveFeed();
    render(deriveStarfieldVrCapabilityMap(feed));
    nodes.refreshStatus.textContent = 'Shared Workspace evidence refreshed';
  } catch (error) {
    render(deriveStarfieldVrCapabilityMap({ state: 'unavailable' }));
    nodes.refreshStatus.textContent = 'Live evidence unavailable · map held at UNKNOWN';
  }
}

nodes.tabReference?.addEventListener('click', () => setView('reference'));
nodes.tabCapability?.addEventListener('click', () => setView('capability'));

setView(location.hash === '#capability-map' ? 'capability' : 'reference');
render(latestMap);
refresh();
setInterval(refresh, REFRESH_MS);
