// ─────────────────────────────────────────────────────────────
// OffChat · app.js — app orchestration: boot, onboarding,
// chat, threads, settings, statuses, PWA.
// ─────────────────────────────────────────────────────────────
import {
  APP_VERSION, MODEL_CATALOG, WASM_CATALOG, getModel, formatTps,
  DEFAULT_SETTINGS, LIMITS, TIERS, ACCENTS, BG_STYLES, BUBBLE_STYLES,
  IDLE_UNLOAD_MS,
} from "./config.js";
import {
  probeHardware, recommendModels, suggestContextWindow, deviceSummary,
  isWeakDevice, perfTier,
} from "./hardware.js";
import {
  loadSettings, saveSettings, Threads, Messages,
  exportAll, importAll, storageInfo, clearModelCaches,
} from "./storage.js";
import { EngineProxy } from "./engine-proxy.js";
import { StreamRenderer } from "./stream-render.js";
import {
  Draft, BusyMark, IdleUnloader, isInterruptedMessage, closedPartialStats,
} from "./resilience.js";
import { renderMarkdown, estimateTokens } from "./markdown.js";
import {
  probeWasmModel, classifyError, potatoProfile, shouldSuggestPotato,
} from "./model-check.js";
import {
  $, $all, el, toast, openModal, confirmDialog,
  fmtBytes, fmtSizeMB, timeAgo, autoTitle, copyText, downloadFile, escapeHtml,
} from "./ui.js";

let downloadHub = null;
let downloadHubPromise = null;

const S = {
  settings: loadSettings(),
  hw: null,
  rec: null,
  threads: [],
  activeId: null,
  proxy: new EngineProxy({
    onCrash: () => toast("The AI engine restarted itself — the next message may take a few seconds longer. 🛠️", "warn", 5000),
    onRecovering: () => setStatus("load", "restoring the AI engine…"),
  }),
  engineLoaded: false,
  engineModelKey: null,
  model: null,
  generating: false,
  downloading: false,
  streamText: "",
  installEvt: null,
  nearBottom: true,
  threadFilter: "",
  queuedPrompt: null,
  // performance / resilience additions
  perf: "mid",           // "low" | "mid" | "high" — drives adaptive repainting
  safeActive: false,
  msgCache: new Map(),   // threadId -> messages (avoids repeated IndexedDB reads)
  idleWatcher: null,
  crashRecovery: null,   // a generation that a previous session died on
  hiddenAt: 0,
  lastIdleTouch: 0,
  slowHintShown: false,
};

/**
 * The download hub (telemetry, mini-game, facts, templates) is ~36 KB of
 * code that nobody needs before a download starts. It is imported on
 * demand (and prefetched while the app is idle) so a weak phone boots
 * without parsing it.
 */
function ensureDownloadHub() {
  downloadHubPromise ||= import("./download-hub.js")
    .then(({ DownloadHub }) => {
      downloadHub = new DownloadHub({
        onMinimize: () => {
          toast("Downloading in the background (widget at the bottom) — feel free to browse chats and settings! 🔍", "info", 4500);
        },
        onExpand: () => {},
        onAbort: () => {
          S.proxy.abort();
          S.downloading = false;
          // Dequeue the question: remove the "⏳" marker and put the text
          // back into the message box so it's easy to resend.
          if (S.queuedPrompt) {
            const { text, placeholderNode } = S.queuedPrompt;
            S.queuedPrompt = null;
            if (placeholderNode?.parentNode) placeholderNode.remove();
            const ta = $("#input");
            if (ta) {
              ta.value = text;
              lastGrowProbe = "";
              autogrow();
              $("#btn-send").classList.add("ready");
            }
          }
          setStatus("idle", "download cancelled");
          toast("Download cancelled — your question is back in the box, send it again", "warn", 5000);
        },
        onUsePrompt: (promptText) => {
          const ta = $("#input");
          if (ta) {
            ta.value = promptText;
            autogrow();
            ta.focus();
            toast("Prompt pasted into the chat! ✨", "ok");
          }
        },
        onQueuePrompt: (promptText) => {
          queuePrompt(promptText);
        },
      });
      downloadHub.setLowFx(!!S.safeActive);
      return downloadHub;
    })
    .catch(() => null);
  return downloadHubPromise;
}

/** Warm the hub module up while nothing else is happening. */
function prefetchDownloadHub() {
  whenIdle(() => { ensureDownloadHub(); }, 3000);
}

/** Run work when the browser is idle (with a hard fallback for old engines). */
function whenIdle(fn, timeout = 1000) {
  try {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => fn(), { timeout });
      return;
    }
  } catch { /* fall through */ }
  setTimeout(fn, 0);
}

// ── Message cache (weak devices: avoid re-reading IndexedDB constantly) ──
// Only a few threads are kept in memory — a chat with hundreds of long
// answers is megabytes, and a weak phone has none to spare.
const MAX_CACHED_THREADS = 4;

async function getMessages(threadId, { refresh = false } = {}) {
  if (!threadId) return [];
  if (!refresh && S.msgCache.has(threadId)) {
    const cached = S.msgCache.get(threadId);
    S.msgCache.delete(threadId); // re-insert = most recently used
    S.msgCache.set(threadId, cached);
    return cached;
  }
  const list = await Messages.list(threadId, 1000).catch(() => []);
  S.msgCache.set(threadId, list);
  while (S.msgCache.size > MAX_CACHED_THREADS) {
    const oldest = S.msgCache.keys().next().value;
    if (oldest === threadId) break;
    S.msgCache.delete(oldest);
  }
  return list;
}

function cacheAdd(threadId, msg) {
  const list = S.msgCache.get(threadId);
  if (!list) return;
  list.push(msg);
  if (list.length > 1200) list.splice(0, list.length - 1000);
}

function cachePatch(threadId, id, patch) {
  const m = S.msgCache.get(threadId)?.find((x) => x.id === id);
  if (m) Object.assign(m, patch);
}

const STATUS_META = {
  idle: "Idle",
  scan: "Detecting hardware…",
  download: "Downloading model",
  load: "Loading into memory…",
  ready: "Ready to chat",
  generating: "Generating…",
  error: "Error",
};

const ACCENT_THEME_COLORS = {
  violet: "#7c3aed",
  ocean: "#0284c7",
  rose: "#e11d48",
  mint: "#059669",
  amber: "#b45309",
};

// ── Theme / appearance ────────────────────────────────────────
function applyTheme() {
  const t = S.settings.theme || "auto";
  if (t === "auto") {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    document.body.dataset.theme = dark ? "dark" : "light";
  } else {
    document.body.dataset.theme = t;
  }
}

function applyAnims() {
  document.body.classList.toggle("no-anim", !S.settings.animations);
}

/** Resolve Safe Mode: explicit on/off wins, "auto" follows the hardware probe. */
function resolveSafeMode() {
  const pref = S.settings.safeMode || "auto";
  if (pref === "on") return true;
  if (pref === "off") return false;
  return S.hw ? isWeakDevice(S.hw) : false;
}

function applySafeMode() {
  S.safeActive = resolveSafeMode();
  document.body.classList.toggle("safe", S.safeActive);
  $("#safe-banner").hidden = !S.safeActive;
  downloadHub?.setLowFx(S.safeActive);
}

/** Apply every visual setting at once (theme, accent, bg, glass, font…). */
function applyAppearance() {
  const s = S.settings;
  applyTheme();
  applyAnims();
  applySafeMode();
  document.body.dataset.accent = ACCENTS[s.accent] ? s.accent : "violet";
  document.body.dataset.bg = BG_STYLES[s.bgStyle] ? s.bgStyle : "aurora";
  document.body.dataset.bubbles = BUBBLE_STYLES[s.bubbleStyle] ? s.bubbleStyle : "round";
  document.body.classList.toggle("no-glass", !s.glass);
  document.body.classList.toggle("no-avatars", !s.avatars);
  document.documentElement.style.setProperty("--chat-font", `${s.fontSize || 15}px`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = ACCENT_THEME_COLORS[document.body.dataset.accent] || "#7c3aed";
}

// ── Status ────────────────────────────────────────────────────
function setStatus(state, sub = "") {
  const pill = $("#status-pill");
  pill.dataset.state = state;
  $("#status-text").textContent = STATUS_META[state] || state;
  $("#status-sub").textContent = sub;
}

function updateModelChip() {
  const name = S.model ? S.model.name : "Pick a model";
  $("#model-chip-name").textContent = name;
  const cta = $("#model-cta");
  cta.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", S.model ? "#i-chat" : "#i-spark");
  svg.appendChild(use);
  cta.append(svg, document.createTextNode(S.model ? `Continue with ${S.model.name}` : "Pick a model & start"));
}

/** How many recent messages to render (fewer in Safe Mode for weak GPUs). */
function renderWindowSize() {
  return S.safeActive ? LIMITS.renderWindowSafe : LIMITS.renderWindow;
}

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  applyAppearance();
  try {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (S.settings.theme === "auto") applyTheme();
    };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
    else if (typeof mq.addListener === "function") mq.addListener(onChange);
  } catch { /* older browsers — ignore */ }

  bindUI();
  setStatus("idle", "preparing…");
  updateModelChip();
  updateOnlineUI();
  setupCrashGuard();
  setupIdleUnloader();

  // The shell is interactive from here on. IndexedDB reads, the GPU probe
  // and the Service Worker come next, while the browser is idle — a slow
  // phone shows a usable UI immediately instead of a blank frozen one.
  whenIdle(() => { initHeavy().catch(() => {}); }, 700);
}

async function initHeavy() {
  // Persistent storage keeps the model weights from being evicted.
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  await refreshThreads();
  const lastId = S.settings.lastThreadId;
  if (lastId && S.threads.some((t) => t.id === lastId)) {
    await openThread(lastId, { silent: true });
  }
  await handleInterruptedGeneration();

  // Hardware probe (never blocks the UI, but the model picker uses it).
  if (!S.model) setStatus("scan");
  try {
    const hw = await probeHardware();
    S.hw = hw;
    S.rec = recommendModels(hw, MODEL_CATALOG, WASM_CATALOG);
    S.perf = perfTier(hw);
    applySafeMode();
    S.idleWatcher?.refresh();
    if (S.safeActive && S.settings.safeMode === "auto") {
      toast("Safe Mode enabled for your device — visuals simplified to protect the GPU 🛡️", "info", 5000);
    }
    $("#hw-hint").textContent =
      `${deviceSummary(hw)} · budget ~${fmtBytes(S.rec.budgetMB)} · recommended: ${getModel(S.rec.recommended)?.name || "—"}`;
  } catch {
    $("#hw-hint").textContent = "Could not probe the hardware — please pick a model manually.";
  }

  restoreSavedModel();
  handleLaunchParams();
  registerSW();
  refreshStorageBar().catch(() => {});
  prefetchDownloadHub();
  if (!S.model) setStatus("idle", S.hw ? "pick a model" : "");
}

/**
 * Bring back the model the user picked last time. Auto-warming is skipped
 * on weak devices: loading hundreds of MB into a phone's memory during
 * startup is exactly how tabs get killed by the OS. There the model loads
 * on the first message instead (same speed, better timing).
 */
