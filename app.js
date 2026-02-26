// ─── State ──────────────────────────────────────────────────────────────────
let allStocks = [];
let sortCol = "market_cap";
let sortDir = "desc";
let filterText = "";
let filterSector = "";
let portfolio = JSON.parse(localStorage.getItem("rsebl_portfolio") || "[]");

// ─── Sector mapping (symbol → sector) ───────────────────────────────────────
const SECTORS = {
  BNBL: "Banking", TBL: "Banking", DPNBL: "Banking", BODB: "Banking",
  RICB: "Insurance", BIL: "Insurance", GICB: "Insurance",
  BFAL: "Manufacturing", DWAL: "Manufacturing", BCCL: "Manufacturing",
  BTCL: "Tourism", STCBL: "Tourism",
  BPCL: "Distribution", KCL: "Distribution",
  BBPL: "Publishing",
  BSRM: "Trading",
};

function getSector(symbol) {
  return SECTORS[symbol] || "Other";
}

// ─── Data loading ────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const [stocksRes, newsRes] = await Promise.all([
      fetch("data/stocks.json"),
      fetch("data/news.json"),
    ]);

    if (stocksRes.ok) {
      const data = await stocksRes.json();
      allStocks = (data.stocks || []).filter(s => s.symbol);
      renderBSI(data.bsi);
      renderLastUpdated(data.updated_at);
      renderSectorBar();
      renderStocksTable();
      populatePortfolioSelect();
      renderPortfolio();
    } else {
      showTableError("Could not load market data.");
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

// ─── Header renders ──────────────────────────────────────────────────────────
function renderBSI(bsi) {
  const el = document.getElementById("bsi-value");
  el.textContent = bsi != null ? Number(bsi).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—";
}

function renderLastUpdated(iso) {
  const el = document.getElementById("last-updated");
  if (!iso) { el.textContent = "—"; return; }
  const d = new Date(iso);
  el.textContent = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Sector bar ──────────────────────────────────────────────────────────────
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
    pill.style.cursor = "pointer";
    pill.addEventListener("click", () => {
      const sec = pill.dataset.sector;
      filterSector = filterSector === sec ? "" : sec;
      document.getElementById("sector-filter").value = filterSector;
      renderStocksTable();
      // Highlight active pill
      bar.querySelectorAll(".sector-pill").forEach(p =>
        p.style.borderColor = p.dataset.sector === filterSector ? "var(--accent)" : "var(--border)"
      );
    });
  });

  // Populate sector dropdown
  const sel = document.getElementById("sector-filter");
  const sectors = [...new Set(allStocks.map(s => getSector(s.symbol)))].sort();
  sel.innerHTML = `<option value="">All Sectors</option>` +
    sectors.map(s => `<option value="${s}">${s}</option>`).join("");
}

// ─── Stocks table ────────────────────────────────────────────────────────────
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

  // Sort
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

  if (stocks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading">No results found.</td></tr>`;
    return;
  }

  tbody.innerHTML = stocks.map(s => {
    const chg = s.change_pct;
    const chgClass = chg == null ? "flat" : chg > 0 ? "up" : chg < 0 ? "down" : "flat";
    const chgText = chg == null ? "—" : (chg > 0 ? "+" : "") + chg.toFixed(2) + "%";
    const price = s.price != null ? formatNum(s.price) : "—";
    const pe = s.pe_ratio != null ? Number(s.pe_ratio).toFixed(2) : "—";
    const vol = s.volume != null ? formatNum(s.volume, 0) : "—";
    const cap = s.market_cap != null ? formatLarge(s.market_cap) : "—";

    return `
      <tr>
        <td class="symbol-cell">${s.symbol}</td>
        <td class="name-cell" title="${s.name || ""}">${s.name || "—"}</td>
        <td class="num">${price}</td>
        <td class="num ${chgClass}">${chgText}</td>
        <td class="num">${pe}</td>
        <td class="num">${vol}</td>
        <td class="num">${cap}</td>
      </tr>
    `;
  }).join("");
}

function showTableError(msg) {
  document.getElementById("stocks-body").innerHTML =
    `<tr><td colspan="7" class="loading">${msg}</td></tr>`;
}

// Sort on header click
document.querySelectorAll("th.sortable").forEach(th => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    if (sortCol === col) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortCol = col;
      sortDir = col === "symbol" || col === "name" ? "asc" : "desc";
    }
    // Update header classes
    document.querySelectorAll("th.sortable").forEach(h => {
      h.classList.remove("sorted-asc", "sorted-desc");
    });
    th.classList.add(sortDir === "asc" ? "sorted-asc" : "sorted-desc");
    renderStocksTable();
  });
});

// Search
document.getElementById("search-input").addEventListener("input", e => {
  filterText = e.target.value;
  renderStocksTable();
});

// Sector dropdown
document.getElementById("sector-filter").addEventListener("change", e => {
  filterSector = e.target.value;
  renderStocksTable();
  // Sync pill highlights
  document.querySelectorAll(".sector-pill").forEach(p =>
    p.style.borderColor = p.dataset.sector === filterSector ? "var(--accent)" : "var(--border)"
  );
});

