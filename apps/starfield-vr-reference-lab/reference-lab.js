import {
  STARFIELD_VR_EVIDENCE_BOUNDARY,
  STARFIELD_VR_REFERENCE_DOMAINS,
  STARFIELD_VR_REFERENCES,
  STARFIELD_VR_RECOMMENDED_RECIPE,
  buildStarfieldVrRecipe,
  filterStarfieldVrReferences,
  getStarfieldVrReference,
} from '../../shared/vr/starfieldVrReferenceCatalogue.mjs';

const nodes = {
  truthSummary: document.getElementById('truth-summary'),
  truthGates: document.getElementById('truth-gates'),
  loadRecipe: document.getElementById('load-recipe'),
  clearRecipe: document.getElementById('clear-recipe'),
  copyRecipe: document.getElementById('copy-recipe'),
  copyStatus: document.getElementById('copy-status'),
  recipeCount: document.getElementById('recipe-count'),
  recipeOutcome: document.getElementById('recipe-outcome'),
  recipeFlow: document.getElementById('recipe-flow'),
  capabilityLine: document.getElementById('capability-line'),
  recipeTests: document.getElementById('recipe-tests'),
  domainFilters: document.getElementById('domain-filters'),
  referenceGrid: document.getElementById('reference-grid'),
  referenceDetail: document.getElementById('reference-detail'),
};

const state = {
  activeDomain: 'all',
  activeReferenceId: STARFIELD_VR_RECOMMENDED_RECIPE.referenceIds[0],
  selectedReferenceIds: new Set(STARFIELD_VR_RECOMMENDED_RECIPE.referenceIds),
};

function appendTextList(node, items, className = '') {
  node.replaceChildren();
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    if (className) li.className = className;
    node.appendChild(li);
  }
}

function createTextElement(tag, text, className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function renderTruthBoundary() {
  nodes.truthSummary.textContent = STARFIELD_VR_EVIDENCE_BOUNDARY.summary;
  appendTextList(nodes.truthGates, STARFIELD_VR_EVIDENCE_BOUNDARY.requiredPromotionEvidence.slice(0, 4));
}

function renderFilters() {
  nodes.domainFilters.replaceChildren();
  const filters = [{ id: 'all', label: 'All systems' }, ...STARFIELD_VR_REFERENCE_DOMAINS];
  for (const filter of filters) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `domain-button${state.activeDomain === filter.id ? ' is-active' : ''}`;
    button.textContent = filter.label;
    button.setAttribute('aria-pressed', state.activeDomain === filter.id ? 'true' : 'false');
    button.addEventListener('click', () => {
      state.activeDomain = filter.id;
      const visible = filterStarfieldVrReferences(filter.id);
      if (!visible.some((entry) => entry.id === state.activeReferenceId)) {
        state.activeReferenceId = visible[0]?.id || STARFIELD_VR_REFERENCES[0].id;
      }
      renderFilters();
      renderAtlas();
      renderReferenceDetail();
    });
    nodes.domainFilters.appendChild(button);
  }
}

function renderAtlas() {
  nodes.referenceGrid.replaceChildren();
  const references = filterStarfieldVrReferences(state.activeDomain);
  for (const reference of references) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = [
      'reference-card',
      state.activeReferenceId === reference.id ? 'is-active' : '',
      state.selectedReferenceIds.has(reference.id) ? 'is-selected' : '',
    ].filter(Boolean).join(' ');
    card.dataset.referenceId = reference.id;
    card.setAttribute('aria-label', `Inspect ${reference.title}`);

    const topLine = document.createElement('div');
    topLine.className = 'card-topline';
    topLine.append(
      createTextElement('span', reference.evidenceClass.replaceAll('-', ' '), 'evidence-tag'),
      createTextElement('span', state.selectedReferenceIds.has(reference.id) ? '✓' : '+', 'selection-mark'),
    );
    card.append(topLine, createTextElement('h3', reference.title), createTextElement('p', reference.strapline));

    const chips = document.createElement('div');
    chips.className = 'domain-chips';
    for (const domainId of reference.domains) {
      const label = STARFIELD_VR_REFERENCE_DOMAINS.find((entry) => entry.id === domainId)?.label || domainId;
      chips.appendChild(createTextElement('span', label, 'domain-chip'));
    }
    card.appendChild(chips);
    card.addEventListener('click', () => {
      state.activeReferenceId = reference.id;
      renderAtlas();
      renderReferenceDetail();
    });
    nodes.referenceGrid.appendChild(card);
  }
}

function detailSection(title, content) {
  const section = document.createElement('section');
  section.appendChild(createTextElement('h3', title));
  if (Array.isArray(content)) {
    const list = document.createElement('ul');
    list.className = 'detail-list';
    appendTextList(list, content);
    section.appendChild(list);
  } else {
    section.appendChild(createTextElement('p', content));
  }
  return section;
}