function restoreSavedModel() {
  const savedKey = S.settings.modelKey;
  const model = savedKey ? getModel(savedKey) : null;
  if (model) {
    S.model = model;
    updateModelChip();
    const cached = !!S.settings.downloaded[savedKey];
    if (!cached) {
      setStatus("idle", model.name);
      return;
    }
    if (S.perf === "low") {
      setStatus("idle", `${model.name} · loads on the first message`);
      return;
    }
    loadModel(savedKey, { auto: true }).catch(() => {});
    return;
  }
  if (!S.settings.onboarded) {
    if (S.hw) openOnboarding();
    else setTimeout(() => { if (!S.settings.onboarded) openOnboarding(); }, 1200);
  }
}

// ── Crash guard / recovery ────────────────────────────────────
/**
 * A crash (OOM, GPU device lost, the OS killing the tab) must never
 * lose work: the unsent draft is mirrored to localStorage and a marker
 * tells the next launch that an answer was cut mid-flight.
 */
function setupCrashGuard() {
  const draft = Draft.read();
  const ta = $("#input");
  if (draft?.text && ta && !ta.value) {
    ta.value = draft.text;
    autogrow();
    $("#btn-send").classList.add("ready");
    toast("Your unsent message was restored 💾", "info", 4000);
  }
  S.crashRecovery = BusyMark.read();
  if (S.crashRecovery) BusyMark.clear();

  window.addEventListener("pagehide", () => {
    // While a generation is running the marker stays — the answer really
    // is unfinished; otherwise keep the draft and clear the marker.
    if (!S.generating) {
      BusyMark.clear();
      Draft.save(S.activeId, ta?.value || "");
    }
  });
}

/** Close a partial answer from a previous session so it can be continued. */
async function handleInterruptedGeneration() {
  const busy = S.crashRecovery;
  S.crashRecovery = null;
  if (!busy?.threadId) return;
  const list = await getMessages(busy.threadId, { refresh: true });
  const last = [...list].reverse().find(
    (m) => m.role === "assistant" && isInterruptedMessage(m.stats)
  );
  if (!last) return;
  const stats = closedPartialStats(last.stats);
  await Messages.update(last.id, { stats }).catch(() => {});
  cachePatch(busy.threadId, last.id, { stats });
  if (S.activeId === busy.threadId) await renderThread(true);
  toast("The last answer was interrupted (the page closed or ran out of memory) — press ▶️ on it to continue where it stopped.", "warn", 9000);
}

// ── Idle unload (the main protection against OOM kills on phones) ──
function idleTimeoutMs() {
  const pref = S.settings.idleUnload || "auto";
  if (pref === "off") return 0;
  const fixed = IDLE_UNLOAD_MS.fixed[pref];
  if (fixed) return fixed;
  return S.perf === "low" ? IDLE_UNLOAD_MS.autoWeak : IDLE_UNLOAD_MS.autoStrong;
}

function setupIdleUnloader() {
  S.idleWatcher = new IdleUnloader({
    getTimeoutMs: idleTimeoutMs,
    isBusy: () => S.generating || S.downloading,
    onIdle: releaseIdleModel,
  });
}

/**
 * Note "the user is here" (throttled — this also runs on every keystroke).
 * A forced touch always reschedules: the idle timer is skipped entirely
 * while a model is loading or answering, so it must be restarted when the
 * work finishes (`force`).
 */
function touchActivity(force = false) {
  const now = Date.now();
  if (!force && now - S.lastIdleTouch < 5000) return;
  S.lastIdleTouch = now;
  S.idleWatcher?.touch();
}

function releaseIdleModel() {
  if (!S.engineLoaded || S.generating || S.downloading) return;
  S.proxy.unload().catch(() => {});
  S.engineLoaded = false;
  S.engineModelKey = null;
  setStatus("idle", S.model ? `${S.model.name} · free, loads on demand` : "");
  toast("Model released from memory to keep the device healthy — it will load again in a few seconds when you send. 🧠", "info", 6000);
}

/**
 * Android/iOS quietly kill backgrounded tabs. When we come back, verify
 * the engine is still there and reload it from the local cache if not,
 * instead of failing the user's next message.
 */
async function wakeUpChecks() {
  touchActivity();
  // Never probe while the engine is working: on a slow CPU a token can keep
  // the worker busy for seconds and we must not mistake that for death.
  if (S.generating || S.downloading) return;
  if (!S.engineLoaded || !S.engineModelKey) return;
  const timeout = idleTimeoutMs();
  const away = S.hiddenAt ? Date.now() - S.hiddenAt : 0;
  S.hiddenAt = 0;
  if (timeout > 0 && away >= timeout) {
    releaseIdleModel();
    return;
  }
  const st = await S.proxy.health();
  if (st?.loaded) return;
  const key = S.engineModelKey;
  S.engineLoaded = false;
  S.engineModelKey = null;
  if (key && getModel(key)) {
    toast("Reconnecting the AI engine after background time…", "info", 4000);
    loadModel(key, { auto: true }).catch(() => {});
  }
}

function bindUI() {
  $("#btn-send").addEventListener("click", () => onSend());
  $("#btn-stop").addEventListener("click", stopGeneration);
  const input = $("#input");
  let draftTimer = null;
  input.addEventListener("input", () => {
    autogrow();
    // Glow the send button while there is something to send.
    $("#btn-send").classList.toggle("ready", input.value.trim().length > 0);
    touchActivity();
    // Crash guard: mirror the draft (debounced — localStorage is slow).
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => Draft.save(S.activeId, input.value), LIMITS.draftSaveMs);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && S.settings.sendOnEnter) {
      e.preventDefault();
      onSend();
    }
  });

  $("#btn-model").addEventListener("click", () => openModelPicker());
  $("#model-cta").addEventListener("click", () => {
    if (S.model && S.engineLoaded) $("#input").focus();
    else openModelPicker();
  });

  // Drawer — on desktop it collapses the side panel instead of sliding it
  $("#btn-threads").addEventListener("click", () => {
    if (window.innerWidth <= 900) openDrawer();
    else document.body.classList.toggle("drawer-hidden");
  });
  $("#btn-close-drawer").addEventListener("click", closeDrawer);
  $("#scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });
  $("#btn-new-chat").addEventListener("click", () => { newChat(); closeDrawer(); });
  $("#thread-search").addEventListener("input", (e) => {
    S.threadFilter = e.target.value.toLowerCase();
    renderThreadList();
  });
  $("#btn-export").addEventListener("click", onExport);
  $("#btn-import").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", onImportFile);

  $("#btn-export-thread").addEventListener("click", exportThreadMD);
  $("#btn-settings").addEventListener("click", openSettings);
  $("#btn-safe-off").addEventListener("click", () => {
    S.settings = saveSettings({ safeMode: "off" });
    applySafeMode();
    toast("Safe Mode turned off", "info");
  });
  $("#btn-install").addEventListener("click", installPWA);
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    S.installEvt = e;
    $("#btn-install").hidden = false;
  });

  // Messages: scroll + click delegation
  const box = $("#messages");
  box.addEventListener("scroll", () => {
    S.nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    $("#scroll-fab").hidden = S.nearBottom;
  }, { passive: true });
  $("#scroll-fab").addEventListener("click", () => scrollBottom(true));
  $("#btn-load-more").addEventListener("click", () => renderThread(false));
  box.addEventListener("click", onMessagesClick);

  window.addEventListener("online", updateOnlineUI);
  window.addEventListener("offline", updateOnlineUI);
  window.addEventListener("beforeunload", (e) => {
    if (S.downloading || S.generating) {
      e.preventDefault();
      e.returnValue = ""; // required by Chrome to actually show the prompt
    }
  });

  // Surface fatal errors gently (chats are already persisted).
  let lastErrToast = 0;
  const reportGlitch = (err) => {
    console.error("[OffChat]", err);
    const now = Date.now();
    if (now - lastErrToast < 15000) return;
    lastErrToast = now;
    toast("Something glitched — your chats are safe. Reload if it repeats.", "error", 5000);
  };
  window.addEventListener("error", (e) => reportGlitch(e.error || e.message));
  window.addEventListener("unhandledrejection", (e) => reportGlitch(e.reason));

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      S.hiddenAt = Date.now();
      return;
    }
    // The OS drops the wake lock when hidden — take it back on return.
    if (S.downloading || S.generating) holdWakeLock(true);
    wakeUpChecks().catch(() => {});
  });

  const pill = $("#status-pill");
  pill.style.cursor = "pointer";
  pill.setAttribute("title", "Click to manage the model or the download progress");
  pill.addEventListener("click", () => {
    if (S.downloading) {
      downloadHub?.expand();
    } else if (!S.engineLoaded) {
      openModelPicker();
    }
  });
}

let autogrowQueued = false;
let lastGrowProbe = "";
let lastGrowShort = true;

/**
 * Grow the composer with its content. Measuring the textarea forces a
 * layout pass, and this runs on every keystroke — so it is coalesced to
 * one pass per frame and skipped entirely while the text is a short
 * single line (the common case while typing).
 */
function autogrow() {
  const ta = $("#input");
  if (!ta) return;
  updateCharCount();
  if (autogrowQueued) return;
  autogrowQueued = true;
  requestAnimationFrame(() => {
    autogrowQueued = false;
    const value = ta.value;
    const short = value.length < 48 && !value.includes("\n");
    if (short && lastGrowShort) return; // already one row high
    lastGrowShort = short;
    const probe = value + "\n";
    if (probe === lastGrowProbe) return;
    lastGrowProbe = probe;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
  });
}

/** Empty the composer (and its crash-guard draft) in one place. */
function clearInput() {
  const ta = $("#input");
  if (!ta) return;
  ta.value = "";
  ta.style.height = "auto";
  lastGrowProbe = "";
  lastGrowShort = true;
  updateCharCount();
  $("#btn-send").classList.remove("ready");
  Draft.clear();
}

function updateOnlineUI() {
  $("#offline-banner").hidden = navigator.onLine;
}

// ── Drawer / threads ────────────────────────────────────────────
function openDrawer() {
  $("#drawer").classList.add("open");
  $("#scrim").hidden = false;
  requestAnimationFrame(() => $("#scrim").style.opacity = 1);
}
function closeDrawer() {
  if (!$("#drawer").classList.contains("open")) return;
  $("#drawer").classList.remove("open");
  $("#scrim").style.opacity = 0;
  setTimeout(() => { $("#scrim").hidden = true; }, 300);
}

async function refreshThreads(force = false) {
  S.threads = await Threads.list().catch(() => []);
  renderThreadList(force);
}

let threadListSig = "";

function renderThreadList(force = false) {
  const list = $("#thread-list");
  const items = S.threads
    .filter((t) => !S.threadFilter || t.title.toLowerCase().includes(S.threadFilter))
    .sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
  // Rebuilding this list destroys and recreates every row (listeners too).
  // It is refreshed after every answer, so skip it when nothing changed.
  const sig = `${S.activeId}|${S.threadFilter}|` +
    items.map((t) => `${t.id}:${t.updatedAt}:${t.pinned ? 1 : 0}:${t.title}`).join(",");
  if (!force && sig === threadListSig) return;
  threadListSig = sig;
  list.innerHTML = "";
  if (!items.length) {
    list.appendChild(el(`<div class="empty-threads">No chats yet.<br>Create one to get started. ✨</div>`));
    return;
  }
  for (const t of items) {
    const node = el(
      `<div class="thread ${t.id === S.activeId ? "active" : ""}">
        <div class="thread-main">
          <span class="thread-title">${t.pinned ? '<span class="pin-dot">📌 </span>' : ""}${escapeHtml(t.title)}</span>
          <span class="thread-sub">${escapeHtml(t.modelKey ? getModel(t.modelKey)?.name || t.modelKey : "no model")} · ${timeAgo(t.updatedAt)}</span>
        </div>
        <div class="thread-acts">
          <button class="icon-btn" data-act="pin" title="${t.pinned ? "Unpin" : "Pin"}"><svg><use href="#i-pin"/></svg></button>
          <button class="icon-btn" data-act="rename" title="Rename"><svg><use href="#i-edit"/></svg></button>
          <button class="icon-btn" data-act="del" title="Delete"><svg><use href="#i-trash"/></svg></button>
        </div>
      </div>`
    );
    node.querySelector(".thread-main").addEventListener("click", () => {
      openThread(t.id);
      closeDrawer();
    });
    node.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        threadAction(t.id, b.dataset.act);
      })
    );
    list.appendChild(node);
  }
}

