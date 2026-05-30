"""build-full.py
本番20問 (10 Mode A + 10 Mode B) のフル生成パイプライン。

Phases:
1. base 画像生成 (gpt-image-1, parallel)
2. Vision safe-zones 抽出 (gpt-4o, parallel)
3. overlay JSON 生成 + hitbox 自動検査
4. data/problems/<id>/ 配下に保存
5. data/problems/index.json 生成

既存 (test-images-v2, test-images-modeb) は再利用。
"""

import os, sys, json, base64, time, random
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from PIL import Image, ImageDraw

KEY = os.environ.get('OPENAI_API_KEY')
if not KEY: print('OPENAI_API_KEY required'); sys.exit(1)

ROOT = Path('.')
PROBLEMS_DIR = ROOT / 'data' / 'problems'
PROBLEMS_DIR.mkdir(parents=True, exist_ok=True)

# ============ Scene library ============
STYLE = """Japanese children's entrance-exam picture-puzzle illustration style (難関私立小学校受験「間違い探し」). Clean black ink outlines, light pastel color fills, off-white/cream background. NO photorealism, NO 3D, NO heavy shading. ABSOLUTELY NO text, NO letters, NO kanji, NO hiragana, NO katakana, NO numerals, NO signs, NO writing of any kind in the image. Plain illustrated objects only. Dense composition with 25+ identifiable elements. Portrait aspect 1024x1536. Soft warm pastel palette: cream, peach, soft green, soft blue, soft pink, muted yellow, light brown, warm gray. No vivid neon colors."""

