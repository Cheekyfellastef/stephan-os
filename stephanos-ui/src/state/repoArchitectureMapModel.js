function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value = []) {
  return Array.isArray(value) ? value.map((entry) => asText(entry)).filter(Boolean) : [];
}

export const REPO_ARCHITECTURE_MAP = Object.freeze({
  sourceTruthRules: Object.freeze([
    'stephanos-ui/src is source truth for Mission Console UI.',
    'apps/stephanos/dist is generated output, not source truth.',
    'Shared runtime/agent models remain canonical where they already exist.',
    'Launcher shell and Mission Console responsibilities remain separate.',
    'Support snapshot must be updated when new mission truth fields are added.',
  ]),
  subsystems: Object.freeze([
    { id:'mission-console', label:'Mission Console', description:'Operator-facing mission control tile and intent loop surface.', category:'ui-control', sourceFiles:['stephanos-ui/src/components/MissionConsoleTile.jsx'], sharedFiles:['shared/agents/missionIntelligenceLayer.mjs'], uiSurfaces:['Mission Console Tile'], generatedOutputs:['apps/stephanos/dist/**'], tests:['stephanos-ui/src/components/MissionConsoleTile.render.test.mjs'], docs:['AGENTS.md'], verificationCommands:['node --test stephanos-ui/src/components/MissionConsoleTile.render.test.mjs'], ownerSurface:'mission-console', riskLevel:'high', canonNotes:['Operator remains final authority.'], commonFailureModes:['Primary UI omits safety boundaries.'], relatedSubsystems:['intent-to-build','codex-handoff','support-snapshot'] },
    { id:'intent-to-build', label:'Intent to Build', description:'Mission spec + codex handoff synthesis from operator intent.', category:'mission-model', sourceFiles:['stephanos-ui/src/state/intentToBuildModel.js'], sharedFiles:['stephanos-ui/src/state/missionMemoryOrchestrator.js'], uiSurfaces:['Intent-to-Build Control Loop'], generatedOutputs:['apps/stephanos/dist/**'], tests:['stephanos-ui/src/state/intentToBuildModel.test.mjs'], docs:['AGENTS.md'], verificationCommands:['node --test stephanos-ui/src/state/intentToBuildModel.test.mjs'], ownerSurface:'mission-console', riskLevel:'high', canonNotes:['Intent remains primary and cannot be silently overridden.'], commonFailureModes:['Memory overrides current intent.'], relatedSubsystems:['mission-memory','codex-handoff','verification-return'] },
    { id:'mission-memory', label:'Mission Memory', description:'Mission memory influence and lesson candidate context.', category:'memory', sourceFiles:['stephanos-ui/src/state/missionMemoryOrchestrator.js'], sharedFiles:['shared/runtime/stephanosSessionMemory.mjs','shared/runtime/stephanosMemory.mjs'], uiSurfaces:['Intent-to-Build Control Loop'], generatedOutputs:[], tests:['stephanos-ui/src/state/intentToBuildModel.test.mjs'], docs:['AGENTS.md'], verificationCommands:['node --test stephanos-ui/src/state/intentToBuildModel.test.mjs'], ownerSurface:'mission-console', riskLevel:'medium', canonNotes:['Session memory and durable memory remain separate.'], commonFailureModes:['Rejected/unsaved memories leak into active mission.'], relatedSubsystems:['intent-to-build','support-snapshot'] },
    ...['openclaw-delegation','mission-finish-authority','codex-handoff','verification-return','support-snapshot','system-watcher','capability-radar','skill-forge','ai-mind-registry','reality-upgrade-orchestrator','proof-of-done','runtime-status-model','route-truth','panel-canon','world-workspace','generated-dist'].map((id)=>({id,label:id,description:'Canonical mapped subsystem.',category:'mapped',sourceFiles:[],sharedFiles:[],uiSurfaces:[],generatedOutputs:id==='generated-dist'?['apps/stephanos/dist/**']:[],tests:[],docs:['AGENTS.md'],verificationCommands:['npm run stephanos:verify'],ownerSurface:'mission-console',riskLevel:id==='generated-dist'?'high':'medium',canonNotes:id==='generated-dist'?['Generated output; never edit as source truth.']:[],commonFailureModes:[],relatedSubsystems:['mission-console']})),
  ]),
});

export function deriveAffectedSubsystemsForMission({ operatorIntent = '', missionSpec = {}, memoryContext = {} } = {}) {
  const text = `${asText(operatorIntent)} ${asText(missionSpec?.targetArea)} ${(missionSpec?.intentClassifications || []).join(' ')} ${JSON.stringify(memoryContext || {})} ${JSON.stringify(missionSpec?.openClawDelegation || {})} ${JSON.stringify(missionSpec?.finishAuthority || {})}`.toLowerCase();
  const add = new Set(['mission-console','intent-to-build']);
  if (/openclaw|delegat/.test(text)) ['openclaw-delegation','codex-handoff','support-snapshot','verification-return'].forEach((id)=>add.add(id));
  if (/memory|lesson|recall/.test(text)) ['mission-memory','support-snapshot'].forEach((id)=>add.add(id));
  if (/merge|finish authority|auto-merge|finish/.test(text)) ['mission-finish-authority','codex-handoff','support-snapshot'].forEach((id)=>add.add(id));
  if (/verify|test|acceptance/.test(text)) add.add('verification-return');
  return [...add];
}

export function buildRepoArchitectureContext({ operatorIntent = '', missionSpec = {}, memoryContext = {} } = {}) {
  const affectedSubsystems = deriveAffectedSubsystemsForMission({ operatorIntent, missionSpec, memoryContext });
  const subsystemIndex = new Map(REPO_ARCHITECTURE_MAP.subsystems.map((entry) => [entry.id, entry]));
  const selected = affectedSubsystems.map((id) => subsystemIndex.get(id)).filter(Boolean);
  const uniq = (key) => [...new Set(selected.flatMap((entry) => entry[key] || []))];
  return {
    affectedSubsystems,
    sourceFilesLikelyTouched: uniq('sourceFiles'),
    generatedOutputsLikelyTouched: uniq('generatedOutputs'),
    testsLikelyRequired: uniq('tests'),
    docsLikelyTouched: uniq('docs'),
    verificationCommandsLikelyRequired: uniq('verificationCommands'),
    architectureWarnings: ['Recommendations only; no hidden mutation or execution path is introduced.'],
    sourceTruthWarnings: REPO_ARCHITECTURE_MAP.sourceTruthRules,
    riskSummary: selected.map((entry) => `${entry.label}:${entry.riskLevel}`),
    commonFailureModes: uniq('commonFailureModes'),
  };
}
