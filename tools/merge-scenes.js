// Merge all category scenes-*.json files into a single scenes.json
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

const CATEGORIES = ['animals','vehicles','nature','food','household','school','park','seasonal'];

const merged = [];
const counts = {};
for (const cat of CATEGORIES) {
  const file = path.join(DATA, `scenes-${cat}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`Missing: ${file}`);
    counts[cat] = 0;
    continue;
  }
  const json = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const arr = json.scenes || [];
  counts[cat] = arr.length;
  for (const s of arr) merged.push(s);
}

fs.writeFileSync(path.join(DATA, 'scenes.json'), JSON.stringify({ scenes: merged }, null, 2));
console.log('Per-category counts:', JSON.stringify(counts));
console.log('Total scenes:', merged.length);