async function threadAction(id, act) {
  if (act === "del") {
    const ok = await confirmDialog({
      title: "Delete this chat?",
      text: "This conversation will be gone from this device forever.",
      okLabel: "Delete",
    });
    if (!ok) return;
    await Threads.remove(id);
    S.msgCache.delete(id);
    if (S.activeId === id) {
      S.activeId = null;
      $("#messages").innerHTML = "";
      updateWelcome();
    }
    await refreshThreads();
    toast("Chat deleted", "ok");
  } else if (act === "rename") {
    const t = S.threads.find((x) => x.id === id);
    const { close, body } = openModal({
      title: "Rename",
      html: `<div class="field"><input type="text" id="rn" maxlength="80" value="${escapeHtml(t?.title || "")}"></div>
        <div class="row end gap"><button class="btn primary" id="rn-ok">Save</button></div>`,
    });
    const inp = body.querySelector("#rn");
    inp.focus(); inp.select();
    body.querySelector("#rn-ok").addEventListener("click", async () => {
      await Threads.update(id, { title: inp.value.trim() || "Chat" });
      close();
      await refreshThreads();
    });
  } else if (act === "pin") {
    const t = S.threads.find((x) => x.id === id);
    await Threads.update(id, { pinned: !t?.pinned });
    await refreshThreads();
  }
}

async function newChat() {
  S.activeId = null;
  S.settings = saveSettings({ lastThreadId: null });
  $("#messages").innerHTML = "";
  $("#load-more-wrap").hidden = true;
  Draft.clear();
  updateWelcome();
  updateCtxInfo([]);
  await refreshThreads();
}

async function openThread(id, { silent = false } = {}) {
  S.activeId = id;
  S.settings = saveSettings({ lastThreadId: id });
  await renderThread(true);
  renderThreadList();
  if (!silent) $("#input").focus();
  scrollBottom(false);
}

// ── Rendering messages ────────────────────────────────────────
function updateWelcome() {
  const has = $("#messages").children.length > 0;
  $("#welcome").style.display = has ? "none" : "flex";
}

