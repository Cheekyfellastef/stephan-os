import {
  isSupportedPackagingMode,
  resolvePackagingMode,
  validateEntryForPackaging
} from "./entry_rules.js";
import {
  createRuntimeStatusModel,
  readPersistedProviderPreferences,
} from "../../shared/runtime/runtimeStatusModel.mjs";
import {
  readPortableStephanosHomeNodePreference,
} from "../../shared/runtime/stephanosSessionMemory.mjs";
import {
  createStephanosHomeNodeTarget,
  createStephanosLocalUrls,
  createStephanosRuntimeTargets,
  getStephanosPreferredRuntimeTarget,
  getStephanosRuntimeTargetByKind,
  resolveStephanosLocalUrls,
} from "../../shared/runtime/stephanosLocalUrls.mjs";
import {
  discoverStephanosHomeNode,
  extractHostname,
  isLikelyLanHost,
  isLoopbackHost,
  readPersistedStephanosHomeNode,
  readPersistedStephanosLastKnownNode,
  STEPHANOS_HOME_BRIDGE_URL_GLOBAL,
  isValidStephanosHomeNode,
  resolveStephanosBackendBaseUrl,
  validateStephanosBackendTargetUrl,
  validateStephanosHomeBridgeUrl,
} from "../../shared/runtime/stephanosHomeNode.mjs";
import { requestStephanosBackend } from "../../shared/runtime/backendClient.mjs";
import { STEPHANOS_LAW_IDS } from "../../shared/runtime/stephanosLaws.mjs";

const STEPHANOS_APP_ID = "stephanos";
const STEPHANOS_LOCAL_URLS = createStephanosLocalUrls();
const STEPHANOS_DIST_ENTRY = STEPHANOS_LOCAL_URLS.distEntryPath;
const STEPHANOS_DIST_METADATA = "apps/stephanos/dist/stephanos-build.json";
const STEPHANOS_RUNTIME_URL = STEPHANOS_LOCAL_URLS.runtimeUrl;
const STEPHANOS_HEALTH_URL = STEPHANOS_LOCAL_URLS.healthUrl;
const STEPHANOS_STATUS_URL = STEPHANOS_LOCAL_URLS.runtimeStatusPath;

function getAppRoot(app) {
  return app?.folder ? `apps/${app.folder}` : "";
}

function normalizeRuntimePath(path) {
  const value = String(path || "").trim();

  if (!value) {
    return "";
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return value.replace(/^\.?\//, "");
}

function toFetchPath(path) {
  const normalized = normalizeRuntimePath(path);

  if (!normalized) {
    return "";
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  return `./${normalized}`;
}

function resolveCanonicalLauncherShellUrl(currentOrigin = '') {
  try {
    if (currentOrigin) {
      return new URL('/', currentOrigin).href;
    }
  } catch {
    // fall through to static launcher url fallback
  }

  return STEPHANOS_LOCAL_URLS.launcherShellUrl;
}

function formatBuildStamp(buildTimestamp) {
  const value = String(buildTimestamp || '').trim();
  if (!value) {
    return 'unknown';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'unknown';
  }

  const pad = (segment) => String(segment).padStart(2, '0');
  return `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())} ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}:${pad(parsed.getUTCSeconds())} UTC`;
}

async function fetchJson(path) {
  const response = await fetch(path, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache"
    }
  });

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  const raw = await response.text();

  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch {
    return { ok: false, parseError: true };
  }
}

async function fetchJsonSafely(path) {
  try {
    return await fetchJson(path);
  } catch {
    return { ok: false, networkError: true };
  }
}

async function requestStephanosBackendSafely({
  path,
  method = 'GET',
  body,
  runtimeContext = {},
  timeoutMs = 2500,
  diagnostics = null,
} = {}) {
  try {
    const response = await requestStephanosBackend({
      path,
      method,
      body,
      runtimeContext,
      timeoutMs,
      diagnostics,
    });
    return {
      ok: true,
      status: response.status,
      json: response.json,
      requestPath: path,
      backendBaseUrl: response.baseUrl,
    };
  } catch (error) {
    return {
      ok: false,
      status: error?.status || 0,
      parseError: /malformed JSON/i.test(String(error?.message || '')),
      networkError: !error?.status,
      requestPath: path,
      backendBaseUrl: error?.baseUrl || '',
      reason: error?.message || 'backend-request-failed',
    };
  }
}

async function fileExists(path) {
  try {
    const response = await fetch(path, {
      method: "HEAD",
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache"
      }
    });
    return response.ok;
  } catch {
    return false;
  }
}

function extractLocalHtmlReferences(html) {
  const refs = new Set();
  const patterns = [
    /<script[^>]+src=["']([^"']+)["']/gi,
    /<link[^>]+href=["']([^"']+)["']/gi,
    /<img[^>]+src=["']([^"']+)["']/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const candidate = String(match[1] || "").trim();

      if (!candidate) {
        continue;
      }

      if (/^(https?:|data:|blob:|#)/i.test(candidate)) {
        continue;
      }

      refs.add(candidate);
    }
  }

  return Array.from(refs);
}

function toRuntimePath(basePath, ref) {
  const cleaned = String(ref || "").trim();

  if (!cleaned) {
    return "";
  }

  if (cleaned.startsWith("./")) {
    return `${basePath}/${cleaned.slice(2)}`;
  }

  if (cleaned.startsWith("../")) {
    return `${basePath}/${cleaned}`;
  }

  if (cleaned.startsWith("/")) {
    return cleaned.slice(1);
  }

  return `${basePath}/${cleaned}`;
}

function resolveManifestPath(app, manifest) {
  const appRoot = getAppRoot(app);
  const entryInManifest = String(manifest?.entry || "").trim();

  if (!appRoot || !entryInManifest) {
    return "";
  }

  return `${appRoot}/${entryInManifest}`;
}

function emitDiagnostic(context, message) {
  context?.eventBus?.emit("app:diagnostic", { message });
}

function warnStephanosEntryInvariant(message, details = {}, lawId = "") {
  const lawPrefix = lawId ? `[LAW:${lawId}] ` : "";
  console.warn(`[Stephanos Guardrail] ${lawPrefix}${message}`, details);
}

function emitStephanosValidationLog(context, details = {}) {
  const message = [
    `[VALIDATOR LIVE] manifest entry=${details.manifestEntry || "(missing)"}`,
    `resolved file path=${details.resolvedEntryPath || "(missing)"}`,
    `file exists=${details.entryExists === true ? "yes" : "no"}`,
    `runtime-status path=${details.runtimeStatusPath || STEPHANOS_STATUS_URL}`,
    `runtime URL=${details.runtimeUrl || STEPHANOS_RUNTIME_URL}`,
    `runtime reachable=${details.runtimeReachable === true ? "yes" : "no"}`,
    `backend status=${details.backendStatus || "unknown"}`,
    `static server status=${details.staticServerStatus || "unknown"}`,
    `launcher state=${details.launcherState || "(unknown)"}`,
    `stale state cleared=${details.staleStateCleared === true ? "yes" : "no"}`,
    `discoveryDisabled=${details.discoveryDisabled === true ? "yes" : "no"}`,
    `disabled=${details.disabled === true ? "yes" : "no"}`,
    `reason=${details.reason || "(not-yet-determined)"}`,
    `backend request path=${details.backendRequestPath || "(none)"}`,
    `backend resolved base URL=${details.backendResolvedBaseUrl || "(none)"}`,
    `backend request success=${details.backendRequestSuccess === true ? "yes" : details.backendRequestSuccess === false ? "no" : "(n/a)"}`,
    `runtime marker=${details.runtimeMarker || "(missing)"}`,
    `git commit=${details.gitCommit || "(missing)"}`,
    `build timestamp=${details.buildTimestamp || "(missing)"}`
  ].join(", ");

  console.log(message);
  emitDiagnostic(context, message);
}

