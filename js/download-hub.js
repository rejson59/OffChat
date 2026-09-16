// ─────────────────────────────────────────────────────────────
// OffChat · download-hub.js — Centrum pobierania modeli AI:
// 1) Dokładna telemetria w czasie rzeczywistym (MB/s, ETA, pobrano MB)
// 2) Pływający mini-widżet ("Rozejrzyj się po aplikacji w trakcie pobierania")
// 3) Kolejkowanie wiadomości w trakcie pobierania
// 4) Mini-gra "NeuroPong" (zbieranie tokenów AI, fizyka 60fps, dźwięki)
// 5) Ciekawostki o AI i modelach językowych (baza wiedzy PL)
// 6) Szablony promptów z natychmiastowym użyciem w czacie
// ─────────────────────────────────────────────────────────────

export const AI_TRIVIA = [
  {
    title: "100% Prywatności na Twoim urządzeniu",
    tag: "Prywatność",
    icon: "🛡️",
    text: "OffChat wykonuje wszystkie obliczenia wyłącznie na Twoim procesorze graficznym lub CPU. Twoje zapytania i odpowiedzi nigdy nie opuszczają przeglądarki i nie są wysyłane do żadnej chmury ani telemetrii.",
  },
  {
    title: "Jak działa kwantyzacja 4-bitowa (q4f16)?",
    tag: "Optymalizacja",
    icon: "⚡",
    text: "Oryginalne wagi modeli ważą 16 bitów na parametr. Kwantyzacja kompresuje je do zaledwie 4 bitów — dzięki temu model 3 mld parametrów zajmuje ~2 GB zamiast 6 GB pamięci VRAM, zachowując niemal 99% swojej inteligencji!",
  },
  {
    title: "WebGPU — rewolucja w przeglądarce",
    tag: "Technologia",
    icon: "🚀",
    text: "WebGPU to nowoczesny standard W3C dający przeglądarce bezpośredni, niskopoziomowy dostęp do Twojej karty graficznej poprzez Vulkan, Metal lub DirectX 12 — z niemal zerowym narzutem wydajnościowym.",
  },
  {
    title: "Czym właściwie są tokeny?",
    tag: "Architektura",
    icon: "🔤",
    text: "Modele językowe nie operują na literach ani całych słowach, lecz na tokenach (fragmentach wyrazów). W języku polskim 1 token to średnio około 3-4 litery, a słowo 'przeglądarka' składa się zwykle z 2 lub 3 tokenów.",
  },
  {
    title: "Małe modele SLM kontra giganty",
    tag: "Trendy AI",
    icon: "💡",
    text: "Jeszcze niedawno sądzono, że do logicznego rozumowania potrzeba setek miliardów parametrów. Nowoczesne modele SLM (0.5B – 3B), trenowane na starannie wyselekcjonowanych danych, potrafią to samo w ułamku sekundy na telefonie.",
  },
  {
    title: "Dlaczego rodzina Qwen tak dobrze zna polski?",
    tag: "Język polski",
    icon: "🇵🇱",
    text: "Modele z rodziny Qwen (Alibaba) posiadają wyjątkowo bogaty wielojęzyczny zbiór treningowy. Dzięki temu nawet miniaturowy wariant Qwen 2.5 0.5B zachwyca płynną gramatyką i bogatym słownictwem w języku polskim.",
  },
  {
    title: "KV-Cache: pamięć podręczna kontekstu",
    tag: "Wydajność",
    icon: "🧠",
    text: "Gdy model generuje kolejne słowo, nie przelicza od nowa całej dotychczasowej rozmowy. W pamięci VRAM trzyma tzw. KV Cache (klucze i wartości), dzięki czemu każde nowe słowo powstaje z taką samą, błyskawiczną prędkością.",
  },
  {
    title: "Kompilacja shaderów WebGPU",
    tag: "Sprzęt",
    icon: "⚙️",
    text: "Status 'Ładowanie do pamięci' oznacza, że przeglądarka kompiluje kod WGSL wprost na mikroinstrukcje Twojej konkretnej karty graficznej (Nvidia, AMD, Intel, Apple Silicon czy Qualcomm Adreno).",
  },
  {
    title: "Temperatura i kreatywność",
    tag: "Ustawienia",
    icon: "🌡️",
    text: "Temperatura (np. 0.7) steruje stopniem losowości przy doborze kolejnych tokenów. Niska (0.2) daje odpowiedzi powtarzalne i ścisłe (kod, fakty), a wyższa (0.8) sprzyja poezji, metaforom i nieszablonowym pomysłom.",
  },
  {
    title: "Działa w samolocie i bez zasięgu",
    tag: "Offline",
    icon: "✈️",
    text: "Gdy model raz pobierze się do pamięci przeglądarki (Cache API), OffChat działa całkowicie offline. Możesz przejść w tryb samolotowy i pisać z asystentem w pociągu, w tunelu czy na bezludnej wyspie.",
  },
  {
    title: "Mechanizm uwagi (Self-Attention)",
    tag: "Historia AI",
    icon: "👁️",
    text: "Zaprezentowana w 2017 roku zasada Attention pozwala modelowi analizować relacje między wszystkimi słowami w zdaniu naraz — w przeciwieństwie do starych sieci RNN, które gubiły początek dłuższego tekstu.",
  },
  {
    title: "Dlaczego AI czasami konfabuluje (halucynuje)?",
    tag: "Wiedza",
    icon: "🔍",
    text: "Model nie posiada świadomości ani 'wiedzy' w ludzkim rozumieniu — to potężny model statystyczny, który dopełnia tekst najbardziej prawdopodobnymi słowami. Dlatego przy kluczowych faktach zawsze warto zachować czujność.",
  },
  {
    title: "Magiczna zasada: 'Pomyśl krok po kroku'",
    tag: "Prompting",
    icon: "🪜",
    text: "Dodanie do pytania zwrotu 'Pomyśl krok po kroku' zmusza mały model do wygenerowania łańcucha myśli (Chain of Thought), co drastycznie podnosi trafność odpowiedzi w zadaniach logicznych i matematycznych.",
  },
  {
    title: "Okno kontekstu 4096 tokenów",
    tag: "Pojemność",
    icon: "📚",
    text: "Okno 4k tokenów mieści około 3000 polskich słów, co odpowiada 6–8 stronom maszynopisu. W tym oknie model pamięta całą dotychczasową wymianę zdań z danego wątku.",
  },
  {
    title: "Ekologia lokalnego wnioskowania",
    tag: "Środowisko",
    icon: "🌱",
    text: "Wnioskowanie lokalne zużywa ułamek energii w porównaniu do zapytań do chmury, które angażują serwery hyperscalerów, chłodzenie wodne i transfer przez setki węzłów sieciowych.",
  },
  {
    title: "Trwałość dzięki Persistent Storage API",
    tag: "Przeglądarka",
    icon: "💾",
    text: "OffChat automatycznie prosi przeglądarkę o trwały magazyn (persistent storage), chroniąc pobrane gigabajty wag przed automatycznym czyszczeniem przy małej ilości miejsca na dysku.",
  },
];

