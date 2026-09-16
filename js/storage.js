// ─────────────────────────────────────────────────────────────
// OffChat · storage.js — client-side persistence.
// Settings → localStorage (fast read at startup).
// Threads and messages → IndexedDB (roomy, async).
// Model weights → Cache API (managed by the WebLLM / Transformers.js engines).
// ─────────────────────────────────────────────────────────────
import { DEFAULT_SETTINGS, LIMITS } from "./config.js";

const SETTINGS_KEY = "offchat.settings.v1";

// ── Settings ────────────────────────────────────────────────
/** Migrate settings stored by older (pre-1.1) versions. */
function migrateSettings(stored) {
  const out = { ...stored };
  // v1.0 stored a Polish system prompt — replace it with the new default.
  if (typeof out.systemPrompt === "string" &&
      (/polish|polski|polszczyzn/i.test(out.systemPrompt) || out.systemPrompt.length < 10)) {
    out.systemPrompt = DEFAULT_SETTINGS.systemPrompt;
  }
  // v1.0 memorySaver boolean → ctxCap select.
  if (out.ctxCap == null) {
    out.ctxCap = stored.memorySaver === false ? "full" : "auto";
  }
  delete out.memorySaver;
  delete out.dataSaver;
  // Clamp numeric settings into sane ranges (never trust stored data).
  if (typeof out.fontSize !== "number" || out.fontSize < 13 || out.fontSize > 18) {
    out.fontSize = DEFAULT_SETTINGS.fontSize;
  }
  if (typeof out.temperature !== "number" || out.temperature < 0 || out.temperature > 1.5) {
    out.temperature = DEFAULT_SETTINGS.temperature;
  }
  if (typeof out.topP !== "number" || out.topP < 0.1 || out.topP > 1) {
    out.topP = DEFAULT_SETTINGS.topP;
  }
  if (typeof out.maxTokens !== "number" || out.maxTokens < 64 || out.maxTokens > 2048) {
    out.maxTokens = DEFAULT_SETTINGS.maxTokens;
  }
  // Validate enum-like settings.
  for (const [key, allowed] of [
    ["theme", ["auto", "light", "dark"]],
    ["accent", ["violet", "ocean", "rose", "mint", "amber"]],
    ["bgStyle", ["aurora", "tide", "solid"]],
    ["safeMode", ["auto", "on", "off"]],
    ["bubbleStyle", ["soft", "round", "sharp"]],
    ["ctxCap", ["auto", "1024", "2048", "4096", "full"]],
    ["cacheBackend", ["cache", "opfs"]],
  ]) {
    if (!allowed.includes(out[key])) out[key] = DEFAULT_SETTINGS[key];
  }
  for (const key of ["glass", "avatars", "animations", "sendOnEnter", "onboarded"]) {
    out[key] = out[key] !== false;
  }
  if (!out.downloaded || typeof out.downloaded !== "object") out.downloaded = {};
  return out;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...migrateSettings(parsed) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patchOrFull) {
  const next = { ...loadSettings(), ...patchOrFull };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Storage full — retry without the download history.
    try {
      const slim = { ...next, downloaded: {} };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(slim));
      next.downloaded = {};
    } catch { /* last resort: ignore */ }
  }
  return next;
}

// ── IndexedDB ─────────────────────────────────────────────────
const DB_NAME = "offchat-db";
const DB_VER = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("NO_IDB"));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VER);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("threads")) {
        db.createObjectStore("threads", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("messages")) {
        const ms = db.createObjectStore("messages", { keyPath: "id" });
        ms.createIndex("by-thread", "threadId", { unique: false });
        ms.createIndex("by-ts", "ts", { unique: false });
      }
      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv", { keyPath: "k" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null; // allow a retry instead of caching the failure
      reject(req.error);
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error("IDB_BLOCKED"));
    };
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        let t;
        try {
          t = db.transaction(store, mode);
        } catch (e) {
          reject(e);
          return;
        }
        const st = t.objectStore(store);
        let out;
        try {
          out = fn(st);
        } catch (e) {
          try { t.abort(); } catch { /* ignore */ }
          reject(e);
          return;
        }
        t.oncomplete = () => resolve(out?.result !== undefined ? out.result : out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error("IDB_ABORT"));
      })
  );
}

