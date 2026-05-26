import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');

test('Mission Console operator relief panel renders mission brain sections and copy controls', () => {
  assert.match(source, /Operator Relief v2 · Mission Brain/);
  assert.match(source, /Merge Safety Verdict/);
  assert.match(source, /Next Best Action/);
  assert.match(source, /Mission Brain \/ Next Action/);
  assert.match(source, /Harness Agent/);
  assert.match(source, /V1\.2/);
  assert.match(source, /Harness Status:/);
  assert.match(source, /Risk Level:/);
  assert.match(source, /Protected Canon At Risk:/);
  assert.match(source, /Required Proof:/);
  assert.match(source, /Merge Recommendation:/);
  assert.match(source, /Next Operator Action:/);
  assert.match(source, /Copy Harness Contract/);
  assert.match(source, /Top 3 Problems \/ Next Moves/);
  assert.match(source, /Evidence gaps count:/);
  assert.match(source, /Copy Next Codex Prompt/);
  assert.match(source, /Copy Repair Prompt/);
  assert.match(source, /Lesson Candidates/);
  assert.match(source, /Mission Handoff Pack/);
  assert.match(source, /Work Routing Candidate/);
  assert.match(source, /Agent Reality Loop V1/);
  assert.match(source, /Copy Agent Reality Loop Codex Packet/);
  assert.match(source, /Copy Agent Reality Loop OpenClaw Packet/);
  assert.match(source, /Copy Agent Reality Loop Operator Checklist/);
  assert.match(source, /Operator-Approved Repair Loop V1/);
  assert.match(source, /Copy OpenClaw Continuation Packet/);
  assert.match(source, /Copy Codex Continuation Packet/);
  assert.match(source, /Copy Mission Contract/);
  assert.match(source, /Verification Return Intake/);
  assert.match(source, /Mission Approval Queue/);
  assert.match(source, /Top recommended decision:/);
  assert.match(source, /Required proof before approval:/);
  assert.match(source, /Copy Action Packet/);
  assert.match(source, /Copy Mission Handoff Update/);
  assert.match(source, /Operator Decision Needed:/);
  assert.match(source, /Can OpenClaw Help\?/);
  assert.match(source, /Can Codex Help\?/);
  assert.match(source, /Current Mission:/);
  assert.match(source, /Copy Mission Context/);
  assert.match(source, /Copy Codex Packet/);
  assert.match(source, /copyVerificationPacket/);
  assert.match(source, /Copy Codex Implementation Packet/);
  assert.match(source, /Copy OpenClaw Research Packet/);
  assert.match(source, /Co-Builder Loop V1/);
  assert.match(source, /Copy Operator Proof Checklist/);
  assert.match(source, /operator_relief\.browser_proof_missing/);
});


test('Mission Console operator relief uses canonical collapsible panel wiring with persisted layout key', () => {
  assert.match(source, /panelId=\"missionConsoleOperatorReliefPanel\"/);
  assert.match(source, /isOpen=\{uiLayout\.missionConsoleOperatorReliefPanel !== false\}/);
  assert.match(source, /panelId=\"missionConsoleMissionApprovalQueuePanel\"/);
  assert.match(source, /panelId=\"missionConsoleAgentRealityLoopPanel\"/);
  assert.match(source, /panelId=\"missionConsoleHarnessAgentPanel\"/);
  assert.equal(source.includes("dispatchPanelToggle('missionConsoleOperatorReliefPanel')"), true);
});
