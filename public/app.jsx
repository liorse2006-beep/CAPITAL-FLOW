const { useState, useEffect, useCallback, useRef } = React;

const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#a855f7","#06b6d4","#ec4899","#f97316","#84cc16","#14b8a6","#3b82f6"];

const SECTOR_ETFS = [
  { ticker: "XLK",  color: "#06b6d4", name: "Technology",             desc: "Tech giants — software, hardware, semiconductors, and IT services",
    holdings: [{ sym: "AAPL", name: "Apple Inc.", weight: "21.5%" }, { sym: "MSFT", name: "Microsoft Corp.", weight: "20.8%" }, { sym: "NVDA", name: "NVIDIA Corp.", weight: "6.2%" }] },
  { ticker: "XLF",  color: "#10b981", name: "Financials",             desc: "Banks, insurance companies, asset managers, and capital markets",
    holdings: [{ sym: "BRK.B", name: "Berkshire Hathaway", weight: "14.1%" }, { sym: "JPM", name: "JPMorgan Chase", weight: "10.5%" }, { sym: "V", name: "Visa Inc.", weight: "7.8%" }] },
  { ticker: "XLV",  color: "#ef4444", name: "Health Care",            desc: "Pharma, biotech, medical devices, and health care providers",
    holdings: [{ sym: "LLY", name: "Eli Lilly & Co.", weight: "11.8%" }, { sym: "UNH", name: "UnitedHealth Group", weight: "9.5%" }, { sym: "JNJ", name: "Johnson & Johnson", weight: "7.2%" }] },
  { ticker: "XLY",  color: "#f59e0b", name: "Consumer Discretionary", desc: "Retail, autos, apparel, restaurants, and luxury goods",
    holdings: [{ sym: "AMZN", name: "Amazon.com Inc.", weight: "22.3%" }, { sym: "TSLA", name: "Tesla Inc.", weight: "14.6%" }, { sym: "HD", name: "Home Depot Inc.", weight: "8.1%" }] },
  { ticker: "XLP",  color: "#f97316", name: "Consumer Staples",       desc: "Food, beverages, household products, and personal care",
    holdings: [{ sym: "PG", name: "Procter & Gamble", weight: "14.8%" }, { sym: "COST", name: "Costco Wholesale", weight: "11.2%" }, { sym: "KO", name: "Coca-Cola Co.", weight: "9.5%" }] },
  { ticker: "XLE",  color: "#84cc16", name: "Energy",                 desc: "Oil & gas exploration, production, refining, and equipment",
    holdings: [{ sym: "XOM", name: "Exxon Mobil Corp.", weight: "22.7%" }, { sym: "CVX", name: "Chevron Corp.", weight: "15.3%" }, { sym: "COP", name: "ConocoPhillips", weight: "7.8%" }] },
  { ticker: "XLI",  color: "#8b5cf6", name: "Industrials",            desc: "Aerospace, defense, machinery, construction, and logistics",
    holdings: [{ sym: "GE", name: "GE Aerospace", weight: "8.9%" }, { sym: "CAT", name: "Caterpillar Inc.", weight: "5.6%" }, { sym: "RTX", name: "RTX Corp.", weight: "4.8%" }] },
  { ticker: "XLB",  color: "#ec4899", name: "Materials",              desc: "Chemicals, metals, mining, packaging, and construction materials",
    holdings: [{ sym: "LIN", name: "Linde plc", weight: "17.2%" }, { sym: "SHW", name: "Sherwin-Williams", weight: "9.1%" }, { sym: "FCX", name: "Freeport-McMoRan", weight: "6.8%" }] },
  { ticker: "XLRE", color: "#6366f1", name: "Real Estate",            desc: "REITs — commercial, residential, and specialized real estate",
    holdings: [{ sym: "PLD", name: "Prologis Inc.", weight: "13.5%" }, { sym: "AMT", name: "American Tower", weight: "9.8%" }, { sym: "EQIX", name: "Equinix Inc.", weight: "7.6%" }] },
  { ticker: "XLU",  color: "#14b8a6", name: "Utilities",              desc: "Electric, gas, water utilities, and renewable energy producers",
    holdings: [{ sym: "NEE", name: "NextEra Energy", weight: "14.9%" }, { sym: "SO", name: "Southern Company", weight: "8.3%" }, { sym: "DUK", name: "Duke Energy Corp.", weight: "7.1%" }] },
  { ticker: "XLC",  color: "#3b82f6", name: "Communication Services", desc: "Telecom, media, entertainment, and interactive platforms",
    holdings: [{ sym: "META", name: "Meta Platforms", weight: "23.1%" }, { sym: "GOOGL", name: "Alphabet Inc.", weight: "22.4%" }, { sym: "NFLX", name: "Netflix Inc.", weight: "5.8%" }] },
  { ticker: "SOXX", color: "#06b6d4", name: "Semiconductors",         desc: "Chip designers, foundries, and semiconductor equipment makers",
    holdings: [{ sym: "NVDA", name: "NVIDIA Corp.", weight: "10.2%" }, { sym: "AVGO", name: "Broadcom Inc.", weight: "8.5%" }, { sym: "AMD", name: "AMD Inc.", weight: "7.1%" }] },
  { ticker: "XOP",  color: "#84cc16", name: "Oil & Gas E&P",          desc: "Oil and gas exploration and production companies",
    holdings: [{ sym: "COP", name: "ConocoPhillips", weight: "5.1%" }, { sym: "EOG", name: "EOG Resources", weight: "4.9%" }, { sym: "PXD", name: "Pioneer Natural", weight: "4.7%" }] },
  { ticker: "XTL",  color: "#f59e0b", name: "Telecom",                desc: "Wireless carriers, broadband providers, and telecom infrastructure",
    holdings: [{ sym: "T", name: "AT&T Inc.", weight: "5.2%" }, { sym: "VZ", name: "Verizon Comm.", weight: "4.9%" }, { sym: "TMUS", name: "T-Mobile US", weight: "4.8%" }] },
  { ticker: "IGV",  color: "#8b5cf6", name: "Software",               desc: "Enterprise and consumer software, SaaS, and cloud platforms",
    holdings: [{ sym: "MSFT", name: "Microsoft Corp.", weight: "9.4%" }, { sym: "CRM", name: "Salesforce Inc.", weight: "5.1%" }, { sym: "ORCL", name: "Oracle Corp.", weight: "4.8%" }] },
];

