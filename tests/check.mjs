// OffChat · tests/check.mjs — automated quality gate (no dependencies).
// Run:  node tests/check.mjs
// Checks: JS syntax · model catalog integrity · no Polish text ·
//         HTML/JS id wiring · module evaluation smoke test ·
//         streaming-renderer equivalence · crash-guard helpers ·
//         service-worker shell completeness.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const JS_FILES = fs.readdirSync(path.join(root, "js"))
  .filter((f) => f.endsWith(".js")).map((f) => `js/${f}`).concat(["sw.js"]);
const SCAN_EXTS = [".js", ".html", ".css", ".webmanifest", ".md"];

let failures = 0;
const memStore = {}; // shared localStorage mock (defined once in section 5)

/**
 * Tiny DOM stand-in for the streaming renderer test: elements hold their
 * innerHTML as a string, children are appended to it. Enough to verify
 * what the renderer puts on screen without a browser.
 */
function makeMiniDom() {
  class El {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this._html = "";
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.style = {};
      this.dataset = {};
      if (tag === "template") this.content = new El("#fragment");
    }
    set innerHTML(v) { this._html = String(v); this.children = []; }
    get innerHTML() {
      return this._html + this.children.map((c) => c.innerHTML || "").join("");
    }
    append(...nodes) { for (const n of nodes) this.appendChild(n); }
    appendChild(n) { this.children.push(n); return n; }
    remove() { this.removed = true; }
    get isConnected() { return !this.removed; }
    querySelector() { return null; }
    setAttribute() {}
    getAttribute() { return null; }
    addEventListener() {}
  }
  const document = {
    createElement: (tag) => new El(tag),
    body: new El("body"),
  };
  Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: document });
  return { document, El };
}
const ok = (name) => console.log(`  ✅ ${name}`);
const fail = (name, detail) => {
  failures++;
  console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`);
};

// ── 1. Syntax ────────────────────────────────────────────────
console.log("1/8 syntax (node --check)");
try {
  for (const f of JS_FILES) {
    execFileSync(process.execPath, ["--check", f], { cwd: root, stdio: "pipe" });
  }
  ok(`${JS_FILES.length} files parse`);
} catch (e) {
  fail("syntax", String(e.stderr || e.message).split("\n").slice(0, 3).join(" | "));
}

// ── 2. Catalog integrity ─────────────────────────────────────
console.log("2/8 model catalog");
try {
  const c = await import("../js/config.js");
  const errs = [];
  const keys = new Set();
  for (const m of c.ALL_MODELS) {
    if (keys.has(m.key)) errs.push("dup key " + m.key);
    keys.add(m.key);
    for (const f of ["key", "engine", "modelId", "name", "family", "params", "sizeMB", "vramMB", "ctx", "quality", "tier", "tps", "estDl", "blurb"]) {
      if (m[f] == null) errs.push(`${m.key} missing ${f}`);
    }
    if (!Array.isArray(m.tps) || m.tps.length !== 2 || !(m.tps[0] < m.tps[1])) errs.push(`${m.key} bad tps`);
    if (!c.formatTps(m)) errs.push(`${m.key} bad formatTps`);
    if (!c.TIERS[m.tier]) errs.push(`${m.key} bad tier`);
    if (m.engine === "webllm" && !/-MLC(-1k)?$/.test(m.modelId)) errs.push(`${m.key} bad modelId`);
  }
  if (/polish|polski/i.test(c.DEFAULT_SETTINGS.systemPrompt)) errs.push("system prompt mentions Polish");
  if ("SUGGESTED_PROMPTS" in c) errs.push("SUGGESTED_PROMPTS still exported");
  if (errs.length) fail("catalog", errs.slice(0, 5).join("; "));
  else ok(`${c.MODEL_CATALOG.length} WebLLM + ${c.WASM_CATALOG.length} WASM models valid`);
} catch (e) {
  fail("catalog", e.message);
}

// ── 3. No Polish text ────────────────────────────────────────
console.log("3/8 Polish-text sweep");
{
  const diacritics = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
  // Distinctive ASCII-only Polish words (backstop for lone words like "ignoruj").
  const asciiWords = new RegExp(
    "\\b(ignoruj\\w*|spadnij|pobieran\\w*|odpowiedz\\w*|ustawien\\w*|kompilac\\w*|" +
    "nieudan\\w*|ponawiam\\w*|przelacz\\w*|rozmow\\w*|watek|watku|watkow|" +
    "wiadom\\w*|powiadom\\w*|przycisk\\w*|zapisz\\w*|zapisuj\\w*|wybierz\\w*|wybor\\w*|" +
    "zamknij|zamkniec\\w*|otworz|otwieran\\w*|rozpoczn\\w*|ladowan\\w*|" +
    "bibliotek\\w*|silnik\\w*|funkcj\\w*|komend\\w*|przyklad\\w*|rozmiar\\w*|" +
    "telefonu|telefonie|telefonem|slaby|slabych|slabe|urzadzen\\w*|pamiec\\b|" +
    "dokladn\\w*|miedzy|pozniej\\w*|wczoraj|jutro|dzisiaj|godzin\\w*|sekund\\w*|" +
    "usun\\b|usuwan\\w*|usuni\\w*|dodaj|dodawanie|edytuj|edycj\\w*|anuluj|" +
    "potwierdz\\w*|sukces|powodzenie|oraz|jest\\b|jestes|jednak|bardzo|" +
    "zawsze|nigdy|teraz|tutaj|wtedy|kiedy|kto\\b|ktory\\w*|ktore\\w*|ktora\\w*|" +
    "poniewaz|dziek\\w*|przepraszam|pomocy\\b|uwag\\w*|czat\\w*|" +
    "nowa\\b|nowy\\b|nowe\\b|nowych\\b|wszystk\\w*|ostatni\\w*|pierwsz\\w*|" +
    "nastepn\\w*|poprzedni\\w*|twoj\\w*|nasz\\w*|siebie|blad\\b|bledy|bledow)\\b",
    "i"
  );
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === ".git" || name === "node_modules") continue;
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (!SCAN_EXTS.includes(path.extname(name))) continue;
      if (p === fileURLToPath(import.meta.url)) continue; // this file holds the wordlist
      const text = fs.readFileSync(p, "utf8");
      text.split("\n").forEach((line, i) => {
        if (diacritics.test(line) || asciiWords.test(line)) {
          hits.push(`${path.relative(root, p)}:${i + 1}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
  };
  walk(root);
  if (hits.length) fail("polish sweep", `${hits.length} hit(s): ${hits.slice(0, 4).join(" | ")}`);
  else ok("no Polish text anywhere");
}