# Mode A: 10 problems (5 existing reused + 5 new)
MODE_A_PROBLEMS = [
    {
        'id': 'A01', 'topic': 'shichi-go-san',
        'existing_base': 'data/pilot/modeA-base.png',
    },
    {
        'id': 'A02', 'topic': 'youchien-jiyu-jikan',
        'existing_base': 'test-images-v2/youchien-jiyu-jikan-base.png',
    },
    {
        'id': 'A03', 'topic': 'tanabata-kazari',
        'existing_base': 'test-images-v2/tanabata-kazari-base.png',
    },
    {
        'id': 'A04', 'topic': 'kitchen-bento',
        'existing_base': 'test-images-v2/kitchen-bento-base.png',
    },
    {
        'id': 'A05', 'topic': 'doubutsuen-iriguchi',
        'existing_base': 'test-images-v2/doubutsuen-iriguchi-base.png',
    },
    {
        'id': 'A06', 'topic': 'oshougatsu',
        'prompt': f"""{STYLE}
SCENE: 日本のお正月、家のリビング。
CHARACTERS:
- 父 (紺の着物、メガネ、座っている)
- 母 (赤い着物、髪を結い、お茶を入れる)
- 男の子 (青い着物、お年玉袋を両手に、笑顔)
- 女の子 (ピンクの着物に黄色い帯、福笑いの絵札を持つ)
- 祖父 (灰色の着物、扇子)
- 祖母 (紫の着物、孫を見守る)
DETAILS:
- 床の間: 鏡餅 (3段重ねの白い餅 + 橙)、門松1対、しめ縄、達磨1個
- ちゃぶ台: 黒い重箱 (おせち料理が見える)、湯呑5個、急須1個、お茶碗、栗きんとん、紅白蒲鉾、伊達巻
- 壁: 富士山の絵、書初め (字は描かない、書道紙のみ)
- 窓の外: 雪景色、雪だるま1体、凧揚げする子供1人
- 畳の上: 羽子板1対、独楽3個、すごろくゲーム
- 天井に提灯1個、桜の枝の生け花
全要素を別々に描き分け、輪郭明瞭""",
    },
    {
        'id': 'A07', 'topic': 'ohanami',
        'prompt': f"""{STYLE}
SCENE: 春の桜公園でお花見をする家族と友達。
CHARACTERS:
- 母 (黄色いシャツ、エプロン、お弁当箱を広げる)
- 父 (青いポロシャツ、髪を結ぶ、ビールを持つ)
- 男の子 (赤いTシャツ、桜の枝を見上げる)
- 女の子 (ピンクのワンピース、花びらをキャッチ)
- お友達3人 (Tシャツ赤・緑・青)
DETAILS:
- 大きな桜の木 (満開、花びら散る、20枚程度の花びらが空に舞う)
- ピクニックシート (赤と白のチェック柄)
- お弁当箱: ご飯、唐揚げ5個、玉子焼き4切、たこさんウインナー2個、ミニトマト3個、ブロッコリー2個、おにぎり3個
- 水筒2本 (赤と青)、紙コップ5個、お茶
- ビニールシートの隅にバナナ2本、ジュース缶3本
- 周辺の木: 桜2本、葉桜1本
- 池に鯉3匹、アヒル2羽
- 蝶3匹、鳥2羽飛ぶ
- 空: 雲3つ、太陽1個
全要素を別々に描き分け""",
    },
    {
        'id': 'A08', 'topic': 'shoutengai',
        'prompt': f"""{STYLE}
SCENE: 賑やかな日本の商店街、夕方の買い物時間。
SHOPS (描き分け):
- 八百屋: 大根3本、人参5本、玉ねぎ4個、トマト8個、キャベツ2玉 並ぶ
- 魚屋: 鯵3匹、秋刀魚4匹、鮪の切り身2、海老6尾、貝3個
- 肉屋: 鶏肉、牛肉、豚肉のショーケース、お肉の塊3つ
- パン屋: 食パン、メロンパン4個、あんパン6個、フランスパン2本、ドーナツ5個
- 花屋: チューリップ3本、薔薇5本、ひまわり2本、菊3本
PEOPLE:
- お母さん (買い物カゴ持つ、紫のセーター)
- 子供 (お母さんの隣、青いシャツ)
- おばあさん (杖、ピンクのカーディガン)
- 八百屋のおじさん (前掛け、頬かむり)
- 魚屋のお兄さん (青い前掛け、はちまき)
- 自転車に乗った人 (帽子)
DETAILS:
- 街灯3本、提灯6個 (アーケード吊り)、看板10個 (絵柄のみ)
- 自転車3台、ベビーカー1台
- 鳩2羽、猫1匹
全要素を別々に描き分け""",
    },
    {
        'id': 'A09', 'topic': 'kaisuiyoku',
        'prompt': f"""{STYLE}
SCENE: 夏の海水浴場、賑やかなビーチ。
CHARACTERS (5人):
- 男の子 (赤い水着、浮き輪、笑顔)
- 女の子 (ピンクの水着、麦わら帽子、貝殻を拾う)
- 父 (青い水着、サングラス、寝そべる)
- 母 (黄色のパラソル下、白い帽子、本を読む)
- お友達 (緑の水着、砂のお城を作る)
BEACH DETAILS:
- 海: 波3列、ヨット2艘、サーフボード1人、イルカ1匹見える
- 砂浜: 貝殻7個、ヒトデ2個、カニ1匹
- パラソル3本 (赤・黄・青)、ビーチタオル4枚 (色違い)
- 浮き輪4個、ビーチボール1個 (赤白)
- スイカ3切、アイス2本、ジュース缶3本
- 砂のお城 (3層)、バケツ2個、シャベル1本
- カモメ4羽、雲3つ、太陽1個
- 灯台1個 (遠景)
全要素を別々に描き分け""",
    },
    {
        'id': 'A10', 'topic': 'christmas-livingroom',
        'prompt': f"""{STYLE}
SCENE: クリスマスの夜の家のリビング、家族3人。
CHARACTERS:
- 父 (緑のセーター、サンタの帽子、ツリーの飾りを直す)
- 母 (赤いカーディガン、ケーキを運ぶ)
- 子供 (パジャマ、プレゼントを覗く、笑顔)
TREE:
- 大きなクリスマスツリー (緑、星トップ1個)
- 飾り: 赤い玉5個、金の玉4個、銀の玉3個、リボン4本、雪の結晶3個、キャンディケーン2本、サンタの人形1個
- ライト (LED 8個並ぶ)
DETAILS:
- 暖炉: 木の薪、火、靴下3足吊るす (色違い)
- 暖炉の上: 写真立て2個、時計1個、ろうそく3本
- ソファ: 赤、クッション3個 (色違い)
- 床: プレゼント箱5個 (異なる色のリボン)、ぬいぐるみ2体 (クマと犬)
- テーブル: ケーキ (ホール)、シャンパングラス2個、お皿3枚
- 窓: 外に雪、月、トナカイのシルエット1頭
- 天井: ガーランド (緑+赤+金)
全要素を別々に描き分け""",
    },
]

