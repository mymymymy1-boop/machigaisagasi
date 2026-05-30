# まちがいさがし — Architecture Specification

**Target:** 小学校受験 ペーパー対策 PWA / 年長 (5–6yo) / Sit Oct 2026
**Quality bar:** 市販教材 (commercial workbook) parity
**Use:** Single household, offline-first
**Mode A:** 2-panel side-by-side, find 10 differences by tap
**Mode B:** 5-image grid (4 identical + 1 different), tap the odd one
**Volume:** 100 problems per mode (200 total), AI-regenerated +30 batch when exhausted

---

## 1. Stack

| Layer | Choice | Rationale |
|---|---|---|
| Markup | Vanilla HTML5 | Zero framework tax; ships under 200 KB |
| Style | Vanilla CSS3 (custom properties, `dvh`, `env(safe-area-*)`) | Full iOS 17/18 control without build step |
| Logic | Vanilla ES2022 modules | No transpilation; loads instantly on iPad Safari |
| Art | Inline + linked SVG line-art (monochrome, optional flat pastel) | Sharp at all DPRs; tiny; manipulable via DOM |
| Audio | HTMLAudioElement + AudioContext (unlocked on first `pointerdown`) | Voice prompts + SFX work offline |
| Storage | localStorage (progress, settings) + IndexedDB (AI-generated problem cache) | Cache API holds shell; IDB holds dynamic data |
| Offline | Service Worker, cache-first precache | iOS PWA standard pattern |
| Build | None at runtime; build-step is SVGO + manifest generation only | Keep deploy artifact = static files |
| Hosting | Any static host (GitHub Pages, Cloudflare Pages, Netlify) | HTTPS required for SW |

No npm dependencies at runtime. Build-time tools (Node) are used only for SVGO pre-processing and the precache manifest hash.

---

## 2. File Structure

```
machigaisagasi/
├── index.html                  # App shell, manifest link, meta tags
├── manifest.webmanifest        # PWA manifest (see §6)
├── sw.js                       # Service Worker (cache-first)
├── precache-manifest.json      # Generated list of files + hashes
│
├── css/
│   ├── base.css                # Reset, custom props, safe-area vars
│   ├── layout.css              # App shell, panels, grids
│   ├── components.css          # Buttons, mascot, stamp card
│   └── child-mode.css          # Touch hardening (touch-action, tap-highlight)
│
├── js/
│   ├── app.js                  # Entry; routes to mode A or B
│   ├── audio.js                # AudioContext unlock + cue playback
│   ├── feedback.js             # Sparkles, mascot face state, gentle wrong-tap
│   ├── parent-gate.js          # Adult-gesture lock (3-circle drag sequence)
│   ├── progress.js             # localStorage stamps, session tracker
│   ├── regen.js                # AI top-up flow (calls user endpoint)
│   ├── render/
│   │   ├── sceneRenderer.js    # SVG load + transformation pipeline (§7)
│   │   ├── transformations.js  # 10 transform types (§5)
│   │   └── hitTest.js          # CTM-based tap → SVG point → rect test (§8)
│   └── modes/
│       ├── modeA.js            # 2-panel spot-the-difference loop
│       └── modeB.js            # 5-grid odd-one-out loop
│
├── data/
│   ├── scenes/                 # SVG scene templates (the "left" panel)
│   │   ├── animals-zoo.svg
│   │   ├── animals-farm.svg
│   │   ├── vehicles-park.svg
│   │   ├── household-kitchen.svg
│   │   ├── season-summer-fireworks.svg
│   │   ├── season-autumn-undokai.svg
│   │   ├── playground-park.svg
│   │   ├── shopping-supermarket.svg
│   │   └── ... (8 categories × ~6 scenes = ~48 source SVGs)
│   ├── problems-a.json         # 100 ProblemA records (Mode A)
│   ├── problems-b.json         # 100 ProblemB records (Mode B)
│   └── voice/                  # Hiragana voice cues (.mp3 ~16 kbps mono)
│       ├── prompt-find-10.mp3
│       ├── prompt-find-odd.mp3
│       ├── feedback-correct-*.mp3 (4 variants)
│       └── feedback-gentle-*.mp3 (4 variants — "おしいね", "もういっかい")
│
├── assets/
│   ├── icons/                  # 192, 512, maskable, apple-touch-icon
│   ├── splash/                 # ~25 iOS startup images (pwa-asset-generator)
│   ├── sfx/                    # chime, pop, sparkle
│   └── mascot/                 # Mascot face states (neutral, smile, cheer, think)
│
└── tools/
    ├── build-precache.mjs      # Node: hash + emit precache-manifest.json
    ├── svgo.config.mjs         # SVGO preset (preserve IDs, classes)
    └── verify-problems.mjs     # Node: validate problems-*.json against schemas
```

