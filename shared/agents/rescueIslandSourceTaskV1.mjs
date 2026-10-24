// Finite reviewed source plans for the supervised cooperative Island host.
// This classifier is NOT owner authentication, a lease or execution authority.
const REPO='Cheekyfellastef/stephan-os';
const SHA=/^[a-f0-9]{40}$/;
const TASK=/^[a-z0-9][a-z0-9-]{7,63}$/;
const fields=['schemaVersion','repository','issueNumber','issueTitle','taskId','workerId',
  'baseHead','targetPath','content','testPath','approvalSource','expiresAtUtc'];
const islandNames=['rescueIslandFirstCommitV1','rescueIslandPilotOwnerIntakeV1',
  'rescueIslandAuthenticatedGithubReadV1','rescueIslandPreflightV1','rescueIslandSourceTaskV1',
  'rescueIslandSecondLaneV1','rescueIslandNativeTestProvisionV1'];
const islandPaths=islandNames.flatMap(n=>['shared/agents/'+n+'.mjs','shared/agents/'+n+'.test.mjs']);
islandPaths.push('shared/agents/rescueIslandSupervisedHostV1.mjs',
  'shared/agents/rescueIslandSupervisedHostV1.windows.mjs',
  'shared/agents/rescueIslandSupervisedRunV1.test.mjs');
const seedPaths=['seedCanopyParallelForgeV1','seedCanopyParallelResourceV1',
  'seedCanopyParallelGitHubApprovalV1','seedCanopyParallelSupervisorV1']
  .flatMap(n=>['shared/runtime/'+n+'.mjs','shared/runtime/'+n+'.test.mjs']);
export const RESCUE_ISLAND_SOURCE_TASK_SCHEMA='stephanos.rescue-island-source-task.v1';
export const RESCUE_ISLAND_SOURCE_PLANS=Object.freeze({
  ISLAND_BUILDERS_V1:Object.freeze({issueNumber:3109,
    issueTitle:'Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)',
    paths:Object.freeze(islandPaths),
    baseTests:Object.freeze(['shared/agents/rescueIslandPreflightV1.test.mjs',
      'shared/agents/rescueIslandSourceTaskV1.test.mjs',
      'shared/agents/rescueIslandSupervisedRunV1.test.mjs'])}),
  SEED_FORGE_V1:Object.freeze({issueNumber:3096,
    issueTitle:'Goal: Independent Seed Canopy Parallel Forge, isolated local-model build route',
    paths:Object.freeze(seedPaths),
    baseTests:Object.freeze(['shared/runtime/seedCanopyParallelForgeV1.test.mjs',
      'shared/runtime/seedCanopyParallelResourceV1.test.mjs',
      'shared/runtime/seedCanopyParallelGitHubApprovalV1.test.mjs',
      'shared/runtime/seedCanopyParallelSupervisorV1.test.mjs'])}),
});
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype
  &&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{
    const d=Object.getOwnPropertyDescriptor(v,k);return d&&Object.hasOwn(d,'value');
  });
