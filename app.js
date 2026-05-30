/* まちがいさがし - main game logic */
/* All visible UI text is hiragana only. Comments are dev-only. */

// ============================================================
// STATE
// ============================================================
const state = {
  scenes: {},
  modeA: { problems: [], index: 0, completed: new Set(), found: new Set(), misses: 0, hintShown: false },
  modeB: { problems: [], index: 0, completed: new Set(), misses: 0 },
  current: null, // { mode: 'A'|'B', problem, svgLeft, svgRight }
  sessionStartTs: 0,
  parentGateActive: false,
};

const STORAGE_KEY = 'mchg.progress.v1';
const REGEN_ENDPOINT_KEY = 'mchg.regen.endpoint.v1';
const REGEN_APIKEY_KEY = 'mchg.regen.apikey.v1';
const SESSION_LIMIT_MS = 12 * 60 * 1000;
const HIT_TOLERANCE = 40; // SVG user units
const FOUND_CIRCLE_RADIUS = 40;
const AUTO_HINT_AFTER_MISSES = 2;

// ============================================================
// AUDIO
// ============================================================
let audioCtx = null;
function unlockAudio() {
  if (audioCtx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    // iOS unlock: play silent buffer on first pointerdown
    const buf = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start(0);
  } catch (e) {
    // audio is optional
  }
}

function playTone(freq, durMs, type = 'sine', gain = 0.15) {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durMs / 1000);
    osc.stop(audioCtx.currentTime + durMs / 1000);
  } catch (e) {}
}

function sfxFound() {
  playTone(880, 120, 'sine', 0.18);
  setTimeout(() => playTone(1320, 160, 'sine', 0.18), 110);
}
function sfxMiss() {
  playTone(220, 180, 'triangle', 0.10);
}
function sfxClear() {
  playTone(660, 120, 'sine', 0.2);
  setTimeout(() => playTone(880, 120, 'sine', 0.2), 100);
  setTimeout(() => playTone(1320, 200, 'sine', 0.22), 220);
}
// Extended celebration fanfare: 660 → 880 → 1320 → 1760, plus a short
// "cracker" burst (4 quick clicks) so the final-screen reward feels bigger
// than a single completion. Used by playCelebrationScreen().
function sfxCelebrate() {
  playTone(660, 160, 'sine', 0.22);
  setTimeout(() => playTone(880, 160, 'sine', 0.22), 140);
  setTimeout(() => playTone(1320, 200, 'sine', 0.24), 300);
  setTimeout(() => playTone(1760, 360, 'sine', 0.26), 480);
  // 4-beat cracker burst (~half a bar) on top
  const beats = [820, 940, 820, 940];
  beats.forEach((f, i) => {
    setTimeout(() => playTone(f, 60, 'square', 0.10), 900 + i * 110);
  });
}

// ============================================================
// DATA NORMALIZATION
// Generators emit a simpler schema (differences[].transform / oddIndex+difference).
// Renderer expects diffs[].transformation / cells[].transformations. Convert here.
// ============================================================
function dataTransformToApp(d) {
  const bbox = d.hitbox || [0, 0, 400, 400];
  const cx = bbox[0] + bbox[2] / 2;
  const cy = bbox[1] + bbox[3] / 2;
  const t = d.transform;
  const p = d.params || {};
  switch (t) {
    case 'hide':
      return { kind: 'remove', regionId: d.elementId };
    case 'recolor':
      return { kind: 'recolor', regionId: d.elementId, payload: { fill: p.fill || '#FF6B6B' } };
    case 'scale':
      return { kind: 'scale', regionId: d.elementId, payload: { sx: p.factor || 1.3, sy: p.factor || 1.3, cx, cy } };
    case 'translate':
      return { kind: 'translate', regionId: d.elementId, payload: { dx: p.dx || 0, dy: p.dy || 0 } };
    case 'flip':
      return { kind: 'rotate-flip', regionId: d.elementId, payload: { flipX: true, cx, cy } };
    case 'duplicate':
      return { kind: 'count-delta', regionId: d.elementId, payload: { delta: 1, dx: p.dx || 30, dy: p.dy || 0 } };
    case 'remove-detail':
      return { kind: 'count-delta', regionId: d.elementId, payload: { delta: -1 } };
    case 'add-detail': {
      const fillC = p.fill || '#FF6B6B';
      const r = p.r || 14;
      return { kind: 'add', regionId: (d.elementId || 'extra') + '_x_' + (d.id || ''), payload: { svg: `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fillC}" />` } };
    }
    case 'replace': {
      // 'replace' semantically swaps geometry, but we approximate via a
      // visible color flip. Apply the color to BOTH fill and stroke so that
      // stroke-only elements (e.g. cat-whiskers, *-mouth, slide-handle-right)
      // -- whose original fill is 'none' -- still show the change. Also bump
      // stroke-width so line-only shapes are unmistakably altered.
      const c = p.fill || '#A66DD4';
      return { kind: 'recolor', regionId: d.elementId, payload: { fill: c, stroke: c, strokeWidth: p.strokeWidth || 4 } };
    }
    case 'count-change':
      return { kind: 'count-delta', regionId: d.elementId, payload: { delta: (p.count || 2) - 1, dx: p.dx || 25, dy: p.dy || 0 } };
    default:
      return { kind: 'remove', regionId: d.elementId };
  }
}

function normalizeModeADiff(d) {
  if (!d || typeof d !== 'object') return d;
  // Already in renderer shape (has transformation or hitRect): leave as-is.
  if (d.transformation || d.hitRect) return d;
  // Legacy shape: build a renderer-shape diff from the source fields.
  return {
    id: d.id,
    hitRect: d.hitbox,
    transformation: dataTransformToApp(d),
  };
}

function normalizeModeAProblem(p) {
  if (!p) return p;
  // Build a renderer-shape diffs[] from whichever source is available,
  // normalizing each entry independently so mixed schemas are handled safely.
  const source = Array.isArray(p.diffs)
    ? p.diffs
    : (Array.isArray(p.differences) ? p.differences : null);
  if (!source) return p;
  p.diffs = source.map(normalizeModeADiff);
  return p;
}

function normalizeModeBProblem(p) {
  if (!p || p.cells) return p;
  if (typeof p.oddIndex !== 'number' || !p.difference) return p;
  const oddT = dataTransformToApp(p.difference);
  const cells = [];
  for (let i = 0; i < 5; i++) {
    cells.push({ transformations: (i === p.oddIndex) ? [oddT] : [] });
  }
  p.cells = cells;
  return p;
}

