import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionSynthesis } from './missionSynthesis.js';
import { buildProposalPacket } from './proposalPacket.js';

function buildSynthesis(prompt) {
  return buildMissionSynthesis({
    prompt,
    promptClassification: { selfBuild: { detected: true } },
    contextBundle: {
      memory: { summary: 'recent architecture work' },
      runtimeTruth: { routeKind: 'cloud' },
      tileContext: { activeTile: 'mission' },
    },
    operatorContext: {
      subsystemInventory: ['memory', 'proposal', 'runtime-truth'],
    },
    contextDiagnostics: {
      sourcesUsed: ['memory', 'runtimeTruth', 'operatorContext'],
    },
  });
}

test('buildProposalPacket activates for self-build synthesis and preserves approval gate', () => {
  const packet = buildProposalPacket({
    missionSynthesis: buildSynthesis('What should we build next to help Stephanos build itself?'),
    runtimeTruth: { routeUsableState: 'yes' },
  });

  assert.equal(packet.packet_metadata.proposal_active, true);
  assert.equal(packet.operator_workflow.approval_required, true);
  assert.equal(packet.operator_workflow.execution_eligible, false);
  assert.equal(packet.truth_fields.proposal_packet_active, true);
  assert.equal(packet.truth_fields.codex_handoff_eligible, true);
  assert.equal(packet.codex_handoff_payload.codex_eligible, true);
  assert.equal(typeof packet.codex_handoff_payload.copyable_payload, 'string');
  assert.ok(packet.codex_handoff_payload.copyable_payload.includes('"approval_required": true'));
});

test('buildProposalPacket remains inactive for non-planning synthesis', () => {
  const inactiveSynthesis = buildMissionSynthesis({
    prompt: 'explain javascript promises',
    promptClassification: { selfBuild: { detected: false } },
    contextBundle: {},
    contextDiagnostics: { sourcesUsed: [] },
  });
  const packet = buildProposalPacket({ missionSynthesis: inactiveSynthesis });

  assert.equal(packet.packet_metadata.proposal_active, false);
  assert.equal(packet.codex_handoff_payload.codex_eligible, false);
  assert.equal(packet.truth_fields.proposed_move_id, '');
});

test('buildProposalPacket is deterministic for identical synthesis input', () => {
  const synthesis = buildSynthesis('what should we build next for roadmap execution');
  const first = buildProposalPacket({ missionSynthesis: synthesis, runtimeTruth: { routeUsableState: 'no' } });
  const second = buildProposalPacket({ missionSynthesis: synthesis, runtimeTruth: { routeUsableState: 'no' } });

  assert.deepEqual(first, second);
  assert.ok(first.packet_metadata.warnings.includes('selected route was not usable; handoff should avoid runtime execution assumptions'));
});