function scrollBottom(smooth) {
  const box = $("#messages");
  requestAnimationFrame(() => {
    box.scrollTo({ top: box.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  });
}

/** Short clock time for message footers ("14:32", "Mon 14:32", or a date). */
function fmtTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (d.toDateString() === new Date().toDateString()) return `${hh}:${mm}`;
  if (Date.now() - d.getTime() < 7 * 86400000) {
    return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${hh}:${mm}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function msgNode(role, innerHTML, statsText = "", meta = {}) {
  // Note: CSS styles assistant bubbles under .msg.ai (not .msg.assistant)
  const cls = role === "assistant" ? "ai" : role;
  const avatar = role === "user"
    ? `<div class="msg-avatar">You</div>`
    : `<div class="msg-avatar"><img src="./icons/icon-192.png" alt="AI"></div>`;
  const node = el(
    `<div class="msg ${cls}">${avatar}<div class="bubble"><div class="content"></div>
      <div class="msg-foot">
        <button class="icon-btn" data-act="copy" title="Copy"><svg><use href="#i-copy"/></svg></button>
        ${role === "assistant" ? `<button class="icon-btn" data-act="regen" title="Regenerate"><svg><use href="#i-refresh"/></svg></button>` : ""}
        ${role === "assistant" && meta.cutOff ? `<button class="icon-btn accent" data-act="continue" title="Continue this answer"><svg><use href="#i-play"/></svg></button>` : ""}
        ${meta.ts ? `<time class="msg-time" title="${escapeHtml(new Date(meta.ts).toLocaleString())}">${escapeHtml(fmtTime(meta.ts))}</time>` : ""}
        <small>${escapeHtml(statsText)}</small>
      </div></div></div>`
  );
  node.querySelector(".content").innerHTML = innerHTML;
  return node;
}

function statsLine(stats) {
  if (!stats) return "";
  const parts = [];
  if (stats.tokPerSec) parts.push(`${stats.tokPerSec} tok/s`);
  if (stats.completionTokens) parts.push(`${stats.completionTokens} tok`);
  if (stats.ttftMs) parts.push(`first token ${(stats.ttftMs / 1000).toFixed(1)}s`);
  return parts.join(" · ");
}

/** Body HTML of a message (user text is escaped, answers are Markdown). */
function messageHTML(role, content) {
  const text = String(content ?? "");
  if (role === "user") return escapeHtml(text).replace(/\n/g, "<br>");
  return renderMarkdown(text);
}

/**
 * Fill a bubble. Very long messages are cut for the first paint (a 50k
 * character answer would freeze a weak phone) and can be shown in full
 * with one tap — the text itself is never lost.
 */
function fillBubbleContent(node, role, content) {
  const raw = String(content ?? "");
  const cap = LIMITS.maxRenderChars;
  const long = raw.length > cap;
  const shown = long ? raw.slice(0, cap) : raw;
  node.querySelector(".content").innerHTML = messageHTML(role, shown);
  node.dataset.raw = shown;
  if (long) node.dataset.long = "1";
  else delete node.dataset.long;
  const bubble = node.querySelector(".bubble");
  bubble.querySelector(".msg-truncated")?.remove();
  if (long) {
    bubble.appendChild(el(
      `<div class="msg-truncated"><span>Trimmed for speed · ${Math.round(raw.length / 1000)}k chars</span>` +
      `<button class="btn ghost xs" data-act="expand">Show all</button></div>`
    ));
  }
  return long;
}

/** Add a "continue this answer" button to an existing bubble. */
function addContinueButton(node, mid) {
  const foot = node?.querySelector(".msg-foot");
  if (!mid || !foot || foot.querySelector('[data-act="continue"]')) return;
  node.dataset.mid = mid;
  const btn = el(
    `<button class="icon-btn accent" data-act="continue" title="Continue this answer"><svg><use href="#i-play"/></svg></button>`
  );
  foot.insertBefore(btn, foot.querySelector("time") || foot.querySelector("small") || null);
}

/** Full text of a message, from the DOM or from the message cache. */
function rawOf(node) {
  if (!node) return "";
  if (node.dataset.long) {
    const id = node.dataset.mid;
    const cached = id ? S.msgCache.get(S.activeId)?.find((m) => m.id === id) : null;
    if (cached) return cached.content || "";
  }
  return node.dataset.raw || node.querySelector(".content")?.textContent || "";
}

async function renderThread(resetWindow) {
  const box = $("#messages");
  box.innerHTML = "";
  if (!S.activeId) {
    $("#load-more-wrap").hidden = true;
    updateWelcome();
    return;
  }
  const all = await getMessages(S.activeId);
  const total = all.length;
  const windowSize = resetWindow ? renderWindowSize() : total;
  const slice = all.slice(-windowSize);
  $("#load-more-wrap").hidden = total <= slice.length;
  for (const m of slice) {
    const interrupted = isInterruptedMessage(m.stats);
    const node = msgNode(m.role, "", statsLine(m.stats), {
      ts: m.ts,
      cutOff: !!m.stats?.cutOff || interrupted,
    });
    node.dataset.mid = m.id;
    fillBubbleContent(node, m.role, m.content);
    box.appendChild(node);
  }
  updateWelcome();
  updateCtxInfo(all);
  scrollBottom(false);
}

function onMessagesClick(e) {
  const copyBtn = e.target.closest(".copy-code");
  if (copyBtn) {
    let code = "";
    try {
      code = decodeURIComponent(copyBtn.dataset.code || "");
    } catch {
      code = copyBtn.dataset.code || "";
    }
    copyText(code)
      .then((ok) => toast(ok ? "Code copied" : "Could not copy", ok ? "ok" : "error"));
    return;
  }
  const expandBtn = e.target.closest('[data-act="expand"]');
  if (expandBtn) {
    const msgEl = expandBtn.closest(".msg");
    if (msgEl) {
      const full = rawOf(msgEl);
      const role = msgEl.classList.contains("user") ? "user" : "assistant";
      delete msgEl.dataset.long;
      msgEl.querySelector(".msg-truncated")?.remove();
      msgEl.dataset.raw = full;
      msgEl.querySelector(".content").innerHTML = messageHTML(role, full);
      if (full.length > 60000) {
        toast("This message is extremely long — the page may slow down for a moment.", "warn", 5000);
      }
    }
    return;
  }
  const btn = e.target.closest(".msg-foot button");
  if (!btn) return;
  const msgEl = e.target.closest(".msg");
  const raw = rawOf(msgEl);
  if (btn.dataset.act === "copy") {
    copyText(raw).then((ok) => toast(ok ? "Copied" : "Could not copy", ok ? "ok" : "error"));
  } else if (btn.dataset.act === "regen") {
    regenerate();
  } else if (btn.dataset.act === "continue") {
    continueReply(msgEl?.dataset.mid);
  }
}

// ── Sending / generating ──────────────────────────────────────
async function queuePrompt(text) {
  if (!text || S.generating) return;
  if (!S.model) {
    toast("Pick an AI model first", "warn");
    return;
  }
  clearInput();

  // Make sure we have a working thread
  if (!S.activeId) {
    const t = await Threads.create({
      title: autoTitle(text),
      modelKey: S.model?.key || null,
      modelId: S.model?.modelId || null,
      engine: S.model?.engine || null,
    });
    S.activeId = t.id;
    S.settings = saveSettings({ lastThreadId: t.id });
    await refreshThreads();
  } else {
    const t = S.threads.find((x) => x.id === S.activeId);
    if (t && (t.title === "New chat" || !t.title)) {
      await Threads.update(S.activeId, { title: autoTitle(text) });
      await refreshThreads();
    }
  }

  const userMsg = await Messages.add(S.activeId, { role: "user", content: text });
  cacheAdd(S.activeId, userMsg);
  const box = $("#messages");
  const uNode = msgNode("user", escapeHtml(text).replace(/\n/g, "<br>"), "", { ts: userMsg.ts });
  uNode.dataset.mid = userMsg.id;
  uNode.dataset.raw = text;
  box.appendChild(uNode);

  const qNode = msgNode(
    "assistant",
    `<div class="queued-indicator">⏳ Downloading the model (<span id="queued-dl-pct">0%</span>) — the answer will appear automatically!</div>`,
    ""
  );
  box.appendChild(qNode);

  updateWelcome();
  scrollBottom(true);

  S.queuedPrompt = {
    threadId: S.activeId,
    text,
    placeholderNode: qNode,
  };

  toast("Message queued — it will be answered automatically once loaded! 🚀", "ok", 4000);
}

async function processQueuedPrompt() {
  if (!S.queuedPrompt) return;
  const { placeholderNode } = S.queuedPrompt;
  S.queuedPrompt = null;
  if (placeholderNode && placeholderNode.parentNode) {
    placeholderNode.remove();
  }
  toast("Model ready — generating the answer to your question… ✨", "ok");
  await generateReply();
}

async function onSend() {
  const ta = $("#input");
  const text = ta.value.trim();
  if (!text || S.generating) return;

  // A download is in progress:
  //  - engine not ready yet → queue (answer after loading),
  //  - downloading a DIFFERENT model than the active one → queue (new model answers),
  //  - the same model already runs in memory → answer right away.
  if (S.downloading) {
    const sameModelActive = S.engineLoaded && S.model && S.engineModelKey === S.model.key;
    if (!sameModelActive) {
      await queuePrompt(text);
      return;
    }
  }

  if (!(await ensureEngine())) return;

  clearInput();
  touchActivity();

  // Working thread
  if (!S.activeId) {
    const t = await Threads.create({
      title: autoTitle(text),
      modelKey: S.model.key, modelId: S.model.modelId, engine: S.model.engine,
    });
    S.activeId = t.id;
    S.settings = saveSettings({ lastThreadId: t.id });
    await refreshThreads();
  } else {
    const t = S.threads.find((x) => x.id === S.activeId);
    if (t && (t.title === "New chat" || !t.title)) {
      await Threads.update(S.activeId, { title: autoTitle(text) });
      await refreshThreads();
    }
  }

  const userMsg = await Messages.add(S.activeId, { role: "user", content: text });
  cacheAdd(S.activeId, userMsg);
  const box = $("#messages");
  const uNode = msgNode("user", escapeHtml(text).replace(/\n/g, "<br>"), "", { ts: userMsg.ts });
  uNode.dataset.mid = userMsg.id;
  uNode.dataset.raw = text;
  box.appendChild(uNode);
  updateWelcome();
  scrollBottom(true);

  await generateReply();
}

/**
 * The fastest stable model that is clearly smaller than the current one —
 * used to nudge the user when their device is crawling.
 */
function fasterAlternative(model) {
  const pool = (model.engine === "webllm" ? MODEL_CATALOG : WASM_CATALOG)
    .filter((m) => m.key !== model.key && m.stable !== false && m.sizeMB < model.sizeMB);
  if (!pool.length) return null;
  pool.sort((a, b) => (b.tps?.[1] || 0) - (a.tps?.[1] || 0));
  const best = pool[0];
  return (best.tps?.[1] || 0) > (model.tps?.[1] || 0) ? best : null;
}

/** Keep one oversized message from eating the whole context window. */
function tailChars(text, maxChars) {
  if (text.length <= maxChars) return text;
  return "…" + text.slice(text.length - maxChars + 1);
}

function historyForChat(allMessages, ctxTokens) {
  const sys = { role: "system", content: S.settings.systemPrompt };
  const budget = Math.max(512, ctxTokens - S.settings.maxTokens - 128);
  const picked = [];
  let used = estimateTokens(sys.content);
  for (let i = allMessages.length - 1; i >= 0; i--) {
    const m = allMessages[i];
    if (m.role !== "user" && m.role !== "assistant") continue;
    let content = m.content;
    let cost = estimateTokens(content) + 8;
    if (used + cost > budget) {
      const left = budget - used;
      // A single huge message (a pasted document, a long answer) must not
      // be dropped entirely — keep its tail, which is the relevant part.
      if (!picked.length && left > 200) {
        content = tailChars(content, left * 4);
        cost = estimateTokens(content) + 8;
      } else {
        break;
      }
    }
    used += cost;
    picked.unshift({ role: m.role, content });
  }
  return [sys, ...picked];
}

async function generateReply(opts = {}) {
  const box = $("#messages");
  const cont = opts.continuationOf || null; // { mid, baseText, node }
  S.generating = true;
  S.streamText = cont?.baseText || "";
  touchActivity();
  $("#btn-send").disabled = true;
  $("#btn-stop").hidden = false;
  $("#progress-line").hidden = false;
  // Pause background animation while the GPU is busy with inference and
  // tell assistive tech to stay quiet until the answer is complete.
  document.body.classList.add("generating");
  box.setAttribute("aria-busy", "true");
  holdWakeLock(true);

  // Streaming bubble (fresh, or the existing one when continuing)
  let node = cont?.node || null;
  if (!node || !node.isConnected) {
    node = msgNode("assistant", `<span class="typing"><i></i><i></i><i></i></span>`, "");
    box.appendChild(node);
  }
  const content = node.querySelector(".content");
  node.querySelector('[data-act="continue"]')?.remove();
  content.innerHTML = "";

  // Incremental renderer: finished blocks are appended once, only the tail
  // is re-rendered — the answer can be long without slowing the device down.
  const renderer = new StreamRenderer(content, {
    caret: true,
    lowFx: S.perf === "low" || S.safeActive,
    placeholder: `<span class="typing"><i></i><i></i><i></i></span>`,
  });

  const t0 = performance.now();
  let lastStatsPaint = 0;
  let scrollQueued = false;
  const paintStats = () => {
    const now = performance.now();
    if (now - lastStatsPaint < 250) return;
    lastStatsPaint = now;
    const secs = Math.max(0.1, (now - t0) / 1000);
    const toks = Math.ceil(S.streamText.length / 4);
    $("#gen-stats").textContent = `${toks} tok · ${(toks / secs).toFixed(1)} tok/s`;
  };
  const keepAtBottom = () => {
    if (!S.nearBottom || scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      if (S.nearBottom) box.scrollTop = box.scrollHeight;
    });
  };
  renderer.onPaint = () => { paintStats(); keepAtBottom(); };
  renderer.setText(S.streamText, { force: true });
  scrollBottom(true);

  // Crash safety: the partial answer is written to IndexedDB while it
  // streams, so a crash leaves a message that can be continued instead of
  // nothing at all.
  let mid = cont?.mid || null;
  let lastSavedLen = -1;
  let lastSaveAt = 0;
  const savePartial = async (force = false) => {
    if (!S.activeId || !S.streamText) return;
    const now = Date.now();
    if (!force && now - lastSaveAt < LIMITS.partialSaveMs) return;
    lastSaveAt = now;
    lastSavedLen = S.streamText.length;
    const stats = {
      streaming: true,
      completionTokens: Math.ceil(S.streamText.length / 4),
    };
    if (mid) {
      await Messages.update(mid, { content: S.streamText, stats }).catch(() => {});
      cachePatch(S.activeId, mid, { content: S.streamText, stats });
    } else {
      const saved = await Messages.add(S.activeId, { role: "assistant", content: S.streamText, stats })
        .catch(() => null);
      if (saved) {
        mid = saved.id;
        cacheAdd(S.activeId, saved);
      }
    }
  };

  try {
    const all = await getMessages(S.activeId);
    const ctx = S.model.ctx || 4096;
    const history = historyForChat(all, ctx);
    if (cont) {
      // Invisible nudge — sent, but never saved, so the history stays clean.
      history.push({ role: "user", content: "Continue from exactly where you stopped. Do not repeat what you already wrote." });
    }
    updateCtxInfo(all);
    setStatus("generating", S.model.name);
    BusyMark.set({ threadId: S.activeId, modelKey: S.model?.key || null });

    const res = await S.proxy.chat(history, {
      temperature: S.settings.temperature,
      maxTokens: S.settings.maxTokens,
      topP: S.settings.topP,
      onToken: (delta) => {
        S.streamText += delta;
        renderer.setText(S.streamText);
        if (S.streamText.length - lastSavedLen > 160) savePartial().catch(() => {});
      },
      // The engine died mid-answer and is being rebuilt: start the bubble
      // over so the new answer is not appended to a dead fragment.
      onRestart: () => {
        S.streamText = cont?.baseText || "";
        lastSavedLen = -1;
        renderer.reset();
      },
    });
    S.streamText = cont
      ? cont.baseText + (res.text || S.streamText.slice(cont.baseText.length))
      : (res.text || S.streamText);
    renderer.finish(S.streamText);

    // Cut off at the token limit? (exact signal on WebLLM, estimate on WASM)
    const legTokens = res.completionTokens || Math.ceil((res.text || "").length / 4);
    const cutOff = !res.aborted && (res.finishReason === "length" || legTokens >= S.settings.maxTokens - 1);
    const stats = {
      tokPerSec: res.tokPerSec || null,
      completionTokens: cont ? Math.ceil(S.streamText.length / 4) : legTokens,
      ttftMs: res.ttftMs || null,
      cutOff,
    };
    if (mid) {
      await Messages.update(mid, { content: S.streamText, stats }).catch(() => {});
      cachePatch(S.activeId, mid, { content: S.streamText, stats });
    } else {
      const saved = await Messages.add(S.activeId, { role: "assistant", content: S.streamText, stats })
        .catch(() => null);
      if (saved) {
        mid = saved.id;
        cacheAdd(S.activeId, saved);
      }
    }
    BusyMark.clear();

    // Swap in a finished bubble. The already-rendered DOM is moved over
    // (no second Markdown pass) unless the answer needs trimming.
    const finalNode = msgNode("assistant", "", statsLine(stats), { ts: Date.now(), cutOff });
    finalNode.dataset.mid = mid || "";
    if (S.streamText.length <= LIMITS.maxRenderChars) {
      finalNode.querySelector(".content").append(...content.childNodes);
      finalNode.dataset.raw = S.streamText;
    } else {
      fillBubbleContent(finalNode, "assistant", S.streamText);
    }
    if (!S.streamText.trim()) {
      // Some tiny models answer with nothing at all — say so instead of
      // leaving the user with an empty bubble.
      finalNode.querySelector(".content").innerHTML =
        `<p class="muted">The model returned an empty answer — try again, ask something shorter, or pick a slightly bigger model.</p>`;
    }
    node.replaceWith(finalNode);
    node = finalNode;
    box.setAttribute("aria-busy", "false");
    $("#gen-stats").textContent = res.aborted
      ? `Stopped · ${statsLine(stats)}`
      : cutOff
        ? `Cut off at the token limit — press Continue below`
        : `Done in ${((performance.now() - t0) / 1000).toFixed(1)}s · ${statsLine(stats)}`;

    updateCtxInfo(S.msgCache.get(S.activeId) || []);
    await refreshThreads();
    setStatus("ready", S.model.name + (navigator.onLine ? "" : " · offline"));

    // Very slow generation? Suggest a lighter model — once per session.
    if (!res.aborted && res.tokPerSec && res.tokPerSec < 3 && !S.slowHintShown && S.model) {
      const faster = fasterAlternative(S.model);
      if (faster) {
        S.slowHintShown = true;
        setTimeout(() => {
          toast(`That answer ran at ~${res.tokPerSec} tok/s — ${faster.name} would feel much snappier on this device.`, "info", 9000);
        }, 1200);
      }
    }
  } catch (e) {
    console.error(e);
    if (mid) {
      const stats = closedPartialStats(null);
      Messages.update(mid, { content: S.streamText, stats }).catch(() => {});
      cachePatch(S.activeId, mid, { content: S.streamText, stats });
    }
    renderer.cancel();
    if (S.streamText) {
      // Keep whatever the model already wrote — never throw away a partial
      // answer — and offer to continue instead of starting over.
      content.appendChild(el(
        `<p class="gen-error muted">⚠️ <strong>Generation stopped:</strong> ${escapeHtml(friendlyError(e))}</p>`
      ));
      node.dataset.raw = S.streamText;
      addContinueButton(node, mid);
    } else {
      content.innerHTML = `<p>⚠️ <strong>Could not generate an answer.</strong></p><p class="muted">${escapeHtml(friendlyError(e))}</p>`;
    }
    box.setAttribute("aria-busy", "false");
    setStatus("error", "generation failed");
    toast(friendlyError(e), "error", 5000);
    if (isGpuError(e)) {
      S.engineLoaded = false;
      S.engineModelKey = null;
      offerGpuRecovery();
    } else {
      setTimeout(() => {
        if (S.engineLoaded) setStatus("ready", S.model?.name || "");
      }, 4000);
    }
  } finally {
    S.generating = false;
    BusyMark.clear();
    holdWakeLock(false);
    document.body.classList.remove("generating");
    box.setAttribute("aria-busy", "false");
    $("#btn-send").disabled = false;
    $("#btn-stop").hidden = true;
    $("#progress-line").hidden = true;
    touchActivity(true);
    if (S.nearBottom) scrollBottom(true);
  }
}

async function stopGeneration() {
  if (!S.generating) return;
  await S.proxy.abort().catch(() => {});
  toast("Generation stopped", "info");
}

async function regenerate() {
  if (S.generating || !S.activeId) return;
  if (!(await ensureEngine())) return;
  const removed = await Messages.removeLastAssistant(S.activeId);
  if (!removed) {
    toast("Nothing to regenerate", "warn");
    return;
  }
  const list = S.msgCache.get(S.activeId);
  if (list) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === "assistant") {
        list.splice(i, 1);
        break;
      }
    }
  }
  await renderThread(false);
  await generateReply();
}

