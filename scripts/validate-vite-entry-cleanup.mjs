import fs from "node:fs/promises";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function importFromSource(path) {
  const source = await fs.readFile(path, "utf8");
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

const entryRules = await importFromSource("system/apps/entry_rules.js");
const stephanosManifest = JSON.parse(await fs.readFile("apps/stephanos/app.json", "utf8"));

const stephanosValidation = entryRules.validateEntryForPackaging({
  packaging: stephanosManifest.packaging,
  entry: stephanosManifest.entry
});

assert(stephanosValidation.ok, "Stephanos Vite manifest entry should be valid");
assert(
  stephanosValidation.packaging === "vite",
  `Stephanos packaging should normalize to vite, received ${stephanosValidation.packaging}`
);

const documentValidation = entryRules.validateEntryForPackaging({
  packaging: "document",
  entry: "docs/readme.md"
});
assert(documentValidation.ok, "Document packaging should accept markdown entry");

const classicValidation = entryRules.validateEntryForPackaging({
  packaging: "classic-static",
  entry: "index.html"
});
assert(classicValidation.ok, "Classic-static packaging should accept manifest entry");

console.log("Entry packaging validation smoke checks passed.");
