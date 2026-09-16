// ─────────────────────────────────────────────────────────────
// OffChat · app.js — orkiestracja aplikacji: boot, onboarding,
// czat, wątki, ustawienia, statusy, PWA.
// ─────────────────────────────────────────────────────────────
import {
  APP_VERSION, MODEL_CATALOG, WASM_CATALOG, getModel,
  DEFAULT_SETTINGS, SUGGESTED_PROMPTS, LIMITS, TIERS,
} from "./config.js";
import {
  probeHardware, recommendModels, suggestContextWindow, deviceSummary,
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
  fmtBytes, fmtSizeMB, timeAgoPL, autoTitle, copyText, downloadFile, escapeHtml,
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
  idle: "Oczekiwanie",
  scan: "Wykrywanie sprzętu…",
  download: "Pobieranie modelu",
  load: "Ładowanie do pamięci…",
  ready: "Gotowy do rozmowy",
  generating: "Generowanie…",
  error: "Błąd",
};

// ── Motyw / animacje ──────────────────────────────────────────
function applyTheme() {
  const t = S.settings.theme || "auto";
  document.body.dataset.theme = t;
  if (t === "auto") {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    document.body.dataset.theme = dark ? "dark" : "light";
  }
}

function applyAnims() {
  document.body.classList.toggle("no-anim", !S.settings.animations);
}

// ── Status ────────────────────────────────────────────────────
function setStatus(state, sub = "") {
  const pill = $("#status-pill");
  pill.dataset.state = state;
  $("#status-text").textContent = STATUS_META[state] || state;
  $("#status-sub").textContent = sub;
}

function updateModelChip() {
  const name = S.model ? S.model.name : "Wybierz model";
  $("#model-chip-name").textContent = name;
  $("#model-cta").innerHTML = S.model
    ? `<svg><use href="#i-chat"/></svg>Kontynuuj z ${escapeHtml(S.model.name)}`
    : `<svg><use href="#i-spark"/></svg>Wybierz model i zacznij`;
}

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  applyTheme();
  applyAnims();
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (S.settings.theme === "auto") applyTheme();
  });

  // Inicjalizacja Centrum Pobierania (Telemetria, gry, ciekawostki, dock)
  downloadHub = new DownloadHub({
    onMinimize: () => {
      toast("Pobieranie trwa w tle (widżet na dole) — możesz swobodnie przeglądać czat i ustawienia! 🔍", "info", 4500);
    },
    onExpand: () => {},
    onAbort: () => {
      S.proxy.abort();
      S.downloading = false;
      // Odkolejkuj pytanie: usuń znacznik "⏳" i wróć tekst do pola
      // wiadomości, żeby użytkownik mógł łatwo wysłać go ponownie.
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
      setStatus("idle", "pobieranie anulowane");
      toast("Pobieranie przerwane — pytanie wróciło do pola, wyślij je ponownie", "warn", 5000);
    },
    onUsePrompt: (promptText) => {
      const ta = $("#input");
      if (ta) {
        ta.value = promptText;
        autogrow();
        ta.focus();
        toast("Wklejono prompt do czatu! ✨", "ok");
      }
    },
    onQueuePrompt: (promptText) => {
      queuePrompt(promptText);
    },
  });
  S.downloadHub = downloadHub;

  // Żądanie trwałego przechowywania (persistent storage)
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  bindUI();
  renderSuggestions();
  setStatus("idle", "przygotowanie…");
  updateModelChip();
  updateOnlineUI();
  await refreshThreads();

  // Przywróć ostatni wątek
  const lastId = S.settings.lastThreadId;
  if (lastId && S.threads.some((t) => t.id === lastId)) {
    await openThread(lastId, { silent: true });
  }

  // Sonda sprzętowa w tle (nie blokuje UI)
  setStatus("scan");
  probeHardware()
    .then((hw) => {
      S.hw = hw;
      S.rec = recommendModels(hw, MODEL_CATALOG, WASM_CATALOG);
      $("#hw-hint").textContent =
        `${deviceSummary(hw)} · budżet ~${fmtBytes(S.rec.budgetMB)} · polecany: ${getModel(S.rec.recommended)?.name || "—"}`;
      if (!S.model) setStatus("idle", "wybierz model");
    })
    .catch(() => {
      $("#hw-hint").textContent = "Nie udało się zbadać sprzętu — wybierz model ręcznie.";
      setStatus("idle");
    });

  // Przywróć wybrany wcześniej model (bez auto-pobierania!)
  const savedKey = S.settings.modelKey;
  if (savedKey && getModel(savedKey)) {
    S.model = getModel(savedKey);
    updateModelChip();
    const wasDownloaded = !!S.settings.downloaded[savedKey];
    if (wasDownloaded) {
      // Model w cache → spróbuj załadować automatycznie (szybko, offline OK).
      loadModel(savedKey, { auto: true }).catch(() => {});
    } else {
      setStatus("idle", S.model.name);
    }
  } else if (!S.settings.onboarded) {
    // Pierwsze uruchomienie → onboarding po wykryciu sprzętu.
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

  registerSW();
  refreshStorageBar().catch(() => {});
}

