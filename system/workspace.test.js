import test from "node:test";
import assert from "node:assert/strict";
import {
  applyWorkspaceIframeInteractivity,
  getWorkspaceAncillaryNodes,
  setWorkspaceChromeVisibility,
} from "./workspace.js";

function createElement({ display = "", tagName = "div", closestResult = null } = {}) {
  const classes = new Set();
  return {
    tagName,
    style: { display },
    dataset: {},
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
    closest(selector) {
      if (selector === "section") {
        return closestResult;
      }
      return null;
    },
  };
}

function createDocumentFixture() {
  const layout = createElement({ display: "grid", tagName: "section" });
  const developerConsoleSection = createElement({ display: "block", tagName: "section" });
  const developerConsole = createElement({ display: "block", closestResult: developerConsoleSection });
  const body = createElement({ tagName: "body" });

  return {
    body,
    getElementById(id) {
      if (id === "stephanos-layout") return layout;
      if (id === "dev-console") return developerConsole;
      return null;
    },
    nodes: {
      layout,
      developerConsole,
      developerConsoleSection,
    },
  };
}

test("getWorkspaceAncillaryNodes finds launcher chrome nodes", () => {
  const documentRef = createDocumentFixture();
  const nodes = getWorkspaceAncillaryNodes(documentRef);

  assert.equal(nodes.stephanosLayout, documentRef.nodes.layout);
  assert.equal(nodes.developerConsole, documentRef.nodes.developerConsole);
  assert.equal(nodes.developerConsoleSection, documentRef.nodes.developerConsoleSection);
});

test("setWorkspaceChromeVisibility hides and restores launcher chrome around workspace sessions", () => {
  const documentRef = createDocumentFixture();

  setWorkspaceChromeVisibility(true, documentRef);

  assert.equal(documentRef.nodes.layout.style.display, "none");
  assert.equal(documentRef.nodes.developerConsole.style.display, "none");
  assert.equal(documentRef.nodes.developerConsoleSection.style.display, "none");
  assert.equal(documentRef.body.classList.contains("workspace-active"), true);

  setWorkspaceChromeVisibility(false, documentRef);

  assert.equal(documentRef.nodes.layout.style.display, "grid");
  assert.equal(documentRef.nodes.developerConsole.style.display, "block");
  assert.equal(documentRef.nodes.developerConsoleSection.style.display, "block");
  assert.equal(documentRef.body.classList.contains("workspace-active"), false);
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
