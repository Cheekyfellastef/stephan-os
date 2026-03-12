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