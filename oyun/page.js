(function () {
  const PAGE = JSON.parse(document.getElementById("game-data").textContent);

  const API = "https://game-hunter-api.netlify.app";
  const tl = n => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";
  const tlRound = n => Math.round(n).toLocaleString("tr-TR") + " TL";
  const usdFmt = n => "$" + n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = s => String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
  const modal = document.getElementById("modal");  // oyun sayfasında yok (null)
  const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];


  // Site puanı: "Puan 8,5 / 10 · Eleştirmen 8,1 · Oyuncu 8,8" (az veri notuyla)
  const score1 = n => n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function siteScoreHtml(ss) {
    if (!ss) return "Puan yok";
    const parts = [];
    if (ss.critics != null) parts.push(`Eleştirmen ${score1(ss.critics)}`);
    if (ss.players != null) parts.push(`Oyuncu ${score1(ss.players)}`);
    const how = parts.length === 2 ? " → " + score1(ss.score) : "";
    return `⭐ Puan ${score1(ss.score)} / 10 <small>(${parts.join(" · ")}${how}${ss.thin ? " · az veri" : ""})</small>`;
  }

  function scoresText(g) {
    const parts = [];
    for (const s of g.scores || []) {
      if (s.source === "Steam") {
        parts.push(`Steam %${s.score}`);
        if (g.steam_tr) parts.push(`TR %${g.steam_tr.percent}`);
      } else parts.push(`${s.source} ${s.score}`);
    }
    return parts.join(" · ");
  }

  function subsText(g) {
    // "🎮 Abonelikte var: Game Pass (çıkış: 15 Kasım) — aboneysen ek ücret ödemeden..."
    const subs = g.subs || [];
    if (!subs.length) return "";
    const names = subs.map(s => {
      if (!s.leaving) return s.name;
      const d = new Date(s.leaving);
      return `${s.name} (çıkış: ${d.getDate()} ${MONTHS[d.getMonth()]})`;
    });
    return `🎮 Abonelikte var: ${names.join(", ")} — aboneysen ek ücret ödemeden alabilir ya da oynayabilirsin`;
  }

  // Fiyat geçmişi grafiği (build_site.py bunu sayfaya satır içi ekler; süslü parantezleri ikiletmeye gerek yok).
// Satır içi SVG, basamaklı çizgi. Veri: "En ucuz" = g.history [[gün, TL, mağaza, indirim%]],
// "Tüm mağazalar" = /api/history stores [{shop, points: [[gün, TL, indirim%]]}]. TL = bugünkü kurla karşılık.
const STORE_COLORS = {"Steam": "#4f8cff", "Epic Games": "#9aa3b1", "GOG": "#a56bff", "Humble Store": "#ff7a59",
  "Fanatical": "#f2b81c", "GreenManGaming": "#2fb86b", "Microsoft Store": "#19b5c9", "Ubisoft Store": "#e5558d", "Blizzard": "#6c7ae0"};
const RANGES = [["3 ay", 91], ["6 ay", 182], ["1 yıl", 365], ["Tümü", 0]];
const ALL_START = Date.parse("2023-11-20T00:00:00Z");
const chartBox = document.getElementById("m-chart");
let chartGame = null, chartMode = "cheapest", chartRange = 365, chartHidden = new Set(), chartToken = 0, chartW = 0;
const dayMs = d => Date.parse(d + "T00:00:00Z");
const dateText = ms => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const todayMs = () => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); };

// Aralık [start, end] ms; "Tümü" = 20 Kas 2023'ten (Steam TR dolara geçti) ya da ilk veriden itibaren
function chartSpan(series) {
  const end = todayMs();
  if (chartRange) return [end - chartRange * 864e5, end];
  const first = Math.min(...series.map(s => s.pts[0].t));
  return [Math.max(ALL_START, first), end];
}

// Noktadan önceki son değer (ms anında geçerli nokta)
function pointAt(pts, ms) {
  let v = null;
  for (const p of pts) { if (p.t <= ms) v = p; else break; }
  return v;
}

