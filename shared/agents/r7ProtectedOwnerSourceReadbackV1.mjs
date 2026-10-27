import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { validateProtectedEnvironment } from './operatorMergeApprovalGate.mjs';
import { readBoundedPersonalRepositoryResponseBody, validatePersonalRepositoryDispatchWorkflowDefinition,
  validatePersonalRepositoryPriorJobEnvelope } from './operatorPersonalRepositoryMergeV1.mjs';
import { prepareR7FirstRootOwnerIntakeProposal, R7_FIRST_ROOT_INTAKE_MODE,
  R7_FIRST_ROOT_INTAKE_WORKFLOW } from './r7FirstRootOwnerIntakeProposalV1.mjs';
import { createR7FirstRootSourceEvidenceResolver,
  R7_SOURCE_EVIDENCE_REMAINING_GATES } from './r7FirstRootSourceEvidenceResolverV1.mjs';
import { inspectR7UntrustedOwnerEnvelopeChallenge } from './r7ProtectedOwnerEnvelopeV1.mjs';
import { buildR7NativeOwnerPeerPairing, matchesR7OwnerPeerEnrollmentComment } from './r7NativeOwnerPeerPairingV1.mjs';

// Actual owner/run/environment and source provenance readback, not host policy
// adoption. There is no OIDC request or caller-Boolean native gate here. The
// proposed issuer uses the explicit purpose-bound peer enrollment phase; a
// separate native signature/OS decision and custody remain mandatory there.
export const R7_OWNER_SOURCE_JOB = 'r7-first-root-owner-intake';
export const R7_OWNER_PEER_PREPARE_JOB = 'r7-first-root-peer-evidence';
export const R7_OWNER_SOURCE_WORKFLOW = '.github/workflows/operator-merge-approval-gate.yml';
export const R7_OWNER_SOURCE_SCHEMA = 'stephanos.r7-protected-owner-source-readback.v1';
const REPOSITORY = 'Cheekyfellastef/stephan-os', API = 'https://api.github.com/repos/' + REPOSITORY;
const ALL_JOBS = Object.freeze(['merge-group-evidence', 'operator-merge-queue-boundary',
  'personal-repository-evidence', 'operator-personal-repository-approval',
  'operator-personal-repository-squash-merge', R7_OWNER_PEER_PREPARE_JOB, R7_OWNER_SOURCE_JOB]);
const INPUT_FIELDS = Object.freeze(['permitWire','permitSha256','nativeAudience','nativeRecipientSpkiBase64',
  'dispatch','context','referencesWire','referencesSha256']);
const SOURCE_FACTS = Object.freeze(['reviewArtifactAuthenticated','sourceIdentityAuthenticated',
  'sourceMergeReadbackAuthenticated','sourceAdoptionAuthenticated','protectedSourceApprovalAuthenticated',
  'nativeImageProvenanceAuthenticated','historicalSourceCompletionAuthenticated']);
