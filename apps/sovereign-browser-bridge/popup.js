'use strict';
const status = document.querySelector('#status');
function show(text) { status.textContent = String(text).slice(0, 500); }
const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });
async function run(type) {
  try {
    const result = await send(type);
    show(result?.ok ? (result.message || 'Done') : (result?.blocker || 'Bridge unavailable'));
  } catch { show('BROWSER_BRIDGE_UNAVAILABLE'); }
}
document.querySelector('#grant').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const origin = new URL(tab?.url || '').origin;
    const profile = await send('witness-config');
    if (!profile?.ok || !profile.allowedOrigins.includes(origin)) return show('This site is not on the local Stephanos allowlist');
    const granted = await chrome.permissions.request({ origins: [origin + '/*'] });
    show(granted ? 'Workspace authorised. Capture when ready.' : 'Site permission not granted.');
  } catch { show('Unable to authorise this workspace'); }
});
document.querySelector('#inspect').addEventListener('click', () => run('witness-capture'));
document.querySelector('#scan').addEventListener('click', () => run('witness-scan'));
document.querySelector('#revoke').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const origin = new URL(tab?.url || '').origin;
    const removed = await chrome.permissions.remove({ origins: [origin + '/*'] });
    show(removed ? 'Workspace permission revoked.' : 'No matching permission to revoke.');
  } catch { show('Could not revoke workspace permission'); }
});
run('witness-config');
