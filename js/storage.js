// ─────────────────────────────────────────────────────────────
// OffChat · storage.js — trwałość po stronie klienta.
// Ustawienia → localStorage (szybki odczyt przy starcie).
// Wątki i wiadomości → IndexedDB (pojemne, asynchroniczne).
// Wagi modeli → Cache API (zarządzane przez silniki WebLLM / Transformers.js).
// ─────────────────────────────────────────────────────────────
import { DEFAULT_SETTINGS, LIMITS } from "./config.js";

const SETTINGS_KEY = "offchat.settings.v1";

// ── Ustawienia ────────────────────────────────────────────────
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patchOrFull) {
  const next = { ...loadSettings(), ...patchOrFull };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // przepełniony storage — spróbuj bez historii pobrań
    try {
      const slim = { ...next, downloaded: {} };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(slim));
      next.downloaded = {};
    } catch { /* ostatnia deska: ignoruj */ }
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
    const req = indexedDB.open(DB_NAME, DB_VER);
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
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IDB_BLOCKED"));
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const st = t.objectStore(store);
        let out;
        try {
          out = fn(st);
        } catch (e) {
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

// Fallback pamięciowy, gdyby IDB było niedostępne (tryb prywatny itp.)
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

// ── Wątki ─────────────────────────────────────────────────────
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
      title: title || "Nowa rozmowa",
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
  const list = await Threads.list();
  if (list.length <= LIMITS.maxThreads) return;
  const victims = list
    .filter((t) => !t.pinned)
    .slice(LIMITS.maxThreads - list.filter((t) => t.pinned).length);
  for (const t of victims) {
    try { await Threads.remove(t.id); } catch { /* ignoruj */ }
  }
}

// ── Wiadomości ────────────────────────────────────────────────
export const Messages = {
  async list(threadId, limit = 500) {
    return guard(
      async () => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
          const out = [];
          const t = db.transaction("messages", "readonly");
          const idx = t.objectStore("messages").index("by-thread");
          const range = IDBKeyRange.only(threadId);
          const req = idx.openCursor(range, "prev"); // od najnowszych
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
          const t = db.transaction("messages", "readwrite");
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
    } catch { /* ignoruj */ }
  }
}

// ── Eksport / import ──────────────────────────────────────────
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
      title: String(t.title || "Zaimportowana rozmowa").slice(0, 120),
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

// ── Cache modeli (inspekcja / czyszczenie) ────────────────────
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
      try { await caches.delete(name); n++; } catch { /* ignoruj */ }
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
  } catch { /* ignoruj */ }
  const cachesList = await listCaches();
  return { quotaMB, usageMB, caches: cachesList };
}