// ============================================================
// DATA LOADING
// ============================================================
async function loadData() {
  try {
    const [scenesRes, modeARes, modeBRes] = await Promise.all([
      fetch('data/scenes.json').then(r => r.json()),
      fetch('data/modeA-problems.json').then(r => r.json()),
      fetch('data/modeB-problems.json').then(r => r.json()),
    ]);
    const scenesList = scenesRes.scenes || scenesRes;
    scenesList.forEach(s => { state.scenes[s.id] = s; });
    state.modeA.problems = (modeARes.problems || modeARes).map(normalizeModeAProblem);
    state.modeB.problems = (modeBRes.problems || modeBRes).map(normalizeModeBProblem);
  } catch (e) {
    console.error('data load failed', e);
  }

  // Merge in any AI-generated problems persisted to IndexedDB
  try {
    const extra = await idbGetAll();
    extra.forEach(rec => {
      if (rec.mode === 'A') state.modeA.problems.push(normalizeModeAProblem(rec.problem));
      else if (rec.mode === 'B') state.modeB.problems.push(normalizeModeBProblem(rec.problem));
    });
  } catch (e) { /* idb optional */ }
}

// ============================================================
// SCENE → SVG RENDERING + TRANSFORMATIONS
// ============================================================
function parseSvg(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  return doc.documentElement;
}

async function fetchSceneSvg(sceneId) {
  const scene = state.scenes[sceneId];
  if (!scene) throw new Error('scene not found: ' + sceneId);
  if (scene._svgText) return scene._svgText;
  const raw = scene.svg || '';
  if (raw.trim().startsWith('<')) { scene._svgText = raw; return raw; }
  const path = raw || ('data/scenes/' + sceneId + '.svg');
  const txt = await fetch(path).then(r => r.text());
  scene._svgText = txt;
  return txt;
}

/**
 * Apply a single transformation to a cloned SVG.
 * @param {SVGElement} svg
 * @param {Object} t  { kind, regionId, payload }
 */
function applyTransformation(svg, t) {
  if (!t || !t.kind || !t.regionId) return;
  let target = null;
  if (t.kind !== 'add') {
    target = svg.querySelector('#' + cssEscape(t.regionId));
    if (!target) return;
  }

  switch (t.kind) {
    case 'remove':
      target.style.display = 'none';
      break;

    case 'add': {
      // payload: { svg: '<g>...</g>' } injected as last child of root.
      // Note: for add-detail, t.regionId is synthesized (e.g. elementId + '_x_' + d.id)
      // and intentionally does NOT exist in the source SVG, so we must NOT require
      // a pre-existing target node here.
      if (t.payload && t.payload.svg) {
        const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        wrap.innerHTML = t.payload.svg;
        wrap.setAttribute('id', t.regionId);
        svg.appendChild(wrap);
      }
      break;
    }

    case 'recolor': {
      // payload: { fill, stroke, strokeWidth }
      // Recolor only descendants matching the group's primary color, so accent
      // parts (e.g. cat-collar buckle vs band) keep their original fill/stroke.
      if (t.payload) {
        const primaryFill = target.getAttribute('fill') || target.children[0]?.getAttribute('fill');
        const primaryStroke = target.getAttribute('stroke') || target.children[0]?.getAttribute('stroke');
        if (t.payload.fill) {
          target.setAttribute('fill', t.payload.fill);
          target.querySelectorAll('[fill]').forEach(el => {
            if (!primaryFill || el.getAttribute('fill') === primaryFill) {
              el.setAttribute('fill', t.payload.fill);
            }
          });
        }
        if (t.payload.stroke) {
          target.setAttribute('stroke', t.payload.stroke);
          target.querySelectorAll('[stroke]').forEach(el => {
            if (!primaryStroke || el.getAttribute('stroke') === primaryStroke) {
              el.setAttribute('stroke', t.payload.stroke);
            }
          });
        }
        if (t.payload.strokeWidth) {
          target.setAttribute('stroke-width', t.payload.strokeWidth);
          target.querySelectorAll('[stroke]').forEach(el => {
            if (!primaryStroke || el.getAttribute('stroke') === primaryStroke) {
              el.setAttribute('stroke-width', t.payload.strokeWidth);
            }
          });
        }
      }
      break;
    }

    case 'count-delta': {
      // payload: { delta: +1 / -1, refId, dx, dy, childSelector, childIndex }
      // Removal order is explicit:
      //   - childSelector: CSS selector restricting which children may be removed
      //                    (defaults to all direct children of target).
      //   - childIndex:    'last' (default; SVG topmost — preserves prior behavior)
      //                  | 'first' (SVG bottommost, typically outline/silhouette).
      // For semantic single-child removal prefer the 'detail-toggle' op with childId.
      const delta = (t.payload && t.payload.delta) || 0;
      if (delta < 0) {
        // remove |delta| children
        let n = -delta;
        const selector = t.payload && t.payload.childSelector;
        const fromEnd = !(t.payload && t.payload.childIndex === 'first');
        const candidates = selector
          ? Array.from(target.querySelectorAll(selector))
          : Array.from(target.children);
        if (fromEnd) {
          for (let i = candidates.length - 1; i >= 0 && n > 0; i--, n--) {
            candidates[i].remove();
          }
        } else {
          for (let i = 0; i < candidates.length && n > 0; i++, n--) {
            candidates[i].remove();
          }
        }
      } else if (delta > 0) {
        // If refId is provided, clone that child of target and append to target.
        // Otherwise, clone target's first eligible child (or fall back to target
        // itself) so duplicate/count-change diffs without refId still produce a
        // visible change. When cloning the target itself, insert the clone as a
        // sibling of target rather than nesting it inside.
        const explicitRef = (t.payload && t.payload.refId)
          ? target.querySelector('#' + cssEscape(t.payload.refId))
          : null;
        const ref = explicitRef || target.firstElementChild || target;
        const appendToTarget = (ref !== target);
        for (let i = 0; i < delta && ref; i++) {
          const clone = ref.cloneNode(true);
          clone.removeAttribute('id');
          const dx = ((t.payload && t.payload.dx) || 30) * (i + 1);
          const dy = ((t.payload && t.payload.dy) || 0) * (i + 1);
          clone.setAttribute('transform',
            (clone.getAttribute('transform') || '') + ` translate(${dx} ${dy})`);
          if (appendToTarget) {
            target.appendChild(clone);
          } else if (target.parentNode) {
            target.parentNode.insertBefore(clone, target.nextSibling);
          }
        }
      }
      break;
    }

    case 'scale': {
      const sx = (t.payload && t.payload.sx) || 1;
      const sy = (t.payload && t.payload.sy) || sx;
      // Prefer the element's true geometric center over the inflated hitbox
      // center so the scaled shape pivots around the visible centroid rather
      // than appearing to translate. Fall back to the payload's hitbox-derived
      // center if getBBox is unavailable / throws (e.g. empty group).
      let cx = (t.payload && t.payload.cx) || 0;
      let cy = (t.payload && t.payload.cy) || 0;
      try {
        const box = target.getBBox();
        if (box && (box.width || box.height)) {
          cx = box.x + box.width / 2;
          cy = box.y + box.height / 2;
        }
      } catch (e) { /* fall back to payload cx/cy */ }
      const prev = target.getAttribute('transform') || '';
      target.setAttribute('transform',
        prev + ` translate(${cx} ${cy}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`);
      break;
    }

    case 'translate': {
      const dx = (t.payload && t.payload.dx) || 0;
      const dy = (t.payload && t.payload.dy) || 0;
      const prev = target.getAttribute('transform') || '';
      target.setAttribute('transform', prev + ` translate(${dx} ${dy})`);
      break;
    }

    case 'rotate-flip': {
      const deg = (t.payload && t.payload.deg) || 0;
      const flipX = !!(t.payload && t.payload.flipX);
      const flipY = !!(t.payload && t.payload.flipY);
      // Prefer the element's true geometric center for the rotate/flip pivot
      // so the result reads as a pure flip/rotation rather than a translation.
      // Fall back to the payload's hitbox-derived center if getBBox throws
      // (e.g. on an empty group / detached element).
      let cx = (t.payload && t.payload.cx) || 0;
      let cy = (t.payload && t.payload.cy) || 0;
      try {
        const box = target.getBBox();
        if (box && (box.width || box.height)) {
          cx = box.x + box.width / 2;
          cy = box.y + box.height / 2;
        }
      } catch (e) { /* fall back to payload cx/cy */ }
      const prev = target.getAttribute('transform') || '';
      let extra = '';
      if (deg) extra += ` rotate(${deg} ${cx} ${cy})`;
      if (flipX || flipY) {
        const sx = flipX ? -1 : 1;
        const sy = flipY ? -1 : 1;
        extra += ` translate(${cx} ${cy}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`;
      }
      target.setAttribute('transform', prev + extra);
      break;
    }

    case 'replace': {
      // payload: { svg: '<g>...</g>' } replaces inner
      if (t.payload && t.payload.svg) {
        target.innerHTML = t.payload.svg;
      }
      break;
    }

    case 'pattern-swap': {
      // payload: { from: 'stripes', to: 'dots' } — toggle data-pattern attr
      if (t.payload) {
        target.setAttribute('data-pattern', t.payload.to || '');
        // simple visual: change stroke-dasharray
        const dash = t.payload.to === 'dots' ? '2 4'
                  : t.payload.to === 'stripes' ? '8 4'
                  : 'none';
        target.querySelectorAll('[stroke]').forEach(el => el.setAttribute('stroke-dasharray', dash));
      }
      break;
    }

    case 'detail-toggle': {
      // payload: { childId, show: true/false }
      if (t.payload && t.payload.childId) {
        const child = target.querySelector('#' + cssEscape(t.payload.childId));
        if (child) child.style.display = t.payload.show === false ? 'none' : '';
      }
      break;
    }

    default:
      break;
  }
}

