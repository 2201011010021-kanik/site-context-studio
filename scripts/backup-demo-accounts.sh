#!/bin/zsh
set -euo pipefail
umask 077

script_dir=${0:A:h}
project_dir=${script_dir:h}
database="$project_dir/.local/demo-accounts.sqlite"
backup_dir="$project_dir/.local/backups"
[[ -f "$database" ]] || exit 0
mkdir -p "$backup_dir"
backup="$backup_dir/demo-accounts-$(date +%Y%m%d-%H%M%S).sqlite"
sqlite3 "$database" ".backup '$backup'"
chmod 600 "$backup"
sqlite3 "$backup" 'PRAGMA integrity_check;' | grep -qx ok
