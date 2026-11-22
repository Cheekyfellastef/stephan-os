import { LAB_SCHEMA, LAB_MARKER, LAB_REPOSITORY, LAB_WORKFLOW, LAB_BRANCH, LAB_ISO_SHA256, LAB_WIM_SHA256, parseLabApproval, inspectLabApproval } from './r7IsolatedNativeLabAdmissionV1.mjs';

const api='https://api.github.com/repos/Cheekyfellastef/stephan-os', h='a'.repeat(40),t='b'.repeat(40);
const user={login:'Cheekyfellastef',id:267490109,type:'User'};
function fixture(){
 const payload={schemaVersion:LAB_SCHEMA,operation:'RUN_R7_DISPOSABLE_NATIVE_SMOKE',repository:LAB_REPOSITORY,prNumber:3211,sourceHead:h,sourceTree:t,workflowRunId:200,workflowRunAttempt:1,nativeRunId:100,nativeRunAttempt:1,artifactId:300,artifactArchiveSha256:'c'.repeat(64),nativePackageSha256:'d'.repeat(64),driverSha256:'e'.repeat(64),clientSha256:'f'.repeat(64),officialIsoSha256:LAB_ISO_SHA256,installWimSha256:LAB_WIM_SHA256,expiresAtUtc:'2026-11-05T16:00:00.000Z',acceptEvaluationTerms:true};
 const comment={id:900,user,author_association:'OWNER',issue_url:api+'/issues/3258',created_at:'2026-11-05T14:00:00Z',updated_at:'2026-11-05T14:00:00Z',body:'\x60\x60\x60'+LAB_MARKER+'\n'+JSON.stringify(payload)+'\n\x60\x60\x60'};
 return {comment,run:{id:200,run_attempt:1,event:'workflow_dispatch',path:LAB_WORKFLOW,name:'Native Windows r7 Access Probe Proof',status:'in_progress',actor:user,triggering_actor:user,head_sha:h,head_repository:{full_name:LAB_REPOSITORY},created_at:'2026-11-05T13:59:00Z'},nativeRun:{id:100,run_attempt:1,event:'pull_request',path:LAB_WORKFLOW,status:'completed',conclusion:'success',head_sha:h,head_repository:{full_name:LAB_REPOSITORY},updated_at:'2026-11-05T13:58:00Z'},artifact:{id:300,expired:false,workflow_run:{id:100,head_sha:h,repository_id:1179385578},name:'r7-native-test-'+h+'-100-1',digest:'sha256:'+'c'.repeat(64),size_in_bytes:100000},pr:{number:3211,merged:true,head:{sha:h,ref:LAB_BRANCH,repo:{full_name:LAB_REPOSITORY}},base:{repo:{full_name:LAB_REPOSITORY}}},source:{head:h,tree:t,runId:200,runAttempt:1},packagePins:{schemaVersion:'stephanos.r7-native-test-package-pins.v1',sourceHead:h,sourceTree:t,runId:'100',runAttempt:'1',archiveSha256:'d'.repeat(64),driverLoaded:false,nativeCallbacksExecuted:false,productionAuthority:false,leaseChanged:false,components:[{name:'R7NativeQualification.sys',sha256:'e'.repeat(64)},{name:'R7NativeQualificationClient.exe',sha256:'f'.repeat(64)}]},nowUtc:'2026-11-05T14:01:00.000Z'};
}
const positive=inspectLabApproval(fixture());if(!positive.admitted||positive.productionAuthority||positive.claimMutationAuthority)throw Error('POSITIVE_FAILED '+JSON.stringify(positive));
const edits=[
 ['edited owner approval',x=>x.comment.updated_at='2026-11-05T14:00:01Z'],
 ['foreign owner',x=>x.comment.user={...user,id:1}],
 ['wrong mailbox',x=>x.comment.issue_url=api+'/issues/3149'],
 ['missing owner role',x=>x.comment.author_association='COLLABORATOR'],
 ['different actual hosted run',x=>x.run.id=201],
 ['replayed hosted attempt',x=>x.run.run_attempt=2],
 ['foreign dispatch actor',x=>x.run.actor={...user,id:1}],
 ['foreign triggering actor',x=>x.run.triggering_actor={...user,id:1}],
 ['wrong event',x=>x.run.event='pull_request'],
 ['approval predates run',x=>x.run.created_at='2026-11-05T14:00:01Z'],
 ['source checkout swap',x=>x.source.head='0'.repeat(40)],
 ['source tree swap',x=>x.source.tree='0'.repeat(40)],
 ['unmerged source',x=>x.pr.merged=false],
 ['wrong branch',x=>x.pr.head.ref='other'],
 ['wrong PR',x=>x.pr.number=3213],
 ['foreign source repo',x=>x.pr.head.repo.full_name='other/repo'],
 ['failed native proof',x=>x.nativeRun.conclusion='failure'],
 ['uncompleted native proof',x=>x.nativeRun.status='in_progress'],
 ['source proof spliced',x=>x.nativeRun.head_sha='0'.repeat(40)],
 ['proof completed after consent',x=>x.nativeRun.updated_at='2026-11-05T14:00:01Z'],
 ['artifact expired',x=>x.artifact.expired=true],
 ['artifact digest mismatch',x=>x.artifact.digest='sha256:'+'0'.repeat(64)],
 ['artifact from other run',x=>x.artifact.workflow_run.id=101],
 ['artifact from other repo',x=>x.artifact.workflow_run.repository_id=1],
 ['artifact unbounded',x=>x.artifact.size_in_bytes=4*1024*1024],
 ['package tree mismatch',x=>x.packagePins.sourceTree='0'.repeat(40)],
 ['package previously loaded',x=>x.packagePins.driverLoaded=true],
 ['package claims production',x=>x.packagePins.productionAuthority=true],
 ['package missing client',x=>x.packagePins.components.pop()],
 ['client component spliced',x=>x.packagePins.components[1].sha256='0'.repeat(64)],
 ['consent stale',x=>x.nowUtc='2026-11-05T14:11:00.000Z'],
 ['consent in future',x=>x.nowUtc='2026-11-05T13:59:59.000Z'],
 ['malformed consent',x=>x.comment.body='\x60\x60\x60'+LAB_MARKER+'\n{\n\x60\x60\x60'],
 ['duplicated consent block',x=>x.comment.body+='\n'+x.comment.body],
];
let count=1;for(const[name,edit]of edits){let x=structuredClone(fixture());edit(x);const r=inspectLabApproval(x);if(r.admitted)throw Error('UNSAFE_ACCEPT '+name);count++;}
for(const [name,edit]of [
 ['unknown authority field',p=>p.leaseReleaseAuthority=true],
 ['missing terms acceptance',p=>p.acceptEvaluationTerms=false],
 ['wrong consent source',p=>p.sourceHead='0'.repeat(40)],
 ['replayed comment on new run',p=>p.workflowRunId=201],
 ['wrong image',p=>p.officialIsoSha256='0'.repeat(64)],
 ['changed driver',p=>p.driverSha256='0'.repeat(64)],
 ['short consent expiry',p=>p.expiresAtUtc='2026-11-05T14:05:00.000Z']
]){const x=structuredClone(fixture());const p=parseLabApproval(x.comment);edit(p);x.comment.body='\x60\x60\x60'+LAB_MARKER+'\n'+JSON.stringify(p)+'\n\x60\x60\x60';if(inspectLabApproval(x).admitted)throw Error('UNSAFE_PAYLOAD '+name);count++;}
console.log(JSON.stringify({checks:count,failed:0,actualNetworkReads:0,sourceFilesChanged:false,guestStarted:false}));