function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

function applyAllTransformations(svg, transformations) {
  (transformations || []).forEach(t => applyTransformation(svg, t));
}

async function renderScene(sceneId, transformations) {
  const txt = await fetchSceneSvg(sceneId);
  const svg = parseSvg(txt);
  // Make sure svg is sized fluidly
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  applyAllTransformations(svg, transformations);
  return svg;
}

// ============================================================
// COORD CONVERSION + HIT TEST
// ============================================================
function getSvgPoint(svgEl, clientX, clientY) {
  if (!svgEl) return null;
  try {
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgEl.getScreenCTM();
    if (ctm) {
      return pt.matrixTransform(ctm.inverse());
    }
  } catch (e) {
    // fall through to manual fallback
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[getSvgPoint] createSVGPoint/CTM failed:', e);
    }
  }

  // Last-resort fallback: synthesize a CTM from the bounding rect + viewBox.
  // This handles rare cases where getScreenCTM() returns null (e.g. element
  // briefly detached, transient layout state). Never silently fall back to
  // raw client coords — those are meaningless against viewBox-space hitboxes.
  try {
    const rect = svgEl.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[getSvgPoint] null CTM and zero-size rect — skipping hit detection');
      }
      return null;
    }
    const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
    const vbX = vb && vb.width > 0 ? vb.x : 0;
    const vbY = vb && vb.height > 0 ? vb.y : 0;
    const vbW = vb && vb.width > 0 ? vb.width : rect.width;
    const vbH = vb && vb.height > 0 ? vb.height : rect.height;
    // preserveAspectRatio xMidYMid meet: scale to fit while preserving aspect,
    // then center within the rect.
    const scale = Math.min(rect.width / vbW, rect.height / vbH);
    const drawnW = vbW * scale;
    const drawnH = vbH * scale;
    const offsetX = (rect.width - drawnW) / 2;
    const offsetY = (rect.height - drawnH) / 2;
    const localX = clientX - rect.left - offsetX;
    const localY = clientY - rect.top - offsetY;
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[getSvgPoint] null CTM — using bounding-rect fallback');
    }
    return { x: vbX + localX / scale, y: vbY + localY / scale };
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[getSvgPoint] fallback failed:', e);
    }
    return null;
  }
}

function pointInBox(x, y, box, tol) {
  if (!box) return false;
  const [bx, by, bw, bh] = box;
  const t = tol == null ? HIT_TOLERANCE : tol;
  return x >= bx - t && x <= bx + bw + t && y >= by - t && y <= by + bh + t;
}

function boxCenter(box) {
  const [bx, by, bw, bh] = box;
  return { x: bx + bw / 2, y: by + bh / 2 };
}

/**
 * Compute a viewport-adaptive hit tolerance in SVG user units.
 * Targets ~28-56 CSS px of physical tolerance (kid-finger pad ~22-25 px)
 * regardless of whether we render on a phone or tablet, then converts back
 * into SVG user units against the current viewBox scale.
 * Falls back to HIT_TOLERANCE if the element has no measurable size yet.
 */
