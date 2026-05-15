import test from 'node:test';
import assert from 'node:assert/strict';
import { INTENT_RULES, buildChatContextPack, normalizeIntentInputForMatching } from './chatContextOrchestrator.js';

test('buildChatContextPack returns compact structured context', () => {
  const pack = buildChatContextPack({ operatorMessage: 'this pane is broken', uiRealityStatus: { severity: 'FAIL' }, routeTruth: { routeKind: 'cloud', routeUsableState: 'yes', executedProvider: 'groq' } });
  assert.equal(pack.version, 'v1');
  assert.equal(pack.recommendedResponseMode, 'diagnosis');
  assert.ok(Array.isArray(pack.relevantCanon));
  assert.ok(pack.warnings.some((w) => w.includes('UI Reality FAIL')));
});

test('intent mapping: merge decision and codex prompt', () => {
  assert.equal(buildChatContextPack({ operatorMessage: 'do I merge this' }).recommendedResponseMode, 'merge-decision');
  assert.equal(buildChatContextPack({ operatorMessage: 'give me a Codex prompt' }).recommendedResponseMode, 'codex-prompt');
});


test('live classify/build path maps exact normalized merge prompt to merge-decision', () => {
  const pack = buildChatContextPack({ operatorMessage: 'do I merge this PR?' });
  assert.equal(pack.recommendedResponseMode, 'merge-decision');
  assert.equal(pack.intentClassifierMatchedRule, 'merge-decision');
  assert.equal(pack.classifierDebug.classifierFallbackApplied, 'no');
  assert.ok(pack.compactSummary.relevantCanonCount > 0);
  assert.ok(Array.isArray(pack.affectedSubsystems) && pack.affectedSubsystems.length > 0);
});

test('merge rule test returns true for do i merge this pr', () => {
  const normalizedInput = normalizeIntentInputForMatching('do I merge this PR?');
  assert.equal(normalizedInput, 'do i merge this pr');
  const pack = buildChatContextPack({ operatorMessage: normalizedInput });
  assert.equal(pack.classifierDebug.classifierMatchInput, 'do i merge this pr');
  assert.equal(pack.classifierDebug.classifierMergeRuleTestResult, 'yes');
  assert.equal(pack.classifierDebug.classifierFirstMatchingRule, 'merge-decision');
  assert.equal(pack.matchInput, 'do i merge this pr');
  assert.equal(pack.mergeRuleTestResult, 'yes');
  assert.equal(pack.firstMatchingRule, 'merge-decision');
  assert.ok(pack.evaluatedRuleResults.includes('merge-decision:1'));
});

test('UI tasks include source/dist canon', () => {
  const pack = buildChatContextPack({ operatorMessage: 'this UI pane is broken' });
  const canonText = pack.relevantCanon.map((entry) => entry.text).join(' | ');
  assert.match(canonText, /dist is never source of truth/);
});


test('merge-decision pack includes merge canon and non-direct next action', () => {
  const pack = buildChatContextPack({ operatorMessage: 'do I merge this PR?' });
  const canonText = pack.relevantCanon.map((entry) => entry.text).join(' | ');
  assert.equal(pack.recommendedResponseMode, 'merge-decision');
  assert.match(canonText, /do not merge when checks\/build\/verify fail/);
  assert.match(canonText, /prefer amendment to existing PR when PR is still open/);
  assert.match(canonText, /do not treat terminal-only UI checks as complete/);
  assert.match(pack.recommendedNextAction, /merge|proof|PR/i);
});


test('merge-decision classifier catches common merge question variants', () => {
  const a = buildChatContextPack({ operatorMessage: 'do I merge this PR?' });
  const b = buildChatContextPack({ operatorMessage: 'should I merge this' });
  const c = buildChatContextPack({ operatorMessage: 'can I merge this PR' });
  const d = buildChatContextPack({ operatorMessage: 'merge this one?' });
  const e = buildChatContextPack({ operatorMessage: 'do I merge this one?' });
  const f = buildChatContextPack({ operatorMessage: 'merge this pr' });
  const g = buildChatContextPack({ operatorMessage: 'do i merge this pr' });

  for (const pack of [a, b, c, d, e, f, g]) {
    assert.equal(pack.compactSummary.status, 'active');
    assert.equal(pack.recommendedResponseMode, 'merge-decision');
    assert.equal(pack.intentClassifierMatchedRule, 'merge-decision');
    assert.ok(pack.compactSummary.relevantCanonCount > 0);
    assert.equal(pack.classifierDebug.classifierFallbackApplied, 'no');
    assert.ok(pack.affectedSubsystems.length > 0);
    assert.match(pack.recommendedNextAction, /merge|proof|check/i);
  }
});

