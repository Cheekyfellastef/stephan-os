// Synthetic records and fake read-only credentials only. Never live proof.
import { fixture,API,REPO } from './r7FirstRootSourceEvidenceResolverV1.fixture.mjs';
import { R7_FIRST_ROOT_INTAKE_WORKFLOW } from './r7FirstRootOwnerIntakeProposalV1.mjs';
import { R7_OWNER_SOURCE_JOB,R7_OWNER_PEER_PREPARE_JOB } from './r7ProtectedOwnerSourceReadbackV1.mjs';
export const READ_ONLY_FAKE='fixture-not-an-authentic-read-credential';
export function currentFixture({stage='authorize',pendingIssuer=true}={}) {
  const f=fixture(),input=f.input(),now=Date.now(),preparing=stage==='prepare';
  const who={id:267490109,login:'Cheekyfellastef',type:'User'};
  const repository=structuredClone(f.resources.get(API));
  const title='Protected operator merge '+f.packet.candidate.sourceHead;
  const runtime={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',RUNNER_ARCH:'X64',
    GITHUB_JOB:preparing?R7_OWNER_PEER_PREPARE_JOB:R7_OWNER_SOURCE_JOB,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:REPO,
    GITHUB_REPOSITORY_ID:'1179385578',GITHUB_REPOSITORY_OWNER_ID:'267490109',
    GITHUB_ACTOR:'Cheekyfellastef',GITHUB_ACTOR_ID:'267490109',GITHUB_TRIGGERING_ACTOR:'Cheekyfellastef',
    GITHUB_REF:'refs/heads/main',GITHUB_REF_TYPE:'branch',GITHUB_WORKFLOW_REF:R7_FIRST_ROOT_INTAKE_WORKFLOW,
    GITHUB_WORKFLOW_SHA:f.packet.candidate.expectedMain,GITHUB_SHA:f.packet.candidate.expectedMain,
    GITHUB_RUN_ID:'789',GITHUB_RUN_ATTEMPT:'1',GITHUB_SERVER_URL:'https://github.com',GITHUB_API_URL:'https://api.github.com'};
  const issued=new Date(now-1000).toISOString(),expires=new Date(now+240000).toISOString();
  const nativeWindowWire=JSON.stringify({IssuedAtUtc:issued,ExpiresAtUtc:expires});
  const event={repository,sender:who,inputs:{...input.dispatch,
    r7_source_references_json:input.referencesWire,r7_source_references_sha256:input.referencesSha256,
    r7_native_challenge_issued_at_utc:issued,r7_native_challenge_expires_at_utc:expires}};
  const run={id:789,run_attempt:1,workflow_id:22,name:title,display_title:title,
    path:'.github/workflows/operator-merge-approval-gate.yml',event:'workflow_dispatch',
    repository,head_repository:repository,head_sha:f.packet.candidate.expectedMain,head_branch:'main',
    actor:who,triggering_actor:who,status:'in_progress',conclusion:null,
    created_at:new Date(now-40000).toISOString(),updated_at:new Date(now-10000).toISOString()};
  f.set('/actions/runs/789',run);
  const names=['merge-group-evidence','operator-merge-queue-boundary','personal-repository-evidence',
    'operator-personal-repository-approval','operator-personal-repository-squash-merge',R7_OWNER_PEER_PREPARE_JOB,R7_OWNER_SOURCE_JOB];
  const jobs=names.map((name,index)=>{const own=name===runtime.GITHUB_JOB,prepare=name===R7_OWNER_PEER_PREPARE_JOB;
    const queued=preparing&&name===R7_OWNER_SOURCE_JOB,id=9000+index;return {
      id,name,run_id:789,run_attempt:1,workflow_name:title,head_sha:run.head_sha,head_branch:'main',
      status:own?'in_progress':queued?'queued':'completed',conclusion:own||queued?null:prepare?'success':'skipped',
      url:API+'/actions/jobs/'+id,run_url:API+'/actions/runs/789',check_run_url:API+'/check-runs/'+id,
      html_url:'https://github.com/'+REPO+'/actions/runs/789/job/'+id,
      started_at:queued?null:new Date(now-(prepare?36000:30000)).toISOString(),
      completed_at:own||queued?null:new Date(now-(prepare?31000:30000)).toISOString(),
      runner_group_name:own||prepare?'GitHub Actions':null,runner_name:own||prepare?'GitHub Actions fixture':null,
      labels:own||prepare?['ubuntu-latest']:[],
    };});
  const ownerJob=jobs[6],prepareJob=jobs[5];
  if(preparing&&!pendingIssuer)jobs.pop();
  const jobPath='/actions/runs/789/attempts/1/jobs?filter=all&per_page=100&page=1';
  f.set(jobPath,{total_count:jobs.length,jobs});
  const environment=f.resources.get(API+'/environments/operator-merge-approval');
  environment.protection_rules[0].reviewers[0].reviewer={...who};
  f.set('/actions/runs/789/approvals',[{state:'approved',user:who,environments:[{id:91,name:'operator-merge-approval'}]}]);
  return {...f,event,runtime,run,jobs,jobPath,who,ownerJob,prepareJob,nativeWindowWire};
}
