const LAUNCHER_META_SELECTOR = 'meta[name="stephanos-launcher-shell-url"]';
const LAUNCHER_QUERY_PARAM = 'stephanosLauncherShellUrl';

function readLauncherMetaUrl(windowRef = globalThis.window) {
  const explicitUrl = String(
    windowRef?.document?.querySelector?.(LAUNCHER_META_SELECTOR)?.getAttribute('content') || ''
  ).trim();
  return explicitUrl || '';
}

function readLauncherQueryUrl(windowRef = globalThis.window) {
  try {
    const href = String(windowRef?.location?.href || '').trim();
    if (!href) {
      return '';
    }

    const parsed = new URL(href, href);
    return String(parsed.searchParams.get(LAUNCHER_QUERY_PARAM) || '').trim();
  } catch {
    return '';
  }
}

function deriveLauncherShellUrl(windowRef = globalThis.window) {
  try {
    const currentHref = String(windowRef?.location?.href || '').trim();
    const currentOrigin = String(windowRef?.location?.origin || '').trim();
    const pathname = String(windowRef?.location?.pathname || '/').trim() || '/';
    const segments = pathname.split('/').filter(Boolean);

    let launcherPath = '/';
    if (segments.length > 0) {
      const appsSegmentIndex = segments.indexOf('apps');
      if (appsSegmentIndex > 0) {
        launcherPath = `/${segments.slice(0, appsSegmentIndex).join('/')}/`;
      } else if (appsSegmentIndex < 0) {
        launcherPath = `/${segments[0]}/`;
      }
    }

    if (currentOrigin) {
      return new URL(launcherPath, `${currentOrigin}/`).href;
    }

    if (currentHref) {
      return new URL(launcherPath, currentHref).href;
    }

    return launcherPath;
  } catch {
    return '/';
  }
}

export function resolveCommandDeckDestinationPath(windowRef = globalThis.window) {
  const launcherMetaUrl = readLauncherMetaUrl(windowRef);
  if (launcherMetaUrl) {
    try {
      return new URL(launcherMetaUrl, windowRef?.location?.href || '').href;
    } catch {
      // fall through to query/path-derived launcher path
    }
  }

  const launcherQueryUrl = readLauncherQueryUrl(windowRef);
  if (launcherQueryUrl) {
    try {
      return new URL(launcherQueryUrl, windowRef?.location?.href || '').href;
    } catch {
      // fall through to path-derived launcher path
    }
  }

  return deriveLauncherShellUrl(windowRef);
}

export function withCommandDeckDestination(targetUrl, windowRef = globalThis.window) {
  const rawTarget = String(targetUrl || '').trim();
  if (!rawTarget) {
    return rawTarget;
  }

  try {
    const resolvedTarget = new URL(rawTarget, windowRef?.location?.href || undefined);
    const launcherShellHref = new URL(resolveCommandDeckDestinationPath(windowRef), windowRef?.location?.href || resolvedTarget.href).href;
    resolvedTarget.searchParams.set(LAUNCHER_QUERY_PARAM, launcherShellHref);
    return resolvedTarget.href;
  } catch {
    return rawTarget;
  }
}
