#!/usr/bin/env python3
"""Build the shared Android/Web/Windows bitmap font from pinned Telegram atlases.
Developer tool: requires Pillow, fontTools and libharfbuzz. Production builds use
its checked-in output and do not download or regenerate artwork.
"""
import argparse,ctypes,ctypes.util,hashlib,io,json,re,urllib.request
from pathlib import Path
from PIL import Image
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import otTables
TDESKTOP='a7f453612f4896ac04d0007a36ab0d377e5bcbcf'
LIB_UI='79c846fdf0327ff99d3efdc1cc4e11ef50bedc6d'
NOTO='8998f5dd683424a73e2314a8c1f1e359c19e8742'
FAMILY='Volna Telegram Emoji'
TONES='🏻🏼🏽🏾🏿'
def bare(s):return s.replace('\ufe0f','')
def digest(data):return hashlib.sha256(data).hexdigest()
class Shaper:
    def __init__(self,path):
        h=ctypes.CDLL(ctypes.util.find_library('harfbuzz'));P=ctypes.c_void_p;U=ctypes.c_uint;I=ctypes.c_int;S=ctypes.c_char_p
        def bind(n,r,args):f=getattr(h,n);f.restype=r;f.argtypes=args;return f
        class Info(ctypes.Structure):_fields_=[('codepoint',U),('mask',U),('cluster',U),('var1',U),('var2',U)]
        blob=bind('hb_blob_create',P,[S,U,I,P,P]);face=bind('hb_face_create',P,[P,U]);font=bind('hb_font_create',P,[P]);ot=bind('hb_ot_font_set_funcs',None,[P])
        data=Path(path).read_bytes();self.font=font(face(blob(data,len(data),0,None,None),0));ot(self.font)
        self.create=bind('hb_buffer_create',P,[]);self.add=bind('hb_buffer_add_utf8',None,[P,S,I,U,I]);self.guess=bind('hb_buffer_guess_segment_properties',None,[P]);self.shape=bind('hb_shape',None,[P,P,P,U]);self.info=bind('hb_buffer_get_glyph_infos',ctypes.POINTER(Info),[P,ctypes.POINTER(U)]);self.destroy=bind('hb_buffer_destroy',None,[P]);self.U=U
    def __call__(self,text):
        b=self.create();data=text.encode();self.add(b,data,len(data),0,len(data));self.guess(b);self.shape(self.font,b,None,0);n=self.U();info=self.info(b,ctypes.byref(n));result=[info[i].codepoint for i in range(n.value)];self.destroy(b);return result

