# 💬 OffChat

**OffChat to strona internetowa, która pozwala uruchamiać całkowicie lokalnie modele AI — z mocą dopasowaną do Twojego urządzenia. Pisz z AI z pełną prywatnością, wprost w przeglądarce!**

Lekki, statyczny czat ze Small Language Model działającym w 100% po stronie klienta. Zero backendu, zero płatnych API, zero telemetrii. Pierwsze pobranie modelu wymaga internetu — każde kolejne uruchomienie działa **w pełni offline**.

> 🎯 Cel projektu: **nawet słaby telefon z 3 GB RAM ma odpalić jakikolwiek model** — strona sama bada sprzęt i proponuje bezpieczne modele.

---

## ✨ Funkcje

- 🧠 **AI w przeglądarce** — główny silnik **WebLLM (WebGPU)**, awaryjny fallback **Transformers.js (WASM/CPU)**
- 📱 **Mobile-first** — lekki (~60 KB własnego kodu), bez frameworków, inference w Web Workerze
- 🔍 **Auto-dobór modelu** — sonda sprzętu (WebGPU, F16, RAM, rdzenie, wolne miejsce) + budżet pamięci z marginesem bezpieczeństwa
- 🇵🇱 **Polski na pierwszym miejscu** — każdy model ma ocenę jakości polszczyzny; rekomendacje preferują Qwen / Llama
- 📦 **Offline** — wagi w Cache API (lub OPFS), app-shell + biblioteki w Service Workerze
- 💾 **Trwałość** — wątki w IndexedDB, ustawienia w localStorage, eksport/import JSON
- 🪟 **Szklany UI** — glassmorphism, gradienty, płynne animacje, motyw jasny/ciemny, PWA
- 📊 **Status na żywo** — „Pobieranie modelu”, „Ładowanie do pamięci”, „Gotowy do rozmowy”, „Generowanie…” + tok/s

## 🗂️ Struktura plików

```
OffChat/
├── index.html              # aplikacja (PWA, mobile-first, PL)
├── 404.html                # fallback GitHub Pages
├── .nojekyll               # wyłącznik Jekyll na Pages
├── manifest.webmanifest    # PWA
├── sw.js                   # Service Worker (app-shell + CDN; NIE rusza wag modeli)
├── LICENSE                 # MIT
├── css/
│   └── style.css           # szklany, responsywny UI
├── js/
│   ├── app.js              # orkiestracja: boot, onboarding, czat, wątki, ustawienia
│   ├── config.js           # wersje silników, katalog modeli, domyślne ustawienia
│   ├── hardware.js         # sonda sprzętu + rekomendacje + budżet pamięci
│   ├── storage.js          # localStorage + IndexedDB + eksport/import + cache modeli
│   ├── engine.js           # silnik inference (WebLLM + Transformers.js, ładowany leniwie)
│   ├── llm-worker.js       # Web Worker odgradzający UI od obliczeń
│   ├── engine-proxy.js     # fasada: worker z fallbackiem do wątku głównego
│   ├── markdown.js         # leciutki renderer Markdown (bez zależności, anty-XSS)
│   └── ui.js               # toasty, modale, formatowanie
├── icons/                  # ikony PWA (192/512/maskable/apple/favicon/SVG)
└── .github/workflows/      # deployment na GitHub Pages
```

## 🚀 Deployment na GitHub Pages

Repo jest gotowe do wdrożenia **bez kroku build** — to czyste statyczne pliki.

**Opcja A — z brancha (najprostsza):**
1. Wypchnij kod na `main`.
2. GitHub → *Settings → Pages → Source: Deploy from a branch* → wybierz `main` i `/ (root)`.
3. Gotowe: `https://<user>.github.io/OffChat/`.

**Opcja B — przez GitHub Actions (opcjonalnie):**
1. GitHub → *Settings → Pages → Source: GitHub Actions*.
2. Utwórz ręcznie plik `.github/workflows/pages.yml` o treści (standardowy deployment statyczny):

```yaml
name: Deploy to GitHub Pages
on:
  push: { branches: ["main"] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: "pages", cancel-in-progress: false }
jobs:
  deploy:
    environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: "." }
      - id: deployment
        uses: actions/deploy-pages@v4
```

3. Każdy push na `main` wdraża stronę automatycznie.

> Wszystkie ścieżki są względne (`./`), więc działa zarówno pod `/OffChat/`, jak i na własnej domenie.

**Lokalne testy:** wystarczy statyczny serwer, np. `python3 -m http.server 8080` i adres `http://localhost:8080`.

## 🧠 Silniki i modele

| Silnik | Backend | Kiedy | Biblioteka (CDN, wersja przypięta) |
|---|---|---|---|
| **WebLLM** | WebGPU | domyślnie (Chrome/Edge 113+, Opera, Safari 26+) | `@mlc-ai/web-llm@0.2.84` (esm.sh → jsDelivr fallback) |
| **Transformers.js** | WASM/CPU | brak WebGPU (Firefox, starsze Safari, słabe GPU) | `@huggingface/transformers@3.8.1` |

Biblioteki ładują się **leniwie** — dopiero po wyborze modelu. Import próbuje kolejno kilka CDN (odporność na awarię).