// ── 4. ID wiring (HTML ↔ JS) ────────────────────────────────
console.log("4/8 element-id wiring");
{
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const js = JS_FILES.filter((f) => f.startsWith("js/"))
    .map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
  const defined = new Set([
    ...html.matchAll(/id="([\w-]+)"/g),
    ...js.matchAll(/id=\\"([\w-]+)\\"|id="([\w-]+)"/g),
  ].map((m) => m[1] || m[2]));
  const referenced = new Set(
    [...js.matchAll(/\$\("#([\w-]+)"\)/g), ...js.matchAll(/getElementById\("([\w-]+)"\)/g)]
      .map((m) => m[1])
  );
  const missing = [...referenced].filter((id) => !defined.has(id));
  if (missing.length) fail("id wiring", "missing: " + missing.join(", "));
  else ok(`${referenced.size} JS-referenced ids all exist`);
}

// ── 5. Module evaluation smoke test ──────────────────────────
console.log("5/8 module evaluation");
try {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k) => memStore[k] ?? null,
      setItem: (k, v) => { memStore[k] = String(v); },
      removeItem: (k) => { delete memStore[k]; },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    value: {
      hardwareConcurrency: 4, deviceMemory: 4, gpu: undefined,
      userAgent: "check-mjs", onLine: true,
      storage: { estimate: async () => ({ usage: 0, quota: 0 }) },
    },
  });
  const mkEl = () => ({
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, remove() {},
    closest() { return null; }, focus() {}, click() {},
    hidden: false, innerHTML: "", textContent: "", value: "", disabled: false,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true, // section 6 swaps in a richer mini-DOM
    value: {
      addEventListener() {}, querySelector() { return null; },
      querySelectorAll() { return []; }, getElementById() { return null; },
      createElement() { return mkEl(); }, body: mkEl(), documentElement: mkEl(),
    },
  });
  globalThis.window = globalThis;
  globalThis.location = { protocol: "http:", href: "http://x/", search: "", pathname: "/" };
  globalThis.history = { replaceState() {} };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = () => 0;
  for (const m of ["config", "hardware", "storage", "markdown", "ui", "engine", "engine-proxy", "stream-render", "resilience", "download-hub", "app"]) {
    await import(`../js/${m}.js`);
  }
  ok("all app modules evaluate without errors");
} catch (e) {
  fail("module eval", e.stack?.split("\n").slice(0, 2).join(" | ") || e.message);
}

