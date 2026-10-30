const button=document.getElementById('vr-research-qa-refresh');
button?.addEventListener('click',async()=>{
 const state=document.getElementById('vr-research-qa-state');
 const answer=document.getElementById('vr-research-qa-answer');
 button.disabled=true;state.textContent='Checking canonical VR participant';answer.textContent='';
 try{
  const cls=document.getElementById('vr-research-qa-question').value;
  const apiBase = ['127.0.0.1','localhost'].includes(location.hostname) && location.port === '4173' ? location.protocol+'//'+location.hostname+':8787' : '';
  const response=await fetch(apiBase+'/api/shared-workspace/vr-research-qa?questionClass='+encodeURIComponent(cls),{cache:'no-store'});
  if(!response.ok)throw Error('Unavailable');
  const record=await response.json();
  if(record.ok!==true||record.participantId!=='stephanos-vr-research')throw Error('Identity mismatch');
  state.textContent='stephanos-vr-research: '+record.answer.answerVerdict;
  answer.textContent=record.answer.answerText||'Canonical evidence missing; no claim promoted.';
 }catch{state.textContent='Canonical participant unavailable';}
 finally{button.disabled=false;}
});
