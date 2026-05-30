# test-mask-edit.py
# Verify gpt-image-1 mask edit preserves unmasked region pixel-identical.

import os, sys, io, json, base64, time
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops
import urllib.request

KEY = os.environ.get('OPENAI_API_KEY')
if not KEY:
    print('OPENAI_API_KEY required'); sys.exit(1)

BASE = Path('test-images-modeb/kouen-asobi-base.png')
OUT = Path('test-mask-edit')
OUT.mkdir(exist_ok=True)

# 1) Build mask. gpt-image-1: transparent pixels = "edit here", opaque = preserve.
#    Use RGBA where alpha=0 in the edit zone, alpha=255 elsewhere.
W, H = 1024, 1536
mask = Image.new('RGBA', (W, H), (255, 255, 255, 255))  # fully opaque white = preserve
# Edit zone: where the sandbox bucket is roughly (around 130-300, 800-1050 in 1024x1536)
ZONE = (130, 800, 320, 1050)  # x1, y1, x2, y2
draw = ImageDraw.Draw(mask)
draw.rectangle(ZONE, fill=(0, 0, 0, 0))  # alpha=0 = editable
mask_path = OUT / 'mask.png'
mask.save(mask_path)
print(f'Mask saved: {mask_path}, edit zone: {ZONE}')

# 2) Call OpenAI edits API
import requests  # standard for multipart

print('Calling /v1/images/edits with mask...')
t0 = time.time()
with open(BASE, 'rb') as f_base, open(mask_path, 'rb') as f_mask:
    files = {
        'image': ('base.png', f_base.read(), 'image/png'),
        'mask': ('mask.png', f_mask.read(), 'image/png'),
    }
    data = {
        'model': 'gpt-image-1',
        'prompt': 'In the transparent region of the mask, change the sand bucket and shovel area visuals. Keep the surrounding scene exactly the same. Absolutely no text, letters, signs, or writing anywhere in the image.',
        'size': '1024x1536',
        'quality': 'high',
    }
    headers = {'Authorization': f'Bearer {KEY}'}
    r = requests.post('https://api.openai.com/v1/images/edits', headers=headers, files=files, data=data, timeout=300)

j = r.json()
if 'data' not in j:
    print('ERR:', json.dumps(j)[:1200]); sys.exit(1)

img_b64 = j['data'][0]['b64_json']
edited_path = OUT / 'edited.png'
edited_path.write_bytes(base64.b64decode(img_b64))
print(f'Done in {time.time()-t0:.0f}s. Edited: {edited_path}')

# 3) Diff check: compare base vs edited outside the mask zone
base_img = Image.open(BASE).convert('RGBA')
edited_img = Image.open(edited_path).convert('RGBA')

# If size differs (shouldn't, but just in case), align
if base_img.size != edited_img.size:
    print(f'WARN size mismatch: base={base_img.size}, edited={edited_img.size}')
    edited_img = edited_img.resize(base_img.size)

# Mask out the edit zone from BOTH then diff
zone_mask = Image.new('L', base_img.size, 255)  # white = include
ImageDraw.Draw(zone_mask).rectangle(ZONE, fill=0)  # black = exclude (the edit zone)

# Compute pixel diff outside the zone
diff = ImageChops.difference(base_img.convert('RGB'), edited_img.convert('RGB'))
# Apply zone_mask to diff (keep only outside-zone pixels)
diff_outside = Image.composite(diff, Image.new('RGB', base_img.size, (0,0,0)), zone_mask)
diff_outside.save(OUT / 'diff-outside-zone.png')

# Compute average diff magnitude outside zone
import numpy as np
arr = np.array(diff_outside)
nonzero = arr.sum(axis=2) > 0  # any channel changed
outside_total = (np.array(zone_mask) > 0).sum()  # total outside pixels
changed_outside = nonzero.sum()
pct_changed = 100.0 * changed_outside / outside_total

# Inside the zone, expect lots of changes
inside_arr = np.array(ImageChops.difference(base_img.convert('RGB'), edited_img.convert('RGB')))
inside_mask = np.array(ImageDraw.Draw(Image.new('L', base_img.size, 0)).rectangle(ZONE, fill=255) or Image.new('L', base_img.size, 0))
# Simpler: directly check
zone_arr = np.array(zone_mask) == 0  # inside zone
inside_diff = inside_arr.sum(axis=2)[zone_arr]
inside_changed_pct = 100.0 * (inside_diff > 0).sum() / inside_diff.size

print(f'\n=== Drift Analysis ===')
print(f'Edit zone: {ZONE} (≈ {((ZONE[2]-ZONE[0])*(ZONE[3]-ZONE[1]))/W/H*100:.1f}% of canvas)')
print(f'Pixels outside zone CHANGED: {changed_outside:,} / {outside_total:,} ({pct_changed:.2f}%)')
print(f'Pixels inside zone CHANGED:  {inside_diff.size:,} → {(inside_diff>0).sum():,} ({inside_changed_pct:.2f}%)')
print()
if pct_changed < 0.5:
    print('VERDICT: ✅ MASK PRESERVATION WORKS — drift is negligible (<0.5%)')
elif pct_changed < 5.0:
    print('VERDICT: ⚠️  MINOR DRIFT — usable but visible to careful child')
else:
    print('VERDICT: ❌ MASK DOES NOT PRESERVE — drift is significant')