export const PROMPT_TEMPLATES = [
  {
    category: "✍️ Styl & Tekst",
    title: "Korekta i wygładzenie tekstu",
    desc: "Usuwa błędy i powtórzenia zachowując Twój głos.",
    prompt: "Popraw styl, błędy interpunkcyjne i gramatyczne w poniższym tekście, zachowując mój naturalny ton wypowiedzi:\n\n[wklej tutaj tekst]",
  },
  {
    category: "✍️ Styl & Tekst",
    title: "Maksymalna zwięzłość (TL;DR)",
    desc: "Wyciąga sedno i wypisuje 3 kluczowe punkty.",
    prompt: "Przeredaguj poniższy tekst tak, aby był maksymalnie konkretny, przejrzysty i pozbawiony lania wody. Wypisz 3 najważniejsze wnioski w punktach:\n\n[wklej tekst]",
  },
  {
    category: "✍️ Styl & Tekst",
    title: "Profesjonalny e-mail biznesowy",
    desc: "Kulturalny, elegancki mail z jasnym kolejnym krokiem.",
    prompt: "Napisz oficjalny, uprzejmy e-mail biznesowy w sprawie: [opisz cel wiadomości]. Użyj profesjonalnego tonu i wyraźnego zakończenia z propozycją kolejnego kroku.",
  },
  {
    category: "💻 Kod & Tech",
    title: "Wyjaśnienie kodu krok po kroku",
    desc: "Tłumaczy algorytm i wskazuje ewentualne pułapki.",
    prompt: "Wyjaśnij mi krok po kroku działanie poniższego kodu, jakbyś uczył początkującego programistę. Wskaż ewentualne pułapki i błędy:\n\n```\n[wklej kod]\n```",
  },
  {
    category: "💻 Kod & Tech",
    title: "Optymalizacja wydajności",
    desc: "Przyspiesza wykonanie i redukuje pamięć.",
    prompt: "Zoptymalizuj poniższy kod pod kątem wydajności i czytelności. Wyjaśnij, co zostało zmienione i dlaczego:\n\n```\n[wklej kod]\n```",
  },
  {
    category: "💻 Kod & Tech",
    title: "Generowanie testów jednostkowych",
    desc: "Tworzy scenariusze testowe i przypadki brzegowe.",
    prompt: "Napisz zestaw testów jednostkowych dla poniższej funkcji, uwzględniając przypadki brzegowe (edge cases):\n\n```\n[wklej kod]\n```",
  },
  {
    category: "🎓 Nauka & Zrozumienie",
    title: "Metoda Feynmana (Jak dla 12-latka)",
    desc: "Tłumaczy trudne pojęcie prostymi analogiami.",
    prompt: "Wytłumacz mi pojęcie [wpisz temat, np. inflacja / czarne dziury / kwantyzacja] prostym językiem, używając barwnych życiowych analogii i unikając żargonu.",
  },
  {
    category: "🎓 Nauka & Zrozumienie",
    title: "Quiz sprawdzający wiedzę",
    desc: "5 pytań testowych A/B/C/D z kluczem odpowiedzi.",
    prompt: "Stwórz dla mnie 5 ciekawych pytań testowych z odpowiedziami A, B, C, D na temat: [wpisz temat]. Na samym końcu podaj klucz odpowiedzi z krótkim uzasadnieniem.",
  },
  {
    category: "🎓 Nauka & Zrozumienie",
    title: "Bilans zysków i strat (Pro & Contra)",
    desc: "Obiektywna analiza argumentów za i przeciw.",
    prompt: "Przedstaw zrównoważony bilans zalet i wad (argumenty za i przeciw) dla tematu: [wpisz temat]. Przedstaw perspektywę obu stron bez stronniczości.",
  },
  {
    category: "🧠 Kreatywność & Plan",
    title: "Burza mózgów: 7 pomysłów",
    desc: "Świeże, niebanalne propozycje na dowolny temat.",
    prompt: "Zrób burzę mózgów i zaproponuj 7 nieszablonowych, kreatywnych pomysłów na: [opisz projekt, nazwę firmy, prezent itp.].",
  },
  {
    category: "🧠 Kreatywność & Plan",
    title: "Plan działania na 14 dni",
    desc: "Realistyczny harmonogram z małymi krokami.",
    prompt: "Ułóż dla mnie realistyczny, 14-dniowy plan działania krok po kroku, aby osiągnąć cel: [opisz cel]. Uwzględnij odpoczynek i małe kamienie milowe.",
  },
  {
    category: "🧠 Kreatywność & Plan",
    title: "Opowiadanie science-fiction",
    desc: "Klimatyczny, wciągający wstęp do cyberpunkowej fabuły.",
    prompt: "Napisz klimatyczny, wciągający wstęp do opowiadania science-fiction osadzonego w futurystycznej Polsce w 2088 roku, gdzie lokalne AI pomaga ludziom przetrwać awarię sieci.",
  },
];

