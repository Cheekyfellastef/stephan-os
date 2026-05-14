import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatContextPack } from '../state/chatContextOrchestrator.js';
import { buildSupportSnapshot } from '../state/supportSnapshot.js';

test('Command Deck merge prompt projects active merge-decision chat context into Support Snapshot', () => {
  const prompt = 'do I merge this PR?';
  const chatContextPack = buildChatContextPack({
    operatorMessage: prompt,
    buildSource: 'stephanos-mission-console',
    uiRealityStatus: { severity: 'OK' },
    routeTruth: { routeKind: 'cloud', executedProvider: 'groq', routeUsableState: 'yes' },
    missionState: { status: 'draft' },
  });

  const attached = {
    chat_context_pack_status: chatContextPack?.compactSummary?.status || 'unavailable',
    chat_context_version: chatContextPack?.version || 'n/a',
    chat_context_response_mode: chatContextPack?.recommendedResponseMode || 'direct-answer',
    chat_context_relevant_canon_count: Array.isArray(chatContextPack?.relevantCanon) ? chatContextPack.relevantCanon.length : 0,
    chat_context_affected_subsystems: Array.isArray(chatContextPack?.affectedSubsystems) ? chatContextPack.affectedSubsystems.join('|') : 'none',
    chat_context_attachment_probe_response_mode: chatContextPack?.recommendedResponseMode || 'direct-answer',
    chat_context_intent_classifier_matched_rule: chatContextPack?.intentClassifierMatchedRule || 'direct-answer',
    chat_context_default_pack_used: chatContextPack?.intentClassifierMatchedRule && chatContextPack.intentClassifierMatchedRule !== 'direct-answer' ? 'no' : 'yes',
    chat_context_attachment_probe: 'attached-at-final-execution-metadata',
    chat_context_build_source: 'stephanos-mission-console',
    chat_context_raw_operator_message_seen: prompt,
    chat_context_normalized_operator_message: prompt,
  };

  assert.equal(attached.chat_context_pack_status, 'active');
  assert.equal(attached.chat_context_version, 'v1');
  assert.equal(attached.chat_context_response_mode, 'merge-decision');
  assert.equal(attached.chat_context_intent_classifier_matched_rule, 'merge-decision');
  assert.equal(attached.chat_context_default_pack_used, 'no');
  assert.equal(attached.chat_context_attachment_probe_response_mode, 'merge-decision');
  assert.notEqual(Number(attached.chat_context_relevant_canon_count || 0), 0);
  assert.match(String(attached.chat_context_affected_subsystems || ''), /(merge|pr|codex|proof|source-truth)/i);

  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        ...attached,
        request_execution_id: 'req_live_path_proof',
        execution_status: 'ok:groq',
      },
    },
  });

  assert.match(snapshot, /Chat Context Pack Status: active/);
  assert.match(snapshot, /Chat Context Version: v1/);
  assert.match(snapshot, /Chat Context Response Mode: merge-decision/);
  assert.match(snapshot, /Chat Context Intent Classifier Matched Rule: merge-decision/);
  assert.match(snapshot, /Chat Context Default Pack Used: no/);
  assert.match(snapshot, /Chat Context Relevant Canon Count: [1-9][0-9]*/);
  assert.match(snapshot, /Chat Context Affected Subsystems: .*?(merge|pr|codex|proof|source-truth)/i);
  assert.match(snapshot, /Chat Context Attachment Probe Response Mode: merge-decision/);
  assert.match(snapshot, /Chat Context Metadata Source: final-execution-metadata/);
  assert.match(snapshot, /Chat Context Final Execution Metadata Present: yes/);

  assert.doesNotMatch(snapshot, /Chat Context Response Mode: direct-answer/);
  assert.doesNotMatch(snapshot, /Chat Context Pack Status: unavailable/);
  assert.doesNotMatch(snapshot, /Chat Context Default Pack Used: yes/);
  assert.doesNotMatch(snapshot, /Chat Context Relevant Canon Count: 0/);
});
