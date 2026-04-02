import { loadDependencies } from "./apps/dependency_loader.js";
import { createStephanosRuntimeTargets, getStephanosPreferredRuntimeTarget } from "../shared/runtime/stephanosLocalUrls.mjs";
import { clearActiveTileContextHint, setActiveTileContextHint } from "../shared/runtime/tileContextRegistry.mjs";
import { recordStartupLaunchTrigger } from "../shared/runtime/startupLaunchDiagnostics.mjs";
import { STEPHANOS_LAW_IDS } from "../shared/runtime/stephanosLaws.mjs";

function renderAppLoadError(container, message) {
  const error = document.createElement("div");
  error.style.color = "red";
  error.style.padding = "20px";
  error.innerText = message;
  container.appendChild(error);
}

const STEPHANOS_RUNTIME_TARGETS = createStephanosRuntimeTargets();
const STEPHANOS_RUNTIME_URL = getStephanosPreferredRuntimeTarget(STEPHANOS_RUNTIME_TARGETS)?.url || STEPHANOS_RUNTIME_TARGETS[0]?.url || "http://localhost:5173/";
const WORKSPACE_EMBED_TIMEOUT_MS = 15000;

function buildWorkspaceLoadErrorMessage(project) {
  if (isStephanosProject(project)) {
    return `Stephanos failed to load in the launcher. Try opening ${STEPHANOS_RUNTIME_URL} directly.`;
  }

  return "Simulation failed to load. Check console for details.";
}

function isCrossOriginHttpUrl(value = '') {
  try {
    const parsed = new URL(value, window.location.href);
    return /^https?:$/i.test(parsed.protocol) && parsed.origin !== window.location.origin;
  } catch {
    return false;
  }
}

function isStephanosProject(project) {
  const identifier = String(project?.folder || project?.id || project?.name || "").trim().toLowerCase();
  return identifier === "stephanos" || identifier === "stephanos os";
}

function resolveProjectEntryUrl(project) {
  const rawEntry = String(project?.entry || "").trim();
  if (!rawEntry) {
    return "";
  }

  try {
    return new URL(rawEntry, window.location.href).href;
  } catch {
    return rawEntry;
  }
}

function resolveStephanosLaunchTarget(project) {
  const launchEntry = String(project?.launchEntry || '').trim();
  const runtimeEntry = String(project?.runtimeEntry || '').trim();
  const compatibilityEntry = String(project?.entry || '').trim();
  const resolved = String(
    launchEntry
    || runtimeEntry
    || compatibilityEntry
    || ''
  ).trim();

  if (!launchEntry && (runtimeEntry || compatibilityEntry)) {
    console.warn(`[Workspace Guardrail] [LAW:${STEPHANOS_LAW_IDS.ENTRY_SEPARATION}] Stephanos launchEntry missing; using fallback order launchEntry -> runtimeEntry -> entry.`, {
      runtimeEntry,
      entry: compatibilityEntry,
      resolved,
    });
  }

  return resolved;
}

function getProjectKey(project) {
  return String(project?.folder || project?.id || project?.entry || project?.name || "workspace")
    .trim()
    .toLowerCase();
}

function rememberDisplayValue(node) {
  if (!node?.style) {
    return;
  }

  if (typeof node.dataset?.workspacePreviousDisplay === "undefined") {
    node.dataset.workspacePreviousDisplay = node.style.display || "";
  }
}

function restoreDisplayValue(node, fallback = "") {
  if (!node?.style) {
    return;
  }

  const nextDisplay = node.dataset?.workspacePreviousDisplay ?? fallback;
  node.style.display = nextDisplay;

  if (node.dataset && "workspacePreviousDisplay" in node.dataset) {
    delete node.dataset.workspacePreviousDisplay;
  }
}

export function createWorkspaceRuntimeState() {
  return {
    nextSessionId: 0,
    activeSessionId: 0,
    activeProjectKey: "",
    isOpen: false,
    isChromeHidden: false,
    iframeCreationCount: 0,
    mountCount: 0,
    closeCount: 0,
    repeatedLaunchCount: 0,
    chromeHideCount: 0,
    chromeShowCount: 0,
    launchLog: [],
    activeIframe: null,
    loadTimeoutId: null,
  };
}

const workspaceRuntimeState = createWorkspaceRuntimeState();

