// Plannotator in the tab bar: what is waiting in the Inbox, and its actions.
//
// Herdr can't draw a web page, so every Plannotator surface stays in the person's
// browser. This panel says what waits in the Inbox — its own list of threads, with a
// dot for what each needs: yellow when the Inbox has it waiting on the person, blue
// when it is new since they last looked, grey when it is read — opens the Inbox, and
// starts
// `plannotator last | review | annotate` in the background: the CLI prints the page's
// address, the browser opens it, and the decision comes out at the end of the run's
// log. No tab, no window. Its file tree is how a single file or folder is annotated:
// the space's folder first, then whatever the person opens.
//
// The panel has one home: the side panel's Plannotator tab. `mod.json` declares a
// `tab`, which is a manifest the `tab-host` mod reads — it draws a Plannotator button
// in the tab bar beside Files and Changes and adds a block for this mod to the side
// panel's stack. That copy (no props, no overlay) is the panel, and it is the copy
// that matters most: once the person has opened the tab, it stays alive even while
// the panel is hidden, so its watcher is on screen all the time and a decision becomes
// a Herdr toast the moment it lands. Without `tab-host` the declaration is inert and
// `place: "none"` keeps the mod out of the window.
//
// The same mod still draws its own command palette (`props().mode === "palette"`) and
// a row's menu (`"menu"`) as overlays: the app's palette lists Herdr's commands only,
// so this is the way in by keyboard. Those two are the only copies that float.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import {
  spaces, focused, panes, exec, run, theme, props, openOverlay, closeOverlay,
  notify, watchFolder, pickFolder, home, appHome, nextCommand, keys, shared, setShared,
} from "herdr";

const ICONS = "mods/workspace-chrome";
// The Inbox's store: one folder per project, one JSON record per line. It is watched for
// changes; the list itself is asked of the Inbox server (see `READ`).
const STORE = () => `${home()}/.plannotator/inbox`;
// The number a tab-host button can wear while the panel is collapsed:
// `tab.badge` in `mod.json` names this key, and tab-host draws whatever is in it.
// Nothing reads it today (tab-host has no badge yet — see its `HANDOFF.md`), and
// writing it costs one comparison per read.
const BADGE = "plannotator.waiting";
// The Inbox's own list model, over its loopback server. The records in `STORE` say who
// wrote what; only the Inbox's own arithmetic turns that into "New since you looked",
// "Waiting on you" and "Quiet" — it writes `person_seen_seq`, so it, and not a second
// guess here, is what "unread" means. One `curl`, nothing to install: the port is in
// `inbox.json`, and the route is the one the Inbox page itself opens with.
const READ = String.raw`
cd "$1" || exit 0
[ -f inbox.json ] || exit 0
p=$(sed -n 's/.*"port": *\([0-9][0-9]*\).*/\1/p' inbox.json | head -n 1)
[ -n "$p" ] || exit 0
command -v curl >/dev/null 2>&1 || exit 0
curl -s -m 3 "http://127.0.0.1:$p/api/inbox/threads" || printf '{"error":"The Inbox is not running"}'
`;
// One level of a folder, read once per folder, the first time its row opens.
const LIST = 'cd "$1" || exit 0; n=0; for p in * .[!.]* ..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; '
  + '[ "$p" = .git ] && continue; if [ -d "$p" ] && [ ! -L "$p" ]; then k=d; else k=f; fi; '
  + 'printf "%s\\0%s\\0" "$k" "$p"; n=$((n+1)); [ "$n" -ge 200 ] && break; done';

// Where a background run keeps its log: the address the CLI prints, then the
// decision it ends with. Herdr's own folder for this mod, never the person's.
const RUNS = () => `${appHome()}/data/plannotator/sessions`;

// A session with no tab and no window. The CLI is the same one a terminal would run:
// it prints the page's address (the browser opens by itself) and holds until the
// person decides. Everything to show comes out of the CLI's own output, so nothing
// depends on this mod being on screen: the subshell keeps that output in a log and
// writes `__exit <code>` when the run is over. No desktop notification — the panel's
// tab is always there to turn the log into a Herdr toast (`ANNOUNCE`).
const RUN = `
mkdir -p "$1" || exit 0
cd "$2" || exit 0
log="$1/$3.log"
label="$4"
shift 4
(
  printf '__label %s\\n' "$label" >"$log"
  nohup "$@" >>"$log" 2>&1
  echo "__exit $?" >>"$log"
) >/dev/null 2>&1 &`;