async function continueReply(mid) {
  if (S.generating || !S.activeId) return;
  if (!(await ensureEngine())) return;
  const node = mid && $("#messages").querySelector(`.msg[data-mid="${mid}"]`);
  const baseText = node ? rawOf(node) : "";
  if (!node || !baseText) {
    toast("Could not find that message — try Regenerate", "warn");
    return;
  }
  await generateReply({ continuationOf: { mid, baseText, node } });
}

/** Did the GPU just crash (device lost / out of memory)? */
function isGpuError(e) {
  const m = String(e?.message || e || "");
  return /device lost|lost device|out of memory|OOM|allocation failed|failed to allocate|webgpu/i.test(m);
}

/** Host of a URL, for compact error messages. */
function shortHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/**
 * A model whose repository could not be verified (missing, renamed or
 * private). Hugging Face answers 401 for those, so this carries the
 * reason down to `friendlyError` instead of a cryptic library string.
 */
function modelCheckError(model, check) {
  const e = new Error(
    `MODEL_UNAVAILABLE: ${model.modelId} (${check.code}${check.status ? ` · HTTP ${check.status}` : ""})`
  );
  e.code = check.code;
  e.status = check.status ?? null;
  e.modelKey = model.key;
  e.tried = check.tried || [];
  return e;
}

/**
 * 🐢 Potato mode — one click for very weak / very old phones:
 * lightest model, tiny context, no blur, no animations, quick unload.
 */
function applyPotatoMode() {
  S.settings = saveSettings(potatoProfile());
  // Pick the lightest model that still fits — and swap out a heavy one,
  // otherwise "potato mode" would only change the colours.
  const pool = (S.hw?.webgpu?.supported === false ? WASM_CATALOG : MODEL_CATALOG)
    .filter((m) => m.stable);
  const lightest = pool.slice().sort((a, b) => (a.vramMB || 0) - (b.vramMB || 0))[0];
  const current = S.settings.modelKey ? getModel(S.settings.modelKey) : null;
  const tooHeavy = current && (current.tier === "pro" || current.tier === "max" || current.vramMB > 1600);
  if (lightest && (!current || tooHeavy)) {
    S.settings = saveSettings({ modelKey: lightest.key });
    S.potatoModelName = lightest.name;
  }
  applyAppearance();
  applyAnims();
  applySafeMode();
  S.idleWatcher?.refresh?.();
}

/** Offer Potato mode once, when the device really looks like a potato. */
async function maybeSuggestPotato() {
  if (S.settings.potato || S.settings.potatoAsked) return;
  if (!shouldSuggestPotato(S.hw)) return;
  S.settings = saveSettings({ potatoAsked: true });
  const ok = await confirmDialog({
    title: "🐢 Potato mode?",
    text: "This device looks light (little RAM, few cores or no WebGPU). Potato mode picks the smallest model, "
      + "shrinks the context window and turns off blur/animations so OffChat stays responsive instead of crashing.",
    okLabel: "Enable potato mode",
  });
  if (ok) {
    applyPotatoMode();
    toast("Potato mode on 🐢 — lightest model, tiny context, no effects", "ok", 6000);
  }
}

function friendlyError(e) {
  const m = String(e?.message || e || "");
  // Prefer the machine-readable diagnosis attached by the engine /
  // model preflight; fall back to reading the raw message.
  const info = e?.code
    ? { code: e.code, status: e.status ?? null, url: e.url || null }
    : classifyError(e);
  const where = info.url ? ` (${shortHost(info.url)})` : "";

  // The classic one: HTTP 401 from the Hub means the repository is
  // missing, renamed or private — NOT that the user did something wrong.
  if (info.code === "unauthorized") {
    return "That model could not be found on Hugging Face (it was renamed, removed or is private) — the Hub answers "
      + "such requests with 401 Unauthorized" + where + ". OffChat repairs renamed repositories automatically, "
      + "so pick another model from the list (SmolLM2 and Gemma 3 270M are verified to work).";
  }
  if (info.code === "forbidden") {
    return "Hugging Face refused this file (HTTP 403 — the model is gated or the download limit was hit" + where + "). "
      + "Gated models need an account, which a browser-only app cannot use — choose an open model instead.";
  }
  if (info.code === "missing-file") {
    return "This model does not publish the requested variant on Hugging Face" + where + ". "
      + "Pick the model again — OffChat will fall back to another quantisation automatically.";
  }
  if (info.code === "server") {
    return "Hugging Face had a server hiccup (HTTP 5xx" + where + "). Wait a moment and retry — the download resumes from the cache.";
  }
  if (info.code === "storage") {
    return "Not enough storage for this model. Free some space (Settings → Clear model cache) or pick a smaller model.";
  }
  if (info.code === "offline") {
    return "You are offline — connect to the internet and retry. Models already downloaded keep working offline.";
  }

  if (/device lost|lost device/i.test(m)) {
    return "The GPU crashed (device lost) — the model was unloaded to protect the page. Enable Safe Mode and try a smaller model or the CPU mode.";
  }
  if (/memory|OOM|out of memory|allocation/i.test(m)) {
    return "Out of memory — close other tabs and pick a smaller model (e.g. SmolLM2 360M or Qwen 0.5B), or enable Safe Mode.";
  }
  if (/webgpu|adapter/i.test(m)) {
    return "WebGPU trouble — reload the page or pick the compatibility (WASM) mode.";
  }
  if (/network|fetch|Failed to fetch|Load failed|resolve module|CORS|networkerror/i.test(m)) {
    return "Network trouble — the model or the engine library could not be downloaded. Check your connection (or blocking extensions) and retry. "
      + "If the model was downloaded before, the browser may have cleared its cache — pick it again to re-download.";
  }
  if (/MODEL_NOT_FOUND/i.test(m)) return m.replace("MODEL_NOT_FOUND: ", "");
  if (/engine is not loaded|lost its model|not loaded/i.test(m)) {
    return "The engine lost its model (e.g. after a GPU crash) — open the list and pick a model again.";
  }
  if (/context|Conversation exceeded/i.test(m)) {
    return "Context window exceeded — start a new chat or shorten the history.";
  }
  return m.length > 220 ? m.slice(0, 217) + "…" : m;
}

/** Recovery dialog after a GPU crash: Safe Mode, CPU model, or dismiss. */
function offerGpuRecovery() {
  const { close, body } = openModal({
    title: "🛡️ GPU crash detected",
    html: `<p class="muted">The graphics card ran out of memory or lost its context, so the model was unloaded.
      Your chats are safe. Pick how to continue:</p>
      <div class="warnline"><svg><use href="#i-warn"/></svg><span>Tip: Safe Mode simplifies visuals and caps memory, which prevents most mobile GPU crashes.</span></div>
      <div class="row end gap" style="flex-wrap:wrap">
        <button class="btn ghost" data-act="later">Later</button>
        <button class="btn ghost" data-act="cpu">🐢 Use a CPU model</button>
        <button class="btn primary" data-act="safe">🛡️ Safe Mode + small model</button>
      </div>`,
  });
  body.querySelector('[data-act="later"]').addEventListener("click", () => {
    close();
    if (S.engineLoaded) setStatus("ready", S.model?.name || "");
    else setStatus("idle", "pick a model");
  });
  body.querySelector('[data-act="cpu"]').addEventListener("click", async () => {
    close();
    await S.proxy.unload().catch(() => {});
    S.engineLoaded = false;
    S.engineModelKey = null;
    setStatus("idle", "pick a model");
    openModelPicker();
    toast("Pick a model from the Compatibility (WASM) section", "info", 5000);
  });
  body.querySelector('[data-act="safe"]').addEventListener("click", async () => {
    S.settings = saveSettings({ safeMode: "on" });
    applySafeMode();
    close();
    await S.proxy.unload().catch(() => {});
    S.engineLoaded = false;
    S.engineModelKey = null;
    setStatus("idle", "pick a model");
    toast("Safe Mode is on — now pick one of the smallest models 🛡️", "ok", 5000);
    openModelPicker();
  });
}

function updateCtxInfo(allMessages) {
  const elInfo = $("#ctx-info");
  if (!S.model || !allMessages?.length) {
    elInfo.textContent = S.model ? `Context: ~${(S.model.ctx / 1024).toFixed(0)}k tokens` : "";
    return;
  }
  const used = estimateTokens(S.settings.systemPrompt) +
    allMessages.reduce((a, m) => a + estimateTokens(m.content) + 8, 0);
  const ctx = S.model.ctx || 4096;
  const pct = Math.min(999, Math.round((used / ctx) * 100));
  elInfo.textContent = `Context: ~${used} / ${ctx} tok (${pct}%)`;
}

// ── Engine: ensure / load ─────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Errors worth retrying (the download was interrupted, not the model). */
function isTransientError(e) {
  const m = String(e?.message || e || "");
  return /network|fetch|failed to fetch|load failed|timeout|timed out|net::|connection|resolve module|err_|socket|aborted/i.test(m)
    && !isGpuError(e);
}

