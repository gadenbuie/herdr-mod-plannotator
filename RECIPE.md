# Plannotator

A Plannotator button beside Files and Changes opens a tab in the side
panel that says what is in the Plannotator Inbox — the questions, summaries
and reviews agents left for the person. Each thread carries a dot for what
it needs (yellow asks something, blue is new since the person looked, grey
is read); any thread opens to read its messages in the panel, answer its
questions by clicking their choices, and reply in words — with the files the
agents attached to those messages drawn and readable there too. Under the threads
sits the annotate list: the last message, the review, the space's folder, a
file tree for picking one file or folder, and another folder from a picker —
each starts a background `plannotator` session in the folder being worked
in. A decision made in a Plannotator session lands as a Herdr toast the
second it happens, panel open or not, because the panel's tab keeps running
while it is hidden. The view — the thread on screen, the folders open in
the tree — sticks to its space and comes back with it.

![Plannotator](preview.png)

## What you see

- The panel is a card in the side panel (368 px in the person's layout,
  Files and Changes' width), 13 px text in `foreground`, its content
  column capped at 760 px and centred; everything scrolls together and
  nothing floats but the palette and a row's menu.
- **Header**: "Plannotator", a count chip for how many threads wait on the
  person, a magnifier button (the palette) and a page button (the Inbox).
  There is no cross — the tab bar's button is what puts the panel away.
  With a thread open, the header is a back chevron and the thread's
  subject, and the page button opens the Inbox on that thread.
- **Threads**: up to five rows, each two lines — a 7 px dot in its bucket's
  colour, the project's name (in `accent` when it is the space's own
  project) and its age at 11 px; the subject at 13 px, one line. Yellow
  first, then blue, then grey, newest first inside each group. More than
  five: an "N more in the Inbox" row. An empty Inbox says "No threads yet";
  a failed read adds its one-line error there.
