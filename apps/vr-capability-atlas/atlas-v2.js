import {
  chooseSelectedConceptId,
  CONCEPT_CATALOG,
  CONCEPT_LIMIT,
  rankConcepts,
} from './atlas-concepts.mjs';

const outcomes=[['🪐','Starfield VR cockpit → living starship','Stereo, head tracking, HUD and ship interaction can grow toward embodiment, hands, crew behaviour and spatial systems.','Mutar/OpenXR + Skyrim parity + Starfield authoring'],['🫴','Embodied hands and physical weapons','A transport-neutral pose contract separates Quest/OpenXR tracking from title-specific skeleton and IK work.','Universal Hands + Cyberpunk + Skyrim parity'],['🎬','Comfortable dialogue and cinematics','Immersive conversation, focused framing and room-fixed 3D theatre can be selected according to camera ownership.','Halo theatre + adaptive presentation'],['🧬','Convert resistant flat games','Escalate through framework, title adapter, reconstructed stereo, spatial screen or lawful independent recreation.','Route planner + UEVR/vorpX + reconstruction'],['🛸','Stephanos Spatial Bridge','A seated Quest 3 command bridge over the same canonical Stephanos brain with mission state preserved outside the headset.','Single-brain doctrine + Battle Bridge'],['🧰','Reusable VR conversion factory','Every experiment should leave adapters, tests, provenance and acceptance evidence so later titles start further ahead.','Capability Graph + Method Library']];
const fallbackSources=[['Halo MCC VR','rendering','Open-source reference','Multi-title runtime patterns and room-fixed 3D cutscene theatre.','cutscene theatre'],['OpenXR SDK Source','runtime','Authoritative implementation','Loader, API-layer and sample implementation behaviour.','runtime plumbing'],['Skyrim VR ecosystem','interaction','Native parity benchmark','Body, holsters, grabbing and character response decomposed into capabilities.','embodiment parity'],['Meta Quest Link / Air Link','delivery','Primary Quest 3 transport','Wireless PCVR delivery with layered failure attribution.','Quest 3 delivery'],['Starfield + Creation Kit','tooling','Authoritative title evidence','Authoring and runtime attachment points for Starfield-specific systems.','integration seams'],['Paradise Decay / creator evidence','field','Field evidence','Headset-use evidence for usability, setup, comfort and performance questions.','acceptance clues']];
const fallbackMethods=[['Capability Route Planner','active','Choose native, framework, title-adapter, reconstructed-stereo, spatial-screen or recreation routes from evidence.'],['Skyrim VR Parity Decomposition','active','Translate body, holsters, interaction and character response into reusable attachment points and tests.'],['Room-fixed 3D Cutscene Theatre','reference-proven','Preserve authored cinematic framing on a room-fixed stereo screen while retaining 6DoF head tracking.'],['Transport-neutral Hand Pose Contract','active','Separate tracking producers from title-specific skeleton adapters using a bounded pose contract and calibration.'],['Starfield Mutar OpenXR Baseline','proof-pending','Bind exact Starfield/provider identity to Meta OpenXR and Quest 3 Air Link proof.'],['Adaptive Dialogue Presentation','design-active','Choose immersive dialogue, focused conversation or theatre based on camera ownership and intent.']];

let sources=[...fallbackSources],methods=[...fallbackMethods],workspace=null,active='all';
let rankedConcepts=[],selectedConceptId='',selectionPinnedByUser=false,conceptAssetsPrewarmed=false;
let thumbnailAssetsLoading=false;
const assetUrls=new Map(),assetPromises=new Map(),selectedAssetRequests=new Set();
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const sourceCount=$('#sourceCount'),techniqueCount=$('#techniqueCount'),targetCount=$('#targetCount'),researchTitle=$('#researchTitle'),badge=$('#badge'),liveMeta=$('#liveMeta'),search=$('#search'),refresh=$('#refresh');
const lightbox=$('#conceptLightbox');
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ');

$('#outcomes').innerHTML=outcomes.map(o=>`<article class="card"><div class="icon">${o[0]}</div><h3>${esc(o[1])}</h3><p>${esc(o[2])}</p><div class="unlock"><b>UNLOCKED BY</b><br>${esc(o[3])}</div></article>`).join('');

function switchView(view){
  $$('.viewpage').forEach(p=>p.classList.toggle('active',p.id===`view-${view}`));
  $$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  if(view==='concepts')renderConcepts();
  window.scrollTo({top:$('.viewbar').offsetTop-62,behavior:'smooth'});
}
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));

