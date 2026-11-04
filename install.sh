#!/bin/sh
# Installs the Plannotator panel into Herdr's home.
#
# 1. Copies mods/plannotator into ~/.config/herdr-app/mods/ as a real
#    folder — Herdr (0.1.12) doesn't start mods that live behind a
#    symlinked mod folder, so a `git pull` reaches the app through one
#    run of this.
# 2. Merges this repo's keys.json into the person's — adds the bindings
#    that are missing and replaces nothing. The one exception is the
#    cmd-alt-i binding this script itself may have written earlier: it
#    follows the mode below, and only its own two values are ever
#    swapped. A backup is kept beside the file the first time it
#    changes something.
# 3. Runs herdr-app check on the mod, which fails loudly on a broken copy.
#
# tab-host is optional. With it (github.com/gadenbuie/herdr-mod-tab-host),
# the panel lives on the tab bar's own tab: the manifest's place stays
# "none" and cmd-alt-i is tab-host's toggle. Without it, the fallback is
# a normal panel: the installed copy's place becomes "right" and cmd-alt-i
# binds the plain layout.toggle:panel — the same panel, with no button in
# the tab bar, no badge and no per-space carry. Rerun this script after
# either mod appears or disappears and the mode swaps back.
#
# The panel needs the `plannotator` CLI on PATH (plannotator.ai); with
# tab-host the button appears only where `command -v plannotator` answers.
set -e
here=$(cd "$(dirname "$0")" && pwd)
home="$HOME/.config/herdr-app"

# Deploy the mod.
rm -rf "$home/mods/plannotator"
cp -RL "$here/mods/plannotator" "$home/mods/plannotator"

# The panel's place follows tab-host: its tab when that mod is there,
# a normal side panel when it is not.
mode=tabhost
if [ -d "$home/mods/tab-host" ]; then
  echo 'tab-host: found — the panel lives on its tab (place stays "none")'
else
  mode=no-tabhost
  python3 - "$home/mods/plannotator/mod.json" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
m = json.loads(p.read_text())
m["place"] = "right"
p.write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
PY
  echo 'tab-host: not found — docked the panel as a normal side panel (place: "right")'
fi

# Merge the keys: missing ones only, the cmd-alt-i binding following the
# mode above (a person's own binding is kept, whatever it is).
python3 - "$here/keys.json" "$home/keys.json" "$mode" <<'PY'
import json, pathlib, shutil, sys, time

mine, theirs = (pathlib.Path(a) for a in sys.argv[1:3])
mode = sys.argv[3] if len(sys.argv) > 3 else ""
want = json.loads(mine.read_text())
have = json.loads(theirs.read_text()) if theirs.exists() and theirs.read_text().strip() else {}
TOGGLE_WITH, TOGGLE_WITHOUT = "tab-host.toggle:plannotator", "layout.toggle:panel"
swapped = []
g = have.setdefault("global", {})
if mode == "no-tabhost":
    want["global"]["cmd-alt-i"] = TOGGLE_WITHOUT
    if g.get("cmd-alt-i") == TOGGLE_WITH:
        g["cmd-alt-i"] = TOGGLE_WITHOUT
        swapped.append(f"cmd-alt-i -> {TOGGLE_WITHOUT} (no tab-host)")
elif mode == "tabhost" and g.get("cmd-alt-i") == TOGGLE_WITHOUT:
    g["cmd-alt-i"] = TOGGLE_WITH
    swapped.append(f"cmd-alt-i -> {TOGGLE_WITH} (tab-host back)")
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
if added or swapped:
    if theirs.exists():
        shutil.copy2(theirs, theirs.with_name(theirs.name + ".bak-plannotator-" + time.strftime("%H%M%S")))
    theirs.write_text(json.dumps(have, indent=2, ensure_ascii=False) + "\n")
print("keys: added " + ", ".join(added) if added else "keys: nothing to add")
for line in swapped:
    print("keys: swapped " + line)
for line in kept:
    print("keys: kept " + line)
PY

herdr-app check "$home/mods/plannotator" >/dev/null
echo "installed and checked: plannotator (mode: $mode)"
