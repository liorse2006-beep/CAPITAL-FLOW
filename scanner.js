const YahooFinance = require("yahoo-finance2").default;
const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

const BATCH_SIZE = 15;
const DELAY_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getQuoteAndVolume(symbol) {
  try {
    const [quote, chart] = await Promise.all([
      yahooFinance.quote(symbol),
      yahooFinance.chart(symbol, {
        period1: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
        interval: "1d",
      }),
    ]);

    if (!quote || !quote.regularMarketVolume) return null;

    const quotes = chart?.quotes || [];
    const validDays = quotes
      .filter((d) => d.volume && d.volume > 0)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);

    if (validDays.length < 3) return null;

    const avgVolume = Math.round(
      validDays.reduce((sum, d) => sum + d.volume, 0) / validDays.length
    );

    const sparkline = quotes
      .filter((d) => d.close != null)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(-7)
      .map((d) => d.close);

    return {
      symbol: quote.symbol,
      name: quote.shortName || quote.longName || symbol,
      price: quote.regularMarketPrice || 0,
      change: quote.regularMarketChangePercent || 0,
      volume: quote.regularMarketVolume,
      avgVolume,
      volumeRatio: Math.round((quote.regularMarketVolume / avgVolume) * 100) / 100,
      marketCap: quote.marketCap || 0,
      sector: "Pending",
      exchange: quote.exchange || "N/A",
      dayHigh: quote.regularMarketDayHigh || 0,
      dayLow: quote.regularMarketDayLow || 0,
      prevClose: quote.regularMarketPreviousClose || 0,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh || 0,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow || 0,
      sparkline,
    };
  } catch {
    return null;
  }
}

async function enrichSector(symbol) {
  try {
    const summary = await yahooFinance.quoteSummary(symbol, {
      modules: ["assetProfile"],
    });
    return summary.assetProfile?.sector || "N/A";
  } catch {
    return "N/A";
  }
}

async function scanTickers(tickers, options = {}) {
  const {
    minVolumeRatio = 2.5,
    minMarketCap = 1_000_000_000,
    onProgress,
  } = options;

  const results = [];
  const errors = [];
  let processed = 0;

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async (symbol) => {
      try {
        const data = await getQuoteAndVolume(symbol);
        processed++;

        if (!data) return null;
        if (data.marketCap < minMarketCap) return null;
        if (data.volumeRatio < minVolumeRatio) return null;

        return data;
      } catch {
        errors.push(symbol);
        processed++;
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach((r) => {
      if (r) results.push(r);
    });

    if (onProgress) {
      onProgress({ processed, total: tickers.length, found: results.length });
    }

    if (i + BATCH_SIZE < tickers.length) {
      await sleep(DELAY_MS);
    }
  }

  // Enrich matching results with sector data (small number of calls)
  const sectorPromises = results.map(async (r) => {
    r.sector = await enrichSector(r.symbol);
  });
  await Promise.all(sectorPromises);

  results.sort((a, b) => b.volumeRatio - a.volumeRatio);

  return { results, errors, processed };
}

module.exports = { scanTickers };
