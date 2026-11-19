#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}
if ! "$project_dir/.venv/bin/python" -c 'import pyarrow, shapely, fsspec, aiohttp' 2>/dev/null; then
  "$script_dir/install-online-deps.sh"
fi
node_bin=$(command -v node)
expected_version=$(STUDIO_PACKAGE="$project_dir/package.json" python3 -c 'import json,os;print(json.load(open(os.environ["STUDIO_PACKAGE"]))["version"])')
label="com.kanik.site-context-studio"
agent_dir="$HOME/Library/LaunchAgents"
agent_file="$agent_dir/$label.plist"

mkdir -p "$agent_dir"
STUDIO_NODE="$node_bin" STUDIO_ROOT="$project_dir" STUDIO_PLIST="$agent_file" python3 - <<'PY'
import os
import plistlib

root = os.environ['STUDIO_ROOT']
definition = {
    'Label': 'com.kanik.site-context-studio',
    'ProgramArguments': [os.environ['STUDIO_NODE'],
                         f'--watch-path={os.path.join(root, "server.mjs")}',
                         f'--watch-path={os.path.join(root, "place-search.mjs")}',
                         f'--watch-path={os.path.join(root, "geo.mjs")}',
                         f'--watch-path={os.path.join(root, "overpass-client.mjs")}',
                         f'--watch-path={os.path.join(root, "offline-extract.mjs")}',
                         f'--watch-path={os.path.join(root, "overture-client.mjs")}',
                         f'--watch-path={os.path.join(root, "capture-store.mjs")}',
                         f'--watch-path={os.path.join(root, "terrain.mjs")}',
                         f'--watch-path={os.path.join(root, "site-insights.mjs")}',
                         f'--watch-path={os.path.join(root, "fetch-overture.py")}',
                         os.path.join(root, 'server.mjs')],
    'WorkingDirectory': root,
    'EnvironmentVariables': {'PORT': '8787'},
    'RunAtLoad': True,
    'KeepAlive': True,
    'ThrottleInterval': 15,
    'StandardOutPath': '/dev/null',
    'StandardErrorPath': '/dev/null',
}
with open(os.environ['STUDIO_PLIST'], 'wb') as file:
    plistlib.dump(definition, file)
PY

launchctl bootout "gui/$(id -u)" "$agent_file" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$agent_file"

actual_version=''
for attempt in {1..10}; do
  health=$(curl -fsS --max-time 2 http://127.0.0.1:8787/api/health 2>/dev/null) || health=''
  actual_version=$(STUDIO_HEALTH="$health" python3 -c 'import json,os;print(json.loads(os.environ["STUDIO_HEALTH"]).get("version", ""))' 2>/dev/null) || actual_version=''
  [[ "$actual_version" == "$expected_version" ]] && break
  sleep 1
done
if [[ "$actual_version" != "$expected_version" ]]; then
  print -u2 "Expected version $expected_version at localhost:8787, got ${actual_version:-no response}. Run PORT=8787 npm start in a Terminal to see the startup error."
  exit 1
fi
print "Site Context Studio $actual_version is running at http://localhost:8787"
print 'Backend code changes now restart the service automatically. It also starts when you sign in to this Mac.'
