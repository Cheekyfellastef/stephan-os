const STORAGE_KEY = 'stephanos.openclaw.evidenceRequests.v1';

function getStorage(){try{return globalThis.localStorage||null;}catch{return null;}}
function sanitize(entry={}){return {
  requestId: entry.requestId || '', packetId: entry.packetId || '', requestedEvidenceType: entry.requestedEvidenceType || 'other',
  title: entry.title || '', reason: entry.reason || '', status: entry.requestStatus || entry.status || 'none', priority: entry.priority || 'normal',
  blocking: entry.blocking === true, createdAt: entry.createdAt || '', updatedAt: entry.updatedAt || '',
  attachedEvidence: Array.isArray(entry.attachedEvidence) ? entry.attachedEvidence.map((a) => ({ summary: a.summary || '', tokens: Array.isArray(a.tokens)?a.tokens:[] })) : [],
};}

export function loadOpenClawEvidenceRequests(){const s=getStorage(); if(!s) return {}; try{const parsed=JSON.parse(s.getItem(STORAGE_KEY)||'{}'); if(!parsed||typeof parsed!=='object') return {}; return parsed;}catch{return {};}}
export function saveOpenClawEvidenceRequest({request}={}){const all=loadOpenClawEvidenceRequests(); const normalized=sanitize(request); if(!normalized.requestId) return all; all[normalized.requestId]=normalized; const s=getStorage(); if(s){try{s.setItem(STORAGE_KEY, JSON.stringify(all));}catch{}} return normalized;}
export function clearOpenClawEvidenceRequests(){const s=getStorage(); if(s){try{s.removeItem(STORAGE_KEY);}catch{}} return true;}
export function listOpenClawEvidenceRequestsByPacketId(packetId='none'){return Object.values(loadOpenClawEvidenceRequests()).filter((r)=>r.packetId===packetId);}

export { STORAGE_KEY as OPENCLAW_EVIDENCE_REQUESTS_STORAGE_KEY };
