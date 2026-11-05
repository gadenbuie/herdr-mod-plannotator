# Plannotator

Your agents' questions, summaries and reviews, beside Files and Changes:
a [Plannotator](https://plannotator.ai) panel in the tab bar of the
[Herdr](https://herdr.dev) desktop app (`herdr-app`; written against
0.1.12).

A **Plannotator** button shows how many threads are waiting on you while
the panel is closed; clicking it opens the Inbox's threads in the side
panel, each with a dot for what it needs — yellow asks something, blue is
new since you looked, grey is read. Read any thread as markdown right
there, answer its questions by clicking their choices, reply in words
without leaving the terminal — and read the files the agent attached to it:
a picture drawn where it was sent, a document, a code file or a patch one
click from its own read-only page. When a decision is made in a Plannotator
session, it arrives as a Herdr toast the second it happens — panel open or
not.

![Plannotator](preview.png)

The panel also carries the annotate list: the last message, your changes,
this space's whole folder, one file or folder out of a tree, another
folder from a picker — each started as a background `plannotator` session
in the folder you're working in. And the panel's view sticks to its space:
the thread you had open and the folders you had expanded come back when
you do.

- `mods/plannotator/` — the panel, its palette, and a row's menu: one mod.
- `install.sh` — installs it: copy the mod, merge the keys, `herdr-app check`.
- `RECIPE.md` — the recipe in Herdr's six parts: what you see, how it
  behaves, what it is built from, and the traps that cost the build.

## Install

```sh
git clone https://github.com/gadenbuie/herdr-mod-plannotator.git
cd herdr-mod-plannotator
make install   # runs ./install.sh
```

`install.sh` copies the mod into `~/.config/herdr-app/mods/`, adds the key
bindings you don't already have (replacing nothing, with a backup beside
your `keys.json`), and runs `herdr-app check`. Without tab-host it also
docks the panel on the right — Herdr's one-time first dock; after that
it is a normal block in your layout, to move, resize or remove like any
panel. With tab-host the manifest ships as-is
(`place: "none"`) and the panel lives on the tab bar's tab. Or skip the
script entirely: your agent can copy `mods/plannotator/` into
`~/.config/herdr-app/mods/`, add its block
(`{"type": "block", "content": {"mod": "plannotator"}}`) to a layout you
own, and merge the keys — the same panel either way.

