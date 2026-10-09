#!/usr/bin/env python3
"""Verify Windows Docker output before atomically publishing the download and feed."""
import base64, hashlib, json, re, shutil, struct
from pathlib import Path
root=Path.cwd();version=json.loads((root/'package.json').read_text())['version']
if version!=json.loads((root/'client/package.json').read_text())['version'] or not re.fullmatch(r'\d+\.\d+\.\d+',version):raise SystemExit('Windows source versions are inconsistent.')
release=root/'artifacts/windows-release'/version;info=json.loads((release/'release-info.json').read_text());name=info.get('installer','')
if info.get('version')!=version or name!=f'Volna-Setup-{version}.exe':raise SystemExit('Windows builder output is from another version.')
binary=(release/name).read_bytes();offset=struct.unpack_from('<I',binary,60)[0] if len(binary)>=64 else 0
if len(binary)<1_000_000 or binary[:2]!=b'MZ' or offset<64 or offset>len(binary)-24 or binary[offset:offset+4]!=b'PE\0\0':raise SystemExit('Windows builder output is not a valid PE executable.')
sha512=base64.b64encode(hashlib.sha512(binary).digest()).decode()
if info.get('size')!=len(binary) or info.get('sha512')!=sha512 or info.get('sha256')!=hashlib.sha256(binary).hexdigest():raise SystemExit('Windows installer checksum/size mismatch.')
metadata=(release/'latest.yml').read_text();values=lambda key:re.findall(r'^\s*(?:-\s+)?'+key+r':\s*(\S+)\s*$',metadata,re.M)
if len(metadata)>64_000 or values('version')!=[version] or values('url')!=[name] or values('path')!=[name] or values('size')!=[str(len(binary))] or values('sha512')!=[sha512,sha512]:raise SystemExit('Windows update feed does not match the verified installer.')
if not (release/(name+'.blockmap')).stat().st_size:raise SystemExit('Windows update blockmap is missing.')
public=root/'client/public/download';feed=public/'windows';feed.mkdir(parents=True,exist_ok=True)
def copy(source,destination):
    tmp=destination.with_name(destination.name+'.tmp');shutil.copyfile(source,tmp);tmp.chmod(0o644);tmp.replace(destination)
for filename in [name,name+'.blockmap']:copy(release/filename,feed/filename)
copy(release/name,public/'volna-windows.exe');copy(release/'latest.yml',feed/'latest.yml')
print(f'Published Windows {version}: download and update feed.')
