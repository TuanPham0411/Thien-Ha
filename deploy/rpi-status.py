#!/usr/bin/env python3
"""Read-only physical Pi console: no accounts, credentials or ticket data."""
import datetime, fcntl, json, os, shutil, signal, socket, struct, subprocess, sys, threading, time, urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo
SERVICES=('th-app.service','nginx.service','postgresql.service','cloudflared.service')

def activate(number):
    with open('/dev/tty0','rb',buffering=0) as console:fcntl.ioctl(console,0x5606,number)

def read(path,default=''):
    try:return Path(path).read_text().strip()
    except OSError:return default

def services():
    try:
        result=subprocess.run(['systemctl','show',*SERVICES,'--property=Id,ActiveState'],capture_output=True,text=True,timeout=2,check=True)
        output={}
        for block in result.stdout.strip().split('\n\n'):
            fields=dict(line.split('=',1) for line in block.splitlines() if '=' in line)
            if fields.get('Id'):output[fields['Id']]=fields.get('ActiveState','unknown')
        return output
    except (OSError,subprocess.SubprocessError):return {}

def health():
    started=time.monotonic()
    try:
        request=urllib.request.Request('http://127.0.0.1:3000/api/health',headers={'Host':'mes.th.io.vn'})
        with urllib.request.urlopen(request,timeout=1.5) as response:okay=response.status==200 and json.loads(response.read(1024)).get('ok') is True
        return ('OK' if okay else 'FAILED')+f' ({round((time.monotonic()-started)*1000)} ms)'
    except (OSError,ValueError):return 'UNREACHABLE'

def network():
    output=[]
    for name in ('eth0','wlan0'):
        if read('/sys/class/net/'+name+'/operstate')!='up':continue
        try:
            with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as connection:address=socket.inet_ntoa(fcntl.ioctl(connection.fileno(),0x8915,struct.pack('256s',name.encode()))[20:24])
            output.append(name+' '+address)
        except OSError:output.append(name+' up')
    return ', '.join(output) or 'No Ethernet / Wi-Fi link'

def frame(states,api,net):
    now=datetime.datetime.now(ZoneInfo('Asia/Ho_Chi_Minh')).strftime('%Y-%m-%d %H:%M:%S %Z')
    lines=['TH MES - RASPBERRY PI SERVER',now,'='*62,'API + database: '+api,'']
    for service in SERVICES:
        state=states.get(service,'unknown');lines.append(f'[{"OK" if state=="active" else "!!":2}] {service.removesuffix(".service"):14} {state}')
    memory={line.split(':')[0]:int(line.split()[1]) for line in read('/proc/meminfo').splitlines() if line.startswith(('MemTotal:','MemAvailable:'))}
    total=memory.get('MemTotal',0);available=memory.get('MemAvailable',0)
    disk=shutil.disk_usage('/var/lib/th-app' if Path('/var/lib/th-app').exists() else '/')
    temperature=read('/sys/class/thermal/thermal_zone0/temp');temperature=f'{int(temperature)/1000:.1f} C' if temperature.isdigit() else 'unknown'
    uptime=int(float(read('/proc/uptime','0').split()[0]))
    lines+=['',f'CPU load (1m): {os.getloadavg()[0]:.2f} | Temperature: {temperature}',f'RAM: {(total-available)//1024} / {total//1024} MiB | Uptime: {uptime//3600}h {(uptime//60)%60}m',f'Storage: {disk.free/2**30:.1f} / {disk.total/2**30:.1f} GiB free','Network: '+net,'','Refresh: 5s | Ctrl+Alt+F1: normal login console','Read-only status. No passwords or ticket contents shown.']
    width=max(40,min(shutil.get_terminal_size((80,25)).columns,120))
    return '\n'.join(line[:width-1] for line in lines)

def main():
    if '--active' in sys.argv:
        with open('/dev/tty0','rb',buffering=0) as console:state=fcntl.ioctl(console,0x5603,struct.pack('HHH',0,0,0))
        print('Active virtual console:',struct.unpack('HHH',state)[0]);return
    if '--activate' in sys.argv:activate(8);return
    if '--deactivate' in sys.argv:activate(1);return
    once='--once' in sys.argv;stopped=threading.Event()
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:stopped.set())
    if not once:sys.stdout.write('\033[2J\033[?25l')
    try:
        while not stopped.is_set():
            print(('' if once else '\033[H')+frame(services(),health(),network())+('' if once else '\033[J'),flush=True)
            if once:break
            stopped.wait(5)
    finally:
        if not once:sys.stdout.write('\033[?25h');sys.stdout.flush()
if __name__=='__main__':main()
