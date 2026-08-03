#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const mainPath = 'apps/music-tile/main.js';
const nativePath = 'apps/music-tile/engine/nativeCatalogSearch.js';
const testPath = 'tests/music-tile-native-catalog-ui.test.mjs';

function replaceExactly(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: expected source block not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: expected source block is not unique`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

let nativeSource = await readFile(nativePath, 'utf8');
if (!nativeSource.includes("mergeCatalogResultIntoExistingTrack")) {
  nativeSource = replaceExactly(
    nativeSource,
    "const MAX_QUERY_LENGTH = 160;",
    "import { resolveSpotifyReference } from '../utils/spotifyEmbed.js';\n\nconst MAX_QUERY_LENGTH = 160;",
    'native import',
  );

  const helper = `export function mergeCatalogResultIntoExistingTrack(existing, result = {}) {\n  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {\n    return { ok: false, changed: false, reason: 'existing-track-required' };\n  }\n  const catalogTrack = catalogResultToMusicTileTrack(result);\n  if (catalogTrack.catalogVerificationStatus !== 'metadata_verified') {\n    return { ok: false, changed: false, reason: 'catalogue-metadata-not-verified' };\n  }\n  const incomingSpotify = resolveSpotifyReference(catalogTrack.spotifyUrl || catalogTrack.spotifyUri || '');\n  if (!incomingSpotify.valid || incomingSpotify.type !== 'track') {\n    return { ok: false, changed: false, reason: 'spotify-track-unavailable' };\n  }\n  const currentSpotify = resolveSpotifyReference(existing.spotifyUrl || existing.spotifyUri || '');\n  if (currentSpotify.valid && currentSpotify.type === 'track' && currentSpotify.uri !== incomingSpotify.uri) {\n    return { ok: false, changed: false, reason: 'spotify-track-conflict' };\n  }\n  const enrichment = {\n    spotifyUrl: incomingSpotify.openUrl,\n    spotifyUri: incomingSpotify.uri,\n    catalogProvider: catalogTrack.catalogProvider,\n    catalogProviderLabel: catalogTrack.catalogProviderLabel,\n    catalogProviderItemId: catalogTrack.catalogProviderItemId,\n    catalogProviderUrl: catalogTrack.catalogProviderUrl,\n    catalogConfidence: catalogTrack.catalogConfidence,\n    catalogVerificationStatus: catalogTrack.catalogVerificationStatus,\n    catalogPlaybackAvailability: catalogTrack.catalogPlaybackAvailability,\n    catalogLinkSource: 'native-catalog-search',\n  };\n  const changed = Object.entries(enrichment).some(([key, value]) => String(existing[key] ?? '') !== String(value ?? ''));\n  Object.assign(existing, enrichment);\n  return { ok: true, changed, spotify: incomingSpotify, track: existing };\n}\n\n`;
  nativeSource = replaceExactly(
    nativeSource,
    'export function findExistingCatalogTrack(list = [], result = {}) {',
    `${helper}export function findExistingCatalogTrack(list = [], result = {}) {`,
    'native merge helper',
  );
  await writeFile(nativePath, nativeSource, 'utf8');
}

let mainSource = await readFile(mainPath, 'utf8');
if (!mainSource.includes('applyNativeCatalogMatchesToListeningRoom')) {
  mainSource = replaceExactly(
    mainSource,
    "import { catalogResultActionKey, catalogResultToMusicTileTrack, findExistingCatalogTrack, requestNativeCatalogSearch } from './engine/nativeCatalogSearch.js';",
    "import { catalogResultActionKey, catalogResultToMusicTileTrack, findExistingCatalogTrack, mergeCatalogResultIntoExistingTrack, requestNativeCatalogSearch } from './engine/nativeCatalogSearch.js';",
    'main import',
  );

  const autoApplyHelper = `function applyNativeCatalogMatchesToListeningRoom(results = []) {\n  const summary = { applied: 0, conflicts: 0 };\n  for (const result of Array.isArray(results) ? results : []) {\n    const existing = findExistingCatalogTrack(state.listeningDeck, result);\n    if (!existing) continue;\n    const merged = mergeCatalogResultIntoExistingTrack(existing, result);\n    if (!merged.ok) {\n      if (merged.reason === 'spotify-track-conflict') summary.conflicts += 1;\n      continue;\n    }\n    if (!merged.changed) continue;\n    state.linkMessages = state.linkMessages || {};\n    state.linkMessages[existing.id] = 'Spotify track URL found by Stephanos and applied automatically.';\n    updateConnectorTargetCard(existing, merged.spotify);\n    summary.applied += 1;\n  }\n  if (summary.applied) saveState();\n  return summary;\n}\n\n`;
  mainSource = replaceExactly(
    mainSource,
    'async function runNativeCatalogSearch(event) {',
    `${autoApplyHelper}async function runNativeCatalogSearch(event) {`,
    'main auto apply helper',
  );

  const stateBlock = `    nativeCatalogSearchState = {\n      query,\n      providerLabel: String(result.providerLabel || ''),\n      results: Array.isArray(result.results) ? result.results : [],\n      error: result.ok ? '' : String(result.error || 'Music search is temporarily unavailable.'),\n    };`;
  const stateBlockAfter = `${stateBlock}\n    const autoApplySummary = result.ok\n      ? applyNativeCatalogMatchesToListeningRoom(nativeCatalogSearchState.results)\n      : { applied: 0, conflicts: 0 };\n    nativeCatalogSearchState.autoAppliedCount = autoApplySummary.applied;\n    nativeCatalogSearchState.autoApplyConflictCount = autoApplySummary.conflicts;`;
  mainSource = replaceExactly(mainSource, stateBlock, stateBlockAfter, 'main search auto apply');

  const existingBlock = `  if (existing) {\n    if (intelligenceUi.nativeSearchStatus) intelligenceUi.nativeSearchStatus.textContent = \`\${existing.artist} — \${existing.title} is already in your Listening Room.\`;\n    return;\n  }`;
  const existingBlockAfter = `  if (existing) {\n    const merged = mergeCatalogResultIntoExistingTrack(existing, result);\n    if (merged.ok && merged.changed) {\n      state.linkMessages = state.linkMessages || {};\n      state.linkMessages[existing.id] = 'Spotify track URL found by Stephanos and applied automatically.';\n      saveState();\n      updateConnectorTargetCard(existing, merged.spotify);\n      if (intelligenceUi.nativeSearchStatus) intelligenceUi.nativeSearchStatus.textContent = \`\${existing.artist} — \${existing.title}: Spotify URL applied automatically.\`;\n    } else if (!merged.ok && merged.reason === 'spotify-track-conflict') {\n      if (intelligenceUi.nativeSearchStatus) intelligenceUi.nativeSearchStatus.textContent = \`\${existing.artist} — \${existing.title}: existing Spotify URL left unchanged because the catalogue returned a different track.\`;\n    } else if (intelligenceUi.nativeSearchStatus) {\n      intelligenceUi.nativeSearchStatus.textContent = \`\${existing.artist} — \${existing.title} is already in your Listening Room.\`;\n    }\n    return;\n  }`;
  mainSource = replaceExactly(mainSource, existingBlock, existingBlockAfter, 'main existing result fallback');

  const statusLine = "  intelligenceUi.nativeSearchStatus.textContent = `${results.length} result${results.length === 1 ? '' : 's'} · ${nativeCatalogSearchState.providerLabel || 'catalogue'} chosen automatically · no personal account access`;";
  const statusAfter = `  const autoAppliedCount = Number(nativeCatalogSearchState.autoAppliedCount || 0);\n  const conflictCount = Number(nativeCatalogSearchState.autoApplyConflictCount || 0);\n  const autoAppliedLabel = autoAppliedCount ? \` · \${autoAppliedCount} existing song card\${autoAppliedCount === 1 ? '' : 's'} updated automatically\` : '';\n  const conflictLabel = conflictCount ? \` · \${conflictCount} conflicting Spotify link\${conflictCount === 1 ? '' : 's'} left unchanged\` : '';\n  intelligenceUi.nativeSearchStatus.textContent = \`\${results.length} result\${results.length === 1 ? '' : 's'} · \${nativeCatalogSearchState.providerLabel || 'catalogue'} chosen automatically · no personal account access\${autoAppliedLabel}\${conflictLabel}\`;`;
  mainSource = replaceExactly(mainSource, statusLine, statusAfter, 'main search status');

  mainSource = replaceExactly(
    mainSource,
    "const hasValidatedCatalogLink = track.sourceKind === 'native-catalog' && track.catalogVerificationStatus === 'metadata_verified';",
    "const hasValidatedCatalogLink = (track.sourceKind === 'native-catalog' || track.catalogLinkSource === 'native-catalog-search') && track.catalogVerificationStatus === 'metadata_verified';",
    'main persistent catalog link truth',
  );
  await writeFile(mainPath, mainSource, 'utf8');
}

let testSource = await readFile(testPath, 'utf8');
if (!testSource.includes('existing Listening Room tracks receive verified Spotify URLs automatically')) {
  testSource = replaceExactly(
    testSource,
    '  findExistingCatalogTrack,\n  requestNativeCatalogSearch,',
    '  findExistingCatalogTrack,\n  mergeCatalogResultIntoExistingTrack,\n  requestNativeCatalogSearch,',
    'test import',
  );

  const testBlock = `\ntest('existing Listening Room tracks receive verified Spotify URLs automatically', () => {\n  const existing = { id: 'journey-track', title: 'Track', artist: 'Artist', sourceKind: 'journey-candidate' };\n  const result = {\n    universalId: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',\n    provider: 'spotify',\n    providerItemId: '4uLU6hMCjMI75M1A2tKUQC',\n    providerLabel: 'Spotify',\n    title: 'Track',\n    artist: 'Artist',\n    spotifyUrl: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',\n    spotifyUri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',\n    verificationStatus: 'metadata_verified',\n    playbackAvailability: 'playback_unverified',\n  };\n  const merged = mergeCatalogResultIntoExistingTrack(existing, result);\n  assert.equal(merged.ok, true);\n  assert.equal(merged.changed, true);\n  assert.equal(existing.id, 'journey-track');\n  assert.equal(existing.sourceKind, 'journey-candidate');\n  assert.equal(existing.spotifyUrl, result.spotifyUrl);\n  assert.equal(existing.spotifyUri, result.spotifyUri);\n  assert.equal(existing.catalogLinkSource, 'native-catalog-search');\n  assert.equal(existing.catalogVerificationStatus, 'metadata_verified');\n  assert.equal(mergeCatalogResultIntoExistingTrack(existing, result).changed, false);\n\n  const conflicting = { ...existing, spotifyUrl: 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b', spotifyUri: 'spotify:track:0VjIjW4GlUZAMYd2vXMi3b' };\n  const blocked = mergeCatalogResultIntoExistingTrack(conflicting, result);\n  assert.equal(blocked.ok, false);\n  assert.equal(blocked.reason, 'spotify-track-conflict');\n  assert.equal(conflicting.spotifyUri, 'spotify:track:0VjIjW4GlUZAMYd2vXMi3b');\n});\n\ntest('native search auto-applies verified Spotify URLs before duplicate controls are disabled', () => {\n  assert.match(main, /applyNativeCatalogMatchesToListeningRoom\(nativeCatalogSearchState\.results\)/);\n  assert.match(main, /updateConnectorTargetCard\(existing, merged\.spotify\)/);\n  assert.match(main, /existing song card\\\$\\\{autoAppliedCount === 1 \? '' : 's'\\\} updated automatically/);\n  assert.match(main, /track\.catalogLinkSource === 'native-catalog-search'/);\n});\n`;
  testSource += testBlock;
  await writeFile(testPath, testSource, 'utf8');
}

console.log('MUSIC_TILE_AUTO_SPOTIFY_URL_FIX_APPLIED');