def build(cache,output,catalog):
    cache.mkdir(parents=True,exist_ok=True);sources={}
    def fetch(name,url):
        path=cache/name
        if not path.exists():urllib.request.urlretrieve(url,path)
        sources[name]={'url':url,'sha256':digest(path.read_bytes())};return path
    table=fetch('emoji.txt',f'https://raw.githubusercontent.com/desktop-app/lib_ui/{LIB_UI}/emoji.txt').read_text()
    sections=re.split(r'^=+\s*$',table,flags=re.M);entries=[];index={}
    # The fully expanded section has the same order as appendCategory. Telegram
    # aliases Clipperton to France; it occupies no additional sprite cell.
    for section in [sections[0],sections[3]]:
        for text in re.findall(r'"([^"]+)"',section):
            key=bare(text)
            if key in index:continue
            index[key]=len(entries);entries.append(text)
            if key=='🇫🇷':index['🇨🇵']=index[key]
    assert len(entries)==3900,'Pinned Telegram ordering changed'
    sheets=[Image.open(fetch(f'emoji_{i}.webp',f'https://raw.githubusercontent.com/telegramdesktop/tdesktop/{TDESKTOP}/Telegram/Resources/emoji/emoji_{i}.webp')).convert('RGBA') for i in range(1,9)]
    for i,sheet in enumerate(sheets):assert sheet.size==(2304,1152 if i<7 else 720)
    font_path=fetch('NotoColorEmoji.ttf',f'https://raw.githubusercontent.com/googlefonts/noto-emoji/{NOTO}/fonts/NotoColorEmoji.ttf')
    license_path=fetch('FONT-LICENSE.txt',f'https://raw.githubusercontent.com/googlefonts/noto-emoji/{NOTO}/fonts/LICENSE')
    gpl=fetch('TELEGRAM-LICENSE.txt',f'https://raw.githubusercontent.com/telegramdesktop/tdesktop/{TDESKTOP}/LICENSE')
    font=TTFont(font_path,recalcTimestamp=False);shape=Shaper(font_path);order=font.getGlyphOrder();by_glyph={};aliases={}
    for i,text in enumerate(entries):
        glyphs=shape(text)
        if len(glyphs)==1 and glyphs[0]:by_glyph[order[glyphs[0]]]=i
    # Unicode canonical short forms are equivalent to Telegram's same-tone ZWJs.
    extra_ligatures=[]
    for short,middle in [('💑','❤️'),('💏','❤️\u200d💋')]:
        for tone in TONES:
            extended=f'🧑{tone}\u200d{middle}\u200d🧑{tone}';canonical=short+tone
            glyph=order[shape(canonical)[0]];by_glyph[glyph]=index[bare(extended)];aliases[extended]=canonical
            extra_ligatures.append((extended,glyph))
    families={'🧑\u200d🧑\u200d🧒':'👪','🧑\u200d🧑\u200d🧒\u200d🧒':'👨\u200d👩\u200d👧\u200d👦','🧑\u200d🧒':'👩\u200d👦','🧑\u200d🧒\u200d🧒':'👩\u200d👧\u200d👦'}
    def resolve(text):
        key=bare(text)
        if key in index:return index[key]
        if text[:1] in ['🏂','🛌'] and len(text)==2 and text[1] in TONES:return index[text[0]]
        if text[:1] in ['💑','💏'] and len(text)==2 and text[1] in TONES:
            middle='❤️' if text[0]=='💑' else '❤️\u200d💋';return index[bare(f'🧑{text[1]}\u200d{middle}\u200d🧑{text[1]}')]
        if key in families:return index[bare(families[key])]
        if re.fullmatch('🧑[🏻-🏿]?\u200d🤝\u200d🧑[🏻-🏿]?',key):
            tones=[c for c in key if c in TONES]
            variant='👫' if not tones else '👫'+tones[0] if tones[0]==tones[1] else f'👩{tones[0]}\u200d🤝\u200d👨{tones[1]}'
            return index[bare(variant)]
        return None
    if catalog is not None:
        data=json.loads(catalog.read_text())
    else:
        raw=fetch('emoji-test.txt','https://unicode.org/Public/17.0.0/emoji/emoji-test.txt').read_text()
        data={'entries':[{'text':''.join(chr(int(point,16)) for point in match.group(1).split())} for line in raw.splitlines() if (match:=re.match(r'^([0-9A-F ]+)\s*;\s*(?:fully-qualified|component)\s*#',line))]}
    available=[];compatibility={};unsupported=[]
    for entry in data['entries']:
        text=entry['text'];sprite=resolve(text)
        if sprite is None:unsupported.append(text);continue
        glyphs=shape(text);assert len(glyphs)==1 and glyphs[0],text
        by_glyph[order[glyphs[0]]]=sprite;available.append(text)
        if bare(text) not in index:compatibility[text]=entries[sprite]
    assert len(unsupported)==12,unsupported
    # Add the ten equivalent ZWJs to the first ligature lookup, before simple
    # person + skin-tone substitutions. Existing shaping tables otherwise stay.
    cmap=font.getBestCmap();ligatures=font['GSUB'].table.LookupList.Lookup[0].SubTable[0].ligatures
    for text,glyph in extra_ligatures:
        parts=[cmap[ord(c)] for c in bare(text)];lig=otTables.Ligature();lig.LigGlyph=glyph;lig.Component=parts[1:];lig.CompCount=len(parts);ligatures.setdefault(parts[0],[]).insert(0,lig)
    for values in ligatures.values():values.sort(key=lambda l:-l.CompCount)
    pngs={}
    def png(sprite):
        if sprite not in pngs:
            local=sprite%512;x=(local%32)*72;y=(local//32)*72;image=sheets[sprite//512].crop((x,y,x+72,y+72));b=io.BytesIO();image.save(b,format='PNG',optimize=True);pngs[sprite]=b.getvalue()
        return pngs[sprite]
    blank=io.BytesIO();Image.new('RGBA',(72,72)).save(blank,format='PNG');fallback=index['❓']
    # Every bitmap is replaced. No pixels from Noto are retained, including
    # unlisted component glyphs. Noto supplies Unicode shaping metadata only.
    for name,bitmap in font['CBDT'].strikeData[0].items():
        metrics=bitmap.metrics  # force lazy decompilation before replacing pixels
        bitmap.imageData=png(by_glyph.get(name,fallback)) if font['hmtx'].metrics[name][0] else blank.getvalue()
        bitmap.metrics.width=bitmap.metrics.height=bitmap.metrics.Advance=72;bitmap.metrics.BearingX=0;bitmap.metrics.BearingY=57
    strike=font['CBLC'].strikes[0].bitmapSizeTable;strike.ppemX=strike.ppemY=72
    for metrics in [strike.hori,strike.vert]:metrics.ascender=57;metrics.descender=-15;metrics.widthMax=72;metrics.minOriginSB=metrics.minAdvanceSB=0;metrics.maxBeforeBL=57;metrics.minAfterBL=-15
    em=font['head'].unitsPerEm
    for name,(advance,bearing) in font['hmtx'].metrics.items():font['hmtx'].metrics[name]=(em if advance else 0,0)
    font['hhea'].ascent=round(em*57/72);font['hhea'].descent=-round(em*15/72);font['hhea'].lineGap=0
    os2=font['OS/2'];os2.sTypoAscender=font['hhea'].ascent;os2.sTypoDescender=font['hhea'].descent;os2.sTypoLineGap=0;os2.usWinAscent=os2.sTypoAscender;os2.usWinDescent=-os2.sTypoDescender
    for record in font['name'].names:
        if record.nameID in [1,3,4,6,16,17]:
            value='Regular' if record.nameID==17 else FAMILY.replace(' ','') if record.nameID==6 else FAMILY
            record.string=value.encode(record.getEncoding())
        elif record.nameID in [5,10,13,14]:
            value={5:'Version 1.000; Telegram Desktop '+TDESKTOP[:12],10:'Telegram Desktop atlas artwork with Noto Unicode shaping metadata; see NOTICE.txt.',13:'Unicode shaping metadata: SIL Open Font License 1.1. Bitmap artwork: Telegram Desktop repository, GNU GPL version 3. See bundled NOTICE.txt and license files.',14:'https://github.com/andluk87/volna/blob/v0.12.66/client/public/site/emoji/NOTICE.txt'}[record.nameID]
            record.string=value.encode(record.getEncoding())

    output.mkdir(parents=True,exist_ok=True);font_file=output/'TelegramEmoji.ttf';font.save(font_file)
    verify=Shaper(font_file)
    for text in available+list(aliases):assert len(verify(text))==1,text
    manifest={'artwork':'Telegram Desktop','tdesktop_commit':TDESKTOP,'lib_ui_commit':LIB_UI,'shaping_metadata_noto_commit':NOTO,'sprites':len(entries),'supported_sequences':len(available),'font_sha256':digest(font_file.read_bytes()),'sources':sources,'compatibility':compatibility,'text_components':unsupported,'aliases':aliases}
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');(output/'supported.json').write_text(json.dumps(available,ensure_ascii=False)+'\n')
    (output/'TELEGRAM-LICENSE.txt').write_bytes(gpl.read_bytes());(output/'SHAPING-LICENSE.txt').write_bytes(license_path.read_bytes())
    (output/'NOTICE.txt').write_text(f'Telegram Desktop emoji artwork: https://github.com/telegramdesktop/tdesktop/tree/{TDESKTOP}/Telegram/Resources/emoji\nUnicode shaping tables derived from Google Noto Color Emoji ({NOTO}), SIL Open Font License 1.1; reserved family name changed. All bitmap artwork has been replaced by Telegram atlas cells.\nSee TELEGRAM-LICENSE.txt, SHAPING-LICENSE.txt and manifest.json for pinned source provenance.\n')
    points=sorted(set(p for p in font.getBestCmap() if p>127)|{0x200D,0xFE0F,0x20E3});ranges=[]
    for point in points:
        if ranges and point==ranges[-1][1]+1:ranges[-1][1]=point
        else:ranges.append([point,point])
    unicode_range=','.join(f'U+{a:X}'+(f'-{b:X}' if b!=a else '') for a,b in ranges)
    css='/* Telegram artwork font; see NOTICE.txt and manifest.json. */\n'
    for family,limited in [(FAMILY,True),(FAMILY+' Full',False)]:
        css+=f'@font-face{{font-family:"{family}";src:url("TelegramEmoji.ttf") format("truetype");font-display:swap;font-style:normal;font-weight:100 900;'+(f'unicode-range:{unicode_range};' if limited else '')+'}\n'
    (output/'font.css').write_text(css)
    default_output=Path(__file__).resolve().parents[1]/'client/public/site/emoji'
    if output.resolve()==default_output.resolve():
        source_css=css.replace('url("TelegramEmoji.ttf")','url("/site/emoji/TelegramEmoji.ttf")')+"""body{font-family:window-emoji,var(--app-font)}
.emoji-panel .unicode-choice,.message-quick-reactions>button:not(.reaction-expand),.quick-emoji-grid>button,.message-reactions>button>span:first-child,.telegram-emoji-full{font-family:window-emoji-full,sans-serif}
code,pre{font-family:window-emoji,\"Cascadia Code\",Consolas,monospace}
.telegram-text-component{font-family:var(--plain-app-font,Arial),sans-serif;font-variant-emoji:text}
"""
        source_css=source_css.replace('window-emoji-full','"'+FAMILY+' Full"').replace('window-emoji','"'+FAMILY+'"')
        (Path(__file__).resolve().parents[1]/'client/src/telegram-emoji.css').write_text(source_css)

    # Static assets must remain readable by the unprivileged Web server.
    output.chmod(0o755)
    for resource in output.iterdir():
        if resource.is_file():resource.chmod(0o644)
    print(f'Telegram emoji: {len(entries)} sprites, {len(available)} supported Unicode sequences, {font_file.stat().st_size} bytes')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--cache',type=Path,required=True);parser.add_argument('--catalog',type=Path);parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'client/public/site/emoji');args=parser.parse_args();build(args.cache,args.output,args.catalog)
