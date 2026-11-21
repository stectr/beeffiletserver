const http = require("http");
const fs = require("fs");
const path = require("path");
const ICON = fs.readFileSync(__dirname + "/icon2.png");

const PORT = process.env.PORT || 3000;
const SRC = "https://www.truthforlife.org/daily/";
const LEADERBOARD_FILE = path.join(__dirname, "tetris-leaderboard.json");
const LEADERBOARD_LIMIT = 10;
const cache = new Map(); // date -> {at, data}
const TTL = 30 * 60 * 1000;
let leaderboard = [];
let leaderboardWrite = Promise.resolve();

const leaderboardReady = fs.promises.readFile(LEADERBOARD_FILE, "utf8")
  .then((contents) => {
    const parsed = JSON.parse(contents);
    if (!Array.isArray(parsed)) throw new Error("Tetris leaderboard file must contain an array");
    leaderboard = parsed
      .filter((entry) => entry && typeof entry.name === "string"
        && Number.isSafeInteger(entry.score) && entry.score >= 0
        && Number.isSafeInteger(entry.lines) && entry.lines >= 0
        && Number.isSafeInteger(entry.level) && entry.level >= 1
        && typeof entry.date === "string");
  })
  .catch((error) => {
    if (error.code === "ENOENT") return;
    throw error;
  });

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req, maxBytes = 4096) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

