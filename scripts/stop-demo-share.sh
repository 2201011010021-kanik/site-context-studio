#!/bin/zsh
set -euo pipefail

agent_dir="$HOME/Library/LaunchAgents"
for label in com.kanik.site-context-demo-tunnel com.kanik.site-context-demo com.kanik.site-context-demo-backup; do
  plist="$agent_dir/$label.plist"
  if [[ -f "$plist" ]]; then
    launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
    rm "$plist"
  fi
done
print 'Demo sharing stopped.'
