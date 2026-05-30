#!/usr/bin/env node
// generate-more.js
// Generate N additional Mode A or Mode B problems via the Anthropic API and
// append them to data/modeA-problems.json or data/modeB-problems.json.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... node tools/generate-more.js --mode A --count 30
//   ANTHROPIC_API_KEY=sk-... node tools/generate-more.js --mode B --count 30
//
// Requires Node 20+ (uses built-in fetch).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const MODEL = 'claude-opus-4-7';
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

// ---------- arg parsing ----------
function parseArgs(argv) {
  const out = { mode: null, count: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') out.mode = argv[++i];
    else if (a === '--count') out.count = parseInt(argv[++i], 10);
    else if (a.startsWith('--mode=')) out.mode = a.slice(7);
    else if (a.startsWith('--count=')) out.count = parseInt(a.slice(8), 10);
  }
  return out;
}

const { mode, count } = parseArgs(process.argv.slice(2));
if (!mode || (mode !== 'A' && mode !== 'B')) {
  console.error('error: --mode A|B is required');
  process.exit(1);
}
if (!Number.isFinite(count) || count <= 0) {
  console.error('error: --count <positive integer> is required');
  process.exit(1);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('error: ANTHROPIC_API_KEY env var is required');
  process.exit(1);
}

// ---------- load existing data ----------
const scenes = JSON.parse(fs.readFileSync(path.join(DATA, 'scenes.json'), 'utf-8')).scenes;
const problemsFile = path.join(DATA, mode === 'A' ? 'modeA-problems.json' : 'modeB-problems.json');
const existing = JSON.parse(fs.readFileSync(problemsFile, 'utf-8'));
const existingProblems = existing.problems || [];

const startIndex = existingProblems.length;
const idPrefix = mode;

// Provide the model only the structural skeleton of scenes (id + element ids/labels/bboxes).
const sceneSkeleton = scenes.map(s => ({
  id: s.id,
  category: s.category,
  name: s.name,
  elements: s.elements.map(e => ({ id: e.id, label: e.label, bbox: e.bbox })),
}));

const TRANSFORMS = ['hide','recolor','scale','translate','flip','duplicate','remove-detail','add-detail','replace','count-change'];

// ---------- prompt ----------
function buildPrompt() {
  const startNum = startIndex + 1;
  const endNum = startIndex + count;
  const exampleA = {
    id: 'A101',
    sceneId: 'animals-neko',
    title: 'まちがいを みつけよう',
    differences: [
      { id: 'd1', elementId: 'cat-eye-left', transform: 'hide', params: {}, hitbox: [155, 135, 40, 40] }
    ]
  };
  const exampleB = {
    id: 'B101',
    sceneId: 'animals-neko',
    title: 'ちがう えを みつけよう',
    oddIndex: 2,
    difference: { elementId: 'cat-tail', transform: 'recolor', params: { fill: '#FF6B6B' }, hitbox: [280, 155, 75, 135] }
  };

  let instructions;
  if (mode === 'A') {
    instructions = `Generate ${count} new Mode A problems numbered ${idPrefix}${String(startNum).padStart(3,'0')} through ${idPrefix}${String(endNum).padStart(3,'0')}.

Each Mode A problem MUST have:
- "id": string like "${idPrefix}${String(startNum).padStart(3,'0')}" (zero-padded 3 digits)
- "sceneId": one of the existing scene ids
- "title": "まちがいを みつけよう"
- "differences": an array of EXACTLY 10 items, each:
  - "id": "d1" through "d10"
  - "elementId": an element id from that scene
  - "transform": one of ${JSON.stringify(TRANSFORMS)}
  - "params": object appropriate for the transform (see below)
  - "hitbox": [x, y, w, h] expanded ~10px from the element bbox

Vary scenes and transforms across the batch.

Example shape:
${JSON.stringify(exampleA, null, 2)}`;
  } else {
    instructions = `Generate ${count} new Mode B problems numbered ${idPrefix}${String(startNum).padStart(3,'0')} through ${idPrefix}${String(endNum).padStart(3,'0')}.

Each Mode B problem MUST have:
- "id": string like "${idPrefix}${String(startNum).padStart(3,'0')}" (zero-padded 3 digits)
- "sceneId": one of the existing scene ids
- "title": "ちがう えを みつけよう"
- "oddIndex": integer 0..4 (which of the 5 panels is the odd one)
- "difference": single object:
  - "elementId": an element id from that scene
  - "transform": one of ${JSON.stringify(TRANSFORMS)}
  - "params": object appropriate for the transform
  - "hitbox": [x, y, w, h] expanded ~10px from the element bbox

Example shape:
${JSON.stringify(exampleB, null, 2)}`;
  }

  const paramHints = `Transform params reference:
- hide: {}
- recolor: { fill: "#RRGGBB" }
- scale: { factor: number, e.g. 0.7 or 1.4 }
- translate: { dx: number, dy: number }
- flip: {}
- duplicate: { dx: number, dy: number }
- remove-detail: {}
- add-detail: { shape: "circle"|"rect", r?: number, w?: number, h?: number, fill: "#RRGGBB" }
- replace: { fill: "#RRGGBB" }
- count-change: { count: number, dx: number }`;

  return `${instructions}

${paramHints}

Available scenes (id, category, name, elements[id,label,bbox]):
${JSON.stringify(sceneSkeleton)}

Respond with ONLY a single JSON object of the form:
{ "problems": [ ... ] }

No prose, no markdown fences, no commentary. Just JSON.`;
}

