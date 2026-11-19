#!/bin/zsh
set -euo pipefail

label="com.kanik.site-context-studio"
agent_file="$HOME/Library/LaunchAgents/$label.plist"
launchctl bootout "gui/$(id -u)" "$agent_file" 2>/dev/null || true
rm -f "$agent_file"
print 'Site Context Studio automatic startup is removed. The project files and logs remain.'
