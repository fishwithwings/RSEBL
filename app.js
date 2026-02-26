// ─── State ──────────────────────────────────────────────────────────────────
let allStocks = [];
let allHistory = {};
let sortCol = "market_cap";
let sortDir = "desc";
let filterText = "";
let filterSector = "";
let activeSymbol = null;
let priceChart = null;
let activeRangeMonths = 6;

// ─── Sector mapping ───────────────────────────────────────────────────────────
const SECTORS = {
  BNBL: "Banking", TBL: "Banking", DPNBL: "Banking", BODB: "Banking",
  RICB: "Insurance", BIL: "Insurance", GICB: "Insurance",
  BFAL: "Manufacturing", DWAL: "Manufacturing", BCCL: "Manufacturing", BFSL: "Manufacturing",
  BTCL: "Tourism", STCBL: "Tourism",
  BPCL: "Distribution", KCL: "Distribution",
  BBPL: "Publishing",
  BSRM: "Trading", JMCL: "Trading",
};

function getSector(symbol) {
  return SECTORS[symbol] || "Other";
}

// ─── Data loading ─────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const [stocksRes, newsRes, historyRes] = await Promise.all([
      fetch("data/stocks.json"),
      fetch("data/news.json"),
      fetch("data/history.json"),
    ]);

    if (stocksRes.ok) {
      const data = await stocksRes.json();
      allStocks = (data.stocks || []).filter(s => s.symbol);
      renderBSI(data.bsi);
      renderLastUpdated(data.updated_at);
      renderSectorBar();
      renderStocksTable();
    } else {
      showTableError("Could not load market data.");
    }

    if (historyRes.ok) {
      const data = await historyRes.json();
      allHistory = data.history || {};
    }

    if (newsRes.ok) {
      const data = await newsRes.json();
      renderNews(data.news || []);
    } else {
      renderNews([]);
    }
  } catch (err) {
    showTableError("Network error loading data.");
    console.error(err);
  }
}

// ─── Header ───────────────────────────────────────────────────────────────────
function renderBSI(bsi) {
  const el = document.getElementById("bsi-value");
  el.textContent = bsi != null
    ? Number(bsi).toLocaleString("en-IN", { maximumFractionDigits: 2 })
    : "—";
}

function renderLastUpdated(iso) {
  const el = document.getElementById("last-updated");
  if (!iso) { el.textContent = "—"; return; }
  const d = new Date(iso);
  el.textContent = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Sector bar ───────────────────────────────────────────────────────────────
function renderSectorBar() {
  const counts = {};
  for (const s of allStocks) {
    const sec = getSector(s.symbol);
    counts[sec] = (counts[sec] || 0) + 1;
  }

  document.getElementById("total-count").textContent = allStocks.length;

  const bar = document.getElementById("sector-bar");
  bar.innerHTML = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `
      <div class="sector-pill" data-sector="${name}" title="Filter by ${name}">
        <span class="s-name">${name}</span>
        <span class="s-count">${count}</span>
      </div>
    `).join("");

  bar.querySelectorAll(".sector-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      filterSector = filterSector === pill.dataset.sector ? "" : pill.dataset.sector;
      document.getElementById("sector-filter").value = filterSector;
      renderStocksTable();
      syncPillHighlights();
    });
  });

  // Populate sector dropdown
  const sel = document.getElementById("sector-filter");
  const sectors = [...new Set(allStocks.map(s => getSector(s.symbol)))].sort();
  sel.innerHTML = `<option value="">All Sectors</option>` +
    sectors.map(s => `<option value="${s}">${s}</option>`).join("");
}

function syncPillHighlights() {
  document.querySelectorAll(".sector-pill").forEach(p => {
    p.style.borderColor = p.dataset.sector === filterSector ? "var(--accent)" : "var(--border)";
  });
}

// ─── Stocks table ─────────────────────────────────────────────────────────────
function getFilteredStocks() {
  return allStocks.filter(s => {
    const q = filterText.toLowerCase();
    const matchText = !q ||
      (s.symbol && s.symbol.toLowerCase().includes(q)) ||
      (s.name && s.name.toLowerCase().includes(q));
    const matchSector = !filterSector || getSector(s.symbol) === filterSector;
    return matchText && matchSector;
  });
}

function renderStocksTable() {
  const stocks = getFilteredStocks();

  stocks.sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    if (va == null) va = sortDir === "asc" ? Infinity : -Infinity;
    if (vb == null) vb = sortDir === "asc" ? Infinity : -Infinity;
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  document.getElementById("row-count").textContent = `${stocks.length} securities`;

  const tbody = document.getElementById("stocks-body");

  if (!stocks.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading">No results found.</td></tr>`;
    return;
  }

  tbody.innerHTML = stocks.map(s => {
    const chg = s.change_pct;
    const chgClass = chg == null ? "flat" : chg > 0 ? "up" : chg < 0 ? "down" : "flat";
    const chgText = chg == null ? "—" : (chg > 0 ? "+" : "") + chg.toFixed(2) + "%";
    const hasHistory = !!allHistory[s.symbol];
    const isActive = s.symbol === activeSymbol;

    return `
      <tr data-symbol="${s.symbol}" class="${isActive ? "active-row" : ""}" title="${hasHistory ? "Click to view price history" : ""}">
        <td class="symbol-cell">${s.symbol}${hasHistory ? ' <span style="color:var(--text-muted);font-size:0.7rem">▼</span>' : ''}</td>
        <td class="name-cell" title="${s.name || ""}">${s.name || "—"}</td>
        <td class="num">${s.price != null ? formatNum(s.price) : "—"}</td>
        <td class="num ${chgClass}">${chgText}</td>
        <td class="num">${s.pe_ratio != null ? Number(s.pe_ratio).toFixed(2) : "—"}</td>
        <td class="num">${s.volume != null ? formatNum(s.volume, 0) : "—"}</td>
        <td class="num">${s.market_cap != null ? formatLarge(s.market_cap) : "—"}</td>
      </tr>
    `;
  }).join("");

  // Row click → show chart
  tbody.querySelectorAll("tr[data-symbol]").forEach(row => {
    row.addEventListener("click", () => {
      const sym = row.dataset.symbol;
      const stock = allStocks.find(s => s.symbol === sym);
      if (sym === activeSymbol) {
        closeChart();
      } else {
        openChart(sym, stock?.name || "");
      }
    });
  });
}

