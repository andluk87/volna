"""Add TURN settings without executing or rewriting existing environment values."""
from pathlib import Path
import ipaddress,os,re,secrets,socket
p=Path('.env');text=p.read_text();values={}
for line in text.splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        k,v=line.split('=',1);values[k.strip()]=v.strip().strip('\"\'')
host=values.get('TURN_HOST') or values.get('CHAT_DOMAIN') or 'volna.lknet.ru'
if not re.fullmatch(r'[a-zA-Z0-9.-]+',host):raise SystemExit('TURN_HOST должен быть доменом без https:// и пути')
external=values.get('TURN_EXTERNAL_IP') or socket.gethostbyname(host)
if not ipaddress.IPv4Address(external).is_global:raise SystemExit('Для TURN нужен публичный IPv4. Укажите TURN_EXTERNAL_IP в .env')
secret=values.get('TURN_SECRET') or secrets.token_hex(32)
if not re.fullmatch(r'[a-fA-F0-9]{64}',secret):raise SystemExit('TURN_SECRET должен состоять из 64 шестнадцатеричных символов')
new={'TURN_HOST':host,'TURN_EXTERNAL_IP':external,'TURN_SECRET':secret}
lines=[line for line in text.splitlines() if line.split('=',1)[0].strip() not in new]
updated='\n'.join(lines)+'\n\n# Volna audio calls\n'+''.join(f'{k}={v}\n' for k,v in new.items())
# Retain the existing file; never include its contents in output.
temporary=p.with_name('.env.calls.tmp')
fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
try:
    with os.fdopen(fd,'w') as f:f.write(updated);f.flush();os.fsync(f.fileno())
    os.replace(temporary,p)
finally:
    temporary.unlink(missing_ok=True)
print('Настройки звонков сохранены для '+host+'. HTTPS и параметры базы сохранены.')
