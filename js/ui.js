// ─────────────────────────────────────────────────────────────
// OffChat · ui.js — drobne helpery UI: toasty, modale, formatowanie.
// ─────────────────────────────────────────────────────────────
import { escapeHtml } from "./markdown.js";

export { escapeHtml };

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $all(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function fmtBytes(mb) {
  if (mb == null || isNaN(mb)) return "—";
  if (mb < 1) return `${Math.round(mb * 1024)} KB`;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1).replace(".", ",")} GB`;
}

export function fmtSizeMB(mb) {
  if (mb >= 1024) return `~${(mb / 1024).toFixed(1).replace(".", ",")} GB`;
  return `~${Math.round(mb)} MB`;
}

export function timeAgoPL(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "przed chwilą";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min temu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} godz. temu`;
  const d = Math.floor(h / 24);
  if (d === 1) return "wczoraj";
  if (d < 7) return `${d} dni temu`;
  return new Date(ts).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
}

export function autoTitle(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "Nowa rozmowa";
  return t.length > 44 ? t.slice(0, 43).trimEnd() + "…" : t;
}

export async function copyText(text) {
  const s = String(text ?? "");
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = s;
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

export function downloadFile(filename, content, mime = "application/json") {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

// ── Toasty ────────────────────────────────────────────────────
let toastRoot = null;
function ensureToastRoot() {
  if (!toastRoot) {
    toastRoot = document.createElement("div");
    toastRoot.className = "toasts";
    toastRoot.setAttribute("aria-live", "polite");
    document.body.appendChild(toastRoot);
  }
  return toastRoot;
}

/** toast(msg, type='info'|'ok'|'warn'|'error', ms) */
export function toast(msg, type = "info", ms = 3600) {
  const root = ensureToastRoot();
  const icons = { info: "i-info", ok: "i-check", warn: "i-warn", error: "i-warn" };
  const node = el(
    `<div class="toast ${type}" role="status"><svg><use href="#${icons[type] || "i-info"}"/></svg><span></span></div>`
  );
  node.querySelector("span").textContent = msg;
  root.appendChild(node);
  requestAnimationFrame(() => node.classList.add("show"));
  const kill = () => {
    node.classList.remove("show");
    setTimeout(() => node.remove(), 350);
  };
  node.addEventListener("click", kill);
  setTimeout(kill, ms);
  while (root.children.length > 4) root.firstElementChild.remove();
}

// ── Modale ────────────────────────────────────────────────────
let modalRoot = null;
function ensureModalRoot() {
  if (!modalRoot) {
    modalRoot = document.createElement("div");
    modalRoot.id = "modal-root";
    document.body.appendChild(modalRoot);
  }
  return modalRoot;
}

export function openModal({ title, html, wide = false, onClose, dismissable = true }) {
  const root = ensureModalRoot();
  const wrap = el(
    `<div class="modal-backdrop"><div class="modal glass ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal-head"><h2></h2><button class="icon-btn modal-x" aria-label="Zamknij"><svg><use href="#i-x"/></svg></button></div>
      <div class="modal-body"></div>
    </div></div>`
  );
  wrap.querySelector("h2").textContent = title;
  const body = wrap.querySelector(".modal-body");
  if (typeof html === "string") body.innerHTML = html;
  else if (html instanceof Element) body.appendChild(html);

  const close = () => {
    wrap.classList.remove("show");
    setTimeout(() => {
      wrap.remove();
      onClose?.();
    }, 260);
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape" && dismissable) close();
  };
  document.addEventListener("keydown", onKey);
  wrap.querySelector(".modal-x").addEventListener("click", close);
  if (dismissable) {
    wrap.addEventListener("mousedown", (e) => {
      if (e.target === wrap) close();
    });
  } else {
    wrap.querySelector(".modal-x").style.display = "none";
  }
  root.appendChild(wrap);
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add("show")));
  return { close, body, wrap };
}

export function confirmDialog({ title = "Na pewno?", text = "", okLabel = "Usuń", danger = true }) {
  return new Promise((resolve) => {
    const { close, body } = openModal({
      title,
      html: `<p class="muted">${escapeHtml(text)}</p>
        <div class="row end gap"><button class="btn ghost" data-act="no">Anuluj</button>
        <button class="btn ${danger ? "danger" : "primary"}" data-act="yes">${escapeHtml(okLabel)}</button></div>`,
      onClose: () => resolve(false),
    });
    body.querySelector('[data-act="no"]').addEventListener("click", () => { close(); resolve(false); });
    body.querySelector('[data-act="yes"]').addEventListener("click", () => { close(); resolve(true); });
  });
}
