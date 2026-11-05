// Plannotator in the tab bar: what is waiting in the Inbox, its threads, and its actions.
//
// Herdr can't draw a web page, so every Plannotator surface stays in the person's
// browser. This panel says what waits in the Inbox — its own list of threads, with a
// dot for what each needs: yellow when the Inbox has it waiting on the person, blue
// when it is new since they last looked, grey when it is read — reads a thread's
// messages in the panel, with the files an agent attached in them (a picture drawn, a
// document one click from its own page), opens the Inbox, and starts
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

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView, TextareaState, Textarea, EditorState, Editor } from "gpui-base";
import {
  spaces, focused, panes, exec, run, theme, props, openOverlay, closeOverlay,
  notify, watchFolder, pickFolder, home, appHome, nextCommand, keys, shared, setShared,
  readTextFile,
} from "herdr";

const ICONS = "mods/workspace-chrome";
// This mod's own glyphs, beside `icon.svg`: a picture, a film and a code mark, for the
// kinds of file the shipped set has no shape for.
const OWN = "mods/plannotator";
// Where an attached file is kept so the panel can draw it: the Inbox's own bytes, copied
// once into the app's folder. `image()` reads the app's folder and nothing outside it,
// so a path in the person's home draws nothing at all — and the path an agent named is
// usually gone by the time the person reads the thread anyway.
const ATT = () => `${appHome()}/data/plannotator/att`;
// The Inbox's store: one folder per project, one JSON record per line. It is watched for
// changes; the list itself is asked of the Inbox server (see `READ`).
const STORE = () => `${home()}/.plannotator/inbox`;
// The number a tab-host button can wear while the panel is collapsed:
// `tab.badge` in `mod.json` names this key, and tab-host draws whatever is in it
// as a chip after the label. It is written only when the number changes, because
// `setShared` re-renders every mod.
const BADGE = "plannotator.waiting";
// The panel's view, kept where tab-host can carry it from space to space:
// `tab.state` in `mod.json` names this key, and tab-host keeps one value of it per
// space — the space being left keeps its value, the one arriving gets its own back.
// `saveState` writes it from the panel's own doings, `syncState` adopts it in
// render(); null (or nothing there) is a fresh panel.
const STATE = "plannotator.state";
// The Inbox's own list model, over its loopback server. The records in `STORE` say who
// wrote what; only the Inbox's own arithmetic turns that into "New since you looked",
// "Waiting on you" and "Quiet" — it writes `person_seen_seq`, so it, and not a second
// guess here, is what "unread" means — and only its own window model holds a thread's
// messages. One `curl`, nothing to install: the port is in `inbox.json`, and the
// routes are the ones the Inbox page itself opens with. `$2` is the method, `$3` the
// route under `/api/inbox/`, and `$4` the JSON a POST carries.
const ASK = String.raw`
cd "$1" || exit 0
[ -f inbox.json ] || { printf '{"error":"The Inbox is not running"}'; exit 0; }
p=$(sed -n 's/.*"port": *\([0-9][0-9]*\).*/\1/p' inbox.json | head -n 1)
[ -n "$p" ] || { printf '{"error":"The Inbox is not running"}'; exit 0; }
command -v curl >/dev/null 2>&1 || { printf '{"error":"curl is missing"}'; exit 0; }
if [ "$2" = POST ]; then
  out=$(curl -s -m 5 -X POST -H 'Content-Type: application/json' -d "$4" "http://127.0.0.1:$p/api/inbox/$3") || out='{"error":"The Inbox did not answer"}'
else
  out=$(curl -s -m 5 "http://127.0.0.1:$p/api/inbox/$3") || out='{"error":"The Inbox did not answer"}'
fi
printf '%s' "$out"
`;
// One attachment's own bytes, once, where the panel can draw them. The Inbox hands a
// sent file back at `attachments/<id>` (its words) or `<id>/image`, `<id>/video` (its
// bytes), and `?version=sent` asks for the copy it kept. `$2` is that route, `$3` the
// file to write, and a file already there is the answer: a sent attachment never
// changes, which is why the name it is cached under carries its hash.
const PULL = String.raw`
cd "$1" || exit 0
[ -f inbox.json ] || { printf '{"error":"The Inbox is not running"}'; exit 0; }
p=$(sed -n 's/.*"port": *\([0-9][0-9]*\).*/\1/p' inbox.json | head -n 1)
[ -n "$p" ] || { printf '{"error":"The Inbox is not running"}'; exit 0; }
command -v curl >/dev/null 2>&1 || { printf '{"error":"curl is missing"}'; exit 0; }
[ -s "$3" ] && { printf '{"ok":1}'; exit 0; }
mkdir -p "$(dirname "$3")" 2>/dev/null
code=$(curl -s -m 30 -o "$3" -w '%{http_code}' "http://127.0.0.1:$p/api/inbox/$2") || code=000
[ "$code" = 200 ] && [ -s "$3" ] && { printf '{"ok":1}'; exit 0; }
msg=$(sed -n 's/.*"error":"\([^"]*\)".*/\1/p' "$3" 2>/dev/null | head -n 1)
rm -f "$3"
[ -n "$msg" ] || msg="The Inbox did not hand over this file"
printf '{"error":"%s"}' "$(printf '%s' "$msg" | tr -d '"')"
`;
// A picture an agent wrote into its message, copied where the panel can draw it: `$1` is
// the path the agent named, `$2` the folder to copy it into, and the name it lands under
// is made from that path. Unlike an attachment this copy can go stale — the path is a
// file the agent may write again — so a copy older than its source is replaced, and the
// page prints the path it wrote for the caller to hand to `image()`.
const COPY = `
src="$1"
dir="$2"
[ -f "$src" ] || { printf '{"error":"missing"}'; exit 0; }
[ -r "$src" ] || { printf '{"error":"unreadable"}'; exit 0; }
ext=bin
case "$src" in
  *.*) leaf="\${src##*/}"; ext="\${leaf##*.}" ;;
esac
key=$(printf '%s' "$src" | cksum | cut -d' ' -f1)
dest="$dir/$key.$ext"
if [ ! -f "$dest" ] || [ "$src" -nt "$dest" ]; then
  mkdir -p "$dir" 2>/dev/null
  cp "$src" "$dest" 2>/dev/null || { printf '{"error":"copy"}'; exit 0; }
fi
printf '{"ok":1,"file":"%s"}' "$dest"
`;
// The Inbox in the person's browser, on one page of it: `$1` is the page's own hash
// route — `thread=<id>`, or empty for the list — or, when it starts with `/`, one of
// the Inbox's own resources (the video an agent attached, say) to open as it is.
// `--background` is what keeps this to
// one tab: it prints a running Inbox's address, or starts a stopped one without a
// browser, and opens nothing, so the address can carry the route. With no browser
// command at all (a remote session) the address is printed and the panel toasts it.
const OPEN = `
url=$(plannotator inbox --background 2>/dev/null) || exit 0
[ -n "$url" ] || exit 0
case "$1" in
  /*) href="\${url%/}$1" ;;
  *) href="$url#$1" ;;
esac
if command -v open >/dev/null 2>&1 && open "$href" 2>/dev/null; then exit 0; fi
if command -v xdg-open >/dev/null 2>&1 && xdg-open "$href" >/dev/null 2>&1; then exit 0; fi
printf '%s' "$href"
exit 1
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

// The Inbox, asked once: `asked("GET", "threads")`, or a POST with its body. Its
// answer is JSON either way, and a refusal is `{error}` with a code — both become one
// thrown sentence, so a stale Inbox is a line in the panel rather than a stack.
async function asked(method, route, body) {
  const argv = ["-c", ASK, "plannotator", STORE(), method, route];
  if (body !== undefined) argv.push(JSON.stringify(body));
  const r = await exec("sh", argv);
  let data;
  try { data = JSON.parse(String(r.stdout ?? "").trim()); } catch {
    throw new Error(String(r.stderr ?? "").trim().split("\n")[0] || "The Inbox did not answer");
  }
  if (data?.error) throw new Error(String(data.error));
  return data;
}

// The Inbox in the person's browser: the list, or one thread of it (`at` is the page's own
// route, `thread=<id>`), or one of its resources — a video, a picture — when `at` starts
// with `/`. Nothing is closed and no tab is left behind — `OPEN` starts a stopped Inbox
// without a browser, so there is one tab, on the page the person asked for. No browser
// command answers in a remote session: the address is what the toast says instead.
function openInbox(at = "") {
  exec("sh", ["-c", OPEN, "plannotator", at]).then((r) => {
    if (r.code === 0) return;
    const where = String(r.stdout ?? "").trim();
    if (where) notify({ title: "Plannotator", body: where });
    else fail(r.stderr || "The Inbox did not open");
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

function readThreads(data) {
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

// The glyph a kind of file wears: this mod's own for the shapes the shipped set has
// none of, the document glyph for everything that is read as words.
function glyphOf(kind) {
  if (kind === "image") return `${OWN}/image.svg`;
  if (kind === "video") return `${OWN}/video.svg`;
  if (kind === "code") return `${OWN}/code.svg`;
  return `${ICONS}/file-text.svg`;
}

// A file's size the way a person reads one: "640 B", "6.4 KB", "1.2 MB".
function sizeOf(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return n < 10240 ? `${(n / 1024).toFixed(1)} KB` : `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// The extension a copied file is named by: the code view reads the name to know what it
// was handed, and a picture's bytes are sniffed the same way.
function extOf(name) {
  const m = String(name ?? "").toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1] : "bin";
}