function computeHitTolerance(svgEl) {
  if (!svgEl) return HIT_TOLERANCE;
  const rect = svgEl.getBoundingClientRect();
  const visibleSidePx = rect.width;
  if (!visibleSidePx) return HIT_TOLERANCE;
  const tolPx = Math.max(28, Math.min(56, visibleSidePx * 0.10));
  return tolPx * (400 / visibleSidePx); // back into user units
}

/**
 * Clamp the tolerance against a given hitRect so a tiny rect doesn't end up
 * with more padding than its own half-size (which would balloon the effective
 * hit zone and cause overlap with neighboring diffs).
 */
function clampTolToRect(tol, hitRect) {
  if (!hitRect || hitRect.length !== 4) return tol;
  const bw = hitRect[2];
  const bh = hitRect[3];
  return Math.min(tol, Math.max(20, bw * 0.5, bh * 0.5));
}

// ============================================================
// MODE A — SIDE-BY-SIDE 10 DIFFERENCES
// ============================================================
async function startModeA(i) {
  const idx = Math.max(0, Math.min(i, state.modeA.problems.length - 1));
  state.modeA.index = idx;
  state.modeA.found = new Set();
  state.modeA.misses = 0;
  state.modeA.hintShown = false;
  const problem = state.modeA.problems[idx];
  if (!problem) { showScreen('home'); return; }

  // Left panel: scene base (no diffs) | Right panel: scene + diff transformations
  // Convention: problem.baseTransformations applied to both; problem.diffs[].transformation applied to right only
  const svgLeft = await renderScene(problem.sceneId, problem.baseTransformations || []);
  const rightTransforms = (problem.baseTransformations || []).concat(
    (problem.diffs || []).map(d => d.transformation).filter(Boolean)
  );
  const svgRight = await renderScene(problem.sceneId, rightTransforms);

  const leftHost = document.getElementById('svg-a-left');
  const rightHost = document.getElementById('svg-a-right');
  // Move rendered svg's children + viewBox into the pre-declared host svg
  // (mirrors Mode B's approach in startModeB). This avoids nested <svg> and
  // keeps the outer host's viewBox in sync with the rendered scene, so
  // getScreenCTM().inverse() resolves against a single coherent viewport.
  if (leftHost) {
    const vb = svgLeft.getAttribute('viewBox');
    if (vb) leftHost.setAttribute('viewBox', vb);
    leftHost.innerHTML = '';
    Array.from(svgLeft.childNodes).forEach(node => leftHost.appendChild(node));
  }
  if (rightHost) {
    const vb = svgRight.getAttribute('viewBox');
    if (vb) rightHost.setAttribute('viewBox', vb);
    rightHost.innerHTML = '';
    Array.from(svgRight.childNodes).forEach(node => rightHost.appendChild(node));
  }

  // Store host svg references (not the discarded rendered wrappers) so later
  // mutations (drawFoundCircle, showMissPing, showHint) and tap hit-tests
  // operate on the live host nodes.
  state.current = { mode: 'A', problem, svgLeft: leftHost, svgRight: rightHost };

  // Hook taps on both panels
  hookPanelTaps(leftHost);
  hookPanelTaps(rightHost);

  // Update header counters (HTML provides 'progress-a' and 'found-a')
  const total = (problem.diffs || []).length;
  const progressEl = document.getElementById('progress-a');
  const foundEl = document.getElementById('found-a');
  if (progressEl) progressEl.textContent = 'もんだい ' + (idx + 1) + ' / ' + state.modeA.problems.length;
  if (foundEl) {
    foundEl.dataset.total = String(total);
    foundEl.textContent = 'みつけた 0 / ' + total;
  }

  setMascotFace('happy');
  setBubble('みつけてね');
  showScreen('problem-a');
}

function hookPanelTaps(svg) {
  if (!svg) return;
  // Ensure taps near the SVG edge don't initiate scroll/zoom before pointerdown
  // runs, and re-enable pointer-events since CSS sets svg { pointer-events: none }.
  svg.style.touchAction = 'manipulation';
  svg.style.pointerEvents = 'auto';
  // Use pointerdown to dodge 300ms click delay.
  // NOTE: `svg` must remain the same DOM node across the lifetime of this
  // listener. state.current.svgLeft/svgRight reference the same node that is
  // appended into the .image-pane host, so later mutations (drawFoundCircle,
  // showHint) operate on the live node. If a future change clones or rebuilds
  // these nodes, re-attach via the host element (e.g. getElementById('svg-left'))
  // and look up the inner svg from there to be resilient to re-renders.
  const handler = (ev) => {
    // Only react to the primary pointer; for mouse, only the left button
    // (button === 0). This prevents right-click / middle-click / secondary
    // touches from firing unwanted miss feedback.
    if (!ev.isPrimary) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (ev.pointerType !== 'touch' && ev.pointerType !== 'mouse' && ev.pointerType !== 'pen') return;
    ev.preventDefault();
    // Bind the gesture to the original target for the full pointerdown→pointerup
    // duration. Without this, if a toddler-sized finger slides across the panel
    // boundary, or if drawFoundCircle/showHint mutate the SVG subtree mid-gesture
    // (appending children causes a brief re-flow window), subsequent pointer
    // events can route to a different element. Belt-and-suspenders for tap-only
    // flows; matches commercial-grade touch handling.
    try { ev.target.setPointerCapture(ev.pointerId); } catch (e) {}
    unlockAudio();
    handleModeATap(ev, svg);
  };
  const releaseHandler = (ev) => {
    try { ev.target.releasePointerCapture(ev.pointerId); } catch (e) {}
  };
  svg.addEventListener('pointerdown', handler, { passive: false });
  svg.addEventListener('pointerup', releaseHandler);
  svg.addEventListener('pointercancel', releaseHandler);
}