function renderSources(){
  const q=search.value.toLowerCase().trim();
  const rows=sources.filter(s=>(active==='all'||s[1]===active)&&(!q||s.join(' ').toLowerCase().includes(q)));
  $('#sources').innerHTML=rows.map(s=>`<article class="card source"><div class="type">${esc(s[2])}</div><h3>${esc(s[0])}</h3><p>${esc(s[3])}</p><div class="small">↳ ${esc(s[4])}</div></article>`).join('');
}
function renderMethods(){
  $('#methodsGrid').innerHTML=methods.map(m=>`<article class="card method"><span class="status ${esc(m[1])}">${esc(m[1])}</span><div><h3>${esc(m[0])}</h3><p>${esc(m[2])}</p></div></article>`).join('');
}
function techniqueWeight(status){
  const value=String(status||'').toLowerCase();
  if(value==='active'||value==='reference-proven')return 3;
  if(value==='proof-pending'||value==='design-active')return 2;
  return 1;
}
function researchItems(){
  const targets=Array.isArray(workspace?.targets)?workspace.targets.map(t=>({name:t.name||t.title||t.id||'Mission target',text:JSON.stringify(t),weight:2})):[];
  const techniqueItems=methods.map(m=>({name:m[0],text:m.join(' '),weight:techniqueWeight(m[1])}));
  const sourceItems=sources.map(s=>({name:s[0],text:s.join(' '),weight:1}));
  return [...techniqueItems,...targets,...sourceItems];
}
function picture(c,{lightboxMode=false}={}){
  const sizes=lightboxMode?'100vw':'(min-width: 1840px) 1796px, (min-width: 900px) calc(100vw - 44px), calc(100vw - 28px)';
  const thumb=assetUrls.get(c.assets.thumb),panel=assetUrls.get(c.assets.panel),hero=assetUrls.get(c.assets.hero);
  if(!panel)return `<span class="concept-placeholder" role="img" aria-label="${esc(c.alt)}"><span>Preparing full-resolution concept…</span></span>`;
  const candidates=[[thumb,640],[panel,1920],[hero,3840]].filter(([url])=>url).map(([url,width])=>`${url} ${width}w`).join(', ');
  return `<picture>${hero?`<source media="(min-width:1800px)" srcset="${hero}">`:''}${hero?`<source media="(min-width:900px)" srcset="${panel} 1x, ${hero} 2x">`:''}<img src="${panel}" srcset="${candidates}" sizes="${sizes}" width="3840" height="2160" alt="${esc(c.alt)}" decoding="async" fetchpriority="high"></picture>`;
}
function currentConcept(){return rankedConcepts.find(c=>c.id===selectedConceptId)||rankedConcepts[0];}
function supportCopy(concept){return concept.hits.length?concept.hits.map(esc).join(' · '):'No strong canonical match yet — retained as a bounded future direction.';}
function renderConcepts(){
  const selected=currentConcept();
  if(!selected)return;
  const support=supportCopy(selected);
  $('#conceptMeta').textContent=`${rankedConcepts.length} views ranked against ${sources.length} canonical sources, ${methods.length} techniques${Array.isArray(workspace?.targets)?` and ${workspace.targets.length} mission targets`:''}. ${selectionPinnedByUser?'Your selected scene is preserved.':'The strongest current match is selected.'}`;
  $('#conceptStage').innerHTML=`<article class="concept-feature"><button id="conceptHeroButton" class="concept-feature-media" type="button" aria-label="Open ${esc(selected.title)} in a lightbox">${picture(selected)}<span class="hero-shade"></span><span class="truth-ribbon">CONCEPT PROJECTION / NOT RUNTIME PROOF</span><span class="rank-pill">LIVE RANK #${selected.rank} · RESEARCH FIT ${selected.fit}%</span><span class="zoom-hint">Open lightbox ↗</span></button><div class="concept-feature-copy"><div><div class="kicker">Featured research match</div><h3>${esc(selected.title)}</h3><p>${esc(selected.description)}</p></div><div class="concept-evidence"><b>${selected.score?'CURRENT CANONICAL SUPPORT':'FUTURE DIRECTION'}</b><span>${support}</span><div class="concept-tags">${selected.tags.slice(0,7).map(tag=>`<span class="concept-tag">${esc(tag)}</span>`).join('')}</div></div><div class="feature-actions"><button class="control-button" type="button" data-concept-step="-1" aria-label="Previous concept">← Previous</button><button id="openLightbox" class="control-button primary" type="button">View large</button><button class="control-button" type="button" data-concept-step="1" aria-label="Next concept">Next →</button></div></div></article>`;
  $('#conceptThumbnails').innerHTML=rankedConcepts.map(c=>{const thumb=assetUrls.get(c.assets.thumb);return `<button class="concept-thumbnail ${c.id===selected.id?'selected':''}" type="button" role="listitem" data-concept-id="${c.id}" aria-pressed="${c.id===selected.id}" aria-label="Show ${esc(c.title)}"><span class="thumbnail-media">${thumb?`<img src="${thumb}" width="640" height="360" loading="lazy" decoding="async" alt="">`:'<span class="thumbnail-placeholder">Loading view…</span>'}<span class="thumbnail-rank">#${c.rank}</span></span><span class="thumbnail-copy"><b>${esc(c.title)}</b><small>${c.fit}% research fit</small></span></button>`;}).join('');
  $$('[data-concept-id]').forEach(button=>button.addEventListener('click',()=>selectConcept(button.dataset.conceptId,true)));
  $$('[data-concept-step]').forEach(button=>button.addEventListener('click',()=>navigateConcept(Number(button.dataset.conceptStep))));
  $('#conceptHeroButton').addEventListener('click',openLightbox);
  $('#openLightbox').addEventListener('click',openLightbox);
  ensureSelectedAssets(selected);
  ensureThumbnailAssets();
  prewarmConceptPanels();
}
function rerankConcepts(){
  rankedConcepts=rankConcepts(CONCEPT_CATALOG,researchItems(),CONCEPT_LIMIT);
  const previous=selectedConceptId;
  selectedConceptId=chooseSelectedConceptId(rankedConcepts,previous,selectionPinnedByUser);
  if(previous&&previous!==selectedConceptId&&!rankedConcepts.some(c=>c.id===previous))selectionPinnedByUser=false;
  renderConcepts();
}
function selectConcept(id,pin=true){
  if(!rankedConcepts.some(c=>c.id===id))return;
  selectedConceptId=id;selectionPinnedByUser=pin;renderConcepts();
  if(lightbox.open)populateLightbox();
}
function navigateConcept(direction){
  const index=Math.max(0,rankedConcepts.findIndex(c=>c.id===selectedConceptId));
  const next=(index+direction+rankedConcepts.length)%rankedConcepts.length;
  selectConcept(rankedConcepts[next].id,true);
}
async function resolveAsset(path){
  if(assetUrls.has(path))return assetUrls.get(path);
  if(assetPromises.has(path))return assetPromises.get(path);
  const promise=(async()=>{
    const response=await fetch(path,{cache:'force-cache'});
    if(!response.ok)throw new Error(`HTTP ${response.status} for ${path}`);
    const encoded=(await response.text()).replace(/\s+/g,'');
    const binary=atob(encoded),bytes=new Uint8Array(binary.length);
    for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);
    const url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));
    assetUrls.set(path,url);
    return url;
  })().catch(error=>{console.warn('Concept asset unavailable',path,error);return '';}).finally(()=>assetPromises.delete(path));
  assetPromises.set(path,promise);
  return promise;
}
function ensureSelectedAssets(concept){
  const missing=[concept.assets.panel,concept.assets.hero].filter(path=>!assetUrls.has(path));
  if(!missing.length||selectedAssetRequests.has(concept.id))return;
  selectedAssetRequests.add(concept.id);
  Promise.all(missing.map(resolveAsset)).finally(()=>{
    selectedAssetRequests.delete(concept.id);
    if(selectedConceptId===concept.id){renderConcepts();if(lightbox.open)populateLightbox();}
  });
}
function ensureThumbnailAssets(){
  if(thumbnailAssetsLoading||CONCEPT_CATALOG.every(concept=>assetUrls.has(concept.assets.thumb)))return;
  thumbnailAssetsLoading=true;
  Promise.all(CONCEPT_CATALOG.map(concept=>resolveAsset(concept.assets.thumb))).finally(()=>{thumbnailAssetsLoading=false;renderConcepts();});
}
function prewarmConceptPanels(){
  if(conceptAssetsPrewarmed)return;
  conceptAssetsPrewarmed=true;
  const load=()=>Promise.all(CONCEPT_CATALOG.map(concept=>resolveAsset(concept.assets.panel)));
  if('requestIdleCallback'in window)window.requestIdleCallback(load,{timeout:1800});else window.setTimeout(load,250);
}
function populateLightbox(){
  const selected=currentConcept();if(!selected)return;
  $('#lightboxMedia').innerHTML=picture(selected,{lightboxMode:true});$('#lightboxTitle').textContent=selected.title;
}
function openLightbox(){populateLightbox();if(!lightbox.open)lightbox.showModal();}

