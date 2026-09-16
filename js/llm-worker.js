// ─────────────────────────────────────────────────────────────
// OffChat · llm-worker.js — Web Worker shielding the UI from inference.
// Heavy compute and token streaming happen off the main thread,
// keeping animations and typing smooth even on weak phones.
// Protocol: { reqId, cmd, payload } → { reqId, event, data }.
//
// Performance notes:
//  • engine.js is imported LAZILY (the worker answers `ping` instantly,
//    so a slow device is not stuck parsing the engine at startup),
//  • token deltas are BATCHED (~70 ms) before crossing the thread
//    boundary — the UI paints identically, but with far fewer
//    postMessage round trips (a real cost on budget phones).
// ─────────────────────────────────────────────────────────────

let engine = null;
let enginePromise = null;

function getEngine() {
  enginePromise ||= import("./engine.js")
    .then((mod) => {
      engine = new mod.Engine();
      return engine;
    })
    .catch((err) => {
      enginePromise = null; // let a later call retry a failed import
      throw err;
    });
  return enginePromise;
}

function post(reqId, event, data) {
  postMessage({ reqId, event, data });
}

// ── Batched token streaming ──────────────────────────────────
const TOKEN_FLUSH_MS = 70;
const TOKEN_FLUSH_CHARS = 480;
const buffers = new Map(); // reqId -> { text, length, timer }

function flushTokens(reqId) {
  const b = buffers.get(reqId);
  if (!b) return;
  if (b.timer) {
    clearTimeout(b.timer);
    b.timer = null;
  }
  buffers.delete(reqId);
  if (b.text) post(reqId, "token", { delta: b.text, length: b.length });
}

/** Flush every pending batch (abort/error paths must not drop text). */
function flushAllTokens() {
  for (const id of [...buffers.keys()]) flushTokens(id);
}

function pushToken(reqId, delta, length) {
  let b = buffers.get(reqId);
  if (!b) {
    b = { text: "", length: 0, timer: null };
    b.timer = setTimeout(() => flushTokens(reqId), TOKEN_FLUSH_MS);
    buffers.set(reqId, b);
  }
  b.text += delta;
  b.length = length;
  if (b.text.length >= TOKEN_FLUSH_CHARS) flushTokens(reqId);
}

onmessage = async (e) => {
  const { reqId, cmd, payload = {} } = e.data || {};
  if (reqId == null) return;
  try {
    switch (cmd) {
      case "ping": {
        const st = engine ? engine.state() : { kind: null, modelId: null, loaded: false };
        post(reqId, "done", { pong: true, ...st });
        break;
      }

      case "loadWebLLM": {
        const eng = await getEngine();
        const r = await eng.loadWebLLM({
          ...payload,
          onProgress: (p) => post(reqId, "progress", p),
        });
        post(reqId, "done", r);
        break;
      }

      case "loadTransformers": {
        const eng = await getEngine();
        const r = await eng.loadTransformers({
          ...payload,
          onProgress: (p) => post(reqId, "progress", p),
        });
        post(reqId, "done", r);
        break;
      }

      case "chat": {
        const eng = await getEngine();
        const { messages, options = {} } = payload;
        const onToken = (delta, full) => pushToken(reqId, delta, (full || "").length);
        const r =
          eng.kind === "webllm"
            ? await eng.generateWebLLM(messages, { ...options, onToken })
            : await eng.generateTransformers(messages, { ...options, onToken });
        flushTokens(reqId);
        post(reqId, "done", r);
        break;
      }

      case "abort": {
        engine?.abort();
        flushAllTokens();
        post(reqId, "done", { aborted: true });
        break;
      }

      case "unload": {
        await engine?.unload();
        post(reqId, "done", { unloaded: true });
        break;
      }

      case "state": {
        post(reqId, "done", engine ? engine.state() : { kind: null, modelId: null, loaded: false });
        break;
      }

      default:
        post(reqId, "error", { message: `Unknown command: ${cmd}` });
    }
  } catch (err) {
    flushAllTokens();
    post(reqId, "error", {
      message: String(err?.message || err || "Unknown engine error"),
    });
  }
};