// ── 6. Streaming renderer equivalence ────────────────────────
// The incremental renderer must produce exactly the same HTML as the
// one-shot renderer (otherwise answers would look different while
// streaming than they do after a reload).
console.log("6/8 streaming renderer");
try {
  const { findStableCut } = await import("../js/stream-render.js");
  const { renderMarkdown } = await import("../js/markdown.js");
  const norm = (h) => h.replace(/>\n</g, "><");
  const samples = [
    "Hello **world**\n\nSecond paragraph here.",
    "# Title\n\nSome text.\n\n- a\n- b\n\nDone.",
    "Text before\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter code.",
    "| a | b |\n|---|---|\n| 1 | 2 |\n\nnext",
    "> quote\n> more\n\nafter",
    "One very long paragraph that keeps going and going without a blank line for a long time, which is exactly what happens when a model streams prose continuously for many tokens in a row.\n\nSecond block.",
    "- item 1\n- item 2\n\n1. one\n2. two\n\n---\n\nlast",
    "A paragraph.\n\n```python\nprint('hi')\n```\n\n### Heading\n\nMore text with `code` and a [link](https://x.dev).",
  ];
  const errs = [];
  for (const s of samples) {
    let from = 0;
    const frags = [];
    for (let guard = 0; guard < 200; guard++) {
      const cut = findStableCut(s, from);
      if (cut < from || cut > s.length) { errs.push(`bad cut ${cut} for ${JSON.stringify(s.slice(0, 20))}`); break; }
      if (cut === from) break;
      frags.push(renderMarkdown(s.slice(from, cut)));
      from = cut;
    }
    frags.push(renderMarkdown(s.slice(from)));
    if (norm(frags.join("")) !== norm(renderMarkdown(s))) {
      errs.push(`incremental != full for ${JSON.stringify(s.slice(0, 24))}`);
    }
    // cuts must never move backwards while the text grows
    let prev = 0;
    for (let i = 0; i <= s.length; i++) {
      const c = findStableCut(s.slice(0, i), prev);
      if (c < prev) { errs.push("non-monotonic cut"); break; }
      prev = c;
    }
  }
  if (errs.length) fail("stream renderer", errs.slice(0, 3).join("; "));

  // The real class, driven with a minimal DOM: it must (a) end up with
  // exactly the full render and (b) re-render only a fraction of the text
  // the naive "re-render everything on every token" approach would handle.
  const dom = makeMiniDom();
  const answer =
    "# OffChat\n\nA streamed answer with **bold** text and a list:\n\n" +
    "- first point about speed\n- second point about memory\n\n" +
    "```js\nconst cache = new Map();\n```\n\n" +
    "And a closing paragraph that keeps the tail busy for a while longer.\n\n" +
    "### Summary\n\nIncremental rendering keeps weak devices responsive.\n\n" +
    "| a | b |\n|---|---|\n| 1 | 2 |\n";
  const host = dom.document.createElement("div");
  const { StreamRenderer } = await import("../js/stream-render.js");
  const renderer = new StreamRenderer(host, { caret: true, placeholder: "<i></i>" });
  let tailWork = 0;
  let naiveWork = 0;
  Object.defineProperty(renderer.tailEl, "innerHTML", {
    set(v) { tailWork += String(v).length; },
    get() { return ""; },
  });
  for (let i = 1; i <= answer.length; i++) {
    renderer.setText(answer.slice(0, i));
    naiveWork += i;
    if (i % 40 === 0) await new Promise((r) => setTimeout(r, 10));
  }
  renderer.finish(answer);
  if (host.innerHTML !== renderMarkdown(answer)) errs.push("StreamRenderer.finish() != renderMarkdown()");
  if (renderer.stableLen < answer.length / 3) {
    errs.push(`finished blocks are not moving to the stable DOM part (stableLen=${renderer.stableLen}/${answer.length})`);
  }

  // Worst case: repaint after EVERY token (interval 0). Even then the
  // incremental renderer must re-render only a fraction of the text.
  const host2 = dom.document.createElement("div");
  const fast = new StreamRenderer(host2, { caret: true, interval: 0, maxInterval: 0 });
  let fastTail = 0;
  let fastNaive = 0;
  Object.defineProperty(fast.tailEl, "innerHTML", {
    set(v) { fastTail += String(v).length; },
    get() { return ""; },
  });
  for (let i = 1; i <= answer.length; i++) {
    fast.setText(answer.slice(0, i));
    fastNaive += i;
    if (i % 120 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  fast.finish(answer);
  if (host2.innerHTML !== renderMarkdown(answer)) errs.push("worst-case finish() != renderMarkdown()");
  // Per-token repainting still re-renders the current block, so ~40% of the
  // naive work is the honest worst case; the app repaints at 70-240 ms.
  if (fastTail > fastNaive * 0.6) {
    errs.push(`repaint too heavy: ${fastTail} chars vs naive ${fastNaive}`);
  }
  if (errs.length) fail("stream renderer", errs.slice(0, 3).join("; "));
  else ok(`${samples.length} answers identical · worst-case repaint is ${(100 * fastTail / fastNaive).toFixed(1)}% of naive`);
} catch (e) {
  fail("stream renderer", e.message);
}

// ── 7. Crash-guard helpers ───────────────────────────────────
console.log("7/8 crash guard");
try {
  for (const k of Object.keys(memStore)) delete memStore[k];
  const { Draft, BusyMark, closedPartialStats, isInterruptedMessage } =
    await import("../js/resilience.js");
  const errs = [];
  Draft.save("t-1", "half written question");
  if (Draft.read()?.text !== "half written question") errs.push("draft not restored");
  Draft.clear();
  if (Draft.read() !== null) errs.push("draft not cleared");
  BusyMark.set({ threadId: "t-1" });
  if (BusyMark.read()?.threadId !== "t-1") errs.push("busy mark lost");
  BusyMark.clear();
  if (BusyMark.read() !== null) errs.push("busy mark not cleared");
  if (BusyMark.read() !== null) errs.push("stale busy mark survived");
  const closed = closedPartialStats({ streaming: true, tokPerSec: 3 });
  if (closed.streaming || !closed.cutOff || !closed.interrupted) errs.push("partial stats wrong");
  if (!isInterruptedMessage({ streaming: true })) errs.push("streaming not detected");
  if (isInterruptedMessage({ cutOff: true })) errs.push("finished answer flagged");
  if (errs.length) fail("crash guard", errs.join("; "));
  else ok("draft + interrupted-answer recovery behave");
} catch (e) {
  fail("crash guard", e.message);
}

// ── 8. Service-worker shell completeness ─────────────────────
// Every shipped JS module must be precached, otherwise the offline
// experience breaks the first time one of them is added.
console.log("8/8 service-worker shell");
{
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const missing = JS_FILES.filter((f) => f.startsWith("js/"))
    .filter((f) => !sw.includes(`./${f}`));
  if (missing.length) fail("sw shell", "not precached: " + missing.join(", "));
  else ok("all js modules precached by sw.js");
}

console.log(failures ? `\n❌ ${failures} check(s) failed` : "\n🎉 all checks passed");
process.exit(failures ? 1 : 0);
