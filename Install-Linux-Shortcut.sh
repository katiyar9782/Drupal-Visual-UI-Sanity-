#!/usr/bin/env bash
set -e
cd -- "$(dirname -- "$0")"
chmod +x Start-Linux.sh
mkdir -p "$HOME/.local/share/applications"
APP_LAUNCHER="$PWD/Start-Linux.sh" python3 - <<'PY'
import os,pathlib
p=os.environ['APP_LAUNCHER']
p=p.replace('\\','\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$').replace('%','%%')
target=pathlib.Path.home()/'.local/share/applications/visual-ui-studio.desktop'
target.write_text('[Desktop Entry]\nType=Application\nName=Visual UI Studio\nComment=Drupal visual regression testing\nExec=/bin/bash "'+p+'"\nTerminal=true\nCategories=Development;\n')
print('Shortcut installed. Open Visual UI Studio from your Applications menu.')
PY
