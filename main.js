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

        const item = document.createElement("div");

        item.textContent = project;

        item.style.cursor = "pointer";
        item.style.padding = "6px";
        item.style.borderBottom = "1px solid #ccc";

        item.onclick = function () {
            launchProject(project);
        };

        container.appendChild(item);

    });

    log("Projects rendered and clickable");

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


async function loadProjects() {

    try {

        const response = await fetch("projects_registry.json");

        const data = await response.json();

        return data.projects;

    } catch (error) {

        log("Failed to load project registry");

        return [];

    }

}


async function startStephanos() {

    log("Stephan OS starting...");

    const projects = await loadProjects();

    renderProjectRegistry(projects);

    document.getElementById("system-status-text").textContent = "Stephan OS Online";

    log("System ready");

}


startStephanos();