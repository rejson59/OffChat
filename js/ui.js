// ─────────────────────────────────────────────────────────────
// OffChat · ui.js — small UI helpers: toasts, modals, formatting.
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
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function fmtSizeMB(mb) {
  if (mb >= 1024) return `~${(mb / 1024).toFixed(1)} GB`;
  return `~${Math.round(mb)} MB`;
}

export function timeAgo(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(ts).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

export function autoTitle(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "New chat";
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

// ── Toasts ────────────────────────────────────────────────────
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
  try {
    const root = ensureToastRoot();
    const icons = { info: "i-info", ok: "i-check", warn: "i-warn", error: "i-warn" };
    const node = el(
      `<div class="toast ${type}" role="status"><svg><use href="#${icons[type] || "i-info"}"/></svg><span></span></div>`
    );
    node.querySelector("span").textContent = msg;
    root.appendChild(node);
    requestAnimationFrame(() => node.classList.add("show"));
    let dead = false;
    const kill = () => {
      if (dead) return;
      dead = true;
      node.classList.remove("show");
      setTimeout(() => node.remove(), 350);
    };
    node.addEventListener("click", kill);
    setTimeout(kill, ms);
    while (root.children.length > 4) root.firstElementChild.remove();
  } catch { /* toasts must never break the app */ }
}

// ── Modals ────────────────────────────────────────────────────
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
      <div class="modal-head"><h2></h2><button class="icon-btn modal-x" aria-label="Close"><svg><use href="#i-x"/></svg></button></div>
      <div class="modal-body"></div>
    </div></div>`
  );
  wrap.querySelector("h2").textContent = title;
  const body = wrap.querySelector(".modal-body");
  if (typeof html === "string") body.innerHTML = html;
  else if (html instanceof Element) body.appendChild(html);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
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

export function confirmDialog({ title = "Are you sure?", text = "", okLabel = "Delete", danger = true }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const { close, body } = openModal({
      title,
      html: `<p class="muted">${escapeHtml(text)}</p>
        <div class="row end gap"><button class="btn ghost" data-act="no">Cancel</button>
        <button class="btn ${danger ? "danger" : "primary"}" data-act="yes">${escapeHtml(okLabel)}</button></div>`,
      onClose: () => done(false),
    });
    body.querySelector('[data-act="no"]').addEventListener("click", () => { close(); done(false); });
    body.querySelector('[data-act="yes"]').addEventListener("click", () => { close(); done(true); });
  });
}