---

## 3. Data Schemas (TypeScript-like)

```ts
// All IDs are stable, kebab-case strings. Coordinates are in SVG user units
// (the scene SVG's intrinsic viewBox), not pixels.

type Hiragana = string;              // Strict hiragana + spaces only; lint at build
type SceneId   = string;             // e.g. "animals-zoo"
type CategoryId =
  | "animals" | "vehicles" | "household" | "playground"
  | "shopping" | "season-spring" | "season-summer" | "season-autumn"; // 8 cats

interface NamedRegion {
  id: string;                        // Stable ID matching an <g id="..."> in scene SVG
  label: Hiragana;                   // Voice/UI label (e.g. "うさぎ")
  bbox: { x: number; y: number; w: number; h: number };   // In SVG user units
}

interface Scene {
  id: SceneId;
  category: CategoryId;
  svgPath: string;                   // "/data/scenes/animals-zoo.svg"
  viewBox: { w: number; h: number };
  regions: NamedRegion[];            // All addressable objects (>= 10 typical)
  palette: "mono" | "pastel";        // Rendering mode
  recommendedAge: "5" | "6";
}

// ------------- Mode A: find 10 differences -------------

type TransformKind =
  | "remove"          // delete a region's <g>            (canonical type 1)
  | "add"             // inject a new <g> from sceneLib   (canonical type 2)
  | "recolor"         // swap fill attribute             (canonical type 3)
  | "count-delta"     // duplicate/remove member of group (canonical type 4)
  | "scale"           // transform: scale(k,k)           (canonical type 5)
  | "translate"       // transform: translate(dx,dy)     (canonical type 6)
  | "rotate-flip"     // transform: rotate or scale(-1,1) (canonical type 7)
  | "replace"         // swap region for another from sceneLib (canonical 8)
  | "pattern-swap"    // toggle fill pattern url(#stripes) etc (canonical 9)
  | "detail-toggle"   // hide/show a child element (whisker, button) (canonical 10)
  // Type 11 "shape change" is realized as a "replace" against shape-variant lib

interface Transformation {
  kind: TransformKind;
  targetRegionId: string;            // The <g id> being modified in scene SVG
  params: Record<string, unknown>;   // Kind-specific (see §5)
  hitRect: { x: number; y: number; w: number; h: number }; // SVG-space rect a tap must hit
  hint: Hiragana;                    // Audio hint after 2 misses
}

interface ProblemA {
  id: string;                        // "a-001" ... "a-100" (+regen "a-r-001")
  sceneId: SceneId;
  diffCount: 10;                     // Fixed for this product
  transformations: Transformation[]; // length === 10
  timeLimitSec: 120;                 // 年長 むずかしい tier
  difficulty: "futsuu" | "muzukashii";
  source: "authored" | "ai-regen";
  createdAt: string;                 // ISO
}

// ------------- Mode B: find the odd one in 5 -------------

interface ProblemB {
  id: string;                        // "b-001" ...
  sceneId: SceneId;                  // The base scene shown in 4 cells
  oddIndex: 0 | 1 | 2 | 3 | 4;       // Which of 5 cells is different
  oddTransformation: Transformation; // Single transform that makes it different
  layout: "row-5" | "grid-2x3-skip"; // Visual arrangement (iPad row / iPhone grid)
  timeLimitSec: 90;
  difficulty: "futsuu" | "muzukashii";
  source: "authored" | "ai-regen";
  createdAt: string;
}

// ------------- Progress / Session -------------

interface Stamp {
  problemId: string;
  mode: "A" | "B";
  completedAt: string;
  starsEarned: 1 | 2 | 3;            // Floor of 1; no zero stars
}

interface Progress {
  stamps: Stamp[];
  unlockedScenes: SceneId[];
  totalSessionsMin: number;
  lastSessionAt: string;
  consumedA: string[];               // Problem IDs already done
  consumedB: string[];
}
```

---

## 4. Scene Catalog (8 Categories)

Selected to cover the high-yield exam-likely set (動物 / 乗り物 / 季節行事 / 家の中 / 公園 / 食べ物 / 学校 / 仕事) while letting Mode B share the same scene library.