function pushWorkspaceLaunchLog(runtimeState, entry) {
  runtimeState.launchLog.unshift({
    timestamp: Date.now(),
    ...entry,
  });

  if (runtimeState.launchLog.length > 25) {
    runtimeState.launchLog.length = 25;
  }
}

function logWorkspaceEvent(message, details = {}) {
  if (Object.keys(details).length > 0) {
    console.log(`[Workspace] ${message}`, details);
    return;
  }

  console.log(`[Workspace] ${message}`);
}

function beginWorkspaceSession(project, runtimeState = workspaceRuntimeState) {
  const projectKey = getProjectKey(project);
  const isRepeatedLaunch = runtimeState.isOpen && runtimeState.activeProjectKey === projectKey;

  if (isRepeatedLaunch) {
    runtimeState.repeatedLaunchCount += 1;
    pushWorkspaceLaunchLog(runtimeState, {
      type: "launch-skipped",
      projectKey,
      reason: "duplicate-open-request",
    });
    logWorkspaceEvent("Repeated launch cycle suppressed", {
      projectKey,
      repeatedLaunchCount: runtimeState.repeatedLaunchCount,
    });

    return {
      sessionId: runtimeState.activeSessionId,
      projectKey,
      isRepeatedLaunch: true,
    };
  }

  const sessionId = runtimeState.nextSessionId + 1;
  runtimeState.nextSessionId = sessionId;
  runtimeState.activeSessionId = sessionId;
  runtimeState.activeProjectKey = projectKey;
  runtimeState.mountCount += 1;
  runtimeState.isOpen = true;

  pushWorkspaceLaunchLog(runtimeState, {
    type: "mount",
    sessionId,
    projectKey,
  });
  logWorkspaceEvent("Workspace mount", {
    sessionId,
    projectKey,
    mountCount: runtimeState.mountCount,
  });

  return {
    sessionId,
    projectKey,
    isRepeatedLaunch: false,
  };
}

function isWorkspaceSessionCurrent(sessionId, runtimeState = workspaceRuntimeState) {
  return runtimeState.activeSessionId === sessionId;
}

function clearWorkspaceLoadTimeout(runtimeState = workspaceRuntimeState, windowRef = globalThis.window) {
  if (runtimeState.loadTimeoutId !== null && typeof windowRef?.clearTimeout === "function") {
    windowRef.clearTimeout(runtimeState.loadTimeoutId);
  }

  runtimeState.loadTimeoutId = null;
}

function recordWorkspaceIframeCreation(project, sessionId, runtimeState = workspaceRuntimeState) {
  runtimeState.iframeCreationCount += 1;
  pushWorkspaceLaunchLog(runtimeState, {
    type: "iframe-created",
    sessionId,
    projectKey: getProjectKey(project),
    iframeCreationCount: runtimeState.iframeCreationCount,
  });
  logWorkspaceEvent("Workspace iframe created", {
    sessionId,
    project: project?.name || project?.id || "workspace",
    iframeCreationCount: runtimeState.iframeCreationCount,
  });
}

export function getWorkspaceRuntimeDebugState() {
  return {
    ...workspaceRuntimeState,
    launchLog: workspaceRuntimeState.launchLog.map((entry) => ({ ...entry })),
  };
}

export function resetWorkspaceRuntimeDebugState() {
  clearWorkspaceLoadTimeout(workspaceRuntimeState);
  Object.assign(workspaceRuntimeState, createWorkspaceRuntimeState());
}

export function getWorkspaceAncillaryNodes(documentRef = document) {
  const stephanosLayout = documentRef.getElementById("stephanos-layout");
  const developerConsole = documentRef.getElementById("dev-console");
  const developerConsoleSection = typeof developerConsole?.closest === "function"
    ? developerConsole.closest("section")
    : null;

  return {
    stephanosLayout,
    developerConsole,
    developerConsoleSection,
  };
}

