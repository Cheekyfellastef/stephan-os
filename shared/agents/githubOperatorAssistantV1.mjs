const FOCUS=[1284,1286,1287];
function text(v){return v==null?'':String(v).trim();}
function arr(v){return Array.isArray(v)?v:[];}
function uniq(a){return [...new Set(a)];}
function hasProof(e, pr, token){return arr(e).some(x=>Number(x.prNumber)===pr && text(x.marker)===token);}
function prHead(pr){return text(pr.headSha || pr.headRefOid);}
function prBranch(pr){return text(pr.branch || pr.headRefName);}
function checksPass(pr){
 const rollup=pr.statusCheckRollup;
 if(Array.isArray(rollup))return rollup.length>0&&rollup.every(check=>{
  const conclusion=text(check?.conclusion).toUpperCase();
  const state=text(check?.state).toUpperCase();
  const status=text(check?.status).toUpperCase();
  // Conflicting authoritative result aliases must not produce a ready signal.
  return (conclusion || state)==='SUCCESS' && (!conclusion || !state || conclusion===state) && (!status || status==='COMPLETED');
 });
 return text(pr.checksStatus).toLowerCase()==='pass';
}
function item(kind, input, reason){return {kind, number:Number(input.number), title:text(input.title), url:text(input.url), reason, headSha:prHead(input), claimedHeadSha:text(input.claimedHeadSha), branch:prBranch(input), issueNumbers: arr(input.issueNumbers).map(Number).filter(Boolean), evidenceRefs: arr(input.evidenceRefs).map(text).filter(Boolean)};}

