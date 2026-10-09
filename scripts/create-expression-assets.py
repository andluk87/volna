#!/usr/bin/env python3
"""Create Volna's original geometric sticker/GIF starter pack (Pillow, optional).
The generated assets are distributed with the project; rebuilding them is not
required by Docker. These are code-drawn icons, with no external GIF provider.
"""
from PIL import Image, ImageDraw
from pathlib import Path
import json
import math

root = Path(__file__).resolve().parents[1] / 'server/assets/expressions'
root.mkdir(parents=True, exist_ok=True)
scale = 3
size = 160
blue = (66, 155, 229)
ink = (20, 47, 76)

def scene(kind, phase=0.0, transparent=False):
    im = Image.new('RGBA', (size*scale, size*scale), (0,0,0,0) if transparent else (231, 241, 249, 255))
    d = ImageDraw.Draw(im)
    def box(coords): return tuple(int(v*scale) for v in coords)
    def ellipse(coords,fill,outline=None,width=1): d.ellipse(box(coords),fill,outline,width=width*scale)
    def line(points, fill, width=4): d.line([(int(x*scale), int(y*scale)) for x,y in points], fill=fill,width=width*scale,joint='curve')
    if kind in ('happy','wink','love','laugh','wow','sleep','sad','cool'):
        y = math.sin(phase*2*math.pi)*3
        ellipse((24,24+y,136,136+y),blue)
        if kind=='love':
            for x in (57,103):
                d.polygon([(int((x+dx)*scale),int((65+dy+y)*scale)) for dx,dy in [(-13,-2),(-9,-10),(0,-6),(9,-10),(13,-2),(0,12)]],fill=(255,128,162))
        elif kind=='cool':
            d.rounded_rectangle(box((39,53+y,74,77+y)),radius=6*scale,fill=ink)
            d.rounded_rectangle(box((86,53+y,121,77+y)),radius=6*scale,fill=ink)
            line([(73,62+y),(87,62+y)],ink)
        elif kind=='sleep':
            for x in (58,102): line([(x-8,65+y),(x+8,65+y)],ink,4)
        else:
            ellipse((50,57+y,64,74+y),ink)
            if kind=='wink': line([(94,66+y),(111,61+y)],ink)
            else: ellipse((96,57+y,110,74+y),ink)
        if kind=='wow': ellipse((68,91+y,92,119+y),ink)
        elif kind=='sad': d.arc(box((53,99+y,107,125+y)),180,360,fill=ink,width=5*scale)
        else: d.arc(box((47,69+y,113,119+y)),15,165,fill=ink,width=5*scale)
        if kind=='laugh': ellipse((77,105+y,88,119+y),(249,123,156))
    elif kind=='heart':
        gain=1+math.sin(phase*math.pi*2)*.07
        points=[(-48,-10),(-44,-29),(-25,-38),(0,-21),(25,-38),(44,-29),(48,-10),(42,9),(0,54),(-42,9)]
        d.polygon([(int((80+x*gain)*scale),int((73+y*gain)*scale)) for x,y in points],fill=(236,96,137))
    elif kind=='wave':
        for row in range(3):
            pts=[(15+x,56+row*24+math.sin(x/20+phase*math.pi*2+row)*9) for x in range(131)]
            line(pts,blue if row%2==0 else (105,120,222),7)
    elif kind=='sparkle':
        for cx,cy,r in [(80,76,40),(33,32,15),(130,126,17)]:
            r *= .85+math.sin(phase*math.pi*2+cx)*.15
            pts=[(cx+math.cos(a*math.pi/4-math.pi/2)*(r if a%2==0 else r/3),cy+math.sin(a*math.pi/4-math.pi/2)*(r if a%2==0 else r/3)) for a in range(8)]
            d.polygon([(int(x*scale),int(y*scale)) for x,y in pts],fill=(238,174,67))
    elif kind=='party':
        d.polygon([tuple(int(c*scale) for c in p) for p in [(30,136),(60,60),(105,109)]],fill=(111,118,223))
        for n in range(16):
            x=35+(n*43)%102; y=15+((n*23+int(phase*50))%76)
            ellipse((x,y,x+5,y+8),[(236,96,137),blue,(238,174,67)][n%3])
    return im.resize((size,size),Image.Resampling.LANCZOS)

names = {'happy':('Улыбка','улыбка радость привет хорошо'), 'wink':('Подмигнуть','подмигнуть ок wink'), 'love':('Любовь','любовь сердце нравишься'), 'laugh':('Смешно','смешно смех смеюсь'), 'wow':('Удивление','ого удивление вау'), 'sleep':('Спокойной ночи','сон ночь спать'), 'sad':('Грустно','грустно печаль'), 'cool':('Круто','круто очки cool'), 'heart':('Сердце','сердце любовь спасибо'), 'wave':('Волна','волна привет море'), 'sparkle':('Искры','искры магия звезда'), 'party':('Праздник','праздник поздравляю день рождения')}
items=[]
for kind,(name,keywords) in names.items():
    filename=kind+'.png';scene(kind,transparent=True).save(root/filename)
    items.append({'file':filename,'kind':'sticker','label':name,'keywords':keywords.split(),'mime':'image/png'})
for kind in ('heart','wave','sparkle','party','happy','wink','love','sleep'):
    frames=[scene(kind, i/18).convert('RGB') for i in range(18)]
    filename=kind+'.gif';frames[0].save(root/filename,save_all=True,append_images=frames[1:],duration=80,loop=0,optimize=True)
    name,keywords=names[kind]
    items.append({'file':filename,'kind':'gif','label':name,'keywords':keywords.split(),'mime':'image/gif'})
(root/'catalog.json').write_text(json.dumps(items,ensure_ascii=False,indent=2)+'\n')
# LICENSE.txt is distributed with the original artwork and is preserved on regeneration.
print(f'{len(items)} original starter assets, {sum(p.stat().st_size for p in root.iterdir())} bytes')
