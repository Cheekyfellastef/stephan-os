import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { queryStephanosAI } from '../ai/stephanosClient.mjs';

const execFile=promisify(execFileCallback);
export const CORE_CALIBRATION_PARTICIPANTS=Object.freeze(['stephanos','openclaw-local','openclaw-standalone']);
export const CORE_CALIBRATION_QUESTION_CLASSES=Object.freeze([
 'CURRENT_PROGRAMME_TRUTH','ARCHITECTURE_AND_RELATIONSHIPS','MEMORY_AND_CONTINUITY','AGENT_AND_TOOL_CAPABILITIES','BLOCKERS_AND_PROOF',
 'WHY_A_DECISION_WAS_MADE','WHAT_CHANGED_RECENTLY','NEXT_BEST_ACTION','CROSS_DOMAIN_CONNECTION','SELF_KNOWLEDGE_AND_UNKNOWNS'
]);
const TEXT=Object.freeze({
 CURRENT_PROGRAMME_TRUTH:'What are you currently responsible for, and what evidence proves your current state?',
 ARCHITECTURE_AND_RELATIONSHIPS:'How do you relate to Stephanos, Shared Workspace, the flywheel, and the other agents?',
 MEMORY_AND_CONTINUITY:'What durable context can you recover after a restart, and what can you not recover?',
 AGENT_AND_TOOL_CAPABILITIES:'What tools and capabilities can you actually use now, and what important authority do you not have?',
 BLOCKERS_AND_PROOF:'What currently blocks you, and what exact proof would show the blocker is closed?',
 WHY_A_DECISION_WAS_MADE:'Name one important recent architectural decision affecting you and the evidence for why it was made.',
 WHAT_CHANGED_RECENTLY:'What materially changed for your capabilities recently, separating source claims from live proof?',
 NEXT_BEST_ACTION:'What is your next highest-value bounded action, and what evidence supports that choice?',
 CROSS_DOMAIN_CONNECTION:'What cross-agent or cross-domain connections can you prove rather than infer?',
 SELF_KNOWLEDGE_AND_UNKNOWNS:'What important facts can you not currently prove, and how should those gaps be repaired?'
});
const OPENCLAW_AGENT=Object.freeze({'openclaw-local':'stephanos-scout-coder','openclaw-standalone':'openclaw-standalone'});

async function defaultOpenClawAsk(participantId, question, options={}) {
 const agent=OPENCLAW_AGENT[participantId];
 if(!agent) throw new Error('unknown-openclaw-participant');
 const args=['agent'];
 if(participantId==='openclaw-local') args.push('--local','--model','ollama/qwen3-coder:30b');
 args.push('--agent',agent,'--session-key','agent:'+agent+':flywheel-calibration','--message',question,'--json','--timeout',String(options.timeoutSeconds||120));
 const run=await execFile('openclaw',args,{timeout:(options.timeoutSeconds||120)*1000,maxBuffer:1024*1024});
 const parsed=JSON.parse(run.stdout);
 const answer=String(parsed?.payloads?.[0]?.text || parsed?.output_text || parsed?.text || '').trim();
 if(!answer) throw new Error('openclaw-empty-calibration-answer');
 return answer;
}
async function defaultStephanosAsk(_participantId,question,options={}) {
 const result=await queryStephanosAI({provider:'ollama',messages:[{role:'user',content:question}],routeMode:'local-first',fallbackEnabled:true,runtimeContext:options.runtimeContext||{},fetchImpl:options.fetchImpl});
 const answer=String(result?.output_text||'').trim();
 if(!result?.success || !answer) throw new Error(String(result?.error||'stephanos-empty-calibration-answer'));
 return answer;
}
export async function executeCoreParticipantTenQuestionExamV1(input={}) {
 const participantId=String(input.participantId||'').trim().toLowerCase();
 if(!CORE_CALIBRATION_PARTICIPANTS.includes(participantId)) throw new Error('unsupported-core-calibration-participant');
 const ask=input.ask || (participantId==='stephanos'?defaultStephanosAsk:defaultOpenClawAsk);
 const answers=[]; const gaps=[];
 for(const [index,questionClass] of CORE_CALIBRATION_QUESTION_CLASSES.entries()){
  try {
   const answerText=await ask(participantId,TEXT[questionClass],input);
   answers.push(Object.freeze({questionNumber:index+1,questionClass,questionText:TEXT[questionClass],answerText,status:'ANSWERED'}));
  } catch(error) {
   const reason=String(error?.message||error);
   answers.push(Object.freeze({questionNumber:index+1,questionClass,questionText:TEXT[questionClass],answerText:'',status:'GAP_EXECUTION',reason}));
   gaps.push(Object.freeze({questionClass,reason,requiresExistingGoalSearch:true,repairReplayRequired:true}));
  }
 }
 return Object.freeze({participantId,questionCount:10,answeredCount:answers.filter(a=>a.status==='ANSWERED').length,gapCount:gaps.length,requiresRepairReplay:gaps.length>0,answers:Object.freeze(answers),gapObservations:Object.freeze(gaps)});
}