function showTableError(msg) {
  document.getElementById("stocks-body").innerHTML =
    `<tr><td colspan="7" class="loading">${msg}</td></tr>`;
}

// Sort headers
document.querySelectorAll("th.sortable").forEach(th => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    sortDir = sortCol === col ? (sortDir === "asc" ? "desc" : "asc") : (col === "symbol" || col === "name" ? "asc" : "desc");
    sortCol = col;
    document.querySelectorAll("th.sortable").forEach(h => h.classList.remove("sorted-asc", "sorted-desc"));
    th.classList.add(sortDir === "asc" ? "sorted-asc" : "sorted-desc");
    renderStocksTable();
  });
});

document.getElementById("search-input").addEventListener("input", e => {
  filterText = e.target.value;
  renderStocksTable();
});

document.getElementById("sector-filter").addEventListener("change", e => {
  filterSector = e.target.value;
  renderStocksTable();
  syncPillHighlights();
});

// ─── Chart ────────────────────────────────────────────────────────────────────
function openChart(symbol, name) {
  activeSymbol = symbol;
  document.getElementById("chart-symbol").textContent = symbol;
  document.getElementById("chart-name").textContent = name;

  const panel = document.getElementById("chart-panel");
  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });

  renderChart(symbol, activeRangeMonths);
  renderStocksTable(); // re-render to highlight active row
}

function closeChart() {
  activeSymbol = null;
  document.getElementById("chart-panel").classList.add("hidden");
  if (priceChart) { priceChart.destroy(); priceChart = null; }
  renderStocksTable();
}

document.getElementById("chart-close").addEventListener("click", closeChart);

document.querySelectorAll(".range-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".range-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeRangeMonths = parseInt(btn.dataset.months);
    if (activeSymbol) renderChart(activeSymbol, activeRangeMonths);
  });
});

function renderChart(symbol, months) {
  const wrap = document.querySelector(".chart-wrap");
  const note = document.getElementById("chart-note");

  if (priceChart) { priceChart.destroy(); priceChart = null; }

  const rawData = allHistory[symbol];
  if (!rawData || !rawData.length) {
    wrap.innerHTML = `<div class="no-history">No historical data available yet — run the scraper first.</div>`;
    note.textContent = "";
    return;
  }

  // Restore canvas if needed
  if (!document.getElementById("price-chart")) {
    wrap.innerHTML = `<canvas id="price-chart"></canvas>`;
  }

  // Filter by range
  let data = rawData;
  if (months > 0) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    data = rawData.filter(d => d.date >= cutoffStr);
  }

  if (!data.length) {
    wrap.innerHTML = `<div class="no-history">No data in this range.</div>`;
    note.textContent = "";
    return;
  }

  // Restore canvas
  if (!document.getElementById("price-chart")) {
    wrap.innerHTML = `<canvas id="price-chart"></canvas>`;
  }

  const labels = data.map(d => d.date);
  const prices = data.map(d => d.close);
  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];
  const lineColor = lastPrice >= firstPrice ? "#3fb950" : "#f85149";
  const fillColor = lastPrice >= firstPrice ? "rgba(63,185,80,0.08)" : "rgba(248,81,73,0.08)";

  note.textContent = `${data[0].date} – ${data[data.length - 1].date}  ·  ${data.length} trading days`;

  const ctx = document.getElementById("price-chart").getContext("2d");
  priceChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: prices,
        borderColor: lineColor,
        backgroundColor: fillColor,
        borderWidth: 1.5,
        pointRadius: data.length > 200 ? 0 : 2,
        pointHoverRadius: 4,
        fill: true,
        tension: 0.1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#161b22",
          borderColor: "#30363d",
          borderWidth: 1,
          titleColor: "#8b949e",
          bodyColor: "#e6edf3",
          callbacks: {
            title: items => items[0].label,
            label: item => `Nu. ${formatNum(item.raw)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#8b949e",
            maxTicksLimit: 8,
            maxRotation: 0,
          },
          grid: { color: "#21262d" },
        },
        y: {
          ticks: {
            color: "#8b949e",
            callback: v => "Nu. " + formatNum(v),
          },
          grid: { color: "#21262d" },
        },
      },
    },
  });
}

// ─── News ─────────────────────────────────────────────────────────────────────
function renderNews(newsItems) {
  const container = document.getElementById("news-list");

  if (!newsItems.length) {
    container.innerHTML = `<p class="no-news">No news available yet. Data updates daily after market close.</p>`;
    return;
  }

  container.innerHTML = newsItems.map(item => {
    const titleHtml = item.url
      ? `<a href="${item.url}" target="_blank" rel="noopener">${item.title}</a>`
      : item.title;
    const dateHtml = item.date
      ? `<span class="news-meta">${formatDate(item.date)}</span>`
      : "";
    return `
      <div class="news-item">
        <div class="news-title">${titleHtml}</div>
        ${dateHtml}
      </div>
    `;
  }).join("");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatNum(n, decimals = 2) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatLarge(n) {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────
loadData();
