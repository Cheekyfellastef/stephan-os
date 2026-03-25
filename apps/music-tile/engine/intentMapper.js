const BPM_BY_ERA = {
  'cream-courtyard': [132, 140],
  'uplifting-trance': [134, 142],
  'progressive-bridge': [124, 132],
  'afterlife-modern': [120, 128]
};

const CURVE_TRANSITIONS = {
  flat: 'Long blend, low contrast',
  rising: 'Incremental lift every track',
  peaks: 'Escalate then release in final third'
};

const ERA_VISUAL_THEMES = {
  'cream-courtyard': 'Warm haze / club energy',
  'uplifting-trance': 'Skyline lift / bright pulse',
  'progressive-bridge': 'Midnight gradient / smooth drift',
  'afterlife-modern': 'Cinematic black-blue minimal'
};

function buildRecommendedTags(selection) {
  return [
    selection.era,
    selection.energyCurve,
    selection.emotion,
    selection.density,
    `${selection.era}:${selection.emotion}`,
    `${selection.energyCurve}:${selection.density}`
  ];
}

export function mapSelectionToIntent(selection) {
  const bpmRange = BPM_BY_ERA[selection.era] || [122, 130];

  return {
    era: selection.era,
    energyCurve: selection.energyCurve,
    emotion: selection.emotion,
    density: selection.density,
    bpmRange,
    transitionStyle: CURVE_TRANSITIONS[selection.energyCurve] || CURVE_TRANSITIONS.flat,
    visualTheme: ERA_VISUAL_THEMES[selection.era] || ERA_VISUAL_THEMES['afterlife-modern'],
    recommendedTags: buildRecommendedTags(selection)
  };
}

export function describeIntentVibe(intent) {
  return `${intent.emotion} ${intent.energyCurve} journey from ${intent.era}`;
}
