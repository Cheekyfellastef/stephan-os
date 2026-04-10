const EXPERIMENTAL_EXPERIENCES = Object.freeze([
  {
    id: 'galaxians-lab',
    name: 'Galaxians Lab',
    description: 'Experimental sprite-rendering lab for Galaxians palette and animation modes.',
    launchPath: '../galaxians-lab/index.html'
  }
]);

function resolveExperienceLaunchUrl(experience, moduleUrl = import.meta.url) {
  if (!experience?.launchPath) {
    return '#';
  }

  return new URL(experience.launchPath, moduleUrl).href;
}

export { EXPERIMENTAL_EXPERIENCES, resolveExperienceLaunchUrl };