# Mode B: 10 problems (1 existing + 9 new)
MODE_B_PROBLEMS = [
    {
        'id': 'B01', 'topic': 'kouen-asobi',
        'existing_base': 'data/pilot/modeB-base.png',
    },
    {
        'id': 'B02', 'topic': 'asa-no-shokutaku',
        'prompt': f"""{STYLE}
SCENE: 朝の家族の食卓。家族4人が朝食を食べている。
CHARACTERS:
- 父 (白いシャツ、新聞を読む)
- 母 (エプロン、お茶を注ぐ)
- 男の子 (パジャマ、トーストを食べる)
- 女の子 (パジャマ、目玉焼きを食べる)
TABLE:
- 木製のダイニングテーブル
- 4人分の食器: お皿4枚、コップ4個、フォーク4本、ナイフ4本
- トースト4枚、目玉焼き4個、サラダボウル、フルーツの盛り合わせ
- ジュースのピッチャー、牛乳パック1個、コーヒーポット
ROOM:
- 壁の時計 (8時)、カレンダー、絵画1枚
- 棚: ぬいぐるみ3体、本5冊、観葉植物
- 窓: カーテン、外に小鳥2羽、太陽1個
- 床: ペットの犬1匹、新聞紙
全要素を別々に描き分け""",
    },
    {
        'id': 'B03', 'topic': 'oniwa',
        'prompt': f"""{STYLE}
SCENE: 春の家の庭で遊ぶ親子。
CHARACTERS:
- 母 (麦わら帽子、ピンクのエプロン、じょうろを持つ)
- 男の子 (黄色いシャツ、種を蒔く)
- 女の子 (青いワンピース、お花を摘む)
- 父 (白いシャツ、芝刈り機を押す)
GARDEN:
- 花壇: チューリップ8本 (赤・黄・ピンク混合)、ひまわり3本、薔薇2本
- 木: りんごの木 (リンゴ5個実る)、桜1本
- 家庭菜園: トマト苗4本、きゅうり苗3本、ナス2本
- 芝生
DETAILS:
- 物置小屋 (赤い屋根)
- 鳥の巣箱 (木の枝に)
- 蝶4匹、てんとう虫3匹、ハチ2匹
- 鳥2羽 (枝に)、犬1匹
- 雲3つ、太陽1個
- 池1個 (金魚3匹)
- 縁石、レンガの小道
全要素を別々に描き分け""",
    },
    {
        'id': 'B04', 'topic': 'toshokan',
        'prompt': f"""{STYLE}
SCENE: 子供図書館で本を読む子供たち。
CHARACTERS:
- 司書のお姉さん (グレーのカーディガン、髪を後ろで束ねる)
- 男の子1 (青いTシャツ、絵本を開く)
- 女の子1 (赤いワンピース、本棚を見上げる)
- 男の子2 (緑のシャツ、床に座って本を読む)
- 女の子2 (黄色いドレス、本を抱える)
ROOM:
- 本棚3列 (本がぎっしり、色別)
- 読書用の椅子4脚 (色違い)
- 丸いラグ
- カウンター: コンピュータ、スタンプ台、本の山
- 壁: 物語の絵5枚 (色付き、文字なし)
- 観葉植物2鉢
- 天井: 照明 (ペンダント3個)
- 窓: 外に大きな木1本、小鳥1羽
- 床: 絵本のキャラのぬいぐるみ2体
全要素を別々に描き分け""",
    },
    {
        'id': 'B05', 'topic': 'jitensha',
        'prompt': f"""{STYLE}
SCENE: 公園で自転車の練習をする子供と家族。
CHARACTERS:
- 男の子 (ヘルメット赤、Tシャツ青、自転車に乗る)
- 父 (ジャージ、後ろを支える、笑顔)
- 母 (黄色いシャツ、ベンチで見守る)
- 妹 (ピンクのワンピース、人形を抱える)
- お友達 (緑のヘルメット、もう一台の自転車に乗る)
PARK:
- 大きな桜の木2本 (花散る)
- ベンチ2台、テーブル1台
- 池: アヒル3羽、鯉2匹
- 噴水1個
- 街灯3本
- 花壇: チューリップ5本、薔薇3本
- ゴミ箱2個 (分別)
- 看板1個 (絵柄、文字なし)
- 雲3つ、太陽1個、蝶3匹
- 道: 自転車専用レーン
全要素を別々に描き分け""",
    },
    {
        'id': 'B06', 'topic': 'origami',
        'prompt': f"""{STYLE}
SCENE: 子供たちが折り紙で遊んでいる教室。
CHARACTERS (5人):
- 先生 (グレーのワンピース、メガネ、子供に教える)
- 男の子1 (青いシャツ、鶴を折る)
- 女の子1 (ピンクのカーディガン、星を折る)
- 男の子2 (黄色いシャツ、お花を折る)
- 女の子2 (緑のセーター、犬を折る)
DETAILS:
- 折り紙の山 (色とりどり 20枚以上、整然と)
- 完成した折り紙: 鶴3羽、星5個、お花6輪、犬2匹、ハートの飾り4個、船3艘
- 机5卓 (子供達の前)
- 黒板: 折り方の絵 (図解、文字なし)
- 壁: 完成品の飾り (鶴の連なり、ガーランド)
- 棚: クレヨン箱、はさみ、のり
- 床: ラグ、絨毯
- 窓: 桜の枝、小鳥1羽
- 時計1個、観葉植物1鉢
全要素を別々に描き分け""",
    },
    {
        'id': 'B07', 'topic': 'ryouri-otetsudai',
        'prompt': f"""{STYLE}
SCENE: お母さんと一緒に料理する女の子。キッチンに父と弟も。
CHARACTERS:
- 母 (青いエプロン、髪を結い、フライパンを持つ)
- 女の子 (ピンクのエプロン、踏み台、生地をこねる)
- 父 (白シャツ、テーブルでサラダを切る)
- 弟 (オレンジのシャツ、お皿を運ぶ)
KITCHEN:
- ガスコンロ: 2口、フライパンに目玉焼き、お鍋にスープ
- まな板: 野菜 (人参3本、玉ねぎ2個、キャベツ1玉、トマト4個)
- 冷蔵庫 (写真とメモが貼られる)
- オーブン
- 食器棚: お皿8枚、コップ6個、調味料瓶7本
- 流し台: 食器
- 観葉植物
- 窓: 外に庭、小鳥2羽、太陽
- 床: スリッパ3足、ペットの猫1匹
全要素を別々に描き分け""",
    },
    {
        'id': 'B08', 'topic': 'oekaki-jikan',
        'prompt': f"""{STYLE}
SCENE: 子供達がお絵描き教室で絵を描いている。
CHARACTERS (4人):
- 男の子1 (青いスモック、絵筆で太陽を描く)
- 女の子1 (赤いスモック、髪に黄色いリボン、お花を描く)
- 男の子2 (緑のスモック、動物を描く)
- 女の子2 (黄色いスモック、家族の絵を描く)
- 先生 (グレーのスモック、子供を見守る)
ROOM:
- イーゼル4台 (それぞれ違う絵が描かれる:太陽、花、犬、家)
- 絵の具のパレット4個 (色とりどり)
- クレヨンの箱: 12色 整列
- 絵筆立て (筆6本)
- 水入れ4個 (透明の容器に色水)
- 画用紙の束
- 壁: 子供達の絵 (虹、家、動物の絵6枚)
- 棚: アート用品、粘土
- 観葉植物2鉢、時計1個
- 窓: 外の景色、小鳥2羽
全要素を別々に描き分け""",
    },
    {
        'id': 'B09', 'topic': 'pool',
        'prompt': f"""{STYLE}
SCENE: 夏のプール、家族と子供が泳ぐ。
CHARACTERS:
- 父 (青い水着、ゴーグル、プールで泳ぐ)
- 母 (ピンクの水着、麦わら帽子、プールサイドで本を読む)
- 男の子 (黄色い水着、浮き輪、笑顔)
- 女の子 (赤い水着、フロート、手を振る)
- お友達 (緑の水着、飛び込もうとする)
POOL:
- プール本体 (青い水、波紋)
- ビーチパラソル4本 (色違い)
- デッキチェア5脚
- ビーチボール3個、浮き輪4個 (色違い)
- アイスクリームスタンド (色違いコーン3本、ソフトクリーム1個)
- ジュースのコーナー: ボトル6本、コップ5個
- 救命具 (赤と白)
- 看板1個 (絵柄、文字なし)
- 木3本、植物
- 雲3つ、太陽1個、鳥2羽
全要素を別々に描き分け""",
    },
    {
        'id': 'B10', 'topic': 'picnic',
        'prompt': f"""{STYLE}
SCENE: 山のふもとでピクニックする家族と友達。
CHARACTERS:
- 父 (緑のシャツ、リュック、写真を撮る)
- 母 (黄色いカーディガン、お弁当を広げる)
- 男の子 (赤い帽子、虫網を持つ)
- 女の子 (青いワンピース、花束を集める)
- お友達夫婦と子供 (お父さん、お母さん、男の子)
PICNIC:
- ピクニックシート (チェック柄)
- お弁当箱: おにぎり6個、唐揚げ8個、玉子焼き5切、ミニトマト4個、ブロッコリー3個
- 水筒3本、ジュース缶4本、紙コップ7個
- フルーツ盛り合わせ
NATURE:
- 山 (背景に3つ)
- 大きな木3本、桜1本
- 小川 (清流、魚2匹)
- 草原: 花 (たんぽぽ5本、シロツメクサ3本、ひまわり2本)
- 蝶4匹、てんとう虫3匹、ハチ2匹
- 小鳥3羽、リス1匹
- 太陽、雲3つ
- 道、案内標識 (絵柄、文字なし)
全要素を別々に描き分け""",
    },
]

