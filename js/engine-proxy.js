// ─────────────────────────────────────────────────────────────
// OffChat · engine-proxy.js — engine facade.
// Tries a Web Worker (smooth UI); when the worker is unavailable
// (old browser, CSP, file://) or dies mid-flight, it falls back to the
// main thread. The API is identical in both modes.
//
// Crash handling: if the worker disappears (OOM kill, GPU process
// crash), the proxy rebuilds the engine on the main thread and RELOADS
// the same model from the local cache before retrying the failed call,
// so a crash turns into a short pause instead of a broken chat.
// ─────────────────────────────────────────────────────────────

let engineModule = null;
/** engine.js is only needed once we actually run inference (lazy boot). */
async function loadEngineClass() {
  engineModule ||= await import("./engine.js");
  return engineModule.Engine;
}

export class EngineProxy {
  /**
   * @param {object} [hooks]
   * @param {(info: {reason: string}) => void} [hooks.onCrash] worker died
   * @param {(info: {reason: string}) => void} [hooks.onRecovering]
   */
  constructor(hooks = {}) {
    this.mode = null; // 'worker' | 'direct'
    this.worker = null;
    this.direct = null;
    this.reqSeq = 0;
    this.pending = new Map();
    this.initPromise = null;
    this.workerBroken = false;
    this.lastLoad = null; // { type, args } — used for transparent reloads
    this.hooks = hooks;
    this.recovering = null;
    this._wdTimer = null;
    this._wdFails = 0;
    this._lastSeen = 0;
    this._brokenAt = 0;
  }

