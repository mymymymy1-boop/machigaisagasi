const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const scenes = JSON.parse(fs.readFileSync(path.join(ROOT,'data','scenes.json'),'utf-8')).scenes;
const TRANSFORMS = ['hide','recolor','scale','translate','flip','duplicate','remove-detail','add-detail','replace','count-change'];
const COLORS = ['#FF6B6B','#6BCB77','#4D96FF','#FFD93D','#A66DD4'];

function paramsFor(t, i) {
  switch(t) {
    case 'hide': return {};
    case 'recolor': return { fill: COLORS[i % COLORS.length] };
    case 'scale': return { factor: i % 2 === 0 ? 0.7 : 1.4 };
    case 'translate': return { dx: 20, dy: 0 };
    case 'flip': return {};
    case 'duplicate': return { dx: 30, dy: 0 };
    case 'remove-detail': return {};
    case 'add-detail': return { shape: 'circle', r: 12, fill: COLORS[i % COLORS.length] };
    case 'replace': return { fill: COLORS[(i+2) % COLORS.length] };
    case 'count-change': return { count: 2, dx: 25 };
  }
}

function expandBbox(b) {
  const [x,y,w,h] = b;
  const ex = Math.max(0, x - 10), ey = Math.max(0, y - 10);
  return [ex, ey, Math.min(400 - ex, Math.max(50, w + 20)), Math.min(400 - ey, Math.max(50, h + 20))];
}

const problems = [];
for (let i = 0; i < 100; i++) {
  const scene = scenes[i % scenes.length];
  const els = scene.elements;
  const differences = [];
  for (let j = 0; j < 10; j++) {
    const el = els[(i + j) % els.length];
    const t = TRANSFORMS[j];
    differences.push({
      id: 'd' + (j+1),
      elementId: el.id,
      transform: t,
      params: paramsFor(t, i),
      hitbox: expandBbox(el.bbox),
    });
  }
  problems.push({
    id: 'A' + String(i+1).padStart(3,'0'),
    sceneId: scene.id,
    title: 'まちがいを みつけよう',
    differences,
  });
}

fs.mkdirSync(path.join(ROOT,'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT,'data','modeA-problems.json'), JSON.stringify({ problems }, null, 2));
console.log('Wrote ' + problems.length + ' Mode A problems');