| # | Category ID | Japanese label | Example scenes (1–6 each) |
|---|---|---|---|
| 1 | `animals` | どうぶつ | `animals-zoo`, `animals-farm`, `animals-aquarium`, `animals-pets` |
| 2 | `vehicles` | のりもの | `vehicles-train-station`, `vehicles-airport`, `vehicles-busy-street`, `vehicles-harbor` |
| 3 | `household` | おうちのなか | `household-kitchen`, `household-livingroom`, `household-bath`, `household-bedroom` |
| 4 | `playground` | こうえん | `playground-park-spring`, `playground-sandbox`, `playground-junglegym` |
| 5 | `shopping` | おかいもの | `shopping-supermarket`, `shopping-bakery`, `shopping-vegetable-stand` |
| 6 | `season-spring` | はる | `season-spring-hanami`, `season-spring-hinamatsuri`, `season-spring-entrance` |
| 7 | `season-summer` | なつ | `season-summer-fireworks`, `season-summer-beach`, `season-summer-tanabata`, `season-summer-mushitori` |
| 8 | `season-autumn` | あき | `season-autumn-undokai`, `season-autumn-imohori`, `season-autumn-otsukimi`, `season-autumn-halloween` |

Winter / 行事 are reserved for the first AI-regen expansion.

---

## 5. The 10 Difference Transformations — SVG Rules

Each scene SVG ships with addressable `<g id="region-*">` elements and optional `<defs>` for pattern fills and shape variants. Transformations operate on a clone of the scene's DOM tree.

| Kind | Params | SVG mutation rule | Tap target rect |
|---|---|---|---|
| `remove` | `{}` | `targetEl.remove()` | bbox of removed `<g>` |
| `add` | `{ from: SceneId, regionId: string, at: {x,y} }` | Deep-clone source `<g>`, append to scene root, translate to `(x,y)` | bbox of inserted `<g>` |
| `recolor` | `{ newFill: "#xxxxxx" }` | Walk children, replace `fill` attr (skip `none`) | bbox of region |
| `count-delta` | `{ delta: +1 \| -1, memberSelector: string }` | If `+1`: clone last child matching selector, offset 20px; if `-1`: remove first match | bbox of added/removed member |
| `scale` | `{ k: number /* 0.7 or 1.3 */ }` | Wrap `<g>` content in additional `<g transform="scale(k,k)">` around region center | bbox after scale |
| `translate` | `{ dx: number, dy: number }` | Append `transform="translate(dx,dy)"` to the `<g>` | bbox shifted by (dx,dy) |
| `rotate-flip` | `{ angle?: 90\|180; flip?: "h"\|"v" }` | Append rotate/scale to `<g>`, rotating around bbox center | bbox of transformed region |
| `replace` | `{ from: SceneId, regionId: string }` | Replace `<g>` with deep-clone of source `<g>`, preserve translate | bbox of new region |
| `pattern-swap` | `{ patternId: string \| null }` | If id: set `fill="url(#patternId)"` on largest child; if null: restore original fill | bbox of region |
| `detail-toggle` | `{ detailSelector: string }` | Toggle `display:none` on matching descendant (whisker, button, tassel) | bbox of detail child |

**Build-time invariant:** every scene SVG must contain `<g id="region-*">` for every addressable object listed in its `Scene.regions[]`, and `<defs>` includes a shared library of pattern fills (`stripes`, `dots`, `check`, `plain`).

---

## 6. PWA Manifest + iOS Meta

`manifest.webmanifest`:

```json
{
  "id": "/machigaisagasi/",
  "name": "まちがいさがし",
  "short_name": "まちがい",
  "start_url": "/index.html",
  "scope": "/",
  "display": "standalone",
  "theme_color": "#fff8e7",
  "background_color": "#fff8e7",
  "lang": "ja",
  "dir": "ltr",
  "icons": [
    { "src": "/assets/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/assets/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/assets/icons/icon-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`index.html` head (iOS hardening):

```html
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="まちがいさがし">
<link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon-180.png">
<link rel="manifest" href="/manifest.webmanifest">
<!-- ~25 apple-touch-startup-image links generated by pwa-asset-generator -->
```

---

## 7. Rendering Pipeline (Scene + Transformations → Final SVG)

The renderer is pure: same inputs always produce the same DOM, so problems are deterministic and reproducible from JSON alone.

```
ProblemA / ProblemB
        │
        ▼
