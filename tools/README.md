# tools/

Build-time helpers for the まちがいさがし PWA.

## merge-scenes.js
Merges every `data/scenes-<category>.json` (animals, vehicles, nature, food,
household, school, park, seasonal) into a single `data/scenes.json`.

```
node tools/merge-scenes.js
```

Re-run any time you add a new category file or edit an existing one.

## gen-modeA.js / gen-modeB.js
Deterministic generators that produce 100 problems each from `data/scenes.json`.

```
node tools/gen-modeA.js   # writes data/modeA-problems.json
node tools/gen-modeB.js   # writes data/modeB-problems.json
```

- Mode A: spot 10 differences in a single scene.
- Mode B: pick the odd one out of 5 panels (1 difference).

These scripts overwrite the target file each run; use `generate-more.js` (below)
to append additional problems via Claude.

## generate-more.js
Calls the Anthropic API (model `claude-opus-4-7`) to generate N additional
problems and appends them to the matching problem file.

```
ANTHROPIC_API_KEY=sk-... node tools/generate-more.js --mode A --count 30
ANTHROPIC_API_KEY=sk-... node tools/generate-more.js --mode B --count 30
```

Requirements:
- Node 20+ (uses built-in `fetch`).
- `ANTHROPIC_API_KEY` in the environment.

What it does:
1. Reads `data/scenes.json` and the existing Mode A/B problems file.
2. Sends Claude a structural skeleton of every scene (id + element ids/labels/bboxes)
   plus formatting rules.
3. Parses the JSON response, validates that every problem references a real
   scene id, real element ids, a known transform, and a 4-tuple hitbox.
4. Appends to `data/modeA-problems.json` or `data/modeB-problems.json`,
   continuing the `A###` / `B###` numbering from the existing tail.

If validation fails, the file is left untouched.

## icons/
Source vector lives in `icons/icon-source.svg`. PNG raster versions are
produced with `sharp-cli`:

```
cd icons
npx -y sharp-cli@latest -i icon-source.svg -o icon-512.png resize 512 512
npx -y sharp-cli@latest -i icon-source.svg -o icon-192.png resize 192 192
```
