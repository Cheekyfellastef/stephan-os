const systemStatus = document.getElementById("system-status");
const projectList = document.getElementById("project-list");
const consoleOutput = document.getElementById("console-output");
const devConsole = document.getElementById("dev-console");

systemStatus.innerText = "Stephan OS Online";

function log(msg){

consoleOutput.innerText += msg + "\n";

}

log("System booting...");
log("Loading modules...");

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

log("Projects loaded");

// clock

function updateClock(){

const clock = document.getElementById("clock");

const now = new Date();

clock.innerText =
now.toLocaleTimeString();

}

setInterval(updateClock,1000);

updateClock();

// F1 developer console

document.addEventListener("keydown",(e)=>{

if(e.key === "F1"){

e.preventDefault();

devConsole.style.display =
devConsole.style.display === "none"
? "block"
: "none";

}

});