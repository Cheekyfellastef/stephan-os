# Quest icon assets

The Quest PWA requires 192x192 and 512x512 PNG icons. This repository's strict PR clean guard rejects committed image and binary artifacts, so the PNG files are generated deterministically during packaging rather than stored in source control.

Source specification:

```text
apps/spatial-bridge/icons/icon-source.json
```

Generator:

```text
node apps/spatial-bridge/tools/build-icons.mjs
```

The command creates:

```text
apps/spatial-bridge/icons/icon-192.png
apps/spatial-bridge/icons/icon-512.png
```

Use a temporary output directory for source verification without dirtying the worktree:

```text
node apps/spatial-bridge/tools/build-icons.mjs --output-dir tmp/spatial-bridge-icons
```

The generated icon is an original Stephanos bridge mark: a luminous captain core, curved bridge arcs, and two restrained status lights. Generated PNGs must remain uncommitted.
