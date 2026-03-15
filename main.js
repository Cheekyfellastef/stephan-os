function log(message) {

    const consoleDiv = document.getElementById("dev-console");

    if (!consoleDiv) return;

    const line = document.createElement("div");
    line.textContent = message;

    consoleDiv.appendChild(line);

}


function renderProjectRegistry(projects) {

    const container = document.getElementById("project-registry");

    if (!container) {
        log("ERROR: project-registry container missing");
        return;
    }

    container.innerHTML = "";

    projects.forEach(project => {

        let name;
        let icon;

        if (typeof project === "string") {

            name = project;
            icon = "🧩";

        } else {

            name = project.name;
            icon = project.icon || "🧩";

        }

        const tile = document.createElement("div");

        tile.className = "app-tile";

        tile.innerHTML = `
            <div style="font-size:36px;">${icon}</div>
            <div style="margin-top:8px;">${name}</div>
        `;

        tile.onclick = function () {
            launchProject(name);
        };

        container.appendChild(tile);

    });

    log("Project tiles rendered");

}


function launchProject(project) {

    log("Launching " + project);

    document.getElementById("projects").style.display = "none";

    const workspace = document.getElementById("workspace");

    workspace.style.display = "block";

    document.getElementById("workspace-title").textContent = project;

    const content = document.getElementById("workspace-content");

    content.innerHTML = "Workspace for " + project;

}


function returnToCommandDeck() {

    log("Returning to Command Deck");

    document.getElementById("workspace").style.display = "none";

    document.getElementById("projects").style.display = "block";

}


function openSystemPanel() {
    const panel = document.getElementById("system-panel");
    if (!panel) return;

    panel.style.display = "flex";
}


function closeSystemPanel() {
    const panel = document.getElementById("system-panel");
    if (!panel) return;

    panel.style.display = "none";
}


async function reloadStephanos() {
    if (window.__stephanosRuntime?.disposeModules) {
        await window.__stephanosRuntime.disposeModules(window.__stephanosRuntime.context);
    }

    window.location.reload();
}


function exitStephanos() {
    window.location.href = "https://google.com";
}


function toggleDevConsole() {
    const consolePanel = document.getElementById("dev-console");
    if (!consolePanel) return;

    if (consolePanel.style.display === "none") {
        consolePanel.style.display = "block";
    } else {
        consolePanel.style.display = "none";
    }
}


async function loadProjects() {

    try {

        const response = await fetch("projects_registry.json?v=0.1");

        const data = await response.json();

        return data.projects;

    } catch (error) {

        log("Failed to load project registry");

        return [];

    }

}


async function startStephanos() {

    // Show version number on boot screen
    const versionMeta = document.querySelector('meta[name="stephanos-version"]');

    if (versionMeta) {

        const version = versionMeta.getAttribute("content");

        const title = document.getElementById("boot-title");

        if (title) {
            title.textContent = "Stephanos OS v" + version;
        }

    }

    log("Stephanos OS starting...");

    const projects = await loadProjects();

    const { workspace } = await import("./system/workspace.js");
    const { loadModules, disposeModules } = await import("./system/module_loader.js");
    const { createEventBus } = await import("./system/core/event_bus.js");
    const { createSystemState } = await import("./system/core/system_state.js");
    const { createServiceRegistry } = await import("./system/core/service_registry.js");

    const eventBus = createEventBus();
    const systemState = createSystemState();
    const services = createServiceRegistry();

    const context = {
        eventBus,
        systemState,
        services,
        workspace,
        projects
    };

    await loadModules(context);

    window.__stephanosRuntime = {
        context,
        disposeModules
    };


    const status = document.getElementById("system-status-text");

    if (status) {
        status.textContent = "Stephanos OS Online";
    }

    log("System ready");

    // Hide boot screen
    const boot = document.getElementById("boot-screen");

    if (boot) {

        setTimeout(() => {

            boot.style.display = "none";

        }, 1200);

    }

}


// Start system after page loads
window.onload = function() {

    startStephanos();

};