function fmt(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(n);
}

function exportCSV(data, filename) {
  if (!data || !data.length) return;
  const keys = Object.keys(data[0]);
  const csv = [keys.join(","), ...data.map(row => keys.map(k => {
    const v = row[k];
    if (typeof v === "string" && (v.includes(",") || v.includes('"'))) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportPDF(data, title) {
  if (!data || !data.length) return;
  const keys = Object.keys(data[0]);
  const colW = Math.floor(540 / keys.length);
  const rowH = 18;
  const headerH = 22;
  const pageH = 780;
  const margin = 28;
  let y = margin;
  const lines = [];
  const addText = (x, ty, text, opts = {}) => lines.push({ x, y: ty, text: String(text).slice(0, 30), ...opts });
  addText(margin, y, title, { size: 16, bold: true });
  y += 24;
  addText(margin, y, new Date().toLocaleString(), { size: 9, color: "#888" });
  y += 28;
  keys.forEach((k, ci) => addText(margin + ci * colW, y, k, { size: 8, bold: true, color: "#6366f1" }));
  y += headerH;
  data.forEach(row => {
    if (y > pageH - margin) { lines.push({ pageBreak: true }); y = margin + headerH; }
    keys.forEach((k, ci) => {
      let v = row[k];
      if (typeof v === "number") v = v % 1 !== 0 ? v.toFixed(2) : v.toLocaleString();
      addText(margin + ci * colW, y, v || "—", { size: 8 });
    });
    y += rowH;
  });
  let pages = [[]];
  lines.forEach(l => { if (l.pageBreak) pages.push([]); else pages[pages.length - 1].push(l); });
  const svgPages = pages.map(pg => {
    const texts = pg.map(t =>
      `<text x="${t.x}" y="${t.y}" font-family="Inter,sans-serif" font-size="${t.size || 10}" fill="${t.color || '#222'}" font-weight="${t.bold ? '700' : '400'}">${t.text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</text>`
    ).join("\n");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842" width="595" height="842"><rect width="595" height="842" fill="#fff"/>${texts}</svg>`;
  });
  const html = `<!DOCTYPE html><html><head><title>${title}</title><style>@media print{@page{margin:0;size:A4}body{margin:0}svg{page-break-after:always;display:block}}</style></head><body>${svgPages.join("")}</body></html>`;
  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.print(); }, 400);
}

function ExportBtn({ data, filename, label }) {
  return (
    <button className="export-btn" onClick={() => exportCSV(data, filename)} title={`Export ${label || "data"} as CSV`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      CSV
    </button>
  );
}

function PDFBtn({ data, title }) {
  return (
    <button className="export-btn" onClick={() => exportPDF(data, title)} title="Export as PDF">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
      PDF
    </button>
  );
}

/* ── Expandable Row Detail ── */
function RowDetail({ r }) {
  return (
    <tr className="detail-row">
      <td colSpan="8">
        <div className="detail-panel">
          <div className="detail-group">
            <div className="detail-group-title">Price</div>
            <div className="detail-items">
              <div className="detail-item">
                <span className="detail-item-label">Day High</span>
                <span className="detail-item-sep">-</span>
                <span className="detail-item-val">${(r.dayHigh || 0).toFixed(2)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-item-label">Day Low</span>
                <span className="detail-item-sep">-</span>
                <span className="detail-item-val">${(r.dayLow || 0).toFixed(2)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-item-label">Prev Close</span>
                <span className="detail-item-sep">-</span>
                <span className="detail-item-val">${(r.prevClose || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div className="detail-group">
            <div className="detail-group-title">52-Week Range</div>
            <div className="detail-items">
              <div className="detail-item">
                <span className="detail-item-label">52W High</span>
                <span className="detail-item-sep">-</span>
                <span className="detail-item-val">${(r.fiftyTwoWeekHigh || 0).toFixed(2)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-item-label">52W Low</span>
                <span className="detail-item-sep">-</span>
                <span className="detail-item-val">${(r.fiftyTwoWeekLow || 0).toFixed(2)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-item-label">Mkt Cap</span>
                <span className="detail-item-sep">-</span>
                <span className="detail-item-val">{fmt(r.marketCap)}</span>
              </div>
            </div>
          </div>
          <div className="detail-group">
            <div className="detail-group-title">Volume</div>
            <div className="detail-items">
              <div className="detail-item">
                <span className="detail-item-label">Today</span>
                <span className="detail-item-sep">-</span>
                <span className="detail-item-val">{fmt(r.volume)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-item-label">10d Avg</span>
                <span className="detail-item-sep">-</span>
                <span className="detail-item-val">{fmt(r.avgVolume)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-item-label">Ratio</span>
                <span className="detail-item-sep">-</span>
                <span className="detail-item-val" style={{ color: "var(--accent)" }}>{r.volumeRatio}x</span>
              </div>
            </div>
          </div>
          <div className="detail-links">
            <span className="detail-links-label">Open chart in</span>
            <a className="detail-link" href={`https://www.tradingview.com/chart/?symbol=${r.symbol}`} target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              TradingView
            </a>
            <a className="detail-link" href={`https://finance.yahoo.com/quote/${r.symbol}`} target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Yahoo Finance
            </a>
          </div>
        </div>
      </td>
    </tr>
  );
}

/* ── Money Flow Page ── */
function MoneyFlow({ theme }) {
  const [flowData, setFlowData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchTime, setFetchTime] = useState(null);
  const [error, setError] = useState(null);
  const [expandedETF, setExpandedETF] = useState(null);
  const [flowSort, setFlowSort] = useState("volRatio");
  const [flowSortDir, setFlowSortDir] = useState("desc");

  const handleFlowSort = (f) => {
    setFlowSortDir(flowSort === f ? (flowSortDir === "asc" ? "desc" : "asc") : "desc");
    setFlowSort(f);
  };

  const fetchFlow = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/sector-flow");
      if (!r.ok) throw new Error((await r.json()).error || "Fetch failed");
      const d = await r.json();
      setFlowData(d.results);
      setFetchTime(d.fetchTime);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  const inflows = flowData ? flowData.filter(d => d.flow === "inflow").sort((a, b) => b.volRatio - a.volRatio) : [];
  const outflows = flowData ? flowData.filter(d => d.flow === "outflow").sort((a, b) => b.volRatio - a.volRatio) : [];
  const neutrals = flowData ? flowData.filter(d => d.flow === "neutral") : [];
  const etfMap = {};
  SECTOR_ETFS.forEach(s => { etfMap[s.ticker] = s; });

  return (
    <div className="page-content">
      <div className="flow-header">
        <div>
          <h2 className="flow-title">Sector Money Flow</h2>
          <p className="flow-sub">Real-time capital rotation across 15 sector ETFs</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {flowData && <>
            <ExportBtn data={flowData.map(d => ({ Ticker: d.symbol, Sector: etfMap[d.symbol]?.name || d.symbol, Price: d.price, "Change%": d.change, Volume: d.volume, AvgVol10d: d.avgVolume, VolRatio: d.volRatio, Flow: d.flow }))} filename={`sector-flow-${new Date().toISOString().slice(0,10)}.csv`} label="flow data" />
            <PDFBtn data={flowData.map(d => ({ Ticker: d.symbol, Sector: etfMap[d.symbol]?.name || d.symbol, Price: "$" + d.price.toFixed(2), "Chg%": (d.change >= 0 ? "+" : "") + d.change + "%", Volume: fmt(d.volume), AvgVol: fmt(d.avgVolume), Ratio: d.volRatio + "x", Flow: d.flow.toUpperCase() }))} title="Sector Money Flow Report" />
          </>}
          <button className="scan-btn" onClick={fetchFlow} disabled={loading}>
            {loading ? <><div className="spinner" /> Fetching...</> : "Refresh Flow"}
          </button>
        </div>
      </div>

      {error && <div className="error-bar">{error}</div>}

      {!flowData && !loading && (
        <div className="empty">
          <div className="empty-icon">
            <svg viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M2 12h20" /><path d="M17 7l-5 5-5-5" />
            </svg>
          </div>
          <h2>Money Flow Analysis</h2>
          <p>Hit Refresh Flow to fetch live sector ETF data and see where capital is flowing.</p>
        </div>
      )}

      {loading && (
        <div className="progress-wrap">
          <div className="progress-top"><span>Fetching 15 sector ETFs...</span></div>
          <div className="progress-track">
            <div className="progress-bar" style={{ width: "60%" }} />
          </div>
        </div>
      )}

      {flowData && (() => {
        const flowOrder = { inflow: 0, outflow: 1, neutral: 2 };
        const sorted = [...flowData].sort((a, b) => {
          let av, bv;
          if (flowSort === "flow") { av = flowOrder[a.flow]; bv = flowOrder[b.flow]; }
          else if (flowSort === "sector") { av = etfMap[a.symbol]?.name || a.symbol; bv = etfMap[b.symbol]?.name || b.symbol; }
          else { av = a[flowSort]; bv = b[flowSort]; }
          if (typeof av === "string") return flowSortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
          return flowSortDir === "asc" ? av - bv : bv - av;
        });
        const FTH = ({ label, field }) => (
          <th className={flowSort === field ? "active" : ""} onClick={() => handleFlowSort(field)}>
            {label}{flowSort === field && <span className="sort-icon">{flowSortDir === "asc" ? "▲" : "▼"}</span>}
          </th>
        );
        return (
          <div className="table-card">
            <div className="table-bar">
              <div>
                <h2>All Sectors</h2>
                <span className="table-bar-sub">{inflows.length} inflow · {outflows.length} outflow · {neutrals.length} neutral</span>
              </div>
              <span className="table-bar-count">{flowData.length} sectors</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    <FTH label="Ticker" field="symbol" />
                    <FTH label="Sector" field="sector" />
                    <FTH label="Price" field="price" />
                    <FTH label="Change %" field="change" />
                    <FTH label="Vol Ratio" field="volRatio" />
                    <FTH label="Flow" field="flow" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((d, i) => {
                    const etf = etfMap[d.symbol];
                    const open = expandedETF === d.symbol;
                    return (
                      <React.Fragment key={d.symbol}>
                        <tr className={`flow-row ${open ? "expanded" : ""}`} onClick={() => setExpandedETF(open ? null : d.symbol)}>
                          <td className="col-rank">{i + 1}</td>
                          <td className="col-ticker">{d.symbol}</td>
                          <td className="col-name" style={{ fontFamily: "var(--font)" }}>{etf?.name || d.symbol}</td>
                          <td>${d.price.toFixed(2)}</td>
                          <td className={d.change >= 0 ? "col-pos" : "col-neg"}>
                            {d.change >= 0 ? "+" : ""}{d.change}%
                          </td>
                          <td>
                            <span className={`ratio-pill ${d.volRatio >= 2 ? "hot" : d.volRatio >= 1.2 ? "warm" : "ok"}`}>
                              {d.volRatio}x
                            </span>
                          </td>
                          <td><span className={`flow-badge ${d.flow}`}>{d.flow.toUpperCase()}</span></td>
                        </tr>
                        {open && etf?.holdings && (
                          <tr className="holdings-row">
                            <td colSpan="7">
                              <div className="holdings-inline">
                                <span className="holdings-title">Top Holdings</span>
                                <div className="holdings-chips">
                                  {etf.holdings.map(h => (
                                    <div key={h.sym} className="holding-chip">
                                      <span className="holding-sym">{h.sym}</span>
                                      <span className="holding-name">{h.name}</span>
                                      <span className="holding-weight">{h.weight}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {fetchTime && <div className="table-footer">Last updated: {new Date(fetchTime).toLocaleString()}</div>}
          </div>
        );
      })()}
    </div>
  );
}

/* ── Main App ── */
function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("vs-theme") || "dark");
  const [page, setPage] = useState("scanner");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [scanTime, setScanTime] = useState(null);
  const [sortField, setSortField] = useState("volumeRatio");
  const [sortDir, setSortDir] = useState("desc");
  const [minRatio, setMinRatio] = useState("2.5");
  const [minCap, setMinCap] = useState("1");
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("All");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [error, setError] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const poll = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("vs-theme", theme);
  }, [theme]);

  useEffect(() => {
    fetch("/api/last-results").then(r => r.json()).then(d => {
      if (d.results && d.results.length) { setResults(d.results); setScanTime(d.scanTime); }
    }).catch(() => {});
  }, []);

  const startScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setExpandedRow(null);
    setProgress({ processed: 0, total: 1, found: 0 });

    poll.current = setInterval(async () => {
      try {
        const r = await fetch("/api/progress");
        const d = await r.json();
        if (d.progress) setProgress(d.progress);
        if (!d.running) clearInterval(poll.current);
      } catch {}
    }, 800);

    try {
      const cap = parseFloat(minCap) * 1e9;
      const r = await fetch(`/api/scan?minVolumeRatio=${minRatio}&minMarketCap=${cap}`);
      if (!r.ok) throw new Error((await r.json()).error || "Scan failed");
      const d = await r.json();
      setResults(d.results);
      setScanTime(d.scanTime);
    } catch (e) { setError(e.message); }
    finally { setScanning(false); setProgress(null); clearInterval(poll.current); }
  }, [minRatio, minCap]);

  const handleSort = (f) => {
    setSortDir(sortField === f ? (sortDir === "asc" ? "desc" : "asc") : "desc");
    setSortField(f);
  };

  const filtered = results ? results.filter(r => {
    if (search) {
      const q = search.toLowerCase();
      if (!r.symbol.toLowerCase().includes(q) && !(r.name || "").toLowerCase().includes(q)) return false;
    }
    if (sectorFilter !== "All" && r.sector !== sectorFilter) return false;
    if (minPrice && r.price < parseFloat(minPrice)) return false;
    if (maxPrice && r.price > parseFloat(maxPrice)) return false;
    return true;
  }) : [];

  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortField], bv = b[sortField];
    if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === "asc" ? av - bv : bv - av;
  });

  const allSectors = results ? [...new Set(results.map(r => r.sector).filter(Boolean).filter(s => s !== "N/A"))].sort() : [];

  const TH = ({ label, field }) => (
    <th className={sortField === field ? "active" : ""} onClick={() => handleSort(field)}>
      {label}{sortField === field && <span className="sort-icon">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );

  return (
    <>
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />

      <div className="app">
        <header className="topbar">
          <div className="topbar-left">
            <div className="logo-mark">
              <svg viewBox="0 0 24 24"><path d="M3 17V7h4v10H3zm7 3V4h4v16h-4zm7-7v-3h4v3h-4z"/></svg>
            </div>
            <div className="logo-text">
              <h1>Volume Scanner</h1>
              <span>S&P 500 &middot; NASDAQ 100</span>
            </div>
          </div>
          <div className="topbar-right">
            <button className="theme-btn" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")} title="Toggle theme">
              {theme === "dark" ? "☀" : "☾"}
            </button>
            {page === "scanner" && results && (<>
              <ExportBtn data={sorted.map(r => ({ Ticker: r.symbol, Name: r.name, Price: r.price, "Change%": r.change.toFixed(2), Volume: r.volume, AvgVol10d: r.avgVolume, VolumeRatio: r.volumeRatio, MarketCap: r.marketCap, Sector: r.sector }))} filename={`volume-scan-${new Date().toISOString().slice(0,10)}.csv`} label="scan results" />
              <PDFBtn data={sorted.map(r => ({ Ticker: r.symbol, Name: r.name, Price: "$" + r.price.toFixed(2), "Chg%": (r.change >= 0 ? "+" : "") + r.change.toFixed(2) + "%", Volume: fmt(r.volume), AvgVol: fmt(r.avgVolume), Ratio: r.volumeRatio + "x", MktCap: fmt(r.marketCap), Sector: r.sector }))} title="Volume Scanner Report" />
            </>)}
            {page === "scanner" && (
              <button className="scan-btn" onClick={startScan} disabled={scanning}>
                {scanning ? <><div className="spinner" /> Scanning...</> : "Scan Now"}
              </button>
            )}
          </div>
        </header>

        <nav className="nav-tabs">
          <button className={`nav-tab ${page === "scanner" ? "active" : ""}`} onClick={() => setPage("scanner")}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 5-9"/>
            </svg>
            Volume Scanner
          </button>
          <button className={`nav-tab ${page === "flow" ? "active" : ""}`} onClick={() => setPage("flow")}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20"/><path d="M17 7l-5-5-5 5"/><path d="M17 17l-5 5-5-5"/>
            </svg>
            Money Flow
          </button>
        </nav>

        {page === "flow" && <MoneyFlow theme={theme} />}

        {page === "scanner" && <div className="page-content">

        {scanning && progress && (
          <div className="progress-wrap">
            <div className="progress-top">
              <span>Scanning {progress.total} tickers</span>
              <span>{progress.processed} / {progress.total}</span>
            </div>
            <div className="progress-track">
              <div className="progress-bar" style={{ width: Math.round(progress.processed / progress.total * 100) + "%" }} />
            </div>
            <div className="progress-sub">{progress.found} match{progress.found !== 1 ? "es" : ""} found so far</div>
          </div>
        )}

        {error && <div className="error-bar">{error}</div>}

        {!results && !scanning && (
          <div className="empty">
            <div className="empty-icon">
              <svg viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 5-9" />
              </svg>
            </div>
            <h2>Ready to Scan</h2>
            <p>Hit Scan Now to find stocks with unusual volume across the S&P 500 and NASDAQ 100.</p>
          </div>
        )}

        {results && (
          <div className="table-card">
            <div className="table-bar">
              <div>
                <h2>{sorted.length} Result{sorted.length !== 1 ? "s" : ""}</h2>
                {scanTime && <span className="table-bar-sub">Scanned {new Date(scanTime).toLocaleString()}</span>}
              </div>
            </div>

            <div className="filter-strip">
              <div className="search-box">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
                {search && <button className="search-clear" onClick={() => setSearch("")}>&times;</button>}
              </div>
              <div className="filter-chip">
                <label>Ratio</label>
                <input type="number" step="0.5" min="1" value={minRatio} onChange={e => setMinRatio(e.target.value)} />
              </div>
              <div className="filter-chip">
                <label>Cap $B</label>
                <input type="number" step="0.5" min="0" value={minCap} onChange={e => setMinCap(e.target.value)} />
              </div>
              <div className="filter-chip">
                <label>Price</label>
                <input type="number" placeholder="Min" min="0" value={minPrice} onChange={e => setMinPrice(e.target.value)} style={{ width: 48 }} />
                <span style={{ color: "var(--text-3)", fontSize: 10 }}>–</span>
                <input type="number" placeholder="Max" min="0" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} style={{ width: 48 }} />
              </div>
            </div>

            {sorted.length === 0 ? (
              <div className="no-match">No stocks matched your filters.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <TH label="Ticker" field="symbol" />
                      <TH label="Name" field="name" />
                      <TH label="Price" field="price" />
                      <TH label="Change" field="change" />
                      <TH label="Ratio" field="volumeRatio" />
                      <th>Avg / Vol</th>
                      <TH label="Sector" field="sector" />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r, i) => (
                      <React.Fragment key={r.symbol}>
                        <tr onClick={() => setExpandedRow(expandedRow === r.symbol ? null : r.symbol)} style={{ cursor: "pointer" }}>
                          <td className="col-rank">{i + 1}</td>
                          <td className="col-ticker">{r.symbol}</td>
                          <td className="col-name" title={r.name}>{r.name}</td>
                          <td>${r.price.toFixed(2)}</td>
                          <td className={r.change >= 0 ? "col-pos" : "col-neg"}>
                            {r.change >= 0 ? "+" : ""}{r.change.toFixed(2)}%
                          </td>
                          <td>
                            <span className={`ratio-pill ${r.volumeRatio >= 5 ? "hot" : r.volumeRatio >= 3.5 ? "warm" : "ok"}`}>
                              {r.volumeRatio}x
                            </span>
                          </td>
                          <td>
                            <span className="vol-stack">
                              <span className="vol-stack-avg">{fmt(r.avgVolume)}</span>
                              <span className="vol-stack-sep">/</span>
                              <span className="vol-stack-cur">{fmt(r.volume)}</span>
                            </span>
                          </td>
                          <td><span className="sector-chip">{r.sector}</span></td>
                        </tr>
                        {expandedRow === r.symbol && <RowDetail r={r} />}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        </div>}
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