// The runs that ended and were never announced here: a log with `__exit` and no
// `__told`. The label is the log's first line, the decision the JSON the CLI printed
// at its end, and the mark is written as the log is read — with this process's own
// number, then read back: only the copy whose mark is the first one in the log prints,
// so two copies woken at the same instant (the panel, and another copy of it in a
// layout) toast a decision once between them, and neither can lose it by arriving
// second.
const ANNOUNCE = `
mkdir -p "$1" || exit 0
cd "$1" || exit 0
for f in *.log; do
  [ -f "$f" ] || continue
  grep -q '^__exit' "$f" || continue
  grep -q '^__told' "$f" && continue
  mark="__told $$"
  echo "$mark" >>"$f"
  [ "$(grep -m 1 '^__told' "$f")" = "$mark" ] || continue
  label=$(sed -n '1s/^__label //p' "$f")
  word=$(grep -o '"decision": *"[a-z]*"' "$f" | tail -n 1 | cut -d'"' -f4)
  printf '%s: %s\\n' "\${label:-Plannotator}" "\${word:-finished}"
done`;

// Two shown copies (the panel and a tab of the same mod) both get a key command;
// one press must start one run.
let claimed = 0;

// How many waiting threads the panel lists; the rest are one row into the Inbox.
const SHOWN = 5;

// Where this space is now: its focused pane's folder, else where it was made.
function folderOf(space) {
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return pane?.cwd || f?.cwd || space?.folder || null;
}

const space = () => spaces().find((s) => s.active) ?? null;

// A session in the background, in that folder: `label` is what the run calls itself
// (it names the log and the notification), and `args` is the CLI's own argument list.
// `--json` is what makes the decision readable at the end of the log; it changes no
// part of the page the person sees.
function start(args, label, folder) {
  const at = folder ?? folderOf(space());
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  exec("sh", ["-c", RUN, "plannotator", RUNS(), at ?? home(), `${stamp}-${slug}`, label, "plannotator", ...args, "--json"])
    .catch((e) => fail(e?.message));
}

function fail(body) {
  notify({ title: "Plannotator", body: String(body ?? "Plannotator did not start").trim().slice(0, 200), level: "error" });
}

// `plannotator inbox --open` starts a stopped Inbox and returns at once.
function openInbox() {
  exec("plannotator", ["inbox", "--open"]).then((r) => {
    if (r.code !== 0) fail(r.stderr || r.stdout || "The Inbox did not open");
  }).catch((e) => fail(e?.message));
}

// Each thread, with the dot it gets: `answer` when something in it is still open for
// the person, `unread` when the Inbox says it is new since they last looked, `read`
// otherwise.
//
// The Inbox's own rows, in its own buckets: "Stopped on you", "Holding up work",
// "Waiting on you", "New since you looked", "Sent", "Quiet". A row's bucket *is* its
// read state — the Inbox keeps the seen cursor and decides when a thread wants the
// person — so the dots are its answer, not a second guess at one. Six buckets fold into
// three; nothing here second-guesses the Inbox's order of precedence (a thread it has
// marked read stays quiet even with a question in it: the person has seen that one).
function stateOf(section) {
  if (section === "stopped" || section === "holding" || section === "waiting") return "answer";
  return section === "new" ? "unread" : "read";
}

