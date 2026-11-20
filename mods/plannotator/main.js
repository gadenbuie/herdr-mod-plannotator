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
// The same mod still draws its own command palette (`props().mode === "palette"`),
// a row's menu (`"menu"`), a picture at its own size (`"picture"`) and the toast
// popup a run's annotations arrive in (`"toast"`) as overlays: the app's palette
// lists Herdr's commands only, so this is the way in by keyboard. The first three
// are opened by a press; the toast is the panel's own doing.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView, TextareaState, Textarea, EditorState, Editor } from "gpui-base";
import {
  spaces, focused, panes, exec, run, theme, props, openOverlay, closeOverlay,
  notify, watchFolder, pickFolder, home, appHome, nextCommand, keys, shared, setShared,
  readTextFile, layout,
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
// The copies of a thread's files are a cache for what is on screen, not an archive: one
// folder per thread, deleted when the person leaves the thread. `$1` is that folder's name
// and `$2` the cache root; anything that is not a thread id prunes nothing, because a shell
// script that removes a folder should not be talked into removing another one.
const PRUNE = `
case "$1" in
  msg_*) [ -n "$2" ] && rm -rf "$2/$1" ;;
  all) [ -n "$2" ] && rm -rf "$2"/* ;;
esac
printf '{"ok":1}'
`;
// How tall a picture may be where it sits in a message: a screenshot reads as a screenshot,
// and the click opens it at its own size. A portrait one at the panel's full width would be
// a column of screen the words never asked for.
const PICTURE_CAP = 240;
// The comment bar's width: an `absolute()` element with no width draws nothing, so the
// three buttons and their padding are sized here and clamped against the column with it.
const BAR_W = 148;
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
// The picture dialog's one word back to the panel. A dialog is a copy of this mod with no
// thread, no reply field and no comments of its own, and it can only say that the person
// pressed Comment on the picture it was opened with: the `ask` is the id the panel gave it at
// `openPicture`, so a value whose ask this copy never wrote is another run's (or another
// copy's) and is ignored. See `takePictureAsk`.
const PICTURE = "plannotator.picture";
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
// file the agent may write again — so a copy older than its source is replaced. It also
// says how big the picture is, in pixels: the panel draws a small one in a message and
// hands the full size to the click that opens it, and `image()` cannot be asked.
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
wh=""
command -v sips >/dev/null 2>&1 && wh=$(sips -g pixelWidth -g pixelHeight "$src" 2>/dev/null | awk '/pixelWidth/ && $2 ~ /^[0-9]+$/ {w=$2} /pixelHeight/ && $2 ~ /^[0-9]+$/ {h=$2} END{if (w && h) print w" "h}')
[ -n "$wh" ] || wh=$(file -b "$src" 2>/dev/null | sed -n 's/.*[ ,]\\([0-9][0-9]*\\) *x *\\([0-9][0-9]*\\).*/\\1 \\2/p')
w=\${wh%% *}; h=\${wh##* }
[ -n "$w" ] || w=0
[ -n "$h" ] || h=0
printf '{"ok":1,"file":"%s","w":%s,"h":%s}' "$dest" "$w" "$h"
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
space="$5"
shift 5
(
  printf '__label %s\\n__space %s\\n__cwd %s\\n' "$label" "$space" "$PWD" >"$log"
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
  printf '%s\\t%s: %s\\n' "$PWD/$f" "\${label:-Plannotator}" "\${word:-finished}"
done`;

// Two shown copies (the panel and a tab of the same mod) both get a key command;
// one press must start one run.
let claimed = 0;

// Whether the shown layout draws a mod's block: true when every stack above it
// shows its line and no ancestor hides it, false when the block is there but
// put away, null when this layout has no such block. The two facts tab-host's
// own toggle reads before it shows a tab, read here so a popup copy can decide
// whether opening means showing or leaving alone.
function modShown(name) {
  let seen = null;
  const walk = (node, hidden, stacked) => {
    if (!node || typeof node !== "object" || seen !== null) return;
    hidden = hidden || Boolean(node.hidden);
    const kids = Array.isArray(node.children) ? node.children : [];
    if (node.type === "stack") for (const child of kids) walk(child, hidden, stacked && node.active === child.id);
    else for (const child of kids) walk(child, hidden, stacked);
    if (node.content?.mod === name) seen = !hidden && Boolean(stacked);
  };
  try { walk(layout(), false, true); } catch { seen = null; }
  return seen;
}

// How many waiting threads the panel lists; the rest are one row into the Inbox.
const SHOWN = 5;

// At most this many of a thread's last messages are drawn before the row that holds the rest,
// and at most this many characters of them: see `tailOf`.
const TAIL = 3;
const TAIL_ROOM = 1400;

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
  exec("sh", ["-c", RUN, "plannotator", RUNS(), at ?? home(), `${stamp}-${slug}`, label, space()?.id ?? "", "plannotator", ...args, "--json"])
    .catch((e) => fail(e?.message));
}

function fail(body) {
  notify({ title: "Plannotator", body: String(body ?? "Plannotator did not start").trim().slice(0, 200), level: "error" });
}

// The words a finished run left for the agent: the `feedback` of its decision, when
// there is any (a dismissal, and a review with nothing to send, leave none). `annotate`
// — a file, a folder — and `last` bring the raw feedback back in `feedback`; `review`
// brings its rendered page back in `message` instead, the same words the plaintext run
// would have printed, with the instructions to the agent at the end kept whole. An
// approval's `message` is the approval prompt, not findings, so only an annotated
// decision may fall back to it. The log's last line before `__exit` is the CLI's JSON;
// its stamp is when the run began.
async function feedbackIn(file) {
  let text;
  try { text = await readTextFile(file); } catch { return null; }
  if (!text) return null;
  const end = text.indexOf("\n__exit");
  const from = end < 0 ? -1 : text.lastIndexOf("\n{", end);
  if (from < 0) return null;
  let d;
  try { d = JSON.parse(text.slice(from + 1, end)); } catch { return null; }
  const words = String(d?.feedback ?? (d?.decision === "annotated" ? d?.message : null) ?? "").trim();
  if (!words || d.nothingToSend || d.decision === "dismissed") return null;
  const m = /(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)/.exec(file);
  return {
    file, words,
    label: /^__label (.*)$/m.exec(text)?.[1]?.trim() || "Plannotator",
    // Where it was asked from: the space, and the folder the run started in. Older logs
    // have neither, and are placed by the folder their target names.
    space: /^__space (.*)$/m.exec(text)?.[1]?.trim() || null,
    cwd: /^__cwd (.*)$/m.exec(text)?.[1]?.trim() || String(d.target ?? "") || null,
    count: Number(d.annotationCount) || 0,
    at: m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : Date.now(),
  };
}

// The runs that left words, newest first, from the logs themselves — so a copy of the panel that
// opens after the run ended still holds it. Names start with their stamp: newest sorts last.
async function recentFeedback() {
  let out;
  try { out = await exec("sh", ["-c", 'ls -r "$1"/*.log 2>/dev/null | head -20', "plannotator", RUNS()]); } catch { return []; }
  const found = [];
  for (const file of String(out.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean)) {
    if (!/\.log$/.test(file)) continue;
    const r = await feedbackIn(file);
    if (r) found.push(r);
  }
  return found;
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
        read: row.read_at != null,
        resolved: row.resolved_at != null,
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

// What a kind of file is called in the panel, in the Inbox's own words: a card's second line
// and a file page's first fact read the same.
function kindOf(kind) {
  return { image: "Picture", video: "Video", markdown: "Markdown", code: "Code", html: "Web page" }[kind]
    ?? "Text";
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

// A message's words, as the panel can draw them, in the order the agent wrote them: the
// markdown between one picture and the next, and each picture where it was written.
//
// The agents write in markdown, and `TextView` renders it — lists, tables and code
// included — so only the two things it cannot do come off. `:::question` and
// `:::action` are the Inbox's own block fences: both are drawn as cards from the
// `questions` the Inbox parsed beside the body, and the caller takes the whole fences
// out first (`wordsWithoutQuestions`); what is left here carries only the fence lines
// themselves, for a body whose records did not come with it. A picture is a path in the
// person's own files
// (`![alt](/abs/a.png)`, or one relative to the project), which `TextView` cannot load:
// it is drawn where it stands instead, as a thumbnail the click opens, and the words on
// either side of it are drawn as the markdown they are. Its alt text goes with it — the
// Inbox names those files (`pasted-image-2026-11-03-1452`), so a sentence with two
// pictures in it would carry two filenames through the middle of it.
// The same text with its code blanked to spaces, so a match's place in it is its place in
// the message: a fenced block (``` or ~~~, closed by the same fence or running to the end)
// and an inline `span`, one line at a time, a run of backticks closing at the next run of as
// many. Blanked rather than cut, because everything found here is quoted back out of the
// message as it was written.
function codeSpans(text) {
  const chars = [...text];
  const blank = (from, to) => {
    for (let i = from; i < to; i += 1) if (chars[i] !== "\n") chars[i] = " ";
  };
  const lines = [];
  let at = 0;
  for (const line of text.split("\n")) {
    lines.push({ line, at });
    at += line.length + 1;
  }
  let fence = null;
  let opened = 0;
  for (const { line, at: start } of lines) {
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length) {
        blank(opened, start + line.length);
        fence = null;
      }
    } else if (mark) {
      fence = mark[1];
      opened = start;
    }
  }
  if (fence) blank(opened, text.length);
  for (const { line, at: start } of lines) {
    const runs = /`+/g;
    let m;
    while ((m = runs.exec(line))) {
      const close = line.indexOf(m[0], m.index + m[0].length);
      if (close < 0) continue;
      blank(start + m.index, start + close + m[0].length);
      runs.lastIndex = close + m[0].length;
    }
  }
  return chars.join("");
}

function wordsOf(body) {
  const text = String(body ?? "").replace(/^:::[a-z-]*[^\n]*$/gm, "");
  // What is code is not a picture: `![alt](path)` written as an example is the words the
  // agent is showing, and a message that talks about pictures must not draw one.
  const plain = codeSpans(text);
  const parts = [];
  let pictures = 0;
  let at = 0;
  const re = /!\[([^\]]*)\]\(([^)\s]*)\)/g;
  for (let m = re.exec(plain); m; m = re.exec(plain)) {
    const words = text.slice(at, m.index).replace(/\n{3,}/g, "\n\n").trim();
    if (words) parts.push({ type: "text", text: words });
    at = m.index + m[0].length;
    // A picture with no path is a picture the panel cannot go and get: it comes off the
    // words and is not counted, because there is nowhere to send the person for it.
    if (!m[2]) continue;
    pictures += 1;
    parts.push({ type: "picture", alt: String(m[1] ?? "").trim(), url: m[2] });
  }
  const rest = text.slice(at).replace(/\n{3,}/g, "\n\n").trim();
  if (rest) parts.push({ type: "text", text: rest });
  return { parts, pictures };
}

// How many of a thread's last messages the panel draws: three when they are short, which is
// the context a thread reads easier with, and fewer — one, at the end of it — when the newest
// message's own words outrun the column, because three long ones push the newest under the
// fold and opening a thread has to land on what was just written. Counted from the records
// rather than measured: a render cannot ask a text how tall it will be, and `TAIL_ROOM`
// characters of body is about what fits between the header and the reply field at 368 px.
// A message is weighted with what it draws besides its words — a picture is tall, a question
// card is a row and a field — and the newest is always drawn, however short the room left.
function tailOf(messages) {
  const cost = (m) => {
    const files = (Array.isArray(m?.attachments) ? m.attachments : []).length;
    const cards = (Array.isArray(m?.questions) ? m.questions : []).length;
    return String(m?.body ?? "").length + files * 240 + cards * 120;
  };
  let keep = 0;
  let room = TAIL_ROOM;
  for (let i = messages.length - 1; i >= 0 && keep < TAIL; i -= 1) {
    const c = cost(messages[i]);
    if (keep > 0 && c > room) break;
    room = Math.max(0, room - c);
    keep += 1;
  }
  return keep;
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

// A message's question and action blocks, taken out of its words: each one is drawn as a
// card from the `questions` the Inbox parsed beside the body, so the same words twice
// would be one too many. Every fence comes off whole — `:::question`, `:::question-multi`,
// `:::question-text` and `:::action` — the card is the only place the person reads them.
function wordsWithoutQuestions(body) {
  return String(body ?? "")
    .replace(/^:::question(?:-multi|-text)?\n[\s\S]*?^:::$/gm, "")
    .replace(/^:::action\n[\s\S]*?^:::$/gm, "")
    .replace(/\n{3,}/g, "\n\n").trim();
}

// A message's, or a document's, words cut into the blocks a comment can be put on: a
// blank line ends one, and a fenced code block is one block however empty the lines inside
// it are. The panel cannot read the person's selection — Herdr hands a mod no way to ask
// for one, and the text's own selection belongs to the host — so the block under the
// pointer is the anchor: its first line is the quote, and the whole block is the words the
// comment is about. Nothing else has to be true of the markdown for this to hold: a block
// split at a blank line renders as the same markdown it did inside the whole. `rowsOf` keeps
// each block's line numbers too, which is what lets a comment on a file name the lines it is
// about — a message's lines are nobody's to count.
function rowsOf(text) {
  const out = [];
  let block = [], fence = false, first = 1, last = 1;
  String(text ?? "").split("\n").forEach((line, i) => {
    const at = i + 1;
    if (/^\s*(?:```|~~~)/.test(line)) fence = !fence;
    if (!fence && line.trim() === "") {
      if (block.length > 0) out.push({ block: block.join("\n"), first, last });
      block = [];
      return;
    }
    // The line numbers a file's comment can name: the block's own, in the file on screen,
    // from its first line to the last one that carries words.
    if (block.length === 0) first = at;
    last = at;
    block.push(line);
  });
  if (block.length > 0) out.push({ block: block.join("\n"), first, last });
  return out.filter((r) => r.block.trim() !== "");
}