function isStephanosApp(app) {
  const identifier = String(app?.folder || app?.id || app?.name || "").trim().toLowerCase();
  return identifier === STEPHANOS_APP_ID || identifier === "stephanos os";
}

function isLaunchInProgress(statusPayload) {
  const state = String(
    statusPayload?.state ||
      statusPayload?.launcherStatus?.state ||
      ""
  )
    .trim()
    .toLowerCase();

  return [
    "starting",
    "checking-repo",
    "updating",
    "building",
    "verifying-build",
    "starting-backend",
    "starting-dist",
    "waiting-runtime",
    "waiting-ready"
  ].includes(state);
}

function getSubsystemState(statusPayload, key) {
  return String(statusPayload?.subsystems?.[key]?.state || "")
    .trim()
    .toLowerCase();
}

function applyAppStatus(app, nextStatus, context = {}) {
  const previousSnapshot = JSON.stringify({
    disabled: Boolean(app?.disabled),
    validationIssues: Array.isArray(app?.validationIssues) ? app.validationIssues : [],
    validationState: app?.validationState || "unknown",
    statusMessage: app?.statusMessage || ""
  });

  app.disabled = Boolean(app?.discoveryDisabled);
  app.validationState = nextStatus.state;
  app.statusMessage = nextStatus.message;
  app.validationIssues = Array.isArray(nextStatus.issues) ? nextStatus.issues : [];

  const nextSnapshot = JSON.stringify({
    disabled: Boolean(app?.disabled),
    validationIssues: Array.isArray(app?.validationIssues) ? app.validationIssues : [],
    validationState: app?.validationState || "unknown",
    statusMessage: app?.statusMessage || ""
  });

  if (previousSnapshot !== nextSnapshot) {
    context?.eventBus?.emit("app:status_changed", {
      name: app?.name,
      folder: app?.folder,
      entry: app?.entry,
      disabled: app?.disabled,
      validationState: app?.validationState,
      validationIssues: app?.validationIssues,
      statusMessage: app?.statusMessage
    });
  }
}

function syncValidationReport(apps, context = {}) {
  const report = {
    total: apps.length,
    loaded: apps.filter((app) => !app?.discoveryDisabled).length,
    invalid: apps.filter((app) => app?.discoveryDisabled || app?.validationState === "error").length,
    launching: apps.filter((app) => app?.validationState === "launching").length,
    issues: apps
      .filter((app) => Array.isArray(app?.validationIssues) && app.validationIssues.length > 0)
      .map((app) => app.validationIssues[0])
  };

  context?.systemState?.set?.("appValidationReport", report);
  context?.eventBus?.emit("app:validation_report_updated", report);
  return report;
}

async function validateAppManifest(app, issues) {
  const appRoot = getAppRoot(app);

  if (!appRoot) {
    issues.push("Missing app folder metadata");
    return null;
  }

  const manifestResult = await fetchJson(`${appRoot}/app.json`);

  if (!manifestResult.ok) {
    issues.push(manifestResult.parseError ? "Invalid app.json" : "Missing app.json");
    return null;
  }

  const manifest = manifestResult.json;

  if (typeof manifest?.name !== "string" || manifest.name.trim().length === 0) {
    issues.push("app.json missing required field: name");
  }

  if (typeof manifest?.entry !== "string" || manifest.entry.trim().length === 0) {
    issues.push("app.json missing required field: entry");
  }

  return manifest;
}

async function validateEntryExists(path, issues) {
  if (!path) {
    issues.push("Entry file is not defined");
    return false;
  }

  const exists = await fileExists(path);

  if (!exists) {
    issues.push(`Entry file not found: ${path}`);
  }

  return exists;
}

async function validateHtmlReferences(basePath, html, issues, label) {
  const refs = extractLocalHtmlReferences(html);

  for (const ref of refs) {
    const absolute = toRuntimePath(basePath, ref);
    const exists = await fileExists(absolute);

    if (!exists) {
      issues.push(`${label} missing referenced asset: ${ref}`);
    }
  }
}

async function validateViteApp(entryPath, issues) {
  const response = await fetch(entryPath);

  if (!response.ok) {
    issues.push(`Unable to read Vite entry HTML: ${entryPath}`);
    return;
  }

  const html = await response.text();
  const entryFolder = entryPath.split("/").slice(0, -1).join("/");
  await validateHtmlReferences(entryFolder, html, issues, "Vite app");
}

async function validateClassicStaticApp(appRoot, entryPath, manifest, issues) {
  const requiredPaths = Array.isArray(manifest?.requiredPaths)
    ? manifest.requiredPaths.filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];

  for (const requiredPath of requiredPaths) {
    const exists = await fileExists(`${appRoot}/${requiredPath}`);

    if (!exists) {
      issues.push(`Missing required path: ${requiredPath}`);
    }
  }

  if (!entryPath.endsWith(".html")) {
    return;
  }

  const response = await fetch(entryPath);

  if (!response.ok) {
    return;
  }

  const html = await response.text();
  const entryFolder = entryPath.split("/").slice(0, -1).join("/");
  await validateHtmlReferences(entryFolder, html, issues, "Classic app");
}

async function probeStephanosRuntimeTarget(target, options = {}) {
  const requireStephanosMarker = options.requireStephanosMarker !== false;
  const reachable = await fileExists(target?.probeUrl || target?.url || "");

  if (!reachable) {
    return {
      ...target,
      reachable: false,
      validStephanosTarget: false,
      markerMatched: false,
    };
  }

  if (target?.kind !== "dev" || !requireStephanosMarker) {
    return {
      ...target,
      reachable: true,
      validStephanosTarget: true,
      markerMatched: true,
    };
  }

  try {
    const response = await fetch(target.url, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache"
      }
    });

    if (!response.ok) {
      return {
        ...target,
        reachable: true,
        validStephanosTarget: false,
        markerMatched: false,
      };
    }

    const html = await response.text();
    const markerMatched = /Stephanos|stephanos-build-metadata|Stephanos UI/i.test(html);

    return {
      ...target,
      reachable: true,
      validStephanosTarget: markerMatched,
      markerMatched,
    };
  } catch {
    return {
      ...target,
      reachable: true,
      validStephanosTarget: false,
      markerMatched: false,
    };
  }
}

function buildStephanosRuntimeStatusMessage({ liveTargets, preferredTarget, healthyBackend, launcherMessage }) {
  if (launcherMessage) {
    return launcherMessage;
  }

  if (liveTargets.length === 0) {
    return "Stephanos unavailable: neither dev runtime nor dist runtime is live.";
  }

  const liveKinds = new Set(liveTargets.map((target) => target.kind));
  if (liveKinds.has("dev") && liveKinds.has("dist")) {
    return healthyBackend
      ? `Stephanos ready: dev runtime live at ${preferredTarget?.url || liveTargets[0].url}; dist runtime also live.`
      : `Stephanos ready via ${preferredTarget?.label || "runtime"}; backend dependencies are degraded.`;
  }

  if (liveKinds.has("dev")) {
    return healthyBackend
      ? `Stephanos ready: dev runtime live at ${preferredTarget?.url || liveTargets[0].url}.`
      : `Stephanos dev runtime live at ${preferredTarget?.url || liveTargets[0].url}, but backend dependencies are degraded.`;
  }

  return healthyBackend
    ? `Stephanos ready: dist runtime live at ${preferredTarget?.url || liveTargets[0].url}.`
    : `Stephanos dist runtime live at ${preferredTarget?.url || liveTargets[0].url}, but backend dependencies are degraded.`;
}

