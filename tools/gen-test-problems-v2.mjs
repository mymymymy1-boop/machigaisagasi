// gen-test-problems-v2.mjs
// 難関私立小学校受験レベルの密度・微差を狙う

import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error('OPENAI_API_KEY required'); process.exit(1); }

const OUT = path.resolve('./test-images-v2');
fs.mkdirSync(OUT, { recursive: true });

// 共通スタイル: 線画ベース、淡色、白背景、絵本/受験プリント風、超高密度
const STYLE = `Japanese children's entrance-exam picture-puzzle illustration style (難関私立小学校受験「間違い探し」). Clean black ink line drawing with light pastel color fills. Off-white or pale-yellow background. NO photorealism, NO 3D, NO heavy shading. Each individual object must be drawn with crisp closed outlines so the child can clearly count and identify it. Scene must be RICHLY DETAILED — at least 25 distinct identifiable elements visible. All characters Japanese (黒髪・標準的な日本人の子供). Composition fills the entire 2:3 vertical frame, no empty space. Aspect: portrait 1024x1536.`;

const SCENES = [
  {
    id: 'youchien-jiyu-jikan',
    label: '幼稚園の自由時間',
    base: `${STYLE}
SCENE: A Japanese kindergarten free-play room. Top-down 3/4 perspective showing the whole room.

KIDS (draw exactly 5 children, each clearly distinguishable):
- 左奥: 男の子(青いスモック)が積み木で塔を作っている — 積み木は赤・黄・青の合計7個
- 中央: 女の子(ピンクのスモック、髪に黄色いリボン1個)がクレヨンでお絵描き、クレヨン箱に12本のクレヨン
- 右奥: 男の子(緑のスモック)が絵本を読んでいる、本のタイトルは「えほん」と表紙に書く
- 左手前: 女の子(黄色のスモック、おさげ髪両側に赤いゴム)がブロック遊び、ブロックは8個
- 右手前: 男の子(オレンジのスモック)が両手にミニカーを2台持って遊ぶ

ADULTS:
- 先生: メガネをかけた女性、紺のエプロン、立って子供を見ている、エプロンに白い花柄3つ

ROOM ELEMENTS (must include all):
- 黒板: 左上、白チョークで「きょうのおはなし」と書く、時計型マグネット1つ
- 壁掛け時計: 円形、10時15分、ローマ数字
- 壁の掲示: 季節の貼り絵 (チョウチョ3匹、お花5本、太陽1個)
- 名前カード: 「あ・い・う・え・お」5枚並ぶ
- 棚: 上段に絵本15冊が立ち並ぶ、中段にぬいぐるみ(クマ・ウサギ・パンダ)、下段に画用紙の束
- 床: 木目フローリング、中央に大きな丸いラグ(緑、白の水玉模様)
- 窓: 右側、外に大きな桜の木1本(満開、花びら散る)、雲2つ
- ドア: 左、上に「ようちえん」プレート
- ゴミ箱: 1個、青色
- 鉢植え: 2つ、緑の葉
- カーテン: 黄色のチェック柄、両側に束ねる

STRICT RULES: 全要素は子供が指でさせるくらいハッキリ別々に描く。重ねるが、互いを隠さない。線がぼやけない。文字は読める大きさで。`,
    differences: [
      '中央の女の子のリボンを黄色から赤色に変える',
      '青いスモックの男の子の積み木の数を7個から6個に減らす',
      '壁の時計の長針を15分から20分に変える',
      'クレヨンの本数を12本から11本に減らす',
      '名前カードの「あ」を「お」に変える(順番がちがう)',
      '黒板の文字の「お」を「な」に変える(きょうのおはなし→きょうのなはなし)',
      '先生のエプロンの花柄を3つから4つに増やす',
      '掲示のチョウチョを3匹から2匹に減らす',
      '右手前の男の子のミニカーを左右逆向きにする',
      'ラグの水玉の色を白から黄色に変える'
    ]
  },

  {
    id: 'tanabata-kazari',
    label: '七夕の飾り',
    base: `${STYLE}
SCENE: 七夕飾り。家のリビングで、家族3人(父・母・男の子)が笹に短冊を結んでいる。

CHARACTERS:
- 父: 紺の浴衣、メガネ、両手で笹を支える
- 母: ピンクの浴衣、髪に簪、男の子の手を取って短冊を結ばせる
- 男の子(5歳): 水色の甚平、笑顔、短冊を持つ

笹(画面中央): 大きな緑の笹、葉が多数。短冊が合計8枚結びつけられている — 色の内訳: 赤2枚、青2枚、黄色2枚、ピンク1枚、緑1枚。それぞれに小さく文字を書く(「ねがいごと」風)。
笹の飾り: 折り紙の星3個(金・銀・赤)、ちょうちん2個、網飾り(ピンク)1個、輪つなぎ(7色)1本。

BACKGROUND ROOM ELEMENTS:
- 畳の床(目が描かれる)
- 障子(右側、格子模様)
- 壁掛け: 「たなばた」と書かれた書道作品1枚
- 飾り棚: 招き猫(白)、コケシ2体、湯呑1個
- ちゃぶ台: 中央左、その上にお団子の皿(団子6個)、お茶2杯
- 天井: 提灯1個(赤)
- 窓の外: 夜空、星7個、三日月1個

STRICT RULES: 各短冊は別々に描き、結び目が見える。星は5角形、それぞれ大きさを少し変える。`,
    differences: [
      '青い短冊の数を2枚から1枚に減らす',
      '父のメガネを丸メガネから四角メガネに変える',
      'お団子の数を6個から5個に減らす',
      '夜空の星の数を7個から6個に減らす',
      '輪つなぎを7色から6色に変える(色を1つ抜く)',
      '招き猫の挙げている手を左から右に変える',
      'コケシを2体から1体に減らす',
      '男の子の甚平に小さな模様(雲マーク)を1つ追加',
      'ちょうちんを2個から3個に増やす',
      '書道作品の「た」を「な」に変える'
    ]
  },

  {
    id: 'kitchen-bento',
    label: 'おべんとうづくり',
    base: `${STYLE}
SCENE: 朝の日本の家庭のキッチン。母親と娘が一緒にお弁当を作っている。

CHARACTERS:
- 母親: 茶色いショートヘア、青いエプロン(白い花柄3つ)、フライパンを持つ
- 女の子(年長): 三つ編み2本、赤いリボン2個、白いエプロン、踏み台に立ってお弁当箱に詰める

KITCHEN COUNTER (中央、画面の3/5を占める):
- ガスコンロ: 2口、片方に黒いフライパン
- まな板: 木製、長方形、上に切ったきゅうり3切れ、人参2切れ
- お弁当箱: ピンク、長方形、フタは横に置く
- お弁当の中身を描く: ご飯(白)に小さな梅干し1個、卵焼き3切れ、ミニトマト2個、ブロッコリー2個、唐揚げ4個、たこさんウインナー2個
- 調味料: 醤油瓶、塩入れ、こしょう入れ — 並ぶ
- 包丁1本、計量カップ1個、菜箸1セット

BACKGROUND:
- 冷蔵庫: 左、上にマグネットでメモ3枚、写真1枚(家族写真)
- 棚: 食器(皿5枚、コップ3個)、調味料(醤油・酢・酒の瓶3本)
- 窓: 右上、外に朝日(オレンジ)、雲2つ、小鳥2羽
- 壁掛け時計: 7時30分
- ゴミ箱: 1個(白)
- 床にスリッパ2足(母:青、娘:ピンク)

STRICT RULES: お弁当の中身は1個1個ハッキリ別々に描く。文字や数が数えられる。`,
    differences: [
      '唐揚げを4個から3個に減らす',
      'ミニトマトを2個から3個に増やす',
      'たこさんウインナーを2個から1個に減らす',
      'お弁当箱の色をピンクから黄色に変える',
      '女の子のリボンを左右どちらか片方だけ青に変える',
      '時計の針を7時30分から7時45分に変える',
      '冷蔵庫のメモを3枚から2枚に減らす',
      'きゅうりを3切れから4切れに増やす',
      '調味料の瓶を3本から2本に減らす',
      '小鳥を2羽から1羽に減らす'
    ]
  },

  {
    id: 'doubutsuen-iriguchi',
    label: 'どうぶつえんのいりぐち',
    base: `${STYLE}
SCENE: 動物園の入口、賑やかな朝。

ENTRANCE GATE: アーチ型、上に「どうぶつえん」のプレート(ひらがな、はっきり)。両柱に絡まる蔦。

PEOPLE (描く子供と大人を全部別々に):
- 入口手前: 家族4人 — 父(短髪、リュック)、母(ロングヘア、トート), 男の子(キャップ、Tシャツ、ハーフパンツ、リュック)、女の子(髪に花のヘアピン2個、ワンピース、リュック)
- チケット売り場: 駅員風の制服を着た係員1名、窓口に「おとな500えん こども200えん」の貼り紙
- 行列: 子供3人(色違いの帽子: 赤・青・緑)が手をつないで並ぶ
- 飼育員: 緑のつなぎ、長靴、エサのバケツを持つ

ANIMALS (門の向こうに見える):
- ぞう: 1頭、鼻を上げる
- きりん: 1頭、首長い
- ライオン: 1頭、たてがみ
- パンダ: 2頭、笹を食べる
- フラミンゴ: 5羽、ピンク
- サル: 木の上に3匹

BACKGROUND:
- 看板: 動物園のマップ(色分けエリア4つ)、地図に矢印5本
- 風船: 売店に7個(赤2、青2、黄2、緑1)
- 自販機: 1台、ジュース缶6本見える
- ゴミ箱: 2個(燃える、燃えない の分別)
- 木: 大きな桜2本(花満開)、銀杏1本(緑)
- 雲: 3つ、太陽1個

STRICT RULES: 動物と人は重ねず、それぞれ独立して見える。`,
    differences: [
      'プレートの「ど」を「と」に変える(どうぶつえん→とうぶつえん)',
      '行列の子供の帽子を赤・青・緑から赤・青・黄に変える',
      'パンダの数を2頭から1頭に減らす',
      '風船の合計を7個から6個に減らす',
      '女の子のヘアピンを2個から1個に減らす',
      '自販機のジュースを6本から5本に減らす',
      'サルを木の上に3匹から4匹に増やす',
      '看板の矢印を5本から4本に減らす',
      'フラミンゴを5羽から4羽に減らす',
      'ゴミ箱を2個から3個に増やす'
    ]
  },

  {
    id: 'shichi-go-san',
    label: '七五三のおまいり',
    base: `${STYLE}
SCENE: 神社の参道で七五三のお参りをする家族。

CHARACTERS:
- 父: 黒いスーツ、ネクタイ、革靴、手にカメラ(肩に下げる)
- 母: 桜柄の和服、髪は和風アップ、片手にハンドバッグ
- 男の子(5歳): 紺の羽織袴、両手に千歳飴の袋(白地に赤い鶴と亀の絵)、笑顔
- 女の子(7歳): 赤い振袖、髪に大きな黄色の花飾り、両手に千歳飴の袋
- 祖父: 灰色の着物、白髪、メガネ
- 祖母: 紫の着物、髪を結う

BACKGROUND ELEMENTS:
- 鳥居: 赤、画面奥、大きく描く
- 本殿: 左奥、屋根が見える、提灯2個(赤)が両側
- 参道: 石畳、敷石が見える(20個程度の石を描く)
- 灯籠: 石造り、左右に1個ずつ、上に屋根
- 狛犬: 左右に1対(右が口を開けた阿、左が口を閉じた吽)
- 大きな木: 銀杏2本(黄色)、もみじ1本(赤)
- 落ち葉: もみじの葉が地面に散る(8枚)、銀杏の葉(6枚)
- 絵馬: 絵馬掛けに10個吊られる、それぞれに小さな絵
- 鳩: 2羽、地面で餌をつつく
- 神主: 1人、白い装束、奥に立つ
- 賽銭箱: 木製、参道の手前
- 空: 雲3つ、太陽1個

STRICT RULES: 落ち葉も絵馬も別々に数えられるように描く。`,
    differences: [
      '女の子の髪飾りを黄色から赤に変える',
      '父のネクタイの柄を無地から縞模様に変える',
      'もみじの落ち葉を8枚から7枚に減らす',
      '絵馬を10個から9個に減らす',
      '提灯を2個から1個に減らす',
      '狛犬の口を両方とも開けた状態にする(本来は阿吽)',
      '祖母の着物の色を紫から茶色に変える',
      '銀杏の木を2本から3本に増やす',
      '鳩を2羽から3羽に増やす',
      '雲を3つから2つに減らす'
    ]
  },
];

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
  if (!j.data) { console.error(`  ERR ${scene.id} base:`, JSON.stringify(j).slice(0, 800)); return null; }
  const buf = Buffer.from(j.data[0].b64_json, 'base64');
  const outPath = path.join(OUT, `${scene.id}-base.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`  [base done] ${outPath} (${(buf.length/1024).toFixed(0)}KB, ${((Date.now()-t0)/1000).toFixed(0)}s)`);
  return outPath;
}

async function genVariant(scene, basePath) {
  console.log(`[variant] ${scene.id} ...`);
  const t0 = Date.now();
  const baseBuf = fs.readFileSync(basePath);
  const blob = new Blob([baseBuf], { type: 'image/png' });
  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('image', blob, 'base.png');
  const editPrompt = `You are creating a "spot-the-difference" puzzle for the entrance exam of Japan's most competitive private elementary schools (難関私立小学校受験). The puzzle must be HARD.

Take the provided image and produce a new image that is IDENTICAL in composition, line style, color palette, perspective, lighting, character count, character positions, and every other aspect — EXCEPT for the following 10 small targeted modifications. Each modification must be SMALL and SUBTLE (small object swap, count change by ±1, single-character text change, small color shift on one item, left/right flip of one accessory) — NOT a large redesign. Do NOT redraw the whole scene. Do NOT change the art style. Do NOT alter elements not listed.

THE 10 SMALL CHANGES:
${scene.differences.map((d,i)=>`${i+1}. ${d}`).join('\n')}

OUTPUT: the same illustration with only these 10 micro-changes applied. Everything else must be pixel-near identical.`;
  form.append('prompt', editPrompt);
  form.append('size', '1024x1536');
  form.append('quality', 'high');
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KEY}` },
    body: form,
  });
  const j = await res.json();
  if (!j.data) { console.error(`  ERR ${scene.id} variant:`, JSON.stringify(j).slice(0, 800)); return null; }
  const buf = Buffer.from(j.data[0].b64_json, 'base64');
  const outPath = path.join(OUT, `${scene.id}-variant.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`  [variant done] ${outPath} (${(buf.length/1024).toFixed(0)}KB, ${((Date.now()-t0)/1000).toFixed(0)}s)`);
  return outPath;
}

const problems = [];
// Run scenes in parallel for speed (5 concurrent base, then 5 variants)
console.log('Generating 5 base scenes in parallel...');
const baseResults = await Promise.all(SCENES.map(s => genBase(s).catch(e => { console.error(s.id, e.message); return null; })));
console.log('\nGenerating 5 variants in parallel...');
const variantResults = await Promise.all(SCENES.map((s, i) => baseResults[i] ? genVariant(s, baseResults[i]).catch(e => { console.error(s.id, e.message); return null; }) : null));

for (let i = 0; i < SCENES.length; i++) {
  if (baseResults[i] && variantResults[i]) {
    problems.push({
      id: SCENES[i].id,
      label: SCENES[i].label,
      base: path.basename(baseResults[i]),
      variant: path.basename(variantResults[i]),
      differences: SCENES[i].differences,
    });
  }
}

fs.writeFileSync(path.join(OUT, 'problems.json'), JSON.stringify({ problems }, null, 2));
console.log(`\nDONE: ${problems.length}/${SCENES.length} → ${OUT}`);
