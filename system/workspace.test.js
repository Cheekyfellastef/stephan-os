import test from "node:test";
import assert from "node:assert/strict";
import {
  applyWorkspaceIframeInteractivity,
  createWorkspaceRuntimeState,
  getWorkspaceAncillaryNodes,
  getWorkspaceRuntimeDebugState,
  resetWorkspaceRuntimeDebugState,
  setWorkspaceChromeVisibility,
  workspace,
} from "./workspace.js";

function createElement({ display = "", tagName = "div", closestResult = null, ownerDocument = null } = {}) {
  const classes = new Set();
  const attributes = new Map();
  const listeners = new Map();

  const node = {
    tagName,
    style: { display },
    dataset: {},
    children: [],
    textContent: "",
    innerText: "",
    ownerDocument,
    parentNode: null,
    classList: {
      add(value) {
        classes.add(value);
      },
      remove(value) {
        classes.delete(value);
      },
      contains(value) {
        return classes.has(value);
      },
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    remove() {
      if (!this.parentNode) {
        return;
      }

      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) {
        this.parentNode.children.splice(index, 1);
      }
      this.parentNode = null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    getAttribute(name) {
      return attributes.get(name);
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatchEvent(type) {
      const handler = listeners.get(type);
      if (handler) {
        handler();
      }
    },
    closest(selector) {
      if (selector === "section") {
        return closestResult;
      }
      return null;
    },
  };

  Object.defineProperty(node, "innerHTML", {
    get() {
      return "";
    },
    set(_value) {
      node.children = [];
      node.textContent = "";
      node.innerText = "";
    },
  });

  return node;
}

function createDocumentFixture() {
  const documentRef = {
    nodes: {},
    body: null,
    head: null,
    createElement(tagName) {
      return createElement({ tagName, ownerDocument: documentRef });
    },
    getElementById(id) {
      return this.nodes[id] || null;
    },
  };

  const layout = createElement({ display: "grid", tagName: "section", ownerDocument: documentRef });
  const developerConsoleSection = createElement({ display: "block", tagName: "section", ownerDocument: documentRef });
  const developerConsole = createElement({ display: "block", ownerDocument: documentRef, closestResult: developerConsoleSection });
  const body = createElement({ tagName: "body", ownerDocument: documentRef });
  const head = createElement({ tagName: "head", ownerDocument: documentRef });
  const workspacePanel = createElement({ display: "none", tagName: "section", ownerDocument: documentRef });
  const workspaceContent = createElement({ tagName: "div", ownerDocument: documentRef });
  const projectsPanel = createElement({ display: "block", tagName: "section", ownerDocument: documentRef });
  const workspaceTitle = createElement({ tagName: "h2", ownerDocument: documentRef });

  workspacePanel.appendChild(workspaceContent);

  documentRef.body = body;
  documentRef.head = head;
  documentRef.nodes = {
    "stephanos-layout": layout,
    "dev-console": developerConsole,
    workspace: workspacePanel,
    "workspace-content": workspaceContent,
    projects: projectsPanel,
    "workspace-title": workspaceTitle,
  };

  return documentRef;
}

function installWorkspaceGlobals(documentRef, fetchImpl) {
  const timers = new Map();
  let nextTimerId = 1;

  globalThis.document = documentRef;
  globalThis.window = {
    location: new URL("http://localhost/"),
    setTimeout(callback, _delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    returnToCommandDeck() {},
  };
  globalThis.fetch = fetchImpl;

  return {
    timers,
    restore() {
      delete globalThis.document;
      delete globalThis.window;
      delete globalThis.fetch;
    },
  };
}

test.afterEach(() => {
  resetWorkspaceRuntimeDebugState();
});

test("getWorkspaceAncillaryNodes finds launcher chrome nodes", () => {
  const documentRef = createDocumentFixture();
  const nodes = getWorkspaceAncillaryNodes(documentRef);

  assert.equal(nodes.stephanosLayout, documentRef.nodes["stephanos-layout"]);
  assert.equal(nodes.developerConsole, documentRef.nodes["dev-console"]);
  assert.equal(nodes.developerConsoleSection, documentRef.nodes["dev-console"].closest("section"));
});

test("setWorkspaceChromeVisibility hides and restores launcher chrome around workspace sessions", () => {
  const documentRef = createDocumentFixture();
  const runtimeState = createWorkspaceRuntimeState();

  assert.equal(setWorkspaceChromeVisibility(true, documentRef, runtimeState), true);
  assert.equal(setWorkspaceChromeVisibility(true, documentRef, runtimeState), false);

  assert.equal(documentRef.nodes["stephanos-layout"].style.display, "none");
  assert.equal(documentRef.nodes["dev-console"].style.display, "none");
  assert.equal(documentRef.nodes["dev-console"].closest("section").style.display, "none");
  assert.equal(documentRef.body.classList.contains("workspace-active"), true);
  assert.equal(runtimeState.chromeHideCount, 1);

  assert.equal(setWorkspaceChromeVisibility(false, documentRef, runtimeState), true);
  assert.equal(setWorkspaceChromeVisibility(false, documentRef, runtimeState), false);

  assert.equal(documentRef.nodes["stephanos-layout"].style.display, "grid");
  assert.equal(documentRef.nodes["dev-console"].style.display, "block");
  assert.equal(documentRef.nodes["dev-console"].closest("section").style.display, "block");
  assert.equal(documentRef.body.classList.contains("workspace-active"), false);
  assert.equal(runtimeState.chromeShowCount, 1);
});

test("applyWorkspaceIframeInteractivity forces iframe pointer events on", () => {
  const iframe = createElement({ tagName: "iframe" });

  applyWorkspaceIframeInteractivity(iframe);

  assert.deepEqual(iframe.style, {
    display: "block",
    position: "relative",
    zIndex: "1",
    pointerEvents: "auto",
    background: "#02060d",
  });
});

test("workspace launch does not recreate iframe for duplicate open requests", async () => {
  const documentRef = createDocumentFixture();
  const globals = installWorkspaceGlobals(documentRef, async (_url, options = {}) => {
    if (options.method === "HEAD") {
      return { ok: true, status: 200 };
    }

    return {
      ok: true,
      async text() {
        return "# test";
      },
    };
  });

  const emitted = [];
  const context = {
    eventBus: {
      emit(name, payload) {
        emitted.push({ name, payload });
      },
    },
  };
  const project = {
    name: "Stephanos OS",
    folder: "stephanos",
    entry: "apps/stephanos/dist/index.html",
    dependencies: [],
  };

  try {
    await workspace.open(project, context);
    await workspace.open(project, context);

    const debugState = getWorkspaceRuntimeDebugState();
    const iframeCount = documentRef.nodes["workspace-content"].children
      .flatMap((node) => node.children || [])
      .filter((node) => node.tagName === "iframe").length;

    assert.equal(debugState.mountCount, 1);
    assert.equal(debugState.iframeCreationCount, 1);
    assert.equal(debugState.repeatedLaunchCount, 1);
    assert.equal(debugState.chromeHideCount, 1);
    assert.equal(iframeCount, 1);
    assert.deepEqual(
      emitted.map((event) => event.name),
      ["workspace:opened"],
    );
  } finally {
    globals.restore();
  }
});

test("workspace open close open sequence keeps chrome transitions and iframe creation stable", async () => {
  const documentRef = createDocumentFixture();
  const globals = installWorkspaceGlobals(documentRef, async (_url, options = {}) => {
    if (options.method === "HEAD") {
      return { ok: true, status: 200 };
    }

    return {
      ok: true,
      async text() {
        return "# test";
      },
    };
  });

  const emitted = [];
  const context = {
    eventBus: {
      emit(name) {
        emitted.push(name);
      },
    },
  };
  const project = {
    name: "Stephanos OS",
    folder: "stephanos",
    entry: "apps/stephanos/dist/index.html",
    dependencies: [],
  };

  try {
    await workspace.open(project, context);
    workspace.close(context);
    await workspace.open(project, context);

    const debugState = getWorkspaceRuntimeDebugState();
    const iframeCount = documentRef.nodes["workspace-content"].children
      .flatMap((node) => node.children || [])
      .filter((node) => node.tagName === "iframe").length;

    assert.equal(debugState.mountCount, 2);
    assert.equal(debugState.closeCount, 1);
    assert.equal(debugState.iframeCreationCount, 2);
    assert.equal(debugState.chromeHideCount, 2);
    assert.equal(debugState.chromeShowCount, 1);
    assert.equal(documentRef.nodes.projects.style.display, "none");
    assert.equal(documentRef.nodes.workspace.style.display, "block");
    assert.equal(iframeCount, 1);
    assert.deepEqual(emitted, ["workspace:opened", "workspace:closed", "workspace:opened"]);
  } finally {
    globals.restore();
  }
});