// The code view's language, by extension. Anything unlisted is plain text, which is what
// an unknown language would fall back to anyway.
const LANGUAGES = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", json: "json", py: "python", rb: "ruby",
  sh: "shell", bash: "shell", zsh: "shell", css: "css", scss: "css", html: "html",
  yml: "yaml", yaml: "yaml", toml: "toml", rs: "rust", go: "go", java: "java",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", sql: "sql", xml: "xml",
  md: "markdown", r: "r", swift: "swift", kt: "kotlin", php: "php", lua: "lua",
};

function languageOf(name) {
  return LANGUAGES[extOf(name)] ?? null;
}

// A video's length, as a player shows it: "0:40".
function durationOf(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s <= 0) return null;
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

// The kinds whose words the panel reads for itself: the Inbox hands over the text of a
// sent file, and each of these is drawn from it. A picture and a video are bytes, not
// words.
function readable(kind) {
  return kind === "markdown" || kind === "text" || kind === "code" || kind === "html";
}

// Whether a text file is drawn as a markdown document rather than in the code view: a
// markdown file is the one kind the viewer renders — headings, links, its own code blocks
// — and everything else that is code or a patch reads better with line numbers and a
// scroll of its own, so it goes to the code view.
function asDocument(a) {
  // A file too big to lay out as one block is listed with line numbers instead: the viewer
  // would have to draw every line of it before the person could scroll.
  if ((Number(a?.size) || 0) > 500000) return false;
  return a?.kind === "markdown" || /^(?:md|markdown)$/.test(extOf(a?.name));
}

// The newest `seq` a thread's messages carry: the cursor both the seen request and a
// reply's staleness guard are written against.
function newestSeqOf(messages) {
  return (messages ?? []).reduce((most, m) => Math.max(most, Number(m?.seq) || 0), 0);
}

// The message an answer goes to: the last one an agent wrote. A person's own message
// ends the thread when they spoke last, and its reply is still the agent's last word.
function lastAgentOf(messages) {
  const list = messages ?? [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.author?.kind === "agent") return list[i];
  }
  return null;
}

// A message's words, as the panel can draw them, and the pictures it wrote into them.
//
// The agents write in markdown, and `TextView` renders it — lists, tables and code
// included — so only the two things it cannot do come off. `:::question` and
// `:::action` are the Inbox's own block fences: the picks under them need the page,
// but the words are the agent's, and the `- [ ]` choices and `Recommended:` line read
// as what was asked. A picture is a path in the person's own files
// (`![alt](/abs/a.png)`, or one relative to the project), which `TextView` cannot load:
// it comes off the words and is drawn under them instead, pulled off the disk the way
// an attachment is. Its alt text goes with it — the Inbox names those files
// (`pasted-image-2026-11-03-1452`), so a sentence with two pictures in it would carry
// two filenames through the middle of it.
function wordsOf(body) {
  const pictures = [];
  const text = String(body ?? "")
    .replace(/^:::[a-z-]*[^\n]*$/gm, "")
    .replace(/!\[([^\]]*)\]\(([^)\s]*)\)/g, (_all, alt, url) => {
      if (url) pictures.push({ alt: String(alt ?? "").trim(), url });
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, pictures };
}

