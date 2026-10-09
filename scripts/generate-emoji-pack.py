from pathlib import Path
from PIL import Image,ImageDraw
import json
p=Path('server/assets/emoji');p.mkdir(exist_ok=True)
labels=[('Радость','joy happy smile','😀'),('Смех','laugh funny lol','😂'),('Удивление','surprise wow','😮'),('Грусть','sad sorrow','😞'),('Плач','cry tears','😭'),('Злость','angry rage','😡'),('Раздражение','annoyed irritated','😤'),('Влюблённость','love heart','😍'),('Подмигивание','wink','😉'),('Смущение','shy blush','😊'),('Ирония','ironic upside down','🙃'),('Сонливость','sleep sleepy','😴'),('Задумчивость','think thoughtful','🤔'),('Восторг','excited amazing','🤩'),('Испуг','afraid scared','😨'),('Шок','shock mind blown','🤯'),('Подозрение','suspicious doubtful','🤨'),('Одобрение','yes approval good','👍'),('Несогласие','no disagree','👎'),('Благодарность','thanks thank you','🙏'),('Поздравление','congratulations party','🥳'),('Поддержка','support care hug','🤗'),('Приветствие','hello wave hi','👋'),('Прощание','bye goodbye','🫡')]
class ScaledDraw:
 def __init__(self,image): self.draw=ImageDraw.Draw(image)
 def shape(self,name,points,**kw):
  if 'width' in kw: kw['width']*=4
  scaled=[tuple(v*4 for v in point) for point in points] if isinstance(points[0],tuple) else tuple(v*4 for v in points)
  return getattr(self.draw,name)(scaled,**kw)
 def ellipse(self,p,**kw):return self.shape('ellipse',p,**kw)
 def line(self,p,**kw):return self.shape('line',p,**kw)
 def polygon(self,p,**kw):return self.shape('polygon',p,**kw)
 def arc(self,p,start,end,**kw):
  if 'width' in kw:kw['width']*=4
  return self.draw.arc(tuple(v*4 for v in p),start,end,**kw)