function blocksOf(text) {
  return rowsOf(text).map((r) => r.block);
}

// The line a comment stands for, as the band over the field shows it: the block's first
// line with the markdown that marks a block off taken away — a heading's hashes, a quote's
// chevron, a list's bullet — and cut where a 368 px column would cut it anyway.
function quoteOf(block) {
  const line = String(block ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const plain = line
    .replace(/^(?:```|~~~).*$/, "code")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/[*_`]/g, "")
    .trim();
  return plain.length > 110 ? `${plain.slice(0, 107).trimEnd()}…` : plain;
}

// What a reply's `feedback` says to the agent: the Inbox puts it in the message the agent
// reads, after the person's own words, so a comment arrives next to what it is about — the
// file or the message, then the quote the person highlighted, then what they wrote.
function feedbackOf(notes) {
  return notes.map((n) => {
    const t = n.target ?? {};
    // A file's comment names the lines it is about, when the panel knows them: a paragraph
    // in a markdown file is a range, and a whole file is none.
    const one = Number(t.line) || 0, two = Number(t.lines) || 0;
    const at = one && two > one ? ` lines ${one}-${two}` : one ? ` line ${one}` : "";
    const where = t.file ? `Comment on \`${t.file}\`${at}` : "Comment on your message";
    // A picture's quote is its own name, which the line above has already said: quoting it
    // again would read as two names for one file.
    const quote = n.quote && n.quote !== t.file ? `> ${n.quote}\n\n` : "";
    return `**${where}:**\n\n${quote}${n.text}`;
  }).join("\n\n");
}

// A comment's id: the Inbox asks for a short one, and nothing else reads it — it is the
// record's own name, and the name a Send hands back to the Inbox as `annotation_ids`.
function noteId() {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// One comment, saved where the Inbox's own page saves one: against the message whose words
// it is about, or — for a file — against the attachment's sent copy, which is the version
// on screen. The server fills in the project, the thread, the path and the time, and hands
// the record back; a refusal throws the Inbox's own sentence, which the band shows.
async function postNote(note) {
  const t = note.target ?? {};
  // A picture's comment is the Inbox's own shape for one — the block named "image", the
  // picture's name in `originalText`, and no offsets, since there is no document under it to
  // count characters in. Its `type` follows the block, the same as a paragraph's.
  const image = t.blockId === "image";
  // A picture written into a message is no block of it, but a message takes only a `COMMENT`
  // with the words it is about, so the markdown the agent wrote for the picture is the quote
  // and the picture is what makes it one.
  const quote = String(note.quote ?? "");
  const annotation = {
    id: note.id,
    blockId: t.blockId ?? "",
    startOffset: 0,
    endOffset: image ? 0 : quote.length,
    // A comment on a whole file stands on no block: that is the Inbox's own general comment.
    type: t.blockId || t.picture ? "COMMENT" : "GLOBAL_COMMENT",
    text: note.text,
    originalText: quote,
    createdA: Date.now(),
  };
  if (t.kind === "file") {
    return asked("POST", "annotations", { attachment_id: t.attachmentId, version: t.version, annotation });
  }
  return asked("POST", `messages/${t.messageId}/annotations`, { annotation });
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
    // A comment is made on a block of words, not on a selection (`blocksOf` says why).
    // `pressed` is the press a bar waits on, `aiming` that bar — where the pointer let go,
    // on what — `commenting` the field the bar opens, and `notes` the comments staged for
    // the thread on screen: each one already saved to the Inbox as a draft, and each one
    // carried by the next Send. `notedFor` is the thread those belong to, `inboxComments`
    // how many its draft holds, which the browser may have added to.
    this.pressed = null;
    this.aiming = null;
    this.commenting = null;
    this.notes = [];
    this.notedFor = null;
    this.inboxComments = 0;
    // A file an agent attached, open in the panel: its own page, with the header's back
    // button returning to the thread. `null` while a thread or the list is on screen.
    this.viewing = null;
    // The picture dialog this copy has open, if any: the `ask` it was opened with, the
    // comment's key, what that comment is filed against and the name it quotes. The dialog
    // hands back only the `ask`; everything a comment needs stays here, with the thread it
    // belongs to (see `takePictureAsk`).
    this.picture = null;
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
    // The annotations runs brought back (`findLast`); the footer holds the newest of this space's.
    this.lasts = [];
    // The window's size, measured in the panel's render (a measurement is legal from a
    // render, not from the task that opens a toast popup) — where the toast sits.
    this.vp = null;
    // The run a toast popup copy was opened with, as its props gave it: its only state.
    this.toastRun = null;
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
    // The toast popup is a copy with one record in its props and nothing else — no
    // store, no watchers, no fields. It puts itself away the way Herdr's own toast
    // timed out; a press or a click beside it closes it sooner.
    if (this.mode === "toast") {
      this.toastRun = props() ?? {};
      cx.timer.after(15000, () => this.close());
      return;
    }
    // The palette and the menus hold no data of their own: the panel reads the store.
    if (this.mode !== "panel") return;
    // Whatever a last run left copied into the cache is no copy this one is drawing: the
    // files come back a thread at a time, as the person asks for them.
    exec("sh", ["-c", PRUNE, "plannotator", "all", ATT()]).catch(() => {});
    this.reload(cx);
    // What the runs decided while the panel was shut is the first thing it says.
    this.announce(cx);
    this.findLast(cx);
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
        else if (command === "copy-last") this.copyLast(cx);
        else if (command === "paste-last") this.pasteLast(cx);
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

  // The page's Mark read and Mark unread, one button on the thread's head: the click asks
  // for the other of the state the envelope shows. Mark read is the one the page warns
  // about — it sets aside every open question with a skip answer — and the endpoint does
  // that by itself; the list and the thread row are read again at once, though the store
  // watcher would bring them anyway.
  setRead(read, cx) {
    const id = this.opened?.id;
    if (!id) return;
    cx?.spawn(async (cx) => {
      try {
        await asked("POST", `threads/${id}/${read ? "read" : "mark-unread"}`, {});
        await this.refreshList();
        if (this.opened?.id === id) {
          this.opened.row = { ...(this.opened.row ?? {}), read_at: read ? new Date().toISOString() : null };
          this.loadThread(cx);
        }
      } catch (e) {
        notify({ title: "Plannotator", body: String(e?.message ?? e).split("\n")[0], level: "error" });
      }
      cx.notify();
    });
  }

  // The page's Archive thread. The route is the page's own — `messages/<id>/resolve`, a
  // thread id in the message route, `{resolved: true}` — and the same call with
  // `resolved: false` takes a thread back, though an archived one is nowhere the panel
  // could press that. An archived thread is in no bucket of the list, so the panel goes
  // back to its own list; the archive is the page's toast, not a question asked here.
  archiveThread(cx) {
    const id = this.opened?.id;
    if (!id) return;
    cx?.spawn(async (cx) => {
      try {
        await asked("POST", `messages/${id}/resolve`, { resolved: true });
        await this.refreshList();
      } catch (e) {
        notify({ title: "Plannotator", body: String(e?.message ?? e).split("\n")[0], level: "error" });
        return;
      }
      this.back(cx);
    });
  }

  // The list, read again where a change of the thread's own state makes it stale: the
  // buckets are the Inbox's, and a read, an unread or an archive moves the row between
  // them. The badge travels with it, the way `reload` writes it.
  async refreshList() {
    this.threads = readThreads(await asked("GET", "threads"));
    const want = this.threads.filter((t) => t.state === "answer").length;
    if (shared(BADGE) !== want) setShared(BADGE, want);
  }

  // A thread, opened in the panel. Its words are read from the Inbox's own window
  // model (`GET threads/<id>`, the request its page makes for a thread) rather than
  // from the store: the records say what was written, not what it adds up to.
  openThread(id, cx) {
    // A file open in the panel belongs to the thread leaving the screen, and so do the
    // copies of that thread's pictures.
    this.releaseViewer();
    if (this.opened?.id && this.opened.id !== id) this.prune(this.opened.id);
    this.opened = { id, thread: null, row: null, error: null };
    this.cursor = 0;
    // A new thread starts with an empty field: what was half-written in another one is
    // not this thread's reply, and the Inbox's own page keeps a draft per thread rather
    // than carrying one across.
    this.field(cx).set_value("");
    this.reply = null;
    // The conversation starts folded: see `renderThread`.
    this.showAll = false;
    // The bar and the field are the page's, so they go with it, and so do the comments
    // staged on it: another thread's are in that thread's draft in the Inbox, not here. A
    // thread opened again keeps its own, which is what the session can still hand it.
    this.aiming = null;
    this.closeComment();
    if (this.notedFor !== id) {
      this.notes = [];
      this.inboxComments = 0;
      this.notedFor = id;
    }
    this.saveState();
    this.forgetFields();
    cx.notify();
    this.loadThread(cx);
  }

  // The thread's id, for a command line that wants to name the thread it is about. The
  // id is the page's (`this.opened.id`, what `GET threads/<id>` and `prune` name), not
  // a field the thread record itself carries.
  copyThreadId(cx) {
    const id = this.opened?.id;
    if (!id) return;
    cx.write_to_clipboard(id);
    notify({ title: "Plannotator", body: "Thread id copied", level: "success", timeout: 3000 });
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
    // Words are not the only thing a Send can carry: the answers picked in the cards, the
    // actions marked in them, and the comments made on the words of the page, go with them
    // — and any of those alone is a reply the Inbox takes on its own.
    const notes = this.notes.filter((n) => n.text);
    if (!o?.thread || (!words && this.unsentPicks(o.thread).length === 0
      && this.unsentActions(o.thread).length === 0 && notes.length === 0) || this.reply?.busy) return;
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
        const acts = this.unsentActions(this.opened?.thread);
        // The comments go the way the Inbox's own page sends them: rendered in `feedback`,
        // which the Inbox puts after the person's words in the message the agent reads, and
        // named as `annotation_ids`, which is what settles the drafts it is holding.
        const body = {
          words,
          // Every answer this thread has made and not sent, named the way the page names
          // them: `{message_id, key, revision}`, with the answer already saved in the Inbox.
          questions: picks,
          // The actions marked here, named the way the page names them: the results
          // themselves are already saved, the Send only carries them to the agent.
          ...(acts.length > 0 ? { actions: acts } : {}),
          ...(notes.length > 0 ? { feedback: feedbackOf(notes) } : {}),
          ...(notes.some((n) => n.serverId) ? { annotation_ids: notes.map((n) => n.serverId).filter(Boolean) } : {}),
          idempotency_key: `panel-${id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          ...(seen > 0 ? { seen_through_seq: seen } : {}),
        };
        try {
          await asked("POST", `messages/${target.id}/reply`, body);
        } catch (e) {
          // An id the Inbox does not know refuses the whole reply. The comments' words are in
          // the feedback whatever the ids say, so the reply goes out without naming them
          // rather than not at all.
          if (!body.annotation_ids || !/annotation/i.test(String(e?.message ?? ""))) throw e;
          await asked("POST", `messages/${target.id}/reply`, { ...body, annotation_ids: undefined });
        }
        // The person may have gone back, or into another thread, while this was out:
        // then the field on screen is that thread's and the words in it are not these.
        if (this.opened?.id !== id) return;
        // The Send carried them, so the band is empty again — unconditionally: a thread the
        // panel restored rather than opened never set `notedFor`, and a row left behind here
        // is a comment that was sent, still sitting over the reply field.
        this.notes = [];
        this.inboxComments = 0;
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
        this.opened.row = data.row ?? null;
        this.opened.error = null;
        // How many comments this thread's draft in the Inbox holds. Some of them may have
        // been made in the browser, or on this thread in a past run of the panel, so the
        // band counts them rather than trusting only the ones it made itself.
        this.inboxComments = Number(data?.row?.unsent?.comments) || 0;
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
  // agent is told they skipped it — and it stays the head button's own press: a
  // thread with an open question stays yellow until it is answered, marked read in
  // the page, or marked read here on purpose.
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
    // A comment being written is the first thing a back press puts away: the field is one
    // press deep, and the words in it would be gone with the page.
    if (this.commenting) {
      this.closeComment(cx);
      return true;
    }
    this.aiming = null;
    // A file is one page under the thread it came in, so the first back is the thread
    // and the second is the list.
    if (this.viewing) {
      this.releaseViewer();
      cx?.notify();
      return true;
    }
    if (!this.opened) return false;
    const left = this.opened.id;
    this.opened = null;
    this.cursor = 0;
    // Out of the thread, out with its pictures: the copies were for what was on screen.
    this.prune(left);
    // The field is a thread's, so the keys are the panel's again: a `writing` left true
    // would keep ↑/↓ dead on a page that draws no field.
    this.writing = false;
    this.saveState();
    this.forgetFields();
    cx?.notify();
    return true;
  }

  // ---- a comment on the words ----

  // A press inside a block: where it landed, on what. A drag is read at the release, in
  // `aimUp` — a click to hand the panel the keyboard, or to put a highlight away, opens
  // nothing.
  aimDown(key, e, target, block) {
    const at = e?.local_position ?? { x: 0, y: 0 };
    this.pressed = {
      key, target, block, when: Date.now(),
      x: Number(e?.position?.x) || 0, y: Number(e?.position?.y) || 0,
      at: { x: Number(at.x) || 0, y: Number(at.y) || 0 },
    };
  }

  // The bar, from the drag that ended here. A highlight can start in one paragraph and run
  // into the next, and the panel cannot see it at all (`blocksOf` says why) — so the comment
  // goes on a paragraph, and the bar is drawn at the end of the highlight that comes first in
  // the page: a drag that ran upwards anchors at the end it started from, not at the pointer
  // it began under. The two ends are the press and the release, and the window positions say
  // which is higher, which is all a stack of paragraphs needs.
  //
  // A release can land on no paragraph at all — the air between two of them, the card around
  // them — which is why the panel's root calls this too, with no block for the end: nothing to
  // anchor to, so the bar is drawn at the end the drag started from, which is in a paragraph.
  aimUp(key, e, target, block, cx) {
    const down = this.pressed;
    this.pressed = null;
    if (!down) return;
    const x = Number(e?.position?.x) || 0, y = Number(e?.position?.y) || 0;
    if (Math.hypot(x - down.x, y - down.y) < 4) return;
    // One comment at a time: a drag in another block while a field is open and being
    // typed in would throw those words away to offer a second bar, and Esc is already the
    // way to leave one.
    if (this.commenting) return;
    // Up and to the left is earlier in the page; anything else keeps the press as the end.
    const earlier = y < down.y - 0.5 || (Math.abs(y - down.y) <= 0.5 && x < down.x);
    if (key && earlier) {
      // The release is on a paragraph and came first: the bar goes there, where the person
      // let go.
      const at = e?.local_position ?? { x: 0, y: 0 };
      this.aiming = { key, target, block, at: { x: Number(at.x) || 0, y: Number(at.y) || 0 } };
    } else if (!key && earlier) {
      // The release came off the paragraph upwards into the air around it, and that is the
      // end of the highlight that comes first — with no paragraph there to draw a bar in, it
      // is drawn in the panel's own box at the point the highlight reached, in the
      // coordinates that box keeps. The words it is filed against are still the ones the
      // drag started in: those are the ones the panel can quote.
      const b = e?.bounds;
      this.aiming = {
        key: down.key, target: down.target, block: down.block, where: "root",
        at: b
          ? { x: (Number(x) || 0) - (Number(b.x) || 0), y: (Number(y) || 0) - (Number(b.y) || 0) }
          : { x: down.at.x, y: 0 },
      };
    } else {
      // Either the release is below where the drag started — the air under the paragraph, the
      // card around it — and the press is the first end, or it is on a paragraph the highlight
      // ran forwards into. Either way the bar goes where the drag started, in its paragraph.
      this.aiming = {
        key: down.key, target: down.target, block: down.block,
        at: { x: Number(down.at.x) || 0, y: Number(down.at.y) || 0 },
      };
    }
    cx?.notify();
  }

  // A press that is not the bar's own is a press somewhere else, and a highlight it does
  // not make puts the offer away: the bar goes as the selection does. The bar and the
  // field stop the press before it gets here (`stop_propagation`), so neither closes
  // itself by being clicked. A press with no block under it — the air between two
  // paragraphs — also ends whatever drag was being read, or the next release in a paragraph
  // would be measured against a press from another gesture.
  aimAway(cx) {
    if (this.pressed && Date.now() - this.pressed.when > 32) this.pressed = null;
    if (!this.aiming) return;
    this.aiming = null;
    cx?.notify();
  }

  // The bar, become the field.
  openComment(cx) {
    const a = this.aiming;
    if (!a) return;
    this.aiming = null;
    this.openCommentOn(a.key, a.target, a.block, cx);
  }

  // The field for a comment on one block — or on a whole file, which has no block to press
  // in: the code view is the `Editor`'s, and the row under the facts is its way in.
  // `quote` names the line the comment stands for, and is `quoteOf(block)` unless the anchor
  // already is one line the panel must not reword: a picture's own name.
  openCommentOn(key, target, block, cx, quote = null) {
    this.closeComment(cx);
    const field = TextareaState.new({
      placeholder: target?.blockId === "image" || target?.picture ? "What about this picture?" : "What about it?",
    });
    field.set_auto_grow(3, 6);
    field.on("submit", (e, cx) => { if (e?.secondary === true) this.saveNote(cx); });
    field.on("focus", (_e, cx) => { this.writing = true; cx.notify(); });
    field.on("blur", (_e, cx) => { this.writing = false; cx.notify(); });
    this.commenting = { key, target, block, quote: quote ?? quoteOf(block), field };
    this.pressed = null;
    cx?.notify();
    // The caret goes in once the frame that draws the field is there: a field made and
    // focused in the same call has nowhere to put one yet.
    cx?.spawn(async (cx) => {
      await cx.sleep(30);
      if (this.commenting?.field !== field) return;
      field.focus();
      cx.notify();
    });
  }

  closeComment(cx) {
    const c = this.commenting;
    this.commenting = null;
    this.writing = false;
    if (c?.field) { try { c.field.release?.(); } catch { /* a released field is a field */ } }
    cx?.notify();
  }

  // The field's words become a comment: kept in the band for the Send that carries it, and
  // saved to the Inbox at once — the draft its own page keeps, so the browser counts it and
  // the agent reads it with the reply. A save that does not land costs nothing: the words
  // go out in the reply's own `feedback` either way, and the row says so.
  saveNote(cx) {
    const c = this.commenting;
    if (!c) return;
    const text = String(c.field?.value() ?? "").trim();
    this.closeComment(cx);
    if (!text) return;
    this.addNote(c.target, c.quote, text, cx);
  }

  // One comment staged: in the band over the reply field, and saved to the Inbox at once —
  // the draft its own page keeps, so the browser counts it and the agent reads it with the
  // reply. A save that does not land costs nothing: the words go out in the reply's own
  // `feedback` either way, and the row says the Inbox did not keep it.
  addNote(target, quote, text, cx) {
    if (!text) return;
    const note = { id: noteId(), target, quote, text, serverId: null, error: null };
    // Whose comment this is comes from the thread on screen, not from whichever path opened
    // it: a thread restored from the carried state (`syncState`) never runs `openThread`.
    this.notedFor = this.opened?.id ?? null;
    this.notes.push(note);
    cx?.notify();
    cx?.spawn(async (cx) => {
      try {
        const out = await postNote(note);
        note.serverId = String(out?.annotation?.id ?? note.id);
      } catch (e) {
        note.error = String(e?.message ?? e).split("\n")[0].slice(0, 140);
      }
      cx.notify();
    });
  }

  // A shortcut on the bar is the comment the field would have made, made: same quote, same
  // words, no field. It lands in the band, where the ✕ is the way back.
  noteNow(words, cx) {
    const a = this.aiming;
    if (!a) return;
    this.aiming = null;
    this.addNote(a.target, quoteOf(a.block), words, cx);
  }

  // A staged comment put away: the Inbox's draft goes with it, so the page and the panel go
  // on counting the same thing.
  dropNote(id, cx) {
    const i = this.notes.findIndex((n) => n.id === id);
    if (i < 0) return;
    const [note] = this.notes.splice(i, 1);
    cx?.notify();
    if (!note.serverId) return;
    asked("POST", `annotations/${note.serverId}/remove`, {}).catch(() => {
      // A remove that did not land leaves a draft in the Inbox, which its own page can drop;
      // there is nothing to say about it here.
    });
  }

  // One block of a message or of a document, wrapped so the pointer can find it: the bar and
  // the field are drawn inside it, under the words they are about. The text is selectable,
  // so the highlight is the person's own — the panel cannot read it, and does not need to:
  // the block is what the comment is filed against, and its first line is the quote.
  renderNoteBlock(key, block, target) {
    const t = theme();
    const bar = this.aiming?.key === key && this.aiming?.where !== "root" ? this.renderNoteBar() : null;
    const box = this.commenting?.key === key ? this.renderNoteField() : null;
    // The handlers are on the words as well as on the box around them: a press the text
    // takes for its own selection still reaches the element that owns it, and `aimUp` is
    // idempotent because both of them are asked.
    return v_flex().id(`pl-blk-${key}`).w_full().flex_none().relative()
      .on_mouse_down("left", (e) => this.aimDown(key, e, target, block))
      .on_mouse_up("left", (e, cx) => this.aimUp(key, e, target, block, cx))
      .child(TextView.markdown(`pl-md-${key}`, block).selectable()
        .on_mouse_down("left", (e) => this.aimDown(key, e, target, block))
        .on_mouse_up("left", (e, cx) => this.aimUp(key, e, target, block, cx)))
      .when(Boolean(bar), (el) => el.child(bar))
      .when(Boolean(box), (el) => el.child(box));
  }

  // The bar the pointer opens, over the first line of the highlight: the one word it is for,
  // then the two comments that are mostly the same every time — a bin and a thumbs up, which
  // open the field with their words already in it. Over rather than under the line, because
  // the words under a highlight are the ones the person is reading; under it when that line
  // is the block's first and there is no room above — a bar above the first line would sit
  // outside the paragraph and be clipped by whatever clips it. It never runs past the
  // column's right edge either — a button off the panel is a button nobody can press — and it
  // is given its width, because an absolute element that hugs its text around here draws
  // nothing at all.
  renderNoteBar() {
    const t = theme(), at = this.aiming?.at ?? { x: 0, y: 0 };
    const wide = Number(this.size?.width) || 368;
    const left = Math.max(0, Math.min(Number(at.x) || 0, Math.max(0, wide - BAR_W)));
    const y = Number(at.y) || 0;
    // 24 px of bar and 4 px of air: above the line when the line is far enough down its
    // paragraph for that to stay inside it.
    const top = y >= 28 ? y - 28 : y + 6;
    // Each third of the bar is its own target inside one surface; a third that is only a
    // fill of its own would go see-through on hover in a theme that tints with alpha.
    const part = (id, onClick) => h_flex().id(id).h(20).flex_none().px(6).gap(5).items_center()
      .rounded(4).hover((s) => s.bg(t.hover)).cursor_pointer().on_click(onClick);
    // The two shortcuts sit against the bar's right edge, with nothing between them and the
    // border: the bar's padding is on its left only, and the slack goes into the middle.
    return h_flex().id("pl-note-bar").absolute().left(left).top(top).w(BAR_W).h(24).pl(3).gap(2)
      .items_center().overflow_hidden().rounded(6).bg(t.popover).border_1().border_color(t.border)
      // No hover state on the bar itself: it appears under the pointer that was just dragging,
      // so the pointer is already on it, and anything it does on the way in reads as a flicker.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(part("pl-note-comment", (_e, cx) => this.openComment(cx))
        .child(svg(`${ICONS}/plus.svg`).size(11).flex_none().text_color(t.accent))
        .child(div().flex_none().text_size(11.5).text_color(t.foreground).child("Comment")))
      .child(div().flex_1())
      .child(part("pl-note-trash", (_e, cx) => this.noteNow("Please delete this", cx))
        .tooltip("Please delete this")
        .child(svg(`${OWN}/trash.svg`).size(12).flex_none().text_color(t.muted)))
      // Square on the right, where it meets the border, and narrower on that side than the
      // others: its box is the bar's edge.
      .child(h_flex().id("pl-note-thumbs-up").h(20).flex_none().pl(6).pr(5).items_center()
        .hover((s) => s.bg(t.hover)).cursor_pointer().tooltip("👍 Looks good")
        .on_click((_e, cx) => this.noteNow("👍 Looks good", cx))
        .child(svg(`${OWN}/thumbs-up.svg`).size(12).flex_none().text_color(t.muted)));
  }

  // The comment being written: the quote it stands for, the field, and the one button that
  // takes it. It draws under its block rather than over it — a box floating over the words
  // would hide the very words the person is commenting on in a 368 px column.
  renderNoteField() {
    const t = theme(), c = this.commenting;
    if (!c?.field) return null;
    return v_flex().id("pl-note-box").w_full().flex_none().mt(3).mb(2).gap(5).p(7).rounded(7)
      .bg(t.popover).border_1().border_color(t.accent)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(Boolean(c.quote), (el) => el.child(div().truncate().text_size(10.5).text_color(t.dim).child(c.quote)))
      .child(div().w_full().child(Textarea.new(c.field)))
      .child(h_flex().gap(4).items_center()
        .child(div().flex_1())
        .child(h_flex().id("pl-note-cancel").h(22).flex_none().px(9).items_center().rounded(5)
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.closeComment(cx))
          .child(div().text_size(11.5).text_color(t.muted).child("Cancel")))
        .child(h_flex().id("pl-note-ok").h(22).flex_none().px(9).items_center().rounded(5)
          .bg(t.solid).text_color(t.solid_foreground)
          .hover((s) => s.bg(t.accent).text_color(t.accent_foreground))
          .on_click((_e, cx) => this.saveNote(cx))
          .child(div().text_size(11.5).child("Comment"))));
  }

  // A staged comment in the reply band: what it is about, then the words, then the one thing
  // to do with it.
  renderNote(n) {
    const t = theme();
    const one = Number(n.target?.line) || 0, two = Number(n.target?.lines) || 0;
    const at = one && two > one ? `:${one}-${two}` : one ? `:${one}` : "";
    // A picture's quote is the picture's name, which the row already carries as the file: the
    // same name twice on one row reads as two things.
    const said = n.quote && n.quote !== n.target?.file ? n.quote : "";
    const where = [`${n.target?.file ?? ""}${at}`, said].filter(Boolean).join(" · ");
    return h_flex().id(`pl-note-${n.id}`).w_full().flex_none().gap(6).items_start().p(6).rounded(6)
      .bg(t.background)
      .child(svg(`${ICONS}/square-pen.svg`).size(11).flex_none().mt(1).text_color(t.dim))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .when(Boolean(where), (el) => el.child(div().truncate().text_size(10.5).text_color(t.dim).child(where)))
        .child(div().text_size(11.5).line_height(1.45).text_color(t.foreground).child(n.text))
        .when(Boolean(n.error), (el) => el.child(div().text_size(10).text_color(t.blocked)
          .child("The Inbox did not keep it; it still goes with your reply."))))
      .child(div().id(`pl-note-x-${n.id}`).size(16).flex_none().flex().items_center().justify_center()
        .rounded(4).hover((s) => s.bg(t.hover)).cursor_pointer()
        .on_click((_e, cx) => this.dropNote(n.id, cx))
        .child(svg(`${ICONS}/x.svg`).size(10).flex_none().text_color(t.dim)));
  }

  // ---- the files an agent attached ----

  // One attachment's bytes, in the app's own folder, where a picture can be drawn and a
  // code view can read them: the Inbox's own copy of what the agent sent, cached under a
  // name that carries the file's hash so nothing stale can ever be shown from it.
  async pull(a) {
    const name = `${a.id}-${String(a.sent_sha256 ?? "").slice(0, 8)}.${extOf(a.name)}`;
    const abs = `${this.cacheDir()}/${name}`;
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
    const r = await exec("sh", ["-c", COPY, "plannotator", abs, this.cacheDir()]);
    let out;
    try {
      out = JSON.parse(String(r.stdout ?? "").trim() || "{}");
    } catch {
      out = {};
    }
    if (!out?.ok || !out?.file) throw new Error(String(out?.error ?? "copy"));
    const dest = String(out.file);
    return {
      abs: dest,
      rel: dest.slice(appHome().length + 1),
      // The picture's own pixels, so the message can draw a thumbnail and the click can
      // open it at the size it was taken. 0 when the file would not say.
      width: Number(out.w) || 0,
      height: Number(out.h) || 0,
    };
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
      for (const part of wordsOf(m?.body).parts) {
        if (part.type !== "picture") continue;
        const abs = pictureAt(part.url, root);
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

  // Where this thread's files are copied to: one folder per thread, so leaving the thread
  // can take every copy of it with it and nothing else.
  cacheDir() {
    const id = String(this.opened?.id ?? "thread");
    return `${ATT()}/${/^msg_[A-Za-z0-9]+$/.test(id) ? id : "thread"}`;
  }

  // The copies of a thread's files, deleted when the person leaves it: they are a cache for
  // what the panel is drawing, and the Inbox still has every one of them.
  prune(id) {
    const thread = String(id ?? "");
    if (!/^msg_[A-Za-z0-9]+$/.test(thread)) return;
    exec("sh", ["-c", PRUNE, "plannotator", thread, ATT()]).catch(() => {});
    for (const key of [...this.files.keys()]) this.files.delete(key);
    this.shots.clear();
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
  pictureWidth(a, cap = PICTURE_CAP) {
    const column = Math.max(160, (Number(this.size?.width) || 380) - 56);
    const w = Number(a.width) || 0, h = Number(a.height) || 0;
    let px = Math.min(column, w || column);
    // A picture taller than it is wide is capped by its height — a portrait screenshot at the
    // panel's width is a column of screen the words never asked for — but the cap alone
    // makes a 480×1070 one 98 px wide, no longer a picture of anything: a floor on the
    // width takes the height back up to about 290, and the click opens the rest.
    if (cap && w > 0 && h > 0) {
      px = Math.min(column, Math.max(130, Math.min(px, Math.round((cap * w) / h))));
    }
    return Math.max(64, Math.round(px));
  }

  // A picture as big as it is, on the window's own screen: a dialog the person closes with
  // Esc or its cross. The panel's column is 368 px, which makes a full screenshot a stamp —
  // so the thumbnail is the way in and this is the way to read it. No bigger than 820×560 —
  // the window is 705 px tall, and a dialog taller than that is a dialog with its picture
  // cut off — shrunk to fit when the picture is larger. The dialog's chrome (its name row,
  // the one row under the picture, padding and gaps) is what the height adds: a picture's
  // box is the picture's own height and nothing else, so anything less clips it.
  //
  // A picture can take a comment, and the dialog under it carries the way in; what that
  // comment is filed against is decided here and kept here, because the dialog is another
  // copy of the mod and knows none of it. A picture the Inbox holds as an attachment is filed
  // on the attachment, in the shape its own picture comment has; a picture an agent wrote into
  // its words is no record the Inbox has, so the comment is on the message that wrote it,
  // quoted with the markdown it wrote.
  openPicture(shot) {
    const rel = String(shot?.rel ?? "");
    if (!rel) return null;
    const id = String(shot?.attachmentId ?? ""), msg = String(shot?.messageId ?? "");
    const name = String(shot?.name ?? "");
    const ask = `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const thread = this.opened?.id ?? null;
    this.picture = id
      ? {
        ask, key: `pic-${id}`, thread,
        target: {
          kind: "file", file: name || "this picture", attachmentId: id,
          // The copy on screen is the one the Inbox kept for the send, which is the version
          // its annotations are filed against.
          version: String(shot?.version || "current"),
          // And a comment on a picture is the Inbox's own shape for one: its block is named
          // "image", its name is the quote, and there are no offsets to give.
          blockId: "image",
        },
        quote: name || "this picture",
      }
      : msg
        ? {
          ask, key: String(shot?.key || `pic-m-${msg}`), thread,
          // No block: the picture stands between paragraphs, and the words the comment quotes
          // are the markdown the agent wrote for it.
          target: { kind: "message", messageId: msg, blockId: "", picture: true },
          quote: String(shot?.quote || name || "this picture"),
        }
        : null;
    const w = Number(shot?.width) || 0, h = Number(shot?.height) || 0;
    const fit = w > 0 && h > 0 ? Math.min(1, 820 / w, 560 / h) : 1;
    const dw = w > 0 ? Math.round(w * fit) : 720;
    const dh = h > 0 ? Math.round(h * fit) : 480;
    return openOverlay({
      mod: "plannotator",
      kind: "dialog",
      width: dw + 24,
      height: dh + (this.picture ? 86 : 56),
      props: {
        mode: "picture", file: rel, name, w: dw, h: dh,
        ask: this.picture?.ask ?? "",
      },
    });
  }

  // The dialog's one press, read at the top of a panel render: it hands back the `ask` this
  // copy opened it with, and the comment's field appears under the picture. The field is made
  // in a task, not here — a `TextareaState` made in a render throws — and the picture and its
  // thread must still be the ones the dialog was opened on: a field for a picture that is no
  // longer on screen has nothing to be under, and a comment made here would land in another
  // thread's band.
  takePictureAsk(cx) {
    const p = this.picture, back = shared(PICTURE) ?? null;
    if (!p || String(back?.ask ?? "") !== p.ask) return;
    this.picture = null;
    if (!this.opened || p.thread !== this.opened.id) return;
    cx.spawn(async (cx) => {
      await cx.sleep(1);
      if (!this.opened || p.thread !== this.opened.id) return;
      this.openCommentOn(p.key, p.target, "", cx, p.quote);
    });
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
      this.opened = { id, thread: null, row: null, error: null };
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

  // A run that ended is announced the moment a copy of this mod is on screen, which is
  // the only time a mod can post anything — a closed panel has no code at all. The
  // desktop banner said so when it happened; this says it again here. `ANNOUNCE` marks
  // each log it reads, so nothing is announced twice.
  announce(cx) {
    cx.spawn(async () => {
      let out;
      try {
        out = await exec("sh", ["-c", ANNOUNCE, "plannotator", RUNS()]);
      } catch {
        return;
      }
      if (out.code !== 0) return;
      const lines = String(out.stdout ?? "").split("\n").filter((s) => s.trim());
      let n = 0;
      for (const raw of lines.slice(0, 3)) {
        const [file, ...rest] = raw.split("\t");
        const body = rest.join("\t").trim();
        // A run that left annotations gets the panel's own toast popup — Herdr's toast
        // has one whole-body action, and this wants the footer's three buttons; the
        // plain ones (a run that failed, say) stay Herdr toasts. A second run's popup
        // rises above the first.
        const got = await feedbackIn(file);
        if (got) this.openToast(got, n++);
        else notify({ title: "Plannotator", body });
      }
      if (lines.length > 3) notify({ title: "Plannotator", body: `${lines.length - 3} more in the sessions folder` });
      this.findLast(cx);
    });
  }

  // Runs whose annotations were put away with the footer's ✕, by log file.
  away() {
    try { return new Set(JSON.parse(localStorage.getItem("plannotator.last.away") ?? "[]")); } catch { return new Set(); }
  }

  findLast(cx) {
    cx.spawn(async (cx) => {
      this.lasts = await recentFeedback();
      cx.notify();
    });
  }

  // The footer's handle: the newest annotations asked for from this space — the same
  // space, or for a log from before spaces were recorded, a folder inside this one.
  // Another space's annotations are not shown here.
  last() {
    const sp = space(), at = folderOf(sp), gone = this.away();
    const near = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
    return this.lasts.find((r) => !gone.has(r.file)
      && (r.space ? r.space === sp?.id : Boolean(at && r.cwd && near(r.cwd, at)))) ?? null;
  }

  copyRun(cx, last) {
    if (!last) return;
    cx.write_to_clipboard(last.words);
    notify({ title: "Plannotator", body: "Annotations copied", level: "success", timeout: 3000 });
  }

  copyLast(cx) {
    this.copyRun(cx, this.last());
  }

  // Into the terminal the person is on, or the one the space's agent is in: the text is
  // pasted and left for them to read and send — Return is theirs. `done` runs when the
  // words are in, however it went: a toast popup closes only then, because a task of a
  // copy whose overlay is closed dies with it.
  pasteRun(cx, last, done) {
    if (!last) return;
    const f = focused();
    const terminal = f?.terminal ?? f?.shown ?? f?.agent;
    if (!terminal) {
      done?.();
      return fail("No terminal to paste into");
    }
    cx.write_to_clipboard(last.words);
    cx.spawn(async () => {
      try {
        run("pane.focus", { terminal });
        await exec("sh", ["-c", "sleep 0.15"]);
        run("terminal.paste");
      } catch (e) { fail(e?.message); }
      done?.();
    });
  }

  pasteLast(cx) {
    this.pasteRun(cx, this.last());
  }

  awayLast(cx, last = this.last()) {
    if (last) localStorage.setItem("plannotator.last.away", JSON.stringify([...this.away(), last.file].slice(-50)));
    cx.notify();
  }

  // ---- the toast popup ----

  // Where the toast popup goes: the window's size measured now when the window
  // answers a measurement outside a render, else the one the panel's last render
  // cached, else null and the popup opens at the pointer.
  vpSize() {
    try {
      const vp = window.viewport_size();
      if (vp && vp.width > 0 && vp.height > 0) return vp;
    } catch { /* a measurement is a render's to make */ }
    return this.vp && this.vp.width > 0 ? this.vp : null;
  }

  // A run's annotations arrive as the panel's own popup instead of a Herdr toast:
  // the footer's handle drawn as a card over the window, its click going to the
  // space the run was asked from with the panel open, and the footer's three
  // buttons as real buttons. The record rides in the popup's props, because a popup
  // copy holds none of the panel's state; it sits at the window's bottom right,
  // where the app's own toasts show.
  openToast(got, n) {
    const W = 360, H = 58, vp = this.vpSize();
    const at = vp && vp.width > 0 && vp.height > 0
      ? { x: Math.max(8, Math.round(vp.width - W - 14)), y: Math.max(8, Math.round(vp.height - H - 14 - n * (H + 8))) }
      : "pointer";
    return openOverlay({
      mod: "plannotator",
      kind: "popup",
      width: W,
      at,
      props: {
        mode: "toast",
        file: got.file, words: got.words, label: got.label,
        count: got.count, when: got.at, space: got.space,
      },
    });
  }

  toastCopy(cx) {
    this.copyRun(cx, this.toastRun);
    this.close();
  }

  // The card's click: to the space the run was asked from — the log's `__space`, when
  // it carries one and a space by that id exists — and the panel open, where its
  // footer holds the annotations. The panel is opened the way its button does, and
  // only when it is not already showing here: the toggle would close one that is.
  // The switch takes a frame to land, so the layout is read after a beat, and the
  // popup closes when the going is done — a task of a copy whose overlay is closed
  // dies with it.
  toastGo(cx) {
    const id = this.toastRun?.space ?? null;
    cx.spawn(async () => {
      if (id && spaces().some((s) => s.id === id)) run("space.select", { id });
      await exec("sh", ["-c", "sleep 0.25"]);
      if (modShown("plannotator") === false) {
        if (modShown("tab-host") !== null) run("tab-host.toggle:plannotator");
        else run("layout.toggle:panel");
      }
      this.close();
    });
  }

  toastPaste(cx) {
    this.pasteRun(cx, this.toastRun, () => this.close());
  }

  // The popup puts the run away in the same list the footer reads, and pokes the
  // shared state once so every copy re-renders and the footer drops it at once —
  // its own render reads the away set fresh; nobody consumes the value.
  toastAway(cx) {
    this.awayLast(cx, this.toastRun);
    setShared("plannotator.toast", { away: this.toastRun?.file ?? null, at: Date.now() });
    this.close();
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
    // The toast popup can already be gone — a click beside it or Esc closed it at the
    // app — and its fifteen-second timer still fires; closing a closed overlay is
    // quietly nothing.
    try { closeOverlay(overlay); } catch { /* already gone */ }
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
    if (this.opened) return ["open", "back"];
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
      if (id === "open") this.respond();
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

  iconButton(id, icon, action, from = ICONS, label) {
    const t = theme();
    return div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(action)
      // The label is the pointer's reason and the screen reader's: a tooltip alone
      // announces nothing.
      .when(Boolean(label), (el) => el.tooltip(label).accessibility_label(label))
      .child(svg(`${from}/${icon}.svg`).size(14));
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
    // And what the picture dialog says back, if one was open when the person pressed
    // Comment: no gesture of theirs is running now, so this is where a hand-off is taken.
    this.takePictureAsk(cx);
    // Where the window's bottom right is, for the toast popups a run's annotations
    // arrive in: a measurement is legal from a render and from nowhere else, so the
    // announce task reads what this left behind.
    try {
      const vp = window.viewport_size();
      if (vp && vp.width > 0 && vp.height > 0) this.vp = vp;
    } catch { /* no window to measure: the popup opens at the pointer */ }
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
      // A press anywhere that is not the comment bar puts the offer away: the bar belongs to
      // a highlight, and a click somewhere else is what clears one. The release is read here
      // as well, so a drag that ends on the air between two paragraphs still offers a
      // comment — a block's own handler gets there first and empties `pressed`, which leaves
      // this one with nothing to do.
      .on_mouse_down("left", (_e, cx) => this.aimAway(cx))
      .on_mouse_up("left", (e, cx) => this.aimUp(null, e, null, null, cx))
      // How wide the column is, which is what a picture is drawn to fit: a render that
      // wants it only reads it, so this reports and does not notify.
      .on_size_change((size) => { this.size = size; })
      // One list of rows and one set of keys, the same in the panel and in the palette
      // that opens over it. The panel gets the keyboard on a click; Esc has nothing to
      // close there, so it is left to the app.
      .track_focus(this.handle).on_key_down((e, cx) => {
        // A comment being offered or written is the first thing Esc puts away: the page behind
        // it stays where it is.
        if (e.key === "escape" && (this.commenting || this.aiming)) {
          if (this.commenting) this.closeComment(cx);
          this.aiming = null;
          cx.stop_propagation();
          cx.notify();
          return;
        }
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
        .child(this.iconButton("pl-open", "file-text", () => this.launch(() => (this.opened ? this.respond() : openInbox())), ICONS,
          "Open in Inbox for picks and pictures")
          .when(sel("open"), (el) => el.bg(t.selected))))
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
      // The last annotations a run brought back: a handle to copy them, or to paste them into
      // the terminal the person is on. Drawn on every page, under the scrolling part.
      .when(Boolean(this.last()), (el) => el.child(this.renderLast()))
      // A bar whose highlight ended in the air around a paragraph has no paragraph to be
      // drawn in, so it is drawn here, after the page: on top of it, at the point the drag
      // reached. Last child on purpose — an earlier one would be behind the page.
      .when(this.aiming?.where === "root", (el) => el.child(this.renderNoteBar()));
  }

  // The footer: what came back, from which run, how long ago, and what to do with it:
  // copy, paste into the terminal, or put it away.
  renderLast() {
    const t = theme(), last = this.last();
    const n = last.count ? `${last.count} ${last.count === 1 ? "annotation" : "annotations"}` : "Annotations";
    return h_flex().id("pl-last").h(40).flex_none().px(14).gap(8).items_center().border_t(1).border_color(t.border)
      .child(svg(`${ICONS}/square-pen.svg`).size(14).flex_none().text_color(t.accent))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(12).child(n))
        .child(div().truncate().text_size(11).text_color(t.dim).child(`${last.label} · ${ago(last.at)}`)))
      .child(this.iconButton("pl-last-copy", "copy", (_e, cx) => this.copyLast(cx), OWN))
      .child(this.iconButton("pl-last-paste", "terminal", (_e, cx) => this.pasteLast(cx)))
      .child(this.iconButton("pl-last-away", "x", (_e, cx) => this.awayLast(cx)));
  }

  // The toast popup: the footer styled as the app's own toast — the same 18 px sides,
  // the popover ground, a level-coloured dot and two truncated lines — with the
  // footer's three buttons as real buttons on it. The card's own click goes to the
  // space the run was asked from and opens the panel there; a press on a button stops
  // the click there so the card's own one does not also run; a click beside the
  // popup, Esc or fifteen seconds close it.
  renderToast() {
    const t = theme(), r = this.toastRun ?? {};
    const n = r.count ? `${r.count} ${r.count === 1 ? "annotation" : "annotations"}` : "Annotations";
    return h_flex().id("pl-toast").w_full().h(58).px(18).gap(12).items_center().bg(t.popover)
      .cursor_pointer()
      .on_click((_e, cx) => this.toastGo(cx))
      .child(div().size(8).rounded(4).flex_none().bg(t.done))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(n))
        .child(div().truncate().text_size(12).text_color(t.muted).child(`${r.label} · ${ago(r.when)}`)))
      .child(this.iconButton("pl-toast-copy", "copy", (_e, cx) => { cx.stop_propagation(); this.toastCopy(cx); }, OWN, "Copy annotations"))
      .child(this.iconButton("pl-toast-paste", "terminal", (_e, cx) => { cx.stop_propagation(); this.toastPaste(cx); }, ICONS, "Paste into the terminal"))
      .child(this.iconButton("pl-toast-away", "x", (_e, cx) => { cx.stop_propagation(); this.toastAway(cx); }, ICONS, "Put away"));
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
        // An action's words live on its result, not on an answer: a note the person left
        // when they marked it opens in the field, the way a saved answer does.
        if (q?.kind === "action" && String(q?.action_result?.note ?? "").trim()
          && !this.fields.has(this.fieldId(msg, q, "note"))) {
          this.answerField(msg, q, "note", cx);
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
      // An action's record is its result, not an answer: the outcome the marks hold and
      // the note that went with it. The rest of the slots stay empty — an action takes
      // no own option and no written answer.
      const a = q?.kind === "action" ? (q?.action_result ?? {}) : (q?.answer ?? {});
      p = {
        revision: rev,
        selected: [...(a.selected ?? [])],
        other: String(a.other ?? ""),
        note: String(a.note ?? ""),
        text: String(a.text ?? ""),
        outcome: q?.kind === "action" ? (a.outcome ?? null) : null,
        skipped: q?.kind === "action" ? false : Boolean(a.skipped),
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

  // The card's bottom row, the page's: Skip on the left, and, when the recommendation
  // names one of the choices, Accept recommended on the right — the one button on the card
  // that reads as a button, because taking the recommendation is the answer it asks for.
  answerRow(m, q, recLabel) {
    const t = theme();
    return h_flex().w_full().flex_none().gap(8).items_center()
      .child(h_flex().id(`pl-qs-${m?.id}-${q?.key}`).h(20).flex_none().px(4).gap(5).items_center()
        .rounded(4).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.saveSkip(m, q, cx))
        .child(div().text_size(11).text_color(t.muted).child("Skip")))
      .when(Boolean(recLabel), (el) => el.child(div().flex_1())
        .child(h_flex().id(`pl-qr-${m?.id}-${q?.key}`).h(24).flex_none().px(9).items_center()
          .rounded(6).bg(t.selected).text_color(t.accent).cursor_pointer()
          .hover((s) => s.bg(t.accent).text_color(t.accent_foreground))
          .on_click((_e, cx) => this.acceptRecommended(m, q, recLabel, cx))
          .child(div().text_size(11.5).child("Accept recommended"))));
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
        // A skip the card holds stays in the record until a real answer replaces it: a note
        // committed after a skip is a note on the skip, not a taking of it back.
        ...(p.skipped ? { skipped: true } : {}),
        ...(p.other.trim() ? { other: p.other } : {}),
        ...(p.text.trim() ? { text: p.text } : {}),
        ...(p.note.trim() ? { note: p.note } : {}),
      };
      // Nothing chosen, nothing typed: `null` is how a pick is cleared, and how a card that
      // was clicked twice goes back to unanswered. A skip is not nothing — it goes out even
      // when no choice is named — so it counts only through its own flag above.
      const empty = answer.selected.length === 0 && !answer.other && !answer.text && !answer.note
        && !answer.skipped;
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
    this.watch(id, m, work, cx);
  }

  // The page's Skip button, on the card here too: a record of the same shape that names no
  // choice — `selected: []`, `skipped: true` — posted to the same draft a pick goes to, and
  // carried out by the reply's Send like one. A note typed in the open field goes with it,
  // and one the record already holds stays when the field is closed. A skip is an answer
  // like any other: what the person does after it — a ring, an own option, another skip —
  // replaces it, so there is no way back to write.
  saveSkip(m, q, cx) {
    const id = `${m?.id}/${q?.key}`;
    const before = this.saving.get(id) ?? Promise.resolve();
    const work = before.catch(() => {}).then(() => {
      const current = this.recordOf(m, q) ?? q;
      const field = this.fields.get(this.fieldId(m, q, "note"));
      const note = String(field ? field.value() : current?.answer?.note ?? "").trim();
      const answer = {
        v: 1, key: current.key, kind: current.kind, prompt: current.prompt,
        selected: [], skipped: true,
        ...(note ? { note } : {}),
      };
      return asked("POST", `messages/${m.id}/picks`, {
        questions: [{ key: current.key, revision: current.revision, answer }],
      }).then((data) => {
        // The questions as the Inbox now holds them are the panel's copy, and what a skip
        // sweeps away is swept here too: an own option or written answer the fields still
        // hold would draw as if it were going out, and it is not.
        const msg = this.opened?.thread?.messages?.find((x) => x?.id === m?.id);
        if (msg && Array.isArray(data?.questions)) {
          msg.questions = data.questions.filter((x) => x?.key);
          this.fields.get(this.fieldId(m, q, "other"))?.set_value("");
          this.fields.get(this.fieldId(m, q, "text"))?.set_value("");
          const p2 = this.picked.get(id);
          if (p2) p2.dirty = false;
        }
        return data;
      });
    });
    this.watch(id, m, work, cx);
  }

  // The recommendation, taken: the choice it names is picked the way a click picks it —
  // `toggleChoice` saves the same draft — and a ring already on it has nothing to take.
  acceptRecommended(m, q, label, cx) {
    if (!label) return;
    if (this.pickedFor(m, q).selected.includes(label)) return;
    this.toggleChoice(m, q, label, cx);
  }

  // What both saves share once the request is out: one at a time per card (`saving`, the
  // chain `savePick` and `saveAction` join), a Send that waits on it, and the refusal —
  // the Inbox's own sentence, under the card it belongs to. A thread the person has left
  // takes no refusal, and one that moved is read again, so the card draws what it says.
  watch(id, m, work, cx) {
    this.saving.set(id, work);
    // A Send waits on this: the reply names picks and marked actions, and one still in
    // flight would be refused as unsent.
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

  // An action marked, taken back or noted, saved where the page saves it: the browser
  // posts the outcome to `messages/<id>/actions/<key>`, staged so it goes with the next
  // reply, and the reply's Send names it (`unsentActions`). The Inbox takes no note
  // without an outcome — a note on an unmarked action is a request it ignores — so a note
  // typed while nothing is marked stays the draft the next mark carries; and a mark whose
  // outcome has not moved sends only the note (`note_only`), so it does not re-mark.
  saveAction(m, q, cx) {
    const id = `${m?.id}/${q?.key}`;
    const before = this.saving.get(id) ?? Promise.resolve();
    const work = before.catch(() => {}).then(() => {
      const p = this.pickedFor(m, q);
      const current = this.recordOf(m, q) ?? q;
      const had = current?.action_result ?? null;
      const note = String(p.note ?? "").trim();
      // Taking back a mark the Inbox does not hold would be that same ignored request:
      // there is nothing to undo, so nothing goes out and the draft stays as it is.
      if (p.outcome === null && !had) return {};
      const body = p.outcome === null
        ? { outcome: null }
        : { outcome: p.outcome,
            ...(note ? { note } : {}),
            ...(had && had.outcome === p.outcome ? { note_only: true } : {}),
            staged: true };
      return asked("POST", `messages/${m.id}/actions/${current.key}`, body).then((data) => {
        // The questions as the Inbox now holds them — new revision, result written down —
        // are the panel's copy, so a mark made here and one made in the browser are one.
        const msg = this.opened?.thread?.messages?.find((x) => x?.id === m?.id);
        if (msg && Array.isArray(data?.questions)) {
          msg.questions = data.questions.filter((x) => x?.key);
          const p2 = this.picked.get(id);
          if (p2) p2.dirty = false;
        }
        return data;
      });
    });
    this.watch(id, m, work, cx);
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
    // A click on a choice is an answer, and an answer replaces a skip.
    p.skipped = false;
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
    // on a multi one the two stand together. A written answer is the whole answer either
    // way. Words in the answer's own slots replace a skip; a note does not.
    if (slot === "other" && value.trim() && q?.kind !== "multi") { p.selected = []; p.skipped = false; }
    if (slot === "text") { p.selected = []; p.skipped = false; }
    cx?.notify();
    if (q?.kind === "action") this.saveAction(m, q, cx);
    else this.savePick(m, q, cx);
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

  // The actions of this thread marked and not sent: what the reply's Send names, the way
  // the page's own Send does — `{message_id, key}`, the result itself already saved by
  // `saveAction`. A sent one (`sent_revision` caught up with `revision`) is not named
  // again, and one taken back has no result to carry.
  unsentActions(thread) {
    const out = [];
    for (const msg of thread?.messages ?? []) {
      for (const q of msg?.questions ?? []) {
        if (q?.kind !== "action" || !q?.action_result) continue;
        if ((Number(q.sent_revision) || 0) >= (Number(q.revision) || 0)) continue;
        out.push({ message_id: msg.id, key: q.key });
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
  // A skip is a record of the same shape that names no choice (`answer.skipped`, a note
  // beside it is welcome): the card's own Skip writes one, as the page's does, and it
  // travels with the Send like a pick does — "Skipped, not sent" before, "Skipped" in
  // `dim` once it has gone.
  //
  // An action (`:::action`, the todo the agent left) is the same card with a different
  // body: where it happens, the two marks — Done and Can't do it — and the note they
  // carry, saved by `saveAction` and named by the Send like a pick is. Between the mark
  // and the Send it is "· not sent", and still theirs to change or take back; once the
  // Send has carried it the card reads the result back, and nothing on it is clickable.
  renderQuestion(m, q) {
    const t = theme();
    const sent = Boolean(q?.answer) && (Number(q?.sent_revision) || 0) === (Number(q?.revision) || 0);
    // Frozen: what the Inbox will not take an answer for any more. An answer of theirs that
    // has not gone out is still theirs to change, so it stays open here.
    const frozen = Boolean(q?.set_aside_at) || Boolean(q?.superseded_by) || sent;
    const picked = Boolean(q?.answer);
    const skipped = Boolean(q?.answer?.skipped);
    const action = q?.kind === "action";
    // An action's result is its answer: what was done, the note it carried, when. A marked
    // action whose Send has carried it is settled — until then it is still theirs to change.
    const result = action ? (q?.action_result ?? null) : null;
    const settled = Boolean(result) && (Number(q?.sent_revision) || 0) >= (Number(q?.revision) || 0);
    const state = q?.set_aside_at ? "Set aside"
      : q?.superseded_by ? "Replaced"
      : action
        ? (result ? `${result.outcome === "done" ? "Done" : "Can't do it"}${settled ? "" : " · not sent"}` : "Waiting on you")
      : sent ? (skipped ? "Skipped" : "Answered")
      : picked ? (skipped ? "Skipped, not sent" : "Picked, not sent")
      : "Waiting on you";
    const tone = q?.set_aside_at || q?.superseded_by ? t.dim
      : action
        ? (result ? (settled ? (result.outcome === "done" ? t.done : t.dim) : t.accent) : t.working)
      : sent ? (skipped ? t.dim : t.done)
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
    const recChoice = (q?.choices ?? []).find(isRecommended);
    const recIsChoice = Boolean(recChoice);
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
    // An action has none — its words are the note on the result.
    const other = String(action ? "" : q?.answer?.other ?? "").trim();
    const note = String((action ? result?.note : q?.answer?.note) ?? "").trim();
    const editable = !frozen && !action;
    // An action the person can still act on: marked or not, until the Send carries it.
    const openAction = action && !frozen && !settled;
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
        .when(editable || openAction, (el) => el.child(this.fieldRow(m, q, "note", "Add a note")))
        // The card's own row of ways to move on, the page's bottom row drawn the panel's
        // way: Skip writes the skipped record, and, when the recommendation names one of
        // the choices, Accept recommended picks it — both saved at once, like a ring is.
        .when(editable, (el) => el.child(this.answerRow(m, q, recChoice?.label)))
        // An action's own rows: where it happens — a link the click opens in the person's
        // browser — the two marks, the way back off one, and what the agent is watching
        // for. The marks are chips, the one the action already wears filled in; a mark
        // saves at once (`saveAction`), like a ring does.
        .when(action && Boolean(q?.action?.where_url), (el) => el.child(h_flex().id(`pl-qw-${m?.id}-${q?.key}`).h(20).flex_none()
          .gap(5).items_center().rounded(4).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click(() => this.openWhere(q.action.where_url))
          .child(svg(`${ICONS}/chevron-right.svg`).size(11).flex_none().text_color(t.accent))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.accent)
            .child(String(q.action.where_url)))))
        .when(openAction, (el) => el.child(h_flex().w_full().flex_none().gap(6)
          .child(this.markButton(m, q, "done", "check", "Done"))
          .child(this.markButton(m, q, "cant", "x", "Can't do it"))))
        .when(openAction && Boolean(result), (el) => el.child(h_flex().id(`pl-qu-${m?.id}-${q?.key}`).h(20).flex_none()
          .gap(5).items_center().rounded(4).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { const p = this.pickedFor(m, q); p.outcome = null; p.dirty = true; cx.notify(); this.saveAction(m, q, cx); })
          .child(svg(`${ICONS}/trash.svg`).size(11).flex_none().text_color(t.dim))
          .child(div().text_size(11).text_color(t.dim).child("Take back"))))
        .when(action && Boolean(result), (el) => {
          const at = Date.parse(result.at);
          return el.child(div().text_size(10.5).text_color(t.dim)
            .child(`Marked ${Number.isFinite(at) ? ago(at) : "just now"}`));
        })
        .when(action && Boolean(q?.action?.watching), (el) => el.child(div().text_size(11).text_color(t.dim)
          .child(`Watching: ${q.action.watching}`)))
        .when(action && Boolean(q?.stopped), (el) => el.child(div().text_size(11).text_color(t.dim)
          .child(`Stopped: ${q.stopped}`)))
        // What the record holds, once nothing can be typed into it: their words back, and
        // the note they left on them.
        .when(!editable && Boolean(other), (el) => el.child(h_flex().w_full().flex_none().px(4).py(2)
          .gap(7).items_start().child(ring(true, false)).child(label(other, false))))
        .when(!editable && Boolean(q?.answer?.text), (el) => el.child(div().w_full().text_size(12).line_height(1.5)
          .child(TextView.markdown(`pl-qa-${m?.id}-${q?.key}`, String(q.answer.text)))))
        .when(!(q?.choices ?? []).length && q?.kind !== "action" && !editable && !q?.answer?.text,
          (el) => el.child(div().text_size(11).text_color(t.dim).child("No answer")))
        // What the record holds, once nothing can be typed into it: their words back, and
        // the note they left on them. While a field is open the note lives in it, not here —
        // drawing both would say it twice.
        .when(!editable && !openAction && Boolean(note), (el) => el.child(v_flex().w_full().flex_none().gap(2)
          .child(div().text_size(10.5).text_color(t.dim).child("Note"))
          .child(div().text_size(12).text_color(t.muted).child(note))))
        // Only when it names no choice on the card: otherwise the tag above has said it.
        .when(Boolean(rec) && !recIsChoice, (el) => el.child(div().text_size(11).text_color(t.dim)
          .child(`Recommended: ${rec}`)))
        .when(Boolean(holds), (el) => el.child(div().text_size(11).text_color(t.dim).child(`Holds up: ${holds}`)))
        // A refusal is the Inbox's own sentence, under the card it belongs to.
        .when(this.cardError?.id === `${m?.id}/${q?.key}`, (el) => el.child(div().text_size(11)
          .text_color(t.blocked).child(this.cardError.text)))
        .when(!action, (el) => el.child(this.gotoInbox("Answer in the Inbox", `pl-qa-${m?.id}-${q?.key}`)))
        .when(action, (el) => el.child(this.gotoInbox("Open in the Inbox", `pl-qa-${m?.id}-${q?.key}`))));
  }

  // The row that hands the rest to the page: an answer the panel cannot make (a picture,
  // a pick on the page) or an action's own card, with its comment thread. One builder,
  // two words — what it says is the only difference between the kinds.
  gotoInbox(label, id) {
    const t = theme();
    return h_flex().id(id).h(20).flex_none().gap(5)
      .items_center().rounded(4).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => this.respond())
      .child(svg(`${ICONS}/square-pen.svg`).size(11).flex_none().text_color(t.accent))
      .child(div().text_size(11).text_color(t.accent).child(label));
  }

  // One of an action's two marks, as a chip beside its twin: the one the action already
  // wears is filled in, the other waits. A click is the pick and its save in one, the way
  // a choice ring is — and clicking the worn one does nothing, so a double click is one
  // save, not a mark and an undo.
  markButton(m, q, outcome, icon, label) {
    const t = theme(), on = this.pickedFor(m, q).outcome === outcome;
    return h_flex().id(`pl-qd-${m?.id}-${q?.key}-${outcome}`).h(24).flex_none().px(9).gap(6).items_center()
      .rounded(5).border_1().border_color(on ? t.accent : t.border)
      .when(on, (el) => el.bg(t.selected))
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        const p = this.pickedFor(m, q);
        if (p.outcome === outcome) return;
        p.outcome = outcome;
        p.dirty = true;
        cx.notify();
        this.saveAction(m, q, cx);
      })
      .child(svg(`${ICONS}/${icon}.svg`).size(11).flex_none().text_color(on ? t.accent : t.dim))
      .child(div().text_size(11.5).text_color(on ? t.accent : t.foreground).child(label));
  }

  // An action's Where, opened in the person's browser: `open` on macOS, `xdg-open` where
  // that is what a desktop answers. The panel itself talks to nothing but the Inbox.
  openWhere(url) {
    exec("sh", ["-c", 'command -v open >/dev/null 2>&1 && open "$1" || xdg-open "$1"', "sh", String(url)])
      .then((r) => {
        if (r.code !== 0) notify({ title: "Plannotator", body: "The link would not open", level: "error" });
      })
      .catch(() => notify({ title: "Plannotator", body: "The link would not open", level: "error" }));
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
    const keep = tailOf(messages);
    let cut = this.showAll ? 0 : Math.max(0, messages.length - keep);
    // A question nobody has answered is never the thing behind the row: opening a thread is
    // how the person finds out what it is waiting on.
    if (cut > 0) {
      const waiting = messages.findIndex((m) => (Array.isArray(m?.questions) ? m.questions : []).some((q) =>
        !q?.set_aside_at && !q?.superseded_by &&
        (q?.kind === "action"
          ? !q?.action_result || (Number(q?.sent_revision) || 0) < (Number(q?.revision) || 0)
          : !(q?.answer && (Number(q?.sent_revision) || 0) === (Number(q?.revision) || 0)))));
      if (waiting >= 0 && waiting < cut) cut = waiting;
    }
    const earlier = messages.slice(0, cut);
    const at = th ? Date.parse(th.messages?.[0]?.created_at) : NaN;
    // The reply: a field, and a Send beside it. The words go to the agent that spoke last,
    // with every answer the cards have picked and not sent — `questions` names them, and the
    // Inbox holds the answers themselves. Pictures, tags and resolves stay in the page,
    // which is the row under it. Nothing is drawn while the thread is still being read: a
    // Send with no messages behind it has nothing to answer.
    const words = String(this.draft?.value() ?? "").trim();
    const picks = this.unsentPicks(th);
    const acts = this.unsentActions(th);
    // The comments made on this thread's words, on screen until the Send carries them; the
    // ones made in the browser (or before this run of the panel) are in the Inbox's draft
    // and not here, so the band counts those rather than pretending the draft is empty.
    const notes = this.notes.filter((n) => n.text);
    const elsewhere = Math.max(0, this.inboxComments - notes.length);
    const carried = [
      picks.length ? `${picks.length} ${picks.length === 1 ? "answer" : "answers"}` : null,
      acts.length ? `${acts.length} ${acts.length === 1 ? "task" : "tasks"}` : null,
      notes.length ? `${notes.length} ${notes.length === 1 ? "comment" : "comments"}` : null,
    ].filter(Boolean).join(" and ");
    const can = Boolean(words) || picks.length > 0 || acts.length > 0 || notes.length > 0;
    const full = Boolean(th && this.draft) && lastAgentOf(messages) !== null;
    // The field *is* the band, not a box inside one. It used to be a bordered, rounded box
    // inset 12 px inside the footer, which put a frame around a frame at the bottom of every
    // thread; now it runs the panel's full width, sits on `popover` — the token one step up
    // from the page, the same one the person's own messages are boxed in — and the rule above
    // it turns `accent` while they are in it, which is what the inner border used to say.
    const field = () => v_flex().id("pl-reply").flex_none().w_full().px(10).py(8).gap(6)
      .bg(t.popover).border_t(1)
      // The rule above the field turns accent while the person is in it — and only then: a
      // comment being written higher up the page has the keyboard, not this field.
      .border_color(this.writing && !this.commenting ? t.accent : t.border)
      // A comment made higher up the page is carried by this Send, so it is drawn here,
      // where the Send is: the quote it stands for, its words, and the way to put it away.
      .when(notes.length > 0, (el) => el.child(v_flex().w_full().flex_none().gap(4)
        .children(notes.map((n) => this.renderNote(n)))))
      .when(elsewhere > 0, (el) => el.child(div().text_size(10.5).text_color(t.dim)
        .child(elsewhere === 1
          ? "1 more comment is in this thread's draft in the Inbox"
          : `${elsewhere} more comments are in this thread's draft in the Inbox`)))
      .child(h_flex().items_end().gap(8).w_full()
        .child(div().flex_1().min_w(0).child(Textarea.new(this.draft)))
        .child(h_flex().id("pl-send").h(26).flex_none().px(10).items_center().rounded(6)
          .when(can && !this.reply?.busy, (el) => el.cursor_pointer().bg(t.solid).text_color(t.solid_foreground)
            .hover((s) => s.bg(t.accent).text_color(t.accent_foreground)))
          .when(!can || Boolean(this.reply?.busy), (el) => el.bg(t.raised).text_color(t.dim))
          .on_click((_e, cx) => this.send(cx))
          .child(div().text_size(12).child(this.reply?.busy ? "Sending…" : "Send"))))
      // What the Send is carrying besides words, so a pick made two cards up — or a comment
      // made on a paragraph — is not forgotten at the bottom of the page.
      .when(carried !== "", (el) => el.child(div().text_size(11).text_color(t.accent)
        .child(`${carried} ${picks.length + notes.length === 1 ? "goes" : "go"} with this reply`)))
      .when(Boolean(this.reply?.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.reply.error)));
    // Three rows: what the thread is, the conversation, the way to answer it. Only the
    // conversation scrolls — a project that scrolled away would leave the person reading
    // messages with no idea whose thread they are, and a field that scrolled away would
    // have to be found before every reply.
    // The head carries the thread's id at its right, one press away while the thread is
    // on screen, then the page's read/unread and archive after it: the envelope says the
    // state — a closed one is unread, an open one read — and the box archives. Only when
    // the thread has loaded: an id the read failed to bring has nothing to copy.
    const head = h_flex().id("pl-thread-head").h(26).flex_none().px(14).gap(6).items_center().border_b(1)
      .border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim)
        .child([th?.project?.name, Number.isFinite(at) ? ago(at) : null].filter(Boolean).join(" · ")));
    if (th) {
      const read = this.opened?.row?.read_at != null;
      head.child(this.iconButton("pl-copy-id", "copy", (_e, cx) => this.copyThreadId(cx), OWN, "Copy thread ID"));
      head.child(this.iconButton(`pl-read-toggle-${read ? "unread" : "read"}`, read ? "mail-open" : "mail",
        (_e, cx) => this.setRead(!read, cx), OWN, read ? "Mark unread" : "Mark read"));
      head.child(this.iconButton("pl-archive", "archive", (_e, cx) => this.archiveThread(cx), ICONS, "Archive thread"));
    }
    return v_flex().id("pl-thread").flex_1().min_h(0).w_full().max_w(760)
      .child(head)
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
      // No bottom padding: the reply band is the page's last pixel, sitting on the panel's
      // own edge the way the tab bar's rows do. The card's rounding clips it, and the
      // field's own 6 px is what separates the band from the box above it. The way to the
      // page for picks and pictures is the top bar's button now, not a row of its own.
      .when(full, (el) => el.child(v_flex().id("pl-thread-foot").flex_none().w_full().pt(2).border_t(1)
        .border_color(t.border).child(field())));
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
    const { parts, pictures } = wordsOf(asked.length ? wordsWithoutQuestions(m?.body) : m?.body);
    // The words and the pictures in the order they were written: a message that says "before,
    // then after" draws both where the agent wrote them. A picture whose file could not be
    // copied is not drawn, and the count at the end of the message says how many there were.
    const root = this.opened?.thread?.project?.root;
    let drawn = 0;
    const boxes = [];
    // An agent's words are what a comment goes on: the person's own are not something to
    // write back to them about.
    const noteable = m?.author?.kind !== "person";
    const noteTarget = { kind: "message", messageId: m?.id };
    parts.forEach((part, i) => {
      if (part.type === "text") {
        // A part is cut into its paragraphs, and each of those is one block the pointer can
        // open a comment on: see `blocksOf` for why the block, not the selection.
        const blocks = blocksOf(part.text);
        boxes.push(v_flex().w_full().flex_none().gap(3).text_size(14).line_height(1.6)
          .children(blocks.map((block, j) => (noteable
            ? this.renderNoteBlock(`m-${m?.id}-${i}-${j}`, block, { ...noteTarget, blockId: `block-${j + 1}` })
            : div().w_full().child(TextView.markdown(`pl-md-${m?.id}-${i}-${j}`, block))))));
        return;
      }
      const file = this.shots.get(pictureAt(part.url, root));
      if (!file?.rel) return;
      drawn += 1;
      boxes.push(this.renderInline(m, { ...part, i, file }));
    });
    const missed = Math.max(0, pictures - drawn);
    // A message that is only a question is the question's card, not "no words" above it.
    if (boxes.length === 0 && asked.length === 0) {
      boxes.push(div().w_full().text_size(14).line_height(1.6)
        .child(TextView.markdown(`pl-md-${m?.id}`, "_(no words)_")));
    }
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
      // a page of blank lines, not a looser one. The words come in pieces — the markdown
      // between one picture and the next — so a message with two screenshots in it reads
      // as the agent wrote it, and the question cards follow the lot.
      .children(boxes)
      .children(asked.map((q) => this.renderQuestion(m, q)))
      // The Inbox puts a paperclip and a count over its cards, and the count is what says the
      // cards are the message's attachments rather than something the panel drew.
      .when(atts.length > 0, (el) => el.child(v_flex().w_full().flex_none().gap(5).pt(3)
        .child(h_flex().h(16).flex_none().gap(5).items_center()
          .child(svg(`${ICONS}/files.svg`).size(11).flex_none().text_color(t.dim))
          .child(div().text_size(11).text_color(t.dim)
            .child(atts.length === 1 ? "1 attachment" : `${atts.length} attachments`)))
        .when(pics.length > 0, (s) => s.child(h_flex().gap(6).flex_wrap().items_start()
          .children(pics.map((a) => this.renderPicture(a)))))
        .when(files.length > 0, (s) => s.child(v_flex().w_full().flex_none().gap(5)
          .children(files.map((a) => this.renderChip(a)))))))
      // The field for a comment made on an attached picture, from the picture's dialog: it
      // draws under the row of them — a field is the width of the message and that row wraps a
      // picture beside a picture. A picture the agent wrote into its words draws its own field
      // under itself (`renderInline`).
      .when(pics.some((a) => this.commenting?.key === `pic-${a.id}`),
        (el) => el.child(v_flex().w_full().flex_none().child(this.renderNoteField())))
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
  // A picture an agent wrote into its message: a thumbnail centred in the column, no
  // taller than `PICTURE_CAP`, and a click that opens it at the size it was taken. A
  // portrait screenshot — and agents take a lot of those — is a stamp here rather than a
  // column of screen it never earned. The click is on the box around the picture, not on
  // the picture: a native image element takes styles but does not itself take a press.
  // A comment on one is a comment on the message that wrote it, quoted with the markdown the
  // agent wrote for it — the picture itself is no record the Inbox has, and the person's own
  // message is not something to write back to them about.
  renderInline(m, p) {
    const px = this.pictureWidth(p.file, PICTURE_CAP);
    return v_flex().id(`pl-in-${m?.id}-${p.i}`).w_full().flex_none().items_center()
      .child(h_flex().id(`pl-in-b-${m?.id}-${p.i}`).flex_none().rounded(6).cursor_pointer()
        .hover((s) => s.opacity(0.92))
        .on_click(() => this.openPicture({
          rel: p.file.rel,
          name: p.alt,
          width: p.file.width,
          height: p.file.height,
          // The comment is on the message, and its field is drawn under this picture and no
          // other — a message can hold two.
          key: `pic-m-${m?.id}-${p.i}`,
          messageId: m?.author?.kind === "person" ? "" : String(m?.id ?? ""),
          quote: `![${String(p.alt ?? "")}](${String(p.url ?? "")})`,
        }))
        .child(image(p.file.rel).w(px).rounded(6)))
      // The comment made on this picture, from its dialog: right under it, where the pointer
      // that opened the picture was.
      .when(this.commenting?.key === `pic-m-${m?.id}-${p.i}`,
        (el) => el.child(v_flex().w_full().flex_none().pt(2).child(this.renderNoteField())));
  }

  // One file an agent attached, drawn as the Inbox draws one: a card with its kind's glyph in
  // a square of its own, its name over the kind and the size. Three of those in a 312 px
  // column stack, which is what makes them pressable — a chip beside two others reads as a
  // tag, and a tag is the last thing on a page a person thinks to click.
  renderChip(a) {
    const t = theme(), ext = extOf(a.name), kind = kindOf(a.kind);
    return h_flex().id(`pl-att-${a.id}`).w_full().flex_none().gap(9).p(8).rounded(8)
      .bg(t.popover).border_1().border_color(t.border)
      .hover((s) => s.bg(t.hover)).cursor_pointer()
      .on_click((_e, cx) => this.openAttachment(a, cx))
      .child(h_flex().size(26).flex_none().rounded(6).bg(t.background)
        .items_center().justify_center()
        .child(svg(glyphOf(a.kind)).size(14).flex_none().text_color(t.muted)))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_size(12.5).font_semibold().text_color(t.foreground)
          .child(a.name ?? "file"))
        .child(div().truncate().text_size(11).text_color(t.dim)
          // The Inbox names a code file's extension there, and it is the one thing that says
          // why a patch opens plain: there is no such language.
          .child(`${kind === "Code" ? `Code (.${ext})` : kind} · ${sizeOf(a.size)}`)))
      .child(svg(`${ICONS}/chevron-right.svg`).size(12).flex_none().text_color(t.dim));
  }

  // A picture an agent attached, drawn in its message. Until its bytes land it is the same
  // row a document gets, so the message never draws an empty space where a file was.
  renderPicture(a) {
    const t = theme(), file = this.files.get(a.id);
    if (!file) return this.renderChip(a);
    return v_flex().id(`pl-pic-${a.id}`).flex_none().gap(3).cursor_pointer()
      .on_click(() => this.openPicture({
        rel: file.rel, name: a.name, width: a.width, height: a.height,
        attachmentId: a.id, version: a.sent_sha256,
      }))
      .child(image(file.rel).w(this.pictureWidth(a)).rounded(6))
      .child(div().text_size(10.5).text_color(t.accent).truncate()
        .child(`${a.name ?? "picture"} · ${sizeOf(a.size)}`));
  }

  // The row that opens a comment on a whole file: the code view has no paragraph to press,
  // and a picture has nothing to press at all. It sits above what it is about, counts the
  // comments already made on the same file that the Send will carry, and its `key` is what
  // the field is drawn under.
  noteRow(key, target, quote, label, mine = 0) {
    const t = theme();
    return h_flex().id(`pl-note-add-${key}`).h(22).flex_none().px(14).gap(6).items_center()
      .hover((s) => s.bg(t.hover)).cursor_pointer()
      .on_click((_e, cx) => this.openCommentOn(key, target, "", cx, quote))
      .child(svg(`${ICONS}/plus.svg`).size(11).flex_none().text_color(t.dim))
      .child(div().flex_none().text_size(11.5).text_color(t.muted).child(label))
      .child(div().flex_1())
      .when(mine > 0, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.accent)
        .child(mine === 1 ? "1 goes with your reply" : `${mine} go with your reply`)));
  }

  // A file on the panel's own page: read-only, and only ever read. The header above names
  // it and its back button is the thread it came in; the row under the header says what
  // kind of file it is and how big, and the body is the file itself — drawn, rendered or
  // listed — since that is what the person came here for.
  renderAttachment() {
    const t = theme(), v = this.viewing, a = v?.att ?? {};
    const kind = kindOf(a.kind);
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
        // A picture takes the one thing this page can add to a file, and takes it as a whole:
        // there is no document under the picture to name a place in, so the comment is the
        // Inbox's own whole-image one, quoted with the picture's name.
        const key = `pic-${a.id}`;
        const mine = this.notes.filter((n) => n.target?.attachmentId === a.id);
        return v_flex().id("pl-view-pic-wrap").flex_1().min_h(0).w_full()
          .when(Boolean(v.file), (el) => el.child(this.noteRow(key, {
            kind: "file", file: a.name ?? "this picture", attachmentId: a.id,
            version: a.sent_sha256 || "current", blockId: "image",
          }, a.name ?? "this picture", "Comment on this picture", mine.length)))
          .child(v_flex().id("pl-view-pic").flex_1().min_h(0).w_full().overflow_y_scrollbar().p(10)
            .items_center().gap(8)
            .when(Boolean(v.file), (el) => el
              .child(h_flex().id("pl-view-pic-b").flex_none().rounded(6).cursor_pointer()
                .on_click(() => this.openPicture({
                  rel: v.file.rel, name: a.name, width: a.width, height: a.height,
                  attachmentId: a.id, version: a.sent_sha256,
                }))
                .child(image(v.file.rel).w(this.pictureWidth(a, null)).rounded(6)))
              .child(row("Open full size in the browser", `/api/inbox/attachments/${a.id}/image`,
                `${OWN}/image.svg`))))
          .when(this.commenting?.key === key,
            (el) => el.child(v_flex().w_full().flex_none().px(12).pb(4).child(this.renderNoteField())));
      }
      // Code, a patch and every other text file is listed by the code view, which scrolls
      // itself, keeps its line numbers and knows the file's language by its name. A web
      // page is only ever its source here: the Inbox renders the page itself, and a row
      // goes there.
      if (!asDocument(a)) {
        // The `Editor` knows its lines but not where the pointer is in them, so a file has
        // one way in rather than a block per paragraph: the whole file is the comment's
        // anchor, which is the Inbox's own general comment.
        const key = `file-${a.id}`;
        const mine = this.notes.filter((n) => n.target?.attachmentId === a.id);
        return v_flex().id("pl-view-code").flex_1().min_h(0).w_full()
          .child(this.noteRow(key, {
            kind: "file", file: a.name ?? "this file", attachmentId: a.id,
            // The copy the person is reading is the one the Inbox kept for the send, and
            // that is the version its annotations are filed against.
            version: a.sent_sha256 || "current", blockId: "",
          }, "", "Comment on this file", mine.length))
          .when(this.commenting?.key === key, (el) => el.child(v_flex().px(12).pb(4).child(this.renderNoteField())))
          .when(a.kind === "html", (el) => el
            .child(div().flex_none().px(14).pt(6).text_size(11).text_color(t.dim)
              .child("A web page reads as its source here; the Inbox shows it as a page."))
            .child(v_flex().px(6).pt(2).items_start().child(inThread())))
          .when(Boolean(v.editor), (el) => el.child(v_flex().flex_1().min_h(0).w_full().px(6).py(4)
            .child(Editor.new(v.editor))));
      }
      // Markdown, the one kind the viewer draws: the person's own document, read as the
      // thread's messages are — and, like them, cut into the blocks a comment goes on.
      const topic = {
        kind: "file", file: a.name ?? "this file", attachmentId: a.id,
        version: a.sent_sha256 || "current",
      };
      return v_flex().id("pl-view-doc").flex_1().min_h(0).w_full().overflow_y_scrollbar().px(14).py(10)
        .child(v_flex().w_full().text_size(13.5).line_height(1.6)
          .children(rowsOf(v.text || "").map((r, i) =>
            this.renderNoteBlock(`a-${a.id}-${i}`, r.block,
              { ...topic, blockId: `block-${i + 1}`, line: r.first, lines: r.last })))
          .when(!v.text, (el) => el.child(div().w_full()
            .child(TextView.markdown(`pl-att-${a.id}`, "_(no words)_")))));
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
    if (this.mode === "picture") return this.renderPicturePage();
    if (this.mode === "toast") return this.renderToast();
    return this.renderPanel(cx);
  }

  // A picture at its own size, in a dialog the panel opened: the name it was sent under, the
  // way out (Esc closes a dialog by itself; the cross is for the pointer), and the picture.
  // `image()` keeps the file's shape when only its width is set, which is why the width is
  // all it is given — the height came from the file and sized the dialog. Under a picture the
  // Inbox holds as an attachment, one row: the way to comment on it. There is no field in
  // here — the dialog is the picture's own size and a field would cut it off — so the press
  // hands the `ask` back to the panel and closes, and the field opens under the picture in
  // the thread, where the words have somewhere to go and the reply they ride behind.
  renderPicturePage() {
    const t = theme(), p = props() ?? {};
    const file = String(p.file ?? ""), name = String(p.name ?? ""), ask = String(p.ask ?? "");
    const w = Number(p.w) || 720;
    return v_flex().id("pl-picture").w_full().h_full().bg(t.popover).gap(8).p(12)
      .child(h_flex().flex_none().gap(8).items_center()
        .child(svg(`${OWN}/image.svg`).size(13).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted)
          .child(name || "Picture"))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("Esc"))
        .child(h_flex().id("pl-picture-x").size(18).flex_none().items_center().justify_center()
          .rounded(4).hover((s) => s.bg(t.hover)).cursor_pointer()
          .on_click(() => this.close())
          .child(svg(`${ICONS}/x.svg`).size(12).flex_none().text_color(t.muted))))
      .child(v_flex().flex_1().min_h(0).w_full().items_center().justify_center()
        .child(image(file).w(w).rounded(6)))
      // No background of its own, so the theme's hover tint is what it takes: a filled row
      // tinted with alpha would go see-through under the pointer.
      .when(Boolean(ask), (el) => el.child(h_flex().id("pl-picture-note").h(22).flex_none().px(8)
        .gap(7).items_center().rounded(5).hover((s) => s.bg(t.hover)).cursor_pointer()
        .on_click((_e, cx) => this.askPicture(ask, cx))
        .child(svg(`${ICONS}/square-pen.svg`).size(12).flex_none().text_color(t.accent))
        .child(div().text_size(11.5).text_color(t.accent).child("Comment on this picture"))
        .child(div().flex_1())
        .child(div().text_size(10.5).text_color(t.dim).child("goes with your reply"))));
  }

  // The dialog's one press: the `ask` it was opened with goes back through the shared key
  // every copy re-renders on, and the dialog closes — the field it opens belongs in front of
  // the person, not behind a picture. Nothing else is written here: the panel holds the
  // thread, the attachment and its version, and the dialog holds only a picture and a word.
  askPicture(ask, cx) {
    if (!ask) return;
    setShared(PICTURE, { ask });
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);
    else cx?.notify();
  }
}
