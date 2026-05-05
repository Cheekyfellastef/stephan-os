import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionCommandPacket, buildMissionCommandPacketJson, buildMissionCommandPacketMarkdown } from './missionCommandPacketModel.js';

test('mission command packet builds safely with missing optional systems', () => {
  const packet = buildMissionCommandPacket({ missionSpec: { missionId: 'm1', rawIntent: 'Intent', doctrineConstraints: ['Operator final authority.'] } }, { now: new Date('2026-05-05T00:00:00.000Z') });
  assert.equal(packet.packetVersion, 'v1');
  assert.equal(packet.missionId, 'm1');
  assert.equal(Array.isArray(packet.blockedActions), true);
  assert.match(packet.operatorAuthorityStatement, /No autonomous execution/);
});

test('mission command packet exports stable json and markdown sections', () => {
  const packet = buildMissionCommandPacket({
    missionSpec: { missionId: 'm2', rawIntent: 'Ship packet model', doctrineConstraints: ['x'], approvalBoundary: { blockedActions: ['deploy'] }, verificationCommands: ['npm run stephanos:verify'] },
    openClawDelegation: { delegationStatus: 'preview_only', boundaries: ['no-exec'] },
    finishAuthority: { finishAuthorityStatus: 'not_granted' },
    missionEvidenceLedger: { completeness: 'partial', entries: [{ entryId: '1' }], warnings: ['pending'] },
    operatorDecisionConsole: { status: 'pending', decisions: [{ id: 'd1' }] },
  });
  const json = buildMissionCommandPacketJson(packet);
  const parsed = JSON.parse(json);
  assert.equal(parsed.missionId, 'm2');
  const markdown = buildMissionCommandPacketMarkdown(packet);
  ['## Mission', '## Operator Intent', '## Safety Doctrine', '## Blocked Actions', '## OpenClaw Delegation', '## Finish Authority', '## Evidence Ledger', '## Operator Decisions', '## Codex Handoff', '## Next Action']
    .forEach((label) => assert.equal(markdown.includes(label), true, `missing ${label}`));
});