  init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    return this.initPromise;
  }

  async _init() {
    // 1) try the worker (keeps inference off the UI thread)
    if (!this.workerBroken && typeof Worker !== "undefined" && typeof document !== "undefined") {
      try {
        const worker = new Worker(new URL("./llm-worker.js", import.meta.url), {
          type: "module",
        });
        this.worker = worker;
        worker.onmessage = (e) => this._onMessage(e.data);
        worker.onerror = () => this._breakWorker("worker error");
        worker.onmessageerror = () => this._breakWorker("worker message error");
        this._lastSeen = Date.now();
        await this._workerCall("ping", {}, { timeoutMs: 8000 });
        this.mode = "worker";
        this._startWatchdog();
        return "worker";
      } catch {
        this._breakWorker("worker failed to start", { silent: true });
      }
    }
    // 2) fallback: main thread
    await this._ensureDirect();
    this.mode = "direct";
    return "direct";
  }

  async _ensureDirect() {
    if (!this.direct) {
      const Engine = await loadEngineClass();
      this.direct = new Engine();
    }
    return this.direct;
  }

  _breakWorker(reason = "worker unavailable", { silent = false } = {}) {
    this.workerBroken = true;
    this._brokenAt = Date.now();
    this._stopWatchdog();
    try { this.worker?.terminate(); } catch { /* ignore */ }
    this.worker = null;
    if (this.mode === "worker") this.mode = null;
    for (const [, p] of this.pending) {
      p.reject(new Error("ENGINE_WORKER_GONE"));
    }
    this.pending.clear();
    if (!silent) this.hooks.onCrash?.({ reason });
  }

  /**
   * Watchdog against a silent worker death (OOM kill / GPU process
   * crash). It looks at how long ago we last HEARD from the worker,
   * so long downloads and slow generations never trigger it.
   */
  _startWatchdog() {
    this._stopWatchdog();
    if (!this.worker || this.workerBroken) return;
    this._wdFails = 0;
    this._wdTimer = setInterval(() => {
      if (!this.worker || this.workerBroken) {
        this._stopWatchdog();
        return;
      }
      if (Date.now() - this._lastSeen < 45000) return; // still alive
      this._workerCall("ping", {}, { timeoutMs: 12000 }).catch(() => {
        this._wdFails++;
        if (this._wdFails >= 2) this._breakWorker("worker stopped responding");
      });
    }, 15000);
  }

  _stopWatchdog() {
    if (this._wdTimer) {
      clearInterval(this._wdTimer);
      this._wdTimer = null;
    }
  }

  _onMessage(msg) {
    this._lastSeen = Date.now();
    if (!msg || msg.reqId == null) return;
    const p = this.pending.get(msg.reqId);
    if (!p) return;
    if (msg.event === "progress") p.onProgress?.(msg.data);
    else if (msg.event === "token") p.onToken?.(msg.data?.delta || "", msg.data);
    else if (msg.event === "done") {
      this.pending.delete(msg.reqId);
      clearTimeout(p.timer);
      p.resolve(msg.data);
    } else if (msg.event === "error") {
      this.pending.delete(msg.reqId);
      clearTimeout(p.timer);
      const err = new Error(msg.data?.message || "AI engine error");
      err.fromEngine = true; // a model error, not a transport failure
      p.reject(err);
    }
  }

  _workerCall(cmd, payload, { onProgress, onToken, timeoutMs = 0 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("ENGINE_WORKER_GONE"));
        return;
      }
      const reqId = ++this.reqSeq;
      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(reqId);
          reject(new Error("ENGINE_TIMEOUT"));
        }, timeoutMs);
      }
      this.pending.set(reqId, { resolve, reject, onProgress, onToken, timer });
      try {
        this.worker.postMessage({ reqId, cmd, payload });
      } catch (e) {
        this.pending.delete(reqId);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  /**
   * Rebuild a working engine after the worker died and reload the model
   * that was in use (weights come from the local cache, so this is quick).
   */
  _recover(reason) {
    if (this.recovering) return this.recovering;
    this.hooks.onRecovering?.({ reason });
    this.recovering = (async () => {
      try {
        await this._ensureDirect();
        const load = this.lastLoad;
        if (!load) return;
        const args = { ...load.args, onProgress: load.args.onProgress };
        if (load.type === "webllm") await this.direct.loadWebLLM(args);
        else await this.direct.loadTransformers(args);
      } catch {
        /* the retried call will surface a readable error */
      } finally {
        this.recovering = null;
      }
    })();
    return this.recovering;
  }

  /** Run with automatic worker → direct fallback (with a model reload). */
  async _run(cmd, payload, handlers, directFn) {
    await this.init();
    if (this.mode === "worker" && this.worker && !this.workerBroken) {
      try {
        return await this._workerCall(cmd, payload, handlers);
      } catch (e) {
        const msg = String(e?.message || "");
        const transportFailure =
          !e?.fromEngine &&
          (msg === "ENGINE_TIMEOUT" || msg === "ENGINE_WORKER_GONE" || this.workerBroken);
        if (!transportFailure) throw e;
        this._breakWorker("worker lost during an operation", { silent: true });
        // The caller has to drop whatever the dead worker already streamed,
        // otherwise the retried answer would be glued onto the fragment.
        handlers?.onRestart?.();
        await this._recover("worker lost");
      }
    }
    await this._ensureDirect();
    if (this.workerBroken) this.mode = "direct";
    return directFn(this.direct);
  }

  _remember(type, args) {
    this.lastLoad = { type, args };
  }

  loadWebLLM(args) {
    const { onProgress, ...rest } = args;
    return this._run(
      "loadWebLLM", rest, { onProgress },
      (eng) => eng.loadWebLLM({ ...rest, onProgress })
    ).then(async (res) => {
      this._remember("webllm", { ...rest, onProgress });
      // make sure the engine that actually did the work is the one we keep
      return res;
    });
  }

  loadTransformers(args) {
    const { onProgress, ...rest } = args;
    return this._run(
      "loadTransformers", rest, { onProgress },
      (eng) => eng.loadTransformers({ ...rest, onProgress })
    ).then((res) => {
      this._remember("transformers", { ...rest, onProgress });
      return res;
    });
  }

  chat(messages, options = {}) {
    const { onToken, onRestart, ...rest } = options;
    return this._run(
      "chat", { messages, options: rest }, { onToken, onRestart },
      (eng) => {
        if (eng.kind === "webllm") {
          return eng.generateWebLLM(messages, { ...rest, onToken });
        }
        if (eng.kind === "transformers") {
          return eng.generateTransformers(messages, { ...rest, onToken });
        }
        throw new Error(
          "The engine lost its model (a crash or an interrupted download) — open the model list and pick it again."
        );
      }
    );
  }

  async abort() {
    if (this.mode === "worker" && this.worker && !this.workerBroken) {
      try { await this._workerCall("abort", {}, { timeoutMs: 3000 }); } catch { /* ignore */ }
    }
    this.direct?.abort();
  }

  async unload() {
    this.lastLoad = null; // nothing to restore — the user freed the model
    if (this.mode === "worker" && this.worker && !this.workerBroken) {
      try { await this._workerCall("unload", {}, { timeoutMs: 10000 }); } catch { /* ignore */ }
    }
    await this.direct?.unload?.().catch(() => {});
  }

  /** Real engine state (a worker round trip in worker mode). */
  async state() {
    await this.init();
    if (this.mode === "worker" && this.worker && !this.workerBroken) {
      try {
        return await this._workerCall("state", {}, { timeoutMs: 5000 });
      } catch { /* fall through to direct */ }
    }
    return this.direct?.state?.() || { kind: null, modelId: null, loaded: false };
  }

  /**
   * Cheap liveness probe used when the tab becomes visible again: a
   * backgrounded tab on Android is often killed silently.
   */
  async health() {
    try {
      const st = await this.state();
      return { alive: true, ...st };
    } catch {
      return { alive: false, kind: null, modelId: null, loaded: false };
    }
  }
}
