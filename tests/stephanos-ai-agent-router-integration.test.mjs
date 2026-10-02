import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('AI route installs conversation router before model execution and returns routing truth', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'stephanos-server', 'routes', 'ai.js'), 'utf8');
  assert.match(source, /routeStephanosConversationV1/);
  assert.match(source, /requestedTargetId:\s*normalizedRuntimeContext\.participantTarget/);
  assert.match(source, /conversationRouting\.contextBlock/);
  assert.match(source, /conversation_routing:\s*conversationRouting/);
  assert.match(source, /conversation_responder_label/);
  assert.match(source, /conversation_direct_participant_dispatch_proven/);
});

test('Stephanos AI UI labels the proven responder separately from routed contributors', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'apps', 'stephanos-ai', 'workspace.js'), 'utf8');
  assert.match(source, /routing\?\.responder\?\.label \|\| 'Stephanos AI'/);
  assert.match(source, /routed through/);
  assert.match(source, /directParticipantDispatchProven/);
  assert.doesNotMatch(source, /author:activeTarget\.id === 'everyone' \? 'Stephanos AI' : activeTarget\.label/);
});