ALL_PROBLEMS = MODE_A_PROBLEMS + MODE_B_PROBLEMS

# ============ Image generation ============
def gen_base(p):
    prob_dir = PROBLEMS_DIR / p['id']
    prob_dir.mkdir(exist_ok=True)
    base_path = prob_dir / 'base.png'
    if base_path.exists():
        print(f"[{p['id']}] base.png exists, skip")
        return str(base_path)
    if p.get('existing_base'):
        # copy
        src = Path(p['existing_base'])
        base_path.write_bytes(src.read_bytes())
        print(f"[{p['id']}] reused {src.name}")
        return str(base_path)
    print(f"[{p['id']}] generating base...")
    t0 = time.time()
    r = requests.post('https://api.openai.com/v1/images/generations',
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'},
        json={
            'model': 'gpt-image-1',
            'prompt': p['prompt'],
            'n': 1,
            'size': '1024x1536',
            'quality': 'high',
        }, timeout=300)
    j = r.json()
    if 'data' not in j:
        print(f"[{p['id']}] ERR base: {json.dumps(j)[:400]}")
        return None
    buf = base64.b64decode(j['data'][0]['b64_json'])
    base_path.write_bytes(buf)
    print(f"[{p['id']}] base done in {time.time()-t0:.0f}s")
    return str(base_path)

