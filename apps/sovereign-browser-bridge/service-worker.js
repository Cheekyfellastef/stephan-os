'use strict';
// An event-driven witness. No debugger permission, page reload, navigation, or arbitrary JS.
const NATIVE_HOST = 'com.stephanos.sovereign_browser_witness';
const RESPONSE_SCHEMA = 'stephanos.browser-native-message.v1';
const MAX_TABS = 8;
const VALID_ACTIONS = new Set(['witness-config','witness-capture','witness-scan','witness-auto-on','witness-auto-off']);
const AUTO_ALARM = 'stephanos-permitted-site-diagnostics';
function admittedOrigin(url, origins) {
  try { const u = new URL(url); return ['http:','https:'].includes(u.protocol) && origins.includes(u.origin); }
  catch { return false; }
}
function permissionPattern(origin) {
  // Chrome host-permission match patterns never encode URL ports.
  // Every inspected tab must still match an exact configured origin.
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
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
function extractDomMetrics(origins) {
  // Chromium host grants omit ports and allFrames can include cross-origin
  // descendants. Admit the actual document inside each isolated-world call
  // before touching its DOM, including when the selected tab just navigated.
  if (!Array.isArray(origins) || !origins.includes(location.origin)
    || !['http:', 'https:'].includes(location.protocol)) return null;
  const imgs = Array.from(document.querySelectorAll('img')).slice(0, 500);
  const anchors = Array.from(document.querySelectorAll('a')).slice(0, 1000);
  let genericSpotifyLinks=0, spotifyTrackLinks=0, spotifySearchLinks=0, emptyLinks=0;
  for (const el of anchors) {
    const href = el.getAttribute('href');
    if (!href) { emptyLinks++; continue; }
    try {
      const link = new URL(href, location.href);
      if (link.hostname === 'open.spotify.com') {
        if (link.pathname === '/' || link.pathname === '/intl-en') genericSpotifyLinks++;
        if (/^\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]+$/.test(link.pathname)) spotifyTrackLinks++;
        if (link.pathname.startsWith('/search')) spotifySearchLinks++;
      }
    } catch {}
  }
  return {
    readyState:document.readyState,
    imageCount:imgs.length,
    brokenImages:imgs.filter(x=>x.complete && x.naturalWidth===0).length,
    unloadedImages:imgs.filter(x=>!x.complete).length,
    linkCount:anchors.length,
    genericSpotifyLinks,spotifyTrackLinks,spotifySearchLinks,emptyLinks,
    buttonCount:document.querySelectorAll('button').length,
    disabledButtonCount:document.querySelectorAll('button:disabled').length,
    headingCount:document.querySelectorAll('h1,h2,h3').length,
    iframeCount:document.querySelectorAll('iframe').length
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
    if (!await chrome.permissions.contains({ origins:[permissionPattern(origin)] })) continue;
    let metrics;
    try {
      let injected;
      try {
        // Same-origin/authorised child workspace frames add meaningful
        // coverage. Browser-granted host access still controls injection.
        injected = await chrome.scripting.executeScript({
          target:{ tabId:tab.id, allFrames:true }, func:extractDomMetrics,
          args:[profile.allowedOrigins],
        });
      } catch {
        // A restricted third-party iframe must not suppress safe top-level
        // diagnostics. We never claim complete frame coverage.
        injected = await chrome.scripting.executeScript({ target:{ tabId:tab.id },
          func:extractDomMetrics, args:[profile.allowedOrigins] });
      }
      const frames = injected.slice(0, 20).map(item => item?.result).filter(value => value && typeof value === 'object');
      if (!frames.length) continue;
      const totals = [
        'imageCount', 'brokenImages', 'unloadedImages', 'linkCount',
        'genericSpotifyLinks', 'spotifyTrackLinks', 'spotifySearchLinks',
        'emptyLinks', 'buttonCount', 'disabledButtonCount', 'headingCount', 'iframeCount',
      ];
      metrics = {
        readyState:frames.every(frame=>frame.readyState==='complete') ? 'complete' : 'unknown',
        instrumentedFrameCount:frames.length,
        frameCoverageFullyVerified:false,
      };
      for (const key of totals) {
        metrics[key] = frames.reduce((sum,frame) => sum + (
          Number.isSafeInteger(frame[key]) && frame[key] >= 0 && frame[key] <= 10000 ? frame[key] : 0
        ),0);
      }
    } catch { continue; }
    const record = { origin, metrics, active:tab.id === active?.id, screenshot:'' };
    if (capture && record.active) {
      let transitioned = false;
      const onActivated = (info) => {
        if (info.windowId === tab.windowId) transitioned = true;
      };
      const onUpdated = (tabId, change) => {
        if (tabId === tab.id && (Object.hasOwn(change, 'url') || change.status === 'loading'))
          transitioned = true;
      };
      try {
        // Latch changes before querying. Matching endpoints cannot detect an
        // A -> private tab/document -> A transition during screenshot capture.
        chrome.tabs.onActivated.addListener(onActivated);
        chrome.tabs.onUpdated.addListener(onUpdated);
        const [before] = await chrome.tabs.query({ windowId: tab.windowId, active: true });
        if (transitioned || before?.id !== tab.id || before?.url !== tab.url) {
          return { ok:false, blocker:'BROWSER_ACTIVE_TAB_CHANGED' };
        }
        const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format:'jpeg', quality:62 });
        const [after] = await chrome.tabs.query({ windowId: tab.windowId, active: true });
        // A foreground switch or navigation during capture must discard the
        // bytes before native messaging, even if the screenshot succeeded.
        if (transitioned || after?.id !== tab.id || after?.url !== tab.url || !admittedOrigin(after?.url, profile.allowedOrigins)) {
          return { ok:false, blocker:'BROWSER_ACTIVE_TAB_CHANGED' };
        }
        record.screenshot = image;
      } catch { return { ok:false, blocker:'BROWSER_SCREENSHOT_FAILED' }; }
      finally {
        chrome.tabs.onActivated.removeListener(onActivated);
        chrome.tabs.onUpdated.removeListener(onUpdated);
      }
    }
    snapshots.push(record);
  }
  if (capture && !snapshots.some(s=>s.active && s.screenshot))
    return { ok:false, blocker:'ACTIVE_TAB_PERMISSION_REQUIRED' };
  if (!snapshots.length) return { ok:false, blocker:'NO_PERMITTED_STEPHANOS_TABS' };
  const response = await nativeCall({ schemaVersion:RESPONSE_SCHEMA, action:'record', mode:capture?'capture':'scan', snapshots });
  return response.ok ? { ok:true, message:response.message || 'Local evidence saved', observedTabCount:response.observedTabCount } : response;
}
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTO_ALARM) return;
  const state = await chrome.storage.local.get(['autoScanEnabled']);
  if (state.autoScanEnabled === true) await captureWorkspaces(false).catch(()=>{});
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !VALID_ACTIONS.has(message?.type)) return false;
  const action = message.type;
  (async () => {
    if (action === 'witness-config') return allowedOrigins();
    if (action === 'witness-auto-on') {
      await chrome.storage.local.set({autoScanEnabled:true});
      await chrome.alarms.create(AUTO_ALARM,{periodInMinutes:15});
      return {ok:true,message:'Periodic diagnostics enabled; screenshots still require a click'};
    }
    if (action === 'witness-auto-off') {
      await chrome.storage.local.set({autoScanEnabled:false});
      await chrome.alarms.clear(AUTO_ALARM);
      return {ok:true,message:'Periodic diagnostics paused'};
    }
    return captureWorkspaces(action==='witness-capture');
  })()
    .then(sendResponse).catch(()=>sendResponse({ok:false,blocker:'BROWSER_WITNESS_CAPTURE_FAILED'}));
  return true;
});
