// ─────────────────────────────────────────────────────────────
// OffChat · hardware.js — wykrywanie możliwości urządzenia
// i rekomendacja modelu mieszczącego się w limitach pamięci.
// ─────────────────────────────────────────────────────────────

/**
 * Sonda sprzętowa. Nigdy nie rzuca — zwraca best-effort raport.
 * Cel: telefon z 3 GB RAM musi DOSTAĆ model, który go nie wysypie.
 */
export async function probeHardware() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const smallScreen = Math.min(screen.width || 9999, screen.height || 9999) < 768;
  const mobile = /Mobile|Android|iPhone|iPad/.test(ua) || (coarse && smallScreen);

  const hw = {
    mobile, isIOS, isAndroid,
    cores: navigator.hardwareConcurrency || 4,
    ramGB: 4, ramSource: "estimate",
    webgpu: { supported: false, f16: false, maxBufferMB: 0, name: "", reason: "" },
    storage: null, connection: null,
    crossIsolated: !!window.crossOriginIsolated,
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
    // Brak API (Firefox/Safari) → ostrożne założenie wg klasy urządzenia.
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
        } catch { /* ignoruj */ }
      } else {
        hw.webgpu.reason = "Brak adaptera WebGPU";
      }
    } else {
      hw.webgpu.reason = "Przeglądarka nie wspiera WebGPU";
    }
  } catch (e) {
    hw.webgpu.reason = String(e?.message || e);
  }

  // --- Storage (miejsce na cache modeli) ---
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      hw.storage = {
        quotaMB: Math.round((est.quota || 0) / 1048576),
        usageMB: Math.round((est.usage || 0) / 1048576),
        freeMB: Math.round(((est.quota || 0) - (est.usage || 0)) / 1048576),
      };
    }
  } catch { /* ignoruj */ }

  // --- Sieć (oszczędzanie danych) ---
  try {
    const c = navigator.connection;
    if (c) {
      hw.connection = {
        saveData: !!c.saveData,
        effectiveType: c.effectiveType || "",
        downlink: c.downlink || 0,
      };
    }
  } catch { /* ignoruj */ }

  return hw;
}

/**
 * Budżet pamięci (MB) na wagi+KV cache modelu.
 * Konserwatywnie: karta mobilna wysypuje się zwykle przy ~1–1.5 GB,
 * desktopowy Chrome przy ~4 GB na kartę. Zostawiamy duży margines.
 */
export function computeBudgetMB(hw) {
  const ram = hw.ramGB || 4;
  let budget;
  if (hw.mobile) {
    if (ram >= 8) budget = 2600;
    else if (ram >= 6) budget = 2200;
    else if (ram >= 4) budget = 1750;
    else budget = 1050; // 3 GB i mniej — tylko maluchy
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
  // Sortowanie rekomendacji: polski → stabilność → większy (lepszy) model.
  return [m.pl, m.stable ? 1 : 0, m.vramMB];
}

function cmpScore(a, b) {
  const sa = scoreWeb(a), sb = scoreWeb(b);
  for (let i = 0; i < sa.length; i++) {
    if (sb[i] !== sa[i]) return sb[i] - sa[i];
  }
  return 0;
}

/**
 * Rekomendacja modeli: zwraca budżet, rekomendowany klucz,
 * ranking oraz ostrzeżenia do wyświetlenia użytkownikowi.
 */
export function recommendModels(hw, webCatalog, wasmCatalog) {
  const budgetMB = computeBudgetMB(hw);
  const warnings = [];

  if (!hw.webgpu.supported) {
    warnings.push({
      icon: "warn",
      text: "To urządzenie/przeglądarka nie ma WebGPU — użyjemy wolniejszego silnika CPU (WASM). " +
        "Na Androidzie polecamy Chrome 121+, na komputerze Chrome/Edge 113+.",
    });
  } else if (!hw.webgpu.f16) {
    warnings.push({
      icon: "info",
      text: "Twoje GPU nie wspiera shader-f16 — modele oznaczone F16 przełączą się automatycznie na wariant q4f32.",
    });
  }
  if (hw.ramSource === "estimate") {
    warnings.push({
      icon: "info",
      text: `Przeglądarka nie zdradza ilości RAM — przyjęliśmy ostrożnie ~${hw.ramGB} GB. ` +
        "Możesz ręcznie wybrać większy model.",
    });
  }
  if (hw.storage && hw.storage.freeMB > 0 && hw.storage.freeMB < 1500) {
    warnings.push({
      icon: "warn",
      text: `Mało wolnego miejsca (${hw.storage.freeMB} MB) — większe modele mogą się nie pobrać.`,
    });
  }
  if (hw.connection?.saveData) {
    warnings.push({
      icon: "info",
      text: "Wykryto tryb oszczędzania danych — polecamy najmniejsze modele.",
    });
  }

  // --- Ścieżka WASM (brak WebGPU) ---
  if (!hw.webgpu.supported) {
    const fits = (m) => m.vramMB * 1.1 <= budgetMB;
    const ranked = [...wasmCatalog].sort((a, b) => {
      // preferuj dobry polski, potem mniejszy (szybszy na CPU)
      if (b.pl !== a.pl) return b.pl - a.pl;
      return a.vramMB - b.vramMB;
    });
    const ok = ranked.filter(fits);
    const recommended = (ok[0] || ranked[0]).key;
    return {
      mode: "wasm", budgetMB, recommended, warnings,
      ranked: ranked.map((m) => ({ key: m.key, fits: fits(m) })),
    };
  }

  // --- Ścieżka WebGPU ---
  const fits = (m) =>
    m.vramMB * 1.12 <= budgetMB && (!m.needsF16 || hw.webgpu.f16 || true);
  // NOTE: needsF16 nie dyskwalifikuje — silnik sam podmieni wariant q4f32.

  const ranked = [...webCatalog].sort(cmpScore);
  const ok = ranked.filter((m) => m.vramMB * 1.12 <= budgetMB);
  let recommended;
  if (ok.length) {
    // Najlepszy polski w budżecie; przy remisie stabilny i większy.
    recommended = ok[0].key;
  } else {
    // Nic się nie mieści (skrajny przypadek) — najmniejszy + ostrzeżenie.
    const smallest = [...webCatalog].sort((a, b) => a.vramMB - b.vramMB)[0];
    recommended = smallest.key;
    warnings.push({
      icon: "warn",
      text: "Bardzo mało pamięci — wybraliśmy najmniejszy model. Zamknij inne karty, by uniknąć wysypania strony.",
    });
  }
  return {
    mode: "webgpu", budgetMB, recommended, warnings,
    ranked: ranked.map((m) => ({ key: m.key, fits: fits(m) })),
  };
}

/** Kontekst KV dla oszczędzania pamięci (0 = domyślny modelu). */
export function suggestContextWindow(hw, model, memorySaver) {
  if (!memorySaver) return 0;
  if (model.engine !== "webllm") return 2048;
  if (hw.mobile || hw.ramGB <= 4) return 2048;
  return 0;
}

export function deviceSummary(hw) {
  const parts = [];
  parts.push(hw.mobile ? (hw.isIOS ? "iPhone/iPad" : hw.isAndroid ? "Android" : "Mobile") : "Komputer");
  parts.push(`${hw.cores} rdzeni CPU`);
  parts.push(`~${hw.ramGB} GB RAM`);
  parts.push(hw.webgpu.supported ? `WebGPU ✓${hw.webgpu.f16 ? " + F16" : ""}` : "WebGPU ✗ → WASM");
  return parts.join(" · ");
}
