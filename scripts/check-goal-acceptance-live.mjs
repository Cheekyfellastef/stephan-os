import { execFileSync } from 'node:child_process';
import { readMissionRecord } from '../stephanos-server/services/missionOrchestratorStore.js';
import { collectGoalAcceptanceProof } from '../stephanos-server/services/liveGoalAcceptanceProofService.js';

const repoRoot = process.cwd();
const head = execFileSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8',timeout:10000}).trim();
const verifyMerge = async (commit,currentHead) => {
  if (!/^[0-9a-f]{40}$/.test(commit)||!/^[0-9a-f]{40}$/.test(currentHead))return false;
  try {execFileSync('git',['merge-base','--is-ancestor',commit,currentHead],{cwd:repoRoot,timeout:10000});return true;}catch{return false;}
};
const checkVrLink = async () => {
  try {const r=await fetch('http://127.0.0.1:4173/apps/vr-link/index.html',{signal:AbortSignal.timeout(5000)});
    const html=await r.text();return r.status===200&&html.includes('Stephanos VR Link')&&html.includes('Enter Holodeck Baseline');}catch{return false;}
};
const askVrResearch = async questionClass => {
  const r=await fetch('http://127.0.0.1:8787/api/shared-workspace/vr-research-qa?questionClass='+questionClass,{signal:AbortSignal.timeout(5000)});
  return r.ok?await r.json():null;
};
for (const goalNumber of [1646,1717,1723]) {
  const mission=(await readMissionRecord('critical-'+goalNumber+'-elastic-goal')).state;
  const result=await collectGoalAcceptanceProof({goalNumber,mission,sourceHead:head,verifyMerge,checkVrLink,askVrResearch});
  console.log(JSON.stringify({goalNumber,phase:mission.currentPhase,verified:result.reconciliation.verified,missing:result.reconciliation.missing,classification:result.reconciliation.classification,completionAllowed:result.reconciliation.completionAllowed}));
}
