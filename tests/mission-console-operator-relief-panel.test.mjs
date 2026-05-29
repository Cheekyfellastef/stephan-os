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
  assert.match(source, /OpenClaw Builder Harness V1/);
  assert.match(source, /Can OpenClaw build\?/);
  assert.match(source, /Can local AIs help\?/);
  assert.match(source, /Can GitHub be inspected\?/);
  assert.match(source, /Can a patch be proposed\?/);
  assert.match(source, /What approval is needed\?/);
  assert.match(source, /Copy Local AI Review Packet/);
  assert.match(source, /Copy OpenClaw Patch Plan Packet/);
  assert.match(source, /Copy GitHub PR Inspection Packet/);
  assert.match(source, /Copy Codex Fallback Packet/);
  assert.match(source, /fallback-specialist-only/);
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


test('Mission Console publishes operator relief projection bridge payload with source surface and first-publish guard', () => {
  assert.match(source, /const operatorReliefProjectionPublishSignatureRef = useRef\(''\);/);
  assert.match(source, /const nextSignature = JSON\.stringify\(nextProjection\);/);
  assert.match(source, /onOperatorReliefProjectionUpdate\(nextProjection, \{ sourceSurface: panelId \}\);/);
  assert.match(source, /\}, \[onOperatorReliefProjectionUpdate, operatorReliefProjection, panelId\]\);/);
});

test('Zero-Cost Builder Mesh is hosted inside existing Builder Harness panel, not a duplicate top-level pane', () => {
  assert.match(source, /panelId="missionConsoleBuilderHarnessPanel" title="OpenClaw Builder Harness V1"/);
  assert.match(source, /panelId="missionConsoleBuilderMeshPanel" title="Zero-Cost Builder Mesh V1"/);
  assert.doesNotMatch(source, /mission-console-section--builder-mesh/);
  assert.match(source, /copyBuilderMeshLocalAiReviewPacket/);
  assert.match(source, /copyBuilderMeshOpenClawResearchPacket/);
  assert.match(source, /copyBuilderMeshGithubInspectionPacket/);
  assert.match(source, /panelId="missionConsoleBuilderWorkbenchPanel" title="Zero-Cost Builder Workbench V1"/);
  assert.match(source, /Paste Local AI Review Result/);
  assert.match(source, /Local model selector/);
  assert.match(source, /Run Local AI Review/);
  assert.match(source, /Local AI Runner Status/);
  assert.match(source, /Copy raw bounded response/);
  assert.match(source, /Paste OpenClaw Research \/ Patch Plan Result/);
  assert.match(source, /Show Workbench Verdict/);
  assert.match(source, /builder-workbench-result-textarea--local-ai/);
  assert.match(source, /builder-workbench-result-textarea--openclaw/);
  assert.match(source, /data-workbench-output-viewport="raw-bounded-response"/);
  assert.match(source, /data-workbench-output-viewport="parsed-verdict"/);
  assert.match(source, /copyBuilderWorkbenchCodexFallbackPacket/);
  assert.match(source, /copyBuilderWorkbenchOperatorApprovalChecklist/);
});
