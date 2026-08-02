import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyTasteTeachingContribution,
  buildConversationAiPayload,
  buildMusicConversationPlan,
  classifyMusicConversationIntent,
  deriveTasteTeachingCandidate,
  normalizeMusicConversationMessage,
  removeTasteTeachingContribution,
  retainConversationTeachingHistory,
  summarizeTasteEvidence,
} from '../apps/music-tile/engine/musicConversationPlanner.js';

const html = await readFile(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('conversation planner classifies supported intents deterministically', () => {
  assert.equal(classifyMusicConversationIntent('Find dark electronic music'), 'discover');
  assert.equal(classifyMusicConversationIntent('Find music like Anyma'), 'discover');
  assert.equal(classifyMusicConversationIntent('More like this, but darker'), 'more-like');
  assert.equal(classifyMusicConversationIntent('Build me a two-hour journey'), 'journey');
  assert.equal(classifyMusicConversationIntent('Why did you choose this?'), 'explain');
  assert.equal(classifyMusicConversationIntent('How is my taste changing?'), 'reflect');
  assert.equal(classifyMusicConversationIntent('Remember that I dislike breathy vocals'), 'teach');
  assert.equal(classifyMusicConversationIntent('Forget this teaching'), 'forget');
});

test('conversation input is normalized and bounded', () => {
  assert.equal(normalizeMusicConversationMessage('  more   like this  '), 'more like this');
  assert.equal(normalizeMusicConversationMessage('x'.repeat(500)).length, 320);
});

test('more-like planning uses the current track only for catalogue search', () => {
  const plan = buildMusicConversationPlan('More like this, but darker and less cheesy', {
    currentTrack: { artist: 'Artist', title: 'Doorway' },
  });
  assert.equal(plan.intent, 'more-like');
  assert.deepEqual(plan.modifiers, ['darker', 'less cheesy']);
  assert.match(plan.searchQuery, /Artist Doorway/);
  assert.equal(plan.mayUseCatalog, true);
  assert.equal(plan.durableMutationRequested, false);
});

test('explicit teaching becomes a pending reversible candidate', () => {
  const candidate = deriveTasteTeachingCandidate('Remember that I dislike breathy vocals.');
  assert.deepEqual(candidate, {
    trait: 'breathy vocals',
    polarity: 'negative',
    weightDelta: 0.8,
    source: 'explicit-conversation',
  });
  const plan = buildMusicConversationPlan('I love complex off-kilter riffs');
  assert.equal(plan.requiresConfirmation, true);
  assert.equal(plan.teachingCandidate.polarity, 'positive');
});

test('AI payload contains operator-owned evidence and excludes catalogue or Spotify data', () => {
  const plan = buildMusicConversationPlan('How is my taste changing?');
  const payload = buildConversationAiPayload(plan, {
    tasteDNA: { 'dark club pressure': { polarity: 'positive', weight: 2 } },
    ratedTrackCount: 4,
    explicitTeachings: [{ trait: 'breathy vocals', polarity: 'negative', status: 'active', spotifyUrl: 'must-not-leak' }],
    currentTrack: { title: 'must-not-leak', catalogProvider: 'spotify' },
  });
  assert.equal(payload.catalogueContentIncluded, false);
  assert.equal(payload.personalSpotifyDataIncluded, false);
  assert.equal(payload.ratingsSummary.ratedTrackCount, 4);
  assert.deepEqual(payload.explicitTeachings, [{ trait: 'breathy vocals', polarity: 'negative', status: 'active' }]);
  assert.doesNotMatch(JSON.stringify(payload), /must-not-leak|spotifyUrl|currentTrack/);
});

test('taste reflection labels its bounded evidence', () => {
  const summary = summarizeTasteEvidence({
    'dark club pressure': { polarity: 'positive', weight: 4 },
    'haunting vocal': { polarity: 'positive', weight: 3 },
    'too cheesy': { polarity: 'negative', weight: 5 },
  }, 7);
  assert.deepEqual(summary.positive, ['dark club pressure', 'haunting vocal']);
  assert.deepEqual(summary.negative, ['too cheesy']);
  assert.equal(summary.ratedTrackCount, 7);
});

test('taste reflection includes signed negative manual weights as avoidance evidence', () => {
  const summary = summarizeTasteEvidence({
    'manual avoidance': { weight: -2, polarity: 'positive' },
    'explicit avoid': { weight: 1.5, polarity: 'negative' },
    'positive signal': { weight: 1, polarity: 'positive' },
  }, 0);
  assert.deepEqual(summary.positive, ['positive signal']);
  assert.deepEqual(summary.negative, ['manual avoidance', 'explicit avoid']);
  assert.equal(summary.evidenceAvailable, true);
});

test('forgetting removes only the selected teaching contribution', () => {
  const teachings = [
    { id: 'first', trait: 'breathy vocals', polarity: 'negative', weightDelta: 0.8, status: 'active', createdAt: '2026-01-01T00:00:00.000Z', previousTrait: null },
    { id: 'second', trait: 'breathy vocals', polarity: 'negative', weightDelta: 0.8, status: 'active', createdAt: '2026-01-02T00:00:00.000Z', previousTrait: { weight: 0.8 } },
  ];
  const result = removeTasteTeachingContribution({
    'breathy vocals': { weight: 2.6, polarity: 'negative', category: 'avoid', contributions: 2 },
  }, teachings[0], teachings, '2026-01-03T00:00:00.000Z');
  assert.equal(result.tasteDNA['breathy vocals'].weight, 1.8);
  assert.equal(result.tasteDNA['breathy vocals'].contributions, 0);
  assert.equal(result.tasteDNA['breathy vocals'].teachingContributions, 1);
  assert.equal(teachings[1].status, 'active');
});

test('opposing teachings retain their own polarity and reproject the active evidence', () => {
  const negative = { id: 'negative', trait: 'breathy vocals', polarity: 'negative', weightDelta: 0.8, status: 'active', createdAt: '2026-01-01T00:00:00.000Z', previousTrait: null };
  const first = applyTasteTeachingContribution({}, negative, [], '2026-01-01T00:00:00.000Z');
  negative.baselineTrait = first.baselineTrait;
  assert.equal(first.record.polarity, 'negative');
  assert.equal(first.record.weight, 0.8);

  const positive = { id: 'positive', trait: 'breathy vocals', polarity: 'positive', weightDelta: 0.6, status: 'active', createdAt: '2026-01-02T00:00:00.000Z', previousTrait: first.record, baselineTrait: first.baselineTrait };
  const second = applyTasteTeachingContribution(first.tasteDNA, positive, [negative], '2026-01-02T00:00:00.000Z');
  assert.equal(second.record.polarity, 'negative');
  assert.equal(second.record.weight, 0.2);

  const removedNegative = removeTasteTeachingContribution(second.tasteDNA, negative, [negative, positive], '2026-01-03T00:00:00.000Z');
  assert.equal(removedNegative.record.polarity, 'positive');
  assert.equal(removedNegative.record.weight, 0.6);
});

test('forgetting preserves independent feedback weight and contribution evidence', () => {
  const teaching = {
    id: 'teaching',
    trait: 'too cheesy',
    polarity: 'negative',
    weightDelta: 0.8,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    previousTrait: null,
    baselineTrait: null,
  };
  const result = removeTasteTeachingContribution({
    'too cheesy': { weight: 1.6, polarity: 'negative', category: 'avoid', contributions: 2 },
  }, teaching, [teaching], '2026-01-02T00:00:00.000Z');

  assert.equal(result.record.polarity, 'negative');
  assert.equal(result.record.weight, 0.8);
  assert.equal(result.record.contributions, 1);
  assert.equal(result.record.teachingContributions, 0);
});

test('forgetting preserves a signed negative manual slider adjustment', () => {
  const teaching = {
    id: 'negative-teaching',
    trait: 'ghost vocals',
    polarity: 'negative',
    weightDelta: 0.8,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    baselineTrait: { weight: 1, polarity: 'positive', category: 'core', contributions: 1 },
  };
  const current = {
    'ghost vocals': { weight: -1, polarity: 'positive', category: 'core', contributions: 1, teachingContributions: 1 },
  };
  const result = removeTasteTeachingContribution(current, teaching, [teaching], '2026-01-02T00:00:00.000Z');
  assert.equal(result.manualAdjustment, -1.2);
  assert.equal(result.record.polarity, 'negative');
  assert.equal(result.record.weight, 0.2);
  assert.equal(result.record.contributions, 1);
});

test('teaching evidence stays separate from rated-track contribution counts', () => {
  const teaching = { id: 'teaching', trait: 'ghost vocals', polarity: 'positive', weightDelta: 0.6, status: 'active' };
  const result = applyTasteTeachingContribution({}, teaching, []);
  assert.equal(result.record.contributions, 0);
  assert.equal(result.record.teachingContributions, 1);
  assert.match(main, /tracks \$\{Number\(meta\.contributions \|\| 0\)\} · teachings \$\{Number\(meta\.teachingContributions \|\| 0\)\}/);
});

test('state retention bounds forgotten history without orphaning active teachings', () => {
  const active = Array.from({ length: 105 }, (_, index) => ({ id: `active-${index}`, status: 'active' }));
  const forgotten = Array.from({ length: 105 }, (_, index) => ({ id: `forgotten-${index}`, status: 'forgotten' }));
  const retained = retainConversationTeachingHistory([...active, ...forgotten], 100);
  assert.equal(retained.filter((entry) => entry.status === 'active').length, 105);
  assert.equal(retained.filter((entry) => entry.status !== 'active').length, 100);
  assert.equal(retained.some((entry) => entry.id === 'active-0'), true);
  assert.equal(retained.some((entry) => entry.id === 'forgotten-0'), false);
  assert.deepEqual(retainConversationTeachingHistory(forgotten, 0), []);
});

test('primary experience is conversational without model or provider controls', () => {
  assert.match(html, /id="music-conversation-form"/);
  assert.match(html, /Talk to your Music Intelligence/);
  assert.match(html, /Requests are temporary unless you explicitly teach or forget/);
  const primaryExperience = html.slice(0, html.indexOf('<details class="advanced-studio"'));
  assert.doesNotMatch(primaryExperience, /model selector|provider selector|ollama|openrouter|OAuth|client secret/i);
});

test('conversation uses canonical AI lifecycle and governed memory bridge', () => {
  assert.match(main, /runAiActionLifecycle\(\{/);
  assert.match(main, /askMusicAi\('music-conversation', payload\)/);
  assert.match(main, /await tileMemoryBridge\?\.submitMemoryCandidateDurably\?\.\(\{/);
  assert.match(main, /memoryResult\?\.authorityReceipt\?\.authorityConfirmed === true/);
  assert.match(main, /await tileMemoryBridge\?\.revokeMemoryCandidate\?\.\(\{/);
  assert.match(main, /applyTasteTeachingContribution\(state\.tasteDNA, teaching, activeTeachings/);
  assert.match(main, /explicit conversation teaching/);
  assert.match(main, /data-conversation-action="forget"/);
});

test('teaching and forgetting avoid full redraws that would interrupt playback', () => {
  const teachingStart = main.indexOf('function applyConversationTeaching');
  const teachingEnd = main.indexOf('\n\nasync function forgetConversationTeaching', teachingStart);
  const forgetEnd = main.indexOf('\n\nfunction getJourneySeedArtist', teachingEnd);
  const teaching = main.slice(teachingStart, teachingEnd);
  const forgetting = main.slice(teachingEnd, forgetEnd);
  assert.doesNotMatch(teaching, /renderAll\(/);
  assert.doesNotMatch(forgetting, /renderAll\(/);
  assert.match(teaching, /renderTasteDNA\(\)/);
  assert.match(forgetting, /renderMusicIntelligenceCentre\(\)/);
  assert.match(teaching, /rankCandidatesByTaste\(state\.candidates, buildTasteWeightsForState\(\)\)/);
  assert.match(forgetting, /rankCandidatesByTaste\(state\.candidates, buildTasteWeightsForState\(\)\)/);
  assert.match(teaching, /renderCandidates\(\)/);
  assert.match(forgetting, /renderCandidates\(\)/);
});

test('journey conversation reports success only from the current build outcome', () => {
  assert.match(main, /const journeyResult = await startSurpriseJourney\(\{ operationGeneration \}\)/);
  assert.match(main, /const doorway = journeyResult\?\.ok \? journeyResult\.doorwayTrack : null/);
  assert.match(main, /return \{ ok: false, doorwayTrack: null, reason: buildOutcome\?\.message/);
});

test('every active teaching remains reachable through a Forget control', () => {
  assert.match(main, /activeTeachings\.slice\(\)\.reverse\(\)\.map/);
  assert.doesNotMatch(main, /activeTeachings\.slice\(-4\)/);
  assert.match(main, /retainConversationTeachingHistory\(saved\.musicConversationTeachings, 100\)/);
  assert.doesNotMatch(main, /musicConversationTeachings[^\n]+slice\(-100\)/);
});

test('conversation catalogue actions stay bound to their rendered result snapshot', () => {
  assert.match(main, /handleCatalogResultAction\(event, musicConversationState\.catalogResults\)/);
  assert.match(main, /musicConversationState\.catalogResults = Array\.isArray\(result\.results\) \? result\.results\.slice\(\) : \[\]/);
  assert.match(main, /const conversationResults = Array\.isArray\(musicConversationState\.catalogResults\)/);
  assert.match(main, /data-conversation-action="show-all-results"/);
  assert.doesNotMatch(main, /data-conversation-action="open-results"/);
});

test('reset revokes durable teachings before clearing state and drops transient snapshots', () => {
  const resetStart = main.indexOf('function revokeDurableConversationTeachingsForReset');
  const resetEnd = main.indexOf('\nfunction renderAll', resetStart);
  const reset = main.slice(resetStart, resetEnd);
  assert.match(reset, /memoryPersisted === true/);
  assert.match(reset, /await tileMemoryBridge\.revokeMemoryCandidate/);
  assert.match(reset, /if \(revocation\?\.revoked !== true\)[\s\S]*return \{ ok: false, teaching \}/);
  assert.ok(reset.indexOf('revokeDurableConversationTeachingsForReset()') < reset.indexOf('localStorage.removeItem(STORAGE_KEY)'));
  assert.match(reset, /nativeCatalogSearchState = createIdleNativeCatalogSearchState\(\)/);
  assert.match(reset, /musicConversationState = createIdleMusicConversationState\(\)/);
  assert.match(reset, /musicOperationGeneration \+= 1/);
  assert.ok(reset.indexOf('musicOperationGeneration += 1') < reset.indexOf('localStorage.removeItem(STORAGE_KEY)'));
  assert.ok(reset.indexOf('beginMusicMemoryMutation()') < reset.indexOf('const revocation = await revokeDurableConversationTeachingsForReset()'));
  assert.ok(reset.indexOf('musicOperationGeneration += 1') < reset.indexOf('const revocation = await revokeDurableConversationTeachingsForReset()'));
  assert.match(reset, /finally \{[\s\S]*endMusicMemoryMutation\(\)/);
});

test('reset invalidates late catalogue, AI and journey completions', () => {
  assert.match(main, /let musicOperationGeneration = 0/);
  assert.match(main, /if \(!isCurrentMusicOperation\(operationGeneration\)\) return nativeCatalogSearchState/);
  assert.match(main, /enrichMusicConversationWithAi\(plan, \{ operationGeneration \}\)/);
  assert.match(main, /startSurpriseJourney\(\{ operationGeneration \}\)/);
  assert.match(main, /buildJourney\(\{ operationGeneration \}\)/);
  assert.match(main, /Journey build superseded by reset\./);
  assert.match(main, /emitEvent: \(event\) => \{[\s\S]*if \(isCurrentMusicOperation\(operationGeneration\)\) emitPresenceEvent\(event\)/);
  assert.match(main, /askAiTrackTask[\s\S]*const operationGeneration=musicOperationGeneration[\s\S]*if\(!isCurrentMusicOperation\(operationGeneration\)\) return/);
  assert.match(main, /buildJourneyAiAssisted[\s\S]*await askMusicAi\('build-journey'[\s\S]*if\(!isCurrentMusicOperation\(operationGeneration\)\) return/);
  assert.match(main, /buildImmersionSessionWithAi[\s\S]*await withTimeout[\s\S]*if\(!isCurrentMusicOperation\(operationGeneration\)\) return/);
  assert.match(main, /resolveSpotifyLink\(trackId, \{ operationGeneration = musicOperationGeneration \} = \{\}\)[\s\S]*await searchSpotifyCatalogForTrack\(track\)[\s\S]*if \(!isCurrentMusicOperation\(operationGeneration\)\) return/);
  assert.match(main, /refreshVerifiedSpotifyLinks[\s\S]*const operationGeneration=musicOperationGeneration[\s\S]*await response\.json\(\)[\s\S]*if \(!isCurrentMusicOperation\(operationGeneration\)\) return/);
  assert.match(main, /forgetConversationTeaching[\s\S]*await tileMemoryBridge\?\.revokeMemoryCandidate[\s\S]*if \(!isCurrentMusicOperation\(operationGeneration\)\) return/);
});

test('idle rendering clears stale native-search and conversation snapshots', () => {
  assert.match(main, /if \(!nativeCatalogSearchState\.query\) \{[\s\S]*nativeSearchResults\.innerHTML = ''/);
  assert.match(main, /musicConversationState\.mode === 'idle' && !activeTeachings\.length[\s\S]*target\.innerHTML = ''/);
  const renderAllStart = main.indexOf('function renderAll()');
  const renderAllEnd = main.indexOf('\nfunction renderTasteDNA', renderAllStart);
  assert.match(main.slice(renderAllStart, renderAllEnd), /renderNativeCatalogResults\(\)/);
});

test('final asynchronous conversation answers scroll into view without forcing visible content', () => {
  assert.match(main, /scrollFinalMusicConversationAnswerIntoView\(target\)/);
  assert.match(main, /scrollIntoView\(\{ behavior, block: 'nearest' \}\)/);
  assert.match(main, /prefers-reduced-motion: reduce/);
  assert.match(main, /renderMusicConversation\(\{ scrollToFinalAnswer: true \}\)/);
});
