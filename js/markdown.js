// ─────────────────────────────────────────────────────────────
// OffChat · markdown.js — leciutki renderer Markdown (bez zależności).
// Wystarcza na odpowiedzi czatu: kod, listy, nagłówki, cytaty,
// pogrubienia, linki, tabele. Zawsze escapuje HTML (anty-XSS).
// ─────────────────────────────────────────────────────────────

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(md) {
  let h = escapeHtml(md);
  // obrazy: ![alt](url) — tylko http(s)
  h = h.replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, (_, alt, url) =>
    `<img src="${url}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer">`);
  // linki: [tekst](url) — tylko http(s)
  h = h.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, t, url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  // kod inline
  h = h.replace(/`([^`\n]+)`/g, (_, c) => `<code class="ic">${c}</code>`);
  // pogrubienie + kursywa
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|\W)\*([^*\n]+)\*/g, "$1<em>$2</em>");
  h = h.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  h = h.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return h;
}

function isTableSep(line) {
  return /^\s*\|?[\s:|-]+\|[\s:|-]+\|?\s*$/.test(line) && line.includes("|");
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

export function renderMarkdown(src) {
  const text = String(src ?? "");
  if (!text.trim()) return "";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let i = 0;
  let inFence = false;
  let fenceLang = "";
  let fenceBuf = [];

  const flushFence = () => {
    const code = escapeHtml(fenceBuf.join("\n").replace(/\n$/, ""));
    const lang = escapeHtml(fenceLang);
    html.push(
      `<div class="codeblock"><div class="codeblock-head"><span>${lang || "kod"}</span>` +
      `<button class="icon-btn xs copy-code" data-code="${encodeURIComponent(fenceBuf.join("\n"))}" title="Kopiuj kod" aria-label="Kopiuj kod">` +
      `<svg><use href="#i-copy"/></svg></button></div>` +
      `<pre><code${lang ? ` class="lang-${lang}"` : ""}>${code}</code></pre></div>`
    );
    fenceBuf = [];
    inFence = false;
    fenceLang = "";
  };

  while (i < lines.length) {
    const line = lines[i];

    // --- blok kodu ```
    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      if (inFence) flushFence();
      else { inFence = true; fenceLang = fence[1] || ""; }
      i++;
      continue;
    }
    if (inFence) { fenceBuf.push(line); i++; continue; }

    // --- pusta linia ---
    if (!line.trim()) { i++; continue; }

    // --- nagłówki ---
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      const lvl = Math.min(h[1].length + 1, 4);
      html.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }

    // --- tabela ---
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      html.push(
        `<div class="tablewrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
      );
      continue;
    }

    // --- cytat ---
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      html.push(`<blockquote>${buf.map(inline).join("<br>")}</blockquote>`);
      continue;
    }

    // --- lista punktowana ---
    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      html.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`);
      continue;
    }

    // --- lista numerowana ---
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      html.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol>`);
      continue;
    }

    // --- separator ---
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      html.push("<hr>");
      i++;
      continue;
    }

    // --- akapit (łącz linie do pustej) ---
    const buf = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() &&
      !/^(#{1,4}\s|```|>|\s*[-*•]\s+|\s*\d+[.)]\s+|\s*(---|\*\*\*|___)\s*$)/.test(lines[i])
    ) {
      if (lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) break;
      buf.push(lines[i]);
      i++;
    }
    html.push(`<p>${buf.map(inline).join("<br>")}</p>`);
  }

  if (inFence) flushFence(); // niezamknięty fence podczas streamingu
  return html.join("\n");
}

/** Bardzo przybliżone liczenie tokenów (na potrzeby paska kontekstu). */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}
