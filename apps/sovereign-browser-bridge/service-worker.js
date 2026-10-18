'use strict';
// An event-driven witness. No debugger permission, page reload, navigation, or arbitrary JS.
const NATIVE_HOST = 'com.stephanos.sovereign_browser_witness';
const RESPONSE_SCHEMA = 'stephanos.browser-native-message.v1';
const MAX_TABS = 8;
const VALID_ACTIONS = new Set(['witness-config','witness-capture','witness-scan']);
function admittedOrigin(url, origins) {
  try { const u = new URL(url); return ['http:','https:'].includes(u.protocol) && origins.includes(u.origin); }
  catch { return false; }
}
function nativeCall(payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, payload, (response) => {
        if (chrome.runtime.lastError || response?.schemaVersion !== RESPONSE_SCHEMA) {
          resolve({ ok:false, blocker:'NATIVE_HOST_UNAVAILABLE' }); return;
        }
        resolve(response);
      });
    } catch { resolve({ ok:false, blocker:'NATIVE_HOST_UNAVAILABLE' }); }
  });
}
async function allowedOrigins() {
  const response = await nativeCall({ schemaVersion:RESPONSE_SCHEMA, action:'config' });
  if (!response.ok || !Array.isArray(response.allowedOrigins)) return { ok:false, blocker:response.blocker || 'NATIVE_HOST_UNAVAILABLE' };
  return { ok:true, allowedOrigins:response.allowedOrigins.slice(0, 16) };
}
function extractDomMetrics() {
  const imgs = Array.from(document.querySelectorAll('img')).slice(0, 500);
  const anchors = Array.from(document.querySelectorAll('a')).slice(0, 1000);
  let genericSpotifyLinks=0, emptyLinks=0;
  for (const el of anchors) {
    const href = el.getAttribute('href');
    if (!href) { emptyLinks++; continue; }
    try {
      const link = new URL(href, location.href);
      if (link.hostname === 'open.spotify.com' && (link.pathname === '/' || link.pathname === '/intl-en')) genericSpotifyLinks++;
    } catch {}
  }
  return {
    readyState:document.readyState,
    imageCount:imgs.length,
    brokenImages:imgs.filter(x=>x.complete && x.naturalWidth===0).length,
    unloadedImages:imgs.filter(x=>!x.complete).length,
    linkCount:anchors.length,
    genericSpotifyLinks,emptyLinks,
    buttonCount:document.querySelectorAll('button').length,
    disabledButtonCount:document.querySelectorAll('button:disabled').length,
    headingCount:document.querySelectorAll('h1,h2,h3').length
  };
}
async function captureWorkspaces(capture) {
  const profile = await allowedOrigins();
  if (!profile.ok) return profile;
  const current = await chrome.tabs.query({ active:true, currentWindow:true });
  const active = current[0];
  if (capture && (!active || !admittedOrigin(active.url, profile.allowedOrigins)))
    return { ok:false, blocker:'ACTIVE_STEPHANOS_WORKSPACE_REQUIRED' };
  const tabs = await chrome.tabs.query({});
  const admitted = tabs.filter(t=>admittedOrigin(t.url, profile.allowedOrigins)).slice(0, MAX_TABS);
  const snapshots = [];
  for (const tab of admitted) {
    const origin = new URL(tab.url).origin;
    if (!await chrome.permissions.contains({ origins:[origin + '/*'] })) continue;
    let metrics;
    try {
      const injected = await chrome.scripting.executeScript({ target:{ tabId:tab.id }, func:extractDomMetrics });
      metrics = injected[0]?.result;
    } catch { continue; }
    if (!metrics || typeof metrics !== 'object') continue;
    const record = { origin, metrics, active:tab.id === active?.id, screenshot:'' };
    if (capture && record.active) {
      try { record.screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format:'jpeg', quality:62 }); }
      catch { return { ok:false, blocker:'BROWSER_SCREENSHOT_FAILED' }; }
    }
    snapshots.push(record);
  }
  if (capture && !snapshots.some(s=>s.active && s.screenshot))
    return { ok:false, blocker:'ACTIVE_TAB_PERMISSION_REQUIRED' };
  if (!snapshots.length) return { ok:false, blocker:'NO_PERMITTED_STEPHANOS_TABS' };
  const response = await nativeCall({ schemaVersion:RESPONSE_SCHEMA, action:'record', mode:capture?'capture':'scan', snapshots });
  return response.ok ? { ok:true, message:response.message || 'Local evidence saved', observedTabCount:response.observedTabCount } : response;
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !VALID_ACTIONS.has(message?.type)) return false;
  const action = message.type;
  (async () => action === 'witness-config' ? allowedOrigins() : captureWorkspaces(action==='witness-capture'))()
    .then(sendResponse).catch(()=>sendResponse({ok:false,blocker:'BROWSER_WITNESS_CAPTURE_FAILED'}));
  return true;
});
