import { moduleLoader } from "./system/module_loader.js";

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


const systemStatus = document.getElementById("system-status");
const projectList = document.getElementById("project-list");

systemStatus.innerText = "Stephan OS Online";

const projects = [

    {
        name: "Galaxians",
        description: "Arcade game engine experiment"
    },

    {
        name: "Wealth App",
        description: "Retirement modelling simulator"
    },

    {
        name: "Stephan OS",
        description: "Human-AI collaborative thinking environment"
    }

];

projects.forEach(project => {

    const item = document.createElement("li");

    item.innerText =
        project.name + " — " + project.description;

    projectList.appendChild(item);

});