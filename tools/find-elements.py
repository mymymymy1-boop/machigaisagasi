"""find-elements.py
Vision で base 画像内の小要素 (もみじ落葉/ぎんなん落葉/雲/石/etc) の bbox を抽出。
output: stdout に JSON。
"""
import os, sys, json, base64, argparse
from pathlib import Path
import requests

KEY = os.environ.get('OPENAI_API_KEY')
if not KEY: print('OPENAI_API_KEY required', file=sys.stderr); sys.exit(1)

ap = argparse.ArgumentParser()
ap.add_argument('--base', required=True)
ap.add_argument('--categories', default='')  # comma-separated requested categories
ap.add_argument('--out', required=True)
args = ap.parse_args()

b64 = base64.b64encode(Path(args.base).read_bytes()).decode('utf-8')

system_prompt = """You are a precise image-region locator. Given an illustration (1024x1536 portrait), identify the bounding boxes of TINY, INDIVIDUAL, ISOLATED visual elements that could be cloned and pasted elsewhere as subtle differences in a spot-the-difference puzzle.

For EACH requested element category, list AT LEAST 3 (up to 6) tight bounding boxes, each enclosing a single, small, fully-contained instance of that element. Add 4-6px padding so the entire shape (including outline) is captured.

CRITICAL:
- Coordinates in 1024x1536 pixel space
- Bbox must FULLY contain ONE instance (not partial)
- Skip overlapping or hidden instances
- For "clean-background" patches: identify a couple of small uniform empty areas suitable as "hide" overlays
- Return STRICT JSON only, no markdown

Format:
{
  "elements": {
    "maple_leaf": [ [x,y,w,h], ... ],
    "ginkgo_leaf": [ [x,y,w,h], ... ],
    "cloud": [ [x,y,w,h], ... ],
    "path_stone": [ [x,y,w,h], ... ],
    "ema_card": [ [x,y,w,h], ... ],
    "empty_sky": [ [x,y,w,h], ... ],
    "empty_path_ground": [ [x,y,w,h], ... ]
  }
}
"""

user_text = "この画像から、以下のカテゴリの個別要素を抽出してください: " + (args.categories or "maple_leaf, ginkgo_leaf, cloud, path_stone, empty_sky")

payload = {
    "model": "gpt-4o",
    "temperature": 0,
    "max_tokens": 4000,
    "messages": [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": [
            {"type": "text", "text": user_text},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"}},
        ]},
    ],
}
print('Calling GPT-4o vision...', file=sys.stderr)
r = requests.post('https://api.openai.com/v1/chat/completions',
    headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'},
    json=payload, timeout=180)
j = r.json()
if 'choices' not in j: print('ERR:', json.dumps(j)[:1200], file=sys.stderr); sys.exit(1)
content = j['choices'][0]['message']['content'].strip()
if content.startswith('```'):
    content = content.split('```')[1]
    if content.startswith('json'): content = content[4:]
    content = content.strip()
    if content.endswith('```'): content = content[:-3].strip()
parsed = json.loads(content)
Path(args.out).write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'OK -> {args.out}', file=sys.stderr)
print(json.dumps(parsed, ensure_ascii=False))
