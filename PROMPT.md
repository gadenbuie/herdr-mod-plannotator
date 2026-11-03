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
be installed for the button to appear and mean something. Without tab-host
the agent can still open the panel as a tab of a space through the app
palette's "Go to space or tab…" — mention that if you want it checked too.
