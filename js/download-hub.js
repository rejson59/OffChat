// ─────────────────────────────────────────────────────────────
// OffChat · download-hub.js — AI model download hub:
// 1) Precise real-time telemetry (MB/s, ETA, downloaded MB)
// 2) Floating mini-widget ("explore the app while downloading")
// 3) Message queueing while downloading
// 4) "NeuroPong" mini-game (AI token collecting, 60fps physics, sounds)
// 5) AI & language-model facts (built-in knowledge base)
// 6) Prompt templates with instant use in chat
// ─────────────────────────────────────────────────────────────

export const AI_TRIVIA = [
  {
    title: "100% privacy on your device",
    tag: "Privacy",
    icon: "🛡️",
    text: "OffChat runs every computation on your GPU or CPU only. Your prompts and answers never leave the browser and are never sent to any cloud or telemetry service.",
  },
  {
    title: "How 4-bit quantization (q4f16) works",
    tag: "Optimization",
    icon: "⚡",
    text: "Original model weights use 16 bits per parameter. Quantization squeezes them down to just 4 bits — so a 3B model takes ~2 GB of VRAM instead of 6 GB while keeping almost 99% of its smarts!",
  },
  {
    title: "WebGPU — a revolution in the browser",
    tag: "Technology",
    icon: "🚀",
    text: "WebGPU is a modern W3C standard giving the browser direct, low-level access to your graphics card through Vulkan, Metal or DirectX 12 — with near-zero performance overhead.",
  },
  {
    title: "What exactly are tokens?",
    tag: "Architecture",
    icon: "🔤",
    text: "Language models don't operate on letters or whole words, but on tokens (word fragments). In English, 1 token averages about 4 characters, so the word 'unbelievable' is usually 2 or 3 tokens.",
  },
  {
    title: "Small SLMs vs. giant models",
    tag: "AI trends",
    icon: "💡",
    text: "Not long ago everyone believed logical reasoning needed hundreds of billions of parameters. Modern SLMs (0.5B–3B), trained on carefully curated data, do the same in a fraction of a second on a phone.",
  },
  {
    title: "Why small models speak so many languages",
    tag: "Languages",
    icon: "🌍",
    text: "Model families like Qwen are trained on huge multilingual datasets. That's why even a tiny 0.5B model can chat fluently in dozens of languages — just write to it in yours.",
  },
  {
    title: "KV-Cache: the context memory",
    tag: "Performance",
    icon: "🧠",
    text: "When a model generates the next word, it doesn't recompute the whole conversation. It keeps a KV Cache (keys and values) in VRAM, so every new word arrives at the same brisk speed.",
  },
  {
    title: "Compiling WebGPU shaders",
    tag: "Hardware",
    icon: "⚙️",
    text: "The 'Loading into memory' status means the browser is compiling WGSL code into micro-instructions for your exact graphics card (Nvidia, AMD, Intel, Apple Silicon or Qualcomm Adreno).",
  },
  {
    title: "Temperature and creativity",
    tag: "Settings",
    icon: "🌡️",
    text: "Temperature (e.g. 0.7) controls randomness when picking the next token. Low (0.2) gives repeatable, precise answers (code, facts), while higher (0.8) favors poetry, metaphors and wild ideas.",
  },
  {
    title: "Works on a plane with no signal",
    tag: "Offline",
    icon: "✈️",
    text: "Once a model lands in the browser cache (Cache API), OffChat works fully offline. Switch on airplane mode and chat with your assistant on a train, in a tunnel or on a desert island.",
  },
  {
    title: "The attention mechanism",
    tag: "AI history",
    icon: "👁️",
    text: "Introduced in 2017, self-attention lets a model weigh relationships between all words in a sentence at once — unlike old RNN networks that forgot the start of longer texts.",
  },
  {
    title: "Why does AI sometimes hallucinate?",
    tag: "Knowledge",
    icon: "🔍",
    text: "A model has no consciousness or 'knowledge' in the human sense — it's a powerful statistical engine completing text with the most likely words. Stay skeptical about critical facts.",
  },
  {
    title: "The magic phrase: 'think step by step'",
    tag: "Prompting",
    icon: "🪜",
    text: "Adding 'think step by step' to your question forces a small model to generate a chain of thought, which dramatically improves accuracy on logic and math tasks.",
  },
  {
    title: "A 4096-token context window",
    tag: "Capacity",
    icon: "📚",
    text: "A 4k-token window holds roughly 3,000 English words — about 6–8 typed pages. Inside it, the model remembers the entire conversation of the current thread.",
  },
  {
    title: "The ecology of local inference",
    tag: "Environment",
    icon: "🌱",
    text: "Local inference uses a fraction of the energy of cloud queries, which spin up hyperscaler servers, water cooling and transfers across hundreds of network hops.",
  },
  {
    title: "Persistence via the Storage API",
    tag: "Browser",
    icon: "💾",
    text: "OffChat automatically asks the browser for persistent storage, protecting downloaded gigabytes of weights from automatic cleanup when disk space runs low.",
  },
];