export class DownloadHub {
  constructor({ onMinimize, onExpand, onAbort, onUsePrompt, onQueuePrompt }) {
    this.onMinimize = onMinimize;
    this.onExpand = onExpand;
    this.onAbort = onAbort;
    this.onUsePrompt = onUsePrompt;
    this.onQueuePrompt = onQueuePrompt;

    this.model = null;
    this.startTime = 0;
    this.lastTime = 0;
    this.lastProgress = 0;
    this.smoothedSpeed = 0;
    this.isMinimized = false;
    this.isActive = false;

    // Mini-gra: NeuroPong
    this.canvas = null;
    this.ctx = null;
    this.gameRunning = false;
    this.gameAnimId = null;
    this.score = 0;
    this.highScore = Number(localStorage.getItem("offchat_pong_hs") || 0);
    this.gameSound = localStorage.getItem("offchat_pong_sound") !== "0";
    this.audioCtx = null;
    this.paddle = { x: 190, y: 210, width: 80, height: 10, targetX: 190 };
    this.ball = { x: 230, y: 120, vx: 3.5, vy: -3.5, radius: 6, trail: [] };
    this.tokens = [];
    this.particles = [];
    this.floatingTexts = [];

    // Ciekawostki
    this.triviaIndex = 0;
    this.triviaTimer = null;

    this.bindEvents();
  }