function bindUI() {
  $("#btn-send").addEventListener("click", () => onSend());
  $("#btn-stop").addEventListener("click", stopGeneration);
  const input = $("#input");
  input.addEventListener("input", autogrow);
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

  // Drawer
  $("#btn-threads").addEventListener("click", openDrawer);
  $("#btn-close-drawer").addEventListener("click", closeDrawer);
  $("#scrim").addEventListener("click", closeDrawer);
  $("#btn-new-chat").addEventListener("click", () => { newChat(); closeDrawer(); });
  $("#thread-search").addEventListener("input", (e) => {
    S.threadFilter = e.target.value.toLowerCase();
    renderThreadList();
  });
  $("#btn-export").addEventListener("click", onExport);
  $("#btn-import").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", onImportFile);

  $("#btn-settings").addEventListener("click", openSettings);
  $("#btn-install").addEventListener("click", installPWA);
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    S.installEvt = e;
    $("#btn-install").hidden = false;
  });

  // Wiadomości: scroll + delegacja klików
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
    if (S.downloading || S.generating) e.preventDefault();
  });

  const pill = $("#status-pill");
  pill.style.cursor = "pointer";
  pill.setAttribute("title", "Kliknij, aby zarządzać modelem lub postępem pobierania");
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
}

function updateOnlineUI() {
  $("#offline-banner").hidden = navigator.onLine;
}

// ── Sugestie ──────────────────────────────────────────────────
function renderSuggestions() {
  const wrap = $("#suggestions");
  wrap.innerHTML = "";
  for (const p of SUGGESTED_PROMPTS) {
    const b = el(`<button class="chip">💬 ${escapeHtml(p)}</button>`);
    b.addEventListener("click", () => {
      $("#input").value = p;
      autogrow();
      onSend();
    });
    wrap.appendChild(b);
  }
}