// Where an inline picture is on disk: the path the agent wrote, absolute or relative to
// the project the thread is about, and nothing at all for a `data:` or an `http(s)` URL —
// those are not files the panel can hand to `image()`.
function pictureAt(url, root) {
  const u = String(url ?? "").trim();
  if (!u) return null;
  if (/^file:\/\//i.test(u)) return decodeURI(u.slice(7));
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null;
  if (u.startsWith("/")) return u;
  const dir = String(root ?? "").replace(/\/+$/, "");
  return dir ? `${dir}/${u.replace(/^\.\//, "")}` : null;
}

// A message's question blocks, taken out of its words: each one is drawn as a card from
// the `questions` the Inbox parsed beside the body, so the same words twice would be one
// too many. Every question fence comes off — `:::question`, `:::question-multi` and
// `:::question-text` — an `:::action` block has no card here, and its
// words are still the only place the person can read it.
function wordsWithoutQuestions(body) {
  return String(body ?? "").replace(/^:::question(?:-multi|-text)?\n[\s\S]*?^:::$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
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
    // The thread the person opened, or `null` while the panel shows the list: its id,
    // the Inbox's own window model of it, the row it came from, and the one error a
    // failed read leaves. A thread is a place in the panel, not an overlay — back to
    // the list is `back()`, and Esc is the same.
    this.opened = null;
    // The reply field, and what the last Send did. The field is retained state, made
    // once when the panel's first thread opens and kept from thread to thread, rather
    // than in a render, which would throw away what was typed. `writing` is whether the
    // keyboard is in it: the panel's own ↑/↓/Return have to stay off a caret's keys.
    this.draft = null;
    this.writing = false;
    this.reply = null;
    // What the person has chosen for each question, keyed `message id/question key`: the
    // rings are drawn from here so a click fills one before the Inbox has answered, and a
    // `revision` on each entry is what re-seeds it when the record moves on — an answer
    // made in the browser shows up in the panel without either side guessing.
    this.picked = new Map();
    // The `Input`/`Textarea` behind an "Other", a note or a written answer, made on the
    // click that opens it (or when a saved one is read back) and kept until the thread
    // closes: a field built during a render would throw, and one rebuilt per frame would
    // lose the caret.
    this.fields = new Map();
    // A save that is still out, and the last refusal under a card. The reply's Send waits
    // for the first, so a note typed a moment before Send goes with it.
    this.pending = null;
    // Whether the person has asked for the whole conversation; see `renderThread`.
    this.showAll = false;
    // A file an agent attached, open in the panel: its own page, with the header's back
    // button returning to the thread. `null` while a thread or the list is on screen.
    this.viewing = null;
    // The bytes of the files this copy has read, by attachment id: the app-relative path
    // a picture is drawn from and the absolute one the code view reads. A file on disk
    // stays in here for the copy's life, so a thread read again costs no fetch.
    this.files = new Map();
    // The ones being read now, so a second read of the same thread asks once.
    this.readingFiles = new Set();
    // The pictures written into messages, by the path the agent named: copied where
    // `image()` can draw them, or `{error: true}` when the path is not a file any more.
    this.shots = new Map();
    this.readingShots = new Set();
    // The panel's own width, from `on_size_change`: a picture is drawn no wider than the
    // column it sits in, and `image()` fills whatever box it is given.
    this.size = null;
    // One save at a time per question, chained by question id: see `savePick`.
    this.saving = new Map();
    this.cardError = null;
    // `at` is the palette's highlighted row; `cursor` is the panel's.
    this.cursor = 0;
    // What the shared state key held as this copy last saw it — what it wrote or
    // took last — so `syncState` can tell another space's record from an echo of
    // this one's own write.
    this.stateJson = null;
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
      this.reading = new Set();
      // The folders the person had open stay open when the tree's root moves — a
      // carried record (`syncState`) can land before this does — but only the ones
      // under the folder the tree now shows; paths from elsewhere are inert.
      this.open = new Set([...this.open].filter((p) => at && (p === at || p.startsWith(`${at}/`))));
      // The space's own folder is read at once (its count, and an instant open);
      // every folder under it is read when its row opens.
      if (at) this.load(at, cx);
    }
    cx.spawn(async (cx) => {
      try {
        this.threads = readThreads(await asked("GET", "threads"));
        this.error = null;
        // What the tab bar may show while this panel is collapsed. `setShared`
        // re-renders every mod, so it is written only when the number changes.
        const want = this.threads.filter((t) => t.state === "answer").length;
        if (shared(BADGE) !== want) setShared(BADGE, want);
      } catch (e) {
        this.error = String(e?.message ?? e).split("\n")[0].slice(0, 160);
      } finally {
        this.ready = true;
        // A thread on screen is read again with the list: the store is watched, so a
        // message that lands while the person is reading it arrives at once, and the
        // thread's own row — its dot, its open questions — is as fresh as the list's.
        if (this.opened) this.loadThread(cx);
        cx.notify();
      }
    });
  }

  // ---- one thread ----

  // A thread, opened in the panel. Its words are read from the Inbox's own window
  // model (`GET threads/<id>`, the request its page makes for a thread) rather than
  // from the store: the records say what was written, not what it adds up to.
  openThread(id, cx) {
    // A file open in the panel belongs to the thread leaving the screen.
    this.releaseViewer();
    this.opened = { id, thread: null, error: null };
    this.cursor = 0;
    // A new thread starts with an empty field: what was half-written in another one is
    // not this thread's reply, and the Inbox's own page keeps a draft per thread rather
    // than carrying one across.
    this.field(cx).set_value("");
    this.reply = null;
    // The conversation starts folded: see `renderThread`.
    this.showAll = false;
    this.saveState();
    this.forgetFields();
    cx.notify();
    this.loadThread(cx);
  }

  // The reply field, made on first use. `TextareaState.new` needs a live host call, so
  // this is only ever reached from an event handler (`openThread`), never from a render.
  field(cx) {
    if (this.draft) return this.draft;
    this.draft = TextareaState.new({ placeholder: "Write a reply…" });
    // Two rows, and as many more as the words need, up to eight: a reply in a 368 px
    // column wraps early, and a box that clipped the fifth line would be the one thing
    // the person cannot see in their own words.
    this.draft.set_auto_grow(2, 8);
    this.draft.on("change", (_e, cx) => {
      if (this.reply?.error) this.reply = null;
      cx.notify();
    });
    // Cmd+Return is the keyboard's Send, where the host reports the modifier; a plain
    // Return is a new line in a reply that may be a paragraph. The button beside the
    // field is the way that always works, so a host that does not report the modifier
    // costs the key, not the reply.
    this.draft.on("submit", (e, cx) => { if (e?.secondary === true) this.send(cx); });
    // Which keys are the field's: a focused textarea keeps all of them but Esc.
    this.draft.on("focus", (_e, cx) => { this.writing = true; cx.notify(); });
    this.draft.on("blur", (_e, cx) => { this.writing = false; cx.notify(); });
    return this.draft;
  }

  // Send the field to the agent that spoke last in this thread, which is the message
  // the Inbox page answers: one POST of the words, with every answer the cards have
  // picked and not sent named alongside them — a picture and a pick the page holds
  // stay there, which is what the row under the field is for. `seen_through_seq` is
  // the newest message drawn here, so the Inbox can refuse the reply when the agent
  // wrote after the person read, which is what `thread_moved_on` means; the field keeps
  // the words, and the thread is read again to show what moved it.
  send(cx) {
    const o = this.opened, words = String(this.draft?.value() ?? "").trim();
    // Words are not the only thing a Send can carry: the answers picked in the cards go with
    // them, and picks alone are a reply the Inbox takes on its own.
    if (!o?.thread || (!words && this.unsentPicks(o.thread).length === 0) || this.reply?.busy) return;
    const target = lastAgentOf(o.thread.messages);
    if (!target) {
      this.reply = { busy: false, error: "This thread has no agent message to answer." };
      cx?.notify();
      return;
    }
    const seen = newestSeqOf(o.thread.messages), id = o.id;
    this.reply = { busy: true, error: null };
    cx?.notify();
    // `cx.spawn`, not the handler's context carried across an await: a context belongs
    // to the call that made it, and the one the click was given is dead by the time the
    // Inbox answers — using it there draws "cx is no longer valid" under the field. The
    // callback's own context lives as long as the work does.
    cx?.spawn(async (cx) => {
      try {
        // A pick is saved as it is made, so a note typed a moment ago may still be in the
        // air; the reply names picks by revision, and one that has not landed yet would be
        // refused as unsent. The send waits for the last save to settle first.
        if (this.pending) await this.pending.catch(() => {});
        const picks = this.unsentPicks(this.opened?.thread);
        await asked("POST", `messages/${target.id}/reply`, {
          words,
          // Every answer this thread has made and not sent, named the way the page names
          // them: `{message_id, key, revision}`, with the answer already saved in the Inbox.
          questions: picks,
          idempotency_key: `panel-${id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          ...(seen > 0 ? { seen_through_seq: seen } : {}),
        });
        // The person may have gone back, or into another thread, while this was out:
        // then the field on screen is that thread's and the words in it are not these.
        if (this.opened?.id !== id) return;
        this.draft.set_value("");
        this.reply = { busy: false, error: null };
        this.loadThread(cx);
      } catch (e) {
        if (this.opened?.id !== id) return;
        // The Inbox's own sentence — "The agent wrote again after you read this thread;
        // your reply was not sent. Read it again, then reply." — and the words stay in
        // the field: a reply that would not go out is the person's to send again, and a
        // field emptied on a refusal would have thrown them away. The thread is read
        // again either way, so "read it again" is already done by the time it is read.
        this.reply = { busy: false, error: String(e?.message ?? e).split("\n")[0].slice(0, 200) };
        this.loadThread(cx);
      }
    });
  }

  loadThread(cx) {
    const id = this.opened?.id;
    if (!id) return;
    cx.spawn(async (cx) => {
      try {
        const data = await asked("GET", `threads/${id}`);
        // The person may have gone back, or into another thread, while this was out.
        if (this.opened?.id !== id) return;
        if (!Array.isArray(data?.thread?.messages)) throw new Error("The Inbox answered in an unknown shape");
        this.opened.thread = data.thread;
        this.opened.error = null;
        // A thread restored from the carried state (see `syncState`) arrived with no
        // reply field, and a field cannot be made in a render — this task can make
        // one, the same way `seedFields` makes its own.
        if (!this.draft) this.field(cx);
        this.seedFields(cx);
        this.markSeen(id, data.thread.messages, data.row);
        // The pictures in the thread it just read, so the messages can draw them rather
        // than point at the Inbox for a look at them.
        this.loadPictures(cx);
      } catch (e) {
        if (this.opened?.id !== id) return;
        this.opened.error = String(e?.message ?? e).split("\n")[0].slice(0, 160);
      } finally {
        cx.notify();
      }
    });
  }

  // Reading a thread here marks it seen, which is what opening one in the Inbox page
  // does: the Inbox's own `seen` cursor moves to the newest message drawn, and its
  // blue "new since you looked" dot goes with it. It is deliberately not Mark read.
  // That one also sets aside every open question the person leaves unanswered — the
  // agent is told they skipped it — and a panel that cannot show the picks has no
  // business making that call: a thread with an open question stays yellow until it
  // is answered or marked read in the Inbox.
  markSeen(id, messages, row) {
    if (!(row?.unseen > 0)) return;
    const newest = newestSeqOf(messages);
    if (newest <= 0) return;
    asked("POST", `threads/${id}/seen`, { through_seq: newest }).catch(() => {
      // A dot that stays is the Inbox's answer, and the next read shows whatever it
      // decided; there is nothing to say about a cursor that did not move.
    });
  }

  // Back to the list. The panel's copy is a page, not an overlay, so this closes
  // nothing: it puts the list back, which the next read has already kept fresh.
  back(cx) {
    // A file is one page under the thread it came in, so the first back is the thread
    // and the second is the list.
    if (this.viewing) {
      this.releaseViewer();
      cx?.notify();
      return true;
    }
    if (!this.opened) return false;
    this.opened = null;
    this.cursor = 0;
    // The field is a thread's, so the keys are the panel's again: a `writing` left true
    // would keep ↑/↓ dead on a page that draws no field.
    this.writing = false;
    this.saveState();
    this.forgetFields();
    cx?.notify();
    return true;
  }

  // ---- the files an agent attached ----

  // One attachment's bytes, in the app's own folder, where a picture can be drawn and a
  // code view can read them: the Inbox's own copy of what the agent sent, cached under a
  // name that carries the file's hash so nothing stale can ever be shown from it.
  async pull(a) {
    const name = `${a.id}-${String(a.sent_sha256 ?? "").slice(0, 8)}.${extOf(a.name)}`;
    const abs = `${ATT()}/${name}`;
    // `image()` resolves a path against the app's own folder — `appHome()` is that folder —
    // and draws nothing at all for a path outside it, so the picture is handed the short
    // form of the same file.
    const rel = abs.slice(appHome().length + 1);
    const route = a.kind === "image"
      ? `attachments/${a.id}/image?version=sent`
      : `attachments/${a.id}?version=sent`;
    const r = await exec("sh", ["-c", PULL, "plannotator", STORE(), route, abs]);
    let out;
    try {
      out = JSON.parse(String(r.stdout ?? "").trim() || "{}");
    } catch {
      out = { error: "The Inbox did not hand over this file" };
    }
    if (out?.error) throw new Error(String(out.error));
    return { abs, rel };
  }

  // A picture written into a message, copied into the same folder: its own path, its own
  // copy, and the app-relative name `image()` is handed. A path that is not a file — gone,
  // or something the panel cannot read — throws, and the message keeps its count.
  async have(abs) {
    const r = await exec("sh", ["-c", COPY, "plannotator", abs, ATT()]);
    let out;
    try {
      out = JSON.parse(String(r.stdout ?? "").trim() || "{}");
    } catch {
      out = {};
    }
    if (!out?.ok || !out?.file) throw new Error(String(out?.error ?? "copy"));
    const dest = String(out.file);
    return { abs: dest, rel: dest.slice(appHome().length + 1) };
  }

  // The pictures a thread carries, read once each so its messages can draw them: the files
  // attached to a message, and the pictures written into its words. One that cannot be
  // read keeps its row, which is the way into the Inbox's own copy of it: a file that
  // cannot be handed over is not a broken thread.
  loadPictures(cx) {
    const want = [], shots = [];
    const root = this.opened?.thread?.project?.root;
    for (const m of this.opened?.thread?.messages ?? []) {
      for (const a of m?.attachments ?? []) {
        if (a?.kind !== "image" || !a.id) continue;
        if (this.files.has(a.id) || this.readingFiles.has(a.id)) continue;
        this.readingFiles.add(a.id);
        want.push(a);
      }
      for (const p of wordsOf(m?.body).pictures) {
        const abs = pictureAt(p.url, root);
        if (!abs || this.shots.has(abs) || this.readingShots.has(abs)) continue;
        this.readingShots.add(abs);
        shots.push(abs);
      }
    }
    if (want.length === 0 && shots.length === 0) return;
    cx.spawn(async (cx) => {
      for (const a of want) {
        try {
          this.files.set(a.id, await this.pull(a));
        } catch {
          // The row stays, and says why when the person opens it.
        } finally {
          this.readingFiles.delete(a.id);
        }
      }
      for (const abs of shots) {
        try {
          this.shots.set(abs, await this.have(abs));
        } catch {
          // The message keeps its count, which leads to the thread on the Inbox page.
          this.shots.set(abs, { error: true });
        } finally {
          this.readingShots.delete(abs);
        }
      }
      cx.notify();
    });
  }

  // A file an agent sent, opened in the panel: read-only, on a page of its own, with the
  // header's back button returning to the thread it came in. A picture is drawn, a
  // document is rendered as the markdown it is, code opens in the code view, and a video
  // — which this host cannot draw — is offered to the browser instead.
  openAttachment(a, cx) {
    if (!a?.id) return;
    const v = { id: a.id, att: a, state: "ready", text: null, file: null, error: null, editor: null };
    this.releaseViewer();
    this.viewing = v;
    cx?.notify();
    // A video is bytes the panel cannot use: it goes to the browser, so there is nothing
    // to read before the page draws.
    if (!readable(a.kind) && a.kind !== "image") return;
    v.state = "loading";
    cx?.spawn(async (cx) => {
      try {
        const file = await this.pull(a);
        if (this.viewing !== v) return;
        v.file = file;
        if (readable(a.kind)) {
          v.text = String(await readTextFile(file.abs));
          if (this.viewing !== v) return;
          // The code view's state is made here, in the task that read the file: made in a
          // render it would throw, and one rebuilt per frame would lose the scroll. Only
          // the files the viewer does not draw as markdown need it. Lines wrap: the
          // panel is 368 px wide, and a sideways scroll on every other line is worse than
          // a wrapped one, with the numbers still one per line.
          if (!asDocument(a)) {
            v.editor = EditorState.new({
              language: languageOf(a.name) ?? undefined,
              value: v.text,
              readonly: true,
              soft_wrap: true,
            });
          }
        }
        v.state = "ready";
      } catch (e) {
        if (this.viewing !== v) return;
        v.state = "error";
        v.error = String(e?.message ?? e).split("\n")[0].slice(0, 200);
      } finally {
        cx.notify();
      }
    });
  }

  // The file page's own state, thrown away with it: the code view holds a document and a
  // scroll position that belong to the file that is closing.
  releaseViewer() {
    const state = this.viewing?.editor;
    this.viewing = null;
    if (!state) return;
    try { state.release?.(); } catch { /* a released view is a view */ }
  }

  // How wide a picture is drawn: its own width, never past the panel's column, and — in a
  // message, where the words are the point — never more than `cap` pixels tall. `image()`
  // stretches to the box it is given, so the box is the file's own shape scaled down.
  pictureWidth(a, cap = 200) {
    const column = Math.max(160, (Number(this.size?.width) || 380) - 56);
    const w = Number(a.width) || 0, h = Number(a.height) || 0;
    let px = Math.min(column, w || column);
    if (cap && w > 0 && h > 0) px = Math.min(px, Math.round((cap * w) / h));
    return Math.max(64, Math.round(px));
  }

  // ---- the state that sticks to the space ----

  // The panel's view as one small record: the thread on screen, whether the whole
  // conversation is shown, the row the keys are on, and the folders the person has
  // open in the tree. Written only from the panel's own doings — a click, a key, a
  // render the person caused — never from the watchers or the timer: a copy asleep
  // in another space must not write its stale view into the space the person is in.
  // The reply field's words are left out on purpose: they change every keystroke,
  // and `setShared` re-renders every mod each time.
  saveState() {
    if (this.mode !== "panel") return;
    const st = {
      thread: this.opened?.id ?? null,
      showAll: Boolean(this.showAll),
      cursor: this.cursor,
      tree: [...this.open],
    };
    const v = JSON.stringify(st);
    if (v === this.stateJson) return;
    this.stateJson = v;
    setShared(STATE, st);
  }

  // The other half, at the top of every panel render: what tab-host hands back for
  // the space now showing. A value that differs from the last one this copy wrote
  // or took is another space's record (or this space's own, back after a hot
  // reload), and is adopted — the record is the whole of the view, so adopting it
  // is enough. A thread is restored as the stub `openThread` starts from and read
  // again from there; the reply field, which cannot be made in a render, is made by
  // the task that reads the thread. Restored folders whose children were never read
  // in this copy's life are read here, the way opening their row would.
  syncState(cx) {
    const v = JSON.stringify(shared(STATE) ?? null);
    if (v === this.stateJson) return;
    this.stateJson = v;
    const st = shared(STATE) ?? {};
    const id = typeof st.thread === "string" && st.thread ? st.thread : null;
    if (id && id !== this.opened?.id) {
      this.releaseViewer();
      this.opened = { id, thread: null, error: null };
      this.reply = null;
      this.writing = false;
      this.showAll = Boolean(st.showAll);
      this.loadThread(cx);
    } else if (!id && this.opened) {
      this.releaseViewer();
      this.opened = null;
      this.reply = null;
      this.writing = false;
      this.forgetFields();
    } else {
      this.showAll = Boolean(st.showAll);
    }
    this.cursor = Number.isInteger(st.cursor) && st.cursor >= 0 ? st.cursor : 0;
    this.open = new Set((Array.isArray(st.tree) ? st.tree : []).filter((p) => typeof p === "string"));
    // A carried record can arrive before the copy has looked at the space it now
    // shows: read the folder and the list as `reload` would, so the tree and the
    // dots are this space's at once, and the carried folders survive the change of
    // folder instead of being read late and cleared by it.
    if (folderOf(space()) !== this.folder) this.reload(cx);
    const at = this.folder;
    if (at) for (const p of this.open) this.load(p, cx);
  }

  // The thread in the Inbox page, where an answer, a pick or a picture can be made.
  respond() {
    const id = this.opened?.id;
    if (id) openInbox(`thread=${id}`);
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
    this.saveState();
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
    // A file on a page of its own: the header's back button is the only row there, so Esc
    // and Return have exactly one thing to do.
    if (this.viewing) return ["back"];
    // A thread, open: the way to the Inbox on it, then the way back. The thread's own
    // messages are not rows — they are what the person came to read, and nothing in
    // them launches.
    if (this.opened) return ["respond", "back"];
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
    if (this.viewing) {
      if (id === "back") this.back(cx);
      return;
    }
    if (this.opened) {
      if (id === "back") this.back(cx);
      if (id === "respond") this.respond();
      return;
    }
    if (/^t\d+$/.test(id)) return this.launch(() => this.openThread(this.threads[Number(id.slice(1))]?.id, cx));
    if (id === "more") return this.launch(() => openInbox());
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

  renderPanel(cx) {
    // What the space now showing hands back for this panel, before anything draws:
    // this is where carried state is adopted, so the view is the arriving space's
    // from its first frame.
    this.syncState(cx);
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
    const hit = (id) => { const i = ids.indexOf(id); if (i >= 0) { this.cursor = i; this.saveState(); } };
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
    // Every row the tree shows, as the tree lists them. A thread on screen draws none
    // of the list, so none of it is built: the elements are the cost of a render.
    const rows = this.opened ? [] : this.treeRows().map((e) => node(e.path, e.name, e.dir, e.depth));
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
      // How wide the column is, which is what a picture is drawn to fit: a render that
      // wants it only reads it, so this reports and does not notify.
      .on_size_change((size) => { this.size = size; })
      // One list of rows and one set of keys, the same in the panel and in the palette
      // that opens over it. The panel gets the keyboard on a click; Esc has nothing to
      // close there, so it is left to the app.
      .track_focus(this.handle).on_key_down((e, cx) => {
        // The reply field has the keyboard: Esc still goes back, and every other key is
        // the caret's. A list highlight that moved on each arrow typed into a sentence,
        // and ran a row when the person meant a new line, would be unusable.
        if (this.writing && e.key !== "escape") return;
        // Stops at the ends, as the palette does: wrapping jumps out of sight.
        const last = Math.max(0, ids.length - 1);
        if (this.cursor > last) this.cursor = last;
        if (e.key === "down") this.cursor = Math.min(this.cursor + 1, last);
        else if (e.key === "up") this.cursor = Math.max(this.cursor - 1, 0);
        else if (e.key === "enter") this.runRow(ids[this.cursor], cx);
        else if (e.key === "escape") { if (!this.close() && !this.back(cx)) return; }
        else return;
        this.saveState();
        cx.stop_propagation();
        cx.notify();
      })
      .text_size(13).text_color(t.foreground)
      .child(h_flex().id("pl-head").h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        // A thread on screen turns the header into the way back and the name of what
        // is on it: the panel has one page at a time, and the list is one press behind.
        .when(Boolean(this.opened), (el) => el
          .child(this.iconButton("pl-back", "chevron-left", (_e, cx) => this.back(cx)))
          .child(div().flex_1().min_w(0).truncate().font_semibold()
            .child(this.viewing
              ? String(this.viewing.att?.name ?? "File")
              : (this.opened?.thread?.subject || "Thread"))))
        .when(!this.opened, (el) => el
          .child(div().font_semibold().child("Plannotator"))
          .when(needs > 0, (el) => el.child(div().px(6).rounded(99).bg(t.accent).text_color(t.accent_foreground)
            .text_size(10.5).child(String(needs))))
          .child(div().flex_1()))
        .child(this.iconButton("pl-palette", "search", () => this.openPalette()))
        // One page, so one button: the Inbox on the thread that is open, or on its list.
        .child(this.iconButton("pl-open", "file-text", () => this.launch(() => (this.opened ? this.respond() : openInbox())))))
      // The list scrolls as one box. A thread page is not that box: it pins what the
      // thread is at the top and the way to answer it at the bottom, and scrolls only
      // the conversation between them, so the scrollbar there belongs to the middle.
      .child(v_flex().id("pl-scroll").flex_1().min_h(0).items_center()
        .when(!this.opened, (el) => el.overflow_y_scrollbar())
        .when(Boolean(this.opened), (el) => el.overflow_hidden()
          .child(this.viewing ? this.renderAttachment() : this.renderThread(sel)))
        .when(!this.opened, (el) => el.child(v_flex().id("pl-body").w_full().max_w(760).py(4).pb(10)
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
              .hover((s) => s.bg(t.hover)).cursor_pointer()
              .on_click((_e, cx) => this.openThread(th.id, cx))
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
          .child(action("pick", "folder-plus", "Another folder…", () => this.pick())))))
  }

  // ---- answering a question ----

  // Everything the panel holds for one question, thrown away with the thread: the rings'
  // choices, the fields' text and the last refusal are about a page nobody is looking at.
  forgetFields() {
    for (const state of this.fields.values()) {
      try { state.release?.(); } catch { /* a released field is a field */ }
    }
    this.fields.clear();
    this.picked.clear();
    this.saving?.clear();
    this.cardError = null;
    this.pending = null;
  }

  // A question the Inbox already holds words for — their own option, a note, a written
  // answer — opens with the field showing them, rather than with a link that would hide a
  // saved answer behind a click. Made here, in the task that reads a thread: a field cannot
  // be made during a render, and this is the one place that knows a thread has arrived.
  seedFields(cx) {
    for (const msg of this.opened?.thread?.messages ?? []) {
      for (const q of msg?.questions ?? []) {
        const a = q?.answer ?? {};
        for (const slot of ["other", "note", "text"]) {
          if (!String(a[slot] ?? "").trim()) continue;
          if (this.fields.has(this.fieldId(msg, q, slot))) continue;
          this.answerField(msg, q, slot, cx);
        }
      }
    }
  }

  // What the person has chosen for one question. Seeded from the Inbox's own record, and
  // re-seeded when its `revision` moves — a pick made in the browser is then the panel's
  // too, and a pick made here is the browser's, without either side keeping a copy.
  pickedFor(m, q) {
    const id = `${m?.id}/${q?.key}`, rev = Number(q?.revision) || 0;
    let p = this.picked.get(id);
    // Re-seeded when the record moves on, but never under the person's hands: text they have
    // typed and not yet saved is theirs, not stale.
    if (!p || (p.revision !== rev && !p.dirty)) {
      const a = q?.answer ?? {};
      p = {
        revision: rev,
        selected: [...(a.selected ?? [])],
        other: String(a.other ?? ""),
        note: String(a.note ?? ""),
        text: String(a.text ?? ""),
        dirty: false,
      };
      this.picked.set(id, p);
    }
    return p;
  }

  fieldId(m, q, slot) {
    return `${m?.id}/${q?.key}/${slot}`;
  }

  // The field behind an "Other", a note or a written answer. Made here — from a click or
  // from a task, never from a render — and seeded with what the Inbox already holds. It is
  // `answerField` and not `field` because the reply box's own `field(cx)` was here first: two
  // methods of one name is not an overload in a class, it is the second one winning, and that
  // took the reply box off the page for a while.
  answerField(m, q, slot, cx) {
    const id = this.fieldId(m, q, slot);
    let state = this.fields.get(id);
    if (state) return state;
    const p = this.pickedFor(m, q);
    if (slot === "text" || slot === "note") {
      // A note is a sentence or three, so it gets a box that grows; their own option is one
      // line, because it stands where a choice would.
      state = TextareaState.new({ placeholder: slot === "note" ? "…" : "Write your answer…", rows: 2, value: p[slot] });
      state.set_auto_grow(2, 6);
    } else {
      state = InputState.new({ placeholder: "Your own answer…", value: p[slot] });
    }
    // Enter finishes the thought and saves it; so does leaving the field, which is what
    // happens when the person clicks Send next.
    state.on("submit", (_e, cx) => this.commitField(m, q, slot, cx));
    state.on("blur", (_e, cx) => this.commitField(m, q, slot, cx));
    this.fields.set(id, state);
    return state;
  }

  // The one `Input`/`Textarea` the card needs when the person has not opened it: a row
  // that says what it would add, and opens the field on a click.
  fieldRow(m, q, slot, label) {
    const t = theme(), state = this.fields.get(this.fieldId(m, q, slot));
    if (state) {
      // Their own option stands among the choices, so it keeps a ring; a note does not — it is
      // not an answer, it is what they want to say about the answer — so it is a heading and a
      // box, and a written answer is only the box.
      if (slot === "note") {
        return v_flex().w_full().flex_none().gap(3)
          .child(div().text_size(10.5).text_color(t.dim).child("Note"))
          .child(div().w_full().child(Textarea.new(state)));
      }
      if (slot === "text") {
        return v_flex().w_full().flex_none().child(div().w_full().child(Textarea.new(state)));
      }
      return h_flex().w_full().flex_none().gap(7).items_center()
        .child(div().flex_none().size(11).rounded(99).border_1().border_color(t.input))
        .child(div().flex_1().min_w(0).child(Input.new(state)));
    }
    return h_flex().id(`pl-qf-${this.fieldId(m, q, slot)}`).h(20).flex_none().gap(5).items_center()
      .rounded(4).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.answerField(m, q, slot, cx); cx.notify(); })
      .child(svg(`${ICONS}/plus.svg`).size(11).flex_none().text_color(t.dim))
      .child(div().text_size(11).text_color(t.dim).child(label));
  }

  // ---- answering a question ----

  // A pick, saved where the page saves it: `POST messages/<id>/picks` is the Inbox's own
  // draft, so the panel never holds an answer the browser cannot see, and the reply's Send
  // names it afterwards rather than carrying it. The answer record is the protocol's v1
  // shape — `selected`, and `other`, `text` and `note` beside it, which is where a person's
  // own option and their note on it go.
  savePick(m, q, cx) {
    const id = `${m?.id}/${q?.key}`;
    // One save per question at a time, and the revision read when the request goes out
    // rather than when the save was asked for. A click and a note on the same card land
    // milliseconds apart, and the second would otherwise name the revision the first had
    // already spent — which the Inbox refuses as `question_revision_conflict`, in red, under
    // a card that was in fact saving correctly.
    const before = this.saving.get(id) ?? Promise.resolve();
    const work = before.catch(() => {}).then(() => {
      const p = this.pickedFor(m, q);
      const current = this.recordOf(m, q) ?? q;
      const answer = {
        v: 1, key: current.key, kind: current.kind, prompt: current.prompt,
        selected: current.kind === "single" ? p.selected.slice(0, 1) : p.selected,
        ...(p.other.trim() ? { other: p.other } : {}),
        ...(p.text.trim() ? { text: p.text } : {}),
        ...(p.note.trim() ? { note: p.note } : {}),
      };
      // Nothing chosen, nothing typed: `null` is how a pick is cleared, and how a card that
      // was clicked twice goes back to unanswered.
      const empty = answer.selected.length === 0 && !answer.other && !answer.text && !answer.note;
      return asked("POST", `messages/${m.id}/picks`, {
        questions: [{ key: current.key, revision: current.revision, answer: empty ? null : answer }],
      }).then((data) => {
        // The questions as the Inbox now holds them — new revision, answer written down — are
        // the panel's copy, so a draft made here and one made in the browser are one draft.
        const msg = this.opened?.thread?.messages?.find((x) => x?.id === m?.id);
        if (msg && Array.isArray(data?.questions)) {
          msg.questions = data.questions.filter((x) => x?.key);
          const p2 = this.picked.get(id);
          if (p2) p2.dirty = false;
        }
        return data;
      });
    });
    this.saving.set(id, work);
    // A Send waits on this: the reply names picks, and a pick still in flight is one the
    // Inbox would refuse as unsent.
    this.pending = work.catch(() => {});
    this.cardError = null;
    cx?.spawn(async (cx) => {
      try {
        await work;
        cx.notify();
      } catch (e) {
        // The person may have left the thread while this was out; a refusal then belongs to
        // a page nobody is looking at.
        if (!this.opened?.thread?.messages?.some((x) => x?.id === m?.id)) return;
        this.cardError = { id, text: String(e?.message ?? e).split("\n")[0].slice(0, 200) };
        cx.notify();
        // A conflict, a set-aside question or a superseded one is the thread telling us it
        // moved: read it again, and the card draws what it says.
        this.loadThread(cx);
      }
    });
  }

  // A question's record as the panel holds it now: a save applies the Inbox's answer, so the
  // object a click captured may be a revision behind by the time the request goes out.
  recordOf(m, q) {
    const msg = this.opened?.thread?.messages?.find((x) => x?.id === m?.id);
    return (msg?.questions ?? []).find((x) => x?.key === q?.key) ?? null;
  }

  // A multi question keeps every ring the person has set: a click adds a choice to the
  // picked set or takes it back off, where a single one swaps it for the last click.
  toggleChoice(m, q, label, cx) {
    if (!label) return;
    const p = this.pickedFor(m, q);
    p.dirty = true;
    p.selected = q?.kind === "multi"
      ? (p.selected.includes(label) ? p.selected.filter((x) => x !== label) : [...p.selected, label])
      : (p.selected.includes(label) ? [] : [label]);
    // Their own option and one of the question's are alternatives, not both, on a single
    // question: "Other" is an answer in its own right, which is how the page reads it back
    // ("Other: …"). The field is emptied with it, because text left in it would be a second
    // answer again. On a multi one the two can stand together — the choices are ticks, and
    // the option is one more of them.
    if (p.selected.length > 0 && q?.kind !== "multi") {
      p.other = "";
      this.fields.get(this.fieldId(m, q, "other"))?.set_value("");
    }
    cx?.notify();
    this.savePick(m, q, cx);
  }

  // A field's words, into the draft and out to the Inbox.
  commitField(m, q, slot, cx) {
    const state = this.fields.get(this.fieldId(m, q, slot));
    if (!state) return;
    const p = this.pickedFor(m, q), value = String(state.value() ?? "");
    if (p[slot] === value) return;
    p.dirty = true;
    p[slot] = value;
    // On a single question an own option is the answer, and the rings step down for it;
    // on a multi one the two stand together. A written answer is the whole answer either way.
    if (slot === "other" && value.trim() && q?.kind !== "multi") p.selected = [];
    if (slot === "text") p.selected = [];
    cx?.notify();
    this.savePick(m, q, cx);
  }

  // The picks this thread has made and not sent: what the reply's Send names. A question
  // already sent (`sent_revision` caught up with `revision`) is not one of them, and an
  // action was never a pick.
  unsentPicks(thread) {
    const out = [];
    for (const msg of thread?.messages ?? []) {
      for (const q of msg?.questions ?? []) {
        if (!q?.answer || q.kind === "action") continue;
        if ((Number(q.sent_revision) || 0) === (Number(q.revision) || 0)) continue;
        out.push({ message_id: msg.id, key: q.key, revision: q.revision });
      }
    }
    return out;
  }

  // One question, as a card: its title in the header, what it is about under it, the
  // choices it offers, and the ways to answer it — a ring, a field for the person's own
  // option, a note on it, or the page for everything else. The title is the question's own
  // `prompt`, which the Inbox keeps apart from `context` for exactly this; the word beside
  // it is the card's own version of what the row's dot says in the list.
  //
  // A pick is the Inbox's to keep: a click saves it there (`savePick`), and the reply's
  // Send names it. So a card is answered but unsent until the Send at the bottom of the
  // page — "Picked, not sent" in `accent` — and settled once it has gone — "Answered".
  renderQuestion(m, q) {
    const t = theme();
    const sent = Boolean(q?.answer) && (Number(q?.sent_revision) || 0) === (Number(q?.revision) || 0);
    // Frozen: what the Inbox will not take an answer for any more. An answer of theirs that
    // has not gone out is still theirs to change, so it stays open here.
    const frozen = Boolean(q?.set_aside_at) || Boolean(q?.superseded_by) || sent;
    const picked = Boolean(q?.answer);
    const action = q?.kind === "action";
    const state = q?.set_aside_at ? "Set aside"
      : q?.superseded_by ? "Replaced"
      : sent ? "Answered"
      : action ? "Not answerable here"
      : picked ? "Picked, not sent"
      : "Waiting on you";
    const tone = q?.set_aside_at || q?.superseded_by ? t.dim
      : sent ? t.done
      : action ? t.dim
      : picked ? t.accent
      : t.working;
    const p = this.pickedFor(m, q);
    // The rings come from `picked` — seeded from the record, re-seeded when its revision
    // moves — for a single and a multi alike, so a click fills a ring before the Inbox has
    // answered and a pick made in the browser shows up here without either side guessing.
    const selected = new Set(p.selected);
    // `context` carries the "Context:" label and a "Holds up:" line the Inbox appends from
    // its own field; the label goes (the card is the context) and the line is drawn under
    // the choices with its words, so neither reads as part of the sentence.
    const about = String(q?.context ?? "")
      .replace(/^Context:\s*/, "")
      .replace(/\n*Holds up:[^\n]*/g, "")
      .trim();
    const holds = (q?.holds_up ?? []).filter(Boolean).join(" · ");
    const ring = (on, past) => div().flex_none().mt(3).size(11).rounded(99).border_1()
      .border_color(on ? t.accent : past ? t.dim : t.input)
      .when(on, (el) => el.bg(t.accent));
    const label = (text, past) => div().flex_1().min_w(0).text_size(12)
      .text_color(past ? t.dim : t.foreground).child(text);
    // The recommendation, on the choice it names. The Inbox puts it in a line of its own under
    // the choices, where it makes the person look back up to find which one was meant; matched
    // against the labels it can sit beside the label instead, and the line is only kept for a
    // recommendation that names no choice — a sentence rather than an option.
    const rec = String(q?.recommendation ?? "").trim();
    const isRecommended = (c) => Boolean(rec) && String(c?.label ?? "").trim().toLowerCase() === rec.toLowerCase();
    const recIsChoice = (q?.choices ?? []).some(isRecommended);
    const recommendedTag = (past) => div().flex_none().px(5).py(1).rounded(99).bg(t.selected)
      .child(div().text_size(9.5).text_color(past ? t.dim : t.accent).child("Recommended"));
    // A choice of the question's own. Clicking one is a pick; on a card that is frozen it is
    // a picture of what was picked, and clicking does nothing. A multi question's rings are
    // ticks — each one clicks on its own, none of them clears another.
    const choice = (c, n) => {
      const on = selected.has(c?.label), past = frozen && !on;
      return h_flex().id(`pl-qc-${m?.id}-${q?.key}-${n}`).w_full().flex_none().px(4).py(2)
        .gap(7).items_start().rounded(5)
        .when(!frozen && (q?.kind === "single" || q?.kind === "multi"), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.toggleChoice(m, q, c?.label, cx)))
        .child(ring(on, past))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().w_full().flex_none().gap(6).items_center()
            .child(label(String(c?.label ?? ""), past))
            .when(isRecommended(c), (el) => el.child(recommendedTag(past))))
          .when(Boolean(c?.description), (el) => el.child(div().text_size(11).text_color(t.dim)
            .child(String(c.description)))));
    };
    // Their own option, when it is one they wrote: a ring and their words, marked as theirs.
    const other = String(q?.answer?.other ?? "").trim();
    const note = String(q?.answer?.note ?? "").trim();
    const editable = !frozen && !action;
    return v_flex().id(`pl-q-${m?.id}-${q?.key}`).w_full().flex_none().my(6).overflow_hidden()
      .rounded(8).border_1().border_color(t.border).bg(t.popover)
      .child(h_flex().flex_none().px(10).py(6).gap(7).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().size(7).rounded(99).bg(tone))
        .child(div().flex_1().min_w(0).text_size(12).font_semibold().child(String(q?.prompt ?? "A question")))
        .child(div().flex_none().text_size(10.5).text_color(tone).child(state)))
      .child(v_flex().flex_none().px(10).py(8).gap(7)
        .when(Boolean(about), (el) => el.child(div().w_full().text_size(12).line_height(1.5).text_color(t.muted)
          .child(TextView.markdown(`pl-qb-${m?.id}-${q?.key}`, about))))
        .children((q?.choices ?? []).map(choice))
        // The person's own option, when the question is theirs to answer: a field, always
        // offered, whatever choices the agent wrote — the Inbox takes `other` on every
        // question. Once it is in the record it is drawn as one more choice, so a card that
        // has been answered looks answered. On a multi one it stands beside the ticks, so
        // its ring is on whenever it holds words; on a single one it is the pick, and its
        // ring is on only while nothing else is.
        .when(editable && q?.kind !== "text" && !(this.fields.has(this.fieldId(m, q, "other"))),
          (el) => el.when(Boolean(other), (s) => s.child(h_flex().w_full().flex_none().px(4).py(2)
            .gap(7).items_start()
            .child(ring(q?.kind === "multi" ? true : p.selected.length === 0, false))
            .child(label(other, false)))))
        .when(editable && q?.kind !== "text", (el) => el.child(this.fieldRow(m, q, "other", "Add your own option")))
        // A written question is answered in a field of its own: `text` is the answer, and a
        // note beside it is not the same thing.
        .when(editable && q?.kind === "text", (el) => el.child(this.fieldRow(m, q, "text", "Write your answer")))
        .when(editable, (el) => el.child(this.fieldRow(m, q, "note", "Add a note")))
        // What the record holds, once nothing can be typed into it: their words back, and
        // the note they left on them.
        .when(!editable && Boolean(other), (el) => el.child(h_flex().w_full().flex_none().px(4).py(2)
          .gap(7).items_start().child(ring(true, false)).child(label(other, false))))
        .when(!editable && Boolean(q?.answer?.text), (el) => el.child(div().w_full().text_size(12).line_height(1.5)
          .child(TextView.markdown(`pl-qa-${m?.id}-${q?.key}`, String(q.answer.text)))))
        .when(!(q?.choices ?? []).length && q?.kind === "action", (el) => el.child(div().text_size(11).text_color(t.dim)
          .child("Something to do outside this thread")))
        .when(!(q?.choices ?? []).length && q?.kind !== "action" && !editable && !q?.answer?.text,
          (el) => el.child(div().text_size(11).text_color(t.dim).child("No answer")))
        .when(Boolean(note), (el) => el.child(v_flex().w_full().flex_none().gap(2)
          .child(div().text_size(10.5).text_color(t.dim).child("Note"))
          .child(div().text_size(12).text_color(t.muted).child(note))))
        // Only when it names no choice on the card: otherwise the tag above has said it.
        .when(Boolean(rec) && !recIsChoice, (el) => el.child(div().text_size(11).text_color(t.dim)
          .child(`Recommended: ${rec}`)))
        .when(Boolean(holds), (el) => el.child(div().text_size(11).text_color(t.dim).child(`Holds up: ${holds}`)))
        // A refusal is the Inbox's own sentence, under the card it belongs to.
        .when(this.cardError?.id === `${m?.id}/${q?.key}`, (el) => el.child(div().text_size(11)
          .text_color(t.blocked).child(this.cardError.text)))
        .when(!action, (el) => el.child(h_flex().id(`pl-qa-${m?.id}-${q?.key}`).h(20).flex_none().gap(5)
          .items_center().rounded(4).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click(() => this.respond())
          .child(svg(`${ICONS}/square-pen.svg`).size(11).flex_none().text_color(t.accent))
          .child(div().text_size(11).text_color(t.accent).child("Answer in the Inbox")))));
  }

  // ---- a thread, drawn ----

  // One thread, in the panel's own width: who wrote each message, when, and the words
  // themselves as markdown. Everything here is read-only — an answer, a pick and a
  // picture need the page — so the last row is the way there, on this thread.
  renderThread(sel) {
    const t = theme(), o = this.opened, th = o?.thread;
    const messages = th?.messages ?? [];
    // A thread opens at its end. The panel cannot move a scroll box from script — the host
    // hands out a scroll position only for a virtual list, and a virtual list's rows may not
    // hold the click handlers a question card is made of — so the page is arranged to start
    // at the newest rather than scrolled there: the last few messages are drawn, and the
    // rest wait behind one row. `showAll` is the row's doing, and `openThread` clears it.
    const keep = 3;
    let cut = this.showAll ? 0 : Math.max(0, messages.length - keep);
    // A question nobody has answered is never the thing behind the row: opening a thread is
    // how the person finds out what it is waiting on.
    if (cut > 0) {
      const waiting = messages.findIndex((m) => (Array.isArray(m?.questions) ? m.questions : []).some((q) =>
        q?.kind !== "action" && !q?.set_aside_at && !q?.superseded_by &&
        !(q?.answer && (Number(q?.sent_revision) || 0) === (Number(q?.revision) || 0))));
      if (waiting >= 0 && waiting < cut) cut = waiting;
    }
    const earlier = messages.slice(0, cut);
    const at = th ? Date.parse(th.messages?.[0]?.created_at) : NaN;
    const respond = (id, icon, label) => h_flex().id(`pl-a-${id}`).h(30).flex_none().px(14).gap(9).items_center()
      .when(sel(id), (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover)).cursor_pointer().on_click(() => this.respond())
      .child(svg(`${ICONS}/${icon}.svg`).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().text_color(sel(id) ? t.foreground : t.muted).child(label));
    // The reply: a field, and a Send beside it. The words go to the agent that spoke last,
    // with every answer the cards have picked and not sent — `questions` names them, and the
    // Inbox holds the answers themselves. Pictures, tags and resolves stay in the page,
    // which is the row under it. Nothing is drawn while the thread is still being read: a
    // Send with no messages behind it has nothing to answer.
    const words = String(this.draft?.value() ?? "").trim();
    const picks = this.unsentPicks(th);
    const can = Boolean(words) || picks.length > 0;
    const full = Boolean(th && this.draft) && lastAgentOf(messages) !== null;
    // The field *is* the band, not a box inside one. It used to be a bordered, rounded box
    // inset 12 px inside the footer, which put a frame around a frame at the bottom of every
    // thread; now it runs the panel's full width, sits on `popover` — the token one step up
    // from the page, the same one the person's own messages are boxed in — and the rule above
    // it turns `accent` while they are in it, which is what the inner border used to say.
    const field = () => v_flex().id("pl-reply").flex_none().w_full().px(10).py(8).gap(6)
      .bg(t.popover).border_t(1).border_color(this.writing ? t.accent : t.border)
      .child(h_flex().items_end().gap(8).w_full()
        .child(div().flex_1().min_w(0).child(Textarea.new(this.draft)))
        .child(h_flex().id("pl-send").h(26).flex_none().px(10).items_center().rounded(6)
          .when(can && !this.reply?.busy, (el) => el.cursor_pointer().bg(t.solid).text_color(t.solid_foreground)
            .hover((s) => s.bg(t.accent).text_color(t.accent_foreground)))
          .when(!can || Boolean(this.reply?.busy), (el) => el.bg(t.raised).text_color(t.dim))
          .on_click((_e, cx) => this.send(cx))
          .child(div().text_size(12).child(this.reply?.busy ? "Sending…" : "Send"))))
      // What the Send is carrying besides words, so a pick made two cards up is not
      // forgotten at the bottom of the page.
      .when(picks.length > 0, (el) => el.child(div().text_size(11).text_color(t.accent)
        .child(picks.length === 1 ? "1 answer goes with this reply" : `${picks.length} answers go with this reply`)))
      .when(Boolean(this.reply?.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.reply.error)));
    // Three rows: what the thread is, the conversation, the way to answer it. Only the
    // conversation scrolls — a project that scrolled away would leave the person reading
    // messages with no idea whose thread they are, and a field that scrolled away would
    // have to be found before every reply.
    return v_flex().id("pl-thread").flex_1().min_h(0).w_full().max_w(760)
      .child(h_flex().id("pl-thread-head").h(26).flex_none().px(14).gap(6).items_center().border_b(1)
        .border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim)
          .child([th?.project?.name, Number.isFinite(at) ? ago(at) : null].filter(Boolean).join(" · "))))
      .child(v_flex().id("pl-thread-scroll").flex_1().min_h(0).w_full().overflow_y_scrollbar().py(4)
        .when(!th && !o?.error, (el) => el.child(v_flex().px(14).py(6)
          .child(div().text_color(t.muted).child("Reading the thread…"))))
        .when(Boolean(o?.error), (el) => el.child(div().mx(14).mb(4).text_size(11.5).text_color(t.blocked).child(o.error)))
        // The row that holds the rest: a count first, because "12 earlier messages" is a
        // reason to look and "older" is not.
        .when(earlier.length > 0, (el) => el.child(h_flex().id("pl-earlier").mx(12).mb(3).h(24).flex_none()
          .px(8).gap(7).items_center().rounded(6)
          .hover((st) => st.bg(t.hover)).cursor_pointer()
          .on_click((_e, cx) => { this.showAll = true; this.saveState(); cx.notify(); })
          .child(div().text_size(11).text_color(t.accent)
            .child(earlier.length === 1 ? "1 earlier message" : `${earlier.length} earlier messages`))))
        .children(messages.slice(cut).map((m) => this.renderMessage(m)))
        .when(Boolean(th) && messages.length === 0,
          (el) => el.child(div().px(14).py(6).text_color(t.muted).child("This thread has no messages."))))
      // No bottom padding: the page row is the page's last pixel, sitting on the panel's
      // own edge the way the tab bar's rows do. The card's rounding clips it, and the
      // field's own 6 px is what separates the row from the box above it.
      .child(v_flex().id("pl-thread-foot").flex_none().w_full().pt(2).border_t(1).border_color(t.border)
        .when(full, (el) => el.child(field()))
        .child(respond("respond", "file-text", "Open in Inbox for picks and pictures")));
  }

  // One message: the author and its age, then its words. The person's own are boxed so a
  // long thread reads as a conversation rather than a wall: `popover`, the token one step
  // up from the page, and a 2 px `accent` rule down the left — the same colour as the
  // "You" that labels them. Not `surface`: in this app's palette it resolves to the same
  // colour as `background`, which is why a first pass drew them on nothing at all. The
  // rule takes its 2 px out of the left padding, so the words stay in one column.
  renderMessage(m) {
    const t = theme(), mine = m?.author?.kind === "person";
    const asked = Array.isArray(m?.questions) ? m.questions : [];
    const { text, pictures } = wordsOf(asked.length ? wordsWithoutQuestions(m?.body) : m?.body);
    // The pictures in the words, each one drawn where it was written when its file could be
    // copied; the rest are counted, and the count leads to the Inbox's own page.
    const root = this.opened?.thread?.project?.root;
    const drawn = pictures
      .map((p, i) => ({ ...p, i, file: this.shots.get(pictureAt(p.url, root)) }))
      .filter((p) => p.file?.rel);
    const missed = pictures.length - drawn.length;
    const at = Date.parse(m?.created_at);
    // The files the agent sent with its words: a picture is drawn where it can be seen,
    // everything else is a row. An attachment is often the thing the message is about, so
    // a thread that only counts them sends the person to the browser to find out what.
    const atts = (Array.isArray(m?.attachments) ? m.attachments : []).filter((a) => a?.id);
    const pics = atts.filter((a) => a.kind === "image");
    const files = atts.filter((a) => a.kind !== "image");
    return v_flex().id(`pl-msg-${m?.id}`).w_full().px(12).py(7).mx(6).rounded(8).gap(3)
      // The accent edge is square: a rounded corner either side of it would bend the rule
      // away from the words it marks, so the left of the box is a plain corner and only
      // the right stays rounded.
      .when(mine, (el) => el.bg(t.popover).pl(10).border_l(2).border_color(t.accent).rounded_tl(0).rounded_bl(0))
      .child(h_flex().gap(6).items_center()
        .child(div().text_size(11).font_semibold().text_color(mine ? t.accent : t.muted)
          .child(mine ? "You" : String(m?.author?.name || m?.author?.host || "Agent")))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(Number.isFinite(at) ? ago(at) : ""))
        .child(div().flex_1()))
      // The words a little larger than the panel's 13 px and set on air: an answer is the
      // one thing on this page meant to be read at length. `TextView`'s markdown takes
      // both from the box around it — and `line_height` takes a bare number as a multiple
      // of the size, not pixels: `line_height(21)` is twenty-one times the text, which is
      // a page of blank lines, not a looser one.
      .child(div().w_full().text_size(14).line_height(1.6)
        // A message that is only a question is the question's card, not "no words" above it.
      .when(Boolean(text) || asked.length === 0, (el) => el
        .child(div().w_full().text_size(14).line_height(1.6)
          .child(TextView.markdown(`pl-md-${m?.id}`, text || "_(no words)_"))))
      // A picture belongs to the words it was written under, so it is drawn there — above
      // the question cards, which are the last thing the agent said — and the files the
      // message came with follow both.
      .when(drawn.length > 0, (el) => el.child(v_flex().w_full().flex_none().gap(6).pt(2)
        .children(drawn.map((p) => this.renderInline(m, p)))))
      .children(asked.map((q) => this.renderQuestion(m, q))))
      .when(atts.length > 0, (el) => el.child(v_flex().w_full().flex_none().gap(4).pt(2)
        .when(pics.length > 0, (s) => s.child(h_flex().gap(6).flex_wrap().items_start()
          .children(pics.map((a) => this.renderPicture(a)))))
        .when(files.length > 0, (s) => s.child(h_flex().gap(4).flex_wrap()
          .children(files.map((a) => this.renderChip(a)))))))
      // A picture that could not be drawn says so, and says it as a link: it goes where the
      // picture is — the page on this thread — in `accent` with the same `file-text` the
      // row at the bottom of the page wears, so "this opens the Inbox" reads the same in
      // both places.
      .when(missed > 0, (el) => el.child(h_flex().id(`pl-pics-${m?.id}`).h(18).flex_none()
        .gap(5).items_center().rounded(4).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click(() => this.respond())
        .child(svg(`${ICONS}/file-text.svg`).size(11).flex_none().text_color(t.accent))
        .child(div().text_size(11).text_color(t.accent)
          .child(missed === 1
            ? "1 picture could not be read here — open the thread in the Inbox"
            : `${missed} pictures could not be read here — open the thread in the Inbox`))));
  }

  // A picture an agent wrote into its message: drawn at the panel's width — `image()`
  // keeps the file's own shape when only its width is given — and a click opens the
  // thread in the Inbox, where the browser can show it the size it was taken.
  renderInline(m, p) {
    return v_flex().id(`pl-in-${m?.id}-${p.i}`).w_full().flex_none().items_start()
      .child(image(p.file.rel).w(this.pictureWidth({}, null)).rounded(6).cursor_pointer()
        .on_click(() => this.respond()));
  }

  // One file an agent attached: the glyph its kind wears, its name, its size, and a click
  // that opens it in the panel. This is the only thing in the thread that says what the
  // agent sent — the words around it usually only say "attached".
  renderChip(a) {
    const t = theme();
    return h_flex().id(`pl-att-${a.id}`).h(22).flex_none().max_w(250).pl(5).pr(6).gap(5).rounded(5)
      .bg(t.popover).border_1().border_color(t.border)
      .hover((s) => s.bg(t.hover)).cursor_pointer()
      .on_click((_e, cx) => this.openAttachment(a, cx))
      .child(svg(glyphOf(a.kind)).size(12).flex_none().text_color(t.muted))
      .child(div().min_w(0).truncate().text_size(11.5).text_color(t.accent).child(a.name ?? "file"))
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child(sizeOf(a.size)));
  }

  // A picture an agent attached, drawn in its message. Until its bytes land it is the same
  // row a document gets, so the message never draws an empty space where a file was.
  renderPicture(a) {
    const t = theme(), file = this.files.get(a.id);
    if (!file) return this.renderChip(a);
    return v_flex().id(`pl-pic-${a.id}`).flex_none().gap(3).cursor_pointer()
      .on_click((_e, cx) => this.openAttachment(a, cx))
      .child(image(file.rel).w(this.pictureWidth(a)).rounded(6))
      .child(div().text_size(10.5).text_color(t.accent).truncate()
        .child(`${a.name ?? "picture"} · ${sizeOf(a.size)}`));
  }

  // A file on the panel's own page: read-only, and only ever read. The header above names
  // it and its back button is the thread it came in; the row under the header says what
  // kind of file it is and how big, and the body is the file itself — drawn, rendered or
  // listed — since that is what the person came here for.
  renderAttachment() {
    const t = theme(), v = this.viewing, a = v?.att ?? {};
    const kind = { image: "Picture", video: "Video", markdown: "Document", code: "Code", html: "Web page" }[a.kind]
      ?? "Text";
    const facts = [kind];
    if (Number(a.width) && Number(a.height)) facts.push(`${a.width} × ${a.height}`);
    const length = durationOf(a.duration_ms);
    if (length) facts.push(length);
    facts.push(sizeOf(a.size));
    // A row that opens something the panel cannot draw in the browser: the video itself, a
    // picture at the size it was taken, or the thread a file came in when there is nothing
    // of it to show here.
    const row = (label, at, glyph = `${ICONS}/file-text.svg`) => h_flex().id(`pl-view-open-${at}`)
      .h(24).flex_none().px(8).gap(6).items_center()
      .rounded(6).hover((s) => s.bg(t.hover)).cursor_pointer().on_click(() => openInbox(at))
      .child(svg(glyph).size(12).flex_none().text_color(t.accent))
      .child(div().text_size(11.5).text_color(t.accent).child(label));
    const inThread = () => row("Open the thread in the Inbox", this.opened?.id ? `thread=${this.opened.id}` : "");
    const body = () => {
      if (v.state === "loading") {
        return v_flex().flex_1().min_h(0).px(14).py(10)
          .child(div().text_size(12).text_color(t.muted).child("Reading the file…"));
      }
      // A file the Inbox cannot hand over — it was pruned from its store, or the thread it
      // came in was — says so in its own words, and the thread is one row away.
      if (v.state === "error") {
        return v_flex().flex_1().min_h(0).px(14).py(10).gap(8)
          .child(div().text_size(12).line_height(1.5).text_color(t.blocked)
            .child(v.error || "The Inbox did not hand over this file."))
          .child(inThread());
      }
      if (a.kind === "video") {
        return v_flex().flex_1().min_h(0).px(14).py(10).gap(6)
          .child(div().text_size(12).line_height(1.55).text_color(t.muted)
            .child("A video plays in the Inbox, in your browser — the panel draws words and pictures."))
          .child(row(`Play it in the browser${length ? ` (${length})` : ""}`,
            `/api/inbox/attachments/${a.id}/video`, `${OWN}/video.svg`));
      }
      if (a.kind === "image") {
        return v_flex().id("pl-view-pic").flex_1().min_h(0).w_full().overflow_y_scrollbar().p(10)
          .items_center().gap(8)
          .when(Boolean(v.file), (el) => el
            .child(image(v.file.rel).w(this.pictureWidth(a, null)).rounded(6).cursor_pointer()
              .on_click(() => openInbox(`/api/inbox/attachments/${a.id}/image`)))
            .child(row("Open full size in the browser", `/api/inbox/attachments/${a.id}/image`,
              `${OWN}/image.svg`)));
      }
      // Code, a patch and every other text file is listed by the code view, which scrolls
      // itself, keeps its line numbers and knows the file's language by its name. A web
      // page is only ever its source here: the Inbox renders the page itself, and a row
      // goes there.
      if (!asDocument(a)) {
        return v_flex().id("pl-view-code").flex_1().min_h(0).w_full()
          .when(a.kind === "html", (el) => el
            .child(div().flex_none().px(14).pt(6).text_size(11).text_color(t.dim)
              .child("A web page reads as its source here; the Inbox shows it as a page."))
            .child(v_flex().px(6).pt(2).items_start().child(inThread())))
          .when(Boolean(v.editor), (el) => el.child(v_flex().flex_1().min_h(0).w_full().px(6).py(4)
            .child(Editor.new(v.editor))));
      }
      // Markdown, the one kind the viewer draws: the person's own document, read as the
      // thread's messages are.
      return v_flex().id("pl-view-doc").flex_1().min_h(0).w_full().overflow_y_scrollbar().px(14).py(10)
        .child(v_flex().w_full().text_size(13.5).line_height(1.6)
          .child(TextView.markdown(`pl-att-${a.id}`, v.text || "_(no words)_")));
    };
    return v_flex().id("pl-view").flex_1().min_h(0).w_full().max_w(760)
      .child(h_flex().id("pl-view-facts").h(24).flex_none().px(14).gap(6).items_center()
        .border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(facts.join(" · "))))
      .child(body());
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

  render(cx) {
    if (this.mode === "palette") return this.renderPalette();
    if (this.mode === "menu") return this.renderMenu();
    return this.renderPanel(cx);
  }
}
