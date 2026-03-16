export async function discoverApps() {
  const apps = [];

  const response = await fetch("./apps/index.json");
  const folders = await response.json();

  for (const folder of folders) {
    try {
      const manifestResponse = await fetch(`./apps/${folder}/app.json`);
      const manifest = await manifestResponse.json();

      apps.push({
        name: manifest.name,
        icon: manifest.icon,
        entry: `apps/${folder}/${manifest.entry}`,
        type: manifest.type || "app"
      });
    } catch (err) {
      console.warn("Skipping app:", folder);
    }
  }

  return apps;
}
