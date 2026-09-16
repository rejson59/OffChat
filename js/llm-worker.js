// ─────────────────────────────────────────────────────────────
// OffChat · llm-worker.js — Web Worker odgradzający UI od inference.
// Ciężkie obliczenia i streaming tokenów dzieją się poza wątkiem głównym,
// dzięki czemu animacje i pisanie pozostają płynne nawet na słabych tel.
// Protokół: { reqId, cmd, payload } → { reqId, event, data }.
// ─────────────────────────────────────────────────────────────
import { Engine } from "./engine.js";

const engine = new Engine();

function post(reqId, event, data) {
  postMessage({ reqId, event, data });
}

onmessage = async (e) => {
  const { reqId, cmd, payload = {} } = e.data || {};
  if (reqId == null) return;
  try {
    switch (cmd) {
      case "ping":
        post(reqId, "done", { pong: true, ...engine.state() });
        break;

      case "loadWebLLM": {
        const r = await engine.loadWebLLM({
          ...payload,
          onProgress: (p) => post(reqId, "progress", p),
        });
        post(reqId, "done", r);
        break;
      }

      case "loadTransformers": {
        const r = await engine.loadTransformers({
          ...payload,
          onProgress: (p) => post(reqId, "progress", p),
        });
        post(reqId, "done", r);
        break;
      }

      case "chat": {
        const { messages, options = {} } = payload;
        const onToken = (delta, full) => post(reqId, "token", { delta, length: full.length });
        const r =
          engine.kind === "webllm"
            ? await engine.generateWebLLM(messages, { ...options, onToken })
            : await engine.generateTransformers(messages, { ...options, onToken });
        post(reqId, "done", r);
        break;
      }

      case "abort":
        engine.abort();
        post(reqId, "done", { aborted: true });
        break;

      case "unload":
        await engine.unload();
        post(reqId, "done", { unloaded: true });
        break;

      case "state":
        post(reqId, "done", engine.state());
        break;

      default:
        post(reqId, "error", { message: `Nieznana komenda: ${cmd}` });
    }
  } catch (err) {
    post(reqId, "error", {
      message: String(err?.message || err || "Nieznany błąd silnika"),
    });
  }
};
