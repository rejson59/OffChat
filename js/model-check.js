// ─────────────────────────────────────────────────────────────
// OffChat · model-check.js — model preflight + error translation.
//
// WHY THIS EXISTS
// Hugging Face answers a request for a repository that does not exist
// (or is private / gated) with **HTTP 401 Unauthorized** — not 404.
// Transformers.js then raises:
//   `Unauthorized access to file: "https://huggingface.co/…/resolve/main/…"`
// which looks like an account problem and tells the user nothing —
// while the real cause is simply a wrong repository id (e.g. a model
// whose canonical name is `…-ONNX`, not the name we asked for).
//
// This module:
//   1) verifies a model BEFORE a single weight is downloaded,
//   2) repairs legacy/wrong repo ids automatically (…-ONNX renames),
//   3) picks the dtype variant that really exists in the repository,
//   4) turns cryptic library errors into precise, actionable codes.
//
// Everything is dependency-free and accepts injected `fetchImpl` /
// `storage` so the test suite can drive it in Node.
// ─────────────────────────────────────────────────────────────

export const HF = "https://huggingface.co";

/** dtype → onnx file suffix (mirrors transformers.js 3.x mapping). */
export const DTYPE_SUFFIX = {
  q4: "_q4",
  q8: "_quantized",
  q4f16: "_q4f16",
  fp16: "_fp16",
  fp32: "",
};

/**
 * Repositories verified with the Hub tree API on 2026-09-16 — each one
 * exists, is public, and really publishes the onnx variants listed in
 * `config.WASM_CATALOG`. A model may only ship if it is in this set,
 * because the Hub answers 401 (not 404) for anything else.
 */
export const VERIFIED_REPOS = new Set([
  "HuggingFaceTB/SmolLM2-135M-Instruct",
  "HuggingFaceTB/SmolLM2-360M-Instruct",
  "HuggingFaceTB/SmolLM2-1.7B-Instruct",
  "onnx-community/gemma-3-270m-it-ONNX",
  "onnx-community/Qwen2.5-0.5B-Instruct",
  "onnx-community/Qwen2.5-1.5B-Instruct",
  "onnx-community/Qwen3-0.6B-ONNX",
  "onnx-community/TinyLlama-1.1B-Chat-v1.0-ONNX",
  "onnx-community/Llama-3.2-1B-Instruct-ONNX",
]);

/** Known repository renames: old/legacy id → canonical id. */
export const MODEL_REPO_FIX = {
  "onnx-community/TinyLlama-1.1B-Chat-v1.0":
    "onnx-community/TinyLlama-1.1B-Chat-v1.0-ONNX",
  "onnx-community/Llama-3.2-1B-Instruct": "onnx-community/Llama-3.2-1B-Instruct-ONNX",
  "onnx-community/Qwen2.5-0.5B-Instruct": "onnx-community/Qwen2.5-0.5B-Instruct",
  "onnx-community/Qwen2.5-1.5B-Instruct": "onnx-community/Qwen2.5-1.5B-Instruct",
};

/** How long a successful/failed preflight is remembered (ms). */
export const CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = "offchat-modelcheck-v1";

/** `onnx/model_q4.onnx` for dtype `q4`. */
export function onnxFileFor(dtype) {
  const suffix = DTYPE_SUFFIX[dtype];
  if (suffix === undefined) return null;
  return `onnx/model${suffix}.onnx`;
}

/**
 * Pick the first dtype (in the model's preference order) whose main
 * weight file really exists in the repository, plus its external-data
 * shards (gemma-3 / Llama-3.2 repos keep the weights in `…onnx_data`).
 *
 * @param {string[]} dtypes preference order, e.g. ["q4","q8","q4f16"]
 * @param {Iterable<string>} fileNames paths returned by the HF tree API
 * @returns {{dtype:string, main:string, data:string[], bytes:number}|null}
 */
export function pickDtype(dtypes, fileNames) {
  const sizes = fileNames instanceof Map ? fileNames : null;
  const names = sizes ? new Set(sizes.keys()) : new Set(fileNames || []);
  for (const dtype of dtypes || []) {
    const main = onnxFileFor(dtype);
    if (!main || !names.has(main)) continue;
    const data = [];
    for (let i = 0; ; i++) {
      const name = `${main}_data${i === 0 ? "" : "_" + i}`;
      if (!names.has(name)) break;
      data.push(name);
      if (i > 99) break; // transformers.js caps chunks at 100
    }
    let bytes = 0;
    if (sizes) {
      for (const f of [main, ...data]) bytes += Number(sizes.get(f) || 0);
    }
    return { dtype, main, data, bytes };
  }
  return null;
}

