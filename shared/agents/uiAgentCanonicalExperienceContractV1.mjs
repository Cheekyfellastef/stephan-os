import { createHash } from 'node:crypto';
import {
  UI_AGENT_EXPERIENCE_INVENTORY_SCHEMA_VERSION,
  UI_AGENT_REQUIRED_PROOF_CLASSES,
} from './uiAgentExperienceInventoryV1.mjs';

export const UI_AGENT_CANONICAL_EXPERIENCE_CONTRACT_SCHEMA_VERSION = 'stephanos.ui-agent.canonical-experience-contract.v1';
export const UI_AGENT_CANONICAL_EXPERIENCE_PRINCIPLES = Object.freeze([
  'SUMMARY_FIRST',
  'THIN_BORDER_SURFACES',
  'ONE_PRIMARY_ACTION',
  'TRUTH_BEFORE_OPTIMISM',
  'RESPONSIVE_BY_DEFAULT',
  'TOUCH_SAFE',
  'KEYBOARD_SAFE',
  'REDUCED_MOTION_SAFE',
  'LOADING_EMPTY_ERROR_EXPLICIT',
  'CROSS_SURFACE_CONTINUITY',
  'SPATIAL_READY_NOT_SPATIAL_CLAIMED',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_APP_ID = /^app:[a-z0-9][a-z0-9._-]{0,100}$/i;
const REQUIRED_SURFACES = Object.freeze([
  'stephanos-landing-page','ai-console','goal-dashboard','music-tile','vr-research-lab','vr-link','sovereignty','wealth','privacy','trading-laboratory','autonomous-build-controls','command-deck','ignition-splash','desktop-browser','windows-edge','ipad','iphone','whatsapp','voice','quest3-spatial',
]);
const PACKET_KEYS = Object.freeze(['inventory']);
const INVENTORY_KEYS = Object.freeze(['schemaVersion','inventoryId','participantId','lifecycleState','observedAtUtc','registeredApps','surfaces','sharedPrimitives','coverage','nextMilestone','authority','valid','validationErrors']);
const COVERAGE_KEYS = Object.freeze(['canonicalTargetCount','coveredCanonicalCount','coveredCanonical','missingCanonical']);

function compareText(a,b){ return a < b ? -1 : a > b ? 1 : 0; }
function hash(value){ return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function snapshotExactObject(value, allowedKeys){
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto=Object.getPrototypeOf(value);
    if (proto!==Object.prototype && proto!==null) return null;
    if (Object.getOwnPropertySymbols(value).length) return null;
    const descriptors=Object.getOwnPropertyDescriptors(value);
    const keys=Object.keys(descriptors).sort(compareText);
    if (keys.some((key)=>!allowedKeys.includes(key))) return null;
    const out=Object.create(null);
    for(const key of keys){
      const descriptor=descriptors[key];
      if(!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor,'value') || descriptor.get || descriptor.set) return null;
      Object.defineProperty(out,key,{value:descriptor.value,enumerable:true,writable:false,configurable:false});
    }
    return Object.freeze(out);
  } catch { return null; }
}
function snapshotDenseArray(value,max=256,snapshotEntry=(entry)=>entry){
  try {
    if(!Array.isArray(value) || Object.getPrototypeOf(value)!==Array.prototype || Object.getOwnPropertySymbols(value).length) return null;
    const descriptors=Object.getOwnPropertyDescriptors(value);
    const length=descriptors.length?.value;
    if(!Number.isSafeInteger(length) || length<0 || length>max) return null;
    const expected=['length',...Array.from({length},(_,i)=>String(i))].sort(compareText);
    if(JSON.stringify(Object.keys(descriptors).sort(compareText))!==JSON.stringify(expected)) return null;
    const out=[];
    for(let i=0;i<length;i+=1){
      const d=descriptors[String(i)];
      if(!d || !d.enumerable || !Object.hasOwn(d,'value') || d.get || d.set) return null;
      const snapped=snapshotEntry(d.value);
      if(snapped===null) return null;
      out.push(snapped);
    }
    return Object.freeze(out);
  } catch { return null; }
}
function snapshotSurface(value){
  try {
    if(!value || typeof value!=='object' || Array.isArray(value)) return null;
    if(Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null) return null;
    if(Object.getOwnPropertySymbols(value).length) return null;
    const descriptors=Object.getOwnPropertyDescriptors(value);
    const surface=descriptors.surfaceId;
    if(!surface || !surface.enumerable || !Object.hasOwn(surface,'value') || surface.get || surface.set) return null;
    const id=surface.value;
    if(typeof id!=='string' || (!SAFE_ID.test(id) && !SAFE_APP_ID.test(id))) return null;
    return Object.freeze({surfaceId:id});
  } catch { return null; }
}
function snapshotCoverage(value){
  const coverage=snapshotExactObject(value,COVERAGE_KEYS); if(!coverage) return null;
  const covered=snapshotDenseArray(coverage.coveredCanonical,256,(entry)=>typeof entry==='string'?entry:null);
  const missing=snapshotDenseArray(coverage.missingCanonical,256,(entry)=>typeof entry==='string'?entry:null);
  if(!covered || !missing) return null;
  return Object.freeze({ canonicalTargetCount:coverage.canonicalTargetCount, coveredCanonicalCount:coverage.coveredCanonicalCount, coveredCanonical:covered, missingCanonical:missing });
}
function snapshotInventory(value){
  const inventory=snapshotExactObject(value,INVENTORY_KEYS); if(!inventory) return null;
  const surfaces=snapshotDenseArray(inventory.surfaces,256,snapshotSurface); if(!surfaces) return null;
  const coverage=snapshotCoverage(inventory.coverage); if(!coverage) return null;
  return Object.freeze({ schemaVersion:inventory.schemaVersion, inventoryId:inventory.inventoryId, valid:inventory.valid, nextMilestone:inventory.nextMilestone, surfaces, coverage });
}
function invalid(errors){ return Object.freeze({ schemaVersion:UI_AGENT_CANONICAL_EXPERIENCE_CONTRACT_SCHEMA_VERSION, valid:false, state:'SAFE_HOLD', contractId:null, principles:UI_AGENT_CANONICAL_EXPERIENCE_PRINCIPLES, surfaces:Object.freeze([]), proofPlan:Object.freeze([]), authority:Object.freeze({ sourceMutationAllowed:false, implementationAllowed:false, mergeAllowed:false, deploymentAllowed:false, runtimeMutationAllowed:false, productAuthority:false }), validationErrors:Object.freeze(errors) }); }

export function buildUiAgentCanonicalExperienceContractV1(input={}){
  try {
    const packet=snapshotExactObject(input,PACKET_KEYS); if(!packet || !Object.hasOwn(packet,'inventory')) return invalid(['input-must-be-data-only-object']);
    const inventory=snapshotInventory(packet.inventory); if(!inventory) return invalid(['inventory-must-be-recursively-data-only']);
    if(inventory.schemaVersion!==UI_AGENT_EXPERIENCE_INVENTORY_SCHEMA_VERSION) return invalid(['inventory-schema-mismatch']);
    if(inventory.valid!==true || inventory.nextMilestone!=='M3_PUBLISH_CANONICAL_EXPERIENCE_CONTRACT_AND_DESIGN_MAP') return invalid(['inventory-not-m3-ready']);
    if(typeof inventory.inventoryId!=='string' || !SAFE_ID.test(inventory.inventoryId)) return invalid(['inventory-id-invalid']);
    const ids=inventory.surfaces.map((record)=>record.surfaceId);
    const unique=[...new Set(ids)].sort(compareText); if(unique.length!==ids.length) return invalid(['surface-id-duplicate']);
    const missing=REQUIRED_SURFACES.filter((id)=>!unique.includes(id)); if(missing.length) return invalid(missing.map((id)=>`canonical-surface-missing:${id}`));
    const coverage=inventory.coverage;
    if(coverage.missingCanonical.length!==0 || coverage.coveredCanonicalCount!==coverage.canonicalTargetCount || coverage.canonicalTargetCount!==REQUIRED_SURFACES.length) return invalid(['coverage-not-complete']);
    const coveredUnique=[...new Set(coverage.coveredCanonical)].sort(compareText);
    if(coveredUnique.length!==REQUIRED_SURFACES.length || REQUIRED_SURFACES.some((id)=>!coveredUnique.includes(id))) return invalid(['coverage-identity-mismatch']);
    const mapped=Object.freeze(unique.map((surfaceId)=>Object.freeze({ surfaceId, experienceLanguage:'STEPHANOS_DELUXE_V1', hierarchy:'SUMMARY_PRIMARY_DETAIL', actionDensity:'ONE_PRIMARY_ACTION_WITH_BOUNDED_SECONDARY', borderLanguage:'THIN_SHARED_SURFACE', motion:'SUBTLE_WITH_REDUCED_MOTION_FALLBACK', stateTruth:'LOADING_EMPTY_ERROR_OFFLINE_EXPLICIT', continuity:'PRESERVE_TASK_AND_CONTEXT_ACROSS_PRESENTATIONS' })));
    const proofPlan=Object.freeze(UI_AGENT_REQUIRED_PROOF_CLASSES.map((proofClass)=>Object.freeze({ proofClass, required:true, satisfied:false, evidenceRef:null })));
    const authority=Object.freeze({ sourceMutationAllowed:false, implementationAllowed:false, mergeAllowed:false, deploymentAllowed:false, runtimeMutationAllowed:false, productAuthority:false });
    const core={ schemaVersion:UI_AGENT_CANONICAL_EXPERIENCE_CONTRACT_SCHEMA_VERSION, inventoryId:inventory.inventoryId, principles:UI_AGENT_CANONICAL_EXPERIENCE_PRINCIPLES, surfaces:mapped, proofPlan, authority };
    return Object.freeze({ ...core, valid:true, state:'CANONICAL_DESIGN_MAP_READY_FOR_IMPLEMENTATION_PLANNING', contractId:`ui-experience-${hash(core).slice(0,24)}`, validationErrors:Object.freeze([]) });
  } catch {
    return invalid(['contract-build-failed-closed']);
  }
}
