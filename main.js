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

        container.appendChild(item);

    });

    log("Projects rendered");
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

    const status = document.getElementById("system-status-text");

    if (status) {
        status.textContent = "Stephan OS Online";
    }

    log("System ready");

}


startStephanos();