  bindEvents() {
    // Przycisk "Rozejrzyj się po aplikacji"
    const minBtn = document.getElementById("btn-dl-minimize");
    if (minBtn) minBtn.addEventListener("click", () => this.minimize());

    const topCloseBtn = document.getElementById("btn-dl-close-top");
    if (topCloseBtn) topCloseBtn.addEventListener("click", () => this.minimize());

    // Przycisk "Anuluj"
    const abortBtn = document.getElementById("btn-dl-abort");
    if (abortBtn) abortBtn.addEventListener("click", () => this.abort());

    // Mini dok: kliknięcie rozwija
    const miniClick = document.getElementById("dl-mini-click");
    if (miniClick) miniClick.addEventListener("click", () => this.expand());

    const miniExpandBtn = document.getElementById("btn-mini-expand");
    if (miniExpandBtn) miniExpandBtn.addEventListener("click", () => this.expand());

    const miniCancelBtn = document.getElementById("btn-mini-cancel");
    if (miniCancelBtn) miniCancelBtn.addEventListener("click", () => this.abort());

    // Zakładki (Tabs)
    const tabs = document.querySelectorAll(".dl-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => this.switchTab(tab.dataset.tab));
    });

    // Ciekawostki: przycisk losowania
    const nextTriviaBtn = document.getElementById("btn-next-trivia");
    if (nextTriviaBtn) nextTriviaBtn.addEventListener("click", () => this.nextTrivia());

    // Szablony promptów: renderowanie i obsługa klików
    this.renderPromptTemplates();

    // Kolejkowanie promptu z zakładki
    const queueBtn = document.getElementById("btn-dl-queue-send");
    if (queueBtn) {
      queueBtn.addEventListener("click", () => {
        const input = document.getElementById("dl-queue-input");
        const val = (input?.value || "").trim();
        if (val) {
          this.onQueuePrompt?.(val);
          input.value = "";
          this.minimize();
        }
      });
    }