export const PROMPT_TEMPLATES = [
  {
    category: "✍️ Style & Text",
    title: "Proofread and polish",
    desc: "Removes mistakes and repetition while keeping your voice.",
    prompt: "Fix the style, punctuation and grammar in the text below, keeping my natural tone of voice:\n\n[paste your text here]",
  },
  {
    category: "✍️ Style & Text",
    title: "Maximum brevity (TL;DR)",
    desc: "Extracts the essence and lists 3 key points.",
    prompt: "Rewrite the text below to be maximally concrete, clear and free of fluff. List the 3 most important takeaways as bullet points:\n\n[paste the text]",
  },
  {
    category: "✍️ Style & Text",
    title: "Professional business e-mail",
    desc: "Polite, elegant mail with a clear next step.",
    prompt: "Write a formal, polite business e-mail about: [describe the goal of the message]. Use a professional tone and a clear closing with a proposed next step.",
  },
  {
    category: "💻 Code & Tech",
    title: "Explain code step by step",
    desc: "Explains the algorithm and spots potential pitfalls.",
    prompt: "Explain step by step how the code below works, as if teaching a beginner programmer. Point out potential pitfalls and bugs:\n\n```\n[paste the code]\n```",
  },
  {
    category: "💻 Code & Tech",
    title: "Performance optimization",
    desc: "Speeds up execution and reduces memory use.",
    prompt: "Optimize the code below for performance and readability. Explain what was changed and why:\n\n```\n[paste the code]\n```",
  },
  {
    category: "💻 Code & Tech",
    title: "Generate unit tests",
    desc: "Creates test scenarios including edge cases.",
    prompt: "Write a set of unit tests for the function below, including edge cases:\n\n```\n[paste the code]\n```",
  },
  {
    category: "🎓 Learning",
    title: "Feynman method (like I'm 12)",
    desc: "Explains a hard concept with simple analogies.",
    prompt: "Explain the concept of [enter a topic, e.g. inflation / black holes / quantization] in simple language, using vivid everyday analogies and avoiding jargon.",
  },
  {
    category: "🎓 Learning",
    title: "Knowledge-check quiz",
    desc: "5 A/B/C/D test questions with an answer key.",
    prompt: "Create 5 interesting multiple-choice questions (A, B, C, D) about: [enter a topic]. At the very end, give the answer key with a short justification.",
  },
  {
    category: "🎓 Learning",
    title: "Pros & cons balance",
    desc: "An objective analysis of both sides.",
    prompt: "Present a balanced overview of pros and cons for the topic: [enter a topic]. Show both sides fairly, without bias.",
  },
  {
    category: "🧠 Creativity & Plans",
    title: "Brainstorm: 7 ideas",
    desc: "Fresh, original suggestions on any topic.",
    prompt: "Brainstorm and suggest 7 original, creative ideas for: [describe the project, company name, gift, etc.].",
  },
  {
    category: "🧠 Creativity & Plans",
    title: "14-day action plan",
    desc: "A realistic schedule with small steps.",
    prompt: "Build me a realistic 14-day step-by-step action plan to reach the goal: [describe the goal]. Include rest days and small milestones.",
  },
  {
    category: "🧠 Creativity & Plans",
    title: "A sci-fi story opening",
    desc: "An atmospheric hook for a cyberpunk tale.",
    prompt: "Write an atmospheric, gripping opening of a science-fiction story set in the year 2088, where local AI helps people survive a global network blackout.",
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
    this.activeTab = "game";
    this.lowFx = false; // reduced game effects for weak GPUs

    // Mini-game: NeuroPong
    this.canvas = null;
    this.ctx = null;
    this.gameRunning = false;
    this.gamePaused = false;
    this.gameAnimId = null;
    this.lastFrameTs = 0;
    this.score = 0;
    this.highScore = Number(localStorage.getItem("offchat_pong_hs") || 0);
    this.gameSound = localStorage.getItem("offchat_pong_sound") !== "0";
    this.audioCtx = null;
    this.paddle = { x: 190, y: 210, width: 80, height: 10, targetX: 190 };
    this.ball = { x: 230, y: 120, vx: 3.5, vy: -3.5, radius: 6, trail: [] };
    this.tokens = [];
    this.particles = [];
    this.floatingTexts = [];

    // Facts
    this.triviaIndex = 0;
    this.triviaTimer = null;

    this.bindEvents();
  }

  /** Enable/disable cheap rendering for the mini-game (Safe Mode). */
  setLowFx(on) {
    this.lowFx = !!on;
  }

  bindEvents() {
    // "Explore the app" button
    const minBtn = document.getElementById("btn-dl-minimize");
    if (minBtn) minBtn.addEventListener("click", () => this.minimize());

    const topCloseBtn = document.getElementById("btn-dl-close-top");
    if (topCloseBtn) topCloseBtn.addEventListener("click", () => this.minimize());

    // "Cancel" button
    const abortBtn = document.getElementById("btn-dl-abort");
    if (abortBtn) abortBtn.addEventListener("click", () => this.abort());

    // Mini dock: click expands
    const miniClick = document.getElementById("dl-mini-click");
    if (miniClick) miniClick.addEventListener("click", () => this.expand());

    const miniExpandBtn = document.getElementById("btn-mini-expand");
    if (miniExpandBtn) miniExpandBtn.addEventListener("click", () => this.expand());

    const miniCancelBtn = document.getElementById("btn-mini-cancel");
    if (miniCancelBtn) miniCancelBtn.addEventListener("click", () => this.abort());

    // Tabs
    const tabs = document.querySelectorAll(".dl-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => this.switchTab(tab.dataset.tab));
    });

    // Facts: shuffle button
    const nextTriviaBtn = document.getElementById("btn-next-trivia");
    if (nextTriviaBtn) nextTriviaBtn.addEventListener("click", () => this.nextTrivia());

    // Prompt templates: render + click handling
    this.renderPromptTemplates();

    // Queue a prompt from the tab
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

    // Pause the game when the page is hidden (battery + GPU).
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.pauseGame();
        this.stopTriviaTimer(); // no point redrawing a hidden carousel
      } else if (this.isActive) {
        this.startTriviaTimer();
        if (!this.isMinimized && this.activeTab === "game") this.resumeGame();
      }
    });

    // Mini-game: setup
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
    if (titleEl) titleEl.textContent = `${auto ? "Resuming" : "Downloading"}: ${model.name}`;

    const subEl = document.getElementById("dl-sub");
    if (subEl) {
      subEl.textContent = `Model size: ~${Math.round(model.sizeMB)} MB · Works fully offline once downloaded.`;
    }

    const miniNameEl = document.getElementById("dl-mini-name");
    if (miniNameEl) miniNameEl.textContent = model.name;

    // Reset progress UI
    this.updateHUD({
      progress: 0,
      downloadedMB: 0,
      totalMB: model.sizeMB || 500,
      speedText: "Connecting…",
      etaText: "calculating…",
      text: "Connecting to the CDN…",
    });

    // Show a random fact
    this.triviaIndex = Math.floor(Math.random() * AI_TRIVIA.length);
    this.renderTrivia();
    this.startTriviaTimer();

    // Start the mini-game
    this.switchTab("game");
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
    } else if (dt >= 0.4) {
      // Stalled (e.g. compiling) — decay the speed so it doesn't lie.
      this.smoothedSpeed *= 0.9;
      this.lastTime = now;
    }

    const downloadedMB = Math.round(progress * totalMB);
    const speedText =
      this.smoothedSpeed > 0.05 ? `${this.smoothedSpeed.toFixed(1)} MB/s` : "Connecting…";

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
      etaText = "done!";
    }

    let phaseDesc = p?.text || "Downloading model weights…";
    if (p?.phase === "load") {
      phaseDesc = "Compiling WebGPU shaders and initializing memory…";
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

    // Big modal
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

    // Mini dock
    const miniPctEl = document.getElementById("dl-mini-pct");
    if (miniPctEl) miniPctEl.textContent = `${pct}%`;

    const miniBarEl = document.getElementById("dl-mini-bar-fill");
    if (miniBarEl) miniBarEl.style.width = `${pct}%`;

    const miniStatsEl = document.getElementById("dl-mini-stats");
    if (miniStatsEl) {
      miniStatsEl.textContent = `${downloadedMB}/${totalMB} MB · ${speedText} · ETA: ${etaText}`;
    }

    // Live indicator inside the queued chat message
    const queuedEl = document.getElementById("queued-dl-pct");
    if (queuedEl) {
      queuedEl.textContent = `${pct}% · ${speedText} · ETA: ${etaText}`;
    }
  }

  minimize() {
    if (!this.isActive) return;
    this.isMinimized = true;
    const overlay = document.getElementById("download-overlay");
    const miniDock = document.getElementById("dl-mini-dock");
    if (overlay) overlay.hidden = true;
    if (miniDock) miniDock.hidden = false;
    this.pauseGame();
    this.onMinimize?.();
  }

  expand() {
    if (!this.isActive) return;
    this.isMinimized = false;
    const overlay = document.getElementById("download-overlay");
    const miniDock = document.getElementById("dl-mini-dock");
    if (overlay) overlay.hidden = false;
    if (miniDock) miniDock.hidden = true;
    if (this.activeTab === "game") this.resumeGame();
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
    this.activeTab = tabId;
    document.querySelectorAll(".dl-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === tabId);
    });
    document.querySelectorAll(".dl-tab-pane").forEach((p) => {
      p.classList.toggle("active", p.id === `pane-${tabId}`);
    });

    if (tabId === "game") {
      // Only render when actually visible — never waste GPU in background.
      if (this.isActive && !this.isMinimized && !document.hidden) this.resumeGame();
    } else {
      this.pauseGame();
    }
  }

  // ── Facts ────────────────────────────────────────────────────
  renderTrivia() {
    const item = AI_TRIVIA[this.triviaIndex % AI_TRIVIA.length];
    if (!item) return;

    const badge = document.getElementById("trivia-badge");
    if (badge) {
      badge.textContent = `${item.icon} ${item.tag} · Fact ${((this.triviaIndex % AI_TRIVIA.length) + 1)}/${AI_TRIVIA.length}`;
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

  // ── Prompt templates ─────────────────────────────────────────
  renderPromptTemplates() {
    const list = document.getElementById("prompt-templates-list");
    if (!list) return;

    list.innerHTML = "";
    PROMPT_TEMPLATES.forEach((tmpl) => {
      const card = document.createElement("div");
      card.className = "prompt-template-card glass";
      const tag = document.createElement("span");
      tag.className = "prompt-tmpl-tag";
      tag.textContent = tmpl.category;
      const title = document.createElement("strong");
      title.textContent = tmpl.title;
      const top = document.createElement("div");
      top.className = "prompt-tmpl-top";
      top.append(tag, title);
      const desc = document.createElement("p");
      desc.className = "prompt-tmpl-desc";
      desc.textContent = tmpl.desc;
      const preview = document.createElement("pre");
      preview.className = "prompt-tmpl-preview";
      const code = document.createElement("code");
      code.textContent = tmpl.prompt.slice(0, 100) + "…";
      preview.appendChild(code);
      const btn = document.createElement("button");
      btn.className = "btn ghost sm prompt-tmpl-btn";
      btn.innerHTML = `<svg><use href="#i-spark"/></svg> Use in chat`;

      btn.addEventListener("click", () => {
        this.onUsePrompt?.(tmpl.prompt);
        this.minimize();
      });

      card.append(top, desc, preview, btn);
      list.appendChild(card);
    });
  }

  // ── Mini-game: NeuroPong ─────────────────────────────────────
  initGameDOM() {
    this.canvas = document.getElementById("game-canvas");
    if (!this.canvas) return;
    try {
      this.ctx = this.canvas.getContext("2d");
    } catch {
      this.ctx = null;
    }

    // Sound toggle
    const soundBtn = document.getElementById("game-sound-btn");
    const soundIcon = document.getElementById("game-sound-icon");
    if (soundBtn && soundIcon) {
      soundIcon.textContent = this.gameSound ? "🔊" : "🔇";
      soundBtn.addEventListener("click", () => {
        this.gameSound = !this.gameSound;
        try {
          localStorage.setItem("offchat_pong_sound", this.gameSound ? "1" : "0");
        } catch { /* ignore */ }
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

    // Mouse controls
    this.canvas.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const mouseX = (e.clientX - rect.left) * scaleX;
      this.paddle.targetX = Math.max(0, Math.min(this.canvas.width - this.paddle.width, mouseX - this.paddle.width / 2));
    });

    // Touch controls (mobile-friendly, no scrolling)
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

    // Keyboard controls
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
      /* AudioContext unavailable — ignore */
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
    if (!this.canvas || !this.ctx) return; // no 2D context (CSP/restrictions) — game off, rest works
    this.stopGame();
    this.resetGame(true);
    this.gameRunning = true;
    this.gamePaused = false;
    this.lastFrameTs = 0;
    this.loopGame();
  }

  pauseGame() {
    this.gamePaused = true;
  }

  resumeGame() {
    // Never start a second loop, and never render while hidden.
    if (!this.gameRunning || !this.gamePaused) return;
    if (this.isMinimized || !this.isActive || document.hidden) return;
    if (this.activeTab !== "game") return;
    this.gamePaused = false;
    this.lastFrameTs = 0;
    this.loopGame();
  }

  stopGame() {
    this.gameRunning = false;
    this.gamePaused = false;
    if (this.gameAnimId) {
      cancelAnimationFrame(this.gameAnimId);
      this.gameAnimId = null;
    }
  }

  loopGame(ts = 0) {
    if (!this.gameRunning || this.gamePaused) {
      this.gameAnimId = null;
      return;
    }
    // Low-FX mode: cap at ~30 fps to spare weak GPUs.
    const minDelta = this.lowFx ? 33 : 0;
    if (ts - this.lastFrameTs >= minDelta) {
      this.lastFrameTs = ts;
      try {
        this.updateGamePhysics();
        this.renderGame();
      } catch {
        this.stopGame();
        return;
      }
    }
    this.gameAnimId = requestAnimationFrame((t) => this.loopGame(t));
  }

  updateGamePhysics() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const low = this.lowFx;

    // Smooth paddle following
    this.paddle.x += (this.paddle.targetX - this.paddle.x) * 0.35;

    // Ball trail
    if (!low) {
      this.ball.trail.push({ x: this.ball.x, y: this.ball.y });
      if (this.ball.trail.length > 7) this.ball.trail.shift();
    } else if (this.ball.trail.length) {
      this.ball.trail.length = 0;
    }

    // Ball movement
    this.ball.x += this.ball.vx;
    this.ball.y += this.ball.vy;

    // Wall bounces
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

    // Paddle collision
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
      // Angle depends on the hit point
      const hitOffset = (this.ball.x - (px + pw / 2)) / (pw / 2);
      const speed = Math.min(7.5, Math.hypot(this.ball.vx, this.ball.vy) * 1.02);
      const angle = hitOffset * 0.95; // max ~55 degrees
      this.ball.vx = Math.sin(angle) * speed;
      this.ball.vy = -Math.abs(Math.cos(angle) * speed);

      this.playBeep(440 + Math.abs(hitOffset) * 180, "sine", 0.07);

      // Paddle particles
      const n = low ? 2 : 5;
      for (let i = 0; i < n; i++) {
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

    // Lost ball (bottom)
    if (this.ball.y - this.ball.radius > h) {
      this.playBeep(180, "sawtooth", 0.15);
      this.resetGame(false);
      return;
    }

    // Collecting AI tokens
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const t = this.tokens[i];
      const dist = Math.hypot(this.ball.x - t.x, this.ball.y - t.y);
      if (dist <= this.ball.radius + t.radius) {
        // Hit!
        this.score += t.pts;
        const sEl = document.getElementById("game-score");
        if (sEl) sEl.textContent = this.score;

        if (this.score > this.highScore) {
          this.highScore = this.score;
          try {
            localStorage.setItem("offchat_pong_hs", String(this.highScore));
          } catch { /* ignore */ }
          const hsEl = document.getElementById("game-highscore");
          if (hsEl) hsEl.textContent = this.highScore;
        }

        this.playBeep(520 + t.pts * 8, "sine", 0.1);

        // Floating text
        this.floatingTexts.push({
          text: `+${t.pts}`,
          x: t.x,
          y: t.y,
          alpha: 1,
          color: t.color,
        });

        // Particle burst
        const n = low ? 4 : 10;
        for (let p = 0; p < n; p++) {
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

        // Bounce the ball off the token
        this.ball.vy = -this.ball.vy;
        this.tokens.splice(i, 1);
      }
    }

    // Respawn tokens when all are collected
    if (this.tokens.length === 0) {
      this.spawnTokens();
      this.playBeep(880, "sine", 0.18);
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      p.alpha = Math.max(0, p.life / 25);
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    // Update floating texts
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
    const low = this.lowFx;

    // Background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(11, 16, 32, 0.95)";
    ctx.fillRect(0, 0, w, h);

    // Subtle neon grid
    ctx.strokeStyle = "rgba(124, 58, 237, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x += 25) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y < h; y += 25) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // AI tokens
    for (const t of this.tokens) {
      t.pulse = (t.pulse || 0) + 0.05;
      const r = t.radius + Math.sin(t.pulse) * 1.5;

      ctx.save();
      if (!low) {
        ctx.shadowColor = t.color;
        ctx.shadowBlur = 10;
      }
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

    // Ball trail (skipped in low-FX mode)
    if (!low) {
      for (let i = 0; i < this.ball.trail.length; i++) {
        const tr = this.ball.trail[i];
        const a = (i + 1) / (this.ball.trail.length + 1) * 0.35;
        ctx.fillStyle = `rgba(34, 211, 238, ${a})`;
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, this.ball.radius * (0.5 + a * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Ball
    ctx.save();
    if (!low) {
      ctx.shadowColor = "#22d3ee";
      ctx.shadowBlur = 14;
    }
    ctx.fillStyle = "#e0f2fe";
    ctx.beginPath();
    ctx.arc(this.ball.x, this.ball.y, this.ball.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Paddle
    ctx.save();
    if (!low) {
      ctx.shadowColor = "#d946ef";
      ctx.shadowBlur = 12;
    }
    const grad = ctx.createLinearGradient(this.paddle.x, 0, this.paddle.x + this.paddle.width, 0);
    grad.addColorStop(0, "#22d3ee");
    grad.addColorStop(1, "#d946ef");
    ctx.fillStyle = grad;
    this.roundRect(ctx, this.paddle.x, this.paddle.y, this.paddle.width, this.paddle.height, 5);
    ctx.fill();
    ctx.restore();

    // Particles
    for (const p of this.particles) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Floating texts
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
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
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
