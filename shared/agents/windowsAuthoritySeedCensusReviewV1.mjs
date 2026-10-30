// Existing #3096 exact-byte Windows census review ONLY. Approval-boundary self-change.
// An eligible source check is not an independent reviewer, host custody, or GPU clearance.
import { createHash } from 'node:crypto';
export const SEED_CENSUS_SPECIALIST_PATHS_V1=Object.freeze(['scripts/windows/get-seed-canopy-llama-process-census-v1.ps1']);
export const SEED_CENSUS_SPECIALIST_BLOB_V1='6b280c152436350f23850f4f8ca6b6e290a47216';
const REPO='Cheekyfellastef/stephan-os', PR=3138;
const BRANCH='seed-parallel/3096-llamacpp-governor-contract-v1';
const HEAD=/^[a-f0-9]{40}$/;
const PATH=SEED_CENSUS_SPECIALIST_PATHS_V1[0];
const hash=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
const finding=c=>Object.freeze({severity:'P0',code:c,path:PATH,summary:c});
const neutral=(eligible,clean,findings=[],refs=[])=>Object.freeze({
 schemaVersion:'stephanos.windows-authority-specialist-review.v1',
 eligible,clean,reviewedPaths:Object.freeze(eligible?[PATH]:[]),
 findings:Object.freeze(findings),proofRefs:Object.freeze(refs),
 sourceMutationAllowed:false,mergeAuthority:false,runtimeMutationAllowed:false,
 providerQualificationAuthority:false,independentSignerVerified:false,
 physicalCustodyQualified:false,gpuResidencyMeasured:false,safetyHoldMayBeRemoved:false,
 finalVerdict:!eligible?'WINDOWS_AUTHORITY_SEED_CENSUS_NOT_APPLICABLE':clean
 ?'WINDOWS_AUTHORITY_SEED_CENSUS_SOURCE_CLEAN':'WINDOWS_AUTHORITY_SEED_CENSUS_FINDINGS',
});
export function analyzeWindowsAuthoritySeedCensusReviewV1(input={}){
 const a=input.analysis||{}, f=a.findings, h=String(input.sourceHead||'').toLowerCase();
 if(input.repository!==REPO||input.prNumber!==PR||input.branch!==BRANCH
 ||!HEAD.test(h)||!HEAD.test(String(input.baseSha||'').toLowerCase())
 ||!Array.isArray(f)||f.length!==1||f[0]?.severity!=='P0'
 ||f[0]?.code!=='unsupported-high-risk-surface'||f[0]?.path!==PATH
 ||a.counts?.P0!==1||a.counts?.P1!==0||a.counts?.P2!==0)return neutral(false,false);
 const sources=Array.isArray(input.sources)?input.sources:[];
 const x=sources.length===1?sources[0]:null;
 const exact=x?.schemaVersion==='stephanos.windows-authority-source.v1'
 &&x?.repository===REPO&&x?.path===PATH&&x?.ref===h&&x?.exists===true
 &&x?.size===2568&&typeof x?.content==='string'
 &&Buffer.byteLength(x.content,'utf8')===2568
 &&x?.blobSha===SEED_CENSUS_SPECIALIST_BLOB_V1
 &&hash(x.content)===SEED_CENSUS_SPECIALIST_BLOB_V1;
 if(sources.length!==1||!exact)return neutral(true,false,[
  finding(sources.length!==1?'seed-census-source-inventory-invalid':'seed-census-identity-or-content-invalid'),
 ]);
 return neutral(true,true,[],['proofs/windows-seed-census/'+PATH+'@'+h+'#'+x.blobSha+':'+x.size]);
}
