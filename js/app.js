// ─────────────────────────────────────────────────────────────
// OffChat · app.js — app orchestration: boot, onboarding,
// chat, threads, settings, statuses, PWA.
// ─────────────────────────────────────────────────────────────
import {
  APP_VERSION, MODEL_CATALOG, WASM_CATALOG, getModel, formatTps,
  DEFAULT_SETTINGS, LIMITS, TIERS, ACCENTS, BG_STYLES, BUBBLE_STYLES,
} from "./config.js";
import {
  probeHardware, recommendModels, suggestContextWindow, deviceSummary,
  isWeakDevice,
} from "./hardware.js";
import {
  loadSettings, saveSettings, Threads, Messages,
  exportAll, importAll, storageInfo, clearModelCaches,
} from "./storage.js";
import { EngineProxy } from "./engine-proxy.js";
import { DownloadHub } from "./download-hub.js";
import { renderMarkdown, estimateTokens } from "./markdown.js";
import {
  $, $all, el, toast, openModal, confirmDialog,
  fmtBytes, fmtSizeMB, timeAgo, autoTitle, copyText, downloadFile, escapeHtml,
} from "./ui.js";

let downloadHub = null;

const S = {
  settings: loadSettings(),
  hw: null,
  rec: null,
  threads: [],
  activeId: null,
  proxy: new EngineProxy(),
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
};

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

  // Download Hub init (telemetry, games, facts, dock)
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
          autogrow();
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
  S.downloadHub = downloadHub;
  downloadHub.setLowFx(S.safeActive);

  // Request persistent storage
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  bindUI();
  setStatus("idle", "preparing…");
  updateModelChip();
  updateOnlineUI();
  await refreshThreads();

  // Restore the last thread
  const lastId = S.settings.lastThreadId;
  if (lastId && S.threads.some((t) => t.id === lastId)) {
    await openThread(lastId, { silent: true });
  }

  // Hardware probe in the background (never blocks the UI)
  setStatus("scan");
  probeHardware()
    .then((hw) => {
      S.hw = hw;
      S.rec = recommendModels(hw, MODEL_CATALOG, WASM_CATALOG);
      applySafeMode();
      if (S.safeActive && S.settings.safeMode === "auto") {
        toast("Safe Mode enabled for your device — visuals simplified to protect the GPU 🛡️", "info", 5000);
      }
      $("#hw-hint").textContent =
        `${deviceSummary(hw)} · budget ~${fmtBytes(S.rec.budgetMB)} · recommended: ${getModel(S.rec.recommended)?.name || "—"}`;
      if (!S.model) setStatus("idle", "pick a model");
    })
    .catch(() => {
      $("#hw-hint").textContent = "Could not probe the hardware — please pick a model manually.";
      setStatus("idle");
    });

  // Restore the previously selected model (but never auto-download!)
  const savedKey = S.settings.modelKey;
  if (savedKey && getModel(savedKey)) {
    S.model = getModel(savedKey);
    updateModelChip();
    const wasDownloaded = !!S.settings.downloaded[savedKey];
    if (wasDownloaded) {
      // Model is cached → try loading automatically (fast, works offline).
      loadModel(savedKey, { auto: true }).catch(() => {});
    } else {
      setStatus("idle", S.model.name);
    }
  } else if (!S.settings.onboarded) {
    // First launch → onboarding once the hardware is known.
    const waitHw = setInterval(() => {
      if (S.hw) {
        clearInterval(waitHw);
        openOnboarding();
      }
    }, 250);
    setTimeout(() => clearInterval(waitHw), 8000);
    setTimeout(() => {
      if (!S.hw && !S.settings.onboarded) openOnboarding();
    }, 8200);
  }

  handleLaunchParams();
  registerSW();
  refreshStorageBar().catch(() => {});
}

