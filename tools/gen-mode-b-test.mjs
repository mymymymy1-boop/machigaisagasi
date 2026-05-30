// gen-mode-b-test.mjs
// Mode B 新仕様テスト: 1シーン → 5バリアント (各1ヶ所、独自の illustration-only 微差)

import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error('OPENAI_API_KEY required'); process.exit(1); }

const OUT = path.resolve('./test-images-modeb');
fs.mkdirSync(OUT, { recursive: true });

const STYLE = `Japanese children's entrance-exam picture-puzzle illustration style (難関私立小学校受験「間違い探し」). Clean black ink outlines, light pastel fills, off-white background. NO photorealism, NO 3D, NO heavy shading. ABSOLUTELY NO text, NO letters, NO kanji, NO hiragana, NO signs, NO blackboards, NO writing of any kind anywhere in the image. NO numerals. Plain illustrated objects only. Dense composition with 25+ identifiable elements. Portrait aspect 1024x1536.`;

// 5枚パターン用のリッチなシーン (文字要素なし)
const SCENE = {
  id: 'kouen-asobi',
  label: '公園で遊ぶ子供たち',
  base: `${STYLE}

SCENE: A bright afternoon at a Japanese neighborhood park. Top-down 3/4 angle, full vertical frame, no empty space.

CHARACTERS (5 children + 1 mother, all Japanese, black hair):
- 左奥: ジャングルジムの上に男の子(青いシャツ、ハーフパンツ)、両手でつかまる
- 中央: すべり台を滑る女の子(ピンクのワンピース、髪に2つの黄色いリボン)、笑顔
- 右奥: ブランコに乗る男の子(緑のTシャツ、半ズボン)、足を伸ばす
- 左手前: 砂場でしゃがむ女の子(黄色いシャツ、おさげ髪、赤いゴム)、両手にバケツとシャベル
- 右手前: 三輪車に乗る男の子(オレンジのシャツ)、ヘルメット(白)、両手でハンドル
- ベンチ: 母親(茶色のロングヘア、白いブラウス、青いロングスカート)、赤ちゃん用のベビーカー(青)を横に置く

EQUIPMENT (描き分けてしっかり):
- ジャングルジム: 緑色、格子状、4段
- すべり台: 赤、はしご段5段、滑走面が見える
- ブランコ: 鉄棒に2台吊り下げ、座面は木製、チェーン
- 砂場: 木枠で囲まれた砂、バケツ・シャベル・型抜き(星形)
- 三輪車: 赤、白いハンドル、後輪2つ

NATURE / DECOR:
- 大きな木: 中央背景に1本、緑の葉が密集、太い茶色い幹、根元に小さなキノコ2個
- もう1本の木: 右側、桜が満開(花びら散る)
- 花壇: 前景に並ぶ、赤いチューリップ5本、黄色いタンポポ4本
- 蝶: 黄色、3匹が飛ぶ
- 雲: 白い綿雲3つ
- 太陽: 黄色い丸、頬染め顔つき、上中央
- 鳥: 青い小鳥2羽、空を飛ぶ
- 犬: 茶色の柴犬1匹、リード付きで散歩中の老人(灰色の帽子、ベージュのジャケット)
- ベンチ: 木製、3つ並ぶ(画面左、中、右)、それぞれ違う向き

GROUND:
- 砂利の道
- 芝生エリア(緑)
- 小さなマンホール1個
- 落ち葉が数枚(緑3、黄2)

STRICT RULES:
- 全要素は重ねず別個に視認できる
- 各キャラクターは表情・髪型・服装で完全に区別できる
- 文字・標識・数字は一切描かない (重要)
- 線が滲まない、塗りがはみ出さない`,

  // 5バリアント各1つの illustration-only 微差 (文字なし)
  variants: [
    {
      id: 'v1',
      change: '中央の女の子(すべり台)の髪リボンを2つから1つに減らす(片方だけにする)。それ以外は完全に同じ。',
    },
    {
      id: 'v2',
      change: '左手前の女の子(砂場)が持つバケツの色を変える(青→赤)。それ以外は完全に同じ。',
    },
    {
      id: 'v3',
      change: '花壇の赤いチューリップの数を5本から4本に減らす(1本だけ消す)。それ以外は完全に同じ。',
    },
    {
      id: 'v4',
      change: '右手前の男の子(三輪車)のヘルメットの色を白から青に変える。それ以外は完全に同じ。',
    },
    {
      id: 'v5',
      change: 'もう1本の桜の木の場所を少しだけ左にずらす、または桜の花の量を少し減らす(枝が見える程度)。それ以外は完全に同じ。',
    },
  ],
};

