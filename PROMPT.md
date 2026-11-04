# PROMPT.md — the one-liner to give your agent

Paste this when you want this panel in your Herdr:

```text
Install the Plannotator panel for my Herdr app: clone
https://github.com/gadenbuie/herdr-mod-plannotator (or use the copy
already at ~/play/gadenbuie/herdr-mod-plannotator), read its AGENTS.md
and follow it exactly: run its install.sh, confirm `herdr-app check`
passes, and tell me what the new Plannotator button and panel do. It
needs the plannotator CLI on PATH; tab-host is optional — without it
install.sh docks the panel as a normal side panel, with no button or
badge — so say so if the CLI is missing rather than working around it.
```

The panel's button comes from [tab-host](https://github.com/gadenbuie/herdr-mod-tab-host),
which is optional — install.sh docks the panel as a normal side panel
when tab-host is missing — and its content comes from
[Plannotator](https://plannotator.ai), whose CLI must be on PATH. Say so
if something is missing rather than working around it.