/** One blind retry covers the common "Wi-Fi blinked during a download". */
async function withRetry(fn, { retries = 1 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === retries || !isTransientError(e) || !navigator.onLine) throw e;
      toast("The connection dropped — resuming the download… 🔄", "warn", 4000);
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function ensureEngine() {
  if (S.engineLoaded && S.engineModelKey) {
    // Cheap liveness check: the engine can die silently (a GPU crash or the
    // browser killing the worker) while the UI still claims "Ready".
    const state = await S.proxy.health().catch(() => null);
    if (state?.loaded) return true;
    S.engineLoaded = false;
    S.engineModelKey = null;
  }
  if (!S.model) {
    openModelPicker();
    toast("Pick an AI model first", "info");
    return false;
  }
  try {
    await loadModel(S.model.key);
    return true;
  } catch {
    return false;
  }
}

/** Ask before a download that may not fit in the free storage. */
async function confirmStorageRoom(model) {
  const free = S.hw?.storage?.freeMB || 0;
  if (!free || S.settings.downloaded[model.key]) return true;
  if (free > model.sizeMB * 1.4) return true;
  return confirmDialog({
    title: "Not much free space left",
    text: `${model.name} needs about ${fmtSizeMB(model.sizeMB)} but only ~${fmtBytes(free)} is free. ` +
      "The download may fail. Continue anyway?",
    okLabel: "Continue",
    danger: true,
  });
}

async function loadModel(key, { auto = false } = {}) {
  const model = getModel(key);
  if (!model) throw new Error("Unknown model.");
  if (S.engineLoaded && S.engineModelKey === key) {
    // The model already sits in memory — zero work, zero re-download.
    S.model = model;
    updateModelChip();
    if (!S.settings.onboarded) S.settings = saveSettings({ onboarded: true });
    setStatus("ready", model.name + (navigator.onLine ? "" : " · offline"));
    return;
  }
  if (S.downloading) {
    toast("A model is already loading…", "info");
    ensureDownloadHub();
    downloadHub?.expand();
    return;
  }
  if (!S.hw) {
    try { S.hw = await probeHardware(); } catch { /* continue with the fallback */ }
  }
  const hw = S.hw || { mobile: true, ramGB: 4, webgpu: { supported: true, f16: false }, cores: 4 };

  if (!auto && !(await confirmStorageRoom(model))) return;

  // Mobile-data warning (only for fresh, large downloads)
  if (!auto && hw.connection?.saveData && !S.settings.downloaded[key] && model.sizeMB > 500) {
    toast("Data-saver mode is on: downloading a large model…", "warn", 5000);
  }

  // Ask for persistent storage
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  S.downloading = true;
  touchActivity();
  holdWakeLock(true);
  S.model = model;
  S.settings = saveSettings({ modelKey: key });
  updateModelChip();

  // The download hub carries the telemetry, the mini-game and the facts —
  // it is imported only now, never at boot.
  const hub = await ensureDownloadHub();
  hub?.start(model, { auto });

  const onProgress = (p) => {
    hub?.updateProgress(p);
    const percent = Math.round((p.progress || 0) * 100);
    if (p.phase === "download") setStatus("download", `${model.name} · ${percent}%`);
    else if (p.phase === "load") setStatus("load", model.name);
  };

  try {
    await withRetry(async () => {
      if (model.engine === "webllm") {
        const ctx = suggestContextWindow(hw, model, S.settings.ctxCap, S.safeActive);
        await S.proxy.loadWebLLM({
          modelId: model.modelId,
          cacheBackend: S.settings.cacheBackend || "cache",
          contextWindow: ctx,
          hasF16: hw.webgpu?.f16 !== false,
          onProgress,
        });
      } else {
        // Verify the repository and the weight variant BEFORE downloading
        // hundreds of MB. Hugging Face answers 401 for a repo that does not
        // exist, so a wrong id used to surface as "Unauthorized access to
        // file" — this catches it (and repairs renamed repos) first.
        let repo = model.modelId;
        let dtypes = model.dtypes || ["q8", "q4", "q4f16"];
        let externalData = 0;
        if (!S.settings.downloaded[key]) {
          setStatus("load", `${model.name} · checking…`);
          const check = await probeWasmModel(model, { force: !auto });
          if (!check.ok) throw modelCheckError(model, check);
          repo = check.repo;
          if (check.dtype) dtypes = [check.dtype, ...dtypes.filter((d) => d !== check.dtype)];
          externalData = check.data?.length || 0;
        }
        const threads = hw.crossIsolated ? Math.min(hw.cores || 4, 4) : 1;
        await S.proxy.loadTransformers({
          modelId: repo,
          dtypes,
          device: "wasm",
          threads,
          externalData,
          onProgress,
        });
      }
    });
    S.engineLoaded = true;
    S.engineModelKey = key;
    S.settings = saveSettings({
      downloaded: { ...S.settings.downloaded, [key]: { ts: Date.now(), bytes: model.sizeMB } },
    });
    setStatus("ready", model.name + (navigator.onLine ? "" : " · offline"));
    toast(`Ready: ${model.name} — running locally${navigator.onLine ? "" : " (offline)"}`, "ok");
    if (!S.settings.onboarded) S.settings = saveSettings({ onboarded: true });

    if (S.queuedPrompt) {
      processQueuedPrompt();
    }
  } catch (e) {
    console.error(e);
    S.engineLoaded = false;
    S.engineModelKey = null;
    setStatus("error", "loading failed");
    // Offline and the load still failed → the cached weights are gone
    // (browsers evict them). Stop claiming the model is available offline.
    if (isTransientError(e) && !navigator.onLine && S.settings.downloaded[key]) {
      const next = { ...S.settings.downloaded };
      delete next[key];
      S.settings = saveSettings({ downloaded: next });
    }
    toast(friendlyError(e), "error", 6000);
    // A model that is gone/renamed/gated: point at one that is verified.
    if (["unauthorized", "forbidden", "missing-file"].includes(e?.code)) {
      const alt = (model.engine === "transformers" ? WASM_CATALOG : MODEL_CATALOG)
        .filter((m) => m.stable && m.key !== model.key)
        .sort((a, b) => a.sizeMB - b.sizeMB)[0];
      if (alt) toast(`Try “${alt.name}” instead — it is verified to install. ✔`, "info", 9000);
    }
    if (isGpuError(e)) {
      // Give the hub a moment to close before showing recovery.
      setTimeout(() => offerGpuRecovery(), 350);
    }
    throw e;
  } finally {
    S.downloading = false;
    holdWakeLock(false);
    hub?.finish();
    touchActivity(true);
  }
}

// ── Onboarding / model picker ─────────────────────────────────
// ── Wake lock / composer / export / launch ──────────────────────
let wakeLock = null;
/** Keep the screen on during long downloads & generation (mobile). */
async function holdWakeLock(on) {
  try {
    if (on && "wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  } catch { /* unsupported or denied — stay silent */ }
}

function updateCharCount() {
  const ta = $("#input");
  const cc = $("#char-count");
  if (!ta || !cc) return;
  const n = ta.value.length;
  const max = Number(ta.getAttribute("maxlength") || 4000);
  cc.textContent = n ? `${n.toLocaleString("en-US")} / ${max.toLocaleString("en-US")}` : "";
  cc.classList.toggle("warn", n > max * 0.9);
}

async function exportThreadMD() {
  if (!S.activeId) {
    toast("Open a chat first", "warn");
    return;
  }
  const t = S.threads.find((x) => x.id === S.activeId);
  const all = await getMessages(S.activeId).catch(() => []);
  if (!all.length) {
    toast("Nothing to export yet", "warn");
    return;
  }
  const modelName = t?.modelKey ? getModel(t.modelKey)?.name || t.modelKey : "—";
  const lines = [
    `# ${t?.title || "OffChat export"}`,
    ``,
    `*Exported ${new Date().toLocaleString()} · model: ${modelName}*`,
    ``,
  ];
  for (const m of all) {
    lines.push(m.role === "user" ? "## 🧑 You" : "## 🤖 OffChat", "", m.content, "");
  }
  const slug = (t?.title || "chat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "chat";
  downloadFile(`offchat-${slug}.md`, lines.join("\n"), "text/markdown");
  toast("Chat exported as Markdown", "ok");
}

/** Launch URLs: app shortcuts (?new=1, ?pick=1) and shared content. */
function handleLaunchParams() {
  let q;
  try {
    q = new URLSearchParams(location.search);
  } catch {
    return;
  }
  if ([...q.keys()].length === 0) return;
  if (q.get("new") === "1") newChat();
  const shared = [q.get("title"), q.get("text"), q.get("url")].filter(Boolean).join("\n");
  if (shared) {
    newChat();
    const ta = $("#input");
    ta.value = shared.slice(0, 4000);
    autogrow();
    updateCharCount();
    $("#btn-send").classList.add("ready");
    toast("Shared content pasted — pick a model and press Send", "info", 5000);
  }
  if (q.get("pick") === "1") setTimeout(() => openModelPicker(), 800);
  try {
    history.replaceState(null, "", location.pathname);
  } catch { /* ignore */ }
}

function starsHTML(n) {
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function tagBadge(m) {
  if (m.tag === "code") return `<span class="badge code">💻 Code</span>`;
  if (m.tag === "reasoning") return `<span class="badge think">🧠 Thinks</span>`;
  return "";
}

function modelCardHTML(m, idx, { recommended = false, fits = true, active = false } = {}) {
  const dl = S.settings.downloaded[m.key];
  const needPct = S.rec ? Math.min(100, Math.round((m.vramMB * 1.12 / S.rec.budgetMB) * 100)) : 0;
  const tpsMax = Array.isArray(m.tps) ? m.tps[1] : 0;
  return `<div class="model-card ${recommended ? "recommended" : ""} ${active ? "active" : ""} ${!fits ? "dim" : ""}" data-key="${m.key}" data-idx="${idx}" data-size="${m.sizeMB}" data-tps="${tpsMax}" data-quality="${m.quality || 0}">
    <div class="model-top">
      <strong>${escapeHtml(m.name)}</strong>
      <span class="params">${escapeHtml(m.params)}</span>
      <span class="model-badges">
        ${recommended ? `<span class="badge rec">✨ Recommended</span>` : ""}
        ${active ? `<span class="badge ok">● Active</span>` : ""}
        ${dl ? `<span class="badge ok">📦 Offline</span>` : ""}
        ${tagBadge(m)}
        ${!fits ? `<span class="badge warnb">Too big for this device</span>` : ""}
      </span>
    </div>
    <div class="model-desc">${escapeHtml(m.blurb)}</div>
    <div class="model-meta">
      <span title="General answer quality">⭐ <span class="stars">${starsHTML(m.quality || 3)}</span></span>
      <span class="tps" title="Estimated generation speed (phones land near the low end, desktop GPUs near the high end)">⚡ ~${escapeHtml(formatTps(m))}</span>
      <span>⬇️ <b>${fmtSizeMB(m.sizeMB)}</b></span>
      ${m.estDl ? `<span class="badge-fast" title="Estimated download time on a standard connection">⏱️ ${escapeHtml(m.estDl)}</span>` : ""}
      <span>🧠 <b>${fmtBytes(m.vramMB)}</b></span>
      <span>📏 ${(m.ctx / 1024).toFixed(0)}k ctx</span>
      ${m.needsF16 ? `<span title="Needs shader-f16 (auto-switches to an f32 build when missing)">⚡F16</span>` : ""}
      ${m.stable === false ? `<span title="Experimental variant">🧪 exp</span>` : ""}
    </div>
    <div class="vram"><div class="bar"><i style="width:${needPct}%"></i></div><small>memory vs budget</small></div>
    <button class="btn ${recommended && !active ? "primary" : "ghost"} sm" data-load="${m.key}">
      <svg><use href="#${dl ? "i-bolt" : "i-download"}"/></svg>${dl ? "Run from cache" : "Download & run"}
    </button>
  </div>`;
}

/** Re-order model cards inside every grid (Recommended / Fastest / …). */
function applyModelSort(body, mode) {
  body.querySelectorAll(".model-grid").forEach((grid) => {
    const cards = [...grid.querySelectorAll(".model-card")];
    const val = (c, k) => Number(c.dataset[k] || 0);
    cards.sort((a, b) => {
      if (mode === "fastest") return val(b, "tps") - val(a, "tps");
      if (mode === "smallest") return val(a, "size") - val(b, "size");
      if (mode === "quality") return val(b, "quality") - val(a, "quality") || val(a, "size") - val(b, "size");
      return val(a, "idx") - val(b, "idx");
    });
    for (const c of cards) grid.appendChild(c);
  });
}

/** Confirm before loading a model that exceeds the memory budget. */
async function confirmOversizeLoad(m) {
  const fits = (S.rec?.ranked || []).find((r) => r.key === m.key)?.fits ?? true;
  if (fits) return true;
  return confirmDialog({
    title: "⚠️ This model may crash your device",
    text: `${m.name} needs ~${fmtBytes(m.vramMB)} but your safe budget is ~${fmtBytes(S.rec?.budgetMB || 0)}. ` +
      "Loading it can freeze or crash the page, especially on phones. Load it anyway?",
    okLabel: "Load anyway",
    danger: true,
  });
}

async function onPickModel(key, close) {
  const m = getModel(key);
  if (!m) return;
  if (!(await confirmOversizeLoad(m))) return;
  close?.();
  if (!S.activeId) newChat();
  loadModel(key).catch(() => {});
}

function catalogHTML(catalog) {
  const fitMap = new Map((S.rec?.ranked || []).map((r) => [r.key, r.fits]));
  const tiers = [...new Set(catalog.map((m) => m.tier))];
  let html = "";
  let idx = 0;
  for (const tier of tiers) {
    const t = TIERS[tier] || { label: tier, desc: "" };
    html += `<div class="tier-title">${escapeHtml(t.label)}<small>${escapeHtml(t.desc)}</small></div><div class="model-grid">`;
    for (const m of catalog.filter((x) => x.tier === tier)) {
      html += modelCardHTML(m, idx++, {
        recommended: S.rec?.recommended === m.key,
        fits: fitMap.get(m.key) ?? true,
        active: S.engineModelKey === m.key && S.engineLoaded,
      });
    }
    html += `</div>`;
  }
  return html;
}

function hwCardHTML() {
  if (!S.hw) {
    return `<div class="hw-card">⏳ Hardware probing is taking too long — pick a model manually (WASM variants are at the bottom of the list).</div>`;
  }
  const warns = (S.rec?.warnings || [])
    .map((w) => `<div class="warnline ${w.icon === "info" ? "info" : ""}"><svg><use href="#${w.icon === "info" ? "i-info" : "i-warn"}"/></svg><span>${escapeHtml(w.text)}</span></div>`)
    .join("");
  return `<div class="hw-card">
      <div class="hw-line"><svg><use href="#i-cpu"/></svg><span><strong>Your device:</strong> ${escapeHtml(deviceSummary(S.hw))}</span></div>
      <div class="hw-line"><svg><use href="#i-box"/></svg><span><strong>Memory budget for a model:</strong> ~${fmtBytes(S.rec?.budgetMB || 0)} (with a safety margin)</span></div>
    </div>${warns}`;
}

function openOnboarding() {
  if (S.settings.onboarded && S.model) return;
  const isWasm = S.hw && !S.hw.webgpu.supported;
  const catalog = isWasm ? WASM_CATALOG : MODEL_CATALOG;
  const { close, body } = openModal({
    title: "👋 Welcome to OffChat!",
    wide: true,
    dismissable: true,
    html: `<p class="muted">We checked your device and picked models that will <strong>fit it safely</strong>.
      ${isWasm ? "No WebGPU — here are light CPU (WASM) models." : "Pick one — it downloads once, then works offline."}</p>
      ${hwCardHTML()}${catalogHTML(catalog)}`,
  });
  body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-load]");
    if (!btn) return;
    onPickModel(btn.dataset.load, close);
  });
}

function openModelPicker() {
  const web = !S.hw || S.hw.webgpu.supported;
  const fitMap = new Map((S.rec?.ranked || []).map((r) => [r.key, r.fits]));
  const wasmCards = WASM_CATALOG.map((m, i) =>
    modelCardHTML(m, 1000 + i, {
      fits: web ? true : (fitMap.get(m.key) ?? true),
      active: S.engineModelKey === m.key && S.engineLoaded,
      recommended: !web && S.rec?.recommended === m.key,
    })
  ).join("");
  const { close, body } = openModal({
    title: "🤖 Pick an AI model",
    wide: true,
    html: `${hwCardHTML()}
      <div class="model-toolbar">
        <div class="filter-pills" id="model-filters">
          <button class="filter-pill active" data-filter="all">All</button>
          <button class="filter-pill" data-filter="fast">⚡ Instant (&lt; 500 MB)</button>
          <button class="filter-pill" data-filter="mid">⚖️ Balanced (0.5 – 2 GB)</button>
          <button class="filter-pill" data-filter="max">💎 Desktop (&gt; 2 GB)</button>
        </div>
        <label class="sort-wrap">Sort:
          <select id="model-sort">
            <option value="recommended">Recommended</option>
            <option value="fastest">Fastest first</option>
            <option value="smallest">Smallest first</option>
            <option value="quality">Best quality</option>
          </select>
        </label>
      </div>
      ${web ? catalogHTML(MODEL_CATALOG) : `<p class="muted">No WebGPU — CPU models available:</p>` + catalogHTML(WASM_CATALOG)}
      ${web ? `<div class="tier-title">Compatibility mode<small>If WebGPU misbehaves — slower CPU (WASM) models</small></div><div class="model-grid">${wasmCards}</div>` : ""}
      <div class="row end gap">
        ${S.engineLoaded ? `<button class="btn ghost sm" id="m-unload">Unload model from memory</button>` : ""}
        <button class="btn ghost sm" id="m-close">Close</button>
      </div>`,
  });

  // Weak device? Offer the one-click Potato profile right when it matters.
  if (!S.settings.potatoAsked) setTimeout(() => maybeSuggestPotato(), 600);

  const filterPills = body.querySelectorAll(".filter-pill");
  filterPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      filterPills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      const filter = pill.dataset.filter;
      const cards = body.querySelectorAll(".model-card");
      cards.forEach((card) => {
        const size = Number(card.dataset.size || 0);
        let show = true;
        if (filter === "fast") show = size < 500;
        else if (filter === "mid") show = size >= 500 && size <= 2000;
        else if (filter === "max") show = size > 2000;
        card.style.display = show ? "" : "none";
      });
      body.querySelectorAll(".tier-title").forEach((title) => {
        const grid = title.nextElementSibling;
        if (grid && grid.classList.contains("model-grid")) {
          const hasVisible = [...grid.querySelectorAll(".model-card")].some((c) => c.style.display !== "none");
          title.style.display = hasVisible ? "" : "none";
          grid.style.display = hasVisible ? "" : "none";
        }
      });
    });
  });

  body.querySelector("#model-sort")?.addEventListener("change", (e) => {
    applyModelSort(body, e.target.value);
  });

  body.querySelector("#m-close").addEventListener("click", close);
  body.querySelector("#m-unload")?.addEventListener("click", async () => {
    await S.proxy.unload().catch(() => {});
    S.engineLoaded = false;
    S.engineModelKey = null;
    setStatus("idle", "model unloaded");
    toast("Model released from memory", "ok");
    touchActivity();
    close();
  });
  body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-load]");
    if (!btn || btn.id === "m-close" || btn.id === "m-unload") return;
    onPickModel(btn.dataset.load, close);
  });
}

