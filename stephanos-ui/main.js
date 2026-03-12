import { moduleLoader } from "./system/module_loader.js";


<script type="module" src="./main.js"></script>


function renderProjectRegistry() {

    const projects = [
        "Galaxians",
        "Wealth App",
        "Stephan OS"
    ];

    const container = document.getElementById("project-registry");

    if (!container) return;

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

    await moduleLoader.loadModules();

    renderProjectRegistry();

    console.log("All modules initialized");
}

startStephanos();