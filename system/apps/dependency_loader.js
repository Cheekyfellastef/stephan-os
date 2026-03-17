export async function loadDependencies(app) {
  if (!app?.dependencies || !Array.isArray(app.dependencies)) return;

  for (const dep of app.dependencies) {
    const script = document.createElement("script");
    script.src = dep;
    script.async = true;

    document.head.appendChild(script);

    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load dependency: ${dep}`));
    });
  }
}
