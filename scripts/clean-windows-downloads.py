#!/usr/bin/env python3
"""Keep the current feed installer and one previous version; touch generated files only."""
import re
from pathlib import Path

def clean(root):
    feed=Path(root)/'client/public/download/windows'
    metadata=feed/'latest.yml'
    if not metadata.is_file():return 0
    text=metadata.read_text()
    versions=re.findall(r'^version:\s*[\'"]?(\d+\.\d+\.\d+)[\'"]?\s*$',text,re.M)
    if len(versions)!=1:raise ValueError('Invalid Windows feed version; no files removed')
    current=versions[0];name=f'Volna-Setup-{current}.exe'
    if not (feed/name).is_file():raise ValueError('Current Windows installer is missing; no files removed')
    paths=re.findall(r'^path:\s*(\S+)\s*$',text,re.M)
    if paths!=[name]:raise ValueError('Unexpected Windows feed path; no files removed')
    pattern=re.compile(r'Volna-Setup-(\d+\.\d+\.\d+)\.exe(?:\.blockmap)?')
    key=lambda value:tuple(map(int,value.split('.')))
    files=[(p,m[1]) for p in feed.iterdir() if p.is_file() and not p.is_symlink() and (m:=pattern.fullmatch(p.name))]
    previous=sorted({v for _,v in files if key(v)<key(current)},key=key)
    keep={current,*previous[-1:]}
    removed=0
    for path,version in files:
        if key(version)<key(current) and version not in keep:
            removed+=path.stat().st_size;path.unlink();print(f'Removed stale download: {path.name}')
    print(f'Windows download cleanup: {removed} bytes freed; current and previous versions retained.')
    return removed

if __name__=='__main__':clean(Path.cwd())