export function setWorkspaceChromeVisibility(isWorkspaceOpen, documentRef = document, runtimeState = workspaceRuntimeState) {
  if (runtimeState.isChromeHidden === isWorkspaceOpen) {
    return false;
  }

  const { stephanosLayout, developerConsole, developerConsoleSection } = getWorkspaceAncillaryNodes(documentRef);
  const body = documentRef?.body;

  if (isWorkspaceOpen) {
    if (body?.classList) {
      body.classList.add("workspace-active");
    }

    [stephanosLayout, developerConsoleSection, developerConsole].forEach((node) => {
      if (!node) return;
      rememberDisplayValue(node);
      node.style.display = "none";
      if (typeof node.setAttribute === "function") {
        node.setAttribute("aria-hidden", "true");
        node.setAttribute("inert", "");
      }
    });

    runtimeState.isChromeHidden = true;
    runtimeState.chromeHideCount += 1;
    pushWorkspaceLaunchLog(runtimeState, {
      type: "chrome-hidden",
      chromeHideCount: runtimeState.chromeHideCount,
    });
    logWorkspaceEvent("Workspace chrome hidden", {
      chromeHideCount: runtimeState.chromeHideCount,
    });
    return true;
  }

  if (body?.classList) {
    body.classList.remove("workspace-active");
  }

  [stephanosLayout, developerConsoleSection, developerConsole].forEach((node) => {
    if (!node) return;
    restoreDisplayValue(node);
    if (typeof node.removeAttribute === "function") {
      node.removeAttribute("aria-hidden");
      node.removeAttribute("inert");
    }
  });

  runtimeState.isChromeHidden = false;
  runtimeState.chromeShowCount += 1;
  pushWorkspaceLaunchLog(runtimeState, {
    type: "chrome-restored",
    chromeShowCount: runtimeState.chromeShowCount,
  });
  logWorkspaceEvent("Workspace chrome restored", {
    chromeShowCount: runtimeState.chromeShowCount,
  });
  return true;
}

export function applyWorkspaceIframeInteractivity(iframe) {
  if (!iframe?.style) {
    return iframe;
  }

  iframe.style.display = "block";
  iframe.style.position = "relative";
  iframe.style.zIndex = "1";
  iframe.style.pointerEvents = "auto";
  iframe.style.background = "#02060d";

  return iframe;
}

function createWorkspaceReturnButton(documentRef, handler, position = "top") {
  const returnButton = documentRef.createElement("button");
  returnButton.textContent = "Return to Command Deck";
  returnButton.style.alignSelf = "flex-start";
  returnButton.style.minHeight = "44px";
  returnButton.style.padding = "10px 16px";
  returnButton.style.margin = position === "top" ? "0 0 10px 0" : "10px 0 0 0";
  returnButton.style.touchAction = "manipulation";
  returnButton.onclick = handler;
  return returnButton;
}

function appendWorkspaceReturnControls(documentRef, contentNode) {
  const handleReturn = () => {
    window.returnToCommandDeck();
  };

  const topReturnButton = createWorkspaceReturnButton(documentRef, handleReturn, "top");
  const bottomReturnButton = createWorkspaceReturnButton(documentRef, handleReturn, "bottom");
  contentNode.appendChild(topReturnButton);

  return { topReturnButton, bottomReturnButton };
}

function buildWorkspaceFrameContainer(documentRef) {
  const container = documentRef.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "8px";
  container.style.position = "relative";
  return container;
}

function showWorkspaceFallback(container, project, context) {
  context?.eventBus?.emit("workspace:launch_failed", project);
  context?.eventBus?.emit("tile.result", {
    tileId: String(project?.folder || project?.id || project?.name || "").trim().toLowerCase(),
    tileTitle: project?.name || "Unknown Tile",
    result: "launch-failed",
    source: "workspace",
    summary: `Failed to open ${project?.name || "workspace tile"}.`,
  });
  renderAppLoadError(container, buildWorkspaceLoadErrorMessage(project));
}