/**
 * Translate any engine/library error into a stable code the UI can act on.
 * @returns {{code:string, status:number|null, url:string|null, raw:string}}
 */
export function classifyError(err) {
  const raw = String((err && (err.message || err)) || "");
  let status = null;
  // The exact strings transformers.js builds from HTTP statuses.
  const STATUS_TEXT = [
    [400, /Bad request error occurred while trying to load file/i],
    [401, /Unauthorized access to file/i],
    [403, /Forbidden access to file/i],
    [404, /Could not locate file/i],
    [408, /Request timeout error occurred while trying to load file/i],
    [500, /Internal server error error occurred while trying to load file/i],
    [502, /Bad gateway error occurred while trying to load file/i],
    [503, /Service unavailable error occurred while trying to load file/i],
    [504, /Gateway timeout error occurred while trying to load file/i],
  ];
  for (const [code, re] of STATUS_TEXT) {
    if (re.test(raw)) {
      status = code;
      break;
    }
  }
  if (status === null) {
    const m = raw.match(/Error \((\d{3})\) occurred while trying to load file/);
    if (m) status = Number(m[1]);
  }
  const url = (raw.match(/"(https?:\/\/[^"]+)"/) || [])[1] || null;

  let code = "unknown";
  if (status === 401) code = "unauthorized";
  else if (status === 403) code = "forbidden";
  else if (status === 404) code = "missing-file";
  else if (status === 400) code = "bad-request";
  else if (status !== null && status >= 500) code = "server";
  else if (/does not support fp16|fp16 support|shader-f16/i.test(raw)) code = "f16";
  else if (/device lost|lost device|webgpu|GPUDevice|adapter/i.test(raw)) code = "gpu";
  else if (/out of memory|\bOOM\b|allocation failed|failed to allocate/i.test(raw)) code = "memory";
  else if (/MODEL_NOT_FOUND/i.test(raw)) code = "not-in-build";
  else if (/network|fetch|Failed to fetch|Load failed|networkerror|net::|ERR_/i.test(raw)) {
    code = isOnline() ? "network" : "offline";
  } else if (/quota|storage/i.test(raw)) code = "storage";
  return { code, status, url, raw };
}

function isOnline() {
  try {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  } catch {
    return true;
  }
}