function handleModeATap(ev, svgEl) {
  const cur = state.current;
  if (!cur || cur.mode !== 'A') return;
  const problem = cur.problem;
  const diffs = problem.diffs || [];

  const p = getSvgPoint(svgEl, ev.clientX, ev.clientY);
  // If coordinate conversion failed entirely (no CTM, no usable rect), skip
  // hit detection rather than running it against meaningless coords.
  // No miss sfx — this is a diagnostic state, not a real miss.
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;

  // Viewport-adaptive tolerance: ~28-56 CSS px regardless of phone/tablet size,
  // matching a typical 5-6yo fingertip pad. Falls back to HIT_TOLERANCE if the
  // element isn't measurable yet.
  const baseTol = computeHitTolerance(svgEl);

  // Check unfound diffs — nearest-center match (handles overlapping inflated hitboxes)
  let bestIdx = -1;
  let bestDist = Infinity;
  let bestArea = Infinity;
  for (let i = 0; i < diffs.length; i++) {
    if (state.modeA.found.has(i)) continue;
    const d = diffs[i];
    // Per-rect clamp prevents tiny features from getting hit zones many times
    // their own size, which would worsen the overlap problem.
    const tol = clampTolToRect(baseTol, d.hitRect);
    if (!pointInBox(p.x, p.y, d.hitRect, tol)) continue;
    const c = boxCenter(d.hitRect);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const dd = dx * dx + dy * dy;
    const area = d.hitRect[2] * d.hitRect[3];
    if (dd < bestDist || (dd === bestDist && area < bestArea)) {
      bestDist = dd;
      bestArea = area;
      bestIdx = i;
    }
  }
  if (bestIdx !== -1) {
    // FOUND
    state.modeA.found.add(bestIdx);
    const c = boxCenter(diffs[bestIdx].hitRect);
    drawFoundCircle(cur.svgLeft, c.x, c.y);
    drawFoundCircle(cur.svgRight, c.x, c.y);
    sfxFound();
    setMascotFace('cheer');
    setBubble('みつけたね');
    updateModeACounters();
    saveProgress();
    if (state.modeA.found.size >= diffs.length) {
      // CLEAR
      setTimeout(() => completeModeA(), 600);
    }
    return;
  }

  // MISS
  state.modeA.misses += 1;
  sfxMiss();
  setMascotFace('think');
  setBubble('おしいね');
  showMissPing(svgEl, p.x, p.y);

  if (!state.modeA.hintShown && state.modeA.misses >= AUTO_HINT_AFTER_MISSES) {
    showHint();
  }
}

function drawFoundCircle(svg, cx, cy) {
  if (!svg) return;
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('class', 'found-marker');

  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('class', 'found-circle');
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', String(FOUND_CIRCLE_RADIUS));
  c.setAttribute('fill', 'none');
  c.setAttribute('stroke', '#ff7a4d');
  c.setAttribute('stroke-width', '6');
  c.setAttribute('opacity', '0');
  g.appendChild(c);
  svg.appendChild(g);

  // animate in
  requestAnimationFrame(() => {
    c.style.transition = 'opacity 200ms ease-out, r 240ms ease-out';
    c.setAttribute('opacity', '0.95');
  });
}

function showMissPing(svg, x, y) {
  if (!svg) return;
  const ns = 'http://www.w3.org/2000/svg';
  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('cx', String(x));
  c.setAttribute('cy', String(y));
  c.setAttribute('r', '10');
  c.setAttribute('fill', '#ffd66a');
  c.setAttribute('opacity', '0.8');
  svg.appendChild(c);
  let r = 10;
  let op = 0.8;
  const step = () => {
    r += 4; op -= 0.06;
    if (op <= 0) { c.remove(); return; }
    c.setAttribute('r', String(r));
    c.setAttribute('opacity', String(op));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function showHint() {
  state.modeA.hintShown = true;
  const cur = state.current;
  if (!cur || cur.mode !== 'A') return;
  const diffs = cur.problem.diffs || [];
  // Highlight one unfound diff briefly
  for (let i = 0; i < diffs.length; i++) {
    if (state.modeA.found.has(i)) continue;
    const c = boxCenter(diffs[i].hitRect);
    const ns = 'http://www.w3.org/2000/svg';
    [cur.svgLeft, cur.svgRight].forEach(svg => {
      if (!svg) return;
      const ring = document.createElementNS(ns, 'circle');
      ring.setAttribute('cx', String(c.x));
      ring.setAttribute('cy', String(c.y));
      ring.setAttribute('r', '55');
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', '#7ed0ff');
      ring.setAttribute('stroke-width', '5');
      ring.setAttribute('stroke-dasharray', '6 6');
      ring.setAttribute('opacity', '0.85');
      svg.appendChild(ring);
      setTimeout(() => ring.remove(), 2400);
    });
    setBubble('このあたりかも');
    return;
  }
}

function updateModeACounters() {
  const foundEl = document.getElementById('found-a');
  if (foundEl) {
    const total = foundEl.dataset.total || String((state.current && state.current.problem && (state.current.problem.diffs || []).length) || 0);
    foundEl.textContent = 'みつけた ' + state.modeA.found.size + ' / ' + total;
  }
}

function completeModeA() {
  const idx = state.modeA.index;
  state.modeA.completed.add(idx);
  sfxClear();
  setMascotFace('cheer');
  setBubble('やったね');
  const stars = computeStars('A');
  saveProgress();
  updateHomeBadges();
  // If every problem in mode A is done, show the celebration screen.
  if (state.modeA.problems.length > 0
      && state.modeA.completed.size >= state.modeA.problems.length) {
    showScreen('celebration');
    return;
  }
  showResult({ mode: 'A', stars, index: idx });
}

// ============================================================
// MODE B — 5-CELL ODD-ONE-OUT
// ============================================================
async function startModeB(i) {
  const idx = Math.max(0, Math.min(i, state.modeB.problems.length - 1));
  state.modeB.index = idx;
  state.modeB.misses = 0;
  const problem = state.modeB.problems[idx];
  if (!problem) { showScreen('home'); return; }

  // problem.cells: array of 5, each { transformations: [...] }
  // problem.oddIndex: which cell is the odd one
  // Render into the pre-declared #svg-b-0..4 cells inside .images-grid
  const cells = problem.cells || [];
  for (let n = 0; n < cells.length; n++) {
    const host = document.getElementById('svg-b-' + n);
    if (!host) continue;
    const svg = await renderScene(problem.sceneId, cells[n].transformations || []);
    // Re-enable pointer-events since CSS sets svg { pointer-events: none };
    // touch-action prevents scroll/zoom from swallowing the tap on iOS.
    host.style.touchAction = 'manipulation';
    host.style.pointerEvents = 'auto';
    // Move rendered svg's children + viewBox into the pre-declared host svg
    const vb = svg.getAttribute('viewBox');
    if (vb) host.setAttribute('viewBox', vb);
    const pa = svg.getAttribute('preserveAspectRatio');
    if (pa) host.setAttribute('preserveAspectRatio', pa);
    else host.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    host.innerHTML = '';
    Array.from(svg.childNodes).forEach(node => host.appendChild(node));
    // Wire tap handler on the .image-cell wrapper; clone to drop prior listeners
    const cellWrap = host.parentElement || host;
    cellWrap.classList.remove('cell-correct', 'cell-shake');
    const fresh = cellWrap.cloneNode(true);
    cellWrap.parentNode.replaceChild(fresh, cellWrap);
    fresh.setAttribute('data-cell', String(n));
    fresh.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      unlockAudio();
      handleModeBTap(n, fresh);
    });
  }

  state.current = { mode: 'B', problem };

  const idxEl = document.getElementById('mode-b-index');
  if (idxEl) idxEl.textContent = String(idx + 1);
  const progressBEl = document.getElementById('progress-b');
  if (progressBEl) progressBEl.textContent = 'もんだい ' + (idx + 1) + ' / ' + state.modeB.problems.length;

  setMascotFace('happy');
  setBubble('ちがうの どれかな');
  showScreen('problem-b');
}