# ============ Vision: safe zones ============
def b64img(path):
    return base64.b64encode(Path(path).read_bytes()).decode('utf-8')

def get_safe_zones(p, base_path):
    prob_dir = PROBLEMS_DIR / p['id']
    zones_path = prob_dir / 'safe-zones.json'
    if zones_path.exists():
        print(f"[{p['id']}] safe-zones cached")
        return json.loads(zones_path.read_text(encoding='utf-8'))
    print(f"[{p['id']}] vision...")
    t0 = time.time()
    payload = {
        "model": "gpt-4o",
        "temperature": 0,
        "max_tokens": 2000,
        "messages": [
            {"role": "system", "content": """You are a precise placement helper for spot-the-difference puzzles. The user wants to add tiny 40x40 decorative stickers to an illustration WITHOUT them overlapping any character (faces, bodies, clothing) or major focal element.

Given the provided 1024x1536 illustration, identify EXACTLY 15 small rectangular SAFE ZONES — empty/background areas where a 40-50px sticker could be placed naturally without disrupting the scene.

PRIORITIZE SAFE areas in this order:
1. Sky / empty background top
2. Tree branches, leaves (away from main subjects)
3. Walls, structural elements
4. Ground far from characters
5. Edges of the canvas

AVOID at all costs: any character (face, body, hands, clothing), any pet/animal main subject, any signs/text, any focal object (the central food/toy/etc).

Return STRICT JSON:
{
  "safe_zones": [
    [x, y, w, h], ...
  ]
}
All coords in 1024x1536 pixel space. Bbox MUST be in pure empty/background area. w=40-60, h=40-60."""},
            {"role": "user", "content": [
                {"type": "text", "text": "Provide 15 safe zones for this illustration."},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64img(base_path)}", "detail": "high"}},
            ]},
        ],
    }
    r = requests.post('https://api.openai.com/v1/chat/completions',
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'},
        json=payload, timeout=180)
    j = r.json()
    if 'choices' not in j:
        print(f"[{p['id']}] vision ERR: {json.dumps(j)[:400]}")
        return None
    content = j['choices'][0]['message']['content'].strip()
    if content.startswith('```'):
        content = content.split('```')[1]
        if content.startswith('json'): content = content[4:]
        content = content.strip()
        if content.endswith('```'): content = content[:-3].strip()
    try:
        parsed = json.loads(content)
    except:
        print(f"[{p['id']}] parse fail: {content[:400]}")
        return None
    zones_path.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"[{p['id']}] vision done in {time.time()-t0:.0f}s, {len(parsed.get('safe_zones', []))} zones")
    return parsed