function readThreads(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return [];
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  if (data?.error) throw new Error(String(data.error));
  if (!Array.isArray(data?.sections)) throw new Error("The Inbox answered in an unknown shape");
  // A row carries its project's id and name; the folder the space is in comes from the
  // projects list, which is the only place `root` lives.
  const roots = new Map((data.projects ?? []).map((p) => [p.id, p.root ?? null]));
  const list = [];
  for (const section of data.sections) {
    for (const row of section.threads ?? []) {
      if (!row?.thread_id) continue;
      const project = row.project ?? {};
      list.push({
        id: row.thread_id,
        at: Date.parse(row.last_at) || Date.parse(row.created_at) || 0,
        subject: row.subject || row.thread_name || "(no subject)",
        state: stateOf(section.id),
        project: {
          key: project.id ?? project.name ?? "",
          name: project.name ?? "",
          root: roots.get(project.id) ?? null,
        },
      });
    }
  }
  // What needs an answer first, then what is new, then what is settled; newest first
  // inside each group, so the ages still read down the list.
  const rank = { answer: 0, unread: 1, read: 2 };
  return list.sort((a, b) => rank[a.state] - rank[b.state] || b.at - a.at);
}

// A folder's children, folders first: `d`/`f` and a name, NUL-separated.
function entries(stdout) {
  const out = [], fields = String(stdout ?? "").split("\0");
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i + 1]) out.push({ dir: fields[i] === "d", name: fields[i + 1] });
  }
  return out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 10080) return `${Math.floor(m / 1440)}d`;
  return `${Math.floor(m / 10080)}w`;
}

// A subsequence score, the way a palette reads; null when q isn't there at all.
function fuzzy(q, text) {
  const t = text.toLowerCase();
  let at = 0, score = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, at);
    if (i < 0) return null;
    score += 1 + (i === 0 || /[\s:.\-_/]/.test(t[i - 1]) ? 5 : 0);
    at = i + 1;
  }
  return score - text.length * 0.01;
}