function handleModeBTap(cellIndex, cellEl) {
  const cur = state.current;
  if (!cur || cur.mode !== 'B') return;
  const problem = cur.problem;
  if (cellIndex === problem.oddIndex) {
    sfxFound();
    cellEl.classList.add('cell-correct');
    setMascotFace('cheer');
    setBubble('せいかい');
    state.modeB.completed.add(state.modeB.index);
    saveProgress();
    updateHomeBadges();
    setTimeout(() => {
      // If every problem in mode B is done, show the celebration screen.
      if (state.modeB.problems.length > 0
          && state.modeB.completed.size >= state.modeB.problems.length) {
        showScreen('celebration');
        return;
      }
      const stars = computeStars('B');
      showResult({ mode: 'B', stars, index: state.modeB.index });
    }, 600);
  } else {
    state.modeB.misses += 1;
    sfxMiss();
    cellEl.classList.add('cell-shake');
    setTimeout(() => cellEl.classList.remove('cell-shake'), 400);
    setMascotFace('think');
    setBubble('おしいね');
  }
}

// ============================================================
// STARS (1-star floor)
// ============================================================
function computeStars(mode) {
  const misses = mode === 'A' ? state.modeA.misses : state.modeB.misses;
  if (misses <= 1) return 3;
  if (misses <= 4) return 2;
  return 1; // floor
}

// ============================================================
// RESULT / NAV
// ============================================================
function showResult({ mode, stars, index }) {
  const el = document.getElementById('result');
  if (!el) { nextProblem(); return; }
  const starsEl = el.querySelector('#result-stars');
  if (starsEl) {
    starsEl.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const span = document.createElement('span');
      span.className = i < stars ? 'star star-on' : 'star star-off';
      span.textContent = '★';
      starsEl.appendChild(span);
    }
  }
  const titleEl = el.querySelector('#result-title');
  if (titleEl) titleEl.textContent = 'クリア';

  const nextBtn = el.querySelector('#btn-result-next');
  const homeBtn = el.querySelector('#btn-result-home');
  if (nextBtn) nextBtn.onclick = () => nextProblem();
  if (homeBtn) homeBtn.onclick = () => goHome();

  showScreen('result');
}

function nextProblem() {
  const cur = state.current;
  if (!cur) { showScreen('home'); return; }
  if (cur.mode === 'A') {
    const ni = (state.modeA.index + 1) % Math.max(1, state.modeA.problems.length);
    startModeA(ni);
  } else if (cur.mode === 'B') {
    const ni = (state.modeB.index + 1) % Math.max(1, state.modeB.problems.length);
    startModeB(ni);
  }
}

function goHome() {
  state.current = null;
  updateHomeBadges();
  showScreen('home');
}

function showScreen(id) {
  const aliases = {
    'mode-a': 'problem-a',
    'mode-b': 'problem-b'
  };
  const targetId = aliases[id] || id;
  const screens = document.querySelectorAll('.screen');
  screens.forEach(s => s.classList.remove('active'));
  const el = document.getElementById(targetId);
  if (el) el.classList.add('active');
  // Hook the celebration screen so confetti / sfx / mascot fire when shown.
  if (targetId === 'celebration') {
    try { playCelebrationScreen(); } catch (e) {}
  }
}

// ============================================================
// CELEBRATION (full-screen reward — confetti + sticker total + fanfare)
// ============================================================
function playCelebrationScreen() {
  // 1) Extended SFX (660 → 880 → 1320 → 1760 + cracker burst)
  try { sfxCelebrate(); } catch (e) {}

  // 2) Cumulative sticker count + board (shows total stamps earned overall)
  const total = state.modeA.completed.size + state.modeB.completed.size;
  const countEl = document.getElementById('celebration-stamp-count');
  if (countEl) countEl.textContent = String(total);

  const board = document.getElementById('celebration-sticker-board');
  if (board) {
    board.innerHTML = '';
    const max = Math.max(20, total); // grow the board if they've done more
    for (let i = 0; i < max; i++) {
      const sp = document.createElement('span');
      const earned = i < total;
      sp.className = earned ? 'sticker sticker--earned' : 'sticker';
      sp.textContent = earned ? '◎' : '○';
      // stagger the pop-in so they cascade
      if (earned) sp.style.animationDelay = (600 + i * 40) + 'ms';
      board.appendChild(sp);
    }
  }

  // 3) Spawn confetti pieces
  spawnConfetti();

  // 4) Keep mascot cheering: floating mascot does .mascot--cheer twice in a row,
  //    the on-screen celebration mascot has an infinite CSS dance loop.
  setMascotFace('cheer');
  setBubble('やったね！');
  const mascot = document.getElementById('mascot');
  if (mascot) {
    mascot.classList.remove('mascot--cheer');
    void mascot.offsetWidth; // force reflow so animation restarts
    mascot.classList.add('mascot--cheer');
    setTimeout(() => {
      mascot.classList.remove('mascot--cheer');
      void mascot.offsetWidth;
      mascot.classList.add('mascot--cheer');
    }, 850);
  }
}

