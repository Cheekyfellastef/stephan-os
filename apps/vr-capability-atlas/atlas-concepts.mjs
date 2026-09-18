export const CONCEPT_LIMIT = 10;

export const CONCEPT_CATALOG = [
  {
    id: 'spatial-bridge',
    title: 'Spatial Bridge mission control',
    description: 'A seated command deck where spatial controls, mission telemetry and an AI copilot share one persistent Stephanos workspace.',
    alt: 'First-person spatial mission-control cockpit overlooking a ringed world, with holographic navigation and an AI copilot.',
    tags: ['spatial bridge', 'mission', 'workspace', 'telemetry', 'openxr', 'quest', 'copilot', 'command'],
  },
  {
    id: 'embodied-exploration',
    title: 'Embodied alien-world exploration',
    description: 'Tracked hands, environmental scanning, route planning and companion intelligence turn research into a world that can be explored directly.',
    alt: 'First-person gloved hands examining luminous alien plants with a survey drone and ancient structures in the distance.',
    tags: ['embodiment', 'exploration', 'hand', 'world', 'companion', 'route', 'quest', 'openxr', 'scanning'],
  },
  {
    id: 'immersive-engineering',
    title: 'Immersive engineering bay',
    description: 'Manipulate a life-size assembly while simulation, authoring and diagnostic evidence remain visible in three-dimensional context.',
    alt: 'First-person tracked hands assembling a full-scale spacecraft propulsion module surrounded by spatial engineering diagnostics.',
    tags: ['engineering', 'authoring', 'simulation', 'tool', 'build', 'physics', 'hand', 'spatial', 'creation kit'],
  },
  {
    id: 'spatial-collaboration',
    title: 'Collaborative spatial mission room',
    description: 'Remote participants, AI assistance, live task state and a shared strategy surface occupy one persistent operational space.',
    alt: 'A diverse remote team and an AI presence collaborating around a holographic planetary strategy table.',
    tags: ['collaboration', 'workspace', 'shared', 'mission', 'dialogue', 'ai', 'task', 'spatial', 'remote'],
  },
  {
    id: 'living-starship',
    title: 'Living starship cockpit',
    description: 'A seated exploration cockpit combines reachable controls, crew presence, travel context and a deep starfield without losing comfort.',
    alt: 'First-person starship cockpit with reachable controls, a crew companion and a destination planet beyond the canopy.',
    tags: ['starfield', 'cockpit', 'seated', 'ship', 'crew', 'dialogue', 'camera', 'comfort', 'quest'],
  },
  {
    id: 'physical-interaction',
    title: 'Embodied hands and physical interaction',
    description: 'Pose contracts, calibration and physics become tangible grabbing, tool use and believable object weight.',
    alt: 'Tracked hands opening and repairing a detailed mechanical object in a spatial interaction laboratory.',
    tags: ['hand', 'hands', 'interaction', 'physics', 'grabbing', 'body', 'tracked', 'weapons', 'higgs', 'planck', 'vrik'],
  },
  {
    id: 'adaptive-dialogue',
    title: 'Adaptive dialogue and companion presence',
    description: 'Conversation presentation adapts to camera ownership, comfort and intent while preserving believable human-scale presence.',
    alt: 'Comfortable first-person conversation with a crew companion on an orbital observation deck.',
    tags: ['dialogue', 'companion', 'camera', 'comfort', 'conversation', 'cinematic', 'ai', 'crew', 'adaptive'],
  },
  {
    id: 'cinematic-theatre',
    title: 'Room-fixed 3D cinematic theatre',
    description: 'Authored cinematics retain framing on a room-fixed stereo screen while the viewer keeps comfortable head movement.',
    alt: 'A room-fixed widescreen three-dimensional cinema surface inside a dark spatial observation lounge.',
    tags: ['cinematic', 'theatre', 'stereo', 'camera', 'comfort', 'room fixed', 'halo', 'cutscene', '6dof'],
  },
  {
    id: 'flat-to-vr-lab',
    title: 'Flat-to-VR conversion laboratory',
    description: 'Stereo, depth, camera, input and comfort stages expose which conversion route is strongest and where proof is still missing.',
    alt: 'A flat game scene passing through stereo reconstruction and spatial-computing stages into an immersive world.',
    tags: ['conversion', 'stereo', 'depth', 'camera', 'uevr', 'vorpx', 'reconstruction', 'runtime', 'openxr', 'flat'],
  },
  {
    id: 'capability-factory',
    title: 'Reusable VR capability factory',
    description: 'Evidence, open standards, methods and acceptance gates become reusable modules instead of disappearing into one-off experiments.',
    alt: 'A large spatial laboratory where evidence and proof modules feed several distinct immersive world portals.',
    tags: ['capability', 'method', 'evidence', 'proof', 'factory', 'openxr', 'source', 'test', 'reusable', 'graph'],
  },
].map((concept, catalogIndex) => ({
  ...concept,
  catalogIndex,
  assets: {
    thumb: `./concepts/thumb/${concept.id}.jpg.b64.txt`,
    panel: `./concepts/panel/${concept.id}.jpg.b64.txt`,
    hero: `./concepts/hero/${concept.id}.jpg.b64.txt`,
  },
}));

const normalise = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function tagMatches(tag, text, tokens) {
  const phrase = normalise(tag);
  if (!phrase) return false;
  if (text.includes(phrase)) return true;
  return phrase.split(' ').every((token) => tokens.has(token));
}

export function rankConcepts(catalog, researchItems, limit = CONCEPT_LIMIT) {
  const items = (Array.isArray(researchItems) ? researchItems : []).map((item) => {
    const text = normalise(item?.text);
    return {
      name: String(item?.name || 'Canonical research'),
      text,
      tokens: new Set(text.split(' ').filter(Boolean)),
      weight: Math.max(1, Number(item?.weight) || 1),
    };
  });

  const ranked = catalog.map((concept) => {
    let score = 0;
    const hits = [];
    for (const item of items) {
      const matched = concept.tags.filter((tag) => tagMatches(tag, item.text, item.tokens));
      if (!matched.length) continue;
      score += Math.min(5, matched.length) * item.weight;
      hits.push(item.name);
    }
    return { ...concept, score, hits: [...new Set(hits)].slice(0, 5) };
  }).sort((a, b) => b.score - a.score || a.catalogIndex - b.catalogIndex);

  const top = ranked.slice(0, Math.max(1, limit));
  const maximum = Math.max(1, ...top.map((concept) => concept.score));
  return top.map((concept, rankIndex) => ({
    ...concept,
    rank: rankIndex + 1,
    fit: concept.score ? Math.max(1, Math.round((concept.score / maximum) * 100)) : 0,
  }));
}

export function chooseSelectedConceptId(ranked, previousId, preserveUserSelection) {
  if (preserveUserSelection && ranked.some((concept) => concept.id === previousId)) return previousId;
  return ranked[0]?.id || '';
}
