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
const REQUIRED_SURFACES = Object.freeze([
  'stephanos-landing-page','ai-console','goal-dashboard','music-tile','vr-research-lab','vr-link','sovereignty','wealth','privacy','trading-laboratory','autonomous-build-controls','command-deck','ignition-splash','desktop-browser','windows-edge','ipad','iphone','whatsapp','voice','quest3-spatial',
]);

function compareText(a,b){ return a < b ? -1 : a > b ? 1 : 0; }
function hash(value){ return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function exactObject(value){
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const proto=Object.getPrototypeOf(value);
    if (proto!==Object.prototype && proto!==null) return null;
    if (Object.getOwnPropertySymbols(value).length) return null;
    const descriptors=Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) if (!Object.hasOwn(descriptor,'value') || descriptor.get || descriptor.set) return null;
    return value;
  } catch { return null; }
}
function denseArray(value,max=256){
  if (!Array.isArray(value) || value.length>max) return null;
  try {
    if (Object.getPrototypeOf(value)!==Array.prototype || Object.getOwnPropertySymbols(value).length) return null;
    const descriptors=Object.getOwnPropertyDescriptors(value);
    for(let i=0;i<value.length;i+=1){ const d=descriptors[String(i)]; if(!d || !Object.hasOwn(d,'value') || d.get || d.set) return null; }
    return value;
  } catch { return null; }
}
function invalid(errors){ return Object.freeze({ schemaVersion:UI_AGENT_CANONICAL_EXPERIENCE_CONTRACT_SCHEMA_VERSION, valid:false, state:'SAFE_HOLD', contractId:null, principles:UI_AGENT_CANONICAL_EXPERIENCE_PRINCIPLES, surfaces:Object.freeze([]), proofPlan:Object.freeze([]), authority:Object.freeze({ sourceMutationAllowed:false, implementationAllowed:false, mergeAllowed:false, deploymentAllowed:false, runtimeMutationAllowed:false, productAuthority:false }), validationErrors:Object.freeze(errors) }); }

export function buildUiAgentCanonicalExperienceContractV1(input={}){
  const packet=exactObject(input); if(!packet) return invalid(['input-must-be-data-only-object']);
  const allowed=new Set(['inventory']);
  const keys=Object.keys(packet).sort(compareText); if(keys.some((key)=>!allowed.has(key))) return invalid(['unsupported-input-field']);
  const inventory=exactObject(packet.inventory); if(!inventory) return invalid(['inventory-must-be-data-only-object']);
  if(inventory.schemaVersion!==UI_AGENT_EXPERIENCE_INVENTORY_SCHEMA_VERSION) return invalid(['inventory-schema-mismatch']);
  if(inventory.valid!==true || inventory.nextMilestone!=='M3_PUBLISH_CANONICAL_EXPERIENCE_CONTRACT_AND_DESIGN_MAP') return invalid(['inventory-not-m3-ready']);
  if(!SAFE_ID.test(String(inventory.inventoryId||''))) return invalid(['inventory-id-invalid']);
  const surfaces=denseArray(inventory.surfaces); if(!surfaces) return invalid(['surfaces-must-be-dense-array']);
  const ids=[];
  for(const candidate of surfaces){ const record=exactObject(candidate); if(!record) return invalid(['surface-record-invalid']); const id=String(record.surfaceId||''); if(!SAFE_ID.test(id) && !/^app:[a-z0-9][a-z0-9._-]{0,100}$/i.test(id)) return invalid(['surface-id-invalid']); ids.push(id); }
  const unique=[...new Set(ids)].sort(compareText); if(unique.length!==ids.length) return invalid(['surface-id-duplicate']);
  const missing=REQUIRED_SURFACES.filter((id)=>!unique.includes(id)); if(missing.length) return invalid(missing.map((id)=>`canonical-surface-missing:${id}`));
  const coverage=exactObject(inventory.coverage); if(!coverage || coverage.missingCanonical?.length!==0 || coverage.coveredCanonicalCount!==coverage.canonicalTargetCount) return invalid(['coverage-not-complete']);
  const mapped=Object.freeze(unique.map((surfaceId)=>Object.freeze({ surfaceId, experienceLanguage:'STEPHANOS_DELUXE_V1', hierarchy:'SUMMARY_PRIMARY_DETAIL', actionDensity:'ONE_PRIMARY_ACTION_WITH_BOUNDED_SECONDARY', borderLanguage:'THIN_SHARED_SURFACE', motion:'SUBTLE_WITH_REDUCED_MOTION_FALLBACK', stateTruth:'LOADING_EMPTY_ERROR_OFFLINE_EXPLICIT', continuity:'PRESERVE_TASK_AND_CONTEXT_ACROSS_PRESENTATIONS' })));
  const proofPlan=Object.freeze(UI_AGENT_REQUIRED_PROOF_CLASSES.map((proofClass)=>Object.freeze({ proofClass, required:true, satisfied:false, evidenceRef:null })));
  const core={ schemaVersion:UI_AGENT_CANONICAL_EXPERIENCE_CONTRACT_SCHEMA_VERSION, inventoryId:inventory.inventoryId, principles:UI_AGENT_CANONICAL_EXPERIENCE_PRINCIPLES, surfaces:mapped, proofPlan, authority:Object.freeze({ sourceMutationAllowed:false, implementationAllowed:false, mergeAllowed:false, deploymentAllowed:false, runtimeMutationAllowed:false, productAuthority:false }) };
  return Object.freeze({ ...core, valid:true, state:'CANONICAL_DESIGN_MAP_READY_FOR_IMPLEMENTATION_PLANNING', contractId:`ui-experience-${hash(core).slice(0,24)}`, validationErrors:Object.freeze([]) });
}
