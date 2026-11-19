#!/bin/zsh
set -euo pipefail
project_dir=${0:A:h:h}
if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
  print -u2 'The online reader needs Python 3.10 or newer to install patched aiohttp. Install a newer Python, then rerun this script.'
  exit 1
fi
python3 -m venv "$project_dir/.venv"
"$project_dir/.venv/bin/python" -m pip install -r "$project_dir/requirements-online.txt"
print 'Online Overture reader is ready.'
