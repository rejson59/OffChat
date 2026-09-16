// ─────────────────────────────────────────────────────────────
// OffChat · resilience.js — crash resistance helpers.
//
// Everything here exists for one reason: a weak device can lose the
// page (OOM, GPU device lost, the OS killing a background tab) at any
// moment. Nothing the user typed or waited for should disappear, and
// memory must be released before the next crash happens.
//
//  • Draft        — the unsent composer text survives a crash/reload.
//  • BusyMark     — tells the next launch that a generation died
//                   mid-flight, so its partial answer can be resumed.
//  • IdleUnloader — releases the model from GPU/RAM after a while
//                   (the single most effective way to avoid OOM kills
//                   on phones), counting time spent in the background.
// ─────────────────────────────────────────────────────────────

const DRAFT_KEY = "offchat.draft.v1";
const BUSY_KEY = "offchat.busy.v1";

/** localStorage can throw (private mode, quota) — never let that bubble. */
function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch { /* ignore */ }
}

// ── Composer draft ────────────────────────────────────────────
export const Draft = {
  /** Save the unsent message (called from a debounced input handler). */
  save(threadId, text) {
    if (!text) return removeKey(DRAFT_KEY);
    writeJSON(DRAFT_KEY, { threadId: threadId || null, text, ts: Date.now() });
  },

  /** Read it back; ignores ancient drafts (a week) and empty text. */
  read(maxAgeMs = 7 * 86400000) {
    const d = readJSON(DRAFT_KEY);
    if (!d || typeof d.text !== "string" || !d.text) return null;
    if (d.ts && Date.now() - d.ts > maxAgeMs) return null;
    return d;
  },

  clear() {
    removeKey(DRAFT_KEY);
  },
};

// ── Interrupted generation ────────────────────────────────────
export const BusyMark = {
  /** Called right before the engine starts producing tokens. */
  set(info) {
    writeJSON(BUSY_KEY, { ...info, startedAt: Date.now() });
  },

  /** Called when the generation finished (or was stopped on purpose). */
  clear() {
    removeKey(BUSY_KEY);
  },

  /**
   * Left-over marker from a previous session → the page died while the
   * model was answering. Returns null when there is nothing to recover.
   */
  read(maxAgeMs = 6 * 3600000) {
    const b = readJSON(BUSY_KEY);
    if (!b || !b.startedAt) return null;
    if (Date.now() - b.startedAt > maxAgeMs) {
      removeKey(BUSY_KEY);
      return null;
    }
    return b;
  },
};

/** Is this stored message the tail of a generation that never finished? */
export function isInterruptedMessage(stats) {
  return !!(stats && (stats.streaming || stats.interrupted));
}

/** Stats patch that closes a partial answer (keeps the Continue button). */
export function closedPartialStats(stats) {
  const next = { ...(stats || {}) };
  next.streaming = false;
  next.interrupted = true;
  next.cutOff = true;
  return next;
}

// ── Idle unload ───────────────────────────────────────────────
/**
 * Watches "no AI activity" time and releases the model when it runs
 * out. Wall-clock time spent in a hidden tab counts too (timers are
 * throttled there, so we measure with Date.now()).
 */
export class IdleUnloader {
  /**
   * @param {object} opts
   * @param {() => number} opts.getTimeoutMs 0/negative disables it
   * @param {() => void}  opts.onIdle
   * @param {() => boolean} [opts.isBusy] true while downloading/generating
   */
  constructor({ getTimeoutMs, onIdle, isBusy = () => false }) {
    this.getTimeoutMs = getTimeoutMs;
    this.onIdle = onIdle;
    this.isBusy = isBusy;
    this.lastActive = Date.now();
    this.hiddenSince = 0;
    this.timer = null;
    this.disabled = false;

    this._onVisible = () => {
      if (document.hidden) {
        this.hiddenSince = Date.now();
        this._clear();
      } else {
        const away = this.hiddenSince ? Date.now() - this.hiddenSince : 0;
        this.hiddenSince = 0;
        const timeout = this.getTimeoutMs();
        if (timeout > 0 && away >= timeout && !this.isBusy()) {
          this.lastActive = Date.now();
          this.onIdle?.();
        }
        this.touch();
      }
    };
    document.addEventListener("visibilitychange", this._onVisible);
  }

  /** Something happened (a token, a send, a click) — restart the countdown. */
  touch() {
    this.lastActive = Date.now();
    this._schedule();
  }

  /** Re-read the timeout (the user changed the setting). */
  refresh() {
    this._schedule();
  }

  destroy() {
    this._clear();
    document.removeEventListener("visibilitychange", this._onVisible);
  }

  _clear() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  _schedule() {
    this._clear();
    const timeout = this.getTimeoutMs();
    if (!(timeout > 0) || this.disabled || document.hidden || this.isBusy()) return;
    const left = timeout - (Date.now() - this.lastActive);
    if (left <= 0) {
      this.onIdle?.();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.isBusy()) return this._schedule();
      this.lastActive = Date.now();
      this.onIdle?.();
    }, left);
  }
}