function saveLeaderboardEntry(entry) {
  const operation = leaderboardWrite.then(async () => {
    const next = [...leaderboard, entry];
    await fs.promises.mkdir(path.dirname(LEADERBOARD_FILE), { recursive: true });
    const temporaryFile = `${LEADERBOARD_FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporaryFile, JSON.stringify(next, null, 2), { mode: 0o600 });
    await fs.promises.rename(temporaryFile, LEADERBOARD_FILE);
    leaderboard = next;
    return getLeaderboardEntries();
  });
  leaderboardWrite = operation.then(() => undefined, () => undefined);
  return operation;
}

function getLeaderboardEntries() {
  const sorted = [...leaderboard]
    .sort((a, b) => b.score - a.score || b.lines - a.lines || a.date.localeCompare(b.date));
  const names = new Set();
  return sorted.filter((entry) => {
    const name = entry.name.normalize("NFC").trim().toLowerCase();
    if (names.has(name)) return false;
    names.add(name);
    return true;
  }).slice(0, LEADERBOARD_LIMIT);
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clean = (s) =>
  s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
function divsWithClass(html, className) {
  const divs = [];
  const tags = /<\/?div\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  let match;
  while ((match = tags.exec(html))) {
    if (/^<\//.test(match[0])) continue;
    const classes = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0]);
    if (!classes || !(classes[1] || classes[2] || classes[3]).split(/\s+/).includes(className)) continue;
    const start = tags.lastIndex;
    let depth = 1;
    while (depth && (match = tags.exec(html))) {
      depth += /^<\//.test(match[0]) ? -1 : 1;
    }
    if (depth) throw new Error(`Unclosed ${className} section on source page`);
    divs.push(html.slice(start, match.index));
  }
  return divs;
}

function safeContent(html) {
  const allowed = new Set(["p", "blockquote", "br", "em", "i", "strong", "b", "sup", "sub", "ul", "ol", "li", "h2", "h3", "h4"]);
  const tags = /<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const text = (s) => s.replace(/&(?!(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  html = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  let result = "";
  let last = 0;
  for (const match of html.matchAll(tags)) {
    result += text(html.slice(last, match.index));
    const tag = /^<(\/?)([a-z][\w:-]*)/i.exec(match[0]);
    if (tag && allowed.has(tag[2].toLowerCase())) {
      const name = tag[2].toLowerCase();
      const classes = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0]);
      const sourceClasses = (classes && (classes[1] || classes[2] || classes[3]) || "").split(/\s+/);
      const safeClasses = name === "p"
        ? [
          ...(sourceClasses.includes("line") ? ["scripture-line"] : []),
          ...sourceClasses.filter((className) => className === "indent1" || className === "indent2"),
          ...(sourceClasses.includes("scripture-stanza") ? ["scripture-stanza"] : []),
        ]
        : name === "h3" && sourceClasses.includes("psalm-book") ? ["psalm-book"] : [];
      result += `<${tag[1]}${name}${safeClasses.length && !tag[1] ? ` class="${safeClasses.join(" ")}"` : ""}>`;
    }
    last = match.index + match[0].length;
  }
  return result + text(html.slice(last));
}

function stripAnchorsByClass(html, excludedClasses) {
  return html.replace(/<a\b([^>]*)>[\s\S]*?<\/a>/gi, (anchor, attributes) => {
    const match = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
    const classes = (match && (match[1] || match[2] || match[3]) || "").split(/\s+/);
    return classes.some((className) => excludedClasses.includes(className)) ? "" : anchor;
  });
}

function parse(html) {
  const start = html.indexOf("id=alistair_begg_devotional");
  if (start < 0) return null;
  const seg = html.slice(start);
  const end = seg.indexOf("devotional_topics");
  const s = end > 0 ? seg.slice(0, end) : seg;
  const title = (s.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
  if (!title) return null;
  const verse = (s.match(/devotional_scripture_text>([\s\S]*?)<\/div>/) || [])[1] || "";
  const ref = (s.match(/devotional_scripture_reference>([\s\S]*?)<\/div>/) || [])[1] || "";
  const body = divsWithClass(s, "content-body")[0];
  if (!body || !body.trim()) throw new Error("Could not find devotional content on source page");
  const questions = [...s.matchAll(/devotional-questions__text>([\s\S]*?)<\/p>/g)].map(
    (m) => clean(m[1])
  );
  const furtherReading = [
    ...s.matchAll(
      /<div class=["']?reading__title["']?>([\s\S]*?)<\/div>[\s\S]*?<div class=["']reading__passage passage["']>([\s\S]*?)<\/div>\s*<a class=["']reading__link/gi
    ),
  ].map((m) => ({
    title: clean(m[1]),
    text: safeContent(stripAnchorsByClass(
      m[2].replace(/<span\b[^>]*\bclass=["']?line-group["']?[^>]*>\s*<\/span>/gi, '<p class="scripture-stanza"></p>')
        .replace(/<a\b[^>]*\bclass=["']?crossreference["']?[^>]*>[\s\S]*?<\/a>/gi, ""),
      ["footnote"]
    )),
  }));
  return {
    title: clean(title),
    verse: clean(verse),
    ref: clean(ref),
    body: safeContent(stripAnchorsByClass(body, ["ab_footnote", "footnote"])),
    questions,
    furtherReading,
  };
}

async function getDevo(date) {
  const hit = cache.get(date);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const url = `${SRC}?tab=alistair_begg_devotional${date ? "&date=" + encodeURIComponent(date) : ""}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 devo-reader" } });
  if (!res.ok) throw new Error("Source returned " + res.status);
  const data = parse(await res.text());
  if (!data) throw new Error("Could not find devotional on source page");
  cache.set(date, { at: Date.now(), data });
  return data;
}

const fmt = (d) =>
  `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d) ? null : d;
}
const toIso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const CSS = `
html,body{touch-action:pan-x pan-y}
button,a{touch-action:manipulation}
body{background:#f4f4f2;color:#222;font-family:Georgia,"Iowan Old Style","Palatino Linotype",serif;font-size:18px;line-height:1.7;margin:0}
#wrap{max-width:34em;margin:0 auto;padding:32px 22px 56px}
h1.site{font-size:clamp(9px,2.8vw,12px);font-weight:normal;text-align:center;text-transform:uppercase;letter-spacing:.18em;color:#777;margin:0;white-space:nowrap}
nav{display:grid;grid-template-columns:1fr auto 1fr;align-items:baseline;font-size:14px;margin:14px 0 20px;color:#999}
nav .prev{text-align:right}
nav .next{text-align:left}
nav .disabled{opacity:.35;margin:0 10px;cursor:default}
nav a{margin:0 10px;border-bottom:0}
a{color:#555;text-decoration:none;border-bottom:1px solid #bbb}
a:hover{color:#000;border-color:#000}
.toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 12px;margin:0 0 32px}
.toolbar .group{display:flex;align-items:center;gap:2px 6px}
.size-option{font:inherit;color:#666;background:none;border:0;padding:2px 6px;cursor:pointer;line-height:1.4}
.size-option:hover:not(:disabled){color:#000}
.size-option:disabled{opacity:.35;cursor:default}
.size-option:focus-visible{outline:2px solid currentColor;outline-offset:2px}
#content{font-size:var(--fs,16px)}
.loader{width:28px;height:28px;margin:48px auto;border:3px solid currentColor;border-right-color:transparent;border-radius:50%;color:#999;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
body.high-contrast .loader{color:#000}
body.high-contrast.black .loader{color:#fff}
.appearance-option{font:inherit;font-size:13px;color:#666;background:none;border:0;padding:2px 4px;cursor:pointer}
.appearance-option[aria-pressed="true"]{color:#222;text-decoration:underline;text-underline-offset:3px}
.appearance-option:hover{color:#000}
.appearance-option:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.devotional-title{font-size:clamp(1.45em,6vw,1.78em);font-weight:normal;text-align:center;line-height:1.2;max-width:22em;margin:0 auto 10px;text-wrap:balance}
.date{text-align:center;font-style:italic;color:#777;font-size:.89em;margin-bottom:32px}
blockquote{margin:0 0 32px;padding:0 0 0 18px;border-left:2px solid #999;font-style:italic;color:#444}
blockquote cite{display:block;margin-top:6px;font-style:normal;font-size:.83em;color:#777;letter-spacing:.05em}
.devotional-body blockquote{margin:1em 0}
p{margin:0 0 1em;text-indent:1.5em;text-align:justify;hyphens:auto}
p:first-of-type{text-indent:0}
.devotional-body>p:first-of-type::first-letter{float:left;font-size:3.1em;line-height:.82;padding:.08em .08em 0 0}
h3{font-size:.72em;font-weight:normal;text-transform:uppercase;letter-spacing:.25em;color:#777;text-align:center;margin:44px 0 16px}
details.further-reading{margin-top:40px;border-top:1px solid #d5d5d0;border-bottom:1px solid #d5d5d0}
details.further-reading>summary{position:relative;display:block;padding:10px 0 10px 95px;color:#555;font-size:.95em;font-weight:normal;text-align:left;cursor:pointer;list-style:none;transition:color .18s ease}
details.further-reading>summary::-webkit-details-marker{display:none}
details.further-reading>summary::before{content:"";position:absolute;left:20px;top:50%;width:9px;height:9px;border-right:1.5px solid #888;border-bottom:1.5px solid #888;transform:translateY(-50%) rotate(-45deg);transition:transform .18s ease}
details.further-reading[open]>summary{border-bottom:1px solid #d5d5d0}
details.further-reading[open]>summary::before{transform:translateY(-50%) rotate(45deg)}
details.further-reading>summary:hover{color:#222}
details.further-reading>summary:focus-visible{outline:2px solid currentColor;outline-offset:3px}
.further-reading-content{margin:0;padding:16px 2px 4px}
.reading-text h3{font-size:1.12em;font-weight:normal;text-transform:none;letter-spacing:normal;color:inherit;text-align:left;line-height:1.3;margin:1.25em 0 .5em}
.reading-text h3.psalm-book{font-size:.8em;text-transform:uppercase;letter-spacing:.14em;margin-bottom:.3em}
.reading-text h4{font-size:.92em;font-weight:normal;font-style:italic;margin:0 0 .8em}
.reading-text p.scripture-line{margin:0;text-indent:0;text-align:left}
.reading-text p.scripture-line>sup{margin-right:.35em}
.reading-text p.scripture-line.indent1{padding-left:1.5em;text-indent:-1.5em}
.reading-text p.scripture-line.indent2{padding-left:3em;text-indent:-1.5em}
.reading-text p.scripture-stanza{height:1em;line-height:0;margin:0;text-indent:0}
ol{padding-left:1.4em}
li{margin-bottom:10px}
footer{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px 16px;font-size:12px;text-align:center;color:#999;padding-top:32px}
footer .footer-source,footer .footer-meta{white-space:nowrap}
footer .footer-meta{color:#777;letter-spacing:.04em}
.err{color:#777;text-align:center;text-indent:0}
body.high-contrast{background:#fff;color:#000}
body.high-contrast h1.site,body.high-contrast .date,body.high-contrast blockquote,body.high-contrast blockquote cite,body.high-contrast h3,body.high-contrast footer,body.high-contrast nav,body.high-contrast .err{color:#000}
body.high-contrast a{color:#000;border-color:#000}
body.high-contrast a:hover{border-color:#000}
body.high-contrast blockquote{border-color:#000}
body.high-contrast details.further-reading{border-color:#000}
body.high-contrast details.further-reading>summary{color:#000;border-color:#000;background:transparent}
body.high-contrast details.further-reading>summary::before{border-color:currentColor}
body.high-contrast details.further-reading[open]>summary,body.high-contrast .further-reading-content{border-color:#000}
body.high-contrast details.further-reading>summary:hover{color:#000}
body.high-contrast .appearance-option,body.high-contrast .size-option{color:#000;border-color:#000}
body.high-contrast.black{background:#000;color:#fff}
body.high-contrast.black h1.site,body.high-contrast.black .date,body.high-contrast.black blockquote,body.high-contrast.black blockquote cite,body.high-contrast.black h3,body.high-contrast.black footer,body.high-contrast.black nav,body.high-contrast.black .err{color:#fff}
body.high-contrast.black a{color:#fff;border-color:#fff}
body.high-contrast.black a:hover{border-color:#fff}
body.high-contrast.black blockquote{border-color:#fff}
body.high-contrast.black details.further-reading{border-color:#fff}
body.high-contrast.black details.further-reading>summary{color:#fff;border-color:#fff;background:transparent}
body.high-contrast.black details.further-reading>summary::before{border-color:currentColor}
body.high-contrast.black details.further-reading[open]>summary,body.high-contrast.black .further-reading-content{border-color:#fff}
body.high-contrast.black details.further-reading>summary:hover{color:#fff}
body.high-contrast.black .appearance-option,body.high-contrast.black .size-option{color:#fff;border-color:#fff}
`;

function mainHtml(d, data, err) {
  const pretty = d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  if (err) return `<p class="err">Sorry, couldn't fetch the devotional: ${esc(err)}</p>`;
  else {
    const readingTitle = data.furtherReading.map((reading) => esc(reading.title)).join(" · ");
    return `<h2 class="devotional-title">${esc(data.title)}</h2><div class="date">${esc(pretty)}</div>
<blockquote>${esc(data.verse)}<cite>&mdash; ${esc(data.ref)}</cite></blockquote>
<div class="devotional-body">${data.body}</div>
${data.questions.length ? `<h3>Questions for Thought</h3><ol>${data.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>` : ""}
${data.furtherReading.length ? `<details class="further-reading"><summary>${readingTitle}</summary><div class="further-reading-content">${data.furtherReading.map((reading) => `<div class="reading-text">${reading.text}</div>`).join("\n")}</div></details>` : ""}`;
  }
}

function page(d, main) {
  const prev = new Date(d); prev.setDate(d.getDate() - 1);
  const next = new Date(d); next.setDate(d.getDate() + 1);
  const nextLink = toIso(d) < toIso(new Date())
    ? `<a href="/?date=${toIso(next)}">Next &raquo;</a>`
    : `<span class="disabled" aria-disabled="true">Next &raquo;</span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="apple-touch-icon" href="/icon2.png"><link rel="icon" href="/icon2.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Devo">
<meta name="theme-color" content="#f4f4f2">
<title>Daily Devotional</title><style>${CSS}</style></head><body><div id="wrap">
<h1 class="site">Alistair Begg Daily Devotional</h1>
<nav><span class="prev"><a href="/?date=${toIso(prev)}">&laquo; Previous</a><span aria-hidden="true"> | </span></span><a href="/">Today</a><span class="next"><span aria-hidden="true"> | </span>${nextLink}</span></nav>
<div class="toolbar">
<div class="group" role="group" aria-label="Appearance">
<button class="appearance-option" type="button" data-mode="soft" aria-label="Paper">Paper</button><span aria-hidden="true">·</span>
<button class="appearance-option" type="button" data-mode="white" aria-label="High contrast white">White</button><span aria-hidden="true">·</span>
<button class="appearance-option" type="button" data-mode="black" aria-label="High contrast black">Black</button>
</div>
<div class="group" role="group" aria-label="Text size">
<button class="size-option" type="button" data-size="0" aria-label="Reset text size" title="Reset text size" style="font-size:16px">&#8634;</button><button class="size-option" type="button" data-size="-1" aria-label="Smaller text" style="font-size:12px">A</button><button class="size-option" type="button" data-size="1" aria-label="Larger text" style="font-size:19px">A</button>
</div>
</div>
<div id="content">${main}</div>
<footer><span class="footer-source">Content &copy; Truth For Life &middot; <a href="${SRC}?tab=alistair_begg_devotional">original</a></span><span class="footer-meta">ste &middot; ${new Date().getFullYear()} &middot; v1.67</span></footer>
</div><script>
(() => {
  const content = document.getElementById("content");
  const original = content.innerHTML;
  document.querySelectorAll("nav a").forEach((link) => link.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    content.innerHTML = '<div class="loader" role="status" aria-label="Loading"></div>';
    requestAnimationFrame(() => requestAnimationFrame(() => { location.href = link.href; }));
  }));
  addEventListener("pageshow", (e) => { if (e.persisted) content.innerHTML = original; });
  ["gesturestart", "gesturechange", "gestureend"].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));
  const options = [...document.querySelectorAll(".appearance-option")];
  const modes = ["soft", "white", "black"];
  let mode = "soft";
  const apply = () => {
    document.body.classList.toggle("high-contrast", mode !== "soft");
    document.body.classList.toggle("black", mode === "black");
    document.querySelector('meta[name="theme-color"]').content = mode === "black" ? "#000000" : mode === "white" ? "#ffffff" : "#f4f4f2";
    options.forEach((option) => {
      const selected = option.dataset.mode === mode;
      option.setAttribute("aria-pressed", String(selected));
    });
  };
  const scales = [12, 13, 14, 16, 18, 20, 24];
  const defaultSize = 3;
  const sizeButtons = [...document.querySelectorAll(".size-option")];
  let size = defaultSize;
  const applySize = () => {
    document.getElementById("content").style.setProperty("--fs", scales[size] + "px");
    sizeButtons.forEach((b) => { const delta = +b.dataset.size;
      b.disabled = delta === 0 ? size === defaultSize : size + delta < 0 || size + delta >= scales.length; });
  };
  try {
    const savedSize = parseInt(localStorage.getItem("devo-text-size-v4"), 10);
    if (savedSize >= 0 && savedSize < scales.length) size = savedSize;
  } catch (error) { console.warn("Could not read saved text size:", error); }
  applySize();
  sizeButtons.forEach((b) => b.addEventListener("click", () => {
    const delta = +b.dataset.size;
    size = delta === 0 ? defaultSize : Math.min(scales.length - 1, Math.max(0, size + delta));
    try { localStorage.setItem("devo-text-size-v4", size); }
    catch (error) { console.warn("Could not save text size:", error); }
    applySize();
  }));
  try {
    const saved = localStorage.getItem("devo-display-mode");
    if (modes.includes(saved)) mode = saved;
    else localStorage.removeItem("devo-display-mode");
  } catch (error) { console.warn("Could not read saved display preference:", error); }
  apply();
  options.forEach((option) => option.addEventListener("click", () => {
    mode = option.dataset.mode;
    try { localStorage.setItem("devo-display-mode", mode); }
    catch (error) { console.warn("Could not save display preference:", error); }
    apply();
  }));
})();
</script></body></html>`;
}

if (require.main === module) http
  .createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/api/tetris/leaderboard") {
      try {
        await leaderboardReady;
        if (req.method === "GET") return sendJson(res, 200, { entries: getLeaderboardEntries() });
        if (req.method !== "POST") {
          res.setHeader("Allow", "GET, POST");
          return sendJson(res, 405, { error: "Method not allowed" });
        }

        const body = await readJsonBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return sendJson(res, 400, { error: "Request body must be a JSON object" });
        }
        const name = typeof body.name === "string"
          ? Array.from(body.name.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").trim()).slice(0, 16).join("")
          : "";
        if (!name) {
          return sendJson(res, 400, { error: "Please enter a name for the leaderboard (up to 16 characters)." });
        }
        if (!Number.isSafeInteger(body.score) || body.score <= 0 || body.score > 1_000_000_000
          || !Number.isSafeInteger(body.lines) || body.lines < 0 || body.lines > 100_000
          || !Number.isSafeInteger(body.level) || body.level < 1 || body.level > 10_001) {
          return sendJson(res, 400, { error: "The score, line count, or level is invalid. Please start a new game and try again." });
        }

        const entry = { name, score: body.score, lines: body.lines, level: body.level, date: new Date().toISOString() };
        const entries = await saveLeaderboardEntry(entry);
        return sendJson(res, 201, { entry, entries });
      } catch (error) {
        const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
        if (status >= 500) console.error("Tetris leaderboard request failed:", error);
        return sendJson(res, status, { error: status >= 500 ? "Leaderboard is temporarily unavailable" : error.message });
      }
    }

    if (u.pathname === "/icon2.png" || u.pathname === "/apple-touch-icon2.png") {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
      return res.end(ICON);
    }
    if (u.pathname !== "/") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const d = parseIso(u.searchParams.get("date")) || new Date();
    const marker = "<!--main-->";
    const [head, tail] = page(d, marker).split(marker);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "X-Accel-Buffering": "no" });
    res.write(head + '<div class="loader" id="loader" role="status" aria-label="Loading"></div>');
    let main, title = "";
    try {
      const data = await getDevo(fmt(d));
      main = mainHtml(d, data);
      title = data.title + " - ";
    } catch (e) {
      main = mainHtml(d, null, e.message);
    }
    res.end(`<style>#loader{display:none}</style>${main}<script>document.title=${JSON.stringify(title + "Daily Devotional").replace(/</g, "\\u003c")}</script>${tail}`);
  })
  .listen(PORT, "127.0.0.1", () => console.log("http://localhost:" + PORT));

module.exports = { parse, mainHtml };