### Katalog WebLLM (aktualizowalny w `js/config.js`)

| Model | Rozmiar | Pamięć | Polski | Tier |
|---|---|---|---|---|
| SmolLM2 360M | ~260 MB | 376 MB | ★★☆☆☆ | ultra — ruszy wszędzie |
| Qwen 2.5 0.5B | ~460 MB | 944 MB | ★★★★☆ | mini |
| Llama 3.2 1B | ~800 MB | 879 MB | ★★★★☆ | mini — faworyt na słabe telefony |
| Qwen 3 0.6B 🧪 | ~600 MB | 1403 MB | ★★★★☆ | smart |
| Gemma 2 2B (1k) | ~1,5 GB | 1583 MB | ★★★★☆ | smart |
| **Qwen 2.5 1.5B** | ~1 GB | 1629 MB | ★★★★★ | smart — król średniej wagi |
| SmolLM2 1.7B | ~1,1 GB | 1774 MB | ★★★☆☆ | smart |
| Gemma 2 2B | ~1,5 GB | 1895 MB | ★★★★☆ | pro |
| Qwen 3 1.7B 🧪 | ~1,3 GB | 2036 MB | ★★★★★ | pro |
| **Llama 3.2 3B** | ~2 GB | 2263 MB | ★★★★★ | pro — złoty środek |
| Phi 3.5 mini (1k) | ~2,3 GB | 2520 MB | ★★★☆☆ | pro — geniusz logiki |
| Qwen 3 4B 🧪 | ~2,6 GB | 3431 MB | ★★★★★ | max (desktop) |
| Llama 3.1 8B (1k) | ~4,9 GB | 4598 MB | ★★★★★ | max (desktop) |

🧪 = wariant bazowy/eksperymentalny (nie jest domyślną rekomendacją).

### Tryb zgodności WASM (Transformers.js, ONNX q4)

SmolLM2 135M (~90 MB) · SmolLM2 360M (~230 MB) · Qwen 2.5 0.5B (~450 MB) · Llama 3.2 1B (~750 MB).

## 🛡️ Jak dbamy o pamięć (filozofia „3 GB RAM”)

1. **Konserwatywny budżet** — karta mobilna dostaje zwykle ≤1,75 GB; model musi zmieścić się z 12% zapasem.
2. **Rekomendacja, nie zgadywanie** — sortowanie: jakość polskiego → stabilność → rozmiar w budżecie.
3. **Tryb oszczędzania pamięci** (domyślnie na telefonach) — obcina kontekst KV do 2k.
4. **Auto-podmiana F16→F32** — brak `shader-f16`? Silnik sam bierze wariant `q4f32`.
5. **Limity historii** — max 60 wątków / 300 wiadomości, renderowanie ostatnich 60 (reszta na życzenie).
6. **Ważenie raz** — Service Worker celowo **nie** cache'uje wag (robią to silniki), by nie dublować gigabajtów.

## 📴 Praca offline — co gdzie leży

| Dane | Magazyn | Zarządca |
|---|---|---|
| App-shell (HTML/CSS/JS/ikony) | Cache API `offchat-shell-v1` | Service Worker |
| Biblioteki silników (esm.sh/jsDelivr) | Cache API `offchat-cdn-v1` | Service Worker |
| Wagi modeli WebLLM | Cache API (`webllm/…`) lub OPFS | WebLLM (`cacheBackend` w ustawieniach) |
| Wagi modeli ONNX | Cache API (`transformers-cache`) | Transformers.js |
| Wątki i wiadomości | IndexedDB (+ fallback RAM) | `storage.js` |
| Ustawienia | localStorage | `storage.js` |

## 🌐 Wsparcie przeglądarek

| Przeglądarka | Silnik | Uwagi |
|---|---|---|
| Chrome / Edge 113+ (desktop i Android) | WebGPU ✅ | pełnia funkcji |
| Opera 99+ | WebGPU ✅ | pełnia funkcji |
| Safari 26+ | WebGPU ✅ / WASM | zależnie od urządzenia |
| Firefox | WASM ✅ | brak WebGPU — tryb zgodności CPU |
| Starsze / iOS<26 | WASM ✅ | wolniej, ale działa |

> GitHub Pages nie wysyła nagłówków COOP/COEP, więc WASM działa jednowątkowo — to zamierzone i w pełni wspierane.

## 🔒 Prywatność

Wszystko dzieje się lokalnie. Jedyny ruch sieciowy to: pobranie plików aplikacji, bibliotek (CDN) oraz wag modeli (Hugging Face) — **treść rozmów nigdy nie opuszcza urządzenia**. Brak kont, brak telemetrii, brak ciasteczek.

## 🛠️ Rozwój

- Kod to waniliowy JS (ES2022, moduły) — bez bundlera i `npm install`.
- Nowy model WebLLM? Dopisz wpis do `MODEL_CATALOG` w `js/config.js` (identyfikator musi istnieć w `prebuiltAppConfig` danej wersji WebLLM).
- Test składni: `node --check js/*.js` — albo odpal `python3 -m http.server` i klikaj.

## 📄 Licencja

MIT — rób z tym, co chcesz. Miłego czatowania offline! 💜
