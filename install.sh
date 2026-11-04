#!/bin/sh
# Installs the Plannotator panel into Herdr's home.
#
# 1. Copies mods/plannotator into ~/.config/herdr-app/mods/ as a real
#    folder — Herdr (0.1.12) doesn't start mods that live behind a
#    symlinked mod folder, so a `git pull` reaches the app through one
#    run of this.
# 2. Merges this repo's keys.json into the person's — adds the six
#    global bindings that are missing and replaces nothing, with a
#    backup beside the file the first time it changes something.
# 3. Runs herdr-app check on the mod, which fails loudly on a broken copy.
#
# The button in the tab bar is tab-host's: install herdr-mod-tab-host
# first (github.com/gadenbuie/herdr-mod-tab-host). Without it nothing of
# this mod appears on its own — no button and no panel (place: "none"
# keeps Herdr from docking a copy); only a layout block added by hand
# shows the card.
#
# The panel needs the `plannotator` CLI on PATH (plannotator.ai); the
# button appears only where `command -v plannotator` answers (tab.show).
set -e
here=$(cd "$(dirname "$0")" && pwd)

# Deploy the mod.
rm -rf "$HOME/.config/herdr-app/mods/plannotator"
cp -RL "$here/mods/plannotator" "$HOME/.config/herdr-app/mods/plannotator"

# Merge the keys, missing ones only.
python3 - "$here/keys.json" "$HOME/.config/herdr-app/keys.json" <<'PY'
import json, shutil, sys, time, pathlib

mine, theirs = (pathlib.Path(a) for a in sys.argv[1:3])
want = json.loads(mine.read_text())
have = json.loads(theirs.read_text()) if theirs.exists() and theirs.read_text().strip() else {}
added, kept = [], []
for section, bindings in want.items():
    have.setdefault(section, {})
    for key, action in bindings.items():
        if key in have[section]:
            if have[section][key] != action:
                kept.append(f"{key} (bound to {have[section][key]!r}, not {action!r})")
        else:
            have[section][key] = action
            added.append(key)
if added:
    shutil.copy2(theirs, theirs.with_name(theirs.name + ".bak-plannotator-" + time.strftime("%H%M%S")))
    theirs.write_text(json.dumps(have, indent=2, ensure_ascii=False) + "\n")
print("keys: added " + ", ".join(added) if added else "keys: nothing to add")
for line in kept:
    print("keys: kept " + line)
PY

herdr-app check "$HOME/.config/herdr-app/mods/plannotator" >/dev/null
echo "installed and checked: plannotator"
