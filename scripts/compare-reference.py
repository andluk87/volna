#!/usr/bin/env python3
"""Compare supplied screenshots. Never fabricate missing reference or resize images."""
import argparse,json
from pathlib import Path
from PIL import Image,ImageChops,ImageStat
parser=argparse.ArgumentParser()
parser.add_argument('reference',type=Path);parser.add_argument('implementation',type=Path);parser.add_argument('--out',type=Path,required=True)
a=parser.parse_args()
with Image.open(a.reference) as f:reference=f.convert('RGB')
with Image.open(a.implementation) as f:implementation=f.convert('RGB')
if reference.size!=implementation.size:parser.error('Viewport mismatch: compare equal-sized screenshots without rescaling.')
a.out.mkdir(parents=True,exist_ok=True)
diff=ImageChops.difference(reference,implementation)
Image.blend(reference,implementation,.5).save(a.out/'overlay-50.png')
diff.save(a.out/'pixel-diff.png')
changed=sum(1 for rgb in diff.getdata() if max(rgb)>0)
result={'width':reference.width,'height':reference.height,'changed_pixels':changed,'changed_ratio':changed/(reference.width*reference.height),'mean_absolute_difference':ImageStat.Stat(diff).mean,'geometry_acceptance_verified':False}
(a.out/'metrics.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
