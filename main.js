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




{

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

    // show version on boot screen
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

    renderProjectRegistry(projects);

    const status = document.getElementById("system-status-text");

    if (status) {
        status.textContent = "Stephanos OS Online";
    }

    log("System ready");

    // hide boot screen
    const boot = document.getElementById("boot-screen");

    if (boot) {

        setTimeout(() => {

            boot.style.display = "none";

        }, 1200);

    }

}
window.onload = function() {

    startStephanos();

    const boot = document.getElementById("boot-screen");

    if (boot) {

        setTimeout(() => {

            boot.style.display = "none";

        }, 1000);

    }

};