    // Mini-gra: setup
    this.initGameDOM();
  }

  start(model, { auto = false } = {}) {
    this.model = model;
    this.isActive = true;
    this.startTime = performance.now();
    this.lastTime = this.startTime;
    this.lastProgress = 0;
    this.smoothedSpeed = 0;
    this.isMinimized = false;

    const overlay = document.getElementById("download-overlay");
    const miniDock = document.getElementById("dl-mini-dock");
    if (overlay) overlay.hidden = false;
    if (miniDock) miniDock.hidden = true;

    const titleEl = document.getElementById("dl-title");
    if (titleEl) titleEl.textContent = `${auto ? "Wznawianie" : "Pobieranie"}: ${model.name}`;

    const subEl = document.getElementById("dl-sub");
    if (subEl) {
      subEl.textContent = `Rozmiar modelu: ~${Math.round(model.sizeMB)} MB · Po pobraniu działa w pełni offline.`;
    }

    const miniNameEl = document.getElementById("dl-mini-name");
    if (miniNameEl) miniNameEl.textContent = model.name;

    // Reset progress UI
    this.updateHUD({
      progress: 0,
      downloadedMB: 0,
      totalMB: model.sizeMB || 500,
      speedText: "Łączenie…",
      etaText: "obliczanie…",
      text: "Nawiązywanie połączenia z CDN…",
    });

    // Uruchomienie losowej ciekawostki
    this.triviaIndex = Math.floor(Math.random() * AI_TRIVIA.length);
    this.renderTrivia();
    this.startTriviaTimer();

    // Uruchomienie mini-gry
    this.startGame();
  }

  updateProgress(p) {
    if (!this.isActive || !this.model) return;
    const now = performance.now();
    const progress = Math.max(0, Math.min(1, Number(p?.progress ?? 0)));
    const totalMB = this.model.sizeMB || 500;

    const dt = (now - this.lastTime) / 1000;
    if (dt >= 0.4 && progress > this.lastProgress) {
      const dProgress = progress - this.lastProgress;
      const mbDelta = dProgress * totalMB;
      const instantSpeed = mbDelta / dt;
      this.smoothedSpeed =
        this.smoothedSpeed === 0 ? instantSpeed : this.smoothedSpeed * 0.7 + instantSpeed * 0.3;
      this.lastProgress = progress;
      this.lastTime = now;
    }

    const downloadedMB = Math.round(progress * totalMB);
    const speedText =
      this.smoothedSpeed > 0.05 ? `${this.smoothedSpeed.toFixed(1)} MB/s` : "Łączenie…";

    let etaText = "—";
    if (this.smoothedSpeed > 0.05 && progress < 0.99) {
      const remainingMB = Math.max(0, totalMB - downloadedMB);
      const secsLeft = Math.round(remainingMB / this.smoothedSpeed);
      if (secsLeft < 60) {
        etaText = `~${secsLeft} s`;
      } else {
        const m = Math.floor(secsLeft / 60);
        const s = secsLeft % 60;
        etaText = `~${m} min ${s} s`;
      }
    } else if (progress >= 0.99) {
      etaText = "gotowe!";
    }

    let phaseDesc = p?.text || "Pobieranie wag modelu…";
    if (p?.phase === "load") {
      phaseDesc = "Kompilacja shaderów WebGPU i inicjalizacja pamięci…";
    }

    this.updateHUD({
      progress,
      downloadedMB,
      totalMB,
      speedText,
      etaText,
      text: phaseDesc,
    });
  }

  updateHUD({ progress, downloadedMB, totalMB, speedText, etaText, text }) {
    const pct = Math.round(progress * 100);

    // Duży modal
    const barEl = document.getElementById("dl-bar");
    if (barEl) barEl.style.width = `${pct}%`;

    const pctEl = document.getElementById("dl-pct");
    if (pctEl) pctEl.textContent = `${pct}%`;

    const bytesEl = document.getElementById("dl-bytes");
    if (bytesEl) bytesEl.textContent = `${downloadedMB} / ${totalMB} MB`;

    const speedEl = document.getElementById("dl-speed");
    if (speedEl) speedEl.textContent = speedText;

    const etaEl = document.getElementById("dl-eta");
    if (etaEl) etaEl.textContent = etaText;

    const textEl = document.getElementById("dl-text");
    if (textEl) textEl.textContent = text;

    // Mini Dok
    const miniPctEl = document.getElementById("dl-mini-pct");
    if (miniPctEl) miniPctEl.textContent = `${pct}%`;

    const miniBarEl = document.getElementById("dl-mini-bar-fill");
    if (miniBarEl) miniBarEl.style.width = `${pct}%`;

    const miniStatsEl = document.getElementById("dl-mini-stats");
    if (miniStatsEl) {
      miniStatsEl.textContent = `${downloadedMB}/${totalMB} MB · ${speedText} · ETA: ${etaText}`;
    }

    // Aktualizacja wskaźnika w zakolejkowanej wiadomości w czacie
    const queuedEl = document.getElementById("queued-dl-pct");
    if (queuedEl) {
      queuedEl.textContent = `${pct}% · ${speedText} · ETA: ${etaText}`;
    }
  }

  minimize() {
    this.isMinimized = true;
    const overlay = document.getElementById("download-overlay");
    const miniDock = document.getElementById("dl-mini-dock");
    if (overlay) overlay.hidden = true;
    if (miniDock) miniDock.hidden = false;
    this.pauseGame();
    this.onMinimize?.();
  }

  expand() {
    this.isMinimized = false;
    const overlay = document.getElementById("download-overlay");
    const miniDock = document.getElementById("dl-mini-dock");
    if (overlay) overlay.hidden = false;
    if (miniDock) miniDock.hidden = true;
    this.resumeGame();
    this.onExpand?.();
  }

  abort() {
    this.finish();
    this.onAbort?.();
  }

  finish() {
    this.isActive = false;
    const overlay = document.getElementById("download-overlay");
    const miniDock = document.getElementById("dl-mini-dock");
    if (overlay) overlay.hidden = true;
    if (miniDock) miniDock.hidden = true;
    this.stopGame();
    this.stopTriviaTimer();
  }

  switchTab(tabId) {
    document.querySelectorAll(".dl-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === tabId);
    });
    document.querySelectorAll(".dl-tab-pane").forEach((p) => {
      p.classList.toggle("active", p.id === `pane-${tabId}`);
    });

    if (tabId === "game") {
      this.resumeGame();
    } else {
      this.pauseGame();
    }
  }

  // ── Ciekawostki ──────────────────────────────────────────────
  renderTrivia() {
    const item = AI_TRIVIA[this.triviaIndex % AI_TRIVIA.length];
    if (!item) return;

    const badge = document.getElementById("trivia-badge");
    if (badge) {
      badge.textContent = `${item.icon} ${item.tag} · Ciekawostka ${((this.triviaIndex % AI_TRIVIA.length) + 1)}/${AI_TRIVIA.length}`;
    }

    const titleEl = document.getElementById("trivia-title");
    if (titleEl) titleEl.textContent = item.title;

    const textEl = document.getElementById("trivia-text");
    if (textEl) textEl.textContent = item.text;
  }

  nextTrivia() {
    this.triviaIndex = (this.triviaIndex + 1) % AI_TRIVIA.length;
    this.renderTrivia();
  }

  startTriviaTimer() {
    this.stopTriviaTimer();
    this.triviaTimer = setInterval(() => {
      this.nextTrivia();
    }, 9000);
  }

  stopTriviaTimer() {
    if (this.triviaTimer) {
      clearInterval(this.triviaTimer);
      this.triviaTimer = null;
    }
  }

  // ── Szablony promptów ────────────────────────────────────────
  renderPromptTemplates() {
    const list = document.getElementById("prompt-templates-list");
    if (!list) return;

    list.innerHTML = "";
    PROMPT_TEMPLATES.forEach((tmpl) => {
      const card = document.createElement("div");
      card.className = "prompt-template-card glass";
      card.innerHTML = `
        <div class="prompt-tmpl-top">
          <span class="prompt-tmpl-tag">${tmpl.category}</span>
          <strong>${tmpl.title}</strong>
        </div>
        <p class="prompt-tmpl-desc">${tmpl.desc}</p>
        <pre class="prompt-tmpl-preview"><code>${tmpl.prompt.slice(0, 100)}…</code></pre>
        <button class="btn ghost sm prompt-tmpl-btn">
          <svg><use href="#i-spark"/></svg> Użyj w czacie
        </button>
      `;

      card.querySelector(".prompt-tmpl-btn").addEventListener("click", () => {
        this.onUsePrompt?.(tmpl.prompt);
        this.minimize();
      });

      list.appendChild(card);
    });
  }

  // ── Mini-gra: NeuroPong ──────────────────────────────────────
  initGameDOM() {
    this.canvas = document.getElementById("game-canvas");
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");

    // Sound toggle
    const soundBtn = document.getElementById("game-sound-btn");
    const soundIcon = document.getElementById("game-sound-icon");
    if (soundBtn && soundIcon) {
      soundIcon.textContent = this.gameSound ? "🔊" : "🔇";
      soundBtn.addEventListener("click", () => {
        this.gameSound = !this.gameSound;
        localStorage.setItem("offchat_pong_sound", this.gameSound ? "1" : "0");
        soundIcon.textContent = this.gameSound ? "🔊" : "🔇";
      });
    }

    // Restart button
    const restartBtn = document.getElementById("game-restart-btn");
    if (restartBtn) {
      restartBtn.addEventListener("click", () => this.resetGame(true));
    }

    // High score display
    const hsEl = document.getElementById("game-highscore");
    if (hsEl) hsEl.textContent = this.highScore;

    // Sterowanie myszą
    this.canvas.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const mouseX = (e.clientX - rect.left) * scaleX;
      this.paddle.targetX = Math.max(0, Math.min(this.canvas.width - this.paddle.width, mouseX - this.paddle.width / 2));
    });

    // Sterowanie dotykiem (mobile-friendly, bez przewijania)
    const handleTouch = (e) => {
      if (!e.touches || !e.touches[0]) return;
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const touchX = (e.touches[0].clientX - rect.left) * scaleX;
      this.paddle.targetX = Math.max(0, Math.min(this.canvas.width - this.paddle.width, touchX - this.paddle.width / 2));
    };
    this.canvas.addEventListener("touchstart", handleTouch, { passive: false });
    this.canvas.addEventListener("touchmove", handleTouch, { passive: false });

    // Sterowanie klawiaturą
    window.addEventListener("keydown", (e) => {
      if (!this.gameRunning || this.gamePaused) return;
      const step = 28;
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        this.paddle.targetX = Math.max(0, this.paddle.targetX - step);
      } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        this.paddle.targetX = Math.min(this.canvas.width - this.paddle.width, this.paddle.targetX + step);
      }
    });
  }

  playBeep(freq, type = "sine", duration = 0.08) {
    if (!this.gameSound) return;
    try {
      if (!this.audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx && this.audioCtx.state === "suspended") {
        this.audioCtx.resume();
      }
      if (!this.audioCtx) return;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
      gain.gain.setValueAtTime(0.09, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch {
      /* AudioContext fallback ignoruj */
    }
  }

  resetGame(fullReset = false) {
    if (fullReset) {
      this.score = 0;
      const sEl = document.getElementById("game-score");
      if (sEl) sEl.textContent = "0";
    }
    const w = this.canvas ? this.canvas.width : 460;
    const h = this.canvas ? this.canvas.height : 230;

    this.paddle.x = w / 2 - this.paddle.width / 2;
    this.paddle.targetX = this.paddle.x;
    this.paddle.y = h - 18;

    const angle = (Math.random() * 0.8 - 0.4) * Math.PI;
    const speed = 4.2;
    this.ball.x = w / 2;
    this.ball.y = h / 2;
    this.ball.vx = Math.sin(angle) * speed;
    this.ball.vy = -Math.cos(angle) * speed;
    this.ball.trail = [];
    this.particles = [];
    this.floatingTexts = [];

    this.spawnTokens();
  }

  spawnTokens() {
    this.tokens = [];
    const w = this.canvas ? this.canvas.width : 460;
    const icons = [
      { sym: "⚡", pts: 10, color: "#22d3ee" },
      { sym: "🧠", pts: 25, color: "#d946ef" },
      { sym: "💡", pts: 15, color: "#fbbf24" },
      { sym: "🔮", pts: 50, color: "#a855f7" },
    ];

    const cols = 5;
    const rows = 2;
    const startX = 35;
    const startY = 35;
    const gapX = (w - 70) / (cols - 1);
    const gapY = 38;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const item = icons[(r * cols + c) % icons.length];
        this.tokens.push({
          x: startX + c * gapX,
          y: startY + r * gapY,
          radius: 12,
          sym: item.sym,
          pts: item.pts,
          color: item.color,
          pulse: Math.random() * Math.PI * 2,
        });
      }
    }
  }

  startGame() {
    if (!this.canvas || !this.ctx) return; // brak 2D contextu (CSP/restrykcje) — gra off, reszta działa
    this.resetGame(true);
    this.gameRunning = true;
    this.gamePaused = false;
    this.loopGame();
  }

  pauseGame() {
    this.gamePaused = true;
  }

  resumeGame() {
    if (this.gameRunning && this.gamePaused) {
      this.gamePaused = false;
      this.loopGame();
    }
  }

  stopGame() {
    this.gameRunning = false;
    this.gamePaused = false;
    if (this.gameAnimId) {
      cancelAnimationFrame(this.gameAnimId);
      this.gameAnimId = null;
    }
  }

  loopGame() {
    if (!this.gameRunning || this.gamePaused) return;

    this.updateGamePhysics();
    this.renderGame();

    this.gameAnimId = requestAnimationFrame(() => this.loopGame());
  }

  updateGamePhysics() {
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Płynne podążanie paletki
    this.paddle.x += (this.paddle.targetX - this.paddle.x) * 0.35;

    // Ślad piłki
    this.ball.trail.push({ x: this.ball.x, y: this.ball.y });
    if (this.ball.trail.length > 7) this.ball.trail.shift();

    // Ruch piłki
    this.ball.x += this.ball.vx;
    this.ball.y += this.ball.vy;

    // Odbicia od ścian
    if (this.ball.x - this.ball.radius <= 0) {
      this.ball.x = this.ball.radius;
      this.ball.vx = Math.abs(this.ball.vx);
      this.playBeep(260, "triangle", 0.04);
    } else if (this.ball.x + this.ball.radius >= w) {
      this.ball.x = w - this.ball.radius;
      this.ball.vx = -Math.abs(this.ball.vx);
      this.playBeep(260, "triangle", 0.04);
    }

    if (this.ball.y - this.ball.radius <= 0) {
      this.ball.y = this.ball.radius;
      this.ball.vy = Math.abs(this.ball.vy);
      this.playBeep(320, "triangle", 0.04);
    }

    // Kolizja z paletką
    const py = this.paddle.y;
    const px = this.paddle.x;
    const pw = this.paddle.width;
    const ph = this.paddle.height;

    if (
      this.ball.y + this.ball.radius >= py &&
      this.ball.y - this.ball.radius <= py + ph &&
      this.ball.x >= px - 4 &&
      this.ball.x <= px + pw + 4 &&
      this.ball.vy > 0
    ) {
      this.ball.y = py - this.ball.radius;
      // Kąt zależny od punktu uderzenia
      const hitOffset = (this.ball.x - (px + pw / 2)) / (pw / 2);
      const speed = Math.min(7.5, Math.hypot(this.ball.vx, this.ball.vy) * 1.02);
      const angle = hitOffset * 0.95; // maks ~55 stopni
      this.ball.vx = Math.sin(angle) * speed;
      this.ball.vy = -Math.abs(Math.cos(angle) * speed);

      this.playBeep(440 + Math.abs(hitOffset) * 180, "sine", 0.07);

      // Cząsteczki z paletki
      for (let i = 0; i < 5; i++) {
        this.particles.push({
          x: this.ball.x,
          y: this.ball.y,
          vx: (Math.random() - 0.5) * 4,
          vy: -Math.random() * 3 - 1,
          color: "#22d3ee",
          alpha: 1,
          life: 18,
        });
      }
    }

    // Utrata piłki (dół)
    if (this.ball.y - this.ball.radius > h) {
      this.playBeep(180, "sawtooth", 0.15);
      this.resetGame(false);
      return;
    }

    // Zbieranie tokenów AI
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const t = this.tokens[i];
      const dist = Math.hypot(this.ball.x - t.x, this.ball.y - t.y);
      if (dist <= this.ball.radius + t.radius) {
        // Trafienie!
        this.score += t.pts;
        const sEl = document.getElementById("game-score");
        if (sEl) sEl.textContent = this.score;

        if (this.score > this.highScore) {
          this.highScore = this.score;
          localStorage.setItem("offchat_pong_hs", String(this.highScore));
          const hsEl = document.getElementById("game-highscore");
          if (hsEl) hsEl.textContent = this.highScore;
        }

        // Płynny dźwięk
        this.playBeep(520 + t.pts * 8, "sine", 0.1);

        // Pływający tekst
        this.floatingTexts.push({
          text: `+${t.pts}`,
          x: t.x,
          y: t.y,
          alpha: 1,
          color: t.color,
        });

        // Eksplozja cząsteczek
        for (let p = 0; p < 10; p++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = Math.random() * 4 + 1.5;
          this.particles.push({
            x: t.x,
            y: t.y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            color: t.color,
            alpha: 1,
            life: 25,
          });
        }

        // Odbicie piłki od tokena
        this.ball.vy = -this.ball.vy;
        this.tokens.splice(i, 1);
      }
    }

    // Respawn tokenów, gdy zebrano wszystkie
    if (this.tokens.length === 0) {
      this.spawnTokens();
      this.playBeep(880, "sine", 0.18);
    }

    // Aktualizacja cząsteczek
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      p.alpha = Math.max(0, p.life / 25);
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    // Aktualizacja tekstów
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= 1.1;
      ft.alpha -= 0.035;
      if (ft.alpha <= 0) this.floatingTexts.splice(i, 1);
    }
  }

  renderGame() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Tło
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(11, 16, 32, 0.95)";
    ctx.fillRect(0, 0, w, h);

    // Subtelna neonowa siatka w tle
    ctx.strokeStyle = "rgba(124, 58, 237, 0.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 25) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 25) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Rysowanie tokenów AI
    for (const t of this.tokens) {
      t.pulse = (t.pulse || 0) + 0.05;
      const r = t.radius + Math.sin(t.pulse) * 1.5;

      ctx.save();
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = "rgba(24, 32, 66, 0.85)";
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(t.sym, t.x, t.y);
      ctx.restore();
    }

    // Ślad piłki
    for (let i = 0; i < this.ball.trail.length; i++) {
      const tr = this.ball.trail[i];
      const a = (i + 1) / (this.ball.trail.length + 1) * 0.35;
      ctx.fillStyle = `rgba(34, 211, 238, ${a})`;
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, this.ball.radius * (0.5 + a * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    // Piłka
    ctx.save();
    ctx.shadowColor = "#22d3ee";
    ctx.shadowBlur = 14;
    ctx.fillStyle = "#e0f2fe";
    ctx.beginPath();
    ctx.arc(this.ball.x, this.ball.y, this.ball.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Paletka
    ctx.save();
    ctx.shadowColor = "#d946ef";
    ctx.shadowBlur = 12;
    const grad = ctx.createLinearGradient(this.paddle.x, 0, this.paddle.x + this.paddle.width, 0);
    grad.addColorStop(0, "#22d3ee");
    grad.addColorStop(1, "#d946ef");
    ctx.fillStyle = grad;
    this.roundRect(ctx, this.paddle.x, this.paddle.y, this.paddle.width, this.paddle.height, 5);
    ctx.fill();
    ctx.restore();

    // Cząsteczki
    for (const p of this.particles) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Pływające teksty
    for (const ft of this.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.fillStyle = ft.color;
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}