// ── Drawer / wątki ────────────────────────────────────────────
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
    list.appendChild(el(`<div class="empty-threads">Brak rozmów.<br>Utwórz nową, aby zacząć. ✨</div>`));
    return;
  }
  for (const t of items) {
    const node = el(
      `<div class="thread ${t.id === S.activeId ? "active" : ""}">
        <div class="thread-main">
          <span class="thread-title">${t.pinned ? '<span class="pin-dot">📌 </span>' : ""}${escapeHtml(t.title)}</span>
          <span class="thread-sub">${escapeHtml(t.modelKey ? getModel(t.modelKey)?.name || t.modelKey : "bez modelu")} · ${timeAgoPL(t.updatedAt)}</span>
        </div>
        <div class="thread-acts">
          <button class="icon-btn" data-act="pin" title="${t.pinned ? "Odepnij" : "Przypnij"}"><svg><use href="#i-pin"/></svg></button>
          <button class="icon-btn" data-act="rename" title="Zmień nazwę"><svg><use href="#i-edit"/></svg></button>
          <button class="icon-btn" data-act="del" title="Usuń"><svg><use href="#i-trash"/></svg></button>
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
      title: "Usunąć rozmowę?",
      text: "Historia tej rozmowy zniknie z tego urządzenia bezpowrotnie.",
      okLabel: "Usuń",
    });
    if (!ok) return;
    await Threads.remove(id);
    if (S.activeId === id) {
      S.activeId = null;
      $("#messages").innerHTML = "";
      updateWelcome();
    }
    await refreshThreads();
    toast("Rozmowa usunięta", "ok");
  } else if (act === "rename") {
    const t = S.threads.find((x) => x.id === id);
    const { close, body } = openModal({
      title: "Zmień nazwę",
      html: `<div class="field"><input type="text" id="rn" maxlength="80" value="${escapeHtml(t?.title || "")}"></div>
        <div class="row end gap"><button class="btn primary" id="rn-ok">Zapisz</button></div>`,
    });
    const inp = body.querySelector("#rn");
    inp.focus(); inp.select();
    body.querySelector("#rn-ok").addEventListener("click", async () => {
      await Threads.update(id, { title: inp.value.trim() || "Rozmowa" });
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

// ── Renderowanie wiadomości ───────────────────────────────────
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

function msgNode(role, innerHTML, statsText = "") {
  // Uwaga: CSS styluje bąble asystenta pod klasą .msg.ai (nie .msg.assistant)
  const cls = role === "assistant" ? "ai" : role;
  const avatar = role === "user"
    ? `<div class="msg-avatar">Ty</div>`
    : `<div class="msg-avatar"><img src="./icons/icon-192.png" alt="AI"></div>`;
  const node = el(
    `<div class="msg ${cls}">${avatar}<div class="bubble"><div class="content"></div>
      <div class="msg-foot">
        <button class="icon-btn" data-act="copy" title="Kopiuj"><svg><use href="#i-copy"/></svg></button>
        ${role === "assistant" ? `<button class="icon-btn" data-act="regen" title="Generuj ponownie"><svg><use href="#i-refresh"/></svg></button>` : ""}
        <small>${escapeHtml(statsText)}</small>
      </div></div></div>`
  );
  node.querySelector(".content").innerHTML = innerHTML;
  return node;
}

function statsLine(stats) {
  if (!stats) return "";
  const parts = [];
  if (stats.tokPerSec) parts.push(`${String(stats.tokPerSec).replace(".", ",")} tok/s`);
  if (stats.completionTokens) parts.push(`${stats.completionTokens} tok.`);
  if (stats.ttftMs) parts.push(`start ${(stats.ttftMs / 1000).toFixed(1)}s`);
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
  const windowSize = resetWindow ? LIMITS.renderWindow : total;
  const slice = all.slice(-windowSize);
  $("#load-more-wrap").hidden = total <= slice.length;
  for (const m of slice) {
    const html = m.role === "user"
      ? escapeHtml(m.content).replace(/\n/g, "<br>")
      : renderMarkdown(m.content);
    const node = msgNode(m.role, html, statsLine(m.stats));
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
    copyText(decodeURIComponent(copyBtn.dataset.code || ""))
      .then((ok) => toast(ok ? "Skopiowano kod" : "Nie udało się skopiować", ok ? "ok" : "error"));
    return;
  }
  const btn = e.target.closest(".msg-foot button");
  if (!btn) return;
  const msgEl = e.target.closest(".msg");
  const raw = msgEl?.dataset.raw || msgEl?.querySelector(".content")?.textContent || "";
  if (btn.dataset.act === "copy") {
    copyText(raw).then((ok) => toast(ok ? "Skopiowano" : "Nie udało się skopiować", ok ? "ok" : "error"));
  } else if (btn.dataset.act === "regen") {
    regenerate();
  }
}

// ── Wysyłanie / generowanie ───────────────────────────────────
async function queuePrompt(text) {
  if (!text || S.generating) return;
  if (!S.model) {
    toast("Najpierw wybierz model AI", "warn");
    return;
  }
  const ta = $("#input");
  if (ta) {
    ta.value = "";
    autogrow();
  }

  // Upewnij się, że mamy wątek roboczy
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
    if (t && (t.title === "Nowa rozmowa" || !t.title)) {
      await Threads.update(S.activeId, { title: autoTitle(text) });
      await refreshThreads();
    }
  }

  const userMsg = await Messages.add(S.activeId, { role: "user", content: text });
  const box = $("#messages");
  const uNode = msgNode("user", escapeHtml(text).replace(/\n/g, "<br>"));
  uNode.dataset.mid = userMsg.id;
  uNode.dataset.raw = text;
  box.appendChild(uNode);

  const qNode = msgNode(
    "assistant",
    `<div class="queued-indicator">⏳ Model w trakcie pobierania (<span id="queued-dl-pct">0%</span>) — odpowiedź pojawi się automatycznie!</div>`,
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

  toast("Wiadomość czeka w kolejce — wyśle się automatycznie po załadowaniu! 🚀", "ok", 4000);
}

async function processQueuedPrompt() {
  if (!S.queuedPrompt) return;
  const { placeholderNode } = S.queuedPrompt;
  S.queuedPrompt = null;
  if (placeholderNode && placeholderNode.parentNode) {
    placeholderNode.remove();
  }
  toast("Model gotowy — generuję odpowiedź na Twoje pytanie… ✨", "ok");
  await generateReply();
}

async function onSend() {
  const ta = $("#input");
  const text = ta.value.trim();
  if (!text || S.generating) return;

  // Trwa pobieranie:
  //  - silnik jeszcze nie gotowy → kolejka (odpowiedź po załadowaniu),
  //  - pobieramy INNY model niż aktywny → kolejka (odpowieź nowym modelem),
  //  - ten sam model już działa w pamięci → odpowiadamy od razu.
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

  // Wątek roboczy
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
    if (t && (t.title === "Nowa rozmowa" || !t.title)) {
      await Threads.update(S.activeId, { title: autoTitle(text) });
      await refreshThreads();
    }
  }

  const userMsg = await Messages.add(S.activeId, { role: "user", content: text });
  const box = $("#messages");
  const uNode = msgNode("user", escapeHtml(text).replace(/\n/g, "<br>"));
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

async function generateReply() {
  const box = $("#messages");
  S.generating = true;
  S.streamText = "";
  $("#btn-send").disabled = true;
  $("#btn-stop").hidden = false;
  $("#progress-line").hidden = false;

  // Bąbel strumieniowy
  const node = msgNode("assistant", `<span class="typing"><i></i><i></i><i></i></span>`, "");
  const content = node.querySelector(".content");
  box.appendChild(node);
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

  try {
    const all = await Messages.list(S.activeId, 1000);
    const ctx = S.model.ctx || 4096;
    const history = historyForChat(all, ctx);
    updateCtxInfo(all);
    setStatus("generating", S.model.name);

    const t0 = performance.now();
    const res = await S.proxy.chat(history, {
      temperature: S.settings.temperature,
      maxTokens: S.settings.maxTokens,
      topP: S.settings.topP,
      onToken: (delta) => {
        S.streamText += delta;
        // licznik na żywo
        const secs = (performance.now() - t0) / 1000;
        const toks = Math.ceil(S.streamText.length / 4);
        $("#gen-stats").textContent = `${toks} tok. · ${(toks / Math.max(secs, 0.1)).toFixed(1).replace(".", ",")} tok/s`;
        paint(false);
      },
    });
    S.streamText = res.text || S.streamText;
    paint(true);

    const stats = {
      tokPerSec: res.tokPerSec || null,
      completionTokens: res.completionTokens || Math.ceil(S.streamText.length / 4),
      ttftMs: res.ttftMs || null,
    };
    const saved = await Messages.add(S.activeId, {
      role: "assistant", content: S.streamText, stats,
    });
    node.dataset.mid = saved.id;
    node.dataset.raw = S.streamText;
    node.querySelector(".msg-foot small").textContent = statsLine(stats);
    $("#gen-stats").textContent = res.aborted
      ? `Przerwano · ${statsLine(stats)}`
      : `Gotowe w ${((performance.now() - t0) / 1000).toFixed(1).replace(".", ",")}s · ${statsLine(stats)}`;

    const fresh = await Messages.list(S.activeId, 1000);
    updateCtxInfo(fresh);
    await refreshThreads();
    setStatus("ready", S.model.name + (navigator.onLine ? "" : " · offline"));
  } catch (e) {
    console.error(e);
    content.innerHTML = `<p>⚠️ <strong>Nie udało się wygenerować odpowiedzi.</strong></p><p class="muted">${escapeHtml(friendlyError(e))}</p>`;
    setStatus("error", "generowanie nieudane");
    toast(friendlyError(e), "error", 5000);
    setTimeout(() => {
      if (S.engineLoaded) setStatus("ready", S.model?.name || "");
    }, 4000);
  } finally {
    S.generating = false;
    $("#btn-send").disabled = false;
    $("#btn-stop").hidden = true;
    $("#progress-line").hidden = true;
    if (S.nearBottom) scrollBottom(true);
  }
}

async function stopGeneration() {
  if (!S.generating) return;
  await S.proxy.abort().catch(() => {});
  toast("Zatrzymano generowanie", "info");
}

async function regenerate() {
  if (S.generating || !S.activeId) return;
  if (!(await ensureEngine())) return;
  const removed = await Messages.removeLastAssistant(S.activeId);
  if (!removed) {
    toast("Brak odpowiedzi do ponowienia", "warn");
    return;
  }
  await renderThread(false);
  await generateReply();
}

function friendlyError(e) {
  const m = String(e?.message || e || "");
  if (/memory|OOM|out of memory|allocation|device lost/i.test(m)) {
    return "Za mało pamięci — zamknij inne karty i wybierz mniejszy model (np. SmolLM2 360M lub Qwen 0.5B).";
  }
  if (/webgpu|adapter/i.test(m)) {
    return "Problem z WebGPU — odśwież stronę lub wybierz tryb zgodności (WASM).";
  }
  if (/network|fetch|Failed to fetch|Load failed|resolve module|CORS|networkerror/i.test(m)) {
    return "Problem z siecią — nie udało się pobrać modelu lub biblioteki silnika. Sprawdź połączenie (albo rozszerzenia blokujące) i spróbuj ponownie.";
  }
  if (/MODEL_NOT_FOUND|nie występuje/i.test(m)) return m;
  if (/silnik (webllm|wasm) nie jest załadowany/i.test(m)) {
    return "Silnik utracił model (np. po awarii karty graficznej) — otwórz listę i wybierz model ponownie.";
  }
  if (/context|Conversation exceeded/i.test(m)) {
    return "Przekroczono okno kontekstu — zacznij nową rozmowę lub wyczyść historię.";
  }
  return m.length > 220 ? m.slice(0, 217) + "…" : m;
}

function updateCtxInfo(allMessages) {
  const elInfo = $("#ctx-info");
  if (!S.model || !allMessages?.length) {
    elInfo.textContent = S.model ? `Kontekst: ~${(S.model.ctx / 1024).toFixed(0)}k tokenów` : "";
    return;
  }
  const used = estimateTokens(S.settings.systemPrompt) +
    allMessages.reduce((a, m) => a + estimateTokens(m.content) + 8, 0);
  const ctx = S.model.ctx || 4096;
  const pct = Math.min(999, Math.round((used / ctx) * 100));
  elInfo.textContent = `Kontekst: ~${used} / ${ctx} tok. (${pct}%)`;
}

// ── Silnik: zapewnienie / ładowanie ───────────────────────────
async function ensureEngine() {
  if (S.engineLoaded) return true;
  if (!S.model) {
    openModelPicker();
    toast("Najpierw wybierz model AI", "info");
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
  if (!model) throw new Error("Nieznany model.");
  if (S.engineLoaded && S.engineModelKey === key) {
    // Model już siedzi w pamięci — zero pracy, zero ponownego pobierania.
    S.model = model;
    updateModelChip();
    if (!S.settings.onboarded) S.settings = saveSettings({ onboarded: true });
    setStatus("ready", model.name + (navigator.onLine ? "" : " · offline"));
    return;
  }
  if (S.downloading) {
    toast("Trwa już ładowanie modelu…", "info");
    downloadHub?.expand();
    return;
  }
  if (!S.hw) {
    try { S.hw = await probeHardware(); } catch { /* dalej z fallbackiem */ }
  }
  const hw = S.hw || { mobile: true, ramGB: 4, webgpu: { supported: true, f16: false }, cores: 4 };

  // Ostrzeżenie o danych mobilnych
  if (!auto && S.settings.dataSaver === false && hw.connection?.saveData && !S.settings.downloaded[key]) {
    toast("Tryb oszczędzania danych: pobieranie dużego modelu…", "warn", 5000);
  }

  // Wymuszenie trwałego przechowywania (persistent storage)
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  S.downloading = true;
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
      const ctx = suggestContextWindow(hw, model, S.settings.memorySaver);
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
    toast(`Gotowy: ${model.name} — działa lokalnie${navigator.onLine ? "" : " (offline)"}`, "ok");
    if (!S.settings.onboarded) S.settings = saveSettings({ onboarded: true });

    if (S.queuedPrompt) {
      processQueuedPrompt();
    }
  } catch (e) {
    console.error(e);
    S.engineLoaded = false;
    setStatus("error", "ładowanie nieudane");
    toast(friendlyError(e), "error", 6000);
    throw e;
  } finally {
    S.downloading = false;
    downloadHub?.finish();
  }
}

// ── Onboarding / wybór modelu ─────────────────────────────────
function starsHTML(n) {
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function modelCardHTML(m, { recommended = false, fits = true, active = false } = {}) {
  const dl = S.settings.downloaded[m.key];
  const needPct = S.rec ? Math.min(100, Math.round((m.vramMB * 1.12 / S.rec.budgetMB) * 100)) : 0;
  return `<div class="model-card ${recommended ? "recommended" : ""} ${active ? "active" : ""} ${!fits ? "dim" : ""}" data-key="${m.key}" data-size="${m.sizeMB}">
    <div class="model-top">
      <strong>${escapeHtml(m.name)}</strong>
      <span class="params">${escapeHtml(m.params)}</span>
      <span class="model-badges">
        ${recommended ? `<span class="badge rec">✨ Polecany</span>` : ""}
        ${active ? `<span class="badge ok">● Aktywny</span>` : ""}
        ${dl ? `<span class="badge ok">📦 Offline</span>` : ""}
        ${!fits ? `<span class="badge warnb">Duży na to urządzenie</span>` : ""}
      </span>
    </div>
    <div class="model-desc">${escapeHtml(m.blurb)}</div>
    <div class="model-meta">
      <span>🇵🇱 <span class="stars">${starsHTML(m.pl)}</span></span>
      <span>⬇️ <b>${fmtSizeMB(m.sizeMB)}</b></span>
      ${m.estDl ? `<span class="badge-fast" title="Szacowany czas pobierania przy standardowym łączu">⚡ ${escapeHtml(m.estDl)}</span>` : ""}
      <span>🧠 <b>${fmtBytes(m.vramMB)}</b></span>
      <span>📏 ${(m.ctx / 1024).toFixed(0)}k ctx</span>
      ${m.needsF16 ? `<span title="Wymaga shader-f16">⚡F16</span>` : ""}
      ${m.stable === false ? `<span title="Wariant eksperymentalny">🧪 exp</span>` : ""}
    </div>
    <div class="vram"><div class="bar"><i style="width:${needPct}%"></i></div><small>pamięć vs budżet</small></div>
    <button class="btn ${recommended && !active ? "primary" : "ghost"} sm" data-load="${m.key}">
      <svg><use href="#${dl ? "i-bolt" : "i-download"}"/></svg>${dl ? "Uruchom z pamięci" : "Pobierz i uruchom"}
    </button>
  </div>`;
}

function catalogHTML(catalog, { showTiers = true } = {}) {
  const fitMap = new Map((S.rec?.ranked || []).map((r) => [r.key, r.fits]));
  const tiers = [...new Set(catalog.map((m) => m.tier))];
  let html = "";
  for (const tier of tiers) {
    const t = TIERS[tier] || { label: tier, desc: "" };
    html += `<div class="tier-title">${escapeHtml(t.label)}<small>${escapeHtml(t.desc)}</small></div><div class="model-grid">`;
    for (const m of catalog.filter((x) => x.tier === tier)) {
      html += modelCardHTML(m, {
        recommended: S.rec?.recommended === m.key,
        fits: fitMap.get(m.key) ?? true,
        active: S.engineModelKey === m.key && S.engineLoaded,
      });
    }
    html += `</div>`;
  }
  if (!showTiers) return html;
  return html;
}

function hwCardHTML() {
  if (!S.hw) {
    return `<div class="hw-card">⏳ Badanie sprzętu trwało za długo — wybierz model ręcznie (dostępne też warianty WASM na dole listy).</div>`;
  }
  const warns = (S.rec?.warnings || [])
    .map((w) => `<div class="warnline ${w.icon === "info" ? "info" : ""}"><svg><use href="#${w.icon === "info" ? "i-info" : "i-warn"}"/></svg><span>${escapeHtml(w.text)}</span></div>`)
    .join("");
  return `<div class="hw-card">
      <div class="hw-line"><svg><use href="#i-cpu"/></svg><span><strong>Twoje urządzenie:</strong> ${escapeHtml(deviceSummary(S.hw))}</span></div>
      <div class="hw-line"><svg><use href="#i-box"/></svg><span><strong>Budżet pamięci na model:</strong> ~${fmtBytes(S.rec?.budgetMB || 0)} (z marginesem bezpieczeństwa)</span></div>
    </div>${warns}`;
}

function openOnboarding() {
  if (S.settings.onboarded && S.model) return;
  const isWasm = S.hw && !S.hw.webgpu.supported;
  const catalog = isWasm ? WASM_CATALOG : MODEL_CATALOG;
  const { close, body } = openModal({
    title: "👋 Witaj w OffChat!",
    wide: true,
    dismissable: true,
    html: `<p class="muted">Zbadaliśmy Twoje urządzenie i dobraliśmy modele, które <strong>bezpiecznie się na nim zmieszczą</strong>.
      ${isWasm ? "Brak WebGPU — proponujemy lekkie modele CPU (WASM)." : "Wybierz jeden — pobierze się raz, a potem działa offline."}</p>
      ${hwCardHTML()}${catalogHTML(catalog)}`,
  });
  body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-load]");
    if (!btn) return;
    const key = btn.dataset.load;
    close();
    if (!S.activeId) newChat();
    loadModel(key).catch(() => {});
  });
}

function openModelPicker() {
  const web = !S.hw || S.hw.webgpu.supported;
  const { close, body } = openModal({
    title: "🤖 Wybierz model AI",
    wide: true,
    html: `${hwCardHTML()}
      <div class="filter-pills" id="model-filters">
        <button class="filter-pill active" data-filter="all">Wszystkie</button>
        <button class="filter-pill" data-filter="fast">⚡ Błyskawiczne (&lt; 500 MB)</button>
        <button class="filter-pill" data-filter="mid">⚖️ Zrównoważone (0.5 – 2 GB)</button>
        <button class="filter-pill" data-filter="max">💎 Desktop (&gt; 2 GB)</button>
      </div>
      ${web ? catalogHTML(MODEL_CATALOG) : `<p class="muted">Brak WebGPU — dostępne modele CPU:</p>` + catalogHTML(WASM_CATALOG)}
      ${web ? `<div class="tier-title">Tryb zgodności<small>Gdy WebGPU sprawia problemy — wolniejsze modele CPU (WASM)</small></div><div class="model-grid">${WASM_CATALOG.map((m) => modelCardHTML(m, { fits: true, active: S.engineModelKey === m.key && S.engineLoaded })).join("")}</div>` : ""}
      <div class="row end gap">
        ${S.engineLoaded ? `<button class="btn ghost sm" id="m-unload">Wyłącz model z pamięci</button>` : ""}
        <button class="btn ghost sm" id="m-close">Zamknij</button>
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

  body.querySelector("#m-close").addEventListener("click", close);
  body.querySelector("#m-unload")?.addEventListener("click", async () => {
    await S.proxy.unload().catch(() => {});
    S.engineLoaded = false;
    S.engineModelKey = null;
    setStatus("idle", "model wyłączony");
    toast("Model zwolniony z pamięci", "ok");
    close();
  });
  body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-load]");
    if (!btn || btn.id === "m-close" || btn.id === "m-unload") return;
    const key = btn.dataset.load;
    close();
    loadModel(key).catch(() => {});
  });
}

