"""
extract-hitboxes.py
GPT-4o Vision で base と variant を比較し、10ヶ所の差分位置 [x,y,w,h] を抽出。
出力: stdout に JSON。
"""

import os, sys, json, base64, argparse
from pathlib import Path
import requests

KEY = os.environ.get('OPENAI_API_KEY')
if not KEY:
    print('OPENAI_API_KEY required', file=sys.stderr); sys.exit(1)

ap = argparse.ArgumentParser()
ap.add_argument('--base', required=True)
ap.add_argument('--variant', required=True)
ap.add_argument('--expected', type=int, default=10)
ap.add_argument('--out', required=True)
ap.add_argument('--diffs-list', default='')  # comma-separated descriptions to help vision
args = ap.parse_args()

base_path = Path(args.base)
variant_path = Path(args.variant)

def b64img(path):
    return base64.b64encode(Path(path).read_bytes()).decode('utf-8')

system_prompt = """You are an expert spot-the-difference puzzle analyst for Japanese top-tier elementary school entrance exams (難関私立小学校受験).
Two illustrations are provided: BASE (left) and VARIANT (right). Both are 1024 wide x 1536 tall.

Identify EXACTLY the intentional pictorial differences between them. For each difference, return a tight axis-aligned bounding box in the VARIANT image coordinates: [x, y, w, h] where (x,y) is top-left and (w,h) is width/height in pixels.

CRITICAL RULES:
- Coordinates must be in the 1024×1536 pixel space of the VARIANT image.
- Bounding boxes should TIGHTLY enclose just the changed element (not the whole figure containing it). Add ~8px padding.
- Ignore: line-weight jitter, micro color tone shifts, slight character pose drift that is clearly unintended noise. Focus on actual pictorial changes (objects added/removed/recolored/swapped/repositioned/count-changed).
- Skip any text/letter differences if present.
- Return STRICT JSON only, no markdown fences. Format:

{
  "differences": [
    { "id": "d1", "kind": "color|count|add|remove|swap|position|other", "description": "<japanese hiragana, 〜10字>", "hitbox": [x, y, w, h] },
    ...
  ]
}
"""

user_text = f"BASE と VARIANT を比較して、画像内の意図的な差分を {args.expected} 個まで列挙。"
if args.diffs_list:
    user_text += f"\n\n参考: 指示した変更内容 — {args.diffs_list}"

payload = {
    "model": "gpt-4o",
    "temperature": 0,
    "max_tokens": 2000,
    "messages": [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": [
            {"type": "text", "text": user_text},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64img(base_path)}", "detail": "high"}},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64img(variant_path)}", "detail": "high"}},
        ]},
    ],
}

print(f'Calling GPT-4o vision...', file=sys.stderr)
r = requests.post(
    'https://api.openai.com/v1/chat/completions',
    headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'},
    json=payload, timeout=180,
)
j = r.json()
if 'choices' not in j:
    print('ERR:', json.dumps(j)[:1200], file=sys.stderr); sys.exit(1)
content = j['choices'][0]['message']['content']

# Strip markdown fences if present
content_clean = content.strip()
if content_clean.startswith('```'):
    content_clean = content_clean.split('```')[1]
    if content_clean.startswith('json'):
        content_clean = content_clean[4:]
    content_clean = content_clean.strip()
    if content_clean.endswith('```'):
        content_clean = content_clean[:-3].strip()

try:
    parsed = json.loads(content_clean)
except Exception as e:
    print('Failed to parse JSON. Raw content:', file=sys.stderr)
    print(content, file=sys.stderr)
    sys.exit(2)

# Validate
diffs = parsed.get('differences', [])
W, H = 1024, 1536
clean = []
for i, d in enumerate(diffs):
    bb = d.get('hitbox')
    if not (isinstance(bb, list) and len(bb) == 4):
        continue
    x, y, w, h = [int(v) for v in bb]
    # clamp
    x = max(0, min(x, W-1))
    y = max(0, min(y, H-1))
    w = max(20, min(w, W-x))
    h = max(20, min(h, H-y))
    clean.append({
        'id': d.get('id', f'd{i+1}'),
        'kind': d.get('kind', 'other'),
        'description': d.get('description', ''),
        'hitbox': [x, y, w, h],
    })

out = {'differences': clean}
Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'OK: {len(clean)} hitboxes -> {args.out}', file=sys.stderr)
# also stdout for chaining
print(json.dumps(out, ensure_ascii=False))
