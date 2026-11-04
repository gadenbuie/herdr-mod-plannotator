# PROMPT.md — the one-liner to give your agent

Paste this when you want this panel in your Herdr:

```text
Install the Plannotator panel for my Herdr app: clone
https://github.com/gadenbuie/herdr-mod-plannotator (or use the copy
already at ~/play/gadenbuie/herdr-mod-plannotator), read its AGENTS.md
and follow it exactly: run its install.sh, confirm `herdr-app check`
passes, and tell me what the new Plannotator button and panel do. It
needs herdr-mod-tab-host for the button and the plannotator CLI on PATH;
say so if either is missing rather than working around it.
```

The panel's button comes from [tab-host](https://github.com/gadenbuie/herdr-mod-tab-host)
and its content comes from [Plannotator](https://plannotator.ai); both must
be installed — without tab-host nothing of this mod appears on its own
(`place: "none"` keeps Herdr from docking the panel, so there is no button
to click and no panel). Say so if either is missing rather than working
around it.