// ── Ustawienia ────────────────────────────────────────────────
function openSettings() {
  const s = S.settings;
  const { close, body } = openModal({
    title: "⚙️ Ustawienia",
    html: `
    <div class="set-section">Wygląd</div>
    <div class="seg" id="seg-theme">
      <button data-v="auto" class="${s.theme === "auto" ? "on" : ""}">🌓 Auto</button>
      <button data-v="light" class="${s.theme === "light" ? "on" : ""}"><svg><use href="#i-sun"/></svg>Jasny</button>
      <button data-v="dark" class="${s.theme === "dark" ? "on" : ""}"><svg><use href="#i-moon"/></svg>Ciemny</button>
    </div>
    <div class="switch-row"><span>Animacje i efekty szklane<small>Wyłącz na bardzo słabych urządzeniach</small></span>
      <label class="switch"><input type="checkbox" id="sw-anim" ${s.animations ? "checked" : ""}><i></i></label></div>

    <div class="set-section">Generowanie</div>
    <div class="field"><label>Temperatura (kreatywność) <output id="o-temp">${s.temperature.toFixed(2)}</output></label>
      <input type="range" id="r-temp" min="0" max="1.5" step="0.05" value="${s.temperature}"></div>
    <div class="field"><label>Top-P <output id="o-topp">${s.topP.toFixed(2)}</output></label>
      <input type="range" id="r-topp" min="0.1" max="1" step="0.05" value="${s.topP}"></div>
    <div class="field"><label>Maks. długość odpowiedzi <output id="o-max">${s.maxTokens} tok.</output></label>
      <input type="range" id="r-max" min="64" max="2048" step="64" value="${s.maxTokens}"></div>
    <div class="field"><label>Prompt systemowy (osobowość AI)</label>
      <textarea id="t-sys" maxlength="2000">${escapeHtml(s.systemPrompt)}</textarea></div>
    <div class="row end"><button class="btn ghost sm" id="btn-sys-reset">Przywróć domyślny prompt</button></div>
    <div class="switch-row"><span>Enter wysyła wiadomość<small>Wyłączone: Enter to nowa linia</small></span>
      <label class="switch"><input type="checkbox" id="sw-enter" ${s.sendOnEnter ? "checked" : ""}><i></i></label></div>

    <div class="set-section">Pamięć i offline</div>
    <div class="switch-row"><span>Tryb oszczędzania pamięci<small>Skraca kontekst na telefonach — mniej ryzyka wysypania karty</small></span>
      <label class="switch"><input type="checkbox" id="sw-mem" ${s.memorySaver ? "checked" : ""}><i></i></label></div>
    <div class="field"><label>Magazyn wag modelu</label>
      <select id="sel-cache">
        <option value="cache" ${s.cacheBackend === "cache" ? "selected" : ""}>Cache API (zalecane, stabilne)</option>
        <option value="opfs" ${s.cacheBackend === "opfs" ? "selected" : ""}>OPFS (eksperymentalne)</option>
      </select></div>
    <div class="storage"><div class="bar"><i id="set-storage-bar"></i></div><small id="set-storage-text">…</small></div>
    <div class="row gap"><button class="btn ghost sm grow" id="btn-clear-cache">🗑️ Wyczyść cache modeli</button></div>

    <div class="set-section">Strefa niebezpieczna</div>
    <div class="danger-zone">
      <div class="row gap">
        <button class="btn danger sm grow" id="btn-wipe-chats">Usuń wszystkie rozmowy</button>
      </div>
      <small class="hint">Usuwa historię czatów z tego urządzenia. Wag modeli nie rusza.</small>
    </div>

    <div class="set-section">O aplikacji</div>
    <p class="hint">OffChat v${APP_VERSION} · silniki: WebLLM (WebGPU) + Transformers.js (WASM) ·
    100% client-side, zero telemetrii. Wagi modeli: Hugging Face (cache lokalny).</p>`,
  });

  const seg = body.querySelector("#seg-theme");
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    seg.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    S.settings = saveSettings({ theme: b.dataset.v });
    applyTheme();
  });
  const bindRange = (id, out, fmt, key) => {
    const r = body.querySelector(id);
    r.addEventListener("input", () => {
      body.querySelector(out).textContent = fmt(Number(r.value));
      S.settings = saveSettings({ [key]: Number(r.value) });
    });
  };
  bindRange("#r-temp", "#o-temp", (v) => v.toFixed(2), "temperature");
  bindRange("#r-topp", "#o-topp", (v) => v.toFixed(2), "topP");
  bindRange("#r-max", "#o-max", (v) => `${v} tok.`, "maxTokens");
  body.querySelector("#t-sys").addEventListener("change", (e) => {
    S.settings = saveSettings({ systemPrompt: e.target.value.slice(0, 2000) || DEFAULT_SETTINGS.systemPrompt });
    toast("Zapisano prompt systemowy", "ok");
  });
  body.querySelector("#btn-sys-reset").addEventListener("click", () => {
    body.querySelector("#t-sys").value = DEFAULT_SETTINGS.systemPrompt;
    S.settings = saveSettings({ systemPrompt: DEFAULT_SETTINGS.systemPrompt });
  });
  body.querySelector("#sw-anim").addEventListener("change", (e) => {
    S.settings = saveSettings({ animations: e.target.checked });
    applyAnims();
  });
  body.querySelector("#sw-enter").addEventListener("change", (e) => {
    S.settings = saveSettings({ sendOnEnter: e.target.checked });
  });
  body.querySelector("#sw-mem").addEventListener("change", (e) => {
    S.settings = saveSettings({ memorySaver: e.target.checked });
    toast("Zmiana kontekstu zadziała przy następnym ładowaniu modelu", "info");
  });
  body.querySelector("#sel-cache").addEventListener("change", (e) => {
    S.settings = saveSettings({ cacheBackend: e.target.value });
    toast("Zmiana magazynu zadziała przy następnym pobieraniu modelu", "info");
  });
  body.querySelector("#btn-clear-cache").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Wyczyścić cache modeli?",
      text: "Usunie pobrane wagi (setki MB). Przy następnym uruchomieniu model pobierze się od nowa.",
      okLabel: "Wyczyść",
    });
    if (!ok) return;
    const n = await clearModelCaches();
    S.settings = saveSettings({ downloaded: {} });
    toast(`Wyczyszczono ${n} magazynów modeli`, "ok");
    refreshStorageBar();
    paintSettingsStorage(body);
  });
  body.querySelector("#btn-wipe-chats").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Usunąć WSZYSTKIE rozmowy?",
      text: "Tej operacji nie da się cofnąć. Rozważ najpierw Eksport.",
      okLabel: "Usuń wszystko",
    });
    if (!ok) return;
    await Threads.clearAll();
    S.activeId = null;
    $("#messages").innerHTML = "";
    updateWelcome();
    await refreshThreads();
    toast("Usunięto wszystkie rozmowy", "ok");
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
      txt.textContent = `Użyte: ${fmtBytes(info.usageMB)} z ${fmtBytes(info.quotaMB)} · cache: ${info.caches.length}`;
    }
  } catch { /* ignoruj */ }
}