function store() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function readCache(storage) {
  try {
    const raw = (storage || store())?.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCache(storage, obj) {
  try {
    (storage || store())?.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {
    /* quota / private mode — preflight simply runs again next time */
  }
}

/** One JSON request to the Hub, with a hard timeout. Never throws. */
export async function hfJson(url, { fetchImpl, timeoutMs = 9000, noStore = false } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return { ok: false, status: 0, data: null };
  let ctl = null;
  let timer = null;
  try {
    if (typeof AbortController !== "undefined") {
      ctl = new AbortController();
      timer = setTimeout(() => ctl.abort(), timeoutMs);
    }
    const res = await f(url, { signal: ctl?.signal, cache: noStore ? "no-store" : "default" });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON body (204, CDN page…) */
    }
    return { ok: !!(res && res.ok), status: res?.status || 0, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * List the files of a repository subfolder (defaults to `onnx`).
 * @returns {{ok:boolean, status:number, files:Map<string,number>}}
 */
export async function fetchRepoFiles(repo, { subdir = "onnx", fetchImpl, timeoutMs, noStore } = {}) {
  const { ok, status, data } = await hfJson(
    `${HF}/api/models/${repo}/tree/main/${subdir}`,
    { fetchImpl, timeoutMs, noStore }
  );
  const files = new Map();
  if (ok && Array.isArray(data)) {
    for (const entry of data) {
      if (entry && entry.type === "file" && entry.path) {
        files.set(entry.path, Number(entry.size || 0));
      }
    }
  }
  return { ok, status, files };
}

/** Ask the Hub for repositories whose name matches `query`. */
export async function searchRepos(query, { author = "onnx-community", fetchImpl } = {}) {
  const { ok, data } = await hfJson(
    `${HF}/api/models?author=${encodeURIComponent(author)}&search=${encodeURIComponent(query)}&limit=25`,
    { fetchImpl }
  );
  return ok && Array.isArray(data) ? data.map((m) => m?.id).filter(Boolean) : [];
}

/** Base name without the `-ONNX`/`-ONNX-GQA` export suffixes. */
export function baseName(repo) {
  const [author, name = ""] = String(repo).split("/");
  return { author, name: name.replace(/-(ONNX|onnx)(-[A-Za-z0-9]+)?$/, "") };
}

/** Candidate canonical ids for a repo that could not be read. */
export function repairCandidates(repo) {
  const out = [];
  if (MODEL_REPO_FIX[repo]) out.push(MODEL_REPO_FIX[repo]);
  const { author, name } = baseName(repo);
  for (const suffix of ["-ONNX"]) {
    const id = `${author}/${name}${suffix}`;
    if (id !== repo && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Verify a Transformers.js (WASM) model before downloading it.
 * Repairs renamed repositories and picks a dtype that truly exists.
 *
 * @returns {Promise<{ok:boolean, code?:string, status?:number, repo:string,
 *   dtype?:string, data?:string[], bytes?:number, repaired?:boolean, cached?:boolean}>}
 */
export async function probeWasmModel(model, opts = {}) {
  const { fetchImpl, storage, force = false, now = Date.now() } = opts;
  if (!model || !model.modelId) return { ok: false, code: "unknown", repo: "" };
  const declared = model.modelId;
  const cache = readCache(storage);
  const hit = cache[declared];
  if (!force && hit && now - hit.ts < CHECK_TTL_MS && hit.value) {
    return { ...hit.value, cached: true };
  }

  const tried = [];
  let lastStatus = 0;
  const scan = async (repo) => {
    tried.push(repo);
    const res = await fetchRepoFiles(repo, {
      fetchImpl,
      subdir: model.onnxSubdir || "onnx",
      noStore: !!(opts.force || opts.noStore),
    });
    if (!res.ok) {
      lastStatus = res.status || lastStatus;
      return null;
    }
    const picked = pickDtype(model.dtypes || ["q4", "q8", "q4f16"], res.files);
    if (!picked) {
      lastStatus = lastStatus || 404;
      return null;
    }
    return { repo, ...picked };
  };

  let result = await scan(declared);
  if (!result) {
    for (const candidate of repairCandidates(declared)) {
      // eslint-disable-next-line no-await-in-loop
      result = await scan(candidate);
      if (result) break;
    }
  }
  if (!result && !tried.length) lastStatus = 0;

  const value = result
    ? {
        ok: true,
        repo: result.repo,
        dtype: result.dtype,
        main: result.main,
        data: result.data,
        bytes: result.bytes,
        repaired: result.repo !== declared,
      }
    : {
        ok: false,
        code: codeForStatus(lastStatus),
        status: lastStatus,
        repo: declared,
        tried,
      };

  cache[declared] = { ts: now, value };
  writeCache(storage, cache);
  return value;
}

/** HTTP status → error code (401 means "repo missing or private" on the Hub). */
export function codeForStatus(status) {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "missing-file";
  if (status >= 500) return "server";
  if (!status) return isOnline() ? "network" : "offline";
  return "unknown";
}

/**
 * "Potato mode" — a one-click profile for very weak / very old phones.
 * Deliberately mirrors the design of config.DEFAULT_SETTINGS: every key
 * it returns is a real setting, so `saveSettings(potatoProfile())` is safe.
 */
export function potatoProfile() {
  return {
    potato: true,
    safeMode: "on",
    glass: false,
    animations: false,
    bgStyle: "solid",
    avatars: false,
    ctxCap: 1024,
    maxTokens: 192,
    idleUnload: "5",
    fontSize: 14,
  };
}

/** Should we nudge this device towards Potato mode? */
export function shouldSuggestPotato(hw) {
  if (!hw) return false;
  const ram = Number(hw.ramGB || 0);
  const cores = Number(hw.cores || 0);
  const noGpu = hw.webgpu?.supported === false;
  const lowRam = ram > 0 && ram <= 3;
  const fewCores = cores > 0 && cores <= 4;
  // A weak phone is the target. A desktop without WebGPU already gets an
  // obvious "CPU models" list, so it is not prompted again.
  if (lowRam && (fewCores || noGpu || hw.mobile)) return true;
  return Boolean(hw.mobile) && (fewCores || noGpu);
}
