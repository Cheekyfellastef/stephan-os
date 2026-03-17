export const appInstallerAgent = {
  id: "app-installer-agent",
  description: "Installs Stephanos apps from GitHub repositories",
  subscribeEvents: ["console:command"],

  async handleEvent(payload, context) {
    const text = String(payload?.text || "").trim();
    const normalizedText = text.toLowerCase();

    if (!normalizedText.startsWith("install ")) {
      return;
    }

    const repoUrl = text.slice("install ".length).trim();

    if (!repoUrl) {
      console.warn("Installer: missing repository URL");
      context.eventBus.emit("app:install_error", {
        repoUrl,
        message: "Missing repository URL"
      });
      return;
    }

    console.log("Installer: attempting install from", repoUrl);
    context.eventBus.emit("app:installing", {
      repoUrl
    });

    const segments = repoUrl.split("/").filter(Boolean);
    const rawName = segments.pop() || "";
    const appName = rawName.replace(".git", "");

    if (!appName) {
      context.eventBus.emit("app:install_error", {
        repoUrl,
        message: "Could not determine app name from repository URL"
      });
      return;
    }

    const entry = `apps/${appName}/index.html`;

    const newApp = {
      name: appName,
      icon: "📦",
      entry
    };

    const existingProjects = context.systemState.get("projects");
    const fallbackProjects = Array.isArray(context.projects) ? context.projects : [];
    const registry = Array.isArray(existingProjects) ? [...existingProjects] : [...fallbackProjects];

    const alreadyInstalled = registry.some((project) => String(project?.name || "").toLowerCase() === appName.toLowerCase());

    if (alreadyInstalled) {
      context.eventBus.emit("app:install_error", {
        repoUrl,
        message: `App '${appName}' is already installed`
      });
      return;
    }

    registry.push(newApp);

    context.systemState.set("projects", registry);

    context.eventBus.emit("app:installed", newApp);

    console.log("Installer: app registered", newApp);
  }
};