function spawnConfetti() {
  const host = document.getElementById('celebration-confetti');
  if (!host) return;
  host.innerHTML = '';
  const COUNT = 60;
  const COLORS = ['#FFD93D', '#FF6B6B', '#88C57B', '#7ED0FF', '#FFB84D', '#A66DD4'];
  const SHAPES = ['', 'confetti-piece--circle', 'confetti-piece--ribbon'];
  for (let i = 0; i < COUNT; i++) {
    const piece = document.createElement('span');
    const shape = SHAPES[i % SHAPES.length];
    piece.className = 'confetti-piece' + (shape ? ' ' + shape : '');
    const left = Math.random() * 100;
    const dur = 2400 + Math.random() * 2400;
    const delay = Math.random() * 800;
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    piece.style.left = left + 'vw';
    piece.style.backgroundColor = color;
    piece.style.animationDuration = dur + 'ms';
    piece.style.animationDelay = delay + 'ms';
    host.appendChild(piece);
  }
  // Clean up after animation so DOM does not retain hundreds of nodes
  setTimeout(() => { if (host) host.innerHTML = ''; }, 6000);
}

function updateHomeBadges() {
  const aBadge = document.getElementById('home-badge-a');
  const bBadge = document.getElementById('home-badge-b');
  if (aBadge) aBadge.textContent =
    state.modeA.completed.size + ' / ' + state.modeA.problems.length;
  if (bBadge) bBadge.textContent =
    state.modeB.completed.size + ' / ' + state.modeB.problems.length;
  renderStickerCard();
}

function renderStickerCard() {
  const host = document.getElementById('sticker-card');
  if (!host) return;
  host.innerHTML = '';
  const total = state.modeA.completed.size + state.modeB.completed.size;
  const max = 20;
  for (let i = 0; i < max; i++) {
    const sp = document.createElement('span');
    sp.className = i < total ? 'sticker on' : 'sticker off';
    sp.textContent = i < total ? '◎' : '○';
    host.appendChild(sp);
  }
}

// ============================================================
// MASCOT + BUBBLE
// ============================================================
function setMascotFace(state_) {
  const el = document.getElementById('mascot');
  if (!el) return;
  el.setAttribute('data-face', state_ || 'happy');
}
function setBubble(text) {
  const el = document.getElementById('mascot-bubble');
  if (!el) return;
  el.textContent = text || '';
}

// ============================================================
// PROGRESS PERSISTENCE (localStorage)
// ============================================================
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj.modeA && Array.isArray(obj.modeA.completed)) {
      state.modeA.completed = new Set(obj.modeA.completed);
      state.modeA.index = obj.modeA.index || 0;
    }
    if (obj.modeB && Array.isArray(obj.modeB.completed)) {
      state.modeB.completed = new Set(obj.modeB.completed);
      state.modeB.index = obj.modeB.index || 0;
    }
  } catch (e) {}
}

function saveProgress() {
  try {
    const obj = {
      modeA: { completed: Array.from(state.modeA.completed), index: state.modeA.index },
      modeB: { completed: Array.from(state.modeB.completed), index: state.modeB.index },
      ts: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch (e) {}
}

// ============================================================
// SESSION TIMER (12 min nudge)
// ============================================================
function startSessionTimer() {
  state.sessionStartTs = Date.now();
  setInterval(() => {
    if (!state.sessionStartTs) return;
    if (Date.now() - state.sessionStartTs >= SESSION_LIMIT_MS) {
      state.sessionStartTs = Date.now(); // reset so we nudge again later
      showStretchNudge();
    }
  }, 30 * 1000);
}

function showStretchNudge() {
  setMascotFace('cheer');
  setBubble('すこし やすもう');
  const el = document.getElementById('stretch-nudge');
  if (el) {
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 8000);
  }
}

// ============================================================
// PARENT GATE (3-circle drag)
// ============================================================
function openParentGate(onPass) {
  const host = document.getElementById('parent-gate');
  if (!host) { onPass && onPass(); return; }
  host.classList.add('active');
  state.parentGateActive = true;

  const slots = host.querySelectorAll('.gate-slot');
  const dots = host.querySelectorAll('.gate-dot');
  let placed = 0;

  dots.forEach((dot) => {
    dot.draggable = false;
    let dragging = false;
    let offX = 0, offY = 0;
    dot.addEventListener('pointerdown', (ev) => {
      dragging = true;
      const r = dot.getBoundingClientRect();
      offX = ev.clientX - r.left;
      offY = ev.clientY - r.top;
      dot.setPointerCapture(ev.pointerId);
    });
    dot.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      dot.style.position = 'fixed';
      dot.style.left = (ev.clientX - offX) + 'px';
      dot.style.top = (ev.clientY - offY) + 'px';
    });
    dot.addEventListener('pointerup', (ev) => {
      dragging = false;
      // hit-test against slots
      const dr = dot.getBoundingClientRect();
      const dcx = dr.left + dr.width / 2;
      const dcy = dr.top + dr.height / 2;
      let landed = false;
      slots.forEach(slot => {
        if (slot.dataset.filled === '1') return;
        const sr = slot.getBoundingClientRect();
        if (dcx >= sr.left && dcx <= sr.right && dcy >= sr.top && dcy <= sr.bottom) {
          slot.dataset.filled = '1';
          slot.classList.add('filled');
          dot.style.display = 'none';
          placed += 1;
          landed = true;
        }
      });
      if (!landed) {
        // reset position
        dot.style.position = '';
        dot.style.left = '';
        dot.style.top = '';
      }
      if (placed >= slots.length) {
        host.classList.remove('active');
        state.parentGateActive = false;
        // reset for next time
        slots.forEach(s => { s.dataset.filled = ''; s.classList.remove('filled'); });
        dots.forEach(d => {
          d.style.display = '';
          d.style.position = '';
          d.style.left = '';
          d.style.top = '';
        });
        onPass && onPass();
      }
    });
    dot.addEventListener('pointercancel', (ev) => {
      if (!dragging) return;
      dragging = false;
      try { dot.releasePointerCapture(ev.pointerId); } catch (e) {}
      // restore dot position (cancelled drag never lands)
      dot.style.position = '';
      dot.style.left = '';
      dot.style.top = '';
    });
  });

  const cancel = host.querySelector('.gate-cancel');
  if (cancel) cancel.onclick = () => {
    host.classList.remove('active');
    state.parentGateActive = false;
  };
}

// ============================================================
// REGENERATION (AI top-up) — parent gated, online only
// ============================================================
function getRegenConfig() {
  return {
    endpoint: localStorage.getItem(REGEN_ENDPOINT_KEY) || '',
    apiKey: localStorage.getItem(REGEN_APIKEY_KEY) || '',
  };
}