// ---------- API call ----------
async function callAnthropic(prompt) {
  const body = {
    model: MODEL,
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const block = (data.content || []).find(c => c.type === 'text');
  if (!block) throw new Error('No text content in API response');
  return block.text;
}

// ---------- parsing & validation ----------
function extractJson(text) {
  const trimmed = text.trim();
  // strip code fences if present
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : trimmed;
  return JSON.parse(raw);
}

function validate(parsed) {
  if (!parsed || !Array.isArray(parsed.problems)) {
    throw new Error('Response missing "problems" array');
  }
  const sceneIds = new Set(scenes.map(s => s.id));
  const elementsByScene = Object.fromEntries(scenes.map(s => [s.id, new Set(s.elements.map(e => e.id))]));
  for (const p of parsed.problems) {
    if (!p || typeof p !== 'object') throw new Error('Problem is not object');
    if (typeof p.id !== 'string' || !p.id.startsWith(idPrefix)) {
      throw new Error(`Bad id (expected ${idPrefix}xxx): ${p.id}`);
    }
    if (!sceneIds.has(p.sceneId)) {
      throw new Error(`Unknown sceneId: ${p.sceneId}`);
    }
    const validEls = elementsByScene[p.sceneId];
    if (mode === 'A') {
      if (!Array.isArray(p.differences) || p.differences.length !== 10) {
        throw new Error(`Mode A problem ${p.id}: differences must have length 10`);
      }
      for (const d of p.differences) {
        if (!validEls.has(d.elementId)) throw new Error(`${p.id}: bad elementId ${d.elementId}`);
        if (!TRANSFORMS.includes(d.transform)) throw new Error(`${p.id}: bad transform ${d.transform}`);
        if (!Array.isArray(d.hitbox) || d.hitbox.length !== 4) throw new Error(`${p.id}: bad hitbox`);
      }
    } else {
      const d = p.difference;
      if (!d || !validEls.has(d.elementId)) throw new Error(`${p.id}: bad/missing difference.elementId`);
      if (!TRANSFORMS.includes(d.transform)) throw new Error(`${p.id}: bad transform ${d.transform}`);
      if (!Array.isArray(d.hitbox) || d.hitbox.length !== 4) throw new Error(`${p.id}: bad hitbox`);
      if (typeof p.oddIndex !== 'number' || p.oddIndex < 0 || p.oddIndex > 4) {
        throw new Error(`${p.id}: oddIndex must be 0..4`);
      }
    }
  }
}

// ---------- main ----------
(async () => {
  console.log(`Generating ${count} Mode ${mode} problems (ids ${idPrefix}${String(startIndex+1).padStart(3,'0')}..${idPrefix}${String(startIndex+count).padStart(3,'0')})...`);
  const prompt = buildPrompt();
  const text = await callAnthropic(prompt);
  const parsed = extractJson(text);
  validate(parsed);
  const merged = { problems: [...existingProblems, ...parsed.problems] };
  fs.writeFileSync(problemsFile, JSON.stringify(merged, null, 2));
  console.log(`Appended ${parsed.problems.length} problems. New total: ${merged.problems.length} (${path.relative(ROOT, problemsFile)})`);
})().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
