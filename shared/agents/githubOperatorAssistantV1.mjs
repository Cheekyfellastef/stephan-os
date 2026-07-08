const FOCUS=[1284,1286,1287];
function text(v){return v==null?'':String(v).trim();}
function arr(v){return Array.isArray(v)?v:[];}
function uniq(a){return [...new Set(a)];}
function hasProof(e, pr, token){return arr(e).some(x=>Number(x.prNumber)===pr && text(x.marker)===token || (Number(x.prNumber)===pr && text(x.summary).includes(token)));}
function item(kind, input, reason){return {kind, number:Number(input.number), title:text(input.title), url:text(input.url), reason, headSha:text(input.headSha), claimedHeadSha:text(input.claimedHeadSha), branch:text(input.branch), issueNumbers: arr(input.issueNumbers).map(Number).filter(Boolean), evidenceRefs: arr(input.evidenceRefs).map(text).filter(Boolean)};}
export function buildGitHubOperatorBriefing(input={}){
 const now=text(input.generatedAtUtc)||'1970-01-01T00:00:00.000Z'; const evidence=arr(input.evidence); const prs=arr(input.pullRequests).slice().sort((a,b)=>Number(a.number)-Number(b.number)); const issues=arr(input.issues).slice().sort((a,b)=>Number(a.number)-Number(b.number));
 const ready=[], blocked=[], waitingForProof=[], waitingForOperator=[], waitingForImplementation=[];
 for(const pr of prs){ const n=Number(pr.number); const blockers=[]; let missing=false;
  if(n===1448 && hasProof(evidence,1448,'PR_PUBLICATION_VERIFIER_PASS')) pr.publicationVerified=true;
  const pubOk=pr.publicationVerified===true || hasProof(evidence,n,'PR_PUBLICATION_VERIFIER_PASS');
  if(!pubOk){ missing=true; waitingForProof.push(item('pr-missing-publication-proof',pr,'Missing PR publication proof from PRPublicationVerifier.')); }
  if(text(pr.claimedHeadSha)&&text(pr.headSha)&&text(pr.claimedHeadSha)!==text(pr.headSha)){ blocked.push(item('pr-head-mismatch',pr,'Claimed HEAD does not match GitHub/Battle Bridge proof.')); continue; }
  if(n===1444 && !(pr.hardenedRuntimeProof===true || hasProof(evidence,1444,'HARDENED_RUNTIME_PROOF_PASS'))){ blocked.push(item('pr-runtime-blocked',pr,'Runtime-blocked until hardened runtime proof exists.')); continue; }
  if(arr(pr.blockers).length){ blocked.push({...item('pr-blocked',pr,arr(pr.blockers).join(' | ')), blockers:arr(pr.blockers).map(text)}); continue; }
  if(missing || pr.proofStatus==='missing' || pr.proofStatus==='pending'){ if(!missing) waitingForProof.push(item('pr-waiting-for-proof',pr,'Proof is pending or missing.')); continue; }
  if(pr.operatorApprovalRequired===true || pr.reviewDecision==='operator'){ waitingForOperator.push(item('pr-waiting-for-operator',pr,'Operator approval is required.')); continue; }
  if(pr.readyForReview===true || (pubOk && pr.checksStatus==='pass')) ready.push(item('pr-ready-for-review',pr,'Publication proof and checks indicate review-ready.'));
 }
 for(const issue of issues){ const status=text(issue.status)||'waiting-for-implementation'; const target=status.includes('proof')?waitingForProof:status.includes('operator')?waitingForOperator:waitingForImplementation; target.push({kind:`issue-${status}`, number:Number(issue.number), title:text(issue.title), url:text(issue.url), reason:text(issue.reason)||status, priority:FOCUS.includes(Number(issue.number))?'focus':'normal'}); }
 const status=blocked.length?'BLOCKED':'PASS';
 const recommendedNextAction=blocked[0]?.reason || waitingForProof[0]?.reason || waitingForOperator[0]?.reason || waitingForImplementation[0]?.reason || ready[0]?.reason || 'No operator action required.';
 return {schemaVersion:'github-operator-assistant.v1',status,generatedAtUtc:now,focusIssues:FOCUS,readyForReview:ready,blocked,waitingForProof,waitingForOperator,waitingForImplementation,recommendedNextAction,evidence:evidence.map(e=>({kind:text(e.kind),prNumber:Number(e.prNumber)||null,issueNumber:Number(e.issueNumber)||null,marker:text(e.marker),summary:text(e.summary),ref:text(e.ref)}))};
}
export function renderGitHubOperatorBriefingHuman(b){const line=(label,a)=>`${label}: ${a.length?a.map(x=>`#${x.number} ${x.title||x.reason}`).join('; '):'none'}`;return [`GitHub Operator Assistant V1 — ${b.status}`,`Generated: ${b.generatedAtUtc}`,`Focus: ${b.focusIssues.map(n=>`#${n}`).join(', ')}`,line('Ready for review',b.readyForReview),line('Blocked',b.blocked),line('Waiting for proof',b.waitingForProof),line('Waiting for operator',b.waitingForOperator),line('Waiting for implementation',b.waitingForImplementation||[]),`Next: ${b.recommendedNextAction}`].join('\n');}
export const GITHUB_OPERATOR_ASSISTANT_ALLOWED_COMMANDS=Object.freeze(['node scripts/stephanos-github-operator-briefing.mjs --input <fixture.json>','gh pr list --repo <owner/repo> --state open --json number,title,url,headRefName,headRefOid,isDraft,mergeable,reviewDecision,statusCheckRollup','gh issue list --repo <owner/repo> --state open --json number,title,url,labels']);
