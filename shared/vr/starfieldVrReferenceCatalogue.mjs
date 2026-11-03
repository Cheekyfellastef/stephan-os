export const STARFIELD_VR_REFERENCE_CATALOGUE_SCHEMA = 'stephanos.starfield-vr-reference-catalogue.v1';

const MAX_RECIPE_REFERENCE_IDS = 64;
const SAFE_REFERENCE_ID = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/;

function deepFreezeOwned(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      deepFreezeOwned(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function snapshotRecipeReferenceIds(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) return null;
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')) return null;
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RECIPE_REFERENCE_IDS) return null;
    if (keys.length !== length + 1) return null;

    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value')) return null;
      if (typeof descriptor.value !== 'string' || !SAFE_REFERENCE_ID.test(descriptor.value)) return null;
      output.push(descriptor.value);
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function buildRecipeResult(references, status) {
  return deepFreezeOwned({
    schema: STARFIELD_VR_REFERENCE_CATALOGUE_SCHEMA,
    recipeId: STARFIELD_VR_RECOMMENDED_RECIPE.id,
    status,
    referenceIds: references.map((entry) => entry.id),
    capabilityLine: references.map((entry) => entry.strapline.replace(/ reference$/i, '')).join(' + '),
    acceptanceTests: [...new Set(references.flatMap((entry) => entry.acceptanceTests))],
    evidenceBoundary: STARFIELD_VR_EVIDENCE_BOUNDARY,
  });
}

export const STARFIELD_VR_EVIDENCE_BOUNDARY = deepFreezeOwned({
  authority: 'reference-only',
  summary: 'Design references do not prove implementation, compatibility, performance, comfort, or permission to reuse code or assets.',
  requiredPromotionEvidence: [
    'exact installed Starfield and tool identities',
    'licence-compatible implementation provenance',
    'repeatable Battle Bridge test result',
    'Quest 3 headset acceptance result',
    'rollback evidence against the stable Starfield VR baseline',
  ],
});

export const STARFIELD_VR_REFERENCE_DOMAINS = deepFreezeOwned([
  { id: 'foundation', label: 'Foundation' },
  { id: 'embodiment', label: 'Body & hands' },
  { id: 'interaction', label: 'Interaction' },
  { id: 'combat', label: 'Combat' },
  { id: 'locomotion', label: 'Movement' },
  { id: 'cockpit', label: 'Ships & cockpit' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'atmosphere', label: 'Atmosphere' },
]);

export const STARFIELD_VR_REFERENCES = deepFreezeOwned([
  {
    id: 'starfield-creation-engine-2',
    title: 'Starfield + Creation Kit',
    strapline: 'The universe and supported authoring foundation',
    domains: ['foundation', 'cockpit'],
    contribution: 'Ships, settlements, companions, quests, zero gravity, planets, records and the Creation Engine 2 authoring surface.',
    attachPoints: ['Creation Kit records and Papyrus scripts', 'player camera and input', 'ship and cockpit systems', 'zero-gravity gameplay', 'scanner, inventory and workbenches'],
    acceptanceTests: ['Exact installed game and editor versions are recorded.', 'A change remains removable and save-safe.', 'The authored layer and runtime-hook layer are reported separately.'],
    evidenceClass: 'official-authoring-and-runtime-target',
    reusePosture: 'Proprietary foundation. Use official tools, metadata and independently authored mods; never ingest Bethesda assets or binaries.',
    localReferences: ['VR-Research-Lab/knowledge-sources/starfield-creation-kit/source-manifest.json'],
    sources: [
      { label: 'Bethesda Starfield Creation Kit documentation', url: 'https://wiki.bethesda.net/wiki/Starfield/', type: 'official-documentation' },
      { label: 'Bethesda Creation Kit availability', url: 'https://help.bethesda.net/app/answers/detail/a_id/65849/~/where-do-i-get-the-creation-kit-for-starfield', type: 'official-support' },
    ],
  },
  {
    id: 'mutar-starfield2vr',
    title: 'Mutar / NoMoreFlat starfield2vr',
    strapline: 'The current open Starfield VR implementation baseline',
    domains: ['foundation', 'embodiment', 'locomotion'],
    contribution: 'Existing Starfield-specific 6DoF, room-scale, HUD, input, haptics, OpenXR and OpenVR implementation evidence.',
    attachPoints: ['REFramework Starfield adapter', 'OpenXR/OpenVR bridge', 'HUD and world-scale configuration', 'controller translation and haptics'],
    acceptanceTests: ['Pinned source and release hashes match the admitted package.', 'The installed Starfield build is explicitly compatible.', 'Stereo, head tracking and save/load pass before any evolution layer is enabled.'],
    evidenceClass: 'open-implementation-source',
    reusePosture: 'MIT at the pinned registered snapshot; retain attribution and re-check the exact revision before reuse.',
    localReferences: ['VR-Research-Lab/knowledge-sources/mutar-nomoreflat/source-manifest.json'],
    sources: [
      { label: 'mutars/starfield2vr', url: 'https://github.com/mutars/starfield2vr', type: 'source-code' },
    ],
  },
  {
    id: 'skyrim-vr-physical-presence',
    title: 'Skyrim VR + VRIK / HIGGS / PLANCK',
    strapline: 'Embodied open-world parity benchmark',
    domains: ['embodiment', 'interaction', 'combat', 'inventory'],
    contribution: 'Visible body, calibrated hands, holsters, grabbing, collision, two-handed interaction and physics-aware character presence.',
    attachPoints: ['Starfield player skeleton and first-person camera', 'weapon equip and quick slots', 'world-object activation', 'character collision and melee'],
    acceptanceTests: ['Hands, body and held items remain aligned while seated and standing.', 'Holster retrieval is repeatable without opening a flat menu.', 'Physical contact never destabilises locomotion or quest interactions.'],
    evidenceClass: 'native-vr-parity-benchmark',
    reusePosture: 'Behavioural benchmark. Reuse only specifically licensed open components; preserve creator attribution and mod-specific terms.',
    localReferences: ['VR-Research-Lab/knowledge-sources/skyrim-vr-ecosystem/source-manifest.json'],
    sources: [
      { label: 'Skyrim VR on Steam', url: 'https://store.steampowered.com/app/611670/', type: 'official-store' },
      { label: 'HIGGS source', url: 'https://github.com/adamhynek/higgs', type: 'source-code' },
      { label: 'VRIK', url: 'https://www.nexusmods.com/skyrimspecialedition/mods/23416', type: 'creator-distribution' },
      { label: 'PLANCK', url: 'https://www.nexusmods.com/skyrimspecialedition/mods/66025', type: 'creator-distribution' },
    ],
  },
  {
    id: 'fallout-4-vr-systems',
    title: 'Fallout 4 VR',
    strapline: 'Creation Engine firearm and utility reference',
    domains: ['combat', 'inventory', 'interaction'],
    contribution: 'VR-adapted firearms, V.A.T.S., crafting, building and large-world interaction on Bethesda technology.',
    attachPoints: ['Starfield weapon handling and aiming', 'scanner and wrist utility concepts', 'looting and container flow', 'crafting and outpost interfaces'],
    acceptanceTests: ['Aiming and recoil remain comfortable and legible.', 'Looting and crafting require fewer flat-screen interruptions.', 'Combat input does not conflict with ship, scanner or menu controls.'],
    evidenceClass: 'native-vr-design-reference',
    reusePosture: 'Proprietary behavioural reference only; do not copy game code or assets.',
    localReferences: [],
    sources: [
      { label: 'Bethesda Fallout 4 VR', url: 'https://fallout.bethesda.net/games/fallout-vr', type: 'official-product' },
      { label: 'Bethesda Fallout 4 VR details', url: 'https://bethesda.net/en/article/22mwHwomScI8Ioo4ywm2Wc/fallout-4-vr-new-details-revealed', type: 'official-design-notes' },
    ],
  },
  {
    id: 'half-life-alyx-interaction',
    title: 'Half-Life: Alyx',
    strapline: 'Gold-standard hand and object interaction reference',
    domains: ['interaction', 'embodiment', 'atmosphere'],
    contribution: 'Readable hands, precise object handling, distance grabbing, dense environmental storytelling and interaction-first level detail.',
    attachPoints: ['Starfield object activation and pickup', 'door, drawer and control interactions', 'ship and habitat prop density', 'tutorial and affordance language'],
    acceptanceTests: ['Interactive objects advertise their affordance without a tutorial wall.', 'Pickup, use and release feel predictable at arm and distance range.', 'Hands never clip through the primary hero interaction set.'],
    evidenceClass: 'native-vr-design-reference',
    reusePosture: 'Proprietary behavioural reference only; use public developer commentary and independently authored observations.',
    localReferences: [],
    sources: [
      { label: 'Half-Life: Alyx on Steam', url: 'https://store.steampowered.com/app/546560/HalfLife_Alyx/', type: 'official-store' },
      { label: 'Half-Life: Alyx Workshop Tools', url: 'https://developer.valvesoftware.com/wiki/Half-Life:_Alyx_Workshop_Tools', type: 'official-tool-documentation' },
    ],
  },
  {
    id: 'echo-zero-g',
    title: 'Lone Echo / Echo VR',
    strapline: 'Natural zero-gravity movement reference',
    domains: ['locomotion', 'embodiment'],
    contribution: 'Hand-led push, pull and grab locomotion with bounded thrusters and strong spatial body awareness.',
    attachPoints: ['Starfield zero-gravity movement', 'ship handholds and traversal rails', 'EVA training and comfort assists'],
    acceptanceTests: ['A player can stop, turn and recover orientation without nausea-inducing acceleration.', 'Grab-and-push movement works on an authored handhold set.', 'Seated gamepad fallback remains available and explicit.'],
    evidenceClass: 'native-vr-design-reference',
    reusePosture: 'Proprietary behavioural reference only; Echo VR service status does not affect its value as a locomotion benchmark.',
    localReferences: [],
    sources: [
      { label: 'Meta Echo VR zero-gravity overview', url: 'https://www.meta.com/blog/suit-up-for-zero-gravity-battles-in-echo-vr-now-available-on-oculus-quest/', type: 'official-design-overview' },
      { label: 'Meta Lone Echo II', url: 'https://www.meta.com/experiences/pcvr/lone-echo-ii/1711938725528735/', type: 'official-product' },
    ],
  },
  {
    id: 'no-mans-sky-vr-exploration',
    title: 'No Man\'s Sky VR',
    strapline: 'Whole-universe VR continuity reference',
    domains: ['cockpit', 'locomotion', 'interaction'],
    contribution: 'A complete exploration loop spanning planets, vehicles, bases, inventories and space flight within one VR mode.',
    attachPoints: ['planet-to-ship experience continuity', 'approachable virtual ship controls', 'scanner and discovery feedback', 'base and freighter interaction'],
    acceptanceTests: ['Entering, piloting and leaving a ship preserves scale and control continuity.', 'Discovery feedback is readable without dominating the view.', 'The same comfort profile applies across walking, flight and vehicles.'],
    evidenceClass: 'native-vr-design-reference',
    reusePosture: 'Proprietary behavioural reference only; do not copy code, assets or interface artwork.',
    localReferences: [],
    sources: [
      { label: 'No Man\'s Sky official site', url: 'https://www.nomanssky.com/', type: 'official-product' },
      { label: 'Hello Games VR announcement', url: 'https://hellogames.org/2022/06/07/no-mans-sky-announced-for-playstation-vr2-in-sonys-state-of-play/', type: 'official-development-note' },
    ],
  },
  {
    id: 'elite-dangerous-cockpit',
    title: 'Elite Dangerous',
    strapline: 'Cockpit presence and space-scale reference',
    domains: ['cockpit', 'atmosphere'],
    contribution: 'Convincing seated cockpit scale, instrumentation, head-look information hierarchy and the feeling of piloting a massive vessel.',
    attachPoints: ['Starfield pilot seat and ship bridge', 'instrument depth and information zones', 'space scale, audio and canopy framing'],
    acceptanceTests: ['Essential flight state is readable by head movement, not flat overlays alone.', 'Cockpit scale remains believable across ship classes.', 'The seated Quest 3 posture is comfortable for a 60-minute flight session.'],
    evidenceClass: 'native-vr-design-reference',
    reusePosture: 'Proprietary behavioural reference only; any community overlay must be assessed separately for licence and compatibility.',
    localReferences: [],
    sources: [
      { label: 'Elite Dangerous on Steam', url: 'https://store.steampowered.com/app/359320/Elite_Dangerous/', type: 'official-store' },
      { label: 'Open-source Elite VR Cockpit', url: 'https://github.com/dantman/elite-vr-cockpit', type: 'source-code-reference' },
    ],
  },
  {
    id: 'into-the-radius-loadout',
    title: 'Into the Radius',
    strapline: 'Physical inventory and equipment discipline reference',
    domains: ['inventory', 'combat', 'interaction'],
    contribution: 'Manual backpack organisation, body slots, magazines, tools, weapon maintenance and deliberate preparation.',
    attachPoints: ['Starfield favourites and quick slots', 'suit, weapon and aid inventory', 'ship locker and expedition preparation'],
    acceptanceTests: ['Critical equipment is reachable by muscle memory.', 'Inventory remains usable seated without floor-level reach.', 'Physical handling adds meaning without turning routine looting into labour.'],
    evidenceClass: 'native-vr-design-reference',
    reusePosture: 'Proprietary behavioural reference only; use official descriptions and independently authored parity tests.',
    localReferences: [],
    sources: [
      { label: 'CM Games Into the Radius', url: 'https://www.cm-immersive.com/', type: 'official-product' },
    ],
  },
  {
    id: 'blade-and-sorcery-physics',
    title: 'Blade & Sorcery',
    strapline: 'Physics-driven bodily combat reference',
    domains: ['combat', 'embodiment', 'interaction'],
    contribution: 'Weight-aware weapons, fine collision, full-body opponents and physical melee that responds to momentum and contact.',
    attachPoints: ['Starfield melee weapons', 'enemy hit reactions and ragdolls', 'world-object combat interactions'],
    acceptanceTests: ['Weapon contact, weight and reach are coherent at normal motion speed.', 'Melee cannot launch bodies or props into unstable simulation states.', 'Combat remains performant in the chosen hero encounter.'],
    evidenceClass: 'native-vr-design-reference',
    reusePosture: 'Proprietary behavioural reference only; do not copy code, assets or animation data.',
    localReferences: [],
    sources: [
      { label: 'Blade & Sorcery on Steam', url: 'https://store.steampowered.com/app/629730/Blade_and_Sorcery/', type: 'official-store' },
    ],
  },
  {
    id: 'cyberpunk-visual-language',
    title: 'Cyberpunk 2077 visual language',
    strapline: 'Lighting, atmosphere and information-density reference',
    domains: ['atmosphere', 'cockpit'],
    contribution: 'Layered cinematic lighting, readable colour hierarchy, environmental density and a city that feels technologically alive.',
    attachPoints: ['Stephanos bridge and hero ship lighting', 'settlement identity and signage', 'diegetic displays and mission-state colour'],
    acceptanceTests: ['Lighting supports navigation and state, not decoration alone.', 'Text and controls remain readable against emissive surfaces in-headset.', 'The hero space holds frame-time budget in its worst lighting case.'],
    evidenceClass: 'flat-screen-visual-reference',
    reusePosture: 'Proprietary visual-principles reference only. Build an original Starfield/Stephanos language; do not copy art, assets or interface designs.',
    localReferences: [],
    sources: [
      { label: 'GDC: Lighting Cyberpunk 2077', url: 'https://www.gdcvault.com/play/1027959/Advanced-Graphics-Summit-Cyberpunk-2077', type: 'developer-technical-talk' },
      { label: 'ACM: Area Light Sources in Cyberpunk 2077', url: 'https://dl.acm.org/doi/fullHtml/10.1145/3450623.3464630', type: 'developer-technical-paper' },
    ],
  },
]);

export const STARFIELD_VR_RECOMMENDED_RECIPE = deepFreezeOwned({
  id: 'living-starship-vertical-slice-v1',
  title: 'Living Starship vertical slice',
  outcome: 'One extraordinary, comfortable and reversible hero ship that proves embodied presence, physical interaction, zero-G movement, readable cockpit systems and Stephanos atmosphere.',
  referenceIds: [
    'starfield-creation-engine-2',
    'mutar-starfield2vr',
    'skyrim-vr-physical-presence',
    'half-life-alyx-interaction',
    'echo-zero-g',
    'elite-dangerous-cockpit',
    'cyberpunk-visual-language',
  ],
  gates: [
    'Stable Starfield VR baseline passes before the Evolution layer loads.',
    'Every feature is separately switchable and removable.',
    'No proprietary reference code or assets are copied.',
    'Quest 3 over Meta Link supplies comfort, performance and interaction proof.',
    'A failed experiment rolls back without damaging saves or the baseline launcher.',
  ],
});

export function getStarfieldVrReference(referenceId) {
  return STARFIELD_VR_REFERENCES.find((entry) => entry.id === referenceId) || null;
}

export function filterStarfieldVrReferences(domain = 'all') {
  if (!domain || domain === 'all') return Object.freeze([...STARFIELD_VR_REFERENCES]);
  return Object.freeze(STARFIELD_VR_REFERENCES.filter((entry) => entry.domains.includes(domain)));
}

export function buildStarfieldVrRecipe(referenceIds = STARFIELD_VR_RECOMMENDED_RECIPE.referenceIds) {
  const safeReferenceIds = snapshotRecipeReferenceIds(referenceIds);
  if (!safeReferenceIds) return buildRecipeResult([], 'INVALID_INPUT');

  const seen = new Set();
  const references = [];
  for (const referenceId of safeReferenceIds) {
    if (seen.has(referenceId)) continue;
    seen.add(referenceId);
    const reference = getStarfieldVrReference(referenceId);
    if (reference) references.push(reference);
  }

  return buildRecipeResult(references, references.length > 0 ? 'READY' : 'EMPTY');
}

export function validateStarfieldVrReferenceCatalogue() {
  const issues = [];
  const ids = new Set();
  const domainIds = new Set(STARFIELD_VR_REFERENCE_DOMAINS.map((entry) => entry.id));

  for (const reference of STARFIELD_VR_REFERENCES) {
    if (!reference.id || ids.has(reference.id)) issues.push(`invalid-or-duplicate-id:${reference.id || 'missing'}`);
    ids.add(reference.id);
    if (!reference.title || !reference.contribution) issues.push(`missing-copy:${reference.id}`);
    if (!Array.isArray(reference.domains) || reference.domains.length === 0) issues.push(`missing-domains:${reference.id}`);
    for (const domain of reference.domains || []) {
      if (!domainIds.has(domain)) issues.push(`unknown-domain:${reference.id}:${domain}`);
    }
    if (!Array.isArray(reference.attachPoints) || reference.attachPoints.length === 0) issues.push(`missing-attach-points:${reference.id}`);
    if (!Array.isArray(reference.acceptanceTests) || reference.acceptanceTests.length === 0) issues.push(`missing-acceptance-tests:${reference.id}`);
    if (!Array.isArray(reference.localReferences)) issues.push(`invalid-local-references:${reference.id}`);
    for (const localReference of reference.localReferences || []) {
      if (typeof localReference !== 'string' || !localReference || localReference.startsWith('/') || localReference.includes('..') || localReference.includes('://')) {
        issues.push(`invalid-local-reference:${reference.id}`);
      }
    }
    if (!Array.isArray(reference.sources) || reference.sources.length === 0) issues.push(`missing-sources:${reference.id}`);
    for (const source of reference.sources || []) {
      if (!source.label || !/^https:\/\//.test(source.url || '')) issues.push(`invalid-source:${reference.id}`);
    }
    if (!reference.reusePosture) issues.push(`missing-reuse-posture:${reference.id}`);
  }

  for (const referenceId of STARFIELD_VR_RECOMMENDED_RECIPE.referenceIds) {
    if (!ids.has(referenceId)) issues.push(`unknown-recipe-reference:${referenceId}`);
  }

  return deepFreezeOwned({ ok: issues.length === 0, issues });
}