const uid = (p = "") =>
  p + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);

// In-memory fallback when IDB is unavailable (private mode etc.)
const memFallback = { threads: new Map(), messages: [] };
let useMemFallback = false;
async function guard(fn, fallback) {
  if (useMemFallback) return fallback();
  try {
    return await fn();
  } catch (e) {
    if (String(e?.message || e).includes("NO_IDB") || e?.name === "InvalidStateError") {
      useMemFallback = true;
      return fallback();
    }
    throw e;
  }
}

// ── Threads ───────────────────────────────────────────────────
export const Threads = {
  async list() {
    return guard(
      async () => {
        const all = await tx("threads", "readonly", (st) => st.getAll());
        return (all || []).sort((a, b) => b.updatedAt - a.updatedAt);
      },
      async () =>
        [...memFallback.threads.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    );
  },

  async create({ title, modelKey, modelId, engine }) {
    const thread = {
      id: uid("t-"),
      title: title || "New chat",
      modelKey, modelId, engine,
      createdAt: Date.now(), updatedAt: Date.now(),
      pinned: false,
    };
    await guard(
      () => tx("threads", "readwrite", (st) => st.add(thread)),
      async () => { memFallback.threads.set(thread.id, thread); }
    );
    pruneThreads().catch(() => {});
    return thread;
  },

  async get(id) {
    return guard(
      () => tx("threads", "readonly", (st) => st.get(id)),
      async () => memFallback.threads.get(id) || null
    );
  },

  async update(id, patch) {
    return guard(
      async () => {
        const cur = await tx("threads", "readonly", (st) => st.get(id));
        if (!cur) return null;
        const next = { ...cur, ...patch, updatedAt: Date.now() };
        await tx("threads", "readwrite", (st) => st.put(next));
        return next;
      },
      async () => {
        const cur = memFallback.threads.get(id);
        if (!cur) return null;
        const next = { ...cur, ...patch, updatedAt: Date.now() };
        memFallback.threads.set(id, next);
        return next;
      }
    );
  },

  async remove(id) {
    await Messages.clearThread(id);
    return guard(
      () => tx("threads", "readwrite", (st) => st.delete(id)),
      async () => { memFallback.threads.delete(id); }
    );
  },

  async clearAll() {
    return guard(
      async () => {
        await tx("threads", "readwrite", (st) => st.clear());
        await tx("messages", "readwrite", (st) => st.clear());
      },
      async () => {
        memFallback.threads.clear();
        memFallback.messages = [];
      }
    );
  },
};

async function pruneThreads() {
  const list = await Threads.list(); // newest first
  if (list.length <= LIMITS.maxThreads) return;
  // Delete the OLDEST unpinned chats (the tail of the unpinned list).
  const unpinned = list.filter((t) => !t.pinned);
  const excess = Math.min(unpinned.length, list.length - LIMITS.maxThreads);
  const victims = unpinned.slice(unpinned.length - excess);
  for (const t of victims) {
    try { await Threads.remove(t.id); } catch { /* ignore */ }
  }
}

// ── Messages ──────────────────────────────────────────────────
export const Messages = {
  async list(threadId, limit = 500) {
    return guard(
      async () => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
          const out = [];
          let t;
          try {
            t = db.transaction("messages", "readonly");
          } catch (e) {
            reject(e);
            return;
          }
          const idx = t.objectStore("messages").index("by-thread");
          const range = IDBKeyRange.only(threadId);
          const req = idx.openCursor(range, "prev"); // newest first
          req.onsuccess = () => {
            const cur = req.result;
            if (cur && out.length < limit) {
              out.push(cur.value);
              cur.continue();
            } else {
              out.reverse();
              resolve(out);
            }
          };
          req.onerror = () => reject(req.error);
        });
      },
      async () =>
        memFallback.messages
          .filter((m) => m.threadId === threadId)
          .sort((a, b) => a.ts - b.ts)
          .slice(-limit)
    );
  },

  async add(threadId, { role, content, stats }) {
    const msg = {
      id: uid("m-"), threadId, role, content: content || "",
      stats: stats || null, ts: Date.now(),
    };
    await guard(
      () => tx("messages", "readwrite", (st) => st.add(msg)),
      async () => { memFallback.messages.push(msg); }
    );
    Threads.update(threadId, {}).catch(() => {});
    pruneMessages(threadId).catch(() => {});
    return msg;
  },

  async removeLastAssistant(threadId) {
    const list = await Messages.list(threadId, 5);
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === "assistant") {
        const id = list[i].id;
        await guard(
          () => tx("messages", "readwrite", (st) => st.delete(id)),
          async () => {
            memFallback.messages = memFallback.messages.filter((m) => m.id !== id);
          }
        );
        return true;
      }
      if (list[i].role === "user") break;
    }
    return false;
  },

  async clearThread(threadId) {
    return guard(
      async () => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
          let t;
          try {
            t = db.transaction("messages", "readwrite");
          } catch (e) {
            reject(e);
            return;
          }
          const idx = t.objectStore("messages").index("by-thread");
          const req = idx.openCursor(IDBKeyRange.only(threadId));
          req.onsuccess = () => {
            const cur = req.result;
            if (cur) { cur.delete(); cur.continue(); }
            else resolve(true);
          };
          req.onerror = () => reject(req.error);
        });
      },
      async () => {
        memFallback.messages = memFallback.messages.filter(
          (m) => m.threadId !== threadId
        );
      }
    );
  },
};