function handoffDebtFromEvidence(evidence,now,prs=[]){
 const blocked=[], waiting=[];const nowMs=Date.parse(now);
 const prByNumber=new Map(prs.map(p=>[Number(p?.number),p]).filter(([n])=>Number.isInteger(n)&&n>0));
 const made=evidence.filter(e=>e?.kind==='goal-stage-handoff'&&text(e.marker)==='PRODUCED');
 const acks=evidence.filter(e=>e?.kind==='goal-stage-handoff'&&text(e.marker)==='ACKNOWLEDGED');
 const verified=evidence.filter(e=>e?.kind==='goal-stage-handoff'&&['VERIFIED_DONE','VERIFIED_FAILED'].includes(text(e.marker)));
 const producerRefCounts=new Map();
 for(const p of made){const ref=text(p.ref);if(ref)producerRefCounts.set(ref,(producerRefCounts.get(ref)||0)+1);}
 for(const p of made){
  const pr=Number(p.prNumber)||0,issue=Number(p.issueNumber)||0,head=text(p.sourceHead),base=text(p.baseSha);
  const receipt=text(p.ref),owner=text(p.nextOwner),action=text(p.nextAction);
  const madeAt=Date.parse(text(p.producedAtUtc)),due=Date.parse(text(p.dueAtUtc));
  const item={number:pr||issue,title:'Goal handoff',url:'',headSha:head,
   issueNumbers:issue?[issue]:[],evidenceRefs:receipt?[receipt]:[]};
  if(!(pr||issue)||!(/^[a-f0-9]{40}$/i.test(head)&&/^[a-f0-9]{40}$/i.test(base))||
      !receipt||!owner||!action||![nowMs,madeAt,due].every(Number.isFinite)||madeAt>nowMs||due<madeAt){
   blocked.push({...item,kind:'automation-debt-incomplete-handoff',
    reason:'Producer handoff lacks an exact owner, source/base, action, receipt or freshness bound.'});continue;
  }
  if(receipt&&producerRefCounts.get(receipt)>1){
   blocked.push({...item,kind:'automation-debt-duplicate-producer-receipt',
    reason:'Producer receipt is reused by multiple handoffs; receiver custody is ambiguous.'});continue;
  }
  // A valid historical ACK cannot qualify an older producer head after the PR advances.
  const current=prByNumber.get(pr);
  const currentHead=current?prHead(current):'';
  const currentBase=current?text(current.baseSha||current.baseRefOid):'';
  if(current&&((currentHead&&currentHead!==head)||(currentBase&&currentBase!==base))){
   blocked.push({...item,kind:'automation-debt-stale-source-identity',
    reason:'Producer handoff no longer matches the observed current PR head/base; refresh custody before proceeding.'});continue;
  }
  const receiverAcks=acks.filter(a=>text(a.producerReceiptRef)===receipt);
  const terminal=verified.filter(v=>text(v.producerReceiptRef)===receipt);
  if(terminal.length>1){blocked.push({...item,kind:'automation-debt-ambiguous-terminal-proof',reason:'Multiple terminal receipts claim the same producer identity.'});continue;}
  if(terminal.length&&!receiverAcks.length){blocked.push({...item,kind:'automation-debt-terminal-without-ack',reason:'Terminal completion claims lack a bound receiver acknowledgement.'});continue;}
  if(receipt&&receiverAcks.length>1){
   blocked.push({...item,kind:'automation-debt-ambiguous-receiver-ack',
    reason:'Multiple receiver acknowledgements reference the same producer receipt.'});continue;
  }
  const accepted=receiverAcks.some(a=>{
   const at=Date.parse(text(a.acknowledgedAtUtc));
   return text(a.producerReceiptRef)===receipt&&!!text(a.ref)&&
    Number(a.prNumber||0)===pr&&Number(a.issueNumber||0)===issue&&
    text(a.sourceHead)===head&&text(a.baseSha)===base&&
    text(a.receiverOwner)===owner&&text(a.nextAction)===action&&
    Number.isFinite(at)&&at>=madeAt&&at<=due&&at<=nowMs;
  });
  // Receiving work is not proof that the original user-facing capability is live.
  if(accepted){
   if(!terminal.length){waiting.push({...item,kind:'handoff-awaiting-terminal-verification',reason:'Receiver acknowledged the handoff; terminal capability proof remains outstanding.'});continue;}
   const ack=receiverAcks[0],v=terminal[0],at=Date.parse(text(v.verifiedAtUtc)),ackAt=Date.parse(text(ack.acknowledgedAtUtc));
   const matches=!!text(p.acceptancePredicate)&&!!text(v.ref)&&!!text(v.verificationRef)&&!!text(v.acceptancePredicate)&&
    text(v.receiverAckRef)===text(ack.ref)&&Number(v.prNumber||0)===pr&&
    Number(v.issueNumber||0)===issue&&text(v.sourceHead)===head&&text(v.baseSha)===base&&
    text(v.receiverOwner)===owner&&text(v.nextAction)===action&&
    text(v.acceptancePredicate)===text(p.acceptancePredicate)&&
    Number.isFinite(at)&&at>=ackAt&&at<=nowMs;
   if(!matches){blocked.push({...item,kind:'automation-debt-invalid-terminal-proof',reason:'Terminal claim lacks exact receiver, source, acceptance or verification binding.'});}
   else if(text(v.marker)==='VERIFIED_FAILED'){blocked.push({...item,kind:'automation-debt-verified-failed-outcome',reason:'Verified terminal failure does not satisfy the original capability acceptance predicate.'});}
   continue;
  }
  // A present but nonmatching ACK is a custody defect, not an outstanding handoff.
  if(receiverAcks.length===1){
   const at=Date.parse(text(receiverAcks[0].acknowledgedAtUtc));
   const expired=Number.isFinite(at)&&at>due&&nowMs>due;
   blocked.push({...item,kind:expired?'automation-debt-stale-handoff':'automation-debt-mismatched-receiver-ack',
    reason:expired?'Expired producer handoff has no timely receiver acknowledgement.':
     'Receiver acknowledgement fails exact producer identity, owner, action or freshness binding.'});continue;
  }
  const overdue=nowMs>due;
  (overdue?blocked:waiting).push({...item,
   kind:overdue?'automation-debt-stale-handoff':'handoff-awaiting-receiver-ack',
   reason:overdue?'Expired producer handoff has no exact receiver acknowledgement.':'Awaiting an exact receiver acknowledgement.'});
 }
 return {blocked,waiting};
}
export function buildGitHubOperatorBriefing(input={}){
 const now=text(input.generatedAtUtc)||'1970-01-01T00:00:00.000Z'; const evidence=arr(input.evidence); const prs=arr(input.pullRequests).slice().sort((a,b)=>Number(a.number)-Number(b.number)); const issues=arr(input.issues).slice().sort((a,b)=>Number(a.number)-Number(b.number));
 const ready=[], blocked=[], waitingForProof=[], waitingForOperator=[], waitingForImplementation=[];
 const debt=handoffDebtFromEvidence(evidence,now,prs); blocked.push(...debt.blocked); waitingForProof.push(...debt.waiting);
 for(const pr of prs){ const n=Number(pr.number); const blockers=[]; let missing=false;
  const pubOk=pr.publicationVerified===true || hasProof(evidence,n,'PR_PUBLICATION_VERIFIER_PASS');
  if(!pubOk){ missing=true; waitingForProof.push(item('pr-missing-publication-proof',pr,'Missing PR publication proof from PRPublicationVerifier.')); }
  if(text(pr.headSha)&&text(pr.headRefOid)&&text(pr.headSha)!==text(pr.headRefOid)){ blocked.push(item('pr-head-evidence-conflict',pr,'Conflicting GitHub HEAD identities require reconciliation.')); continue; }
  if(text(pr.claimedHeadSha)&&prHead(pr)&&text(pr.claimedHeadSha)!==prHead(pr)){ blocked.push(item('pr-head-mismatch',pr,'Claimed HEAD does not match GitHub/Battle Bridge proof.')); continue; }
  if(n===1444 && !(pr.hardenedRuntimeProof===true || hasProof(evidence,1444,'HARDENED_RUNTIME_PROOF_PASS'))){ blocked.push(item('pr-runtime-blocked',pr,'Runtime-blocked until hardened runtime proof exists.')); continue; }
  if(arr(pr.blockers).length){ blocked.push({...item('pr-blocked',pr,arr(pr.blockers).join(' | ')), blockers:arr(pr.blockers).map(text)}); continue; }
  if(missing || pr.proofStatus==='missing' || pr.proofStatus==='pending'){ if(!missing) waitingForProof.push(item('pr-waiting-for-proof',pr,'Proof is pending or missing.')); continue; }
  if(pr.operatorApprovalRequired===true || pr.reviewDecision==='operator'){ waitingForOperator.push(item('pr-waiting-for-operator',pr,'Operator approval is required.')); continue; }
  if(!checksPass(pr)){ waitingForProof.push(item('pr-checks-incomplete',pr,'Required checks are missing, pending or not successful.')); continue; }
  if(pr.isDraft===true){ waitingForProof.push(item('pr-draft-review-held',pr,'Draft PR cannot be promoted to review-ready.')); continue; }
  ready.push(item('pr-ready-for-review',pr,'Publication proof and checks indicate review-ready.'));
 }
 for(const issue of issues){ const status=text(issue.status)||'waiting-for-implementation'; const target=status.includes('proof')?waitingForProof:status.includes('operator')?waitingForOperator:waitingForImplementation; target.push({kind:`issue-${status}`, number:Number(issue.number), title:text(issue.title), url:text(issue.url), reason:text(issue.reason)||status, priority:FOCUS.includes(Number(issue.number))?'focus':'normal'}); }
 const status=blocked.length?'BLOCKED':waitingForProof.length?'WAITING_FOR_PROOF':waitingForOperator.length?'WAITING_FOR_OPERATOR':waitingForImplementation.length?'WAITING_FOR_IMPLEMENTATION':'PASS';
 const recommendedNextAction=blocked[0]?.reason || waitingForProof[0]?.reason || waitingForOperator[0]?.reason || waitingForImplementation[0]?.reason || ready[0]?.reason || 'No operator action required.';
 return {schemaVersion:'github-operator-assistant.v1',status,generatedAtUtc:now,focusIssues:FOCUS,readyForReview:ready,blocked,waitingForProof,waitingForOperator,waitingForImplementation,recommendedNextAction,evidence:evidence.map(e=>({kind:text(e.kind),prNumber:Number(e.prNumber)||null,issueNumber:Number(e.issueNumber)||null,marker:text(e.marker),summary:text(e.summary),ref:text(e.ref)}))};
}
export function renderGitHubOperatorBriefingHuman(b){const line=(label,a)=>`${label}: ${a.length?a.map(x=>`#${x.number} ${x.title||x.reason}`).join('; '):'none'}`;return [`GitHub Operator Assistant V1 — ${b.status}`,`Generated: ${b.generatedAtUtc}`,`Focus: ${b.focusIssues.map(n=>`#${n}`).join(', ')}`,line('Ready for review',b.readyForReview),line('Blocked',b.blocked),line('Waiting for proof',b.waitingForProof),line('Waiting for operator',b.waitingForOperator),line('Waiting for implementation',b.waitingForImplementation||[]),`Next: ${b.recommendedNextAction}`].join('\n');}
export const GITHUB_OPERATOR_ASSISTANT_ALLOWED_COMMANDS=Object.freeze(['node scripts/stephanos-github-operator-briefing.mjs --input <fixture.json>','gh pr list --repo <owner/repo> --state open --json number,title,url,headRefName,headRefOid,isDraft,mergeable,reviewDecision,statusCheckRollup','gh issue list --repo <owner/repo> --state open --json number,title,url,labels']);