// Görünen aralıktaki noktalar: başta aralık başındaki geçerli değer, sonda bugün
function visiblePts(pts, start, end) {
  const out = [];
  const first = pointAt(pts, start);
  if (first) out.push({ ...first, t: start });
  for (const p of pts) if (p.t > start && p.t <= end) out.push(p);
  return out;
}

function niceStep(range, n) {
  const raw = range / n, pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

function drawChart(series, W) {
  const narrow = W < 420;
  const H = narrow ? 230 : 250, L = 8, R = narrow ? 46 : 54, T = 12, B = 28;
  const [start, end] = chartSpan(series);
  const vis = series.map(s => ({ ...s, v: visiblePts(s.pts, start, end) })).filter(s => s.v.length);
  if (!vis.length) return null;
  const all = vis.flatMap(s => s.v);
  const low = all.reduce((m, p) => (p.p < m.p ? p : m));
  let lo = Math.min(...all.map(p => p.p)), hi = Math.max(...all.map(p => p.p));
  if (hi - lo < 1) hi = lo + 1;
  const step = niceStep(hi - lo, narrow ? 3 : 4);
  lo = Math.max(0, Math.floor((lo - (hi - lo) * 0.05) / step) * step);
  hi = Math.ceil((hi + (hi - lo) * 0.05) / step) * step;
  const x = ms => L + (ms - start) / (end - start) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let g = "";
  for (let v = lo; v <= hi + 1e-6; v += step) {
    const yy = y(v);
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="ax" x="${W - R + 6}" y="${yy + 4}">${Math.round(v).toLocaleString("tr-TR")}</text>`;
  }
  // Ay etiketleri: az sayıda, "Oca 2026"
  const days = (end - start) / 864e5, nTicks = narrow ? 3 : 5;
  const monthStep = Math.max(1, Math.round(days / 30 / nTicks));
  const d0 = new Date(start);
  let ty = d0.getUTCFullYear(), tm = d0.getUTCMonth() + 1, lastX = -99;
  for (let i = 0; i < 60; i++, tm++) {
    if (tm > 11) { tm = 0; ty++; }
    const ms = Date.UTC(ty, tm, 1);
    if (ms > end) break;
    if (i % monthStep) continue;
    const xx = x(ms);
    if (xx < L + 18 || xx > W - R - 18 || xx - lastX < 56) continue;
    lastX = xx;
    g += `<line class="tick" x1="${xx}" x2="${xx}" y1="${H - B}" y2="${H - B + 4}"/><text class="ax" x="${xx}" y="${H - 8}" text-anchor="middle">${MONTHS[tm].slice(0, 3)} ${ty}</text>`;
  }
  // Dönemin en düşüğü: kesikli çizgi + nokta + etiket
  const ly = y(low.p), lx = x(low.t);
  g += `<line class="lowline" x1="${L}" x2="${W - R}" y1="${ly}" y2="${ly}"/>`;
  for (const s of vis) {
    let d = "";
    s.v.forEach((p, i) => { d += i === 0 ? `M${x(p.t).toFixed(1)} ${y(p.p).toFixed(1)}` : `H${x(p.t).toFixed(1)}V${y(p.p).toFixed(1)}`; });
    d += `H${x(end).toFixed(1)}`;
    g += `<path class="line" d="${d}" style="stroke:${s.color}"/>`;
  }
  const label = tlRound(low.p), lw = label.length * 6.6 + 8;
  const labX = Math.min(Math.max(lx - lw / 2, L), W - R - lw);
  const labY = ly > T + 22 ? ly - 22 : ly + 8;
  g += `<circle class="lowdot" cx="${lx}" cy="${ly}" r="4.5"/><rect class="lowbg" x="${labX}" y="${labY}" width="${lw}" height="16" rx="4"/>` +
    `<text class="lowtxt" x="${labX + lw / 2}" y="${labY + 12}" text-anchor="middle">${label}</text>`;
  g += `<line class="guide" id="c-guide" y1="${T}" y2="${H - B}" visibility="hidden"/><g id="c-dots"></g>`;
  chartBox._geo = { W, H, L, R, T, B, start, end, x, y, vis, low };
  return `<svg class="c-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Fiyat geçmişi grafiği">${g}</svg>`;
}

function renderChart() {
  const g = chartGame;
  if (!g) { chartBox.hidden = true; return; }
  chartBox.hidden = false;
  const btn = (attr, val, on, text) => `<button data-${attr}="${val}" aria-pressed="${on}">${text}</button>`;
  const tabs = '<div class="c-bar"><div class="c-tabs">' + btn("mode", "cheapest", chartMode === "cheapest", "En ucuz") +
    btn("mode", "all", chartMode === "all", "Tüm mağazalar") + '</div><div class="c-tabs">' +
    RANGES.map(([t, d]) => btn("range", d, chartRange === d, t)).join("") + "</div></div>";
  let series = [], legend = "", body;
  if (chartMode === "all") {
    if (g._stores === undefined) { chartBox.innerHTML = tabs + '<div class="c-empty">Mağaza geçmişi yükleniyor…</div>'; return; }
    if (g._stores === null) { chartBox.innerHTML = tabs + '<div class="c-empty">Mağaza geçmişi şu an alınamadı, biraz sonra tekrar dene.</div>'; return; }
    const all = g._stores.map(s => ({ name: s.shop, color: STORE_COLORS[s.shop] || "#888",
      pts: s.points.map(a => ({ t: dayMs(a[0]), p: a[1], shop: s.shop, cut: a[2] || 0 })) }));
    legend = all.map(s => `<button data-shop="${esc(s.name)}" style="--c:${s.color}" aria-pressed="${!chartHidden.has(s.name)}"><i></i>${esc(s.name)}</button>`).join("");
    series = all.filter(s => !chartHidden.has(s.name));
  } else {
    series = [{ name: "En ucuz", color: "var(--accent)", pts: (g.history || []).map(a => ({ t: dayMs(a[0]), p: a[1], shop: a[2] || "", cut: a[3] || 0 })) }];
  }
  const shown = series.filter(s => s.pts.length);
  const W = Math.max(280, Math.floor(chartBox.clientWidth || 528));
  chartW = W;
  const svg = shown.length ? drawChart(shown, W) : null;
  if (!svg) {
    body = chartMode === "all" && legend && g._stores.length ? '<div class="c-empty">Gösterilecek mağaza seçili değil.</div>'
      : '<div class="c-empty">Bu oyun için fiyat geçmişi verisi yok.</div>';
    chartBox._geo = null;
  } else {
    const few = chartMode === "cheapest" && shown[0].pts.length < 3 ? '<div class="c-empty">Bu oyun için geçmiş verisi az.</div>' : "";
    body = '<div class="c-plot">' + svg + '<div class="c-tip" id="c-tip" hidden></div></div>' + few +
      '<div class="c-key"><span><i class="k-line"></i>Fiyat</span><span><i class="k-dash"></i>Dönemin en düşüğü</span></div>';
  }
  const note = '<div class="c-read">Fiyatlar bugünkü kurla TL karşılığıdır (Steam için kartından çekilecek tahmini tutar).</div>';
  chartBox.innerHTML = tabs + body + (legend ? '<div class="c-legend">' + legend + "</div>" : "") + note;
  chartBox._series = shown;
}

chartBox.addEventListener("click", e => {
  const mode = e.target.closest("[data-mode]"), shop = e.target.closest("[data-shop]"), range = e.target.closest("[data-range]");
  if (mode) { chartMode = mode.dataset.mode; renderChart(); if (chartMode === "all") loadStores(); }
  else if (range) { chartRange = +range.dataset.range; renderChart(); }
  else if (shop) {
    const n = shop.dataset.shop;
    chartHidden.has(n) ? chartHidden.delete(n) : chartHidden.add(n);
    renderChart();
  }
});

// Üstüne gelince / dokunup sürükleyince: kılavuz çizgi, noktalar ve nokta üstünde bilgi kutusu
function hideTip() {
  const tip = document.getElementById("c-tip"), guide = document.getElementById("c-guide"), dots = document.getElementById("c-dots");
  if (tip) tip.hidden = true;
  if (guide) guide.setAttribute("visibility", "hidden");
  if (dots) dots.innerHTML = "";
}
function showTip(e) {
  const geo = chartBox._geo, svg = e.target.closest && e.target.closest(".c-svg");
  if (!geo || !svg) return hideTip();
  const tip = document.getElementById("c-tip"), guide = document.getElementById("c-guide"), dots = document.getElementById("c-dots");
  const r = svg.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width * geo.W;
  const frac = Math.min(1, Math.max(0, (px - geo.L) / (geo.W - geo.L - geo.R)));
  const ms = Math.floor((geo.start + frac * (geo.end - geo.start)) / 864e5) * 864e5;
  const rows = geo.vis.map(s => ({ s, p: pointAt(s.pts, ms) })).filter(o => o.p).sort((a, b) => a.p.p - b.p.p);
  if (!rows.length) return hideTip();
  const gx = geo.x(ms);
  guide.setAttribute("x1", gx); guide.setAttribute("x2", gx); guide.setAttribute("visibility", "visible");
  dots.innerHTML = rows.map(o => `<circle class="ring" cx="${gx}" cy="${geo.y(o.p.p)}" r="5.5" style="stroke:${o.s.color}"/>`).join("");
  const cutText = c => (c > 0 ? `-%${c}` : "İndirim yok");
  let html = `<div class="t-date">${dateText(ms)}</div>`;
  if (chartMode === "all") {
    html += rows.map(o => `<div class="t-row"><i style="background:${o.s.color}"></i><span>${esc(o.s.name)}</span><b>${tlRound(o.p.p)}</b><em>${cutText(o.p.cut)}</em></div>`).join("");
  } else {
    const p = rows[0].p;
    html += `<div class="t-price">${tl(p.p)}</div><div class="t-sub">${esc(p.shop)} · ${cutText(p.cut)}</div>`;
  }
  html += `<div class="t-low">Dönemin en düşüğü: ${tlRound(geo.low.p)}</div>`;
  tip.innerHTML = html;
  tip.hidden = false;
  const box = tip.parentElement.getBoundingClientRect(), scale = r.width / geo.W;
  const tw = tip.offsetWidth, th = tip.offsetHeight, cx = gx * scale, cy = geo.y(rows[0].p.p) * scale;
  // Bilgi kutusu noktanın ÜSTÜNDE (parmağın altında kalmaz); üstte yer yoksa noktanın yanına (sağ ya da sol) geçer
  let left = Math.min(Math.max(cx - tw / 2, 0), box.width - tw), top = cy - th - 16;
  if (top < 0) {
    left = cx + 16 + tw <= box.width ? cx + 16 : Math.max(0, cx - 16 - tw);
    top = Math.min(Math.max(cy - th / 2, 0), r.height - th);
  }
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}
chartBox.addEventListener("pointermove", showTip);
chartBox.addEventListener("pointerdown", showTip);
chartBox.addEventListener("pointerleave", e => { if (e.pointerType !== "touch") hideTip(); });

// Pencere genişliği değişince (ya da pencere ilk açıldığında) gerçek genişlikte yeniden çiz
if (window.ResizeObserver) new ResizeObserver(() => {
  const w = Math.floor(chartBox.clientWidth);
  if (w && Math.abs(w - chartW) > 4 && chartGame && !chartBox.hidden) renderChart();
}).observe(chartBox);

async function loadStores() {
  const g = chartGame;
  if (!g || g._stores !== undefined || !g.id) return;
  const token = ++chartToken;
  try {
    const res = await fetch(API + "/api/history?id=" + encodeURIComponent(g.id));
    if (!res.ok) throw new Error();
    g._stores = (await res.json()).stores || [];
  } catch { g._stores = null; }
  if (token === chartToken && chartGame === g) renderChart();
}

function setChart(g) {
  chartGame = g; chartMode = "cheapest"; chartHidden = new Set(); chartToken++;
  renderChart();
}

  function lowLine(g) {
    // Arama sonuçları için düşük fiyat satırları (build_site.py low_info ile aynı mantık)
    if (g.low !== undefined) return g.low;
    const l = g.low_1y;
    if (!l) return "";
    const line = (label, x) => {
      const d = new Date(x.date + "T00:00:00Z");
      return `${label}: ≈ ${tlRound(x.price)} (bugünkü kurla) · ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${x.shop}`;
    };
    const a = g.low_all;
    return line("Son 1 yılın en düşüğü", l) + (a && a.price < l.price * 0.995 ? "\n" + line("20 Kas 2023'ten beri en düşük", a) : "");
  }
  function showGame(g) {
    const img = document.getElementById("m-img");
    img.src = g.image || "";
    img.hidden = !g.image;
    document.getElementById("m-title").textContent = g.title;
    document.getElementById("m-site").innerHTML = siteScoreHtml(g.site_score);
    document.getElementById("m-scores").textContent = scoresText(g);
    document.getElementById("m-subs").textContent = subsText(g);
    const best = (g.offers || [])[0];
    const atLow = g.low_1y && best && (best.card_try || best.price) <= g.low_1y.price * 1.005;
    document.getElementById("m-low").textContent = atLow ? "⭐ Şu an en düşük fiyatta · " + lowLine(g) : lowLine(g);
    setChart(g);
    if (!g.offers.length) {
      document.getElementById("m-offers").innerHTML =
        '<li class="m-empty">Bu oyun şu an Türkiye\'de resmi PC mağazalarında satılmıyor ya da henüz çıkmadı.</li>';
      if (!modal.open) modal.showModal();
      return;
    }
    document.getElementById("m-offers").innerHTML = g.offers.map((o, i) => `
      <li class="offer${i === 0 ? " best" : ""}">
        <div class="o-shop">${esc(o.shop)}${i === 0 ? "<small>En ucuz</small>" : ""}</div>
        <div class="o-price">
          <b>${o.approx ? "≈ " : ""}${o.price === 0 ? "Ücretsiz" : tl(o.price)}</b>
          ${o.cut > 0 ? `<s>${tl(o.regular)}</s> <span>-%${o.cut}</span>` : ""}
          ${o.card_try ? `<span class="o-cost">${usdFmt(o.usd)} · 💳 kartından ≈ ${tlRound(o.card_try)}</span>` : ""}
        </div>
        <a class="go" href="${esc(o.url)}" target="_blank" rel="noopener sponsored">Mağazaya git</a>
      </li>`).join("");
    if (!modal.open) modal.showModal();
  }
  async function openById(id, title, image) {
    // Fiyatlar /api/game'den gelir; yüklenirken başlık ve kapak hemen görünür
    const img = document.getElementById("m-img");
    img.src = image || "";
    img.hidden = !image;
    document.getElementById("m-title").textContent = title;
    document.getElementById("m-site").textContent = "";
    document.getElementById("m-scores").textContent = "";
    document.getElementById("m-subs").textContent = "";
    document.getElementById("m-low").textContent = "";
    setChart(null);
    document.getElementById("m-offers").innerHTML = '<li class="m-empty">Fiyatlar getiriliyor…</li>';
    if (!modal.open) modal.showModal();
    try {
      const res = await fetch(API + "/api/game?id=" + encodeURIComponent(id));
      if (!res.ok) throw new Error();
      showGame(await res.json());
    } catch {
      document.getElementById("m-offers").innerHTML = '<li class="m-empty">Fiyatlar alınamadı, biraz sonra tekrar dene.</li>';
    }
  }

  // Geçmiş: ana sayfa oyunlarında sayfada hazır; diğerlerinde /api/game'den gelir
  function showHistory(g) {
    document.getElementById("m-low").textContent = lowLine(g);
    if (g.history && g.history.length) {
      document.getElementById("m-chart").hidden = false;
      setChart(g);
    }
  }
  if (PAGE.have_history) showHistory(PAGE);
  else {
    fetch(API + "/api/game?id=" + encodeURIComponent(PAGE.id))
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(showHistory)
      .catch(() => {});  // grafik gelmezse sayfa yine de fiyatları gösterir
  }
})();
