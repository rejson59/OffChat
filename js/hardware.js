// ─────────────────────────────────────────────────────────────
// OffChat · hardware.js — device capability detection
// and recommending a model that fits the memory limits.
// ─────────────────────────────────────────────────────────────

/**
 * Hardware probe. Never throws — returns a best-effort report.
 * Goal: a phone with 3 GB RAM must GET a model that won't crash it.
 */
export async function probeHardware() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const coarse = globalThis.matchMedia?.("(pointer: coarse)").matches ?? false;
  const scr = globalThis.screen || {};
  const smallScreen = Math.min(scr.width || 9999, scr.height || 9999) < 768;
  const mobile = /Mobile|Android|iPhone|iPad/.test(ua) || (coarse && smallScreen);

  const hw = {
    mobile, isIOS, isAndroid,
    cores: navigator.hardwareConcurrency || 4,
    ramGB: 4, ramSource: "estimate",
    webgpu: { supported: false, f16: false, maxBufferMB: 0, name: "", reason: "" },
    storage: null, connection: null,
    crossIsolated: !!globalThis.crossOriginIsolated,
    serviceWorker: "serviceWorker" in navigator,
    worker: typeof Worker !== "undefined",
    opfs: !!navigator.storage?.getDirectory,
    ts: Date.now(),
  };

  // --- RAM ---
  if (navigator.deviceMemory) {
    hw.ramGB = navigator.deviceMemory;
    hw.ramSource = "deviceMemory";
  } else {
    // No API (Firefox/Safari) → cautious assumption by device class.
    hw.ramGB = mobile ? 4 : 8;
    hw.ramSource = "estimate";
  }

  // --- WebGPU ---
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: "high-performance",
      }).catch(() => null);
      if (adapter) {
        const features = adapter.features;
        hw.webgpu.supported = true;
        hw.webgpu.f16 = !!(features && features.has && features.has("shader-f16"));
        const lim = adapter.limits || {};
        if (lim.maxStorageBufferBindingSize) {
          hw.webgpu.maxBufferMB = Math.round(lim.maxStorageBufferBindingSize / 1048576);
        }
        try {
          const info = adapter.info || null; // Chrome: GPUAdapterInfo
          if (info) hw.webgpu.name = info.device || info.description || "";
        } catch { /* ignore */ }
      } else {
        hw.webgpu.reason = "No WebGPU adapter";
      }
    } else {
      hw.webgpu.reason = "Browser has no WebGPU support";
    }
  } catch (e) {
    hw.webgpu.reason = String(e?.message || e);
  }

  // --- Storage (room for the model cache) ---
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      hw.storage = {
        quotaMB: Math.round((est.quota || 0) / 1048576),
        usageMB: Math.round((est.usage || 0) / 1048576),
        freeMB: Math.round(((est.quota || 0) - (est.usage || 0)) / 1048576),
      };
    }
  } catch { /* ignore */ }

  // --- Network (data saver) ---
  try {
    const c = navigator.connection;
    if (c) {
      hw.connection = {
        saveData: !!c.saveData,
        effectiveType: c.effectiveType || "",
        downlink: c.downlink || 0,
      };
    }
  } catch { /* ignore */ }

  return hw;
}

/**
 * Is this a weak, crash-prone device? Used by Safe Mode ("auto")
 * to pre-emptively simplify visuals and cap memory usage.
 */
export function isWeakDevice(hw) {
  if (!hw) return false;
  if (hw.mobile && (hw.ramGB <= 3 || hw.cores <= 4)) return true;
  // No GPU at all + little RAM → the CPU path is also fragile.
  if (!hw.webgpu.supported && hw.mobile && hw.ramGB <= 4) return true;
  return false;
}

/**
 * Memory budget (MB) for model weights + KV cache.
 * Conservative: a mobile GPU usually crashes around ~1–1.5 GB,
 * desktop Chrome around ~4 GB per tab. We keep a wide margin.
 */
export function computeBudgetMB(hw) {
  const ram = hw.ramGB || 4;
  let budget;
  if (hw.mobile) {
    if (ram >= 8) budget = 2600;
    else if (ram >= 6) budget = 2200;
    else if (ram >= 4) budget = 1750;
    else budget = 1050; // 3 GB and less — tiny models only
  } else {
    if (ram >= 16) budget = 5200;
    else if (ram >= 12) budget = 4600;
    else if (ram >= 8) budget = 3800;
    else if (ram >= 4) budget = 2400;
    else budget = 1500;
  }
  if (hw.connection?.saveData) budget = Math.min(budget, 1750);
  if (hw.isIOS && !hw.webgpu.supported) budget = Math.min(budget, 900);
  return budget;
}

function scoreWeb(m) {
  // Recommendation order: quality → stability → bigger (better) model.
  return [m.quality, m.stable ? 1 : 0, m.vramMB];
}

