// OffChat · tests/check.mjs — automated quality gate (no dependencies).
// Run:  node tests/check.mjs
// Checks: JS syntax · model catalog integrity · no Polish text ·
//         HTML/JS id wiring · module evaluation smoke test.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const JS_FILES = fs.readdirSync(path.join(root, "js"))
  .filter((f) => f.endsWith(".js")).map((f) => `js/${f}`).concat(["sw.js"]);
const SCAN_EXTS = [".js", ".html", ".css", ".webmanifest", ".md"];

let failures = 0;
const ok = (name) => console.log(`  ✅ ${name}`);
const fail = (name, detail) => {
  failures++;
  console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`);
};

// ── 1. Syntax ────────────────────────────────────────────────
console.log("1/5 syntax (node --check)");
try {
  for (const f of JS_FILES) {
    execFileSync(process.execPath, ["--check", f], { cwd: root, stdio: "pipe" });
  }
  ok(`${JS_FILES.length} files parse`);
} catch (e) {
  fail("syntax", String(e.stderr || e.message).split("\n").slice(0, 3).join(" | "));
}

// ── 2. Catalog integrity ─────────────────────────────────────
console.log("2/5 model catalog");
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
console.log("3/5 Polish-text sweep");
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
console.log("4/5 element-id wiring");
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
console.log("5/5 module evaluation");
try {
  const store = {};
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
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
  for (const m of ["config", "hardware", "storage", "markdown", "ui", "engine", "engine-proxy", "download-hub", "app"]) {
    await import(`../js/${m}.js`);
  }
  ok("all app modules evaluate without errors");
} catch (e) {
  fail("module eval", e.stack?.split("\n").slice(0, 2).join(" | ") || e.message);
}

console.log(failures ? `\n❌ ${failures} check(s) failed` : "\n🎉 all checks passed");
process.exit(failures ? 1 : 0);