function deriveStephanosRouteForensics({
  currentOrigin = '',
  backendBaseUrl = '',
  backendProbe = { ok: false },
  localDesktopProbe = { ok: false },
  homeNodeDiscovery = { reachable: false, message: '' },
  preferredHomeNode = null,
  runtimeProbe = { ok: false },
  statusProbe = { ok: false },
  finalRouteKind = 'unavailable',
}) {
  const currentHost = extractHostname(currentOrigin);
  const backendHost = extractHostname(backendBaseUrl);
  const localSession = isLoopbackHost(currentHost) || !currentHost;
  const homeConfigured = Boolean(preferredHomeNode?.host);
  const homeReachable = Boolean(homeNodeDiscovery?.reachable);
  const backendReachable = Boolean(backendProbe?.ok || localDesktopProbe?.ok);
  const backendPublicationProbe = backendProbe?.ok
    ? backendProbe
    : (localDesktopProbe?.ok ? localDesktopProbe : { ok: false });
  const backendPublishedRoute = String(
    backendPublicationProbe?.json?.published_backend_base_url
    || backendPublicationProbe?.json?.backend_base_url
    || ''
  ).trim();
  const backendPublishedRouteHost = extractHostname(backendPublishedRoute);
  const backendClientRouteState = String(
    backendPublicationProbe?.json?.client_route_state || ''
  ).trim().toLowerCase();
  const backendRoutePublished = Boolean(
    backendPublicationProbe?.ok
    && backendPublishedRoute
    && backendClientRouteState
    && backendClientRouteState !== 'unavailable'
    && backendClientRouteState !== 'unknown'
    && (
      localSession
      || !isLoopbackHost(backendPublishedRouteHost)
      || backendClientRouteState === 'misconfigured'
    )
  );
  const runtimeRoutePublished = Boolean(statusProbe?.ok || runtimeProbe?.ok || backendRoutePublished);

  let firstBadTransition = '';
  if (!runtimeRoutePublished) {
    firstBadTransition = 'launcher-runtime-status-unpublished';
  } else if (!backendReachable) {
    firstBadTransition = 'backend-unreachable';
  } else if (!localSession && homeConfigured && !homeReachable) {
    firstBadTransition = 'home-node-configured-but-unreachable';
  } else if (!localSession && !homeConfigured) {
    firstBadTransition = 'hosted-session-without-home-node';
  }

  return {
    currentHost,
    backendHost,
    localSession,
    homeConfigured,
    homeReachable,
    backendReachable,
    runtimeRoutePublished,
    finalRouteKind,
    firstBadTransition,
    evidence: {
      backendProbeOk: Boolean(backendProbe?.ok),
      localDesktopProbeOk: Boolean(localDesktopProbe?.ok),
      homeNodeMessage: homeNodeDiscovery?.message || '',
      statusProbeOk: Boolean(statusProbe?.ok),
      runtimeProbeOk: Boolean(runtimeProbe?.ok),
      backendRoutePublished,
      backendPublishedRoute,
      backendClientRouteState,
    },
  };
}

