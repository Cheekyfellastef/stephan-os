const systemStatus = document.getElementById("system-status");
const projectList = document.getElementById("project-list");

systemStatus.innerText = "Stephan OS Online";

const projects = [

{
name: "Galaxians",
description: "Arcade game engine experiment",
url: "#"
},

{
name: "Wealth App",
description: "Retirement modelling simulator",
url: "#"
},

{
name: "Stephan OS",
description: "Human-AI collaborative thinking environment",
url: "#"
}

];

projects.forEach(project => {

const item = document.createElement("li");

const link = document.createElement("a");

link.href = project.url;

link.innerText =
project.name + " — " + project.description;

link.style.color = "turquoise";
link.style.textDecoration = "none";

item.appendChild(link);

projectList.appendChild(item);

});