┌──────────────────────────────────────────────────────────┐
│ sceneRenderer.render(problem) :                          │
│                                                          │
│ 1. Fetch scene SVG text   ── cache.match(scene.svgPath)  │
│ 2. const doc = new DOMParser()                           │
│        .parseFromString(svgText, "image/svg+xml")        │
│ 3. const left = doc.documentElement.cloneNode(true)      │
│ 4. const right = doc.documentElement.cloneNode(true)     │
│ 5. for (const t of problem.transformations) {            │
│        transformations[t.kind].apply(right, t)           │
│    }                                                     │
│ 6. left.setAttribute("class",  "panel panel-left")       │
│    right.setAttribute("class", "panel panel-right")      │
│ 7. host.replaceChildren(left, right)                     │
│ 8. attachHitTest(right, problem.transformations)         │
└──────────────────────────────────────────────────────────┘
```

For Mode B, step 5 applies the single `oddTransformation` to exactly one cell; the other four are clones of the unmodified scene.

Determinism note: transformations operate by `id` lookups, never by index, so SVGO's "merge groups" optimizer must be configured to preserve `id` attributes on `region-*` groups (see `tools/svgo.config.mjs`).

---

## 8. Touch → SVG → Hit Test Pipeline

5yo tap precision is poor (fingertip pad ~10–14 mm). The hit pipeline must be forgiving but unambiguous.

```js
// js/render/hitTest.js
function attachHitTest(svgEl, transformations) {
  svgEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();                          // Prevents 300ms + double-tap-zoom
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    // getScreenCTM maps SVG-user-units → screen px; inverse() goes the other way
    const svgPoint = pt.matrixTransform(svgEl.getScreenCTM().inverse());

    // Tolerance disc: 40 SVG units, scaled with viewBox to feel like ~24 CSS px
    const TOL = 40;

    for (const t of transformations) {
      if (alreadyFound.has(t.targetRegionId)) continue;
      const r = t.hitRect;
      const within =
        svgPoint.x >= r.x - TOL &&
        svgPoint.x <= r.x + r.w + TOL &&
        svgPoint.y >= r.y - TOL &&
        svgPoint.y <= r.y + r.h + TOL;
      if (within) {
        feedback.correct(svgPoint);              // sparkle + chime + circle mark
        alreadyFound.add(t.targetRegionId);
        return;
      }
    }
    feedback.gentleWrong(svgPoint);              // soft "おしいね" + bounce
  }, { passive: false });
}
```

Why `getScreenCTM().inverse()`: every panel is independently scaled and laid out by CSS Grid, so screen coordinates do not equal SVG coordinates. The CTM (Current Transformation Matrix) gives the exact mapping including any CSS transforms. This is the W3C-standard hit-test in raw SVG without external libraries.

Marks placed on correct taps are drawn as red circles into a sibling `<g class="marks">` so they overlay the puzzle without polluting `region-*` IDs.

Wrong-tap policy (from the child UX brief):
- 1st miss: gentle bounce + "うーん？"
- 2nd miss: same + auto-hint highlight (pulse the rect of an unfound transformation)
- 3rd miss: voice cue "つぎは これだよ" → narrow the highlight to the nearest unfound region

---

## 9. Offline Strategy — Service Worker Precache

Cache-first with version-bumped purge. iOS hard ceiling is ~50 MB per origin; budget below targets ~30 MB to leave headroom.

**Precache budget:**

| Bucket | Items | Approx size |
|---|---|---|
| App shell (HTML/CSS/JS) | ~12 files | 200 KB |
| Scene SVGs (SVGO'd) | ~48 files | 2 MB |
| Mascot + UI icons | ~30 files | 300 KB |
| Splash images | 25 files | 4 MB |
| Voice prompts (.mp3 mono 16 kbps) | ~50 files | 3 MB |
| SFX | ~6 files | 200 KB |
| `problems-a.json` + `problems-b.json` | 2 files | 2 MB |
| **Total precache** | | **~12 MB** |

`tools/build-precache.mjs` walks the dist tree, hashes each file, and emits `precache-manifest.json` with `{ url, hash }` entries. The hash becomes the `CACHE_NAME` suffix so any change to any file triggers a clean install.

`sw.js` core (per iOS research):
- `install`: `cache.addAll(precacheList)`, `skipWaiting()`
- `activate`: delete caches not matching current `CACHE_NAME`, `clients.claim()`
- `fetch`: cache-first, network fallback, SPA fallback to `/index.html`
- On every app launch: `navigator.serviceWorker.getRegistration().then(r => r.update())` — Safari caches SW scripts aggressively.
- Bypass cache for `/api/regen` (online-only).

AI-generated problems are NOT in the precache; they live in IndexedDB (`db: machigai, store: regen-problems`) and are looked up by the mode loader as a union over the static `problems-*.json` arrays.

---

## 10. AI Regeneration (Online-Only Top-Up)

Trigger: when `Progress.consumedA.length >= 100` (or B) AND the user taps the "もんだいを ふやす" button inside the parent gate.

Single network operation. UX shows "おうちの ひとに おねがいしてね" → parent unlocks → spinner → 30 new problems appended.

**Endpoint flexibility (`js/regen.js`):**

Settings (parent-gated) hold:
- `endpointMode`: `"anthropic-direct"` | `"user-endpoint"`
- `apiKey`: (only used in `anthropic-direct`)
- `endpointUrl`: (only used in `user-endpoint`)
- `model`: default `claude-sonnet-4-7` (text generation only)

Request shape (mode A example):

```ts
POST <endpoint>
Body:
{
  "mode": "A",
  "count": 30,
  "availableScenes": [/* Scene[] excluding regions-only metadata */],
  "transformKinds": [/* the 10 kinds */],
  "constraints": {
    "diffCount": 10,
    "minDistanceSvgUnits": 60,   // No two transforms within 60 SVG-units of each other
    "kindMix": { "remove": [2,3], "translate": [1,2], "rotate-flip": [1,2], /* ... */ }
  }
}