// ── Settings ──────────────────────────────────────────────────
function segHTML(id, options, current) {
  return `<div class="seg wrap" id="${id}">` + options.map(([v, label]) =>
    `<button data-v="${v}" class="${current === v ? "on" : ""}">${label}</button>`
  ).join("") + `</div>`;
}

function openSettings() {
  const s = S.settings;
  const accentBtns = Object.entries(ACCENTS).map(([key, a]) =>
    `<button class="swatch ${s.accent === key ? "on" : ""}" data-v="${key}" title="${a.label}" aria-label="${a.label} accent" style="--sw:${a.swatch}"></button>`
  ).join("");
  const { close, body } = openModal({
    title: "⚙️ Settings",
    html: `
    <div class="set-section">Appearance</div>
    ${segHTML("seg-theme", [["auto", "🌓 Auto"], ["light", "☀️ Light"], ["dark", "🌙 Dark"]], s.theme)}
    <div class="field"><span class="flabel">Accent color</span>
      <div class="swatches" id="sw-accents">${accentBtns}</div></div>
    <div class="field"><span class="flabel">Background</span>
      ${segHTML("seg-bg", [["aurora", "🌌 Aurora"], ["tide", "🌊 Tide"], ["solid", "⬛ Solid"]], s.bgStyle)}</div>
    <div class="switch-row"><span>Glass effect (blur)<small>Turn off on very weak devices — blur is heavy for GPUs</small></span>
      <label class="switch"><input type="checkbox" id="sw-glass" ${s.glass ? "checked" : ""}><i></i></label></div>
    <div class="switch-row"><span>Animations<small>Turn off on very weak devices</small></span>
      <label class="switch"><input type="checkbox" id="sw-anim" ${s.animations ? "checked" : ""}><i></i></label></div>

    <div class="set-section">Chat look</div>
    <div class="field"><label>Message font size <output id="o-font">${s.fontSize}px</output></label>
      <input type="range" id="r-font" min="13" max="18" step="1" value="${s.fontSize}"></div>
    <div class="field"><span class="flabel">Bubble shape</span>
      ${segHTML("seg-bubbles", [["soft", "Soft"], ["round", "Round"], ["sharp", "Sharp"]], s.bubbleStyle)}</div>
    <div class="switch-row"><span>Message avatars<small>Show icons next to messages</small></span>
      <label class="switch"><input type="checkbox" id="sw-avatars" ${s.avatars ? "checked" : ""}><i></i></label></div>

    <div class="set-section">Safety (weak GPUs)</div>
    <div class="field"><span class="flabel">Safe Mode ${S.safeActive ? '<span class="badge ok">● active</span>' : ""}</span>
      ${segHTML("seg-safe", [["auto", "🤖 Auto"], ["on", "🛡️ On"], ["off", "⚡ Off"]], s.safeMode)}
      <small class="hint">Simplifies visuals, caps memory and warns before risky models. Recommended for weak phones.</small></div>
    <div class="field"><label>Context window</label>
      <select id="sel-ctx">
        <option value="auto" ${s.ctxCap === "auto" ? "selected" : ""}>Auto (recommended)</option>
        <option value="1024" ${s.ctxCap === "1024" ? "selected" : ""}>1024 tokens (safest)</option>
        <option value="2048" ${s.ctxCap === "2048" ? "selected" : ""}>2048 tokens</option>
        <option value="4096" ${s.ctxCap === "4096" ? "selected" : ""}>4096 tokens</option>
        <option value="full" ${s.ctxCap === "full" ? "selected" : ""}>Full (model default)</option>
      </select>
      <small class="hint">Smaller context = less GPU memory = fewer crashes. Applies when a model loads.</small></div>

    <div class="set-section">Slow devices</div>
    <div class="switch-row"><span>🐢 Potato mode<small>One click for very old phones: smallest model, tiny context, no blur, no animations, quick memory release.</small></span>
      <label class="switch"><input type="checkbox" id="sw-potato" ${s.potato ? "checked" : ""}><i></i></label></div>
    <div class="row end"><button class="btn ghost sm" id="btn-potato">Apply the potato profile now</button></div>

    <div class="set-section">Generation</div>
    <div class="field"><label>Temperature (creativity) <output id="o-temp">${s.temperature.toFixed(2)}</output></label>
      <input type="range" id="r-temp" min="0" max="1.5" step="0.05" value="${s.temperature}"></div>
    <div class="field"><label>Top-P <output id="o-topp">${s.topP.toFixed(2)}</output></label>
      <input type="range" id="r-topp" min="0.1" max="1" step="0.05" value="${s.topP}"></div>
    <div class="field"><label>Max answer length <output id="o-max">${s.maxTokens} tok</output></label>
      <input type="range" id="r-max" min="64" max="2048" step="64" value="${s.maxTokens}"></div>
    <div class="field"><label>System prompt (AI personality)</label>
      <textarea id="t-sys" maxlength="2000">${escapeHtml(s.systemPrompt)}</textarea></div>
    <div class="row end"><button class="btn ghost sm" id="btn-sys-reset">Restore default prompt</button></div>
    <div class="switch-row"><span>Enter sends the message<small>Off: Enter makes a new line</small></span>
      <label class="switch"><input type="checkbox" id="sw-enter" ${s.sendOnEnter ? "checked" : ""}><i></i></label></div>

    <div class="set-section">Memory & offline</div>
    <div class="field"><label>Release the model from memory when idle</label>
      <select id="sel-idle">
        <option value="auto" ${s.idleUnload === "auto" ? "selected" : ""}>Auto (recommended)</option>
        <option value="5" ${s.idleUnload === "5" ? "selected" : ""}>After 5 minutes</option>
        <option value="15" ${s.idleUnload === "15" ? "selected" : ""}>After 15 minutes</option>
        <option value="60" ${s.idleUnload === "60" ? "selected" : ""}>After 1 hour</option>
        <option value="off" ${s.idleUnload === "off" ? "selected" : ""}>Never</option>
      </select>
      <small class="hint">Freeing the model is the best protection against out-of-memory crashes on weak devices.
        Auto = ${Math.round(IDLE_UNLOAD_MS.autoWeak / 60000)} min on phones, ${Math.round(IDLE_UNLOAD_MS.autoStrong / 60000)} min on computers.
        Loading again from the local cache takes only a few seconds. Applies immediately.</small></div>
    <div class="field"><label>Model weight storage</label>
      <select id="sel-cache">
        <option value="cache" ${s.cacheBackend === "cache" ? "selected" : ""}>Cache API (recommended, stable)</option>
        <option value="opfs" ${s.cacheBackend === "opfs" ? "selected" : ""}>OPFS (experimental)</option>
      </select></div>
    <div class="storage"><div class="bar"><i id="set-storage-bar"></i></div><small id="set-storage-text">…</small></div>
    <div class="row gap"><button class="btn ghost sm grow" id="btn-clear-cache">🗑️ Clear model cache</button></div>

    <div class="set-section">Danger zone</div>
    <div class="danger-zone">
      <div class="row gap">
        <button class="btn danger sm grow" id="btn-wipe-chats">Delete all chats</button>
      </div>
      <small class="hint">Removes chat history from this device. Model weights are untouched.</small>
    </div>

    <div class="set-section">About</div>
    <p class="hint">OffChat v${APP_VERSION} · engines: WebLLM (WebGPU) + Transformers.js (WASM) ·
    100% client-side, zero telemetry. Model weights: Hugging Face (local cache).</p>
    <p class="hint">Device profile: <strong>${S.perf}</strong>${S.hw ? ` · ${escapeHtml(deviceSummary(S.hw))}` : ""}
    ${S.safeActive ? "· Safe Mode active" : ""}</p>`,
  });

  const bindSeg = (id, key, after) => {
    const seg = body.querySelector(`#${id}`);
    if (!seg) return;
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      seg.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      S.settings = saveSettings({ [key]: b.dataset.v });
      after?.();
    });
  };
  bindSeg("seg-theme", "theme", applyTheme);
  bindSeg("seg-bg", "bgStyle", applyAppearance);
  bindSeg("seg-bubbles", "bubbleStyle", applyAppearance);
  bindSeg("seg-safe", "safeMode", () => {
    applySafeMode();
    toast(
      S.safeActive ? "Safe Mode is on — visuals simplified 🛡️" : "Safe Mode is off",
      "info"
    );
  });
  const swAcc = body.querySelector("#sw-accents");
  swAcc?.addEventListener("click", (e) => {
    const b = e.target.closest(".swatch");
    if (!b) return;
    swAcc.querySelectorAll(".swatch").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    S.settings = saveSettings({ accent: b.dataset.v });
    applyAppearance();
  });

  const bindRange = (id, out, fmt, key, after) => {
    const r = body.querySelector(id);
    if (!r) return;
    r.addEventListener("input", () => {
      body.querySelector(out).textContent = fmt(Number(r.value));
      S.settings = saveSettings({ [key]: Number(r.value) });
      after?.();
    });
  };
  bindRange("#r-temp", "#o-temp", (v) => v.toFixed(2), "temperature");
  bindRange("#r-topp", "#o-topp", (v) => v.toFixed(2), "topP");
  bindRange("#r-max", "#o-max", (v) => `${v} tok`, "maxTokens");
  bindRange("#r-font", "#o-font", (v) => `${v}px`, "fontSize", applyAppearance);
  body.querySelector("#t-sys").addEventListener("change", (e) => {
    S.settings = saveSettings({ systemPrompt: e.target.value.slice(0, 2000) || DEFAULT_SETTINGS.systemPrompt });
    toast("System prompt saved", "ok");
  });
  body.querySelector("#btn-sys-reset").addEventListener("click", () => {
    body.querySelector("#t-sys").value = DEFAULT_SETTINGS.systemPrompt;
    S.settings = saveSettings({ systemPrompt: DEFAULT_SETTINGS.systemPrompt });
    toast("Default prompt restored", "ok");
  });
  body.querySelector("#sw-anim").addEventListener("change", (e) => {
    S.settings = saveSettings({ animations: e.target.checked });
    applyAnims();
  });
  body.querySelector("#sw-glass").addEventListener("change", (e) => {
    S.settings = saveSettings({ glass: e.target.checked });
    applyAppearance();
  });
  body.querySelector("#sw-avatars").addEventListener("change", (e) => {
    S.settings = saveSettings({ avatars: e.target.checked });
    applyAppearance();
  });
  body.querySelector("#sw-potato").addEventListener("change", (e) => {
    if (e.target.checked) {
      applyPotatoMode();
      toast("Potato mode on 🐢 — smallest model, tiny context, no effects", "ok", 6000);
    } else {
      S.settings = saveSettings({ potato: false });
      toast("Potato mode off — full quality restored", "info");
    }
  });
  body.querySelector("#btn-potato").addEventListener("click", () => {
    applyPotatoMode();
    body.querySelector("#sw-potato").checked = true;
    toast("Potato profile applied 🐢", "ok", 5000);
  });
  body.querySelector("#sw-enter").addEventListener("change", (e) => {
    S.settings = saveSettings({ sendOnEnter: e.target.checked });
  });
  body.querySelector("#sel-idle").addEventListener("change", (e) => {
    S.settings = saveSettings({ idleUnload: e.target.value });
    S.idleWatcher?.refresh();
    toast(e.target.value === "off"
      ? "The model will stay in memory"
      : "Idle release updated — the model loads again on demand", "info");
  });
  body.querySelector("#sel-ctx").addEventListener("change", (e) => {
    S.settings = saveSettings({ ctxCap: e.target.value });
    toast("The new context size applies when a model loads", "info");
  });
  body.querySelector("#sel-cache").addEventListener("change", (e) => {
    S.settings = saveSettings({ cacheBackend: e.target.value });
    toast("The new storage applies to the next model download", "info");
  });
  body.querySelector("#btn-clear-cache").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Clear the model cache?",
      text: "This removes downloaded weights (hundreds of MB). The model will download again on next launch.",
      okLabel: "Clear",
    });
    if (!ok) return;
    const n = await clearModelCaches();
    S.settings = saveSettings({ downloaded: {} });
    toast(`Cleared ${n} model stores`, "ok");
    refreshStorageBar();
    paintSettingsStorage(body);
  });
  body.querySelector("#btn-wipe-chats").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Delete ALL chats?",
      text: "This cannot be undone. Consider Export first.",
      okLabel: "Delete everything",
    });
    if (!ok) return;
    await Threads.clearAll();
    S.msgCache.clear();
    S.activeId = null;
    $("#messages").innerHTML = "";
    updateWelcome();
    await refreshThreads();
    toast("All chats deleted", "ok");
    close();
  });
  paintSettingsStorage(body);
}

