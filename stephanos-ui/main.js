import { moduleLoader } from "./system/module_loader.js";

function log(message) {

    const consoleDiv = document.getElementById("dev-console");

    if (consoleDiv) {
        const line = document.createElement("div");
        line.textContent = message;
        consoleDiv.appendChild(line);
    }

}

function renderProjectRegistry() {

    const projects = [
        "Galaxians",
        "Wealth App",
        "Stephan OS"
    ];

    const container = document.getElementById("project-registry");

    if (!container) {
        log("ERROR: project-registry container missing");
        return;
    }

    projects.forEach(project => {

        const item = document.createElement("div");
        item.textContent = project;
        container.appendChild(item);

    });

    log("Projects rendered");

}

async function startStephanos() {

    log("Stephan OS starting...");

    try {

        await moduleLoader.loadModules();
        log("Modules loaded");

    } catch (err) {

        log("Module loader error");
        log(err.toString());

    }

    renderProjectRegistry();

    const status = document.getElementById("system-status-text");

    if (status) {
        status.textContent = "Stephan OS Online";
    }

    log("System ready");

}

startStephanos();