async function genBase(scene) {
  console.log(`[base] ${scene.id} ...`);
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: scene.base,
      n: 1,
      size: '1024x1536',
      quality: 'high',
    }),
  });
  const j = await res.json();
  if (!j.data) { console.error(`  ERR base:`, JSON.stringify(j).slice(0, 800)); return null; }
  const buf = Buffer.from(j.data[0].b64_json, 'base64');
  const outPath = path.join(OUT, `${scene.id}-base.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`  [base done] ${outPath} (${(buf.length/1024).toFixed(0)}KB, ${((Date.now()-t0)/1000).toFixed(0)}s)`);
  return outPath;
}

async function genVariant(scene, basePath, variant) {
  console.log(`[variant ${variant.id}] ${variant.change.slice(0, 30)}...`);
  const t0 = Date.now();
  const baseBuf = fs.readFileSync(basePath);
  const blob = new Blob([baseBuf], { type: 'image/png' });
  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('image', blob, 'base.png');
  const editPrompt = `Take the provided image and produce a new image that is PIXEL-NEAR IDENTICAL — same composition, same line style, same color palette, same characters, same character expressions, same character positions, same background, same lighting — EXCEPT for ONE SMALL targeted change:

${variant.change}

ABSOLUTELY DO NOT add any text, letters, kanji, hiragana, numerals, or signs anywhere. ABSOLUTELY DO NOT modify anything other than the one specified change. Do NOT redraw the scene. Do NOT change the art style. Preserve every other detail with maximum fidelity.

OUTPUT: the same illustration with ONLY the one specified illustration-only micro-change applied.`;
  form.append('prompt', editPrompt);
  form.append('size', '1024x1536');
  form.append('quality', 'high');
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KEY}` },
    body: form,
  });
  const j = await res.json();
  if (!j.data) { console.error(`  ERR variant ${variant.id}:`, JSON.stringify(j).slice(0, 800)); return null; }
  const buf = Buffer.from(j.data[0].b64_json, 'base64');
  const outPath = path.join(OUT, `${scene.id}-${variant.id}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`  [variant ${variant.id} done] ${outPath} (${(buf.length/1024).toFixed(0)}KB, ${((Date.now()-t0)/1000).toFixed(0)}s)`);
  return outPath;
}

console.log('Generating base scene...');
const basePath = await genBase(SCENE);
if (!basePath) { console.error('base failed'); process.exit(1); }

console.log('\nGenerating 5 variants in parallel...');
const variantResults = await Promise.all(
  SCENE.variants.map(v => genVariant(SCENE, basePath, v).catch(e => { console.error(v.id, e.message); return null; }))
);

const result = {
  scene: SCENE.id,
  label: SCENE.label,
  base: path.basename(basePath),
  variants: SCENE.variants.map((v, i) => ({
    id: v.id,
    change: v.change,
    img: variantResults[i] ? path.basename(variantResults[i]) : null,
  })),
};
fs.writeFileSync(path.join(OUT, 'problem.json'), JSON.stringify(result, null, 2));
console.log(`\nDONE: 1 base + ${variantResults.filter(Boolean).length}/5 variants → ${OUT}`);
