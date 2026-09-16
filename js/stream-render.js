// ─────────────────────────────────────────────────────────────
// OffChat · stream-render.js — incremental Markdown renderer for
// streamed answers (the main performance win on weak devices).
//
// The naive approach re-parses the WHOLE answer and rebuilds its HTML
// on every repaint (O(n²) work + constant DOM churn + garbage).
// Here instead we:
//   1) cut the text at BLOCK boundaries and move finished blocks into
//      the DOM once — the DOM grows, it is never rebuilt,
//   2) keep re-rendering only the small "tail" (the block being typed),
//   3) fall back to plain text for the tail only when it gets huge
//      (e.g. one very long code block),
//   4) do ONE exact full render when the answer is finished, so the
//      final result is identical to a message rendered from history.
//
// The renderer is deliberately dependency-free (markdown.js only) and
// never throws — a broken paint must not break a generation.
// ─────────────────────────────────────────────────────────────
import { renderMarkdown, escapeHtml } from "./markdown.js";

const FENCE_RE = /^```\s*([\w+-]*)\s*$/;

/** Above this the tail is rendered as plain text instead of Markdown. */
const TAIL_PLAIN_MAX = 4000;
/** Never grow the live DOM past this many rendered characters. */
const STABLE_MAX = 30000;
/** Split a single long block at a newline only past this length. */
const SOFT_CUT_MIN = 900;
/** Minimum tail kept when doing a soft cut. */
const SOFT_TAIL_KEEP = 120;

/**
 * Position up to which the streamed text is settled and can be rendered
 * once and for all.
 *
 * Boundaries are blank lines (always safe: no Markdown block spans a
 * blank line) and — for very long blocks — single newlines (visually
 * safe, and the final exact render fixes any difference). Code fences
 * are never cut into.
 *
 * @param {string} text full accumulated answer
 * @param {number} from end of the already-rendered part
 * @returns {number}    new cut position (>= from, <= text.length)
 */
export function findStableCut(text, from = 0) {
  if (typeof text !== "string" || text.length <= from) return from;
  const lines = text.slice(from).split("\n");

  let pos = from;       // absolute position of the current line
  let inFence = false;
  let hardCut = from;   // after the last blank line (outside a fence)
  let softCut = from;   // after the last non-blank line (outside a fence)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLastLine = i === lines.length - 1;
    if (FENCE_RE.test(line)) inFence = !inFence;
    const nextPos = pos + line.length + 1; // after this line's newline
    if (!inFence && !isLastLine) {
      if (line.trim() === "") hardCut = nextPos;
      else softCut = nextPos;
    }
    pos = nextPos;
  }

  if (hardCut > from) return hardCut; // a finished block — render it once
  if (text.length - from >= SOFT_CUT_MIN &&
      softCut > from &&
      text.length - softCut >= SOFT_TAIL_KEEP) {
    return softCut; // huge in-flight block: keep the tail small
  }
  return from;
}

export class StreamRenderer {
  /**
   * @param {HTMLElement} host element that holds the answer (".content")
   * @param {object} [opts]
   * @param {boolean} [opts.caret] show the blinking caret while streaming
   * @param {boolean} [opts.lowFx] weak device: repaint less often
   * @param {number}  [opts.interval] base repaint interval in ms
   * @param {number}  [opts.maxInterval] repaint interval for long answers
   * @param {string}  [opts.placeholder] HTML shown while there is no text yet
   */
  constructor(host, {
    caret = true, lowFx = false, interval = 70, maxInterval = 240, placeholder = "",
  } = {}) {
    this.host = host;
    this.placeholder = placeholder;
    this.baseInterval = lowFx ? Math.max(interval, 120) : interval;
    this.maxInterval = lowFx ? Math.max(maxInterval, 320) : maxInterval;

    this.stableEl = document.createElement("div");
    this.stableEl.className = "stream-stable";
    this.tailEl = document.createElement("div");
    this.tailEl.className = "stream-tail";
    host.classList.add("streaming");
    host.append(this.stableEl, this.tailEl);

    if (caret) {
      this.caretEl = document.createElement("span");
      this.caretEl.className = "caret";
      host.appendChild(this.caretEl);
    }

    this.text = "";
    this.stableLen = 0;
    this.lastPaint = 0;
    this.timer = null;
    this.finished = false;
    /** Called after every paint (used for stats/scroll). */
    this.onPaint = null;
  }

  /** Adaptive interval: long answers repaint less often (cheaper + smoother). */
  intervalFor(len) {
    const load = Math.min(1, len / 4000);
    return Math.round(this.baseInterval + (this.maxInterval - this.baseInterval) * load);
  }

  /**
   * Feed the full accumulated text. Repaints are rate limited, so this
   * is safe (and cheap) to call on every single token.
   */
  setText(text, { force = false } = {}) {
    if (this.finished) return;
    this.text = typeof text === "string" ? text : "";
    if (force) {
      this.paint();
      return;
    }
    const now = performance.now();
    if (now - this.lastPaint >= this.intervalFor(this.text.length)) {
      this.paint();
    } else if (!this.timer) {
      // Never leave the user staring at a stale bubble: schedule one
      // trailing paint (only the tail is re-rendered, so it is cheap).
      this.timer = setTimeout(() => {
        this.timer = null;
        this.paint();
      }, this.intervalFor(this.text.length));
    }
  }

  paint() {
    try {
      this._paint();
    } catch {
      /* painting must never break a generation */
    }
  }

  _paint() {
    this.lastPaint = performance.now();
    const text = this.text;

    // 1) Move finished blocks into the stable part (append-only).
    if (this.stableLen < STABLE_MAX) {
      const cut = findStableCut(text, this.stableLen);
      if (cut > this.stableLen) {
        const html = renderMarkdown(text.slice(this.stableLen, cut));
        if (html) this._appendHTML(html);
        this.stableLen = cut;
      }
    }

    // 2) Re-render only the tail.
    const tail = text.slice(this.stableLen);
    if (!text && this.placeholder) {
      // Nothing yet (the model is still chewing on the prompt) — show the
      // caller's hint (e.g. typing dots) instead of an empty bubble.
      this.tailEl.innerHTML = this.placeholder;
    } else if (!tail) {
      this.tailEl.innerHTML = "";
    } else if (tail.length > TAIL_PLAIN_MAX) {
      // Huge in-flight block (usually an unfinished code fence):
      // plain text is far cheaper and looks fine until the exact render.
      this.tailEl.innerHTML = `<div class="stream-plain">${escapeHtml(tail)}</div>`;
    } else {
      this.tailEl.innerHTML = renderMarkdown(tail);
    }
    this.onPaint?.();
  }

  _appendHTML(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    this.stableEl.appendChild(tpl.content);
  }

  /**
   * Final, exact render — replaces the incremental DOM with the regular
   * renderer output (identical to a message loaded from history).
   */
  finish(text) {
    if (this.finished) return;
    this.finished = true;
    this._clearTimer();
    const finalText = typeof text === "string" ? text : this.text;
    this.text = finalText;
    this.host.classList.remove("streaming");
    this.caretEl?.remove();
    this.host.innerHTML = renderMarkdown(finalText);
    this.onPaint?.();
  }

  /**
   * Throw away everything rendered so far (used when the engine restarted
   * and the answer has to be generated again from scratch).
   */
  reset() {
    this._clearTimer();
    this.text = "";
    this.stableLen = 0;
    this.stableEl.innerHTML = "";
    this.tailEl.innerHTML = this.placeholder || "";
    this.lastPaint = 0;
  }

  /** Stop without touching the DOM (the caller replaces the node). */
  cancel() {
    this.finished = true;
    this._clearTimer();
    this.host.classList.remove("streaming");
    this.caretEl?.remove();
  }

  _clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
