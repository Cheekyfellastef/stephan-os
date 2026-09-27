import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendWorkspaceJsonl, listLatestSharedWorkspaceParticipantStatuses } from './sharedAgentWorkspaceStore.mjs';
import { buildRecurringCapabilityCalibrationReadinessV1 } from './recurringMultiAgentCapabilityCalibrationV1.mjs';
import { buildVrResearchWorkspaceProjection } from './vrResearchWorkspaceProjectionV1.mjs';
import { CORE_CALIBRATION_PARTICIPANTS, executeCoreParticipantTenQuestionExamV1 } from './coreParticipantCalibrationExecutionV1.mjs';
import { VR_RESEARCH_QUESTION_CLASSES, answerVrResearchQuestion, createVrResearchQuestion, createVrResearchProjectionProofBinding } from './vrResearchParticipantQaV1.mjs';

export const RECURRING_CALIBRATION_RUNNER_SCHEMA = 'stephanos.recurring-calibration-runner.v1';

const VR_QUESTIONS = Object.freeze({
  SOURCE_STACK:'What canonical VR research sources are currently available to you?',
  NEXT_EXPERIMENT:'What is the next VR research experiment or queued investigation?',
  EVIDENCE_PLANE:'What evidence plane supports the current Starfield VR runtime state?',
  AUTHORING_VS_RUNTIME:'What can you prove from authoring evidence versus observed runtime or headset evidence?',
  VORPX_BASELINE:'What is the current vorpX baseline in canonical VR research?',
  SKYRIM_PARITY:'What Skyrim VR parity source is available as the quality benchmark?',
  LICENCE_BOUNDARIES:'Which projected VR sources have reuse or licence restrictions?',
  SPATIAL_BRIDGE_BLOCKERS:'What currently blocks stronger Spatial Bridge runtime claims?',
  NEXT_BOUNDED_GOAL:'What is the next bounded authorised VR action?',
  KNOWN_UNKNOWNS:'What important VR unknowns or evidence gaps remain?',
});

async function loadCanonicalVrProjection(repoRoot, nowUtc) {
  const lab = join(repoRoot, 'VR-Research-Lab');
  const [sourceRegistry, workspaceModel] = await Promise.all([
    readFile(join(lab, 'knowledge-sources.json'), 'utf8').then(JSON.parse),
    readFile(join(lab, 'lab-workspace.json'), 'utf8').then(JSON.parse),
  ]);
  const proofRef='evidence/receipts/vr-research-lab-canonical';
  const projection=buildVrResearchWorkspaceProjection({
    sourceRegistry, workspaceModel, updatedAt: nowUtc, proofRefs:[proofRef],
  });
  const expectedBinding=createVrResearchProjectionProofBinding(projection);
  if(!expectedBinding) throw new Error('canonical-vr-projection-proof-binding-invalid');
  const proofVerifier=(ref,binding)=>{
    if(ref!==proofRef || !binding || typeof binding!=='object') return false;
    if(Object.keys(expectedBinding).some(key=>binding[key]!==expectedBinding[key])) return false;
    return Object.freeze({verified:true,proofRef:ref,...expectedBinding});
  };
  return Object.freeze({projection,proofVerifier});
}

export async function executeVrResearchCalibrationV1(options = {}) {
  const nowUtc=options.nowUtc || new Date().toISOString();
  const repoRoot=options.repoRoot || process.cwd();
  const loaded=await (options.loadVrProjection || loadCanonicalVrProjection)(repoRoot, nowUtc);
  const projection=loaded?.projection || loaded;
  const trustedProofVerifier=options.loadVrProjection ? options.proofVerifier : loaded?.proofVerifier;
  const answerQuestion=options.answerVrQuestion || answerVrResearchQuestion;
  const answers=[]; const gaps=[];
  for (const [index,questionClass] of VR_RESEARCH_QUESTION_CLASSES.entries()) {
    const request=createVrResearchQuestion({
      questionId:'vr-calibration-'+nowUtc.replace(/[^0-9]/g,'')+'-q'+String(index+1).padStart(2,'0'),
      askerParticipantId:'durable-flywheel-controller',
      questionClass,
      questionText:VR_QUESTIONS[questionClass],
      subjectRef:questionClass==='EVIDENCE_PLANE'?'starfield-vr':'',
      createdAtUtc:nowUtc,
    });
    const result=answerQuestion(request,projection,{nowMs:Date.parse(nowUtc),answeredAtUtc:nowUtc,proofVerifier:trustedProofVerifier});
    if (result?.valid !== true || !result.answer) throw new Error('vr-calibration-answer-invalid:'+questionClass);
    answers.push(result.answer);
    if (result.gapObservation) gaps.push(result.gapObservation);
  }
  return Object.freeze({
    schemaVersion:RECURRING_CALIBRATION_RUNNER_SCHEMA,
    participantId:'stephanos-vr-research',
    questionCount:answers.length,
    groundedCount:answers.filter(a=>a.answerVerdict==='ANSWERED_GROUNDED').length,
    gapCount:gaps.length,
    answers:Object.freeze(answers),
    gapObservations:Object.freeze(gaps),
    requiresRepairReplay:gaps.length>0,
    existingGoalCandidates:Object.freeze([...new Set(gaps.flatMap(g=>g.existingGoalCandidates || []))]),
  });
}

