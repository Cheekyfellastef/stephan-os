import { buildStephanosExecutiveChatBridge, STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE } from './stephanosExecutiveChatBridgeService.js';

export const STEPHANOS_SUBMIT_GOAL_TOOL_SCHEMA_V1='stephanos.ai-submit-goal-tool.v1';
const GOAL=/^#?([1-9][0-9]{0,8})$/;
const CODE=/^[A-Z][A-Z0-9._:-]{0,159}$/;
const STATUS=STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE;

function issue(value) {
  if(typeof value!=='string' && typeof value!=='number')return null;
  const candidate=String(value);
  const match=GOAL.exec(candidate);
  return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
}
function hold(number,blocker,uncertain=false) {
  const reason=CODE.test(blocker||'')?blocker:'CANONICAL_GOAL_INGRESS_UNVERIFIED';
  return {
    output_text:'Goal '+(number?'#'+number:'submission')+' is not yet admitted to the canonical build conveyor. Blocker: '+reason+'. No worker pickup or build has been claimed.',
    data:{
      schemaVersion:STEPHANOS_SUBMIT_GOAL_TOOL_SCHEMA_V1,
      state:'HELD',goalIssueNumber:number,blocker:reason,
      canonicalGoalIngressAccepted:false,
      controlTowerBuildRequestSubmitted:false,
      workerClaimProven:false,workerStartedProven:false,
      goalCompletedProven:false,executionOutcomeUncertain:uncertain,
      duplicateRequestAllowed:false,sourceMutationAllowed:false,mergeAuthority:false,
    },
  };
}
// This does not authenticate an owner comment or dispatch a GitHub workflow.
// It reuses exactly the existing Stephanos executive handoff and canonical
// goal-admission service; missing alignment, original custody or wrong goal holds.
export async function submitGoalThroughStephanosV1(args={},context={},options={}) {
  const number=issue(args?.goalIssue);
  if(!number || !args || typeof args!=='object' || Array.isArray(args)
    || Reflect.ownKeys(args).length!==1 || !Object.hasOwn(args,'goalIssue'))
    return hold(null,'GOAL_ISSUE_NUMBER_INVALID');
  if(options?.bridge && options.testOnly!==true)
    throw new TypeError('submitGoal test dependency cannot be used in production');
  if(!context?.knowledgeTwin) return hold(number,'OPERATOR_ALIGNMENT_EVIDENCE_REQUIRED');
  const run=options?.testOnly===true && typeof options.bridge==='function'
    ? options.bridge : buildStephanosExecutiveChatBridge;
  let outcome;
  try {
    outcome=await run({
      prompt:'Please build goal #'+number+' through the existing canonical goal conveyor.',
      requestedGoalIssue:number,
      requestId:typeof context.requestId==='string'?context.requestId:'',
      knowledgeTwin:context.knowledgeTwin,
      sharedThreadId:context.sharedThreadId||null,
      operatorTurnId:context.operatorTurnId||null,
      nowUtc:typeof context.nowUtc==='string'?context.nowUtc:new Date().toISOString(),
      env:context.env||process.env,
    });
  } catch {
    // The executive handoff may already have been published before an error.
    // An ambiguous outcome is NEVER permission to issue the action again.
    return hold(number,'CANONICAL_GOAL_INGRESS_OUTCOME_UNKNOWN',true);
  }
  const acceptance=outcome?.canonicalIngress?.executiveIngressAcceptance;
  const accepted=outcome?.state===STATUS.DELEGATION_PUBLISHED
    && outcome?.canonicalIngress?.ok===true
    && acceptance?.accepted===true
    && acceptance?.acceptedGoalIssue===number
    && acceptance?.selectedGoal==='#'+number
    && outcome?.acknowledgement?.ok===true
    && outcome?.handoff?.record?.handoffId;
  if(!accepted) {
    const blocker=typeof outcome?.blocker==='string'&&CODE.test(outcome.blocker)
      ?outcome.blocker
      :outcome?.state===STATUS.WAITING_FOR_ELIGIBLE_WORK
        ?'DEPENDENCY_FRONTIER_NOT_READY'
        :outcome?.state===STATUS.APPROVAL_REQUIRED
          ?'ORIGINAL_OPERATOR_APPROVAL_REQUIRED'
          :'CANONICAL_GOAL_INGRESS_UNVERIFIED';
    const uncertain=Boolean(outcome?.publication?.ok || outcome?.canonicalIngress?.ingressOutcomeUncertain);
    return hold(number,blocker,uncertain);
  }
  return {
    output_text:'Goal #'+number+' has a durable canonical goal-ingress acknowledgement on the original conveyor. This does not prove a Mission Worker claim, STARTED receipt, material build, review, merge or installation.',
    data:{
      schemaVersion:STEPHANOS_SUBMIT_GOAL_TOOL_SCHEMA_V1,
      state:'CANONICAL_INGRESS_ACKNOWLEDGED',goalIssueNumber:number,blocker:'',
      handoffId:outcome.handoff.record.handoffId,
      canonicalGoalIngressAccepted:true,
      controlTowerBuildRequestSubmitted:false,
      workerClaimProven:false,workerStartedProven:false,
      goalCompletedProven:false,executionOutcomeUncertain:false,
      duplicateRequestAllowed:false,sourceMutationAllowed:false,mergeAuthority:false,
    },
  };
}
