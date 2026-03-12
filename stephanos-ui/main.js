import { moduleLoader } from "./system/module_loader.js";

function renderProjectRegistry() {

    const projects = [
        "Galaxians",
        "Wealth App",
        "Stephan OS"
    ];

    const container = document.getElementById("project-registry");

    if (!container) {
        console.error("Project registry container missing");
        return;
    }

    container.innerHTML = "";

    projects.forEach(project => {

        const item = document.createElement("div");
        item.className = "project-item";
        item.textContent = project;

        container.appendChild(item);

    });

}

async function startStephanos() {

    console.log("Stephan OS starting...");

    try {

        await moduleLoader.loadModules();
        console.log("Modules loaded");

    } catch (err) {

        console.warn("Module system not ready yet", err);

    }

    // ALWAYS render projects even if modules fail
    renderProjectRegistry();

    const status = document.getElementById("system-status-text");

    if (status) {
        status.textContent = "Stephan OS Online";
    }

}

startStephanos();