const NO_AUTHORITY = Object.freeze({
  policyAdopted:false, nativeEndpointAuthenticated:false, humanOsConsentProven:false,
  hostExecutionAuthorized:false, executorAdmitted:false, rootEnrollmentAuthorized:false,
  tokenIssuanceAuthorized:false, oidcTokenRequestPerformed:false, credentialReturned:false,
  independentSignatureProven:false, canonicalLeaseReleaseAuthorized:false,
  sourceMutationAuthorized:false, approvalCardCreated:false,
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
class Held extends Error { constructor(code) { super(code); this.code=code; } }
const need = (value, code) => { if (!value) throw new Held(code); };
const id = value => Number.isSafeInteger(value) && value > 0;
const stamp = value => typeof value==='string' && Number.isFinite(Date.parse(value));
const repo = value => value?.id===1179385578 && value.full_name===REPOSITORY
  && value.owner?.id===267490109 && value.owner.login==='Cheekyfellastef';
const owner = value => value?.id===267490109 && value.login==='Cheekyfellastef' && value.type==='User';
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const result = (classification, blockers, facts={}) => Object.freeze({
  schemaVersion:R7_OWNER_SOURCE_SCHEMA, classification,
  blockers:Object.freeze(blockers), ownerPeerEnrollmentAuthenticated:false, ...facts, ...NO_AUTHORITY,
  nativeOriginDependency:'INDEPENDENT_NATIVE_OS_DECISION_AND_CUSTODY_NOT_PROVEN_BY_SOURCE_READER',
});

export function heldR7OwnerSourceReadback(code='R7_OWNER_SOURCE_CLI_FAILED') {
  const fixed = typeof code==='string' && /^R7_[A-Z0-9_]{1,96}$/.test(code)
    ? code : 'R7_OWNER_SOURCE_CLI_FAILED';
  return result('R7_PROTECTED_OWNER_SOURCE_READBACK_HELD',[fixed],{
    sourceEvidenceAuthenticated:false,protectedCurrentRunAuthenticated:false,
    protectedEnvironmentOwnerDecisionAuthenticated:false,
  });
}

export function r7OwnerPeerFromSourceInput(input,nativeWindowWire) {
  need(typeof nativeWindowWire==='string' && Buffer.byteLength(nativeWindowWire)<=160,'R7_OWNER_NATIVE_WINDOW');
  const window=JSON.parse(nativeWindowWire);
  need(JSON.stringify(window)===nativeWindowWire && window && typeof window==='object' && !Array.isArray(window)
    && Object.keys(window).join('|')==='IssuedAtUtc|ExpiresAtUtc','R7_OWNER_NATIVE_WINDOW');
  const spkiDigest=hash(Buffer.from(input.nativeRecipientSpkiBase64,'base64'));
  const challenge=Object.freeze({Audience:input.nativeAudience,PublicSpkiBase64:input.nativeRecipientSpkiBase64,
    PublicSpkiSha256:spkiDigest,IssuedAtUtc:window.IssuedAtUtc,ExpiresAtUtc:window.ExpiresAtUtc});
  inspectR7UntrustedOwnerEnvelopeChallenge(challenge,input.permitSha256);
  const pairing=buildR7NativeOwnerPeerPairing(challenge,{expectedMain:input.context.sha,
    runId:input.context.runId,runAttempt:input.context.runAttempt,permitSha256:input.permitSha256});
  return Object.freeze({challenge,pairing});
}

function currentBinding(run, definition, jobs, environment, approvals, input, packet, phase, peer) {
  const context=input.context;
  need(validatePersonalRepositoryDispatchWorkflowDefinition([definition]).valid, 'R7_OWNER_WORKFLOW_DEFINITION');
  need(run?.id===Number(context.runId) && run.run_attempt===1 && context.runAttempt==='1'
    && run.workflow_id===definition.id && run.path===R7_OWNER_SOURCE_WORKFLOW
    && run.name==='Protected operator merge '+packet.candidate.sourceHead
    && run.display_title===run.name && run.event==='workflow_dispatch'
    && run.head_branch==='main' && run.head_sha===context.sha
    && repo(run.repository) && repo(run.head_repository)
    && owner(run.actor) && owner(run.triggering_actor)
    && run.status==='in_progress' && run.conclusion===null
    && stamp(run.created_at) && Date.parse(run.created_at)>=Date.parse(packet.issuedAtUtc)
    && Date.parse(run.created_at)<=Date.now(), 'R7_OWNER_CURRENT_RUN');
  const preparing=phase==='prepare';
  const expectedCurrentName=preparing?R7_OWNER_PEER_PREPARE_JOB:R7_OWNER_SOURCE_JOB;
  need(Array.isArray(jobs) && jobs.length>=(preparing?ALL_JOBS.length-1:ALL_JOBS.length) && jobs.length<=ALL_JOBS.length
    && new Set(jobs.map(job=>job.name)).size===jobs.length
    && jobs.every(job=>ALL_JOBS.includes(job.name) && job.run_attempt===1
      && validatePersonalRepositoryPriorJobEnvelope(run,job).valid), 'R7_OWNER_JOB_ESTATE');
  const job=jobs.find(value=>value.name===expectedCurrentName);
  const legacy=ALL_JOBS.filter(name=>![R7_OWNER_SOURCE_JOB,R7_OWNER_PEER_PREPARE_JOB].includes(name));
  need(legacy.every(name=>jobs.filter(value=>value.name===name&&value.status==='completed'&&value.conclusion==='skipped').length===1),
    'R7_OWNER_LEGACY_ROLES_NOT_SKIPPED');
  const other=jobs.find(value=>value.name===(preparing?R7_OWNER_SOURCE_JOB:R7_OWNER_PEER_PREPARE_JOB));
  need(preparing ? (!other || (['queued','waiting','pending'].includes(other.status)&&other.conclusion===null
    && other.started_at===null&&other.completed_at===null))
    : (other?.status==='completed'&&other.conclusion==='success'&&stamp(other.completed_at)
      &&Date.parse(other.completed_at)<=Date.parse(job?.started_at)), 'R7_OWNER_PAIRING_STAGE_ORDER');
  need(job && job.status==='in_progress' && job.conclusion===null && job.completed_at===null
    && stamp(job.started_at) && Date.parse(job.started_at)>=Date.parse(run.created_at)
    && Date.parse(job.started_at)<=Date.now()
    && job.runner_group_name==='GitHub Actions' && typeof job.runner_name==='string' && job.runner_name.length>0
    && Array.isArray(job.labels) && job.labels.includes('ubuntu-latest')
    && !job.labels.some(label=>typeof label!=='string' || label.toLowerCase()==='self-hosted'),
  'R7_OWNER_FIXED_SOURCE_JOB');
  need(id(environment?.id) && validateProtectedEnvironment(environment).valid,
    'R7_OWNER_ENVIRONMENT_CONFIGURATION');
  const rules=environment.protection_rules.filter(rule=>rule.type==='required_reviewers');
  need(rules.length===1 && rules[0].reviewers?.length===1
    && rules[0].reviewers[0].type==='User' && owner(rules[0].reviewers[0].reviewer),
  'R7_OWNER_ENVIRONMENT_REVIEWER_IDENTITY');
  // GitHub approval history has no attempt discriminator. Attempt1 is mandatory;
  // a historical decision must never be reused as an approved rerun.
  if(!preparing)need(Array.isArray(approvals) && approvals.length===1 && approvals[0].state==='approved'
    && owner(approvals[0].user) && approvals[0].environments?.length===1
    && approvals[0].environments[0].id===environment.id
    && approvals[0].environments[0].name==='operator-merge-approval', 'R7_OWNER_CURRENT_APPROVAL');
  if(phase==='enroll')need(peer&&matchesR7OwnerPeerEnrollmentComment(approvals[0].comment,peer.pairing),
    'R7_OWNER_EXPLICIT_PEER_ENROLLMENT_REQUIRED');
  return {
    run:{id:run.id,attempt:run.run_attempt,workflowId:run.workflow_id,path:run.path,
      name:run.name,event:run.event,head:run.head_sha,branch:run.head_branch,
      actorId:run.actor.id,triggeringActorId:run.triggering_actor.id,
      repositoryId:run.repository.id,headRepositoryId:run.head_repository.id,
      createdAt:run.created_at,status:run.status,conclusion:run.conclusion},
    job:{id:job.id,name:job.name,runId:job.run_id,attempt:job.run_attempt,
      head:job.head_sha,status:job.status,conclusion:job.conclusion,startedAt:job.started_at,
      runnerName:job.runner_name,runnerGroup:job.runner_group_name,labels:job.labels,
      apiUrl:job.url,runUrl:job.run_url,checkUrl:job.check_run_url,htmlUrl:job.html_url},
    otherJobs:jobs.filter(value=>value!==job).map(value=>({id:value.id,name:value.name,
      status:value.status,conclusion:value.conclusion})).sort((a,b)=>a.name.localeCompare(b.name)),
    definition,environment,approvals,
  };
}

export function createR7ProtectedOwnerSourceReadback(options={}) {
  need(Object.keys(options).length===1 && Object.hasOwn(options,'githubReadToken'), 'R7_OWNER_READ_TOKEN_MAPPING');
  const token=options.githubReadToken;
  need(typeof token==='string' && token.length>=8 && token.length<=4096 && /^[\x21-\x7e]+$/.test(token),
    'R7_OWNER_READ_TOKEN_MAPPING');
  const request=globalThis.fetch.bind(globalThis);
  const sourceResolver=createR7FirstRootSourceEvidenceResolver({githubReadToken:token});
  const execute=async(wire,phase,nativeWindowWire)=>{
    let count=0;
    try {
      const began=performance.now();
      need(typeof wire==='string' && Buffer.byteLength(wire)<=49152, 'R7_OWNER_INPUT_BYTES');
      const input=JSON.parse(wire);
      need(JSON.stringify(input)===wire && input && typeof input==='object' && !Array.isArray(input)
        && Object.keys(input).sort().join('|')===[...INPUT_FIELDS].sort().join('|'), 'R7_OWNER_INPUT_CANONICAL');
      need(prepareR7FirstRootOwnerIntakeProposal({...input,nowUtc:new Date().toISOString()}).classification
        ==='R7_FIRST_ROOT_INTAKE_PREPARED_HELD', 'R7_OWNER_PERMIT_CONTEXT');
      const packet=JSON.parse(input.permitWire);
      const peer=phase==='source'?null:r7OwnerPeerFromSourceInput(input,nativeWindowWire);
      const alive=()=>need(performance.now()-began<150000 && Date.now()<Date.parse(packet.expiresAtUtc),
        'R7_OWNER_READBACK_EXPIRED');
      const headers=Object.freeze({Accept:'application/vnd.github+json',
        'X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+token});
      async function get(suffix) {
        alive(); need(++count<=24,'R7_OWNER_REQUEST_BUDGET');
        const url=API+suffix;
        const response=await request(url,{method:'GET',redirect:'manual',headers,signal:AbortSignal.timeout(10000)});
        try {
          need(response.status===200 && response.url===url && response.redirected===false,
            'R7_OWNER_API_ORIGIN_OR_STATUS');
          need(/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''), 'R7_OWNER_API_CONTENT_TYPE');
          const length=response.headers.get('content-length');
          need(length===null || (/^[0-9]+$/.test(length) && Number(length)<=524288), 'R7_OWNER_API_BODY_BOUND');
          const bytes=await readBoundedPersonalRepositoryResponseBody(response,524288);
          return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        } finally { try { await response.body?.cancel(); } catch {} }
      }
      async function jobs() {
        const response=await get('/actions/runs/'+input.context.runId+'/attempts/1/jobs?filter=all&per_page=100&page=1');
        need(id(response?.total_count) && response.total_count>=(phase==='prepare'?ALL_JOBS.length-1:ALL_JOBS.length)
          &&response.total_count<=ALL_JOBS.length
          && Array.isArray(response.jobs) && response.jobs.length===response.total_count
          && response.jobs.every(job=>id(job?.id))
          && new Set(response.jobs.map(job=>job.id)).size===response.total_count, 'R7_OWNER_JOB_PAGE');
        return response.jobs;
      }
      async function readBinding() {
        const [definition,run,jobSet,environment,approvals]=await Promise.all([
          get('/actions/workflows/operator-merge-approval-gate.yml'), get('/actions/runs/'+input.context.runId), jobs(),
          get('/environments/operator-merge-approval'), phase==='prepare'?Promise.resolve(null):get('/actions/runs/'+input.context.runId+'/approvals'),
        ]);
        return currentBinding(run,definition,jobSet,environment,approvals,input,packet,phase,peer);
      }
      const initial=await readBinding();
      const source=await sourceResolver.resolve(input);
      alive();
      need(SOURCE_FACTS.every(field=>source[field]===true)
        && source.classification==='R7_FIRST_ROOT_SOURCE_EVIDENCE_HELD'
        && source.permitDigest===input.permitSha256 && source.sourceHead===packet.candidate.sourceHead
        && source.sourceTree===packet.candidate.sourceTree && source.expectedMain===packet.candidate.expectedMain
        && source.referencesDigest===input.referencesSha256
        && Array.isArray(source.blockers)
        && [...source.blockers].sort().join('|')===[...R7_SOURCE_EVIDENCE_REMAINING_GATES].sort().join('|')
        && Object.keys(NO_AUTHORITY).filter(field=>Object.hasOwn(source,field)).every(field=>source[field]===false),
      'R7_OWNER_EXACT_SOURCE_EVIDENCE');
      const final=await readBinding();
      need(same(initial,final),'R7_OWNER_AUTHORITY_CHANGED_DURING_READ');
      alive();
      if(peer)inspectR7UntrustedOwnerEnvelopeChallenge(peer.challenge,input.permitSha256);
      const classification=phase==='prepare'?'R7_OWNER_PEER_PREPARED_EXPLICIT_ENROLLMENT_REQUIRED'
        :phase==='enroll'?'R7_OWNER_EPHEMERAL_PEER_ENROLLMENT_AUTHENTICATED_NATIVE_DECISION_REQUIRED'
        :'R7_PROTECTED_OWNER_SOURCE_EVIDENCE_AUTHENTICATED_NATIVE_HANDOFF_REQUIRED';
      return result(classification,
        [phase==='prepare'?'R7_OWNER_EXPLICIT_PEER_ENROLLMENT_REQUIRED':'R7_INDEPENDENT_NATIVE_OS_DECISION_AND_CUSTODY_REQUIRED'], {
          sourceEvidenceAuthenticated:true,protectedCurrentRunAuthenticated:true,
          protectedEnvironmentOwnerDecisionAuthenticated:phase!=='prepare',
          ownerPeerEnrollmentAuthenticated:phase==='enroll',
          ...(peer?{nativeOperationPurpose:peer.pairing.values.purpose,
            peerBindingWire:peer.pairing.wire,peerBindingFingerprint:peer.pairing.fingerprint,
            peerApprovalComment:peer.pairing.approvalComment,peerRunUrl:peer.pairing.runUrl,
            nativeChallengeExpiresAtUtc:peer.challenge.ExpiresAtUtc}:{}),
          observedAtUtc:new Date().toISOString(),inputSha256:hash(wire),permitSha256:input.permitSha256,
          sourceHead:packet.candidate.sourceHead,sourceTree:packet.candidate.sourceTree,
          reviewedBase:packet.candidate.reviewedBase,expectedMain:packet.candidate.expectedMain,
          runId:input.context.runId,runAttempt:'1',jobId:String(final.job.id),
          protectedOwnerBindingSha256:hash(JSON.stringify(final)),sourceEvidenceSha256:hash(JSON.stringify(source)),
          requestCount:count+source.requestCount,
        });
    } catch(error) {
      return result('R7_PROTECTED_OWNER_SOURCE_READBACK_HELD',
        [error instanceof Held?error.code:'R7_OWNER_SOURCE_READBACK_FAILED'], {
          sourceEvidenceAuthenticated:false,protectedCurrentRunAuthenticated:false,
          protectedEnvironmentOwnerDecisionAuthenticated:false,
        });
    }
  };
  return Object.freeze({resolve:wire=>execute(wire,'source',null),
    preparePeer:(wire,nativeWindowWire)=>execute(wire,'prepare',nativeWindowWire),
    authorizePeer:(wire,nativeWindowWire)=>execute(wire,'enroll',nativeWindowWire)});
}

// Trusted workflow code calls this before mapping its read-only credential.
// These are context/shape checks; actual identities and decisions are then read
// from GitHub. The event/context strings never become an OS approval receipt.
export function buildR7OwnerSourceReadbackInput(event, runtime) {
  need(event && typeof event==='object' && !Array.isArray(event) && runtime && typeof runtime==='object',
    'R7_OWNER_EVENT_CONTEXT');
  need(runtime.GITHUB_ACTIONS==='true' && runtime.RUNNER_ENVIRONMENT==='github-hosted'
    && runtime.RUNNER_OS==='Linux' && runtime.RUNNER_ARCH==='X64'
    && [R7_OWNER_SOURCE_JOB,R7_OWNER_PEER_PREPARE_JOB].includes(runtime.GITHUB_JOB) && runtime.GITHUB_EVENT_NAME==='workflow_dispatch'
    && runtime.GITHUB_REPOSITORY===REPOSITORY && runtime.GITHUB_REPOSITORY_ID==='1179385578'
    && runtime.GITHUB_REPOSITORY_OWNER_ID==='267490109'
    && runtime.GITHUB_ACTOR==='Cheekyfellastef' && runtime.GITHUB_ACTOR_ID==='267490109'
    && runtime.GITHUB_TRIGGERING_ACTOR==='Cheekyfellastef'
    && runtime.GITHUB_REF==='refs/heads/main' && runtime.GITHUB_REF_TYPE==='branch'
    && runtime.GITHUB_WORKFLOW_REF===R7_FIRST_ROOT_INTAKE_WORKFLOW
    && runtime.GITHUB_WORKFLOW_SHA===runtime.GITHUB_SHA
    && /^[a-f0-9]{40}$/.test(runtime.GITHUB_SHA||'')
    && /^[1-9][0-9]*$/.test(runtime.GITHUB_RUN_ID||'') && id(Number(runtime.GITHUB_RUN_ID))
    && runtime.GITHUB_RUN_ATTEMPT==='1'
    && runtime.GITHUB_SERVER_URL==='https://github.com' && runtime.GITHUB_API_URL==='https://api.github.com',
  'R7_OWNER_TRUSTED_JOB_CONTEXT');
  need(!Object.hasOwn(runtime,'ACTIONS_ID_TOKEN_REQUEST_TOKEN') && !Object.hasOwn(runtime,'ACTIONS_ID_TOKEN_REQUEST_URL'),
    'R7_SOURCE_ONLY_JOB_OIDC_PERMISSION_FORBIDDEN');
  const inputs=event.inputs;
  const extra=['r7_source_references_json','r7_source_references_sha256'];
  const nativeWindows=['r7_native_challenge_issued_at_utc','r7_native_challenge_expires_at_utc'];
  const allowed=['mode','pr_number','expected_branch','expected_head','expected_head_tree','expected_base',
    'independent_review_run_id','independent_review_run_attempt','independent_review_artifact_id',
    'independent_review_artifact_digest','independent_review_payload_sha256','authorization_comment_id',
    'r7_owner_permit_json','r7_owner_permit_sha256','r7_native_challenge_audience','r7_native_recipient_spki_base64',...extra,...nativeWindows];
  need(inputs && typeof inputs==='object' && !Array.isArray(inputs)
    && Object.keys(inputs).every(key=>allowed.includes(key))
    && allowed.filter(key=>key!=='authorization_comment_id'&&!nativeWindows.includes(key)).every(key=>typeof inputs[key]==='string' && inputs[key].length>0)
    && inputs.mode===R7_FIRST_ROOT_INTAKE_MODE && (inputs.authorization_comment_id??'')===''
    && repo(event.repository) && owner(event.sender), 'R7_OWNER_EVENT_INPUTS');
  const dispatch=Object.fromEntries(allowed.filter(key=>!extra.includes(key)&&!nativeWindows.includes(key)).map(key=>[key,inputs[key]??'']));
  const context={eventName:runtime.GITHUB_EVENT_NAME,mode:inputs.mode,
    repository:runtime.GITHUB_REPOSITORY,repositoryId:runtime.GITHUB_REPOSITORY_ID,
    ownerId:runtime.GITHUB_REPOSITORY_OWNER_ID,actor:runtime.GITHUB_ACTOR,actorId:runtime.GITHUB_ACTOR_ID,
    triggeringActor:runtime.GITHUB_TRIGGERING_ACTOR,ref:runtime.GITHUB_REF,sha:runtime.GITHUB_SHA,
    workflowRef:runtime.GITHUB_WORKFLOW_REF,runId:runtime.GITHUB_RUN_ID,runAttempt:runtime.GITHUB_RUN_ATTEMPT};
  const input={permitWire:inputs.r7_owner_permit_json,permitSha256:inputs.r7_owner_permit_sha256,
    nativeAudience:inputs.r7_native_challenge_audience,nativeRecipientSpkiBase64:inputs.r7_native_recipient_spki_base64,
    dispatch,context,referencesWire:inputs.r7_source_references_json,referencesSha256:inputs.r7_source_references_sha256};
  need(prepareR7FirstRootOwnerIntakeProposal({...input,nowUtc:new Date().toISOString()}).classification
    ==='R7_FIRST_ROOT_INTAKE_PREPARED_HELD', 'R7_OWNER_PERMIT_CONTEXT');
  const wire=JSON.stringify(input);
  need(Buffer.byteLength(wire)<=49152,'R7_OWNER_INPUT_BYTES');
  return wire;
}
