"""detect-elements.py
画像から色クラスタで個別要素を直接検出。
- 赤い小領域 (もみじ落葉)
- 黄色い小領域 (ぎんなん落葉)
- 白い雲のような領域
- 灰色っぽい石

Vision の不確実な座標を排除し、ピクセルから確実に取る。
"""
import sys, json, argparse
from pathlib import Path
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('--base', required=True)
ap.add_argument('--out', required=True)
args = ap.parse_args()

img = np.array(Image.open(args.base).convert('RGB'))
H, W = img.shape[:2]

def find_blobs(mask, min_area=300, max_area=5000):
    """単純な連結成分検出 (4-連結)"""
    visited = np.zeros_like(mask, dtype=bool)
    blobs = []
    h, w = mask.shape
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not visited[y, x]:
                # BFS
                stack = [(y, x)]
                minx, miny, maxx, maxy = x, y, x, y
                count = 0
                while stack:
                    cy, cx = stack.pop()
                    if 0 <= cy < h and 0 <= cx < w and mask[cy, cx] and not visited[cy, cx]:
                        visited[cy, cx] = True
                        count += 1
                        if cx < minx: minx = cx
                        if cx > maxx: maxx = cx
                        if cy < miny: miny = cy
                        if cy > maxy: maxy = cy
                        stack.extend([(cy+1,cx),(cy-1,cx),(cy,cx+1),(cy,cx-1)])
                area = (maxx-minx+1)*(maxy-miny+1)
                if min_area <= area <= max_area:
                    blobs.append((minx, miny, maxx-minx+1, maxy-miny+1, count))
    return blobs

# Color masks
R, G, B = img[:,:,0], img[:,:,1], img[:,:,2]

# Red maple leaves: high R, low G, low-mid B
red_mask = (R > 150) & (G < 110) & (B < 90)
# Yellow ginkgo leaves: high R+G, low B
yellow_mask = (R > 200) & (G > 170) & (B < 130)
# White/cream clouds: very high all, in upper third of image
white_mask = np.zeros_like(R, dtype=bool)
white_mask[:H//3] = (R[:H//3] > 240) & (G[:H//3] > 235) & (B[:H//3] > 220)
# Note: cream sky might also match; cloud has white interior
# To distinguish: look at white near top-third

# For finding individual leaves, we want SMALL blobs in lower 2/3
# Restrict scope to non-character areas if possible (we can't easily)
# Just find all small blobs and sort

# Red (maple) - restrict to lower 2/3 (avoid red torii)
red_mask_filt = red_mask.copy()
red_mask_filt[:H//3] = False  # exclude red torii area
red_blobs = find_blobs(red_mask_filt.astype(np.uint8), min_area=400, max_area=4000)

# Yellow (ginkgo) - need to distinguish from yellow ginkgo TREE (large) and individual leaves (small)
yellow_blobs_all = find_blobs(yellow_mask.astype(np.uint8), min_area=200, max_area=2500)

# White (cloud) - top third
white_blobs = find_blobs(white_mask.astype(np.uint8), min_area=600, max_area=8000)

def to_bboxes(blobs, limit=8):
    # Sort by area asc, take smallest (most likely individual leaves not tree masses)
    blobs.sort(key=lambda b: b[2]*b[3])
    out = []
    for x, y, w, h, area in blobs[:limit]:
        # Add small padding
        px = max(0, x-3); py = max(0, y-3)
        pw = min(W-px, w+6); ph = min(H-py, h+6)
        out.append([int(px), int(py), int(pw), int(ph)])
    return out

result = {
    'maple_leaf': to_bboxes(red_blobs, limit=10),
    'ginkgo_leaf': to_bboxes(yellow_blobs_all, limit=10),
    'cloud': to_bboxes(white_blobs, limit=5),
}
Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
for cat, boxes in result.items():
    print(f'{cat}: {len(boxes)} found')
    for i, b in enumerate(boxes[:4]):
        print(f'  [{i}]', b)
