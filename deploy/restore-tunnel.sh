#!/usr/bin/env bash
# Remove only the exact experimental drop-in created during this incident.
set -euo pipefail
[[ $(id -u) == 0 ]] || exit 1
config=/etc/systemd/system/cloudflared.service.d/50-th-transport.conf
if [[ ! -e $config ]]; then echo 'Original tunnel transport already active.'; exit 0; fi
backup=$(mktemp -d /run/th-tunnel-restore.XXXXXX)
chmod 700 "$backup"
trap 'rm -rf -- "$backup"' EXIT
cat > "$backup/expected" <<'CONF'
[Service]
Environment=TUNNEL_TRANSPORT_PROTOCOL=http2
Environment=TUNNEL_EDGE_IP_VERSION=4
CONF
cmp -s "$config" "$backup/expected" || { echo 'Transport drop-in differs from the experiment; it was retained.' >&2; exit 1; }
cp -a "$config" "$backup/previous"
restore(){ cp -a "$backup/previous" "$config"; systemctl daemon-reload; systemctl restart cloudflared; echo 'Original transport did not pass health checks; experimental drop-in restored.' >&2; }
trap restore ERR
started=$(date +%s)
rm -f "$config"
systemctl daemon-reload
systemctl restart cloudflared
registered=false
for _ in {1..20}; do
 count=$(journalctl -u cloudflared --since "@$started" --no-pager -o cat | grep -c 'Registered tunnel connection' || true)
 if [[ $count -ge 2 ]]; then registered=true; break; fi
 sleep 2
done
[[ $registered == true ]]
for host in th.io.vn mes.th.io.vn; do curl --fail --silent --show-error --max-time 20 "https://$host/api/health" >/dev/null; done
trap - ERR
echo 'Removed the experimental transport override; original tunnel configuration restored.'