Response:
{ "problems": ProblemA[] /* len 30, ids "a-r-001"..."a-r-030" */ }
```

The endpoint (user's own or anthropic-direct) is asked to emit JSON only — the rendering pipeline (§7) handles all SVG mutation, so the AI never has to write SVG. This keeps generated content safe (no code execution, no XSS surface) and makes regen results deterministic from JSON.

Validation: `tools/verify-problems.mjs` schema is also embedded in `regen.js` and run on the response before persisting. Invalid problems are dropped, never persisted.

Storage: IndexedDB `regen-problems` store, keyed by `id`. Mode loader iterates static array first, then IDB.

**Anthropic-direct mode:** uses `fetch("https://api.anthropic.com/v1/messages", { headers: { "x-api-key": ..., "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } })` with structured JSON output via prompt instructions. The dangerous-direct-browser flag is required because Safari blocks Anthropic CORS by default; doc this in parent settings.

---

## 11. Child UX Principles Applied

Distilled from the UX research and mapped to concrete app decisions:

| Principle | Application in this app |
|---|---|
| **Touch targets ≥ 75 px** | Mode B cells minimum 120×120 CSS px; Mode A tap tolerance 40 SVG units (~ 24 px) with bbox padding extending hit zone |
| **Instant feedback < 100 ms** | `pointerdown` (not `click`) bound; sparkle DOM appended within same tick |
| **Hiragana only** | All `data/voice/*.mp3` and any child-visible string lints against kanji at build (`tools/verify-problems.mjs`) |
| **No red X / no buzzer** | `feedback.gentleWrong` plays one of 4 warm "おしいね"/"もういっかい" cues; never "ブブー" |
| **Stamp / progress card** | `progress.js` renders a 10-stamp card per session in `index.html` |
| **Star floor of 1** | `Stamp.starsEarned: 1\|2\|3` — never 0; awarded by `(timeRemaining, missCount)` |
| **No accidental gestures** | `touch-action: manipulation` on root; `overscroll-behavior: none`; `position: fixed` body; no long-press menus |
| **Adult gate** | `parent-gate.js` requires 3-circle long-press sequence; gates regen, settings, history |
| **Session length 10–20 min** | Default 12 min; soft nudge at 10 min via mascot stretch animation; pause-anywhere autosaves to localStorage |
| **Mascot anchor** | Single character (どうぶつフレンド) appears on every screen with face states: neutral/smile/think/cheer |
| **Auto-hint after 2 misses** | `hitTest.js` tracks miss count per problem, escalates to highlight + voice cue |
| **Left-reference / right-target** | Mode A panels always laid out this way (the universal exam convention) |
| **Audio-only instructions** | Voice cue plays on problem load; text instruction is icon + optional hiragana label |
| **Safe area / dynamic viewport** | `100dvh`, `env(safe-area-inset-*)` on all chrome paddings |
| **No streak punishment / no ads** | Family-use app; no analytics; no telemetry; no third-party requests outside regen endpoint |

---

## 12. Build & Verify Steps

1. `node tools/svgo.config.mjs data/scenes/*.svg` — optimize SVG, preserve `region-*` IDs.
2. `node tools/verify-problems.mjs data/problems-a.json data/problems-b.json` — schema + hiragana lint + transform validity (every `targetRegionId` exists in its `sceneId`).
3. `node tools/build-precache.mjs` — emit `precache-manifest.json`, regenerate `sw.js` `CACHE_NAME`.
4. Deploy static tree to HTTPS host.
5. iOS smoke test: open in Safari → Share → Add to Home Screen → launch → airplane-mode → verify all 200 problems playable.

---

**End of architecture.**