const denied=reason=>Object.freeze({valid:false,blocker:reason,executionAuthority:false});
export function inspectRescueIslandSourceTaskV1(task,nowUtc=new Date().toISOString()){
  if(!exact(task,fields)||fields.some(k=>!['number','string'].includes(typeof task[k])))
    return denied('SOURCE_TASK_SHAPE_INVALID');
  const now=Date.parse(nowUtc),expiry=Date.parse(task.expiresAtUtc);
  if(task.schemaVersion!==RESCUE_ISLAND_SOURCE_TASK_SCHEMA||task.repository!==REPO
    ||task.workerId!=='rescue-island-01'||!SHA.test(task.baseHead)||!TASK.test(task.taskId)
    ||task.approvalSource!=='EXTERNAL_OWNER_ATTESTATION_REQUIRED'
    ||!Number.isFinite(now)||!Number.isFinite(expiry)||expiry<=now||expiry-now>600000
    ||task.testPath!=='shared/agents/rescueIslandPreflightV1.test.mjs'
    ||Buffer.byteLength(task.content,'utf8')>8192||task.content.includes('\0'))
    return denied('SOURCE_TASK_IDENTITY_INVALID');
  let content;try{content=JSON.parse(task.content);}catch{return denied('SOURCE_MANIFEST_INVALID');}
  if(!exact(content,['scopeId','changes'])||typeof content.scopeId!=='string'||!Object.hasOwn(RESCUE_ISLAND_SOURCE_PLANS,content.scopeId)
    ||!Array.isArray(content.changes)||content.changes.length<1||content.changes.length>6)
    return denied('SOURCE_MANIFEST_INVALID');
  const plan=RESCUE_ISLAND_SOURCE_PLANS[content.scopeId];
  if(task.issueNumber!==plan.issueNumber||task.issueTitle!==plan.issueTitle)
    return denied('SOURCE_OWNER_IDENTITY_INVALID');
  const paths=[],writes=[];
  for(const change of content.changes){
    const replacement=exact(change,['path','beforeBlob','content']);
    const patch=exact(change,['path','beforeBlob','afterSha256','edits']);
    if((!replacement && !patch)||typeof change.path!=='string'
      ||!plan.paths.includes(change.path)||(change.beforeBlob!==null
        &&(typeof change.beforeBlob!=='string'||!SHA.test(change.beforeBlob)))
      ||paths.includes(change.path)) return denied('SOURCE_CHANGE_NOT_ALLOWLISTED');
    if(replacement && (typeof change.content!=='string'||!change.content.length||change.content.includes('\0')
      ||Buffer.byteLength(change.content,'utf8')>8192))return denied('SOURCE_CONTENT_INVALID');
    if(patch && (change.beforeBlob===null || typeof change.afterSha256!=='string'
      || !/^[a-f0-9]{64}$/.test(change.afterSha256) || !Array.isArray(change.edits)
      || !change.edits.length || change.edits.length>8
      || change.edits.some(e=>!exact(e,['before','after']) || typeof e.before!=='string'
        || !e.before.length || typeof e.after!=='string' || e.before.includes('\0') || e.after.includes('\0'))))
      return denied('SOURCE_PATCH_INVALID');
    paths.push(change.path);writes.push(Object.freeze({...change,
      ...(patch?{edits:Object.freeze(change.edits.map(e=>Object.freeze({...e})))}:{})}));
  }
  if(JSON.stringify(paths)!==JSON.stringify([...paths].sort())||task.targetPath!==paths[0])
    return denied('SOURCE_SCOPE_ORDER_OR_PRIMARY_INVALID');
  const tests=new Set(plan.baseTests);
  for(const path of paths){
    if(path.endsWith('.test.mjs'))tests.add(path);
    else if(path.endsWith('.windows.mjs'))tests.add(path);
    else if(path.endsWith('rescueIslandSupervisedHostV1.mjs'))
      tests.add('shared/agents/rescueIslandSupervisedHostV1.windows.mjs');
    else tests.add(path.replace(/\.mjs$/,'.test.mjs'));
  }
  if([...tests].some(p=>!plan.paths.includes(p)&&!plan.baseTests.includes(p)))
    return denied('SOURCE_TEST_PLAN_NOT_ALLOWLISTED');
  return Object.freeze({valid:true,scopeId:content.scopeId,issueNumber:plan.issueNumber,
    taskKind:'SOURCE_PROPOSAL_V1',writes:Object.freeze(writes),targetPaths:Object.freeze(paths),
    testPaths:Object.freeze([...tests].sort()),needsNativeObserver:[...tests].some(p=>p.endsWith('.windows.mjs')),
    testProfile:[...tests].some(p=>p.endsWith('.windows.mjs'))?'NODE_AND_OBSERVED_NATIVE_HOST_SMOKE_V1':'NODE_SOURCE_V1',
    executionAuthority:false});
}