async function paintSettingsStorage(body) {
  try {
    const info = await storageInfo();
    const pct = info.quotaMB ? Math.min(100, Math.round((info.usageMB / info.quotaMB) * 100)) : 0;
    const bar = body.querySelector("#set-storage-bar");
    const txt = body.querySelector("#set-storage-text");
    if (bar) bar.style.width = `${pct}%`;
    if (txt) {
      txt.textContent = `Used: ${fmtBytes(info.usageMB)} of ${fmtBytes(info.quotaMB)} · caches: ${info.caches.length}`;
    }
  } catch { /* ignore */ }
}

async function refreshStorageBar() {
  try {
    const info = await storageInfo();
    const pct = info.quotaMB ? Math.min(100, Math.round((info.usageMB / info.quotaMB) * 100)) : 0;
    $("#storage-bar").style.width = `${pct}%`;
    $("#storage-text").textContent = `Storage: ${fmtBytes(info.usageMB)} / ${fmtBytes(info.quotaMB)}`;
  } catch {
    $("#storage-text").textContent = "Storage: unavailable";
  }
}

// ── Export / import ───────────────────────────────────────────
async function onExport() {
  try {
    const bundle = await exportAll(S.settings);
    downloadFile(
      `offchat-export-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(bundle),
      "application/json"
    );
    toast(`Exported ${bundle.threads.length} chats`, "ok");
  } catch (e) {
    toast("Export failed: " + e.message, "error");
  }
}

async function onImportFile(e) {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return;
  try {
    const bundle = JSON.parse(await f.text());
    const n = await importAll(bundle);
    S.msgCache.clear();
    await refreshThreads(true);
    toast(`Imported ${n} chats`, "ok");
  } catch {
    toast("Invalid export file", "error");
  }
}

// ── PWA / SW ──────────────────────────────────────────────────
async function installPWA() {
  if (!S.installEvt) {
    toast("Installation is not available in this browser", "warn");
    return;
  }
  S.installEvt.prompt();
  await S.installEvt.userChoice.catch(() => {});
  S.installEvt = null;
  $("#btn-install").hidden = true;
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  // Service Worker needs http(s) — on file:// just skip it.
  if (!/^https?:$/.test(location.protocol)) return;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) {
          toast("A new OffChat version is available — reload the page ✨", "info", 6000);
        }
      });
    });
  } catch (e) {
    console.warn("SW unavailable:", e);
  }
}