The button needs [herdr-mod-tab-host](https://github.com/gadenbuie/herdr-mod-tab-host)
installed — it draws one button per mod that declares a tab, and the
panel's tab in the side panel is its block: the button in the tab bar,
the badge while the panel is closed, and the view that follows you from
space to space are all its. tab-host is optional, though: without it
`install.sh` installs the same panel as a normal Herdr side panel
(`place: "right"`) — no button, no badge, no per-space carry — and
binds `cmd-alt-i` to the plain `layout.toggle:panel` instead of the
button's own toggle. Rerun `./install.sh` after installing or removing
tab-host and the two modes swap.

The panel talks to Plannotator's own Inbox server on `127.0.0.1` — the
same requests its page opens with — and needs the `plannotator` CLI on
`PATH` (written against 0.28). The button appears only where
`command -v plannotator` answers.

## The tab, declared

The button is `tab-host`'s; this mod joins by declaring a tab in its own
`mod.json` — no code, no registration, no layout edit:

```json
{
  "place": "none",
  "focusable": true,
  "tab": {
    "title": "Plannotator",
    "icon": "mods/plannotator/icon.svg",
    "badge": "plannotator.waiting",
    "state": "plannotator.state",
    "show": "command -v plannotator >/dev/null 2>&1",
    "order": 200
  }
}
```

| Field | What it does here |
| ----- | ----------------- |
| `tab.title` | The button's label. |
| `tab.icon` | A 16 px page-with-a-check glyph, tinted with the text color. |
| `tab.badge` | The count of threads waiting on you, published on `plannotator.waiting`; drawn as a chip after the label, visible while the panel is closed. |
| `tab.state` | The panel's view — the thread on screen, the folders open in the tree — kept one value per space, so it comes back when you do. |
| `tab.show` | A shell string; the button appears only in spaces whose machine has `plannotator` on `PATH`. |
| `tab.order` | Puts the button at the right end of the tab bar's contributors. |

`place: "none"` keeps Herdr from docking a copy of the mod on its own;
`focusable` is what lets the panel take the keyboard when it is clicked
into, so it never steals the keys from the terminal that opened it.

## Keys

| Key (macOS) | Does |
| ----------- | ---- |
| `cmd-alt-i` | Show the panel on its tab, or hide it — the button's own behaviour (`tab-host.toggle:plannotator`). Without tab-host: `layout.toggle:panel`, the plain panel toggle. |
| `cmd-alt-shift-p` | The mod's own palette: annotate, review, open the Inbox. |
| `cmd-alt-l` | Annotate the last message. |
| `cmd-alt-r` | Review my changes. |
| `cmd-alt-a` | Annotate this space's folder. |
| `cmd-alt-shift-i` | Open the Inbox in the browser. |

On Linux and Windows bind `ctrl-shift-*` instead — `ctrl+alt` is AltGr
there. `cmd-alt-i` works with the panel closed; the `plannotator.*` keys
reach the panel while its tab is showing.

## Toasts with the panel closed

Herdr keeps a block's copy alive once it has started, shown or hidden. The
panel lives in the side panel's stack, so after the button has been pressed
once the mod runs for the rest of the session: the sessions folder stays
watched, and a decision becomes a Herdr toast within the second. Only a
copy nobody has shown yet is deferred — after a restart, the first decision
waits for one press of the button (or `cmd-alt-i`).

Session logs land in `~/.config/herdr-app/data/plannotator/sessions/` — a
`__label` first line, the CLI's output, and `__exit <code>` at the end.
Nothing prunes them.

## The files agents attach

A message that came with files shows them. A picture is drawn under the
words at the size it was taken, with its name and size beneath it; every
other file is a card the width of the column, the way the Inbox draws one: the
kind's glyph in a square, the name over "Markdown · 1.2 KB", a chevron — and a
count over them ("3 attachments") so they are not mistaken for the message's
own words. A picture is a card too once it is clicked. Clicking either opens
the file in the panel, read-only: a markdown document as the markdown it is,
code and a patch in the code view — line numbers, its language, a scroll of
its own — any other text the same way, a picture at the panel's width.
Nothing there edits, downloads or uploads except the comment you write on
it, and the back chevron (or Esc) returns to the thread it came in.

Pictures an agent writes *into* its words — `![alt](/tmp/shot.png)`, the
path it just took — are drawn where it wrote them, between the paragraphs
either side, centred in the column, as a thumbnail: never taller than 240 px
and never narrower than 130, so a portrait screenshot stays a picture rather
than a column of screen. Clicking one opens it at its own size in a dialog over the window,
closed with Esc or its cross. The panel copies those files itself, so it
shows the picture as the agent left it; when the path is not a file any
more, a count takes its place under the words and leads to the Inbox.

Two kinds the panel cannot show, and does not pretend to: a video opens in
the browser where the Inbox's own player has it, and a web page shows its
source with a row to the Inbox, which renders it.

The attachment bytes come from the Inbox, not from the path the agent
named — that file is usually gone by the time you read the thread, and the
Inbox kept what it sent. They are cached under
`~/.config/herdr-app/data/plannotator/att/<thread>/`, one file per
attachment named by its hash; a picture written into the words lands in the
same folder, named by its path. The copies are a cache, not an archive: a
thread's folder is deleted when you leave the thread, and the whole folder
is cleared when the panel starts.

## Comments

A comment needs no page. Drag across a paragraph of an agent's message and
a **Comment** bar appears over the highlight's first line, at the end of the
drag that comes first in the page — so dragging upwards opens it at the top
too (under the line if that is the paragraph's first). A drag that ends in
the air around a paragraph still counts — the comment is on the paragraph it
started in, and the bar appears where the highlight first reached, above the
paragraph if that is the end you dragged to. The bar becomes a field under
that paragraph — the highlighted line quoted above it, your words in it,
and Cancel and Comment buttons. The bar carries two shortcuts into that
same field: a bin ("Please delete this") and a thumbs up ("👍 Looks good"),
which open it with those words already there for you to adjust or send.
Click anywhere else and the bar goes, the way the highlight does. What it is filed against is the paragraph, so the
quote is its first line: the panel cannot read your selection, and does not
need to — a highlight that starts in one paragraph and runs into the next
is a comment on the one it started in. A code file, which has no paragraphs to press, gets one row instead
— **Comment on this file**, above the code view — and a markdown file takes
a comment paragraph by paragraph, as a message does.

Comment moves the words into the reply band at the bottom of the thread,
with the line they are about and a ✕ to drop them, and saves them to the
Inbox at once; the band counts them ("1 answer and 1 comment go with this
reply"). Send carries them with the reply: the agent reads your words,
then **Comment on your message:** (or on the file's name), the quoted line,
and the comment. Esc puts an open field away, and a click is only a click —
the bar wants a drag.

## Plannotator

[Plannotator](https://plannotator.ai) is free, open-source plan and code
review tooling for coding agents, by
[backnotprop](https://github.com/backnotprop) — and the whole reason this
panel has anything to say. Its [Inbox](https://plannotator.ai/inbox/) is
the async surface where long-running agents leave questions, summaries and
reviews for the person; this mod reads that Inbox over its loopback server,
and every answer picked in the panel is the same draft the Inbox page
keeps. This panel is a thin native window onto all of that — the decisions
and the answers stay Plannotator's, and the pages it links to are
Plannotator's own.
