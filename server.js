const express = require("express");
const cors = require("cors");
const path = require("path");
const { scanTickers } = require("./scanner");
const { ALL_TICKERS } = require("./tickers");

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let scanState = {
  running: false,
  progress: null,
  lastResults: null,
  lastScanTime: null,
};

app.get("/api/scan", async (req, res) => {
  if (scanState.running) {
    return res.status(409).json({ error: "Scan already in progress" });
  }

  const minVolumeRatio = parseFloat(req.query.minVolumeRatio) || 2.5;
  const minMarketCap = parseFloat(req.query.minMarketCap) || 1_000_000_000;

  scanState.running = true;
  scanState.progress = { processed: 0, total: ALL_TICKERS.length, found: 0 };

  try {
    const { results, errors, processed } = await scanTickers(ALL_TICKERS, {
      minVolumeRatio,
      minMarketCap,
      onProgress: (p) => {
        scanState.progress = p;
      },
    });

    scanState.lastResults = results;
    scanState.lastScanTime = new Date().toISOString();
    scanState.running = false;

    res.json({
      results,
      scanTime: scanState.lastScanTime,
      tickersScanned: processed,
      errors: errors.length,
    });
  } catch (err) {
    scanState.running = false;
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/progress", (req, res) => {
  res.json({
    running: scanState.running,
    progress: scanState.progress,
  });
});

app.get("/api/sector-flow", async (req, res) => {
  const YahooFinance = require("yahoo-finance2").default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

  const etfs = ["XLK","XLF","XLV","XLY","XLP","XLE","XLI","XLB","XLRE","XLU","XLC","SOXX","XOP","XTL","IGV"];
  try {
    const results = await Promise.all(etfs.map(async (symbol) => {
      try {
        const [quote, chart] = await Promise.all([
          yf.quote(symbol),
          yf.chart(symbol, { period1: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000), interval: "1d" }),
        ]);
        const quotes = chart?.quotes || [];
        const recent = quotes.filter(d => d.volume && d.volume > 0).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
        const avgVol = recent.length >= 3 ? Math.round(recent.reduce((s, d) => s + d.volume, 0) / recent.length) : 0;
        const vol = quote.regularMarketVolume || 0;
        const volRatio = avgVol > 0 ? Math.round((vol / avgVol) * 100) / 100 : 0;
        const change = quote.regularMarketChangePercent || 0;
        const price = quote.regularMarketPrice || 0;

        let flow = "neutral";
        if (change > 0.3 && volRatio > 1.1) flow = "inflow";
        else if (change < -0.3 && volRatio > 1.1) flow = "outflow";

        return {
          symbol,
          price,
          change: Math.round(change * 100) / 100,
          volume: vol,
          avgVolume: avgVol,
          volRatio,
          flow,
          dayHigh: quote.regularMarketDayHigh || 0,
          dayLow: quote.regularMarketDayLow || 0,
          prevClose: quote.regularMarketPreviousClose || 0,
        };
      } catch { return { symbol, price: 0, change: 0, volume: 0, avgVolume: 0, volRatio: 0, flow: "neutral", dayHigh: 0, dayLow: 0, prevClose: 0 }; }
    }));
    res.json({ results, fetchTime: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/last-results", (req, res) => {
  res.json({
    results: scanState.lastResults,
    scanTime: scanState.lastScanTime,
  });
});

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Volume Scanner running at http://localhost:${PORT}`);
});