# ============ Overlay assignment ============
SHAPE_PALETTE = [
    # (shape_id, [colors])
    ('leaf-maple', ['#B85439', '#A65033', '#C95C44']),
    ('leaf-ginkgo', ['#D4A35E', '#C49751', '#E3B66E']),
    ('cloud', ['#FFFDF2', '#FAF3E0']),
    ('acorn', ['#8B6F47', '#6B5544', '#9E7B53']),
    ('flower', ['#E89BAA', '#D69A9A', '#F0A8B5']),
    ('butterfly', ['#D69A4C', '#C87B3C', '#B8743A']),
    ('bird', ['#8B6F5E', '#9B7A65']),
    ('mushroom', ['#A8755C', '#8E6748']),
]

def assign_overlays(zones, n, problem_mode, rand_seed):
    """Pick N zones from safe_zones, assign varied shapes."""
    rnd = random.Random(rand_seed)
    if len(zones) < n:
        # Pad by using zones with slight variations? Just take what we have.
        chosen = zones[:]
    else:
        # Pick N with spatial diversity preferred (here: random)
        chosen = rnd.sample(zones, n)
    overlays = []
    for i, z in enumerate(chosen):
        x, y, w, h = [int(v) for v in z]
        # Normalize size to 36-44
        w = max(36, min(w, 50))
        h = max(36, min(h, 50))
        shape_pick = rnd.choice(SHAPE_PALETTE)
        color = rnd.choice(shape_pick[1])
        size = rnd.randint(32, 40)
        ov = {
            'id': f'{problem_mode.lower()}{i+1}',
            'hint': f'{shape_pick[0]} added',
            'hitbox': [x, y, w, h],
            'kind': 'shape-add',
            'params': { 'shape': shape_pick[0], 'size': size, 'color': color },
        }
        if problem_mode == 'B':
            ov['label'] = f'{i+1}まいめ'
        overlays.append(ov)
    return overlays

