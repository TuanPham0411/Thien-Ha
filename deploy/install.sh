#!/usr/bin/env bash
# Install a GitHub-built release. Never invokes npm, compiler or changes tunnel/SSH.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run using sudo'; exit 1; }
if [[ ${1:-} == --check ]]; then exit 0; fi
if [[ ${1:-} == --inspect-routing ]]; then
  nginx -T 2>&1 | awk '/^# configuration file / || /^[[:space:]]*(listen|server_name|root)[[:space:]]/ {print}'
  python3 - <<'ROUTING'
from pathlib import Path
import re
from urllib.parse import urlparse
found=False
for path in [Path('/etc/cloudflared/config.yml'),Path('/etc/cloudflared/config.yaml'),Path('/home/thadmin/.cloudflared/config.yml')]:
 if not path.is_file(): continue
 found=True
 print('Tunnel config:',path)
 for line in path.read_text().splitlines():
  match=re.match(r'\s*(?:-\s*)?(hostname|service):\s*[\"\']?([^\"\'#]+)',line)
  if not match: continue
  key,value=match.groups();value=value.strip()
  if key=='hostname' and re.fullmatch(r'[a-zA-Z0-9.*_-]+',value): print('hostname:',value)
  elif key=='service':
   if re.fullmatch(r'http_status:[0-9]+',value): print('service:',value)
   else:
    parsed=urlparse(value)
    if parsed.scheme in ('http','https','ssh','tcp'): print('service:',parsed.scheme,parsed.hostname,parsed.port)
if not found: print('No local tunnel ingress file found at standard paths; dashboard-managed routing may be in use.')
ROUTING
  systemctl is-active ssh cloudflared nginx postgresql th-app
  exit 0
