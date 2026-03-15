const PANEL_ID = "knowledge-graph-panel";
const DEVELOPER_MODE_EVENT = "stephanos:developer-mode-changed";

const graph = {
  nodes: [],
  edges: []
};

export const moduleDefinition = {
  id: "knowledge-graph",
  version: "1.0",
  description: "System knowledge graph for Stephanos."
};

let panel = null;
let moduleLoadedUnsubscribe = null;
let originalRegisterService = null;
let developerModeListener = null;

const graphService = {
  addNode(type, id) {
    if (!type || !id) {
      return null;
    }

    const existingNode = graph.nodes.find((node) => node.type === type && node.id === id);
    if (existingNode) {
      return existingNode;
    }

    const node = { type, id };
    graph.nodes.push(node);
    renderGraphPanel();
    return node;
  },

  addEdge(from, to, relation) {
    if (!from || !to || !relation) {
      return null;
    }

    const edgeExists = graph.edges.some(
      (edge) => edge.from === from && edge.to === to && edge.relation === relation
    );

    if (edgeExists) {
      return null;
    }

    const edge = { from, to, relation };
    graph.edges.push(edge);
    renderGraphPanel();
    return edge;
  },

  getNodes() {
    return [...graph.nodes];
  },

  getEdges() {
    return [...graph.edges];
  }
};

export function init(context) {
  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  panel = ui.createPanel(PANEL_ID, "Stephanos Knowledge Graph");

  context?.services?.registerService?.("knowledgeGraph", graphService);

  graphService.addNode("system", "stephanos-os");

  registerProjectNodes(context?.projects || []);
  registerCurrentModules(context);
  wrapServiceRegistration(context);
  subscribeToModuleLoaded(context);

  renderGraphPanel();
  updatePanelVisibility(panel);
  subscribeToDeveloperModeChanges();
}

function registerProjectNodes(projects) {
  projects.forEach((project) => {
    const projectId = project?.id || project?.name;
    if (!projectId) {
      return;
    }

    graphService.addNode("project", projectId);
    graphService.addEdge(`project:${projectId}`, "system:stephanos-os", "connected-to");
  });
}

function registerCurrentModules(context) {
  const modules = context?.moduleLoader?.getLoadedModules?.() || [];

  modules.forEach((entry) => {
    const moduleId = entry?.moduleDefinition?.id;
    if (!moduleId) {
      return;
    }

    graphService.addNode("module", moduleId);
    graphService.addEdge("system:stephanos-os", `module:${moduleId}`, "connected-to");
  });
}

function wrapServiceRegistration(context) {
  if (!context?.services || originalRegisterService) {
    return;
  }

  const services = context.services;
  originalRegisterService = services.registerService.bind(services);

  services.registerService = (serviceName, instance) => {
    const registeredService = originalRegisterService(serviceName, instance);

    graphService.addNode("service", serviceName);
    graphService.addEdge("system:stephanos-os", `service:${serviceName}`, "uses");

    return registeredService;
  };

  const existingServices = services.listServices?.() || [];
  existingServices.forEach((serviceName) => {
    graphService.addNode("service", serviceName);
    graphService.addEdge("system:stephanos-os", `service:${serviceName}`, "uses");
  });
}

function subscribeToModuleLoaded(context) {
  if (!context?.eventBus?.on || moduleLoadedUnsubscribe) {
    return;
  }

  moduleLoadedUnsubscribe = context.eventBus.on("module:loaded", (definition) => {
    const moduleId = definition?.id;
    if (!moduleId) {
      return;
    }

    graphService.addNode("module", moduleId);
    graphService.addEdge("system:stephanos-os", `module:${moduleId}`, "connected-to");
  });
}

function renderGraphPanel() {
  if (!panel) {
    return;
  }

  panel.innerHTML = "";

  panel.appendChild(createSection("Modules", "module"));
  panel.appendChild(createSection("Services", "service"));
  panel.appendChild(createSection("Projects", "project"));
}

function createSection(title, type) {
  const section = document.createElement("div");
  const heading = document.createElement("h4");
  heading.textContent = title;
  section.appendChild(heading);

  const list = document.createElement("ul");
  const nodes = graph.nodes
    .filter((node) => node.type === type)
    .sort((left, right) => left.id.localeCompare(right.id));

  if (nodes.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No entries";
    list.appendChild(item);
  } else {
    nodes.forEach((node) => {
      const item = document.createElement("li");
      item.textContent = node.id;
      list.appendChild(item);
    });
  }

  section.appendChild(list);
  return section;
}

function updatePanelVisibility(knowledgeGraphPanel = document.getElementById(PANEL_ID)) {
  if (!knowledgeGraphPanel) {
    return;
  }

  const developerModeEnabled = window.isDeveloperModeEnabled?.() ?? false;
  knowledgeGraphPanel.style.display = developerModeEnabled ? "block" : "none";
}

function subscribeToDeveloperModeChanges() {
  if (developerModeListener) {
    return;
  }

  developerModeListener = () => {
    updatePanelVisibility();
  };

  window.addEventListener(DEVELOPER_MODE_EVENT, developerModeListener);
}

function unsubscribeFromDeveloperModeChanges() {
  if (!developerModeListener) {
    return;
  }

  window.removeEventListener(DEVELOPER_MODE_EVENT, developerModeListener);
  developerModeListener = null;
}

export function dispose(context) {
  unsubscribeFromDeveloperModeChanges();

  if (moduleLoadedUnsubscribe) {
    moduleLoadedUnsubscribe();
    moduleLoadedUnsubscribe = null;
  }

  if (context?.services && originalRegisterService) {
    context.services.registerService = originalRegisterService;
    originalRegisterService = null;
  }

  context?.services?.unregisterService?.("knowledgeGraph");

  const ui = context?.services?.getService?.("ui");
  if (ui) {
    ui.removePanel(PANEL_ID);
  }

  panel = null;
  graph.nodes.length = 0;
  graph.edges.length = 0;
}