# ============ Hitbox check render ============
def render_hitbox_check(base_path, overlays, out_path):
    base = Image.open(base_path).convert('RGB')
    result = base.copy()
    d = ImageDraw.Draw(result)
    for ov in overlays:
        x, y, w, h = ov['hitbox']
        d.rectangle([x, y, x+w, y+h], outline='red', width=4)
        d.text((x+2, y+2), ov['id'], fill='red')
    result.save(out_path)

# ============ Save problem data ============
def save_problem(p, base_path, overlays):
    prob_dir = PROBLEMS_DIR / p['id']
    is_mode_a = p['id'].startswith('A')
    data = {
        'id': p['id'],
        'mode': 'A' if is_mode_a else 'B',
        'topic': p['topic'],
        'baseImg': 'base.png',
        'imgW': 1024,
        'imgH': 1536,
    }
    if is_mode_a:
        data['overlays'] = overlays
    else:
        data['variants'] = overlays
    overlay_path = prob_dir / 'overlays.json'
    overlay_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"[{p['id']}] saved {overlay_path}")
    # also render hitbox check
    render_hitbox_check(base_path, overlays, prob_dir / 'hitbox-check.png')

# ============ Main pipeline ============
def process_one(p):
    try:
        base_path = gen_base(p)
        if not base_path: return None
        zones_data = get_safe_zones(p, base_path)
        if not zones_data: return None
        zones = zones_data.get('safe_zones', [])
        is_mode_a = p['id'].startswith('A')
        n = 10 if is_mode_a else 5
        overlays = assign_overlays(zones, n, 'A' if is_mode_a else 'B', hash(p['id']))
        save_problem(p, base_path, overlays)
        return p['id']
    except Exception as e:
        print(f"[{p['id']}] EXCEPTION: {e}")
        return None

if __name__ == '__main__':
    print(f'Processing {len(ALL_PROBLEMS)} problems...')
    completed = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        futures = {ex.submit(process_one, p): p for p in ALL_PROBLEMS}
        for fut in as_completed(futures):
            r = fut.result()
            if r: completed.append(r)
    print(f'\nDone: {len(completed)}/{len(ALL_PROBLEMS)}')
    # Build index
    index = []
    for p in ALL_PROBLEMS:
        if p['id'] in completed:
            index.append({
                'id': p['id'],
                'mode': 'A' if p['id'].startswith('A') else 'B',
                'topic': p['topic'],
            })
    (PROBLEMS_DIR / 'index.json').write_text(
        json.dumps({'problems': index}, ensure_ascii=False, indent=2),
        encoding='utf-8')
    print(f'Index: {len(index)} problems')