function cmpScore(a, b) {
  const sa = scoreWeb(a), sb = scoreWeb(b);
  for (let i = 0; i < sa.length; i++) {
    if (sb[i] !== sa[i]) return sb[i] - sa[i];
  }
  return 0;
}

/**
 * Model recommendation: returns the budget, the recommended key,
 * a ranking and warnings to show the user.
 */
export function recommendModels(hw, webCatalog, wasmCatalog) {
  const budgetMB = computeBudgetMB(hw);
  const warnings = [];

  if (!hw.webgpu.supported) {
    warnings.push({
      icon: "warn",
      text: "This device/browser has no WebGPU — we will use the slower CPU engine (WASM). " +
        "On Android we recommend Chrome 121+, on desktop Chrome/Edge 113+.",
    });
  } else if (!hw.webgpu.f16) {
    warnings.push({
      icon: "info",
      text: "Your GPU has no shader-f16 support — F16 models will automatically switch to a q4f32 build.",
    });
  }
  if (hw.ramSource === "estimate") {
    warnings.push({
      icon: "info",
      text: `Your browser doesn't report RAM size — we cautiously assumed ~${hw.ramGB} GB. ` +
        "You can still pick a bigger model manually.",
    });
  }
  if (hw.storage && hw.storage.freeMB > 0 && hw.storage.freeMB < 1500) {
    warnings.push({
      icon: "warn",
      text: `Low free space (${hw.storage.freeMB} MB) — bigger models may fail to download.`,
    });
  }
  if (hw.connection?.saveData) {
    warnings.push({
      icon: "info",
      text: "Data-saver mode detected — we recommend the smallest models.",
    });
  }
  if (isWeakDevice(hw)) {
    warnings.push({
      icon: "warn",
      text: "This looks like a low-end device — Safe Mode is recommended (simplified visuals, smaller memory footprint).",
    });
  }

  // --- WASM path (no WebGPU) ---
  if (!hw.webgpu.supported) {
    const fits = (m) => m.vramMB * 1.1 <= budgetMB;
    const ranked = [...wasmCatalog].sort((a, b) => {
      // Prefer better quality, then smaller (faster on CPU).
      if (b.quality !== a.quality) return b.quality - a.quality;
      return a.vramMB - b.vramMB;
    });
    const ok = ranked.filter(fits);
    const recommended = (ok[0] || ranked[0]).key;
    return {
      mode: "wasm", budgetMB, recommended, warnings,
      ranked: ranked.map((m) => ({ key: m.key, fits: fits(m) })),
    };
  }

  // --- WebGPU path ---
  // needsF16 doesn't disqualify — the engine swaps in an f32 build
  // (q4f16_1→q4f32_1 / q0f16→q0f32) when shader-f16 is missing.
  const fits = (m) => m.vramMB * 1.12 <= budgetMB;

  const ranked = [...webCatalog].sort(cmpScore);
  const ok = ranked.filter((m) => m.vramMB * 1.12 <= budgetMB);
  let recommended;
  if (ok.length) {
    // Best quality within budget; ties broken by stability and size.
    recommended = ok[0].key;
  } else {
    // Nothing fits (extreme edge case) — smallest + a warning.
    const smallest = [...webCatalog].sort((a, b) => a.vramMB - b.vramMB)[0];
    recommended = smallest.key;
    warnings.push({
      icon: "warn",
      text: "Very little memory — we picked the smallest model. Close other tabs to avoid crashing the page.",
    });
  }
  return {
    mode: "webgpu", budgetMB, recommended, warnings,
    ranked: ranked.map((m) => ({ key: m.key, fits: fits(m) })),
  };
}

/**
 * KV context window for memory saving (0 = the model's default).
 * `ctxCap` comes from Settings: auto | 1024 | 2048 | 4096 | full.
 */
export function suggestContextWindow(hw, model, ctxCap = "auto", safeActive = false) {
  if (ctxCap === "full") return 0;
  if (ctxCap === "1024" || ctxCap === "2048" || ctxCap === "4096") {
    return Number(ctxCap);
  }
  // Auto: be gentle on phones, low-RAM devices and Safe Mode.
  if (model.engine !== "webllm") return 2048;
  if (safeActive) return 2048;
  if (hw.mobile || hw.ramGB <= 4) return 2048;
  return 0;
}

export function deviceSummary(hw) {
  const parts = [];
  parts.push(hw.mobile ? (hw.isIOS ? "iPhone/iPad" : hw.isAndroid ? "Android" : "Mobile") : "Computer");
  parts.push(`${hw.cores} CPU cores`);
  parts.push(`~${hw.ramGB} GB RAM`);
  parts.push(hw.webgpu.supported ? `WebGPU ✓${hw.webgpu.f16 ? " + F16" : ""}` : "WebGPU ✗ → WASM");
  return parts.join(" · ");
}