rows=[]
for i,(title,en,fallback) in enumerate(labels):
 im=Image.new('RGBA',(400,400));d=ScaledDraw(im);color='#ef826c' if i in [5,6] else '#b4d7df' if i==14 else '#c8b8e8' if i==15 else '#f6c86a';d.ellipse((8,8,92,92),fill=color,outline='#c28c43',width=2);ink='#3f455d';d.ellipse((19,46,32,54),fill='#efac76');d.ellipse((68,46,81,54),fill='#efac76')
 if i in [11,6,12]:
  for x in [32,62]:d.line((x-5,39,x+6,39),fill=ink,width=3)
 elif i in [2,14,15]:
  for x in [32,62]:d.ellipse((x-4,31,x+4,43),fill=ink)
 else:
  d.ellipse((28,31,35,42),fill=ink)
  if i in [8,23]:d.arc((56,32,70,46),180,360,fill=ink,width=3)
  else:d.ellipse((61,31,68,42),fill=ink)
 if i in [3,4,5,6,16,18]:d.arc((30,56,69,80),190,350,fill=ink,width=4)
 elif i in [2,14,15]:d.ellipse((42,56,58,77),fill=ink)
 elif i==11:d.ellipse((42,59,58,69),fill=ink)
 elif i==12:d.line((35,64,64,64),fill=ink,width=3);d.ellipse((56,65,73,85),fill='#f6c86a',outline=ink,width=2)
 else:d.arc((28,46,72,77),0,180,fill=ink,width=4)
 if i in [4,1]:d.polygon([(24,46),(17,64),(30,64)],fill='#70c9f1');d.ellipse((17,58,30,70),fill='#70c9f1')
 if i in [5,16]:d.line((25,25,39,30),fill=ink,width=3);d.line((59,30,73,25),fill=ink,width=3)
 if i in [7,13,19,21]:
  for x in [23,67]:d.polygon([(x,16),(x+4,23),(x+12,23),(x+6,28),(x+9,36),(x,31),(x-7,36),(x-5,27),(x-11,23),(x-3,22)],fill='#e66984')
 if i==0:d.arc((26,29,39,43),180,360,fill=ink,width=3);d.arc((60,29,74,43),180,360,fill=ink,width=3)
 if i==1:
  d.ellipse((31,54,70,77),fill=ink);d.line((36,58,65,58),fill='white',width=3)
  d.polygon([(77,46),(70,64),(83,64)],fill='#70c9f1');d.ellipse((70,58,83,70),fill='#70c9f1')
 if i==7:
  for x in [24,67]:
   d.polygon([(x-9,27),(x,36),(x+9,27),(x+9,20),(x+3,18),(x,22),(x-3,18),(x-9,20)],fill='#e66984')
 if i==9:
  d.ellipse((16,46,32,57),fill='#ec8f87');d.ellipse((68,46,84,57),fill='#ec8f87');d.arc((35,61,64,79),180,360,fill=ink,width=3)
 if i==10:im=im.rotate(180)
 if i==14:
  d.arc((25,21,40,33),190,330,fill=ink,width=3);d.arc((58,21,75,33),190,330,fill=ink,width=3);d.line((37,84,37,97),fill='#70bad6',width=4);d.line((65,84,65,97),fill='#70bad6',width=4)
 if i==15:
  d.polygon([(10,20),(19,2),(32,15),(43,1),(55,15),(69,1),(82,16),(96,6),(91,30)],fill='#ef826c',outline=ink,width=2)
 if i==16:d.line((24,24,40,31),fill=ink,width=4);d.arc((60,22,76,36),180,340,fill=ink,width=3)
 if i in [17,18]:
  points=[(72,68),(79,68),(82,51),(87,52),(86,69),(96,69),(96,84),(80,90),(72,86)]
  if i==18:points=[(x,140-y) for x,y in points]
  d.polygon(points,fill='#70bad6',outline=ink,width=2)
 if i==19:
  d.polygon([(33,83),(43,63),(50,74),(56,63),(68,83),(62,94),(40,94)],fill='#efac76',outline=ink,width=2);d.line((50,74,50,93),fill=ink,width=2)
 if i==21:
  d.arc((2,57,58,99),0,155,fill='#70bad6',width=8);d.arc((42,57,98,99),25,180,fill='#70bad6',width=8);d.ellipse((27,79,37,90),fill='#efac76');d.ellipse((63,79,73,90),fill='#efac76')
 if i==22:
  d.ellipse((73,54,94,83),fill='#efac76',outline=ink,width=2)
  for x,y in [(74,42),(80,36),(86,38),(92,44)]:d.line((x,y,x,66),fill='#efac76',width=4)
  d.arc((61,29,100,76),260,335,fill='#70bad6',width=2)
 if i==23:d.line((62,24,94,35),fill='#70bad6',width=8);d.ellipse((84,28,96,41),fill='#efac76',outline=ink,width=2)
 if i==20:d.polygon([(13,24),(19,1),(38,13)],fill='#8f7ecc');d.line((10,70,18,76),fill='#e66984',width=3)
 filename=f'{i+1:02d}.png';im.resize((100,100),Image.Resampling.LANCZOS).save(p/filename);rows.append({'file':filename,'title':title,'keywords':[title.lower(),*en.split()],'fallback':fallback})
(p/'catalog.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');(p/'STYLE.md').write_text('Волна · 24 геометрических статичных эмодзи\n\nХолст 100×100, RGBA, прозрачный фон. Палитра: #f6c86a, #3f455d, #e66984, #70c9f1. Простые круглые формы, тёплые лица, контур 2–4 px. Источник: scripts/generate-emoji-pack.py. Иллюстрации созданы программно из геометрических примитивов для этого проекта; сторонняя графика не использована.\n')
