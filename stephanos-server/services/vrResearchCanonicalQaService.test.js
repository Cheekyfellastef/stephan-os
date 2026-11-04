import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCanonicalVrResearchAnswer } from './vrResearchCanonicalQaService.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const classes=['SOURCE_STACK','NEXT_EXPERIMENT','EVIDENCE_PLANE','AUTHORING_VS_RUNTIME','VORPX_BASELINE','SKYRIM_PARITY','LICENCE_BOUNDARIES','SPATIAL_BRIDGE_BLOCKERS','NEXT_BOUNDED_GOAL','KNOWN_UNKNOWNS'];
test('all ten classes answer from pinned canonical VR files without inventing proof',async()=>{
 for(const questionClass of classes){
   const result=await readCanonicalVrResearchAnswer({repoRoot:root,questionClass,nowUtc:'2026-10-08T09:00:00.000Z'});
   assert.equal(result.ok,true,JSON.stringify({questionClass,result}));
   assert.equal(result.participantId,'stephanos-vr-research');
   assert.equal(result.readOnly,true);
   assert.ok(result.projectionId);
   assert.ok(result.answer);
   if(result.answer.answerVerdict?.startsWith('GAP_'))assert.ok(result.gapObservation);
 }
});
test('rejects unrecognised and unsafe question classes before reading files',async()=>{
 const invalid=await readCanonicalVrResearchAnswer({repoRoot:root,questionClass:'RAW_SHELL'});
 assert.equal(invalid.ok,false);assert.equal(invalid.reason,'QUESTION_CLASS_NOT_SUPPORTED');
 const unsafe=await readCanonicalVrResearchAnswer({repoRoot:root,questionClass:'SOURCE_STACK',subjectRef:'../secret?token=1'});
 assert.equal(unsafe.ok,false);assert.equal(unsafe.reason,'SUBJECT_REF_INVALID');
});
test('missing pinned files fail closed rather than substituting private memory',async()=>{
 const missing=await readCanonicalVrResearchAnswer({repoRoot:'C:/missing-vr-repository',questionClass:'SOURCE_STACK'});
 assert.equal(missing.ok,false);assert.equal(missing.reason,'CANONICAL_VR_SOURCE_UNAVAILABLE');
});

test('source age is not renewed by a new Q&A request',async()=>{
  const readFileImpl=async(path)=>{
    if(path.endsWith('knowledge-sources.json'))return JSON.stringify({schema_version:'1.8',sources:[]});
    if(path.endsWith('lab-workspace.json'))return JSON.stringify({
      schemaVersion:'stephanos.vr-research-lab.workspace.v4',
      updatedAt:'2026-10-01T10:00:00.000Z',
      targets:[{name:'Starfield VR'}],experiments:[],
    });
    throw new Error('unexpected path');
  };
  const result=await readCanonicalVrResearchAnswer({
    repoRoot:root,questionClass:'SOURCE_STACK',
    nowUtc:'2026-10-28T18:00:00.000Z',readFileImpl,
  });
  assert.equal(result.ok,true);
  assert.equal(result.answer.freshness,'STALE');
  assert.equal(result.answer.answerVerdict,'GAP_FRESHNESS');
  assert.ok(result.gapObservation);
});

test('missing, blank or future-dated canonical timestamps never become FRESH',async()=>{
  for(const updatedAt of [undefined,'','2026-11-01T00:00:00.000Z']){
    const readFileImpl=async(path)=>{
      if(path.endsWith('knowledge-sources.json'))return JSON.stringify({schema_version:'1.8',sources:[]});
      if(path.endsWith('lab-workspace.json'))return JSON.stringify({
        ...(updatedAt===undefined?{}:{updatedAt}),targets:[{name:'Starfield VR'}],experiments:[],
      });
      throw new Error('unexpected path');
    };
    const result=await readCanonicalVrResearchAnswer({
      repoRoot:root,questionClass:'SOURCE_STACK',
      nowUtc:'2026-10-28T18:00:00.000Z',readFileImpl,
    });
    assert.equal(result.ok,true);
    assert.equal(result.answer.freshness,'UNKNOWN');
    assert.equal(result.answer.answerVerdict,'GAP_FRESHNESS');
  }
});

test('current source timestamp does not fabricate independent proof verification',async()=>{
  const nowUtc='2026-10-28T18:00:00.000Z';
  const readFileImpl=async(path)=>JSON.stringify(path.endsWith('knowledge-sources.json')
    ? {schema_version:'1.8',sources:[]}
    : {updatedAt:nowUtc,targets:[{name:'Starfield VR'}]});
  const result=await readCanonicalVrResearchAnswer({repoRoot:root,questionClass:'SOURCE_STACK',nowUtc,readFileImpl});
  assert.equal(result.ok,true);
  assert.equal(result.answer.freshness,'FRESH');
  assert.equal(result.answer.answerVerdict,'GAP_KNOWLEDGE');
});