export async function validateStephanosRuntime(entryPath, context = {}, options = {}) {
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const manualNode = readPersistedStephanosHomeNode() || readPortableStephanosHomeNodePreference();
  const lastKnownNode = readPersistedStephanosLastKnownNode();
  const homeNodeDiscovery = await discoverStephanosHomeNode({
    currentOrigin,
    manualNode,
    lastKnownNode,
  });
  const preferredHomeNode = [homeNodeDiscovery.preferredNode, manualNode, lastKnownNode].find((node) => isValidStephanosHomeNode(node)) || null;
  const backendBaseUrl = resolveStephanosBackendBaseUrl({
    currentOrigin,
    manualNode,
    lastKnownNode: homeNodeDiscovery.preferredNode || lastKnownNode,
    explicitBaseUrl: globalThis?.__STEPHANOS_BACKEND_BASE_URL || '',
    bridgeUrl: globalThis?.[STEPHANOS_HOME_BRIDGE_URL_GLOBAL] || '',
  });
  const localDesktopSession = isLoopbackHost(extractHostname(currentOrigin)) || !extractHostname(currentOrigin);
  const hostedWebSession = !localDesktopSession;
  const localDesktopBackendBaseUrl = 'http://localhost:8787';
  const statusProbe = await fetchJsonSafely(STEPHANOS_STATUS_URL);
  const runtimeProbe = await fetchJsonSafely(STEPHANOS_HEALTH_URL);
  const distMetadataProbe = await fetchJsonSafely(toFetchPath(STEPHANOS_DIST_METADATA));
  const backendProbe = await requestStephanosBackendSafely({
    path: '/api/health',
    runtimeContext: { baseUrl: backendBaseUrl, frontendOrigin: currentOrigin },
  });
  const localDesktopBackendProbe = localDesktopSession && backendBaseUrl !== localDesktopBackendBaseUrl
    ? await requestStephanosBackendSafely({
      path: '/api/health',
      runtimeContext: { baseUrl: localDesktopBackendBaseUrl, frontendOrigin: currentOrigin },
    })
    : backendProbe;
  const backendProbeBaseUrl = backendProbe.backendBaseUrl || backendBaseUrl;
  const backendProbeHost = extractHostname(backendProbeBaseUrl);
  const backendBaseUrlValidation = validateStephanosBackendTargetUrl(backendBaseUrl, { allowLoopback: localDesktopSession });
  const frontendHost = extractHostname(currentOrigin);
  const hostedStaticOrigin = hostedWebSession && frontendHost.endsWith('.github.io');
  const frontendOriginMasqueradingBackend = hostedWebSession
    && Boolean(currentOrigin)
    && Boolean(frontendHost)
    && frontendHost === backendProbeHost
    && !backendProbe.ok;
  const effectiveBackendProbe = backendProbe.ok ? backendProbe : localDesktopBackendProbe;
  const effectiveBackendBaseUrl = backendProbe.ok
    ? backendBaseUrl
    : (localDesktopBackendProbe.ok
      ? localDesktopBackendBaseUrl
      : (frontendOriginMasqueradingBackend || !backendBaseUrlValidation.ok ? '' : backendBaseUrl));
  const localDesktopCapableSession = localDesktopSession;
  const launcherStatus = statusProbe.ok ? statusProbe.json : runtimeProbe.ok ? runtimeProbe.json?.launcherStatus : null;
  const launcherState = String(launcherStatus?.state || statusProbe.json?.state || runtimeProbe.json?.state || '')
    .trim()
    .toLowerCase();
  const runtimeUrls = resolveStephanosLocalUrls(
    statusProbe.ok ? statusProbe.json?.port : null,
    runtimeProbe.ok ? runtimeProbe.json?.port : null,
    statusProbe.ok ? statusProbe.json?.runtimeUrl : null,
    runtimeProbe.ok ? runtimeProbe.json?.runtimeUrl : null,
    statusProbe.ok ? statusProbe.json?.healthUrl : null,
    runtimeProbe.ok ? runtimeProbe.json?.healthUrl : null,
  );
  const runtimeTargets = createStephanosRuntimeTargets({ distPort: runtimeUrls.port });
  const resolvedEntryPath = normalizeRuntimePath(
    statusProbe.ok && statusProbe.json?.distEntryPath
      ? statusProbe.json.distEntryPath
      : runtimeProbe.ok && runtimeProbe.json?.distEntryPath
        ? runtimeProbe.json.distEntryPath
        : entryPath || STEPHANOS_DIST_ENTRY,
  ) || STEPHANOS_DIST_ENTRY;
  const hostedDistUrl = toFetchPath(resolvedEntryPath);
  const launcherMessage =
    typeof launcherStatus?.message === 'string' && launcherStatus.message.trim().length > 0
      ? launcherStatus.message.trim()
      : runtimeProbe.ok && typeof runtimeProbe.json?.launcherStatus?.message === 'string'
        ? runtimeProbe.json.launcherStatus.message.trim()
        : '';
  const buildState = getSubsystemState(launcherStatus, 'build');
  const uiState = getSubsystemState(launcherStatus, 'ui');
  const backendState = getSubsystemState(launcherStatus, 'backend');
  const entryExists = await fileExists(hostedDistUrl);
  const probedTargets = await Promise.all(runtimeTargets.map((target) => probeStephanosRuntimeTarget(target)));
  const devLiveTargets = probedTargets.filter((target) => target.kind === 'dev' && target.validStephanosTarget);
  const distTarget = getStephanosRuntimeTargetByKind(probedTargets, 'dist');
  const distLive = Boolean(distTarget?.reachable && runtimeProbe.ok && runtimeProbe.json?.service === 'stephanos-dist-server' && runtimeProbe.json?.distEntryExists === true);
  const healthyBackend = effectiveBackendProbe.ok && effectiveBackendProbe.json?.service === 'stephanos-server';
  const publishedClientRouteState = healthyBackend
    ? String(effectiveBackendProbe.json?.client_route_state || '').trim().toLowerCase()
    : '';
  const publishedBackendBaseUrl = healthyBackend
    ? String(effectiveBackendProbe.json?.published_backend_base_url || effectiveBackendProbe.json?.backend_base_url || '').trim()
    : '';
  const publishedRouteHost = publishedBackendBaseUrl ? extractHostname(publishedBackendBaseUrl) : '';
  const backendPublishedRouteMisconfigured = healthyBackend && (
    publishedClientRouteState === 'misconfigured'
    || (
      Boolean(preferredHomeNode?.host || (currentOrigin && !isLoopbackHost(extractHostname(currentOrigin))))
      && isLoopbackHost(publishedRouteHost)
    )
  );
  const publishedHomeNode = preferredHomeNode && typeof preferredHomeNode === 'object'
    ? { ...preferredHomeNode }
    : null;
  const configuredBridgeUrl = String(
    globalThis?.[STEPHANOS_HOME_BRIDGE_URL_GLOBAL]
    || effectiveBackendProbe?.json?.published_home_bridge_url
    || effectiveBackendProbe?.json?.home_bridge_url
    || '',
  ).trim();
  const bridgeValidation = validateStephanosHomeBridgeUrl(configuredBridgeUrl, {
    frontendOrigin: currentOrigin,
    requireHttps: false,
  });
  const bridgeConfigured = Boolean(configuredBridgeUrl);
  const bridgeProbe = bridgeValidation.ok
    ? await requestStephanosBackendSafely({
      path: '/api/health',
      runtimeContext: { baseUrl: bridgeValidation.normalizedUrl, frontendOrigin: currentOrigin },
      timeoutMs: 2500,
    })
    : { ok: false, reason: bridgeValidation.reason || (bridgeConfigured ? 'invalid-home-node-bridge-url' : 'missing-home-node-bridge-url') };
  const bridgeReachable = bridgeValidation.ok
    && bridgeProbe.ok
    && bridgeProbe.json?.service === 'stephanos-server';
  const onLanSession = hostedWebSession && isLikelyLanHost(frontendHost);
  const publishedHomeNodeBackendValidation = validateStephanosBackendTargetUrl(
    publishedHomeNode?.backendUrl || '',
    { allowLoopback: localDesktopSession },
  );
  const publishedHomeNodeBackendRejected = Boolean(
    publishedHomeNode
    && publishedHomeNode.backendUrl
    && !publishedHomeNodeBackendValidation.ok
  );
  const publishedHomeNodeBackendReason = publishedHomeNodeBackendRejected
    ? `homeNode.backendUrl publication rejected: ${publishedHomeNodeBackendValidation.reason}`
    : '';
  if (publishedHomeNodeBackendRejected && publishedHomeNode) {
    publishedHomeNode.backendUrl = '';
    publishedHomeNode.backendHealthUrl = '';
  }
  const launchInProgress = isLaunchInProgress(launcherStatus) || isLaunchInProgress(runtimeProbe.ok ? runtimeProbe.json : null);
  const homeNodeTarget = homeNodeDiscovery.reachable && preferredHomeNode?.host
    ? createStephanosHomeNodeTarget({
      host: preferredHomeNode.host,
      uiPort: preferredHomeNode.uiPort,
      backendPort: preferredHomeNode.backendPort,
      source: preferredHomeNode.source,
      lastSeenAt: preferredHomeNode.lastSeenAt,
      reachable: true,
    })
    : null;
  const homeNodeLaunchProbe = homeNodeTarget
    ? await probeStephanosRuntimeTarget(homeNodeTarget, { requireStephanosMarker: false })
    : null;
  const homeNodeUiReachable = Boolean(homeNodeLaunchProbe?.reachable);
  const lanHomeNodeRouteAvailable = Boolean(homeNodeDiscovery.reachable && preferredHomeNode?.host && homeNodeUiReachable);
  const preferredHomeNodeRouteMode = bridgeReachable && hostedWebSession && !onLanSession ? 'home-node-bridge' : 'home-node-lan';
  const selectedHomeNodeBackendTarget = preferredHomeNodeRouteMode === 'home-node-bridge'
    ? bridgeValidation.normalizedUrl
    : (homeNodeTarget?.backendUrl || preferredHomeNode?.backendUrl || '');
  const selectedHomeNodeSource = preferredHomeNodeRouteMode === 'home-node-bridge'
    ? 'home-node-bridge'
    : (preferredHomeNode?.source || homeNodeDiscovery.source || (preferredHomeNode?.host ? 'configured-home-node' : 'not-configured'));
  const homeNodeRouteAvailable = preferredHomeNodeRouteMode === 'home-node-bridge'
    ? bridgeReachable
    : lanHomeNodeRouteAvailable;
  const localPreferredTarget = getStephanosPreferredRuntimeTarget(devLiveTargets, ['dev']);
  const distPreferredTarget = distLive && distTarget ? { ...distTarget, validStephanosTarget: true } : null;

  const providerPreferences = readPersistedProviderPreferences();
  const providerHealthProbe = healthyBackend && effectiveBackendBaseUrl
    ? await requestStephanosBackendSafely({
      path: '/api/ai/providers/health',
      method: 'POST',
      runtimeContext: { baseUrl: effectiveBackendBaseUrl, frontendOrigin: currentOrigin },
      body: {
        provider: providerPreferences.selectedProvider,
        fallbackEnabled: providerPreferences.fallbackEnabled,
        fallbackOrder: providerPreferences.fallbackOrder,
      },
    })
    : { ok: false };
  const providerHealth = providerHealthProbe.ok ? providerHealthProbe.json?.data || {} : {};

  const candidateLaunchUrl = localPreferredTarget?.url
    || homeNodeTarget?.url
    || distPreferredTarget?.url
    || (entryExists ? hostedDistUrl : '');
  const staticHostedFallbackInvalid = hostedStaticOrigin && !healthyBackend;
  const effectiveBackendValidation = validateStephanosBackendTargetUrl(
    effectiveBackendBaseUrl,
    { allowLoopback: localDesktopSession },
  );
  const backendTargetResolvedUrl = (staticHostedFallbackInvalid || !effectiveBackendValidation.ok)
    ? ''
    : effectiveBackendBaseUrl;
  const backendTargetResolutionSource = staticHostedFallbackInvalid
    ? 'unresolved'
    : (!effectiveBackendValidation.ok && effectiveBackendBaseUrl
      ? 'invalid'
      : (backendTargetResolvedUrl ? (preferredHomeNode?.source || homeNodeDiscovery.source || (isLoopbackHost(extractHostname(currentOrigin)) ? 'local-browser-session' : 'route-diagnostics')) : 'unresolved'));
  const backendTargetInvalidReason = staticHostedFallbackInvalid
    ? 'Same-origin static-host backend fallback is invalid for hosted-web sessions (GitHub Pages origin cannot be a backend target).'
    : (!effectiveBackendValidation.ok && effectiveBackendBaseUrl
      ? effectiveBackendValidation.reason
      : '');

  const runtimeStatusModel = createRuntimeStatusModel({
    appId: 'stephanos',
    appName: 'Stephanos OS',
    validationState: candidateLaunchUrl ? 'healthy' : (launchInProgress ? 'launching' : 'error'),
    selectedProvider: providerPreferences.selectedProvider,
    routeMode: providerPreferences.routeMode,
    fallbackEnabled: providerPreferences.fallbackEnabled,
    fallbackOrder: providerPreferences.fallbackOrder,
    providerHealth,
    backendAvailable: healthyBackend,
    runtimeContext: {
      frontendOrigin: currentOrigin,
      apiBaseUrl: effectiveBackendBaseUrl,
      homeNode: publishedHomeNode
        ? (homeNodeRouteAvailable ? publishedHomeNode : { ...publishedHomeNode, reachable: false })
        : null,
      homeNodeBridge: {
        configured: bridgeConfigured,
        accepted: bridgeValidation.ok,
        backendUrl: bridgeValidation.ok ? bridgeValidation.normalizedUrl : '',
        reachability: bridgeValidation.ok ? (bridgeReachable ? 'reachable' : 'unreachable') : (bridgeConfigured ? 'invalid' : 'unknown'),
        reason: bridgeValidation.ok
          ? (bridgeReachable ? 'Home-node bridge configured and reachable.' : (bridgeProbe.reason || 'Home-node bridge configured but health probe failed.'))
          : (bridgeValidation.reason || (bridgeConfigured ? 'Home-node bridge URL is invalid.' : 'No home-node bridge configured.')),
      },
      preferredTarget: effectiveBackendBaseUrl || candidateLaunchUrl || hostedDistUrl || '',
      actualTargetUsed: backendTargetResolvedUrl || '',
      nodeAddressSource: selectedHomeNodeSource || (isLoopbackHost(extractHostname(currentOrigin)) ? 'local-browser-session' : 'route-diagnostics'),
      backendTargetResolutionSource,
      backendTargetResolvedUrl,
      backendTargetFallbackUsed: false,
      backendTargetInvalidReason,
      publishedClientRouteState: backendPublishedRouteMisconfigured ? 'misconfigured' : (healthyBackend ? 'ready' : 'unavailable'),
      routeDiagnostics: {
        'local-desktop': {
          configured: localDesktopCapableSession,
          available: localDesktopCapableSession && healthyBackend,
          misconfigured: false,
          target: effectiveBackendBaseUrl,
          actualTarget: effectiveBackendBaseUrl,
          backendReachable: healthyBackend,
          uiReachable: Boolean(localPreferredTarget?.url),
          usable: localDesktopCapableSession && healthyBackend,
          source: localDesktopCapableSession
            ? (localPreferredTarget?.url ? 'local-runtime-probe' : 'local-backend-session')
            : 'not-applicable',
          reason: localDesktopCapableSession
            ? (healthyBackend
              ? (localPreferredTarget?.url
                ? 'Backend online and local desktop session can reach the live Stephanos UI'
                : 'Backend online locally; local-desktop stays valid and will use bundled dist UI until a live UI probe is available')
              : 'Local desktop session detected, but the backend is offline')
            : 'Current session is not a local desktop browser',
          blockedReason: localDesktopCapableSession && healthyBackend && !localPreferredTarget?.url
            ? 'backend is online locally, but no explicit live UI route was published'
            : '',
        },
        'home-node': {
          configured: Boolean(preferredHomeNode?.host),
          available: homeNodeRouteAvailable,
          misconfigured: preferredHomeNodeRouteMode === 'home-node-bridge'
            ? false
            : Boolean((homeNodeDiscovery.reachable && backendPublishedRouteMisconfigured) || (homeNodeDiscovery.reachable && preferredHomeNode?.host && !homeNodeUiReachable)),
          target: selectedHomeNodeBackendTarget,
          actualTarget: selectedHomeNodeBackendTarget,
          backendReachable: preferredHomeNodeRouteMode === 'home-node-bridge' ? bridgeReachable : Boolean(homeNodeDiscovery.reachable),
          uiReachable: preferredHomeNodeRouteMode === 'home-node-bridge' ? true : homeNodeUiReachable,
          usable: homeNodeRouteAvailable,
          source: selectedHomeNodeSource,
          routeVariant: preferredHomeNodeRouteMode,
          reason: homeNodeRouteAvailable
            ? (preferredHomeNodeRouteMode === 'home-node-bridge'
              ? 'Home-node bridge configured and reachable for hosted/off-network session'
              : (backendPublishedRouteMisconfigured
              ? 'Home PC node is reachable, but the published client route is misconfigured'
              : 'Home PC node is reachable on the LAN'))
            : (preferredHomeNodeRouteMode === 'home-node-bridge'
              ? (bridgeValidation.ok
                ? 'Home-node bridge configured but health probe failed'
                : (bridgeValidation.reason || 'Home-node bridge is not configured'))
              : (homeNodeDiscovery.reachable && preferredHomeNode?.host && !homeNodeUiReachable
              ? 'Home PC backend is reachable, but the published home-node UI target is unreachable from this launcher session'
              : (homeNodeDiscovery.reachable
                ? (backendPublishedRouteMisconfigured
                  ? 'Home PC node is reachable, but the published client route is misconfigured'
                  : 'Home PC node is reachable on the LAN')
                : (preferredHomeNode?.host
                  ? [
                    homeNodeDiscovery.message || 'Home PC node is configured but currently unreachable',
                    homeNodeDiscovery.attemptSummary ? `Candidates: ${homeNodeDiscovery.attemptSummary}` : '',
                    homeNodeDiscovery.operatorAction ? `Action: ${homeNodeDiscovery.operatorAction}` : '',
                  ].filter(Boolean).join(' ')
                  : 'Home PC node is not configured')))),
          blockedReason: preferredHomeNodeRouteMode === 'home-node-bridge'
            ? (homeNodeRouteAvailable ? '' : (bridgeValidation.ok ? (bridgeProbe.reason || 'bridge health probe failed') : (bridgeValidation.reason || 'bridge unavailable')))
            : ((!homeNodeRouteAvailable && homeNodeDiscovery.reachable && preferredHomeNode?.host && !homeNodeUiReachable)
            ? `home-node UI target is unreachable (${homeNodeTarget?.url || preferredHomeNode?.uiUrl || 'unknown target'})`
            : (!homeNodeDiscovery.reachable && preferredHomeNode?.host
            ? [
              homeNodeDiscovery.message || 'health probe could not confirm the home-node route',
              homeNodeDiscovery.attemptSummary ? `Candidates: ${homeNodeDiscovery.attemptSummary}` : '',
              homeNodeDiscovery.operatorAction ? `Action: ${homeNodeDiscovery.operatorAction}` : '',
            ].filter(Boolean).join(' ')
            : (!preferredHomeNode?.host ? 'home node is not configured' : ''))),
          publication: {
            backendUrlAccepted: !publishedHomeNodeBackendRejected,
            backendUrlCandidate: publishedHomeNode?.backendUrl || preferredHomeNode?.backendUrl || '',
            backendUrlReason: publishedHomeNodeBackendReason,
          },
        },
        'home-node-lan': {
          configured: Boolean(preferredHomeNode?.host),
          available: lanHomeNodeRouteAvailable,
          misconfigured: Boolean((homeNodeDiscovery.reachable && backendPublishedRouteMisconfigured) || (homeNodeDiscovery.reachable && preferredHomeNode?.host && !homeNodeUiReachable)),
          target: homeNodeTarget?.backendUrl || preferredHomeNode?.backendUrl || '',
          actualTarget: homeNodeTarget?.backendUrl || preferredHomeNode?.backendUrl || '',
          backendReachable: Boolean(homeNodeDiscovery.reachable),
          uiReachable: homeNodeUiReachable,
          usable: lanHomeNodeRouteAvailable,
          source: preferredHomeNode?.source || homeNodeDiscovery.source || (preferredHomeNode?.host ? 'configured-home-node' : 'not-configured'),
          routeVariant: 'home-node-lan',
          reason: lanHomeNodeRouteAvailable
            ? (backendPublishedRouteMisconfigured
              ? 'Home PC node is reachable, but the published client route is misconfigured'
              : 'Home PC node is reachable on the LAN')
            : (homeNodeDiscovery.reachable && preferredHomeNode?.host && !homeNodeUiReachable
              ? 'Home PC backend is reachable, but the published home-node UI target is unreachable from this launcher session'
              : (preferredHomeNode?.host
                ? [
                  homeNodeDiscovery.message || 'Home PC node is configured but currently unreachable',
                  homeNodeDiscovery.attemptSummary ? `Candidates: ${homeNodeDiscovery.attemptSummary}` : '',
                  homeNodeDiscovery.operatorAction ? `Action: ${homeNodeDiscovery.operatorAction}` : '',
                ].filter(Boolean).join(' ')
                : 'Home PC node is not configured')),
          blockedReason: lanHomeNodeRouteAvailable
            ? ''
            : (homeNodeDiscovery.reachable && preferredHomeNode?.host && !homeNodeUiReachable
              ? `home-node UI target is unreachable (${homeNodeTarget?.url || preferredHomeNode?.uiUrl || 'unknown target'})`
              : (!preferredHomeNode?.host
                ? 'home node is not configured'
                : [
                  homeNodeDiscovery.message || 'health probe could not confirm the home-node route',
                  homeNodeDiscovery.attemptSummary ? `Candidates: ${homeNodeDiscovery.attemptSummary}` : '',
                  homeNodeDiscovery.operatorAction ? `Action: ${homeNodeDiscovery.operatorAction}` : '',
                ].filter(Boolean).join(' '))),
        },
        'home-node-bridge': {
          configured: bridgeConfigured,
          available: bridgeReachable,
          misconfigured: bridgeConfigured && !bridgeValidation.ok,
          target: bridgeValidation.ok ? bridgeValidation.normalizedUrl : '',
          actualTarget: bridgeValidation.ok ? bridgeValidation.normalizedUrl : '',
          backendReachable: bridgeReachable,
          uiReachable: bridgeReachable,
          usable: bridgeReachable,
          source: 'home-node-bridge',
          reason: bridgeValidation.ok
            ? (bridgeReachable ? 'Home-node bridge configured and reachable' : 'Home-node bridge configured but health probe failed')
            : (bridgeValidation.reason || (bridgeConfigured ? 'Home-node bridge URL is invalid' : 'No home-node bridge configured')),
          blockedReason: bridgeReachable
            ? ''
            : (bridgeValidation.ok ? (bridgeProbe.reason || 'bridge health probe failed') : (bridgeValidation.reason || 'bridge unavailable')),
          publication: {
            configuredBridgeUrl,
            bridgeUrlAccepted: bridgeValidation.ok,
            bridgeUrlReason: bridgeValidation.ok ? '' : (bridgeValidation.reason || 'bridge url rejected'),
          },
        },
        dist: {
          configured: Boolean(entryExists || distPreferredTarget?.url),
          available: Boolean(distLive || entryExists),
          misconfigured: false,
          target: distPreferredTarget?.url || (entryExists ? hostedDistUrl : ''),
          actualTarget: distPreferredTarget?.url || (entryExists ? hostedDistUrl : ''),
          backendReachable: healthyBackend,
          uiReachable: Boolean(distLive || entryExists),
          usable: Boolean(distLive || entryExists),
          source: distLive ? 'dist-runtime-probe' : (entryExists ? 'dist-entry' : 'dist-unavailable'),
          reason: distLive
            ? 'Bundled dist runtime is reachable'
            : (entryExists
              ? 'Bundled dist entry exists and can be used as a fallback route'
              : 'Bundled dist runtime is unavailable'),
        },
        cloud: {
          configured: healthyBackend && Boolean(publishedBackendBaseUrl),
          available: healthyBackend && Boolean(publishedBackendBaseUrl) && !backendPublishedRouteMisconfigured,
          misconfigured: backendPublishedRouteMisconfigured,
          target: healthyBackend ? publishedBackendBaseUrl : '',
          actualTarget: healthyBackend ? publishedBackendBaseUrl : '',
          backendReachable: healthyBackend,
          uiReachable: healthyBackend,
          usable: healthyBackend && !backendPublishedRouteMisconfigured,
          source: healthyBackend ? 'backend-cloud-session' : 'cloud-route-unavailable',
          reason: healthyBackend
            ? (backendPublishedRouteMisconfigured
              ? 'A cloud-backed Stephanos route was published but is misconfigured'
              : 'A cloud-backed Stephanos route is ready')
            : 'No explicit cloud Stephanos runtime route was published',
          blockedReason: healthyBackend
            ? (backendPublishedRouteMisconfigured ? 'published cloud route is misconfigured' : '')
            : 'no cloud-backed route is currently ready',
        },
      },
    },
  });
  const finalRoute = runtimeStatusModel.finalRoute;
  const routeForensics = deriveStephanosRouteForensics({
    currentOrigin,
    backendBaseUrl: effectiveBackendBaseUrl,
    backendProbe,
    localDesktopProbe: localDesktopBackendProbe,
    homeNodeDiscovery,
    preferredHomeNode,
    runtimeProbe,
    statusProbe,
    finalRouteKind: finalRoute.routeKind,
  });
  runtimeStatusModel.routeForensics = routeForensics;
  const rawBuildTimestamp =
    launcherStatus?.buildTimestamp
    || runtimeProbe.json?.buildTimestamp
    || distMetadataProbe.json?.buildTimestamp
    || '';
  const buildStamp = formatBuildStamp(rawBuildTimestamp);
  const buildMarker = String(
    launcherStatus?.runtimeMarker
      || runtimeProbe.json?.runtimeMarker
      || distMetadataProbe.json?.runtimeMarker
      || ''
  ).trim();
  const buildStampLabel = `Stephanos Build: ${buildStamp}`;

  const launcherShellUrl = resolveCanonicalLauncherShellUrl(currentOrigin);
  let runtimeLaunchUrl = '';
  let launchStrategy = 'workspace';
  switch (finalRoute.routeKind) {
    case 'local-desktop':
      runtimeLaunchUrl = localPreferredTarget?.url || distPreferredTarget?.url || (entryExists ? hostedDistUrl : '');
      break;
    case 'home-node':
      runtimeLaunchUrl = homeNodeUiReachable
        ? (homeNodeTarget?.url || '')
        : (distPreferredTarget?.url || (entryExists ? hostedDistUrl : ''));
      launchStrategy = homeNodeUiReachable ? 'navigate' : 'workspace';
      break;
    case 'dist':
      runtimeLaunchUrl = distPreferredTarget?.url || (entryExists ? hostedDistUrl : '');
      break;
    case 'cloud':
      runtimeLaunchUrl = entryExists ? hostedDistUrl : (distPreferredTarget?.url || '');
      break;
    default:
      runtimeLaunchUrl = localPreferredTarget?.url || homeNodeTarget?.url || distPreferredTarget?.url || (entryExists ? hostedDistUrl : '');
      if (!runtimeLaunchUrl && homeNodeTarget?.url) {
        launchStrategy = 'navigate';
      }
      break;
  }

  let launchUrl = runtimeLaunchUrl;
  let launcherEntry = launcherShellUrl;
  let runtimeEntry = runtimeLaunchUrl;
  let launchEntry = runtimeLaunchUrl;

  const launchableRuntime = Boolean(launchUrl);
  const staleStateCleared = Boolean(
    launchableRuntime && (options.previousValidationState === 'error' || launcherState === 'error')
  );
  const validationReason = launchableRuntime
    ? `validator found route=${finalRoute.routeKind} target=${finalRoute.actualTarget || launchUrl}${backendPublishedRouteMisconfigured ? '; published-client-route=misconfigured' : ''}`
    : `no route reachable; local=${localPreferredTarget?.url || 'offline'}; home=${homeNodeTarget?.url || 'offline'}; cloud=${runtimeStatusModel.cloudRouteReachable ? 'ready' : 'offline'}`;

  emitStephanosValidationLog(context, {
    manifestEntry: String(options.manifestEntry || '').trim(),
    resolvedEntryPath,
    entryExists,
    runtimeStatusPath: STEPHANOS_STATUS_URL,
    runtimeUrl: runtimeLaunchUrl || hostedDistUrl || homeNodeTarget?.url || localPreferredTarget?.url || STEPHANOS_RUNTIME_URL,
    runtimeReachable: launchableRuntime,
    backendStatus: healthyBackend ? 'up' : backendState || 'down',
    staticServerStatus: launchableRuntime ? finalRoute.routeKind : uiState || 'down',
    launcherState,
    cacheBypassed: true,
    staleStateCleared,
    discoveryDisabled: Boolean(options.discoveryDisabled),
    disabled: Boolean(options.disabled),
    backendRequestPath: effectiveBackendProbe.requestPath || backendProbe.requestPath || '',
    backendResolvedBaseUrl: effectiveBackendProbe.backendBaseUrl || effectiveBackendBaseUrl || '',
    backendRequestSuccess: Boolean(effectiveBackendProbe.ok),
    runtimeMarker: buildMarker || null,
    gitCommit: launcherStatus?.gitCommit || runtimeProbe.json?.gitCommit || distMetadataProbe.json?.gitCommit || null,
    buildTimestamp: rawBuildTimestamp || null,
    reason: `${validationReason}; dependency=${runtimeStatusModel.dependencySummary}`,
  });

  if (launchableRuntime) {
    return {
      state: 'healthy',
      message: runtimeStatusModel.dependencySummary,
      issues: [],
      runtimeStatusModel,
      dependencyState: runtimeStatusModel.appLaunchState,
      routeForensics,
      providerHealth,
      launchUrl,
      runtimeLaunchUrl,
      launcherShellUrl,
      launcherEntry,
      runtimeEntry,
      launchEntry,
      launchStrategy,
      runtimeTargets: [
        ...probedTargets,
        ...(homeNodeLaunchProbe ? [homeNodeLaunchProbe] : (homeNodeTarget ? [homeNodeTarget] : [])),
      ],
      runtimeAvailability: {
        dev: devLiveTargets.map((target) => target.url),
        dist: [distPreferredTarget?.url || hostedDistUrl].filter(Boolean),
        homeNode: homeNodeUiReachable && homeNodeTarget ? [homeNodeTarget.url] : [],
      },
      buildStamp,
      buildStampLabel,
      buildMarker,
    };
  }

  if (launchInProgress || buildState === 'building' || buildState === 'verifying-build' || uiState === 'starting') {
    return {
      state: 'launching',
      message: launcherMessage || 'Checking reachable Stephanos route.',
      runtimeStatusModel,
      dependencyState: 'degraded',
      routeForensics,
      providerHealth,
      runtimeTargets: [...probedTargets, ...(homeNodeLaunchProbe ? [homeNodeLaunchProbe] : (homeNodeTarget ? [homeNodeTarget] : []))],
      buildStamp,
      buildStampLabel,
      buildMarker,
    };
  }

  return {
    state: 'error',
    message: runtimeStatusModel.dependencySummary,
    issues: [runtimeStatusModel.dependencySummary],
    runtimeStatusModel,
    dependencyState: 'unavailable',
    routeForensics,
    providerHealth,
    runtimeTargets: [...probedTargets, ...(homeNodeLaunchProbe ? [homeNodeLaunchProbe] : (homeNodeTarget ? [homeNodeTarget] : []))],
    runtimeAvailability: {
      dev: [],
      dist: entryExists ? [hostedDistUrl] : [],
      homeNode: [],
    },
    buildStamp,
    buildStampLabel,
    buildMarker,
  };
}