function renderReferenceDetail() {
  const reference = getStarfieldVrReference(state.activeReferenceId) || STARFIELD_VR_REFERENCES[0];
  nodes.referenceDetail.replaceChildren();
  nodes.referenceDetail.append(
    createTextElement('p', reference.evidenceClass.replaceAll('-', ' '), 'detail-kicker'),
    createTextElement('h2', reference.title),
    createTextElement('p', reference.strapline, 'strapline'),
    detailSection('What it contributes', reference.contribution),
    detailSection('Starfield attachment points', reference.attachPoints),
    detailSection('VR acceptance tests', reference.acceptanceTests),
    detailSection('Reuse boundary', reference.reusePosture),
  );

  const sources = document.createElement('section');
  sources.appendChild(createTextElement('h3', 'Sources'));
  const sourceLinks = document.createElement('div');
  sourceLinks.className = 'source-links';
  for (const source of reference.sources) {
    const link = document.createElement('a');
    link.className = 'source-link';
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(createTextElement('span', source.label), createTextElement('span', source.type.replaceAll('-', ' '), 'source-type'));
    sourceLinks.appendChild(link);
  }
  sources.appendChild(sourceLinks);
  nodes.referenceDetail.appendChild(sources);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'primary-button toggle-reference';
  toggle.textContent = state.selectedReferenceIds.has(reference.id) ? 'Remove from composite' : 'Add to composite';
  toggle.addEventListener('click', () => {
    if (state.selectedReferenceIds.has(reference.id)) state.selectedReferenceIds.delete(reference.id);
    else state.selectedReferenceIds.add(reference.id);
    nodes.copyStatus.textContent = '';
    renderAtlas();
    renderReferenceDetail();
    renderRecipe();
  });
  nodes.referenceDetail.appendChild(toggle);
}

function renderRecipe() {
  const selectedIds = [...state.selectedReferenceIds];
  const recipe = buildStarfieldVrRecipe(selectedIds);
  nodes.recipeCount.textContent = `${recipe.referenceIds.length} system${recipe.referenceIds.length === 1 ? '' : 's'} selected`;
  nodes.recipeOutcome.textContent = STARFIELD_VR_RECOMMENDED_RECIPE.outcome;
  nodes.capabilityLine.textContent = recipe.referenceIds.length > 0
    ? recipe.capabilityLine
    : 'Choose reference systems below to compose the experience.';

  nodes.recipeFlow.replaceChildren();
  if (recipe.referenceIds.length === 0) {
    nodes.recipeFlow.appendChild(createTextElement('span', 'Workbench empty · choose one or more reference systems', 'empty-recipe'));
  } else {
    recipe.referenceIds.forEach((referenceId, index) => {
      if (index > 0) nodes.recipeFlow.appendChild(createTextElement('span', '→', 'recipe-arrow'));
      nodes.recipeFlow.appendChild(createTextElement('span', getStarfieldVrReference(referenceId).title, 'recipe-node'));
    });
  }
  appendTextList(nodes.recipeTests, recipe.acceptanceTests.slice(0, 6));
}

function buildRecipeBrief() {
  const recipe = buildStarfieldVrRecipe([...state.selectedReferenceIds]);
  const selected = recipe.referenceIds.map((id) => getStarfieldVrReference(id));
  return [
    `STARFIELD VR REFERENCE LAB · ${STARFIELD_VR_RECOMMENDED_RECIPE.title}`,
    '',
    `Outcome: ${STARFIELD_VR_RECOMMENDED_RECIPE.outcome}`,
    '',
    'Selected references:',
    ...selected.map((reference) => `- ${reference.title}: ${reference.contribution}`),
    '',
    'Programme gates:',
    ...STARFIELD_VR_RECOMMENDED_RECIPE.gates.map((gate) => `- ${gate}`),
    '',
    'Evidence boundary:',
    STARFIELD_VR_EVIDENCE_BOUNDARY.summary,
  ].join('\n');
}

async function copyRecipeBrief() {
  if (!navigator.clipboard?.writeText) {
    nodes.copyStatus.textContent = 'Clipboard unavailable in this browser context.';
    return;
  }
  try {
    await navigator.clipboard.writeText(buildRecipeBrief());
    nodes.copyStatus.textContent = 'Build brief copied.';
    nodes.copyRecipe.textContent = 'Copied ✓';
    window.setTimeout(() => { nodes.copyRecipe.textContent = 'Copy build brief'; }, 1800);
  } catch {
    nodes.copyStatus.textContent = 'Copy failed. The workbench remains unchanged.';
  }
}

nodes.loadRecipe.addEventListener('click', () => {
  state.selectedReferenceIds = new Set(STARFIELD_VR_RECOMMENDED_RECIPE.referenceIds);
  nodes.copyStatus.textContent = '';
  renderAtlas();
  renderReferenceDetail();
  renderRecipe();
});

nodes.clearRecipe.addEventListener('click', () => {
  state.selectedReferenceIds.clear();
  nodes.copyStatus.textContent = '';
  renderAtlas();
  renderReferenceDetail();
  renderRecipe();
});

nodes.copyRecipe.addEventListener('click', copyRecipeBrief);

renderTruthBoundary();
renderFilters();
renderAtlas();
renderReferenceDetail();
renderRecipe();
