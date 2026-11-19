#!/bin/zsh
set -euo pipefail
umask 077

script_dir=${0:A:h}
project_dir=${script_dir:h}
local_dir="$project_dir/.local"
agent_dir="$HOME/Library/LaunchAgents"
node_bin=$(command -v node)
cloudflared="$local_dir/bin/cloudflared"
password_file="$local_dir/demo-password.txt"
server_plist="$agent_dir/com.kanik.site-context-demo.plist"
tunnel_plist="$agent_dir/com.kanik.site-context-demo-tunnel.plist"
backup_plist="$agent_dir/com.kanik.site-context-demo-backup.plist"

[[ -x "$cloudflared" ]] || { print -u2 'Install cloudflared in .local/bin first.'; exit 1; }
[[ -x "$project_dir/.venv/bin/python" ]] || { print -u2 'Install the Python reader first.'; exit 1; }
mkdir -p "$local_dir" "$agent_dir"
if [[ ! -f "$password_file" ]]; then
  STUDIO_PASSWORD_FILE="$password_file" python3 - <<'PY'
import os
import secrets

with open(os.environ['STUDIO_PASSWORD_FILE'], 'x') as output:
    output.write(secrets.token_urlsafe(18) + '\n')
os.chmod(os.environ['STUDIO_PASSWORD_FILE'], 0o600)
PY
fi

STUDIO_ROOT="$project_dir" STUDIO_NODE="$node_bin" STUDIO_CLOUDFLARED="$cloudflared" STUDIO_SERVER_PLIST="$server_plist" STUDIO_TUNNEL_PLIST="$tunnel_plist" STUDIO_BACKUP_PLIST="$backup_plist" python3 - <<'PY'
import os
import plistlib

root = os.environ['STUDIO_ROOT']
local_dir = os.path.join(root, '.local')
server = {
    'Label': 'com.kanik.site-context-demo',
    'ProgramArguments': [os.environ['STUDIO_NODE'], os.path.join(root, 'server.mjs')],
    'WorkingDirectory': root,
    'EnvironmentVariables': {
        'PORT': '18787', 'HOST': '127.0.0.1',
        'DEMO_PASSWORD_FILE': os.path.join(local_dir, 'demo-password.txt'),
        'ACCOUNTS_DB': os.path.join(local_dir, 'demo-accounts.sqlite'),
        'SECURE_COOKIES': '1', 'TRUST_CLOUDFLARE_PROXY': '1',
    },
    'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 15,
    'StandardOutPath': os.path.join(local_dir, 'demo-server.log'),
    'StandardErrorPath': os.path.join(local_dir, 'demo-server-error.log'),
}
tunnel = {
    'Label': 'com.kanik.site-context-demo-tunnel',
    'ProgramArguments': [os.environ['STUDIO_CLOUDFLARED'], 'tunnel',
                         '--no-autoupdate', '--url', 'http://127.0.0.1:18787'],
    'WorkingDirectory': root,
    'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 15,
    'StandardOutPath': os.path.join(local_dir, 'demo-tunnel.log'),
    'StandardErrorPath': os.path.join(local_dir, 'demo-tunnel-error.log'),
}
backup = {
    'Label': 'com.kanik.site-context-demo-backup',
    'ProgramArguments': [os.path.join(root, 'scripts', 'backup-demo-accounts.sh')],
    'WorkingDirectory': root,
    'RunAtLoad': True,
    'StartCalendarInterval': {'Hour': 3, 'Minute': 0},
    'StandardOutPath': os.path.join(local_dir, 'demo-backup.log'),
    'StandardErrorPath': os.path.join(local_dir, 'demo-backup-error.log'),
}
for destination, definition in [(os.environ['STUDIO_SERVER_PLIST'], server),
                                (os.environ['STUDIO_TUNNEL_PLIST'], tunnel),
                                (os.environ['STUDIO_BACKUP_PLIST'], backup)]:
    with open(destination, 'wb') as output:
        plistlib.dump(definition, output)
    os.chmod(destination, 0o600)
PY

launchctl bootout "gui/$(id -u)" "$server_plist" 2>/dev/null || true
launchctl bootout "gui/$(id -u)" "$tunnel_plist" 2>/dev/null || true
launchctl bootout "gui/$(id -u)" "$backup_plist" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$server_plist"
launchctl bootstrap "gui/$(id -u)" "$tunnel_plist"
launchctl bootstrap "gui/$(id -u)" "$backup_plist"
print 'Demo server and HTTPS tunnel started. The URL is in .local/demo-tunnel-error.log.'