test('missing PR evidence does not downgrade merge-decision and keeps canon/subsystems', () => {
  const pack = buildChatContextPack({ operatorMessage: 'do I merge this PR?', supportSnapshot: {} });
  assert.equal(pack.recommendedResponseMode, 'merge-decision');
  assert.equal(pack.intentClassifierMatchedRule, 'merge-decision');
  assert.ok(pack.relevantCanon.length > 0);
  assert.ok(pack.affectedSubsystems.includes('merge'));
  assert.ok(pack.affectedSubsystems.includes('pr'));
});

test('direct-answer remains fallback for generic prompts', () => {
  const pack = buildChatContextPack({ operatorMessage: 'hello there' });
  assert.equal(pack.recommendedResponseMode, 'direct-answer');
  assert.equal(pack.intentClassifierMatchedRule, 'direct-answer');
  assert.equal(pack.classifierDebug.classifierFirstMatchingRule, 'direct-answer');
  assert.equal(pack.classifierDebug.classifierMergeRuleTestResult, 'no');
});


test('buildChatContextPack emits canonical classifierProof for do i merge this pr', () => {
  const pack = buildChatContextPack({ operatorMessage: 'do i merge this pr' });
  assert.equal(pack.classifierProof.matchInput, 'do i merge this pr');
  assert.match(pack.classifierProof.mergeRulePattern, /contains: merge/);
  assert.equal(pack.classifierProof.mergeRuleTestResult, 'yes');
  assert.equal(pack.classifierProof.firstMatchingRule, 'merge-decision');
  assert.ok(pack.classifierProof.evaluatedRuleResults.includes('merge-decision:1'));
  assert.equal(pack.classifierProof.intentClassifierMatchedRule, 'merge-decision');
  assert.equal(pack.classifierProof.responseMode, 'merge-decision');
  assert.equal(pack.classifierProof.defaultPackUsed, 'no');
});


test('merge-decision uses required context providers and stays compact', () => {
  const pack = buildChatContextPack({ operatorMessage: 'do i merge this pr' });
  assert.equal(pack.contextProviderRegistryStatus, 'active');
  assert.ok(Array.isArray(pack.contextProviderIdsRegistered));
  for (const id of ['uiReality', 'proofState', 'canonRules', 'runtimeTruth', 'providerTruth', 'missionState']) {
    assert.ok(pack.contextProviderIdsUsed.includes(id));
  }
  assert.ok(pack.contextProviderCanonLinksCount > 0);
  assert.ok(pack.relevantCanon.length > 0);
  assert.equal(typeof pack.providerSummaries, 'object');
  assert.equal(pack.providerSummaries.rawSupportSnapshot, undefined);
});

test('buildChatContextPack do i merge this pr emits registered and used provider IDs', () => {
  const pack = buildChatContextPack({ operatorMessage: 'do i merge this pr' });
  assert.deepEqual(
    pack.contextProviderIdsRegistered,
    ['uiReality', 'runtimeTruth', 'providerTruth', 'missionState', 'proofState', 'canonRules', 'memoryContinuity', 'operatorProfile', 'conversationContinuity', 'agentState'],
  );
  assert.deepEqual(
    pack.contextProviderIdsUsed,
    ['uiReality', 'runtimeTruth', 'providerTruth', 'missionState', 'proofState', 'canonRules', 'memoryContinuity', 'operatorProfile', 'conversationContinuity', 'agentState'],
  );
});


test('operator profile is included in context providers and prompt context', () => {
  const pack = buildChatContextPack({ operatorMessage: 'hello', operatorProfile: { known: true, operatorName: 'Stephan', confidence: 'high', source: 'operator explicit statement' } });
  assert.ok(pack.contextProviderIdsUsed.includes('operatorProfile'));
  assert.equal(pack.operatorProfile.operatorName, 'Stephan');
});
