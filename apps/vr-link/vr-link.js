const $ = (id) => document.getElementById(id);
const canvas = $('chamber');
const ctx = canvas.getContext('2d');
function chamber() {
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#061422'; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = '#26749a'; ctx.lineWidth = 1;
  for(let i=0;i<=12;i++){const x=i*w/12;ctx.beginPath();ctx.moveTo(x,h);ctx.lineTo(w/2,h*.35);ctx.stroke();}
  for(let i=0;i<6;i++){const y=h*.35+i*i*h*.026;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  ctx.strokeStyle='#71c9fc';ctx.strokeRect(80,24,w-160,h-54);
  ctx.fillStyle='#cdeafe';ctx.font='17px system-ui';ctx.textAlign='center';ctx.fillText('HOLODECK BASELINE · DESKTOP PREVIEW',w/2,53);
}
chamber();
$('device').textContent = /Quest|Oculus/i.test(navigator.userAgent) ? 'Quest browser (reported)' : 'Browser (unverified)';
$('backend').textContent = location.protocol === 'file:' ? 'Offline' : /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'Local' : 'Hosted';
let session = null;
let xrSupported = false;
let openingSession = false;
// Preserve the latest XR/session notice when older backend pings settle.
let noticeVersion = 0;
function showNotice(message) {
  noticeVersion++;
  $('notice').textContent = message;
}
async function detect() {
  if (!navigator.xr) { $('xr').textContent = 'No (WebXR API unavailable)'; showNotice('Desktop fallback. WebXR is unavailable in this browser or context.'); return; }
  try {
    const supported = await navigator.xr.isSessionSupported('immersive-vr');
    xrSupported = Boolean(supported);
    $('xr').textContent = supported ? 'Yes (immersive-vr supported)' : 'No (immersive-vr unsupported)';
    $('enter').disabled = !xrSupported || openingSession || Boolean(session);
  } catch(e) { xrSupported = false; $('enter').disabled = true; $('xr').textContent='Unknown'; showNotice('WebXR check failed: '+String(e.message||e)); }
}
$('enter').addEventListener('click', async () => {
  if (!navigator.xr || !xrSupported || session || openingSession) return;
  openingSession = true;
  $('enter').disabled = true;
  showNotice('Opening immersive VR session…');
  try {
    const opened = await navigator.xr.requestSession('immersive-vr');
    session = opened;
    $('session').textContent = 'immersive-vr';
    showNotice('WebXR session entered. This V0 confirms connection only; no spatial renderer has been attached.');
    opened.addEventListener('end', () => {
      if (session !== opened) return;
      session = null;
      $('enter').disabled = !xrSupported;
      $('session').textContent = 'Fallback';
      showNotice('VR session ended. Desktop fallback ready.');
    }, { once: true });
  } catch (e) {
    $('session').textContent = 'Fallback';
    showNotice('VR session failed: ' + String(e.message || e));
  } finally {
    openingSession = false;
    $('enter').disabled = !xrSupported || Boolean(session);
  }
});
$('ping').addEventListener('click',async()=>{
  const pingVersion = ++noticeVersion;
  $('notice').textContent='Checking Stephanos…';
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),3000);
  try {
    const response=await fetch('/api/health',{method:'GET',cache:'no-store',signal:controller.signal});
    if (pingVersion === noticeVersion) $('notice').textContent=response.ok?'Stephanos reachable (HTTP '+response.status+').':'Stephanos unavailable (HTTP '+response.status+').';
  } catch(e) {if (pingVersion === noticeVersion) $('notice').textContent='Stephanos offline or unreachable: '+String(e.message||e);}
  finally {clearTimeout(timeout);}
});
detect();