fi
release_source=$(realpath "${1:?Pass the extracted artifact directory}")
release_id=${2:?Pass a release ID}
[[ $release_id =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
[[ $(uname -m) == aarch64 ]] || { echo 'ARM64 is required'; exit 1; }
systemctl is-active --quiet postgresql nginx
for required in runtime/bin/node server/app.cjs server/migrate.cjs web/index.html mes/index.html deploy/th-app.service deploy/nginx.conf deploy/entrypoint.sh deploy/check-nginx.py deploy/storage-agent.py deploy/th-storage.service deploy/th-storage-mounts.service; do
 [[ -f "$release_source/$required" ]] || { echo "Missing $required"; exit 1; }
done
# Refuse overlapping host configuration; leave the existing sites untouched.
if ! nginx -T 2>&1 | python3 "$release_source/deploy/check-nginx.py"; then
 echo 'Existing Nginx configuration owns th.io.vn/mes.th.io.vn. Consolidate those host blocks before deploying.' >&2
 exit 1
fi
id thapp >/dev/null 2>&1 || useradd --system --home /var/lib/th-app --shell /usr/sbin/nologin thapp
install -d -m 755 /opt/th-app /opt/th-app/releases
install -d -m 700 /etc/th-app
install -d -o thapp -g thapp -m 700 /var/lib/th-app /var/lib/th-app/files
if [[ ! -f /etc/th-app/runtime.env ]]; then
 # Credential only travels over stdin to psql and is saved in a root-only file.
 python3 - <<'PY'
import secrets,subprocess
password=secrets.token_hex(32)
subprocess.run(['sudo','-u','postgres','psql','-v','ON_ERROR_STOP=1','-q'],input="CREATE ROLE th_api LOGIN PASSWORD '"+password+"';\nCREATE DATABASE th_app;\n",text=True,check=True)
with open('/etc/th-app/runtime.env','x') as f:
 f.write('DATABASE_URL=postgresql://th_api:'+password+'@127.0.0.1/th_app\nFILES_ROOT=/var/lib/th-app/files\nPORT=3000\nOWNER_EMAIL=eric.scorp93@gmail.com\nGOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=\nSMTP_URL=\nMAIL_FROM="TH <noreply@th.io.vn>"\n')
PY
 chmod 600 /etc/th-app/runtime.env
fi
# Copy immutable release first. A failed migration leaves current unchanged.
target="/opt/th-app/releases/$release_id"
[[ ! -e "$target" ]] || { echo 'Release already exists. Use a new release ID.'; exit 1; }
install -d -m 755 "$target"
cp -a "$release_source/." "$target/"
chown -R root:root "$target"
chmod -R a+rX "$target"
# Preserve live data before any migration. Files are immutable, so same-volume
# hardlinks preserve originals even when a live attachment is later deleted.
[[ ! -f /run/th-storage/backup-active ]] || { echo "USB backup is running; retry deployment after it finishes."; exit 1; }
was_running=false
if systemctl is-active --quiet th-app; then was_running=true; fi
trap 'if [[ $was_running == true ]]; then systemctl start th-app || true; fi' ERR
if [[ -f /opt/th-app/current/server/app.cjs ]]; then
 systemctl stop th-app
 python3 "$target/deploy/storage-agent.py" --pre-deploy
 before_records=$(sudo -u postgres psql -d th_app -At -c "select count(*)::text||':'||md5(coalesce(string_agg(collection||':'||id||':'||data::text,E'\n' order by collection,id),'')) from mes_private.records where collection='issues' or collection like 'issues/%/timeline'")
fi
sudo -u postgres env DATABASE_URL=postgresql:///th_app?host=/var/run/postgresql "$target/runtime/bin/node" "$target/server/migrate.cjs"
if [[ -n ${before_records:-} ]]; then
 after_records=$(sudo -u postgres psql -d th_app -At -c "select count(*)::text||':'||md5(coalesce(string_agg(collection||':'||id||':'||data::text,E'\n' order by collection,id),'')) from mes_private.records where collection='issues' or collection like 'issues/%/timeline'")
 [[ $before_records == "$after_records" ]] || { echo 'Ticket/history integrity check failed'; false; }
 echo 'Existing ticket content and timeline verified unchanged.'
fi
old_target=$(readlink -f /opt/th-app/current || true)
backup=$(mktemp -d /opt/th-app/.deploy-backup.XXXXXX)
[[ ! -f /etc/nginx/sites-available/th-app ]] || cp -a /etc/nginx/sites-available/th-app "$backup/nginx"
[[ ! -f /etc/systemd/system/th-app.service ]] || cp -a /etc/systemd/system/th-app.service "$backup/service"
[[ ! -f /etc/systemd/system/th-wifi.service ]] || cp -a /etc/systemd/system/th-wifi.service "$backup/wifi-service"
[[ ! -f /etc/systemd/system/th-storage.service ]] || cp -a /etc/systemd/system/th-storage.service "$backup/storage-service"
[[ ! -f /etc/systemd/system/th-storage-mounts.service ]] || cp -a /etc/systemd/system/th-storage-mounts.service "$backup/mount-service"
rollback() {
 if [[ -n $old_target && $old_target != /opt/th-app/current ]]; then
  ln -s "$old_target" /opt/th-app/.rollback
  mv -Tf /opt/th-app/.rollback /opt/th-app/current
 else rm -f /opt/th-app/current; fi
 if [[ -f $backup/nginx ]]; then cp -a "$backup/nginx" /etc/nginx/sites-available/th-app; else rm -f /etc/nginx/sites-enabled/th-app /etc/nginx/sites-available/th-app; fi
 if [[ -f $backup/service ]]; then cp -a "$backup/service" /etc/systemd/system/th-app.service; else systemctl stop th-app || true; rm -f /etc/systemd/system/th-app.service; fi
 if [[ -f $backup/storage-service ]]; then cp -a "$backup/storage-service" /etc/systemd/system/th-storage.service; else systemctl stop th-storage || true; rm -f /etc/systemd/system/th-storage.service; fi
 if [[ -f $backup/mount-service ]]; then cp -a "$backup/mount-service" /etc/systemd/system/th-storage-mounts.service; else systemctl disable --now th-storage-mounts || true; rm -f /etc/systemd/system/th-storage-mounts.service; fi
 if [[ -f $backup/wifi-service ]]; then cp -a "$backup/wifi-service" /etc/systemd/system/th-wifi.service; else systemctl disable --now th-wifi || true; rm -f /etc/systemd/system/th-wifi.service; fi
 systemctl daemon-reload
 if [[ -f $backup/wifi-service ]]; then systemctl restart th-wifi || true; fi
 if [[ -f $backup/storage-service ]]; then systemctl restart th-storage || true; fi
 if [[ -n $old_target && -f $backup/service ]]; then systemctl restart th-app || true; fi
 nginx -t && systemctl reload nginx
 echo 'Deployment failed; prior application configuration restored. Migrations were retained.' >&2
}
trap rollback ERR
install -m 644 "$target/deploy/th-storage-mounts.service" /etc/systemd/system/th-storage-mounts.service
install -m 644 "$target/deploy/th-storage.service" /etc/systemd/system/th-storage.service
install -m 644 "$target/deploy/th-wifi.service" /etc/systemd/system/th-wifi.service
install -m 644 "$target/deploy/th-app.service" /etc/systemd/system/th-app.service
install -m 644 "$target/deploy/nginx.conf" /etc/nginx/sites-available/th-app
ln -sfn /etc/nginx/sites-available/th-app /etc/nginx/sites-enabled/th-app
ln -s "$target" /opt/th-app/.next
mv -Tf /opt/th-app/.next /opt/th-app/current
nginx -t
systemctl daemon-reload
systemctl enable th-app th-storage th-storage-mounts th-wifi
systemctl restart th-wifi
systemctl restart th-storage-mounts
systemctl restart th-storage
systemctl restart th-app
healthy=false
for _ in {1..20}; do
 if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then healthy=true; break; fi
 sleep 1
done
[[ $healthy == true ]]
systemctl reload nginx
curl -fsS -H 'Host: th.io.vn' http://127.0.0.1/ >/dev/null
curl -fsS -H 'Host: mes.th.io.vn' http://127.0.0.1/ >/dev/null
curl -fsS -H 'Host: mes.th.io.vn' -H 'Content-Type: application/json' --data '{"name":"getDirectory"}' http://127.0.0.1/api/mes >/dev/null
systemctl is-active ssh cloudflared nginx postgresql th-app
# Future releases use this root-owned entrypoint with a dedicated sudo rule.
install -m 755 "$target/deploy/entrypoint.sh" /usr/local/sbin/th-deploy
printf '%s\n' 'thadmin ALL=(root) NOPASSWD: /usr/local/sbin/th-deploy *' > "$backup/sudoers"
visudo -cf "$backup/sudoers"
install -m 440 "$backup/sudoers" /etc/sudoers.d/th-app-deploy
trap - ERR
rm -rf "$backup"
# Keep current plus two older releases to limit use of the 32 GB card.
python3 - <<'PY'
from pathlib import Path
import shutil
current=Path('/opt/th-app/current').resolve()
others=sorted((p for p in Path('/opt/th-app/releases').iterdir() if p.is_dir() and p!=current),key=lambda p:p.stat().st_mtime,reverse=True)
for p in others[2:]: shutil.rmtree(p)
PY
lsblk -o NAME,TYPE,TRAN,RM,FSTYPE,SIZE,MOUNTPOINTS
python3 "$target/deploy/storage-agent.py" --status
# Dedicated physical console; keep normal login on VT1.
if [[ -c /dev/tty8 && -c /dev/tty0 ]]; then
 install -m 644 "$target/deploy/th-status.service" /etc/systemd/system/th-status.service
 systemctl daemon-reload
 systemctl enable th-status.service
 systemctl restart th-status.service
 systemctl is-active --quiet th-status.service
else
 echo 'No Linux virtual console found; physical status screen skipped.'
fi
echo 'Deployment healthy. Configure Google OAuth and SMTP in /etc/th-app/runtime.env if this is the first installation.'