function bindUI() {
  $("#btn-send").addEventListener("click", () => onSend());
  $("#btn-stop").addEventListener("click", stopGeneration);
  const input = $("#input");
  input.addEventListener("input", () => {
    autogrow();
    updateCharCount();
    // Glow the send button while there is something to send.
    $("#btn-send").classList.toggle("ready", input.value.trim().length > 0);
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

  // The OS drops the wake lock when hidden — take it back on return.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (S.downloading || S.generating)) {
      holdWakeLock(true);
    }
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

function autogrow() {
  const ta = $("#input");
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
  updateCharCount();
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

async function refreshThreads() {
  S.threads = await Threads.list().catch(() => []);
  renderThreadList();
}

function renderThreadList() {
  const list = $("#thread-list");
  list.innerHTML = "";
  const items = S.threads
    .filter((t) => !S.threadFilter || t.title.toLowerCase().includes(S.threadFilter))
    .sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
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

async function renderThread(resetWindow) {
  const box = $("#messages");
  box.innerHTML = "";
  if (!S.activeId) {
    $("#load-more-wrap").hidden = true;
    updateWelcome();
    return;
  }
  const all = await Messages.list(S.activeId, 1000);
  const total = all.length;
  const windowSize = resetWindow ? renderWindowSize() : total;
  const slice = all.slice(-windowSize);
  $("#load-more-wrap").hidden = total <= slice.length;
  for (const m of slice) {
    const html = m.role === "user"
      ? escapeHtml(m.content).replace(/\n/g, "<br>")
      : renderMarkdown(m.content);
    const node = msgNode(m.role, html, statsLine(m.stats), { ts: m.ts, cutOff: !!m.stats?.cutOff });
    node.dataset.mid = m.id;
    node.dataset.raw = m.content;
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
  const btn = e.target.closest(".msg-foot button");
  if (!btn) return;
  const msgEl = e.target.closest(".msg");
  const raw = msgEl?.dataset.raw || msgEl?.querySelector(".content")?.textContent || "";
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
  const ta = $("#input");
  if (ta) {
    ta.value = "";
    autogrow();
  }

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

  ta.value = "";
  autogrow();
  $("#btn-send").classList.remove("ready");

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
  const box = $("#messages");
  const uNode = msgNode("user", escapeHtml(text).replace(/\n/g, "<br>"), "", { ts: userMsg.ts });
  uNode.dataset.mid = userMsg.id;
  uNode.dataset.raw = text;
  box.appendChild(uNode);
  updateWelcome();
  scrollBottom(true);

  await generateReply();
}

function historyForChat(allMessages, ctxTokens) {
  const sys = { role: "system", content: S.settings.systemPrompt };
  const budget = Math.max(512, ctxTokens - S.settings.maxTokens - 128);
  const picked = [];
  let used = estimateTokens(sys.content);
  for (let i = allMessages.length - 1; i >= 0; i--) {
    const m = allMessages[i];
    if (m.role !== "user" && m.role !== "assistant") continue;
    const cost = estimateTokens(m.content) + 8;
    if (used + cost > budget && picked.length > 0) break;
    used += cost;
    picked.unshift({ role: m.role, content: m.content });
  }
  return [sys, ...picked];
}

async function generateReply(opts = {}) {
  const box = $("#messages");
  const cont = opts.continuationOf || null; // { mid, baseText, node } — append into an existing bubble
  S.generating = true;
  S.streamText = cont?.baseText || "";
  $("#btn-send").disabled = true;
  $("#btn-stop").hidden = false;
  $("#progress-line").hidden = false;
  // Pause background animation while the GPU is busy with inference.
  document.body.classList.add("generating");
  holdWakeLock(true);

  // Streaming bubble (fresh, or the existing one when continuing)
  let node = cont?.node || null;
  if (!node || !node.isConnected) {
    node = msgNode("assistant", `<span class="typing"><i></i><i></i><i></i></span>`, "");
    box.appendChild(node);
  }
  const content = node.querySelector(".content");
  node.querySelector('[data-act="continue"]')?.remove();
  scrollBottom(true);

  let renderedAt = 0;
  const paint = (final = false) => {
    const now = performance.now();
    if (!final && now - renderedAt < 90) return;
    renderedAt = now;
    content.innerHTML = S.streamText
      ? renderMarkdown(S.streamText) + (final ? "" : `<span class="caret"></span>`)
      : `<span class="typing"><i></i><i></i><i></i></span>`;
    if (S.nearBottom) box.scrollTop = box.scrollHeight;
  };

  paint(true); // with continuation, show the base text immediately

  try {
    const all = await Messages.list(S.activeId, 1000);
    const ctx = S.model.ctx || 4096;
    const history = historyForChat(all, ctx);
    if (cont) {
      // Invisible nudge — sent, but never saved, so the history stays clean.
      history.push({ role: "user", content: "Continue from exactly where you stopped. Do not repeat what you already wrote." });
    }
    updateCtxInfo(all);
    setStatus("generating", S.model.name);

    const t0 = performance.now();
    const res = await S.proxy.chat(history, {
      temperature: S.settings.temperature,
      maxTokens: S.settings.maxTokens,
      topP: S.settings.topP,
      onToken: (delta) => {
        S.streamText += delta;
        // live counter
        const secs = (performance.now() - t0) / 1000;
        const toks = Math.ceil(S.streamText.length / 4);
        $("#gen-stats").textContent = `${toks} tok · ${(toks / Math.max(secs, 0.1)).toFixed(1)} tok/s`;
        paint(false);
      },
    });
    S.streamText = cont
      ? cont.baseText + (res.text || S.streamText.slice(cont.baseText.length))
      : (res.text || S.streamText);
    paint(true);

    // Cut off at the token limit? (exact signal on WebLLM, estimate on WASM)
    const legTokens = res.completionTokens || Math.ceil((res.text || "").length / 4);
    const cutOff = !res.aborted && (res.finishReason === "length" || legTokens >= S.settings.maxTokens - 1);
    const stats = {
      tokPerSec: res.tokPerSec || null,
      completionTokens: cont ? Math.ceil(S.streamText.length / 4) : legTokens,
      ttftMs: res.ttftMs || null,
      cutOff,
    };
    let mid;
    if (cont) {
      await Messages.update(cont.mid, { content: S.streamText, stats });
      mid = cont.mid;
    } else {
      const saved = await Messages.add(S.activeId, {
        role: "assistant", content: S.streamText, stats,
      });
      mid = saved.id;
    }
    // Swap in a finished bubble: timestamp, stats, and a Continue button when cut off.
    const finalNode = msgNode("assistant", content.innerHTML, statsLine(stats), { ts: Date.now(), cutOff });
    finalNode.dataset.mid = mid;
    finalNode.dataset.raw = S.streamText;
    node.replaceWith(finalNode);
    node = finalNode;
    $("#gen-stats").textContent = res.aborted
      ? `Stopped · ${statsLine(stats)}`
      : cutOff
        ? `Cut off at the token limit — press Continue below`
        : `Done in ${((performance.now() - t0) / 1000).toFixed(1)}s · ${statsLine(stats)}`;

    const fresh = await Messages.list(S.activeId, 1000);
    updateCtxInfo(fresh);
    await refreshThreads();
    setStatus("ready", S.model.name + (navigator.onLine ? "" : " · offline"));
  } catch (e) {
    console.error(e);
    content.innerHTML = `<p>⚠️ <strong>Could not generate an answer.</strong></p><p class="muted">${escapeHtml(friendlyError(e))}</p>`;
    setStatus("error", "generation failed");
    toast(friendlyError(e), "error", 5000);
    if (isGpuError(e)) {
      offerGpuRecovery();
    } else {
      setTimeout(() => {
        if (S.engineLoaded) setStatus("ready", S.model?.name || "");
      }, 4000);
    }
  } finally {
    S.generating = false;
    holdWakeLock(false);
    document.body.classList.remove("generating");
    $("#btn-send").disabled = false;
    $("#btn-stop").hidden = true;
    $("#progress-line").hidden = true;
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
  await renderThread(false);
  await generateReply();
}

async function continueReply(mid) {
  if (S.generating || !S.activeId) return;
  if (!(await ensureEngine())) return;
  const node = mid && $("#messages").querySelector(`.msg[data-mid="${mid}"]`);
  const baseText = node?.dataset.raw;
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

function friendlyError(e) {
  const m = String(e?.message || e || "");
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
    return "Network trouble — the model or the engine library could not be downloaded. Check your connection (or blocking extensions) and retry.";
  }
  if (/MODEL_NOT_FOUND/i.test(m)) return m.replace("MODEL_NOT_FOUND: ", "");
  if (/engine is not loaded/i.test(m)) {
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
async function ensureEngine() {
  if (S.engineLoaded) return true;
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
    downloadHub?.expand();
    return;
  }
  if (!S.hw) {
    try { S.hw = await probeHardware(); } catch { /* continue with the fallback */ }
  }
  const hw = S.hw || { mobile: true, ramGB: 4, webgpu: { supported: true, f16: false }, cores: 4 };

  // Mobile-data warning (only for fresh, large downloads)
  if (!auto && hw.connection?.saveData && !S.settings.downloaded[key] && model.sizeMB > 500) {
    toast("Data-saver mode is on: downloading a large model…", "warn", 5000);
  }

  // Ask for persistent storage
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  S.downloading = true;
  holdWakeLock(true);
  S.model = model;
  S.settings = saveSettings({ modelKey: key });
  updateModelChip();

  downloadHub?.start(model, { auto });

  const onProgress = (p) => {
    downloadHub?.updateProgress(p);
    const percent = Math.round((p.progress || 0) * 100);
    if (p.phase === "download") setStatus("download", `${model.name} · ${percent}%`);
    else if (p.phase === "load") setStatus("load", model.name);
  };

  try {
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
      const threads = hw.crossIsolated ? Math.min(hw.cores || 4, 4) : 1;
      await S.proxy.loadTransformers({
        modelId: model.modelId,
        dtypes: model.dtypes || ["q4f16", "q4", "q8"],
        device: "wasm",
        threads,
        onProgress,
      });
    }
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
    setStatus("error", "loading failed");
    toast(friendlyError(e), "error", 6000);
    if (isGpuError(e)) {
      // Give the hub a moment to close before showing recovery.
      setTimeout(() => offerGpuRecovery(), 350);
    }
    throw e;
  } finally {
    S.downloading = false;
    holdWakeLock(false);
    downloadHub?.finish();
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
  const all = await Messages.list(S.activeId, 1000).catch(() => []);
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
    100% client-side, zero telemetry. Model weights: Hugging Face (local cache).</p>`,
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
  body.querySelector("#sw-enter").addEventListener("change", (e) => {
    S.settings = saveSettings({ sendOnEnter: e.target.checked });
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
    await refreshThreads();
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