export async function validateApps(apps, context = {}) {
  const results = [];

  for (const app of apps) {
    if (app?.discoveryDisabled) {
      continue;
    }

    const issues = [];
    const appRoot = getAppRoot(app);
    const manifest = await validateAppManifest(app, issues);

    if (!manifest) {
      results.push({ app: app?.name || app?.id || "unknown", issues });
      continue;
    }

    const entryPath = resolveManifestPath(app, manifest) || app?.entry || "";
    const packaging = resolvePackagingMode({ app, manifest });
    const packagingValidation = validateEntryForPackaging({ packaging, entry: manifest?.entry });
    const stephanosApp = isStephanosApp(app);

    if (!packagingValidation.ok) {
      issues.push(packagingValidation.message);
    }

    const entryExists = stephanosApp ? Boolean(entryPath) : await validateEntryExists(entryPath, issues);
    const packagingSupported = isSupportedPackagingMode(packaging);

    if (!packagingSupported && packagingValidation.code !== "unsupported-packaging") {
      issues.push(`Unsupported packaging mode: ${packaging}`);
    } else if (packagingSupported && entryExists && !stephanosApp) {
      if (packaging === "vite") {
        await validateViteApp(entryPath, issues);
      }

      if (packaging === "classic-static") {
        await validateClassicStaticApp(appRoot, entryPath, manifest, issues);
      }
    }

    const appId = String(app?.folder || app?.id || app?.name || "unknown").toLowerCase();

    if (stephanosApp && packagingSupported) {
      const previousValidationState = app?.validationState || "unknown";
      const stephanosStatus = await validateStephanosRuntime(entryPath, context, {
        manifestEntry: manifest?.entry,
        previousValidationState,
        discoveryDisabled: app?.discoveryDisabled,
        disabled: app?.disabled
      });

      app.runtimeStatusModel = stephanosStatus.runtimeStatusModel || null;
      app.providerHealth = stephanosStatus.providerHealth || {};
      app.dependencyState = stephanosStatus.dependencyState || stephanosStatus.runtimeStatusModel?.appLaunchState || 'ready';
      app.runtimeTargets = Array.isArray(stephanosStatus.runtimeTargets) ? stephanosStatus.runtimeTargets : [];
      app.runtimeAvailability = stephanosStatus.runtimeAvailability || { dev: [], dist: [] };
      app.buildStamp = stephanosStatus.buildStamp || 'unknown';
      app.buildStampLabel = stephanosStatus.buildStampLabel || 'Stephanos Build: unknown';
      app.buildMarker = stephanosStatus.buildMarker || '';
      app.launcherEntry = stephanosStatus.launcherEntry || stephanosStatus.launcherShellUrl || app.launcherEntry || app.entry;
      app.runtimeEntry = stephanosStatus.runtimeEntry || stephanosStatus.runtimeLaunchUrl || app.runtimeEntry || app.entry;
      app.launchEntry = stephanosStatus.launchEntry || stephanosStatus.launchUrl || app.launchEntry || app.entry;
      if (app.launchEntry) {
        if (app.entry && app.entry !== app.launchEntry) {
          warnStephanosEntryInvariant('Updating compatibility app.entry from authoritative launchEntry while preserving separated fields.', {
            previousEntry: app.entry,
            launchEntry: app.launchEntry,
            launcherEntry: app.launcherEntry,
            runtimeEntry: app.runtimeEntry,
          }, STEPHANOS_LAW_IDS.ENTRY_COMPATIBILITY_ONLY);
        }
        app.entry = app.launchEntry;
      }

      if (!app.launcherEntry || !app.runtimeEntry || !app.launchEntry) {
        warnStephanosEntryInvariant('Stephanos validation produced incomplete separated launch fields.', {
          launcherEntry: app.launcherEntry || '',
          runtimeEntry: app.runtimeEntry || '',
          launchEntry: app.launchEntry || '',
          entry: app.entry || '',
        }, STEPHANOS_LAW_IDS.ENTRY_SEPARATION);
      }

      if (
        app.launcherEntry &&
        app.runtimeEntry &&
        app.launcherEntry === app.runtimeEntry &&
        String(globalThis.location?.pathname || '/') === '/'
      ) {
        warnStephanosEntryInvariant('Launcher and runtime entries unexpectedly match on root launcher context.', {
          launcherEntry: app.launcherEntry,
          runtimeEntry: app.runtimeEntry,
          launchEntry: app.launchEntry,
        }, STEPHANOS_LAW_IDS.RUNTIME_TARGET_DISTINCT);
      }

      app.launchStrategy = stephanosStatus.launchStrategy || 'workspace';

      if (previousValidationState === "error" && stephanosStatus.state !== "error") {
        emitDiagnostic(context, "stephanos validation: cleared stale failure state after successful revalidation");
      }

      if (stephanosStatus.state === "healthy") {
        applyAppStatus(app, stephanosStatus, context);
        emitDiagnostic(context, `${appId}: ${stephanosStatus.message}`);
        context?.eventBus?.emit("app:validation_passed", {
          name: app?.name,
          folder: app?.folder,
          entry: entryPath,
          message: stephanosStatus.message
        });
        continue;
      }

      applyAppStatus(app, stephanosStatus, context);

      if (stephanosStatus.state === "launching") {
        emitStephanosValidationLog(context, {
          manifestEntry: manifest?.entry,
          resolvedEntryPath: entryPath,
          entryExists: true,
          runtimeStatusPath: STEPHANOS_STATUS_URL,
          runtimeUrl: stephanosStatus.launchUrl || stephanosStatus.runtimeTargets?.find((target) => target?.kind === "dev")?.url || STEPHANOS_RUNTIME_URL,
          runtimeReachable: false,
          backendStatus: "starting",
          staticServerStatus: "starting",
          launcherState: "launching",
          staleStateCleared: false,
          discoveryDisabled: Boolean(app?.discoveryDisabled),
          disabled: Boolean(app?.disabled),
          reason: stephanosStatus.message
        });
        emitDiagnostic(context, `${appId}: ${stephanosStatus.message}`);
        continue;
      }

      const stephanosIssues = stephanosStatus.issues || [];
      context?.eventBus?.emit("app:validation_failed", {
        name: app?.name,
        folder: app?.folder,
        entry: entryPath,
        issues: stephanosIssues
      });
      emitDiagnostic(context, `${appId}: ${stephanosIssues[0]}`);
      emitStephanosValidationLog(context, {
        manifestEntry: manifest?.entry,
        resolvedEntryPath: entryPath,
        entryExists: true,
        runtimeStatusPath: STEPHANOS_STATUS_URL,
        runtimeUrl: stephanosStatus.launchUrl || stephanosStatus.runtimeTargets?.find((target) => target?.kind === "dev")?.url || STEPHANOS_RUNTIME_URL,
        runtimeReachable: false,
        backendStatus: "down",
        staticServerStatus: "down",
        launcherState: "error",
        staleStateCleared: false,
        discoveryDisabled: Boolean(app?.discoveryDisabled),
        disabled: Boolean(app?.disabled),
        reason: stephanosIssues[0]
      });
      results.push({
        app: app.name,
        issues: stephanosIssues
      });
      continue;
    }

    if (issues.length > 0) {
      applyAppStatus(app, {
        state: "error",
        message: issues[0] || "App failed validation",
        issues
      }, context);

      context?.eventBus?.emit("app:validation_failed", {
        name: app?.name,
        folder: app?.folder,
        entry: entryPath,
        issues
      });

      emitDiagnostic(context, `${appId}: ${issues[0]}`);

      results.push({
        app: app.name,
        issues
      });

      continue;
    }

    applyAppStatus(app, {
      state: "healthy",
      message: "App ready",
      issues: []
    }, context);

    context?.eventBus?.emit("app:validation_passed", {
      name: app?.name,
      folder: app?.folder,
      entry: entryPath,
      message: "App ready"
    });

    emitDiagnostic(context, `${appId}: valid ${packaging === "classic-static" ? "classic" : packaging} app`);
  }

  syncValidationReport(apps, context);
  return results;
}
