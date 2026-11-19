#!/bin/zsh
set -euo pipefail

project_dir=${0:A:h:h}
main_checkout=$(git -C "$project_dir" worktree list --porcelain | sed -n '1s/^worktree //p')
reader=${OVERTURE_PYTHON:-$main_checkout/.venv/bin/python}

if [[ ! -x "$reader" ]]; then
  print -u2 "Python map reader not found at $reader"
  print -u2 'Set OVERTURE_PYTHON to an installed reader, then try again.'
  exit 1
fi

exec env \
  PORT="${PORT:-18788}" \
  HOST=127.0.0.1 \
  DEMO_EPHEMERAL=0 \
  ACCOUNTS_DB="${ACCOUNTS_DB:-${TMPDIR:-/tmp}/site-illustration-preview.sqlite}" \
  OVERTURE_PYTHON="$reader" \
  node "$project_dir/server.mjs"