export const workspace = {
  async open(project, context = {}) {
    const workspacePanel = document.getElementById("workspace");
    const content = document.getElementById("workspace-content");
    const projectsPanel = document.getElementById("projects");
    const title = document.getElementById("workspace-title");

    if (!workspacePanel || !content || !projectsPanel || !title) {
      console.error("Workspace UI is missing required elements");
      return;
    }

    const launch = beginWorkspaceSession(project);
    if (launch.isRepeatedLaunch) {
      return;
    }

    clearWorkspaceLoadTimeout();

    setActiveTileContextHint({
      tileId: String(project?.folder || project?.id || project?.name || "").trim().toLowerCase(),
      tileTitle: project?.name || "Workspace",
      tileType: project?.type || "workspace",
      source: "workspace",
    });
    context?.eventBus?.emit("tile.focused", {
      tileId: String(project?.folder || project?.id || project?.name || "").trim().toLowerCase(),
      tileTitle: project?.name || "Workspace",
      source: "workspace",
      summary: `Focused ${project?.name || "workspace tile"}.`,
    });

    workspacePanel.style.display = "block";
    projectsPanel.style.display = "none";
    setWorkspaceChromeVisibility(true);
    title.textContent = project?.name || "Workspace";
    content.innerHTML = "";
    workspaceRuntimeState.activeIframe = null;

    const stephanosLaunchTarget = isStephanosProject(project)
      ? resolveStephanosLaunchTarget(project)
      : "";
    const resolvedEntryUrl = resolveProjectEntryUrl({
      ...project,
      entry: stephanosLaunchTarget || project?.entry,
    });

    if (isStephanosProject(project) && resolvedEntryUrl) {
      recordStartupLaunchTrigger({
        sourceModule: "system/workspace.js",
        sourceFunction: "workspace.open",
        triggerType: "workspace-open-stephanos",
        triggerPayload: {
          launchStrategy: project?.launchStrategy || "workspace",
          projectName: project?.name || "",
        },
        rawTarget: stephanosLaunchTarget || project?.entry || "",
        resolvedTarget: resolvedEntryUrl,
      });
      logWorkspaceEvent("Stephanos launch using validated top-level target", {
        sessionId: launch.sessionId,
        projectKey: launch.projectKey,
        launchStrategy: project?.launchStrategy || "workspace",
        rawEntry: stephanosLaunchTarget || project?.entry || "",
        resolvedEntryUrl,
        reason: "validated-route navigation",
      });
      window.location.assign(resolvedEntryUrl);
      return;
    }

    if (isStephanosProject(project) && isCrossOriginHttpUrl(project?.entry)) {
      recordStartupLaunchTrigger({
        sourceModule: "system/workspace.js",
        sourceFunction: "workspace.open",
        triggerType: "workspace-open-stephanos-cross-origin",
        triggerPayload: {
          launchStrategy: project?.launchStrategy || "workspace",
          projectName: project?.name || "",
        },
        rawTarget: project?.entry || "",
        resolvedTarget: project?.entry || "",
      });
      logWorkspaceEvent("Stephanos launch escalated to top-level navigation", {
        sessionId: launch.sessionId,
        target: project.entry,
      });
      window.location.href = project.entry;
      return;
    }

    if (project?.entry && project.entry.endsWith(".md")) {
      const response = await fetch(project.entry);
      if (!isWorkspaceSessionCurrent(launch.sessionId)) {
        return;
      }

      const text = await response.text();
      if (!isWorkspaceSessionCurrent(launch.sessionId)) {
        return;
      }

      const container = document.createElement("div");

      container.style.whiteSpace = "pre-wrap";
      container.style.wordWrap = "break-word";
      container.style.maxHeight = "70vh";
      container.style.overflowY = "auto";
      container.style.padding = "20px";
      container.style.background = "#111";
      container.style.color = "#0f0";
      container.style.fontFamily = "monospace";
      container.style.borderRadius = "8px";
      container.textContent = text;

      const { bottomReturnButton } = appendWorkspaceReturnControls(document, content);
      content.appendChild(container);
      content.appendChild(bottomReturnButton);
      context?.eventBus?.emit("workspace:opened", project);
      context?.eventBus?.emit("tile.opened", {
        tileId: String(project?.folder || project?.id || project?.name || "").trim().toLowerCase(),
        tileTitle: project?.name || "Workspace",
        source: "workspace",
        summary: `Opened ${project?.name || "workspace tile"}.`,
      });
      return;
    }

    if (project?.entry) {
      const container = buildWorkspaceFrameContainer(document);
      const { bottomReturnButton } = appendWorkspaceReturnControls(document, content);
      content.appendChild(container);
      content.appendChild(bottomReturnButton);

      try {
        await loadDependencies(project);
        if (!isWorkspaceSessionCurrent(launch.sessionId)) {
          return;
        }

        const entryResponse = await fetch(project.entry, { method: "HEAD" });
        if (!entryResponse.ok) {
          throw new Error(`Entry file unavailable (${entryResponse.status})`);
        }

        if (!isWorkspaceSessionCurrent(launch.sessionId)) {
          return;
        }
      } catch (err) {
        if (!isWorkspaceSessionCurrent(launch.sessionId)) {
          return;
        }

        console.error("App preflight failed:", project?.name, err);
        showWorkspaceFallback(container, project, context);
        return;
      }

      const iframe = document.createElement("iframe");
      iframe.src = project.entry;
      iframe.style.width = "100%";
      iframe.style.height = "700px";
      iframe.style.border = "none";
      iframe.setAttribute("loading", "eager");
      iframe.setAttribute("referrerpolicy", "no-referrer");
      iframe.setAttribute("title", `${project?.name || "Workspace"} runtime`);
      applyWorkspaceIframeInteractivity(iframe);
      recordWorkspaceIframeCreation(project, launch.sessionId);
      workspaceRuntimeState.activeIframe = iframe;

      iframe.onerror = () => {
        if (!isWorkspaceSessionCurrent(launch.sessionId)) {
          return;
        }

        clearWorkspaceLoadTimeout();
        logWorkspaceEvent("Workspace iframe failed", {
          sessionId: launch.sessionId,
          projectKey: launch.projectKey,
        });
        showWorkspaceFallback(container, project, context);
      };

      iframe.addEventListener("load", () => {
        if (!isWorkspaceSessionCurrent(launch.sessionId)) {
          return;
        }

        clearWorkspaceLoadTimeout();
        logWorkspaceEvent("Workspace iframe loaded", {
          sessionId: launch.sessionId,
          projectKey: launch.projectKey,
        });

        if (isStephanosProject(project)) {
          context?.eventBus?.emit("app:revalidate_requested", {
            appId: "stephanos",
            reason: "workspace iframe load"
          });
        }
      }, { once: true });

      clearWorkspaceLoadTimeout();
      workspaceRuntimeState.loadTimeoutId = window.setTimeout(() => {
        if (!isWorkspaceSessionCurrent(launch.sessionId)) {
          return;
        }

        logWorkspaceEvent("Workspace iframe load timeout", {
          sessionId: launch.sessionId,
          projectKey: launch.projectKey,
          timeoutMs: WORKSPACE_EMBED_TIMEOUT_MS,
        });
        iframe.remove();
        workspaceRuntimeState.activeIframe = null;
        showWorkspaceFallback(container, project, context);
      }, WORKSPACE_EMBED_TIMEOUT_MS);

      container.appendChild(iframe);
      context?.eventBus?.emit("workspace:opened", project);
      context?.eventBus?.emit("tile.opened", {
        tileId: String(project?.folder || project?.id || project?.name || "").trim().toLowerCase(),
        tileTitle: project?.name || "Workspace",
        source: "workspace",
        summary: `Opened ${project?.name || "workspace tile"}.`,
      });
      return;
    }

    content.textContent = `Workspace for ${project?.name || "project"}`;
    context?.eventBus?.emit("workspace:opened", project);
    context?.eventBus?.emit("tile.opened", {
      tileId: String(project?.folder || project?.id || project?.name || "").trim().toLowerCase(),
      tileTitle: project?.name || "Workspace",
      source: "workspace",
      summary: `Opened ${project?.name || "workspace tile"}.`,
    });
  },

  close(context = {}) {
    const workspacePanel = document.getElementById("workspace");
    const projectsPanel = document.getElementById("projects");
    const content = document.getElementById("workspace-content");

    if (!workspacePanel || !projectsPanel || !content) {
      console.error("Workspace UI is missing required elements");
      return;
    }

    clearWorkspaceLoadTimeout();
    clearActiveTileContextHint();

    if (workspaceRuntimeState.activeIframe?.remove) {
      workspaceRuntimeState.activeIframe.remove();
    }

    workspaceRuntimeState.activeIframe = null;
    workspaceRuntimeState.activeSessionId = 0;
    workspaceRuntimeState.activeProjectKey = "";
    workspaceRuntimeState.isOpen = false;
    workspaceRuntimeState.closeCount += 1;
    pushWorkspaceLaunchLog(workspaceRuntimeState, {
      type: "close",
      closeCount: workspaceRuntimeState.closeCount,
    });
    logWorkspaceEvent("Workspace close", {
      closeCount: workspaceRuntimeState.closeCount,
    });

    content.innerHTML = "";
    workspacePanel.style.display = "none";
    projectsPanel.style.display = "block";
    setWorkspaceChromeVisibility(false);

    context?.eventBus?.emit("workspace:closed");
    context?.eventBus?.emit("tile.closed", {
      source: "workspace",
      summary: "Workspace returned to command deck.",
    });
  }
};