async function handleRegen() {
  if (!navigator.onLine) {
    setBubble('インターネットに つないでね');
    return;
  }
  const cfg = getRegenConfig();
  if (!cfg.endpoint) {
    setBubble('せってい して');
    showScreen('settings');
    return;
  }
  setBubble('しんもんを つくってるよ');
  setMascotFace('think');

  try {
    const reqBody = {
      mode: 'topup',
      countA: 30,
      countB: 30,
      sceneIds: Object.keys(state.scenes),
    };

    const headers = { 'Content-Type': 'application/json' };
    // Optional Anthropic direct mode
    if (cfg.endpoint.includes('anthropic.com')) {
      headers['x-api-key'] = cfg.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (cfg.apiKey) {
      headers['Authorization'] = 'Bearer ' + cfg.apiKey;
    }

    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();

    const newA = Array.isArray(data.problemsA) ? data.problemsA : [];
    const newB = Array.isArray(data.problemsB) ? data.problemsB : [];

    // Validate + persist
    let addedA = 0, addedB = 0;
    for (const p of newA) {
      if (validateProblemA(p)) {
        state.modeA.problems.push(p);
        await idbPut({ mode: 'A', id: p.id || ('a-ai-' + Date.now() + '-' + addedA), problem: p });
        addedA++;
      }
    }
    for (const p of newB) {
      if (validateProblemB(p)) {
        state.modeB.problems.push(p);
        await idbPut({ mode: 'B', id: p.id || ('b-ai-' + Date.now() + '-' + addedB), problem: p });
        addedB++;
      }
    }

    setBubble('できたよ');
    setMascotFace('cheer');
    updateHomeBadges();
  } catch (e) {
    console.error('regen failed', e);
    setBubble('もういちど ためしてね');
    setMascotFace('think');
  }
}

function validateProblemA(p) {
  if (!p || typeof p !== 'object') return false;
  if (!p.sceneId || !state.scenes[p.sceneId]) return false;
  // Accept both schemas: normalize at the validation boundary so callers can
  // pass legacy `differences[]`, renderer-shape `diffs[]`, or a mix of both.
  normalizeModeAProblem(p);
  if (!Array.isArray(p.diffs) || p.diffs.length === 0) return false;
  for (const d of p.diffs) {
    if (!d || !d.transformation || !d.transformation.kind || !d.transformation.regionId) return false;
    if (!Array.isArray(d.hitRect) || d.hitRect.length !== 4) return false;
  }
  return true;
}

function validateProblemB(p) {
  if (!p || typeof p !== 'object') return false;
  if (!p.sceneId || !state.scenes[p.sceneId]) return false;
  if (!Array.isArray(p.cells) || p.cells.length !== 5) return false;
  if (typeof p.oddIndex !== 'number' || p.oddIndex < 0 || p.oddIndex > 4) return false;
  return true;
}

// ============================================================
// INDEXEDDB (AI-generated problems persistence)
// ============================================================
const IDB_NAME = 'mchg-db';
const IDB_STORE = 'ai-problems';

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('no idb')); return; }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(rec) {
  try {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { /* ignore */ }
}

async function idbGetAll() {
  try {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) { return []; }
}

// ============================================================
// EVENT HOOKS
// ============================================================
function hookEventListeners() {
  const byId = (id) => document.getElementById(id);

  const btnA = byId('btn-mode-a');
  if (btnA) btnA.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); unlockAudio();
    // Resume from last incomplete index if possible
    let i = state.modeA.index;
    if (state.modeA.completed.has(i)) {
      for (let n = 0; n < state.modeA.problems.length; n++) {
        if (!state.modeA.completed.has(n)) { i = n; break; }
      }
    }
    startModeA(i);
  });

  const btnB = byId('btn-mode-b');
  if (btnB) btnB.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); unlockAudio();
    let i = state.modeB.index;
    if (state.modeB.completed.has(i)) {
      for (let n = 0; n < state.modeB.problems.length; n++) {
        if (!state.modeB.completed.has(n)) { i = n; break; }
      }
    }
    startModeB(i);
  });

  document.querySelectorAll('.btn-back, .back-button, [data-target]').forEach(btn => {
    btn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const target = btn.getAttribute('data-target');
      if (target === 'home' || !target) {
        goHome();
      } else {
        showScreen(target);
      }
    });
  });

  const btnRegen = byId('btn-regen');
  if (btnRegen) btnRegen.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    openParentGate(() => handleRegen());
  });

  const btnSettings = byId('btn-settings');
  if (btnSettings) btnSettings.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    openParentGate(() => showScreen('settings'));
  });

  const btnSaveSettings = byId('btn-save-settings');
  if (btnSaveSettings) btnSaveSettings.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    const ep = byId('input-endpoint');
    const ak = byId('input-apikey');
    if (ep) localStorage.setItem(REGEN_ENDPOINT_KEY, ep.value || '');
    if (ak) localStorage.setItem(REGEN_APIKEY_KEY, ak.value || '');
    setBubble('ほぞん したよ');
    goHome();
  });

  const btnReset = byId('btn-reset-progress');
  if (btnReset) btnReset.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    openParentGate(() => {
      state.modeA.completed = new Set();
      state.modeB.completed = new Set();
      state.modeA.index = 0;
      state.modeB.index = 0;
      saveProgress();
      updateHomeBadges();
      setBubble('リセット したよ');
    });
  });

  // Disable native gestures we don't want
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('contextmenu', e => e.preventDefault());

  // First pointerdown anywhere unlocks audio
  document.addEventListener('pointerdown', unlockAudio, { once: false });
}

// ============================================================
// SERVICE WORKER REGISTRATION
// ============================================================
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => {
        // Listen for a new SW being installed in the background
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            // When the new SW is installed AND there's an existing controller,
            // a fresh version is waiting to take over.
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Prompt the user to reload to activate the new version.
              // Stay silent during the child's session: sw.js already calls
              // skipWaiting() + clients.claim(), so the new version takes
              // effect on the NEXT cold start. window.confirm() would render
              // OS-default OK/Cancel buttons in the parent device language
              // (often English) and break the hiragana-only UX.
            }
          });
        });
      })
      .catch(() => {});
  });
}

// ============================================================
// BOOT
// ============================================================
window.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  loadProgress();
  hookEventListeners();
  updateHomeBadges();

  // Pre-fill settings inputs from storage
  const ep = document.getElementById('input-endpoint');
  const ak = document.getElementById('input-apikey');
  const cfg = getRegenConfig();
  if (ep) ep.value = cfg.endpoint;
  if (ak) ak.value = cfg.apiKey;

  showScreen('home');
  setMascotFace('happy');
  setBubble('あそぼう');
  startSessionTimer();
  registerSW();
});