- **Annotate**: "Last message", "Review changes" and "This space" (with the
  space's folder in `~/…` form at its right), then a "Files · N" toggle that
  opens the space folder's tree — folders first then files, alphabetically,
  indented a step per level, a pen button on every folder's row, a file's
  row the action itself — and last "Another folder…".
- **The row the keys are on** is filled `selected`; it starts on the thread
  that most needs the person, or "Last message" when the Inbox is empty.
- **A thread, opened**, replaces the list as a page: a pinned crumb
  (project · age), a scrolling middle of messages — each drawn as markdown
  with its author line, the person's own boxed with a 2 px `accent` rule
  down the left — their questions as cards (a dot and the state in its
  colour, ringed choices, a "Recommended" chip on the choice it names, and
  an "Answer in the Inbox" row), the reply band pinned at the bottom (the
  field grows 2→8 rows, Send goes live for words or a picked answer, and
  the line under it says what the Send carries: "1 answer goes with this
  reply"), and last an "Open in Inbox for picks and pictures" row. Pictures
  written into the words are counted as a link; the files an agent attached
  are the message's own: a picture drawn under the words with its name and
  size beneath it, and every other file a row — its kind's glyph, its name,
  its size. A click on either opens the file. A refused send says why in
  the Inbox's own sentence.
- **A file, opened**, is a page of its own under the thread: the header is
  the back chevron and the file's name, a `dim` row under it says what kind
  of file it is, how big, and for a picture or a film its size in pixels and
  length, and the body is the file — a document as the markdown it is, code
  and a patch inside one code block, any other text with line numbers, a
  picture at the panel's width. Read-only: nothing here edits, downloads or
  uploads. A video is a row that plays it in the browser, and a web page is
  its source plus a row to the Inbox, which renders it; both say so.
- **The palette** (520×340 at the pointer): a search line over six rows —
  Annotate the last message, Review my changes, Annotate all files,
  Annotate another folder…, Open the Inbox, Open Plannotator as a tab —
  each with the key that binds it where one does. Typing filters by
  subsequence.
- **A tree row's menu** (right-click): annotate this file or folder,
  annotate all files, review changes here.
- **The tab bar's button**: a pill at the right end of the bar, a
  page-with-a-check glyph and the label with a badge chip while the panel
  is closed, filled `selected` while its tab shows. A click or `cmd-alt-i`
  shows the panel on this tab; again hides it.

## How it behaves

- **The button and `cmd-alt-i` are `tab-host`'s toggle.** Showing this tab
  takes two layout commands (`layout.select {stack, child}`, then
  `layout.show {id}`); a key can run only one, so the binding is
  `tab-host.toggle:plannotator`, the same handler the click runs, on a
  copy that lives in the tab bar and never sleeps.
  `layout.toggle:panel` would land on whatever tab the panel was last on —
  that is why the key is not it. (Without tab-host, `install.sh` docks
  the panel on the right and binds the key to that plain toggle anyway:
  better a panel that lands on its last tab than no panel.)
- **The tab keeps the mod alive, and that is what the toast needed.** Herdr
  keeps a block's copy running once it has shown, hidden or not, so after
  one press of the button in a session the sessions folder stays watched
  and a decision is a Herdr toast within the second. Only a copy nobody
  has shown is deferred: after a restart, the first decision waits for one
  press of the button.
- **One keyboard list.** The drawing and the keys both read `rowIds()` —
  the threads, "N more", the annotate rows, the Files toggle, every drawn
  tree row, "Another folder…", and in a thread the last row and the way
  back — so the highlight is always the row Return runs. The reply field
  is the one exception: while the caret is in it, every key but Esc
  belongs to the caret. The panel is not handed the keyboard when it
  appears (that would pull it out of the terminal); a click into it hands
  it over.
- **The Inbox owns the list and the read state; the store is only the
  trigger.** `~/.plannotator/inbox/projects` is watched (`watchFolder`) for
  changes, and the rows come from the Inbox server's own model,
  `GET http://127.0.0.1:<port>/api/inbox/threads` (the port in
  `~/.plannotator/inbox/inbox.json`), which returns them already sorted
  into its buckets — stopped/holding/waiting, new, sent/quiet — folded here
  into yellow, blue and grey. A message an agent sends is a row within a
  second, in the list or in the open thread. Without the server the panel
  says so and fills itself in when it returns. Nothing is polled from
  Herdr: spaces, focus, theme and the space's folder arrive by themselves.
- **Reading a thread is `seen`, never `read`.** Opening it POSTs
  `threads/<id>/seen` with the newest drawn seq — exactly what the Inbox
  page does — so the blue dot goes and nothing else moves. The Inbox's own
  Mark read also sets aside every open question with a skip answer; that
  is the person's decision, made on a page that can show the picks, never
  a side effect of opening a thread here. A thread with an unanswered
  question stays yellow, and the badge keeps counting it.
- **Picks are the Inbox's drafts, saved as they are made.** A click on a
  ring POSTs `messages/<id>/picks` — the same draft the Inbox's own page
  keeps, so a pick here follows to the browser and back. The reply's Send
  POSTs `messages/<id>/reply` with `words`, the picked answers named
  `{message_id, key, revision}`, an `idempotency_key`, and
  `seen_through_seq` — the newest seq drawn. Picks alone are a reply. If
  the agent wrote after what was drawn, the Inbox refuses with
  `thread_moved_on`: nothing sends, the words stay in the field, the
  thread re-reads to show what moved it. **This is the whole write
  surface** — a cursor, an answer's draft, a reply. No resolve, upload,
  tag, handoff or skip leaves the panel.
- **The files come from the Inbox, not from the path the agent named.** An
  attachment is a record — `id`, `name`, `kind` (markdown, text, code, html,
  image, video), `size`, its hash — and the file the agent pointed at is
  usually gone by the time the person reads the thread, so what is drawn is
  the copy the Inbox kept: `GET attachments/<id>?version=sent` for the words,
  `<id>/image` and `<id>/video` for the bytes. Each is pulled once into
  `~/.config/herdr-app/data/plannotator/att/`, named `<id>-<hash8>.<ext>`,
  and a file already there is the answer — a sent attachment cannot change.
  Nothing prunes that folder. A file the Inbox no longer has says so on its
  page and offers the thread; a thread whose pictures cannot be read keeps
  their rows. Pictures are pulled when a thread opens (once each, then kept)
  so a message can draw them; every other kind is read only when the person
  opens it. The files are read-only in both directions: the panel shows them
  and sends nothing about them.
- **The rest of an answer is a page away.** "Open in Inbox for picks and
  pictures" (and the header's page button) opens the Inbox at
  `#thread=<id>` through `plannotator inbox --background`, which prints the
  address without a browser, so `open` lands one tab on the thread instead
  of two.
- **The tree follows the focused pane.** Its root is the focused folder;
  each folder's children are read once, when its row first opens, and
  kept until the root changes. Collapsing keeps what was read. "This
  space" annotates the space folder, a folder's pen annotates that folder,
  a file's row annotates the file, and "Another folder…" opens
  `pickFolder` and annotates what it returns.
- **Sessions run in the background, and the log is the channel.** One `sh`
  per run backgrounds `plannotator last|review|annotate … --json` with
  `nohup` in the working folder; `--json` changes only the log's verdict
  line, nothing on the page. The output lands in
  `~/.config/herdr-app/data/plannotator/sessions/<stamp>-<label>.log`
  under a `__label` first line with `__exit <code>` closing it; a failed
  run (no CLI on `PATH`, say) is an exit code in the log and a toast with
  the label and nothing after it. Nothing prunes those logs.
- **A decision is a Herdr toast the moment it lands.** The watcher reads
  the sessions folder for a log with `__exit` and no `__told`, posts
  `notify()` for up to three, and marks each as it goes, so however many
  copies read at once the toast fires once.
- **Mod keys reach an on-screen copy only.** `plannotator.palette`,
  `.last`, `.review`, `.annotate` and `.inbox` arrive through
  `nextCommand()` and work while the panel's tab shows; with the panel
  hidden Herdr toasts "unknown command" — `cmd-alt-i` is the one that
  always works, and a palette or menu pick closes its popup before it
  acts while nothing else ever closes anything (the panel is a tab). Two
  shown copies both receive a key, so a second command within 500 ms is
  ignored: one press, one run.

## Built from

- `mods/plannotator/main.js` — the whole mod, one `View`: no props is the
  panel; `props().mode === "palette"` the palette; `"menu"` a tree row's
  menu. Those two are `openOverlay` popups, closed with
  `closeOverlay(props().overlay)` — the id is not the mod's name. The
  thread page is `TextView.markdown` per message, so the agents' markdown
  arrives as markdown. The reply field is a `TextareaState` with
  `set_auto_grow(2, 8)`, made once on the first thread and kept — as are
  the fields behind a card's saved answers.
- `mods/plannotator/mod.json` — the manifest, the whole of the tab bar's
  dependency:

```json
{
  "place": "none",
  "title": "Plannotator",
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

  `place: "none"` is what the repo ships: with tab-host installed, a
  dockable place would be a second panel. `install.sh` rewrites the
  installed copy to `"right"` when tab-host is missing — the panel docks
  as a normal side panel, which is what makes tab-host optional — and
  binds `cmd-alt-i` to `layout.toggle:panel` for as long as that mode
  lasts. `focusable` lets the panel take the keyboard when it is
  clicked into. `tab` is `tab-host`'s field, not Herdr's — Herdr ignores
  unknown keys, so the declaration is inert without that mod: `badge`
  names the shared key the waiting count is published on, `state` the
  key the panel's view is carried in from space to space, `show` keeps
  the button out of machines without `plannotator` on `PATH`, and
  `order` puts it at the right end of the contributors.
- `mods/plannotator/icon.svg` — the button's glyph, `stroke="currentColor"`
  and `fill="none"` so `tab-host` tints it with the button's text colour.
  `image.svg`, `video.svg` and `code.svg` beside it are the same kind of
  glyph in the same style, worn by a message's attached files.
- `keys.json` — six `global` bindings (see the README). Merge into the
  person's `keys.json`, never replacing it. The `cmd-alt-i` binding is
  `tab-host.toggle:plannotator` — that mod's command, spelled `tab-host`,
  not `tabhost`.
- Six `sh -c` scripts, because a mod has no directory or HTTP API of its
  own: `ASK` (the Inbox over its loopback server — `curl -s -m 5` to a
  route under `/api/inbox/`, the port read from `inbox.json`, a canned
  error JSON when the server is down), `OPEN` (the Inbox in the browser:
  a `#thread=<id>` route, or a `/api/inbox/…` resource opened as it is),
  `PULL` (one attachment's bytes to a file, `?version=sent`, skipped when
  the file is already there), `LIST` (one tree level, NUL-separated, `.git`
  skipped, 200 entries at most), `RUN` (a background session and its log),
  `ANNOUNCE` (finished sessions, `__told`-marked, printed once).
- `herdr` functions: `spaces`, `focused`, `panes`, `exec`, `run`, `theme`,
  `props`, `openOverlay`, `closeOverlay`, `notify`, `watchFolder`,
  `pickFolder`, `home`, `appHome`, `nextCommand`, `keys`, `shared`,
  `setShared`, `readTextFile`. Programs: the `plannotator` CLI (`last`,
  `review`, `annotate <path>`, `inbox --background`), `curl`,
  `open`/`xdg-open`, `sh`. Elements: `svg`, `image` (a file the mod copied
  into the app's folder), `TextView.markdown` (a document, and code and a
  patch as one fenced block), and `Editor` with a readonly `EditorState`
  for text a fence would mangle. Icons are the shipped `workspace-chrome`
  set plus this mod's own.
- The loopback routes are internal — the same requests the Inbox page
  itself opens with, needing no token, but a new Inbox version can change
  a payload. The parsers throw on a shape they don't know, which turns
  that into the panel's one-line error rather than a blank page.

## Watch out

- **A context does not survive the call that made it.** Anything that
  awaits and then draws is wrapped in `cx.spawn(async (cx) => …)`, or the
  host draws "cx is no longer valid" across the panel.
- **State made during a render throws.** `TextareaState`, `InputState` and
  focus handles are made from event handlers or tasks, never in `render`.
- **Two methods of one name on a class is the second one winning
  silently** — not overloads. `field(cx)` and `answerField(...)` are two
  names because of it.
- **`place` is `"none"` in the repo and `"right"` in a docked install, and
  the two must not meet.** The repo ships `"none"` because with tab-host
  installed a dockable place gives the panel two copies. `install.sh`
  swaps the installed copy's place and its own `cmd-alt-i` binding with
  the mode — tab-host there or not — and only ever touches the two
  bindings it may itself have written. Without tab-host there is no
  button; the docked copy is the panel. A block tab-host left in a
  layout keeps drawing after tab-host is gone.
- **There is no web view in Herdr**, and the app's own palette cannot be
  extended (`mod.open` is hidden from it) — so the page opens in the
  browser, and the palette here is the mod's own popup, under its own
  key. A popup sizes itself: `overlay.height` is ignored for
  `kind: "popup"`, so the palette states its 520×340 in its own `render`.
- **A mixed-height column cannot scroll to a row.** The only scroll-to
  API belongs to `v_virtual_list`, whose renderer throws on clicks — and
  question cards are made of clicks. So ↑/↓ can move the highlight past
  the fold of a long tree, and the thread page is *arranged* to open at
  its end instead: the last three messages drawn, the rest behind a count
  row, no question ever among the hidden ones.
- **`surface` resolves to the same colour as `background` in this
  palette** — box the person's messages in `popover` instead. `theme()`
  reports the resolved tokens; read it before trusting a token's name.
- **`setShared` re-renders every mod.** The badge is written only when the
  number changes. `plannotator.state` (the view per space) is written only
  from the panel's own doings — a click, a key, never a render — and
  adopted only when it differs from the last value this copy wrote or
  took, or a copy's own echo would re-adopt its stale view into the space
  the person is in.
- **Dots are the Inbox's buckets, not a reading of the files.** Do not
  re-derive them from `messages.jsonl`: an agent's message is re-appended
  under the same id on every write, so what is newer than the person's
  cursor is not recoverable from the file tail. Ask the Inbox — it has
  the history and the arithmetic.
- **No group-hover exists in gpui-kit**: the folder pen is always drawn,
  `dim`, and its `on_mouse_down` stops propagation or the row would open
  too. A spacer `div().w(12)` collapses to nothing without a height.
- **The reply field is the band, not a box inside one** — a frame around a
  frame at the bottom of every thread read as clutter; the band runs the
  panel's full width on `popover`, and the rule over it (not a border on
  it) says the caret is there.
- **`image()` reads the app's own folder and nothing else.** A relative
  path against `appHome()` is drawn; an absolute path in the person's home
  is not, and a file that is not there draws nothing at all — no error, no
  box, a gap. That is why `PULL` copies the bytes into
  `data/plannotator/att/` first, why the relative half of that path is what
  is handed to `image()`, and why a picture is drawn only once its file is
  known to be there (until then the message keeps the row).
- **`image()` stretches to the box it is given.** `.w(200)` alone keeps the
  file's own shape; `.w(300).max_h(240)` squashes it into 300×240. So the
  width is worked out from the attachment's own `width` and `height` — the
  panel's column, the picture's own pixels, a 200 px height cap in a
  message — and only `.w(...)` is set.
- **`EditorState` is state, made in the task that read the file**, like the
  reply field: one built in a render throws, one rebuilt per frame loses the
  scroll. It is released when the file's page closes.
- **A question fence is not always `:::question`.** The Inbox also writes
  `:::question-multi` and `:::question-text`, so `wordsWithoutQuestions`
  matches all three — one that matched the bare fence only drew the whole
  block twice: as plain markdown above the card, and as the card.

## Done when

- `herdr-app check` passes on both copies, and tab-host's `reconcile.log`
  ends with a line naming `tabs=[plannotator]`.
- The button sits at the right end of the tab bar, badge chip on while
  the panel is closed and off when nothing waits; a click or `cmd-alt-i`
  shows this tab and hides it again, and the key lands on this tab even
  when Files was the one showing.
- A thread an agent sends is a row within a second; the dots match the
  Inbox page's buckets; the header chip counts the yellow ones; an empty
  Inbox says so and a stopped one says "The Inbox is not running".
- Opening a thread moves the seen cursor (the blue dot goes) and nothing
  else; a thread with an open question stays yellow.
- A pick fills its ring, the card reads "Picked, not sent", the band says
  "1 answer goes with this reply", Send settles the card and posts the
  words — and the same draft is visible in the browser.
- A reply under words the person never saw is refused with the Inbox's
  own sentence, the words stay, and the thread re-reads to show what
  moved it.
- A message with files shows them: a picture drawn under its words with
  its name and size, every other file a row with its kind's glyph. A click
  opens the file: a document as markdown, code as a code block, a log with
  line numbers, a picture at the panel's width, a video and a web page by
  their browser rows. Esc and the back chevron return to the thread, and a
  file the Inbox no longer has says so and offers the thread.
- Sessions start in the background (no tab, a log per run) and a decision
  becomes one Herdr toast within the second, panel hidden, `__told`
  keeping it single.
- ↑/↓/Return walk the rows; the field holds every key but Esc while the
  caret is in it; two shown copies make one press one run.
- Two spaces keep their own thread and open folders, and each comes back
  with its highlight where it was left.
- With tab-host missing, `install.sh` docks the panel (`place: "right"`)
  and binds `cmd-alt-i` to `layout.toggle:panel`; with tab-host present
  it does neither, reruns swap the two modes, and a person's own
  `cmd-alt-i` binding is kept whatever it is.

- The preview above is a drawing, not a photograph: a poster of the mod
  in the app's own chrome — wordmark, the headline "Plannotator, one tab
  away.", the pitch ("Open the Plannotator Inbox in a Herdr panel
  alongside your agents with `cmd-alt-i`. Or jump into a Plannotator
  review session with keyboard shortcuts."), one sentence a line, then
  two windows, each with the tab bar's Plannotator button carrying its
  `2` badge. The left window is the panel: the thread list with one amber
  question waiting, and the annotate list below it. The right window is
  the thread it opens, the question card answered in place — rings,
  "Recommended", a reply in the band, a Send. Every thread, project and
  path in it is fiction; the palette is sampled from a real screenshot,
  and the drawing is `assets/preview.html` rendered headless at
  1600×1000 (8:5). The photographed truth ships beside it as
  `assets/preview-photographed.png`, and `assets/preview-window.html` is
  the same drawing at the whole-window scale
  (rendered as `assets/preview-window.png`).
