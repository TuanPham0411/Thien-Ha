#!/usr/bin/env python3
"""Pi-only, local Unix-socket broker. NetworkManager owns rollback checkpoints."""
import grp
import json
import os
from pathlib import Path
import pwd
import re
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler
from socketserver import UnixStreamServer, ThreadingMixIn

SOCKET='/run/th-wifi/control.sock'
NM='org.freedesktop.NetworkManager'
ROOT='/org/freedesktop/NetworkManager'
pending=None
lock=threading.RLock()

def run(args,timeout=15):
    return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,timeout=timeout).stdout.strip()

def is_pi():
    try:return 'Raspberry Pi' in Path('/proc/device-tree/model').read_text()
    except OSError:return False

def nm(method,signature,*args):
    value=run(['busctl','--system','--json=short','call',NM,ROOT,NM,method,signature,*args])
    return json.loads(value)['data']

def interface():
    devices=run(['nmcli','--terse','--escape','no','--fields','DEVICE,TYPE','device','status'])
    for line in devices.splitlines():
        name,_,kind=line.partition(':')
        if kind=='wifi' and re.fullmatch(r'[A-Za-z0-9_.-]{1,32}',name):return name
    raise ValueError('No NetworkManager Wi-Fi interface is available.')

def status():
    global pending
    if not is_pi():return {'available':False,'reason':'Wi-Fi settings are available only on Raspberry Pi.'}
    try:
        device=interface()
        state=run(['nmcli','--get-values','GENERAL.STATE','device','show',device])
        address=run(['nmcli','--get-values','IP4.ADDRESS','device','show',device])
        connection=run(['nmcli','--get-values','GENERAL.CONNECTION','device','show',device])
    except (OSError,subprocess.SubprocessError,ValueError):return {'available':False,'reason':'NetworkManager Wi-Fi management is unavailable.'}
    with lock:
        if pending and time.time()>=pending['deadline']:pending=None
        return {'available':True,'interface':device,'connection':connection,'address':address,'connected':state.startswith('100'),'pending':{'id':pending['id'],'ssid':pending['ssid'],'deadline':pending['deadline']} if pending else None}

def validate(data):
    ssid=data.get('ssid');password=data.get('password');security=data.get('security','wpa-psk')
    if not isinstance(ssid,str) or not 1<=len(ssid.encode())<=32 or any(ord(c)<32 or ord(c)==127 for c in ssid):raise ValueError('Enter a valid Wi-Fi name (1–32 bytes).')
    if security not in ('wpa-psk','sae'):raise ValueError('Choose WPA2 or WPA3 security.')
    if not isinstance(password,str) or not 8<=len(password.encode())<=63 or any(ord(c)<32 or ord(c)==127 for c in password):raise ValueError('Enter a Wi-Fi password of 8–63 bytes.')
    return ssid,password,security

def connect(data):
    global pending
    ssid,password,security=validate(data)
    if not status().get('available'):raise ValueError('Wi-Fi management is unavailable on this host.')
    with lock:
        if pending:raise ValueError('Confirm the pending Wi-Fi change or wait for rollback.')
        device=interface()
        path=run(['nmcli','--get-values','GENERAL.DBUS-PATH','device','show',device])
        if not re.fullmatch(r'/org/freedesktop/NetworkManager/Devices/[0-9]+',path):raise ValueError('Wi-Fi device unavailable.')
        deadline=time.time()+120
        checkpoint=nm('CheckpointCreate','aouu','1',path,'120','2')[0]
        if not re.fullmatch(r'/org/freedesktop/NetworkManager/Checkpoint/[0-9]+',checkpoint):raise ValueError('Automatic rollback is unavailable.')
        ident=str(uuid.uuid4());profile=Path('/etc/NetworkManager/system-connections')/('th-mes-'+ident+'.nmconnection')
        # Keyfile stays root-only; an unconfirmed profile is deleted by NM rollback.
        # SSID bytes avoid keyfile escaping ambiguities; PSK backslashes are escaped.
        escaped=password.replace('\\','\\\\').replace(' ','\\s')
        content=f'[connection]\nid=TH Wi-Fi {ident}\nuuid={ident}\ntype=wifi\ninterface-name={device}\nautoconnect=false\n[wifi]\nssid={";".join(str(b) for b in ssid.encode())};\nmode=infrastructure\n[wifi-security]\nkey-mgmt={security}\npsk={escaped}\n[ipv4]\nmethod=auto\n[ipv6]\nmethod=auto\n'
        try:
            with profile.open('x') as output:os.chmod(profile,0o600);output.write(content)
            run(['nmcli','connection','load',str(profile)])
            pending={'id':ident,'ssid':ssid,'checkpoint':checkpoint,'deadline':deadline}
        except Exception:
            profile.unlink(missing_ok=True)
            nm('CheckpointRollback','o',checkpoint)
            raise
        def activate():
            try:run(['nmcli','--wait','40','connection','up','uuid',ident],timeout=45)
            except (OSError,subprocess.SubprocessError):
                with lock:
                    if pending and pending['id']==ident:
                        try:nm('CheckpointRollback','o',checkpoint)
                        except (OSError,subprocess.SubprocessError):pass
        threading.Thread(target=activate,daemon=True).start()
        return {'id':ident,'deadline':pending['deadline']}

def confirm(data):
    global pending
    with lock:
        if not pending or data.get('id')!=pending['id'] or time.time()>=pending['deadline']:raise ValueError('Wi-Fi confirmation expired. The previous connection is restored automatically.')
        device=interface()
        active=run(['nmcli','--get-values','GENERAL.CON-UUID','device','show',device])
        if active!=pending['id'] or not status().get('connected'):raise ValueError('The new Wi-Fi connection is not active yet.')
        # Save the confirmed profile persistently before committing the checkpoint.
        run(['nmcli','connection','modify','uuid',active,'connection.autoconnect','yes','connection.autoconnect-priority','100'])
        nm('CheckpointDestroy','o',pending['checkpoint'])
        pending=None
        return {'ok':True}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=2048:raise ValueError('Invalid request size.')
            data=json.loads(self.rfile.read(length))
            action=data.get('action');payload=data.get('data',{})
            if not isinstance(payload,dict):raise ValueError('Invalid request.')
            if action not in ('status','connect','confirm'):raise ValueError('Unsupported Wi-Fi operation.')
            result={'status':status,'connect':lambda:connect(payload),'confirm':lambda:confirm(payload)}[action]()
            code=200
        except ValueError as error:result={'error':str(error)};code=409
        except Exception:result={'error':'Wi-Fi operation failed. NetworkManager restores unconfirmed changes automatically.'};code=409
        body=json.dumps(result).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

class Server(ThreadingMixIn,UnixStreamServer):daemon_threads=True
if __name__=='__main__':
    import sys
    if '--status' in sys.argv:
        print(json.dumps(status()))
        raise SystemExit(0)
    Path(SOCKET).unlink(missing_ok=True)
    server=Server(SOCKET,Handler);os.chown(SOCKET,pwd.getpwnam('thapp').pw_uid,grp.getgrnam('thapp').gr_gid);os.chmod(SOCKET,0o600);server.serve_forever()