async function refreshStorageBar() {
  try {
    const info = await storageInfo();
    const pct = info.quotaMB ? Math.min(100, Math.round((info.usageMB / info.quotaMB) * 100)) : 0;
    $("#storage-bar").style.width = `${pct}%`;
    $("#storage-text").textContent = `Pamięć: ${fmtBytes(info.usageMB)} / ${fmtBytes(info.quotaMB)}`;
  } catch {
    $("#storage-text").textContent = "Pamięć: niedostępna";
  }
}

// ── Eksport / import ──────────────────────────────────────────
async function onExport() {
  try {
    const bundle = await exportAll(S.settings);
    downloadFile(
      `offchat-eksport-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(bundle),
      "application/json"
    );
    toast(`Wyeksportowano ${bundle.threads.length} rozmów`, "ok");
  } catch (e) {
    toast("Eksport nieudany: " + e.message, "error");
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
    toast(`Zaimportowano ${n} rozmów`, "ok");
  } catch {
    toast("Nieprawidłowy plik eksportu", "error");
  }
}

// ── PWA / SW ──────────────────────────────────────────────────
async function installPWA() {
  if (!S.installEvt) {
    toast("Instalacja niedostępna w tej przeglądarce", "warn");
    return;
  }
  S.installEvt.prompt();
  await S.installEvt.userChoice.catch(() => {});
  S.installEvt = null;
  $("#btn-install").hidden = true;
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  // Service Worker wymaga http(s) — na file:// po prostu go pomiń.
  if (!/^https?:$/.test(location.protocol)) return;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) {
          toast("Dostępna nowa wersja OffChat — odśwież stronę ✨", "info", 6000);
        }
      });
    });
  } catch (e) {
    console.warn("SW niedostępny:", e);
  }
}
