# Working on this repo

You are working on a Herdr mod: a panel that shows the
[Plannotator](https://plannotator.ai) Inbox in the
[Herdr](https://herdr.dev) desktop app's side panel. This file is the
contract for agents who change it; `~/.config/herdr-app/AGENTS.md` —
rewritten by the app on every start — is the contract for Herdr mods in
general, and `herdr.d.ts` / `gpui-kit.d.ts` beside it are the truth about
the APIs. Read those first; this file only adds what is specific to this
mod. `RECIPE.md` is the recipe — the decisions and the architecture, kept
short — keep it true while you change the code, and never trust it over
the code.

## The shape

- `mods/plannotator/main.js` — the whole mod, one `View`: the panel (no
  props), the palette (`props().mode === "palette"`), a tree row's menu
  (`"menu"`). Six `sh -c` scripts live in it: `ASK` (the Inbox over its
  loopback server), `OPEN` (the Inbox in the browser, by hash route or by
  resource), `PULL` (one attachment's bytes into the app's folder),
  `LIST` (one level of a folder), `RUN` (a background session and its
  log), `ANNOUNCE` (decisions to Herdr toasts).
- `mods/plannotator/mod.json` — the tab manifest `tab-host` reads; see the
  README's table.
- `mods/plannotator/icon.svg`, `image.svg`, `video.svg`, `code.svg` — the
  button's glyph and the ones a message's attached files wear, all
  `currentColor` strokes so the theme tints them.
- `keys.json` — the six `global` bindings this mod expects, merged into
  the person's `keys.json`, never replacing theirs.
- `install.sh` — the delivery: copy the mod, merge the keys, check; and
  dock the panel as a normal side panel when tab-host is missing
  (`place: "right"`, `cmd-alt-i` on the plain panel toggle). Herdr
  (0.1.12) doesn't run mods behind a symlinked folder; install is a copy.
- `RECIPE.md`, `preview.png` — the recipe and its picture; a shared mod
  ships `mods/<name>/` (and its keys), nothing else — never a `layouts/`
  folder.

## While you develop

- Herdr hot-reloads saved files: a save is live within a second. The
  installed copy is `~/.config/herdr-app/mods/plannotator/` — deploy with
  `rsync -rlpt --delete mods/plannotator/ ~/.config/herdr-app/mods/plannotator/`
  and the panel follows.
- `herdr-app check mods/plannotator` loads a copy once and checks its first
  description. **It must pass before anything commits** — and it does not
  run deferred rows, threads or later states, so also look at it in the
  app. `herdr-app shot [file.png]` saves the rendered window when you need
  to see it; keep such shots out of the repo.
- If a file is invalid the app keeps the last good version and writes why
  to `<name>.error` beside it. Check after every edit.
- **Preview in a copy, and give the person's layout back.** `herdr-app do
  mod.open --name plannotator` puts a floating copy on screen — the mod has
  no overlay of its own, so the app makes one and remembers where it was in
  `windows.json`; a temporary mod left as a block in a layout file draws an
  error column in their window; and the layout in use is one `do` away from
  being swapped for another. After a preview run read `herdr-app status`
  (`layout`, `overlays`), close what was opened (`mod.open` again is its
  toggle) and switch the layout back (`layout.switch <name>`), then remove
  whatever the preview left in `layouts/*.json`, `layouts/.state/*.json`,
  `windows.json` and `shared.json` (`plannotator.state` holds the panel's
  view). What the person sees beats what the check says.

## What bit this mod already

The traps that cost a build are written up in `RECIPE.md`'s "Watch out" —
read it before changing anything here. The short list:

- A context does not survive the call that made it: anything that awaits
  and then draws is wrapped in `cx.spawn(async (cx) => …)`.
- State made during a render throws: `TextareaState`, `InputState`,
  `EditorState` and focus handles are made from event handlers or tasks,
  never in `render`.
- `image()` draws only from the app's own folder, and stretches to the box
  it is given: an attachment is copied into `data/plannotator/att/` first,
  and its width is computed from its own pixel size — never a bare
  `.w().h()` pair.
- Two methods of one name on a class is the second one winning silently —
  check the names (`field` and `answerField` exist because of this).
- One keyboard list: drawing and keys both read `rowIds()`, so the
  highlight can never drift from what Return runs. The reply field is the
  one exception (`writing` keeps every key but Esc on the caret).
- The Inbox owns the read state and the answers: dots come from its own
  buckets, picks are saved to it as they are made (`POST messages/<id>/picks`),
  and a reply names drafts it already holds. Reading a thread moves the
  seen cursor; Mark read is never done from here.
- The loopback routes are internal and can change with a new Inbox; the
  parsers throw on an unknown shape, which is the panel's one-line error.
- `saveState` writes `plannotator.state` only from the panel's own doings,
  and `syncState` adopts a value only when it differs from the last one
  this copy wrote or took — a copy's own echo must not re-adopt.
- Two shown copies both receive a key: the 500 ms `claimed` guard makes
  one press one run.

## The voice

Commits and docs are plain one-line sentences in the imperative, the way
the log reads ("Let a question be answered in the panel, draft first").
Docs claim nothing the build does not do, exact over vague (`#ab7748`,
29 px, `agent.focus`), and the person and what they see come first; code
talk belongs in "Built from" and "Watch out".

## Don't

- Don't edit `~/.config/herdr-app/AGENTS.md` or the `.d.ts` files; the app
  rewrites them.
- Don't ship a `layouts/` folder or wire a layout from here: the button is
  `tab-host`'s and the panel's tab is its block in the stack.
- Don't fork the app's palette or rebind its keys; this mod's palette is
  its own popup.
- Don't bind plain ctrl+letters, option+letters, or anything a terminal
  program needs for typing. The macOS keys here are `cmd-alt-*`; on Linux
  and Windows the equivalents are `ctrl-shift-*` (`ctrl+alt` is AltGr).
- Don't claim a network anything: the panel talks to `127.0.0.1` and
  nowhere else, and says so in the README.
