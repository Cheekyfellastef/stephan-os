import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildVrResearchWorkspaceProjection } from '../../shared/agents/vrResearchWorkspaceProjectionV1.mjs';
import { answerVrResearchQuestion, createVrResearchQuestion, VR_RESEARCH_QUESTION_CLASSES } from '../../shared/agents/vrResearchParticipantQaV1.mjs';
export const VR_RESEARCH_QA_ROUTE='/api/shared-workspace/vr-research-qa';
const SAFE_REPO = /^[a-zA-Z]:[\\/]|^\//;
export async function readCanonicalVrResearchAnswer({ repoRoot=process.cwd(), questionClass, subjectRef='', nowUtc=new Date().toISOString(), readFileImpl=readFile, proofVerifier }={}) {
  if(!VR_RESEARCH_QUESTION_CLASSES.includes(String(questionClass||''))) return {ok:false,reason:'QUESTION_CLASS_NOT_SUPPORTED',allowedClasses:VR_RESEARCH_QUESTION_CLASSES};
  if(typeof subjectRef !== 'string'||subjectRef.length>120||!/^[a-zA-Z0-9 :_.#/-]*$/.test(subjectRef)) return {ok:false,reason:'SUBJECT_REF_INVALID'};
  if(!SAFE_REPO.test(String(repoRoot))) return {ok:false,reason:'REPOSITORY_ROOT_INVALID'};
  let registry,workspace;
  try{
    [registry,workspace]=await Promise.all([
      readFileImpl(resolve(repoRoot,'VR-Research-Lab/knowledge-sources.json'),'utf8').then(JSON.parse),
      readFileImpl(resolve(repoRoot,'VR-Research-Lab/lab-workspace.json'),'utf8').then(JSON.parse),
    ]);
  }catch{return {ok:false,reason:'CANONICAL_VR_SOURCE_UNAVAILABLE'};}
  const projection=buildVrResearchWorkspaceProjection({sourceRegistry:registry,workspaceModel:workspace,updatedAt:nowUtc});
  const request=createVrResearchQuestion({
    questionId:'vr-route-'+String(questionClass).toLowerCase()+'-'+nowUtc.replace(/[^0-9]/g,'').slice(0,14),
    askerParticipantId:'stephanos-command-deck',
    questionClass,
    questionText:'Provide current canonical VR research evidence for '+questionClass,
    subjectRef,
    createdAtUtc:nowUtc,
  });
  // No source can confer proof on itself. A caller may supply an independent,
  // bounded verification function; the HTTP route intentionally does not.
  const result=answerVrResearchQuestion(request,projection,{answeredAtUtc:nowUtc,nowMs:Date.parse(nowUtc),proofVerifier});
  return {ok:result.valid===true,readOnly:true,participantId:'stephanos-vr-research',projectionId:projection.projectionId,answer:result.answer,gapObservation:result.gapObservation,reason:result.valid?'VR_RESEARCH_CANONICAL_ANSWER':'VR_RESEARCH_REQUEST_REJECTED'};
}
