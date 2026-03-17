const VALID_PACKAGING_MODES = new Set(["classic-static", "vite", "document"]);

export function normalizePackagingMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "classic") {
    return "classic-static";
  }
  return mode;
}

export function resolvePackagingMode({ manifest = {}, app = {} } = {}) {
  const declared = normalizePackagingMode(
    manifest?.packaging || manifest?.appType || app?.packaging || app?.appType
  );

  if (declared) {
    return declared;
  }

  const entry = String(manifest?.entry || app?.entry || "").toLowerCase();

  if (entry.endsWith(".md") || entry.endsWith(".markdown")) {
    return "document";
  }

  return "classic-static";
}

export function validateEntryForPackaging({ packaging, entry }) {
  const normalizedPackaging = normalizePackagingMode(packaging);
  const normalizedEntry = String(entry || "").trim();

  if (!normalizedEntry) {
    return {
      ok: false,
      code: "missing-entry",
      message: "Entry file is not defined"
    };
  }

  if (!VALID_PACKAGING_MODES.has(normalizedPackaging)) {
    return {
      ok: false,
      code: "unsupported-packaging",
      message: `Unsupported packaging mode: ${normalizedPackaging || "unknown"}`
    };
  }

  if (normalizedPackaging === "document") {
    const lower = normalizedEntry.toLowerCase();
    const isDocumentEntry =
      lower.endsWith(".md") ||
      lower.endsWith(".markdown") ||
      lower.endsWith(".html") ||
      lower.endsWith(".htm") ||
      lower.includes("/docs/");

    if (!isDocumentEntry) {
      return {
        ok: false,
        code: "invalid-document-entry",
        message: `Document packaging expects a markdown/html/docs entry: ${normalizedEntry}`
      };
    }
  }

  return {
    ok: true,
    packaging: normalizedPackaging,
    entry: normalizedEntry
  };
}

export function isSupportedPackagingMode(value) {
  return VALID_PACKAGING_MODES.has(normalizePackagingMode(value));
}
