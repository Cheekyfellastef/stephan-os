'use strict';
const status = document.querySelector('#status');
const grant = document.querySelector('#grant');
const revoke = document.querySelector('#revoke');
let selectedOrigin = '';
let allowedOrigins = [];
function show(text) { status.textContent = String(text).slice(0, 500); }
const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });
function permissionPattern(origin) {
  // Chromium match patterns exclude ports. The worker and native host
  // independently enforce the exact URL origin including its port.
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('BROWSER_ORIGIN_INVALID');
  return `${url.protocol}//${url.hostname}/*`;
}
async function run(type) {
  try {
    const result = await send(type);
    show(result?.ok ? (result.message || 'Done') : (result?.blocker || 'Bridge unavailable'));
  } catch { show('BROWSER_BRIDGE_UNAVAILABLE'); }
}
async function loadCurrentWorkspace() {
  grant.disabled = true;
  revoke.disabled = true;
  selectedOrigin = '';
  allowedOrigins = [];
  try {
    const [[tab], profile] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      send('witness-config'),
    ]);
    if (!profile?.ok || !Array.isArray(profile.allowedOrigins)) {
      return show(profile?.blocker || 'Native witness host unavailable');
    }
    allowedOrigins = profile.allowedOrigins;
    const origin = new URL(tab?.url || '').origin;
    if (!allowedOrigins.includes(origin)) return show('This tab is outside your authorised Stephanos origins');
    selectedOrigin = origin;
    grant.disabled = false;
    revoke.disabled = false;
    show('Workspace recognised. Grant site permission, then capture proof.');
  } catch { show('Unable to read active workspace'); }
}
grant.addEventListener('click', () => {
  if (!selectedOrigin || !allowedOrigins.includes(selectedOrigin)) return show('Workspace not authorised by local host');
  try {
    // Call request directly in the click handler, before any await, so the
    // browser recognises the operator gesture.
    chrome.permissions.request({ origins: [permissionPattern(selectedOrigin)] })
      .then((granted) => show(granted
        ? 'Workspace authorised. Capture when ready.'
        : 'Site permission not granted.'))
      .catch(() => show('Site permission request failed'));
  } catch { show('Unable to authorise this workspace'); }
});
document.querySelector('#inspect').addEventListener('click', () => run('witness-capture'));
document.querySelector('#scan').addEventListener('click', () => run('witness-scan'));
document.querySelector('#auto-on').addEventListener('click', () => run('witness-auto-on'));
document.querySelector('#auto-off').addEventListener('click', () => run('witness-auto-off'));
revoke.addEventListener('click', () => {
  if (!selectedOrigin || !allowedOrigins.includes(selectedOrigin)) return show('Workspace not authorised by local host');
  chrome.permissions.remove({ origins: [permissionPattern(selectedOrigin)] })
    .then((removed) => show(removed ? 'Workspace permission revoked.' : 'No matching site permission to revoke.'))
    .catch(() => show('Could not revoke workspace permission'));
});
loadCurrentWorkspace();