export async function runRecurringCalibrationReadinessV1(options = {}) {
  const nowUtc = options.nowUtc || new Date().toISOString();
  const trigger = String(options.trigger || 'SCHEDULED').toUpperCase();
  const workspaceRoot = options.workspaceRoot || options.root;
  const loadStatuses = options.loadParticipantStatuses || listLatestSharedWorkspaceParticipantStatuses;
  const publishRecord = options.publishRecord || (async (record) =>
    appendWorkspaceJsonl(workspaceRoot, ['events', 'capability-calibration.jsonl'], record, { repoRoot: options.repoRoot, nowMs: Date.parse(nowUtc) }));
  if (!workspaceRoot && !options.loadParticipantStatuses) return Object.freeze({ schemaVersion: RECURRING_CALIBRATION_RUNNER_SCHEMA, ok:false, reason:'workspace-root-required' });
  const loaded=await loadStatuses(workspaceRoot,{repoRoot:options.repoRoot,nowMs:Date.parse(nowUtc)});
  const readiness=buildRecurringCapabilityCalibrationReadinessV1({nowUtc,trigger,participantStatusRecords:Array.isArray(loaded?.records)?loaded.records:[],intervalMs:options.intervalMs});
  if(readiness.valid!==true)return Object.freeze({schemaVersion:RECURRING_CALIBRATION_RUNNER_SCHEMA,ok:false,reason:'readiness-invalid',readiness});
  const vrDue=readiness.dueParticipantIds.includes('stephanos-vr-research');
  let vrCalibration=null;
  if(vrDue) vrCalibration=await executeVrResearchCalibrationV1({...options,nowUtc});
  const coreCalibrations=[];
  const executeCoreExam=options.executeCoreParticipantExam || executeCoreParticipantTenQuestionExamV1;
  for(const participantId of CORE_CALIBRATION_PARTICIPANTS){
    if(readiness.dueParticipantIds.includes(participantId)){
      coreCalibrations.push(await executeCoreExam({participantId,nowUtc,...(options.coreParticipantExamOptions||{})}));
    }
  }
  const receipt=Object.freeze({
    schemaVersion:RECURRING_CALIBRATION_RUNNER_SCHEMA,kind:'EVENT',
    eventId:'recurring-calibration-readiness-'+nowUtc.replace(/[^0-9]/g,''),
    participantId:'durable-flywheel-controller',timestampUtc:nowUtc,eventKind:'capability-calibration-readiness',
    summary:'Recurring calibration readiness: due='+readiness.dueParticipantIds.length+'; vrResearchDue='+vrDue+'; vrQuestions='+(vrCalibration?.questionCount||0)+'; vrGaps='+(vrCalibration?.gapCount||0)+'.',
    dueParticipantIds:readiness.dueParticipantIds,vrResearchDue:vrDue,trigger,
    coreCalibrations:coreCalibrations.map(result=>({participantId:result.participantId,questionCount:result.questionCount,answeredCount:result.answeredCount,gapCount:result.gapCount,requiresRepairReplay:result.requiresRepairReplay})),
    vrCalibration:vrCalibration?{participantId:vrCalibration.participantId,questionCount:vrCalibration.questionCount,groundedCount:vrCalibration.groundedCount,gapCount:vrCalibration.gapCount,requiresRepairReplay:vrCalibration.requiresRepairReplay,existingGoalCandidates:vrCalibration.existingGoalCandidates}:null,
  });
  const publication=await publishRecord(receipt);
  return Object.freeze({schemaVersion:RECURRING_CALIBRATION_RUNNER_SCHEMA,ok:publication?.ok!==false,reason:'RECURRING_CALIBRATION_READINESS_EVALUATED',readiness,vrCalibration,coreCalibrations:Object.freeze(coreCalibrations),receipt,publication});
}