export default class Plannotator extends View {
  init(_props, cx) {
    this.mode = props()?.mode ?? "panel";
    this.palette = this.mode === "palette";
    this.threads = [];
    this.folder = null;
    // The tree: each folder's children, which of them are open, the ones being read.
    this.kids = new Map();
    this.open = new Set();
    this.reading = new Set();
    this.ready = false;
    this.error = null;
    this.at = 0;
    // `at` is the palette's highlighted row; `cursor` is the panel's.
    this.cursor = 0;
    // A launch closes the popup it was picked from; the close must land once.
    this.closed = false;
    // The panel is a tab in the side panel, so it takes the keyboard when it is clicked
    // into, not on its first render: the panel appearing must not pull the keys out of
    // the terminal that opened it. `mod.json`'s `focusable: true` is what lets
    // `pane.go` hand them over.
    this.handle = cx.focus_handle();
    if (this.palette) {
      this.input = InputState.new({ placeholder: "Annotate, review, open the Inbox…" });
      this.input.on("change", (_e, cx) => { this.at = 0; cx.notify(); });
      this.input.on("submit", (_e, cx) => this.go(this.rows()[this.at]?.id, cx));
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
    }
    if (this.mode === "menu") this.handle.focus();
    // The palette and the menus hold no data of their own: the panel reads the store.
    if (this.mode !== "panel") return;
    this.reload(cx);
    // What the runs decided while the panel was shut is the first thing it says.
    this.announce(cx);
    // The store is live: a message anywhere in it shows up at once, no polling.
    cx.spawn(async (cx) => {
      for (;;) {
        try { await watchFolder(`${STORE()}/projects`); } catch { return; }
        this.reload(cx);
      }
    });
    // So are the runs: a decision that lands while the panel is open is a toast as
    // soon as its log ends, and the minute timer picks up whatever a watcher missed.
    cx.spawn(async (cx) => {
      for (;;) {
        try { await watchFolder(RUNS()); } catch { return; }
        this.announce(cx);
      }
    });
    // Ages ("2h") and an Inbox that starts later need no watcher; this reads, it doesn't spin.
    cx.timer.every(60000, (cx) => { this.reload(cx); this.announce(cx); });
    // keys.json sends `plannotator.palette | last | review | annotate | inbox` here,
    // and `focus` when a popup over the window closes.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") { if (this.mode === "panel") this.handle.focus(); continue; }
        const now = Date.now();
        if (now - claimed < 500) continue;
        claimed = now;
        const at = folderOf(space());
        if (command === "palette") this.openPalette();
        else if (command === "last") this.launch(() => start(["last"], "Last message"));
        else if (command === "review") this.launch(() => start(["review"], "Review changes"));
        else if (command === "annotate") {
          this.launch(() => (at ? start(["annotate", at], "Annotate all files") : this.pick()));
        } else if (command === "inbox") this.launch(() => openInbox());
        cx.notify();
      }
    });
  }

  reload(cx) {
    const at = folderOf(space());
    if (at !== this.folder) {
      this.folder = at;
      this.kids = new Map();
      this.open = new Set();
      this.reading = new Set();
      // The space's own folder is read at once (its count, and an instant open);
      // every folder under it is read when its row opens.
      if (at) this.load(at, cx);
    }
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", READ, "plannotator", STORE()]);
        if (r.code !== 0) throw new Error(r.stderr || "Cannot read the Plannotator Inbox");
        this.threads = readThreads(r.stdout);
        this.error = null;
        // What the tab bar may show while this panel is collapsed. `setShared`
        // re-renders every mod, so it is written only when the number changes.
        const want = this.threads.filter((t) => t.state === "answer").length;
        if (shared(BADGE) !== want) setShared(BADGE, want);
      } catch (e) {
        this.error = String(e?.message ?? e).split("\n")[0].slice(0, 160);
      } finally {
        this.ready = true;
        cx.notify();
      }
    });
  }

  // A run that ended is announced in Herdr's own toast. The desktop banner said so
  // when it happened; this says it again the moment a copy of this mod is on screen,
  // which is the only time a mod can post one — a closed panel has no code at all.
  // `ANNOUNCE` marks each log it reads, so nothing is announced twice.
  announce(cx) {
    cx.spawn(async () => {
      let out;
      try {
        out = await exec("sh", ["-c", ANNOUNCE, "plannotator", RUNS()]);
      } catch {
        return;
      }
      if (out.code !== 0) return;
      const lines = String(out.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
      for (const line of lines.slice(0, 3)) notify({ title: "Plannotator", body: line });
      if (lines.length > 3) notify({ title: "Plannotator", body: `${lines.length - 3} more in the sessions folder` });
    });
  }

  // A folder's children, once: the tree keeps them while it is open.
  load(path, cx) {
    if (this.reading.has(path) || this.kids.has(path)) return;
    this.reading.add(path);
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", LIST, "plannotator", path]);
        if (r.code !== 0) throw new Error(r.stderr);
        this.kids.set(path, entries(r.stdout));
      } catch {
        this.kids.set(path, []);
      } finally {
        this.reading.delete(path);
        cx.notify();
      }
    });
  }

  // A folder's row opens and closes it; nothing is read twice.
  toggle(path, cx) {
    if (this.open.has(path)) this.open.delete(path);
    else {
      this.open.add(path);
      this.load(path, cx);
    }
    cx.notify();
  }

  annotate(path, dir) {
    const folder = dir ? path : path.replace(/\/[^/]+$/, "");
    start(["annotate", path], dir ? "Annotate folder" : "Annotate file", folder);
  }

  // The tree's visible rows, in the order they draw: the space folder's children,
  // then the open folders' under them. Drawing and keys both read this one list.
  treeRows() {
    const rows = [];
    const walk = (path, depth) => {
      for (const e of this.kids.get(path) ?? []) {
        const child = `${path}/${e.name}`;
        rows.push({ path: child, name: e.name, dir: e.dir, depth });
        if (e.dir && this.open.has(child)) walk(child, depth + 1);
      }
    };
    if (this.folder && this.open.has(this.folder)) walk(this.folder, 1);
    return rows;
  }

  // This mod, as its own palette: a popup over the window, closed by Esc or a pick.
  openPalette() {
    openOverlay({ mod: "plannotator", kind: "popup", width: 520, height: 340, props: { mode: "palette" } });
  }

  // A file's or folder's menu: annotate it, the space's folder, or its changes.
  openMenu(path, dir) {
    openOverlay({ mod: "plannotator", kind: "popup", width: 300, props: { mode: "menu", path, dir } });
  }

  // The palette and a row's menu are the overlays this mod opens, so they are the only
  // copies with something to close: `props().overlay` is their own id.
  close() {
    const overlay = props()?.overlay;
    if (!overlay || this.closed) return false;
    this.closed = true;
    closeOverlay(overlay);
    return true;
  }

  // A pick hands the person to a page in their browser, so the popup it was picked from
  // steps aside behind it. The panel has no overlay, so there it is quiet.
  launch(fn) {
    this.close();
    fn();
  }

  // Herdr has a folder picker, not a file one: a file comes from the panel's own
  // list (right-click) or a path typed into the Inbox.
  pick() {
    pickFolder({ prompt: "Annotate" }).then((path) => {
      if (path) start(["annotate", path], "Annotate folder", path);
    }).catch((e) => fail(e?.message));
  }

  // Every row the panel draws that can be picked, top to bottom, by id: the threads,
  // then the annotate rows, then the tree. The keys walk this
  // order, so the row that is highlighted is always the row Return runs.
  rowIds() {
    const ids = [];
    for (let i = 0; i < Math.min(this.threads.length, SHOWN); i++) ids.push(`t${i}`);
    if (this.threads.length > SHOWN) ids.push("more");
    ids.push("last", "review");
    if (this.folder) {
      ids.push("space", "tree");
      for (const row of this.treeRows()) ids.push(`f:${row.path}`);
    }
    ids.push("pick");
    return ids;
  }

  // Return on the highlighted row: folders open, everything else hands the person
  // to the browser and takes the window down with it.
  runRow(id, cx) {
    if (!id) return;
    if (/^t\d+$/.test(id) || id === "more") return this.launch(() => openInbox());
    if (id.startsWith("f:")) {
      const row = this.treeRows().find((r) => r.path === id.slice(2));
      if (!row) return;
      if (row.dir) this.toggle(row.path, cx);
      else this.launch(() => this.annotate(row.path, false));
      return;
    }
    const at = this.folder;
    if (id === "last") return this.launch(() => start(["last"], "Last message"));
    if (id === "review") return this.launch(() => start(["review"], "Review changes"));
    if (id === "space" && at) return this.launch(() => this.annotate(at, true));
    if (id === "tree" && at) return this.toggle(at, cx);
    if (id === "pick") return this.launch(() => this.pick());
  }

  rows() {
    const at = folderOf(space()), s = space(), near = at ? at.replace(home(), "~") : null;
    const list = [
      { id: "last", title: "Annotate the last message", words: "last message reply agent session", icon: "square-pen",
        key: "last", run: () => start(["last"], "Last message") },
      { id: "review", title: "Review my changes", words: "review diff git approve merge", icon: "git-compare",
        key: "review", run: () => start(["review"], "Review changes") },
      { id: "annotate", title: "Annotate all files", words: `annotate folder space ${at ?? ""}`, icon: "folder",
        key: "annotate", hint: near, run: () => (at ? start(["annotate", at], "Annotate all files") : this.pick()) },
      { id: "pick", title: "Annotate another folder…", words: "annotate folder pick markdown html url", icon: "folder-plus",
        key: null, run: () => this.pick() },
      { id: "inbox", title: "Open the Inbox", words: "inbox threads messages questions waiting", icon: "file-text",
        key: "inbox", run: () => openInbox() },
      { id: "tab", title: "Open Plannotator as a tab", words: "tab panel wide full", icon: "panel-right",
        key: null, run: () => {
          const tab = { mod: "plannotator", name: "Plannotator" };
          if (s?.id) tab.space = s.id;
          run("tab.new", tab);
        } },
    ];
    if (!this.palette) return list;
    const q = String(this.input?.value() ?? "").trim().toLowerCase().replace(/\s+/g, "");
    if (!q) return list;
    return list
      .map((r) => { const score = fuzzy(q, `${r.title} ${r.words}`); return score === null ? null : { ...r, score }; })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
  }

  go(id, cx) {
    const row = this.rows().find((r) => r.id === id);
    this.close();
    row?.run();
    cx?.notify();
  }

  iconButton(id, icon, action) {
    const t = theme();
    return div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(action)
      .child(svg(`${ICONS}/${icon}.svg`).size(14));
  }

  // ---- the palette ----

  renderPalette() {
    const t = theme(), rows = this.rows();
    if (this.at > rows.length - 1) this.at = Math.max(0, rows.length - 1);
    const bound = keys() ?? [];
    const keyOf = (id) => {
      const k = bound.find((b) => b.section === "global" && b.action === `plannotator.${id}`);
      return k?.keys ?? "";
    };
    // A popup is as big as its content, and this one's rows live in a `flex_1` column:
    // without a height of its own the popup is the search line and nothing else.
    return v_flex().id("pl-palette").track_focus(this.handle).w(520).h(340).flex_none().min_h(0).gap(8).p(10).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        // Stops at the ends, as Herdr's own palette does: wrapping jumps out of sight.
        if (e.key === "down") this.at = Math.min(this.at + 1, Math.max(0, rows.length - 1));
        else if (e.key === "up") this.at = Math.max(this.at - 1, 0);
        else if (e.key === "enter") this.go(rows[this.at]?.id, cx);
        else if (e.key === "escape") this.close();
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().id("pl-search").h(36).px(10).gap(10).flex_none().items_center().rounded(9).border_1()
        .border_color(t.accent).bg(t.background)
        .child(svg(`${ICONS}/search.svg`).size(16).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).child(Input.new(this.input)))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(v_flex().id("pl-rows").flex_1().min_h(0).overflow_y_scrollbar()
        .children(rows.map((r, i) =>
          h_flex().id(`pl-${r.id}`).h(34).flex_none().px(9).gap(9).rounded(7).items_center().cursor_pointer()
            .when(i === this.at, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.go(r.id, cx))
            .child(svg(`${ICONS}/${r.icon}.svg`).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().min_w(0).truncate().text_color(i === this.at ? t.foreground : t.muted).child(r.title))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(r.hint ?? keyOf(r.key ?? "")))))
        .when(rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("No Plannotator command matches"))));
  }

  // ---- the panel ----

  renderPanel() {
    const t = theme(), at = this.folder, near = at ? at.replace(home(), "~") : null;
    const waiting = this.threads.slice(0, SHOWN), more = this.threads.length - waiting.length;
    // The chip counts what needs an answer, the one thing the dots say has to be acted on.
    const needs = this.threads.filter((th) => th.state === "answer").length;
    // A thread's dot: yellow when it asks something, blue when the agent spoke last,
    // grey when the person did. `ansi3`/`ansi4` rather than a named colour so the two
    // stay yellow and blue in every theme, the way a terminal's own palette has them.
    const dot = { answer: t.ansi3, unread: t.ansi4, read: t.dim };
    const open = Boolean(at && this.open.has(at));
    const kids = (path) => this.kids.get(path) ?? [];
    // The row the keys are on. One list for drawing and keys: the highlight can't
    // drift from what Return does.
    const ids = this.rowIds(), sel = (id) => ids[this.cursor] === id;
    // A click on a row that stays open (a folder) moves the keys there too, so the
    // highlight and the mouse never point at two different rows.
    const hit = (id) => { const i = ids.indexOf(id); if (i >= 0) this.cursor = i; };
    const here = (th) => {
      const root = th.project?.root;
      return Boolean(root && at && (at === root || at.startsWith(`${root}/`) || root.startsWith(`${at}/`)));
    };
    // A tree row: a folder's chevron and name open it, a file's name annotates it,
    // and the pen on a folder's right annotates that folder (as the menu says).
    const node = (path, name, dir, depth) => {
      const expanded = this.open.has(path);
      return h_flex().id(`pl-f-${path}`).h(24).flex_none().mx(6).pr(8).gap(6).rounded(6).items_center()
        .pl(20 + Math.min(depth, 8) * 12)
        .when(sel(`f:${path}`), (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover)).cursor_pointer()
        .on_click((_e, cx) => {
          if (!dir) return this.launch(() => this.annotate(path, false));
          hit(`f:${path}`);
          this.toggle(path, cx);
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openMenu(path, dir); })
        .when(dir, (el) => el.child(svg(`${ICONS}/${expanded ? "chevron-down" : "chevron-right"}.svg`)
          .size(12).flex_none().text_color(t.dim)))
        .when(!dir, (el) => el.child(div().flex_none().w(12).h(12)))
        .child(svg(`${ICONS}/${dir ? "folder" : "file-text"}.svg`).size(13).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(name))
        .when(dir, (el) => el.child(div().id(`pl-pen-${path}`).size(18).flex_none().flex().items_center()
          .justify_center().rounded(5).text_color(t.dim)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(() => this.launch(() => this.annotate(path, true)))
          .child(svg(`${ICONS}/square-pen.svg`).size(12))));
    };
    // Every row the tree shows, as the tree lists them.
    const rows = this.treeRows().map((e) => node(e.path, e.name, e.dir, e.depth));
    // One of the annotate things: a 14 px icon, the name, hover fills.
    const action = (id, icon, label, go) => h_flex().id(`pl-a-${id}`).h(30).flex_none().px(14).gap(9).items_center()
      .when(sel(id), (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover)).cursor_pointer().on_click(() => this.launch(go))
      .child(svg(`${ICONS}/${icon}.svg`).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().text_color(sel(id) ? t.foreground : t.muted).child(label));
    const label = (text) => h_flex().h(24).flex_none().px(14).items_center()
      .child(div().flex_1().text_size(11).text_color(t.dim).child(text));
    // The panel is a card of its own, the way Files and Changes are: rounded 10, a 1 px
    // border, the theme's background.
    return v_flex().id("root").size_full().min_h(0).overflow_hidden()
      .rounded(10).bg(t.background).border_1().border_color(t.border)
      // One list of rows and one set of keys, the same in the panel and in the palette
      // that opens over it. The panel gets the keyboard on a click; Esc has nothing to
      // close there, so it is left to the app.
      .track_focus(this.handle).on_key_down((e, cx) => {
        // Stops at the ends, as the palette does: wrapping jumps out of sight.
        const last = Math.max(0, ids.length - 1);
        if (this.cursor > last) this.cursor = last;
        if (e.key === "down") this.cursor = Math.min(this.cursor + 1, last);
        else if (e.key === "up") this.cursor = Math.max(this.cursor - 1, 0);
        else if (e.key === "enter") this.runRow(ids[this.cursor], cx);
        else if (e.key === "escape") { if (!this.close()) return; }
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .text_size(13).text_color(t.foreground)
      .child(h_flex().id("pl-head").h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Plannotator"))
        .when(needs > 0, (el) => el.child(div().px(6).rounded(99).bg(t.accent).text_color(t.accent_foreground)
          .text_size(10.5).child(String(needs))))
        .child(div().flex_1())
        .child(this.iconButton("pl-palette", "search", () => this.openPalette()))
        .child(this.iconButton("pl-open", "file-text", () => this.launch(() => openInbox()))))
      .child(v_flex().id("pl-scroll").flex_1().min_h(0).overflow_y_scrollbar().items_center()
        .child(v_flex().id("pl-body").w_full().max_w(760).py(4).pb(10)
          .child(label("Threads"))
          .when(waiting.length === 0, (el) => el.child(v_flex().px(14).py(6).gap(3)
            .child(div().text_color(t.muted).child(this.ready ? "No threads yet" : "Reading the Inbox…"))
            .child(div().text_size(11.5).text_color(t.dim).child("Agents leave questions and summaries in the Inbox."))
            .when(Boolean(this.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.error)))))
          // Rows can outlive a good read: if the next one fails, say so above them
          // rather than dropping the list the person is looking at.
          .when(Boolean(this.error) && waiting.length > 0,
            (el) => el.child(div().mx(14).mb(4).text_size(11.5).text_color(t.blocked).truncate().child(this.error)))
          .children(waiting.map((th, i) =>
            v_flex().id(`pl-t-${i}`).flex_none().px(12).py(6).mx(6).gap(2).rounded(7)
              .when(sel(`t${i}`), (el) => el.bg(t.selected))
              .hover((s) => s.bg(t.hover)).cursor_pointer().on_click(() => this.launch(() => openInbox()))
              .child(h_flex().gap(6).items_center()
                .child(div().flex_none().size(7).rounded(99).bg(dot[th.state] ?? t.dim))
                .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(here(th) ? t.accent : t.dim)
                  .child(th.project?.name ?? ""))
                .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(th.at))))
              .child(div().truncate().text_color(t.muted).child(th.subject || "(no subject)"))))
          .when(more > 0, (el) => el.child(h_flex().id("pl-more").h(28).flex_none().mx(6).px(12).items_center().rounded(7)
            .when(sel("more"), (s) => s.bg(t.selected))
            .hover((s) => s.bg(t.hover)).cursor_pointer().on_click(() => this.launch(() => openInbox()))
            .child(div().text_size(11.5).text_color(t.dim).child(`${more} more in the Inbox`))))
          .child(h_flex().h(24).flex_none().px(14).mt(10).items_center()
            .child(div().flex_1().text_size(11).text_color(t.dim).child("Annotate")))
          .child(action("last", "square-pen", "Last message", () => start(["last"], "Last message")))
          .child(action("review", "git-compare", "Review changes", () => start(["review"], "Review changes")))
          // "This space" is one of the annotate rows: same height, icon and type as
          // the two above it, the folder it means at its right, and a click annotates
          // all of it. The tree under it is for picking one file.
          .when(Boolean(at), (el) => el
            .child(h_flex().id("pl-space").h(30).flex_none().px(14).gap(9).items_center()
              .when(sel("space"), (s) => s.bg(t.selected))
              .hover((s) => s.bg(t.hover)).cursor_pointer()
              .on_click(() => this.launch(() => this.annotate(at, true)))
              .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openMenu(at, true); })
              .child(svg(`${ICONS}/layers.svg`).size(14).flex_none().text_color(t.muted))
              .child(div().flex_none().text_color(sel("space") ? t.foreground : t.muted).child("This space"))
              .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(near ?? "")))
            .child(h_flex().id("pl-tree").h(26).flex_none().mx(6).pl(20).pr(8).gap(6).rounded(6).items_center()
              .when(sel("tree"), (s) => s.bg(t.selected))
              .hover((s) => s.bg(t.hover)).cursor_pointer().on_click((_e, cx) => { hit("tree"); this.toggle(at, cx); })
              .child(svg(`${ICONS}/${open ? "chevron-down" : "chevron-right"}.svg`).size(12).flex_none().text_color(t.dim))
              .child(svg(`${ICONS}/files.svg`).size(13).flex_none().text_color(t.muted))
              .child(div().flex_1().min_w(0).truncate().text_color(t.muted)
                .child(open ? "Files" : `Files · ${this.kids.has(at) ? kids(at).length : "…"}`)))
            .children(rows))
          .child(action("pick", "folder-plus", "Another folder…", () => this.pick()))))
  }

  // ---- a file's menu ----

  renderMenu() {
    const t = theme(), p = props() ?? {}, path = String(p.path ?? ""), dir = Boolean(p.dir);
    const parent = dir ? path : path.replace(/\/[^/]+$/, "");
    const spaceFolder = this.folder;
    const items = [
      { icon: dir ? "folder" : "square-pen", label: dir ? "Annotate this folder" : "Annotate this file", run: () => this.annotate(path, dir) },
      ...(spaceFolder && spaceFolder !== path ? [{ icon: "layers", label: "Annotate all files",
        run: () => start(["annotate", spaceFolder], "Annotate all files", spaceFolder) }] : []),
      { icon: "git-compare", label: "Review changes here", run: () => start(["review"], "Review changes", parent) },
    ];
    return v_flex().id("pl-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        this.close();
        cx.notify();
      })
      .child(div().px(8).pb(4).text_size(11).text_color(t.dim).truncate().child(path.replace(home(), "~")))
      .children(items.map((it, i) =>
        h_flex().id(`pl-m-${i}`).h(31).flex_none().px(8).gap(9).rounded(7).items_center()
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.launch(it.run))
          .child(svg(`${ICONS}/${it.icon}.svg`).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().min_w(0).truncate().child(it.label))));
  }

  render() {
    if (this.mode === "palette") return this.renderPalette();
    if (this.mode === "menu") return this.renderMenu();
    return this.renderPanel();
  }
}