// ─── News ────────────────────────────────────────────────────────────────────
function renderNews(newsItems) {
  const container = document.getElementById("news-list");

  if (!newsItems.length) {
    container.innerHTML = `<p class="no-news">No news available yet. Data updates daily.</p>`;
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

// ─── Portfolio ───────────────────────────────────────────────────────────────
function savePortfolio() {
  localStorage.setItem("rsebl_portfolio", JSON.stringify(portfolio));
}

function populatePortfolioSelect() {
  const sel = document.getElementById("form-symbol");
  sel.innerHTML = `<option value="">Select security...</option>` +
    [...allStocks]
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map(s => `<option value="${s.symbol}">${s.symbol} — ${s.name || ""}</option>`)
      .join("");
}

function renderPortfolio() {
  const tbody = document.getElementById("portfolio-body");

  if (!portfolio.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="loading">No holdings yet. Add one above.</td></tr>`;
    updatePortfolioSummary(0, 0);
    return;
  }

  let totalInvested = 0;
  let totalCurrent = 0;

  const rows = portfolio.map((h, idx) => {
    const stock = allStocks.find(s => s.symbol === h.symbol);
    const currentPrice = stock?.price ?? null;
    const invested = h.shares * h.buyPrice;
    const current = currentPrice != null ? h.shares * currentPrice : null;
    const pnl = current != null ? current - invested : null;
    const ret = pnl != null ? (pnl / invested) * 100 : null;

    totalInvested += invested;
    if (current != null) totalCurrent += current;

    const pnlClass = pnl == null ? "flat" : pnl > 0 ? "up" : pnl < 0 ? "down" : "flat";

    return `
      <tr>
        <td class="symbol-cell">${h.symbol}</td>
        <td class="name-cell">${stock?.name || ""}</td>
        <td class="num">${formatNum(h.shares, 0)}</td>
        <td class="num">${formatNum(h.buyPrice)}</td>
        <td class="num">${currentPrice != null ? formatNum(currentPrice) : "—"}</td>
        <td class="num">${current != null ? formatNum(current) : "—"}</td>
        <td class="num ${pnlClass}">${pnl != null ? (pnl >= 0 ? "+" : "") + formatNum(pnl) : "—"}</td>
        <td class="num ${pnlClass}">${ret != null ? (ret >= 0 ? "+" : "") + ret.toFixed(2) + "%" : "—"}</td>
        <td><button class="btn-remove" data-idx="${idx}" title="Remove">×</button></td>
      </tr>
    `;
  }).join("");

  tbody.innerHTML = rows;
  updatePortfolioSummary(totalInvested, totalCurrent);

  tbody.querySelectorAll(".btn-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      portfolio.splice(Number(btn.dataset.idx), 1);
      savePortfolio();
      renderPortfolio();
    });
  });
}

function updatePortfolioSummary(invested, current) {
  const pnl = current - invested;
  const ret = invested > 0 ? (pnl / invested) * 100 : 0;
  const cls = pnl > 0 ? "up" : pnl < 0 ? "down" : "flat";

  document.getElementById("pf-invested").textContent = "Nu. " + formatNum(invested);
  document.getElementById("pf-value").textContent = "Nu. " + formatNum(current);

  const pnlEl = document.getElementById("pf-pnl");
  pnlEl.textContent = (pnl >= 0 ? "+" : "") + "Nu. " + formatNum(pnl);
  pnlEl.className = `pf-val ${cls}`;

  const retEl = document.getElementById("pf-return");
  retEl.textContent = (ret >= 0 ? "+" : "") + ret.toFixed(2) + "%";
  retEl.className = `pf-val ${cls}`;
}

// Add holding
document.getElementById("add-holding-btn").addEventListener("click", () => {
  document.getElementById("add-form").classList.toggle("hidden");
});

document.getElementById("cancel-holding-btn").addEventListener("click", () => {
  document.getElementById("add-form").classList.add("hidden");
  clearForm();
});

document.getElementById("save-holding-btn").addEventListener("click", () => {
  const symbol = document.getElementById("form-symbol").value;
  const shares = parseFloat(document.getElementById("form-shares").value);
  const buyPrice = parseFloat(document.getElementById("form-buy-price").value);

  if (!symbol || isNaN(shares) || shares <= 0 || isNaN(buyPrice) || buyPrice <= 0) {
    alert("Please fill in all fields correctly.");
    return;
  }

  portfolio.push({ symbol, shares, buyPrice });
  savePortfolio();
  renderPortfolio();
  document.getElementById("add-form").classList.add("hidden");
  clearForm();
});

function clearForm() {
  document.getElementById("form-symbol").value = "";
  document.getElementById("form-shares").value = "";
  document.getElementById("form-buy-price").value = "";
}

// ─── Tabs ────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
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
  } catch {
    return iso;
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────
loadData();
