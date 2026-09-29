import { BATTLE_BRIDGE_PUBLISHER_SERVICES } from './battleBridgePublisher.mjs';
import { BATTLE_BRIDGE_SERVICE_IDS } from './battleBridgeSupervisor.mjs';
export const CAPTAINS_BRIDGE_RUNTIME_HEALTH_SCHEMA_VERSION = 'stephanos.captains-bridge-runtime-health.v1';
export const CAPTAINS_BRIDGE_RUNTIME_HEALTH_SERVICES = Object.freeze(['backend','dashboard','publisher-loop','shared-workspace-feed','openclaw-gateway','mission-worker','supervisor']);
function text(v,f='') { if (v == null) return f; const s=String(v).trim(); return s || f; }
function ts(v){ const n=Date.parse(text(v)); return Number.isFinite(n)?n:NaN; }
function source(records,id){ return records.find((r)=>[r.serviceId,r.id,r.name].includes(id) || (id==='dashboard' && r.serviceId==='stephanos-ui') || (id==='supervisor' && r.serviceId==='battle-bridge-supervisor') || (id==='publisher-loop' && r.serviceId==='battle-bridge-publisher-loop') || (id==='shared-workspace-feed' && r.serviceId==='shared-workspace-feed')) || null; }
function light(record, nowMs, staleAfterMs) {
  if (!record) return { trafficLight: 'UNKNOWN', freshness: 'UNKNOWN', ageMs: null, exactNextAction: 'Publish the missing runtime health record before claiming current service state.' };
  const age = Math.max(0, nowMs - ts(record.checkedAtUtc || record.timestampUtc || record.publishedAtUtc));
  if (!Number.isFinite(age)) return { trafficLight: 'UNKNOWN', freshness: 'UNKNOWN', ageMs: null, exactNextAction: 'Republish runtime health with a valid UTC timestamp.' };
  if (age > staleAfterMs) return { trafficLight: 'AMBER', freshness: 'STALE', ageMs: age, exactNextAction: 'Refresh stale runtime health publication; do not restart or kill processes from this projection.' };
  const status = text(record.state || record.status).toUpperCase();
  if (['READY','PASS','CURRENT'].includes(status)) return { trafficLight: 'GREEN', freshness: 'CURRENT', ageMs: age, exactNextAction: 'Continue monitoring current runtime health.' };
  if (['DEGRADED','STALE','STARTING','RECOVERING'].includes(status)) return { trafficLight: 'AMBER', freshness: 'CURRENT', ageMs: age, exactNextAction: text(record.exactNextAction, 'Collect fresh proof and publish recovery intent only if operator-approved.') };
  if (['FAILED','FAIL','STOPPED'].includes(status)) return { trafficLight: 'RED', freshness: 'CURRENT', ageMs: age, exactNextAction: text(record.exactNextAction, 'Escalate to operator with exact unblock action; no process killing or restart is implemented here.') };
  return { trafficLight: 'UNKNOWN', freshness: 'CURRENT', ageMs: age, exactNextAction: text(record.exactNextAction, 'Run approved Battle Bridge proof and publish service truth.') };
}
export function projectCaptainsBridgeRuntimeHealth(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const staleAfterMs = Number.isFinite(input.staleAfterMs) ? input.staleAfterMs : 60*1000;
  const records = [...(Array.isArray(input.healthRecords)?input.healthRecords:[]), ...(Array.isArray(input.publisherSlice?.services)?input.publisherSlice.services:[]), ...(Array.isArray(input.supervisorHealthRecords)?input.supervisorHealthRecords:[])];
  const services = CAPTAINS_BRIDGE_RUNTIME_HEALTH_SERVICES.map((id)=>{ const record=source(records,id); return Object.freeze({ serviceId:id, ...(light(record,nowMs,staleAfterMs)), sourceKind: record?.kind || 'missing' }); });
  const worst = services.some(s=>s.trafficLight==='RED') ? 'RED' : services.some(s=>s.trafficLight==='AMBER') ? 'AMBER' : services.some(s=>s.trafficLight==='UNKNOWN') ? 'UNKNOWN' : 'GREEN';
  const first = services.find(s=>s.trafficLight!=='GREEN');
  return Object.freeze({ schemaVersion: CAPTAINS_BRIDGE_RUNTIME_HEALTH_SCHEMA_VERSION, kind:'stephanos.captains_bridge.runtime_health.projection', readOnly:true, processKillingAllowed:false, restartImplementationAllowed:false, arbitraryShellAllowed:false, consumesContracts:Object.freeze({ publisherServices:[...BATTLE_BRIDGE_PUBLISHER_SERVICES], supervisorServices:[...BATTLE_BRIDGE_SERVICE_IDS] }), overallTrafficLight: worst, services, exactNextAction: first?.exactNextAction || 'All runtime lights green; continue monitoring.', finalVerdict: worst==='GREEN' ? 'CAPTAINS_BRIDGE_RUNTIME_HEALTH_GREEN' : 'CAPTAINS_BRIDGE_RUNTIME_HEALTH_ATTENTION_REQUIRED' });
}
