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
const checkBrowserFallback = async () => {
  let browser;
  try {
    const { chromium } = await import('playwright');
    const executablePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
    const page = await browser.newPage({viewport:{width:1280,height:800}});
    const response=await page.goto('http://127.0.0.1:4173/apps/vr-link/index.html',{waitUntil:'domcontentloaded',timeout:15000});
    await page.waitForFunction(() => document.querySelector('#xr')?.textContent !== 'Checking…',{timeout:6000});
    const xr=await page.locator('#xr').innerText();
    const session=await page.locator('#session').innerText();
    const controls=await page.locator('button').allTextContents();
    return response?.status()===200 && session==='Fallback' && /^(No|Unknown)/.test(xr)
      && controls.some(x=>x.includes('Enter Holodeck Baseline'))
      && controls.some(x=>x.includes('Ping Stephanos'));
  } catch {return false;} finally {if(browser) await browser.close();}
};
const checkVrLabConsumer = async () => {
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    const page=await browser.newPage();
    const response=await page.goto('http://127.0.0.1:4173/apps/vr-research-lab/index.html',{timeout:15000});
    await page.locator('#vr-research-qa-refresh').click();
    await page.waitForFunction(()=>document.querySelector('#vr-research-qa-state')?.textContent.includes('stephanos-vr-research:'),{timeout:8000});
    const verdict=await page.locator('#vr-research-qa-state').innerText();
    return response.status()===200 && /stephanos-vr-research: (GAP_KNOWLEDGE|GAP_FRESHNESS|ANSWERED_GROUNDED)/.test(verdict);
  }catch{return false;}finally{if(browser)await browser.close();}
};
const askVrResearch = async questionClass => {
  const r=await fetch('http://127.0.0.1:8787/api/shared-workspace/vr-research-qa?questionClass='+questionClass,{signal:AbortSignal.timeout(5000)});
  return r.ok?await r.json():null;
};
for (const goalNumber of [1646,1717,1723]) {
  const mission=(await readMissionRecord('critical-'+goalNumber+'-elastic-goal')).state;
  const result=await collectGoalAcceptanceProof({goalNumber,mission,sourceHead:head,verifyMerge,checkVrLink,checkBrowserFallback,checkVrLabConsumer,askVrResearch});
  console.log(JSON.stringify({goalNumber,phase:mission.currentPhase,verified:result.reconciliation.verified,missing:result.reconciliation.missing,classification:result.reconciliation.classification,completionAllowed:result.reconciliation.completionAllowed}));
}
