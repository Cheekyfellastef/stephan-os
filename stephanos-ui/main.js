function log(message) {

    const consoleDiv = document.getElementById("dev-console");

    if (!consoleDiv) return;

    const line = document.createElement("div");
    line.textContent = message;

    consoleDiv.appendChild(line);
}

function renderProjectRegistry() {

    const projects = [
        "Galaxians",
        "Wealth App",
        "Stephanos OS"
    ];

    const container = document.getElementById("project-registry");

    if (!container) {
        log("ERROR: project-registry container not found");
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

function startStephanos() {

    log("Stephanos OS starting...");

    renderProjectRegistry();

    const status = document.getElementById("system-status-text");

    if (status) {
        status.textContent = "Stephanos OS Online";
    }

    log("System ready");
}

startStephanos();