$('#closeLightbox').addEventListener('click',()=>lightbox.close());
lightbox.addEventListener('click',event=>{if(event.target===lightbox)lightbox.close();});
$('#enterFullscreen').addEventListener('click',async()=>{if(document.fullscreenElement){await document.exitFullscreen();return;}if(lightbox.requestFullscreen)await lightbox.requestFullscreen();});
document.addEventListener('fullscreenchange',()=>{$('#enterFullscreen').textContent=document.fullscreenElement?'Exit full screen':'Enter full screen';});
document.addEventListener('keydown',event=>{
  const conceptView=$('#view-concepts').classList.contains('active');
  if(!conceptView||event.target.closest('input,textarea,select'))return;
  if(event.key==='ArrowLeft'){event.preventDefault();navigateConcept(-1);}
  if(event.key==='ArrowRight'){event.preventDefault();navigateConcept(1);}
  if(event.key==='Escape'&&lightbox.open)lightbox.close();
});

function renderSnapshot(){
  workspace=null;sources=[...fallbackSources];methods=[...fallbackMethods];
  sourceCount.textContent=sources.length;techniqueCount.textContent=methods.length;targetCount.textContent='snapshot';researchTitle.textContent='Embedded VR research snapshot';
  renderSources();renderMethods();rerankConcepts();
}
function setState(mode,text){badge.className='badge '+mode;badge.innerHTML=`<span class="dot"></span>${mode==='live'?'LIVE · canonical research':mode==='pending'?'CONNECTING · verifying':'SNAPSHOT · live unavailable'}`;liveMeta.textContent=text||'';}
const paths={workspace:['../../VR-Research-Lab/lab-workspace.json','https://raw.githubusercontent.com/Cheekyfellastef/stephan-os/main/VR-Research-Lab/lab-workspace.json'],registry:['../../VR-Research-Lab/knowledge-sources.json','https://raw.githubusercontent.com/Cheekyfellastef/stephan-os/main/VR-Research-Lab/knowledge-sources.json']};
async function firstJson(urls){let last;for(const url of urls){try{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);return {data:await response.json(),url};}catch(error){last=error;}}throw last||new Error('unavailable');}
function category(x){const text=norm(`${x.source_id} ${x.title}`);if(/hand|skyrim|vrik|higgs|planck/.test(text))return'interaction';if(/virtual desktop|air link|quest link|meta quest/.test(text))return'delivery';if(/creator|voodoo|paradise|beardo|headset/.test(text))return'field';if(/installer|creation kit|rai pal|deluxe/.test(text))return'tooling';if(/openxr sdk|openxr spec|reframework/.test(text))return'runtime';return'rendering';}
function sourceRow(x){return [x.title||x.source_id,category(x),String(x.status||x.priority||'registered').replaceAll('-',' '),String(x.promotion_rule||'Canonical evidence retained with provenance and reuse boundaries.').slice(0,190),[`licence: ${x.licence||'tracked'}`,x.snapshot_version||x.snapshot_release||x.snapshot_date||x.snapshot_commit?.slice(0,8)].filter(Boolean).join(' · ')];}
async function hydrate(){
  setState('pending','Refreshing canonical VR research…');
  try{
    const [w,r]=await Promise.all([firstJson(paths.workspace),firstJson(paths.registry)]);
    if(!Array.isArray(r.data.sources)||!r.data.sources.length)throw new Error('empty source registry');
    if(!Array.isArray(w.data.techniques)||!w.data.techniques.length)throw new Error('empty technique set');
    workspace=w.data;sources=r.data.sources.map(sourceRow);methods=w.data.techniques.map(x=>[x.name,x.status||'active',x.goal||'Reusable VR method']);
    sourceCount.textContent=sources.length;techniqueCount.textContent=methods.length;targetCount.textContent=Array.isArray(w.data.targets)?w.data.targets.length:'—';researchTitle.textContent=`The ${sources.length}-source live VR stack`;
    renderSources();renderMethods();rerankConcepts();
    const local=w.url.startsWith('..')&&r.url.startsWith('..');const stamp=w.data.updatedAt?new Date(w.data.updatedAt).toLocaleString():'current';
    setState('live',`${local?'Battle Bridge / repo-local':'GitHub main'} · workspace ${stamp} · 10 concepts reranked · auto-refresh 60s`);
  }catch(error){renderSnapshot();setState('snapshot',`Embedded snapshot in use · ${error.message||'live fetch failed'}`);}
}

search.addEventListener('input',renderSources);
$$('.filter').forEach(button=>button.addEventListener('click',()=>{$$('.filter').forEach(item=>item.classList.remove('active'));button.classList.add('active');active=button.dataset.filter;renderSources();}));
refresh.addEventListener('click',hydrate);
renderSnapshot();hydrate();setInterval(hydrate,60000);
