const button=document.getElementById('vr-research-qa-refresh');
button?.addEventListener('click',async()=>{
 const state=document.getElementById('vr-research-qa-state');
 const answer=document.getElementById('vr-research-qa-answer');
 button.disabled=true;state.textContent='Checking canonical VR participant';answer.textContent='';
 try{
  const cls=document.getElementById('vr-research-qa-question').value;
  const response=await fetch('/api/shared-workspace/vr-research-qa?questionClass='+encodeURIComponent(cls),{cache:'no-store'});
  if(!response.ok)throw Error('Unavailable');
  const record=await response.json();
  if(record.ok!==true||record.participantId!=='stephanos-vr-research')throw Error('Identity mismatch');
  state.textContent='stephanos-vr-research: '+record.answer.answerVerdict;
  answer.textContent=record.answer.answerText||'Canonical evidence missing; no claim promoted.';
 }catch{state.textContent='Canonical participant unavailable';}
 finally{button.disabled=false;}
});