async function pruneMessages(threadId) {
  const list = await Messages.list(threadId, LIMITS.maxMessagesPerThread + 50);
  if (list.length <= LIMITS.maxMessagesPerThread) return;
  const victims = list.slice(0, list.length - LIMITS.maxMessagesPerThread);
  for (const m of victims) {
    try {
      await guard(
        () => tx("messages", "readwrite", (st) => st.delete(m.id)),
        async () => {
          memFallback.messages = memFallback.messages.filter((x) => x.id !== m.id);
        }
      );
    } catch { /* ignore */ }
  }
}

// ── Export / import ───────────────────────────────────────────
export async function exportAll(settings) {
  const threads = await Threads.list();
  const bundle = { app: "OffChat", version: 1, exportedAt: Date.now(), threads: [] };
  for (const t of threads) {
    const messages = await Messages.list(t.id, 1000);
    bundle.threads.push({ ...t, messages });
  }
  bundle.settings = {
    theme: settings.theme, temperature: settings.temperature,
    topP: settings.topP, maxTokens: settings.maxTokens,
  };
  return bundle;
}

export async function importAll(bundle) {
  if (!bundle || !Array.isArray(bundle.threads)) throw new Error("BAD_FILE");
  let n = 0;
  for (const t of bundle.threads.slice(0, LIMITS.maxThreads)) {
    const thread = await Threads.create({
      title: String(t.title || "Imported chat").slice(0, 120),
      modelKey: t.modelKey || null, modelId: t.modelId || null, engine: t.engine || null,
    });
    const msgs = Array.isArray(t.messages) ? t.messages.slice(-LIMITS.maxMessagesPerThread) : [];
    for (const m of msgs) {
      if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") continue;
      await Messages.add(thread.id, {
        role: m.role, content: String(m.content || "").slice(0, 20000),
        stats: m.stats || null,
      });
    }
    n++;
  }
  return n;
}

// ── Model cache (inspect / clear) ─────────────────────────────
const MODEL_CACHE_RE = /webllm|mlc|transformers|onnx|hf-/i;

export async function listCaches() {
  if (!("caches" in window)) return [];
  try {
    const names = await caches.keys();
    return names.map((name) => ({
      name,
      isModelCache: MODEL_CACHE_RE.test(name),
      isAppCache: /offchat/i.test(name),
    }));
  } catch {
    return [];
  }
}

export async function clearModelCaches() {
  if (!("caches" in window)) return 0;
  const names = await caches.keys();
  let n = 0;
  for (const name of names) {
    if (MODEL_CACHE_RE.test(name)) {
      try { await caches.delete(name); n++; } catch { /* ignore */ }
    }
  }
  return n;
}

export async function storageInfo() {
  let quotaMB = 0, usageMB = 0;
  try {
    const est = await navigator.storage?.estimate?.();
    quotaMB = Math.round((est?.quota || 0) / 1048576);
    usageMB = Math.round((est?.usage || 0) / 1048576);
  } catch { /* ignore */ }
  const cachesList = await listCaches();
  return { quotaMB, usageMB, caches: cachesList };
}
