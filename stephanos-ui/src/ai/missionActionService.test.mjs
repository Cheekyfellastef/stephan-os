import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_ACTION_MODES,
  buildMissionActionPrompt,
  getAiActionInstruction,
  validateAiActionContext,
} from './missionActionService.js';

test('buildMissionActionPrompt includes mode-specific instructions and context', () => {
  const context = {
    mission: { metrics: { blockedCount: 2 } },
    missingContext: { missionState: false, runtimeState: false, workspaceState: false },
  };
  const prompt = buildMissionActionPrompt({ mode: AI_ACTION_MODES.CODEX_PROMPT, context });

  assert.match(prompt, /Action mode: codex_prompt/);
  assert.match(prompt, /codex_prompt/);
  assert.match(prompt, /Stephanos context JSON/);
  assert.match(prompt, /"blockedCount": 2/);
  assert.ok(getAiActionInstruction(AI_ACTION_MODES.CODEX_PROMPT));
});

test('validateAiActionContext requires runtime truth to proceed', () => {
  const validation = validateAiActionContext({
    missingContext: {
      missionState: true,
      workspaceState: false,
      runtimeState: true,
    },
  });

  assert.equal(validation.missionMissing, true);
  assert.equal(validation.hasRequiredCore, false);
});
