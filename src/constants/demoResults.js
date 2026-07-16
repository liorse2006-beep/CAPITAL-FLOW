/**
 * Static sample rows for the LOGGED-OUT preview only.
 *
 * These are illustrative example values — deliberately fixed, never fetched,
 * and never presented as live quotes. Their sole purpose is to let a visitor
 * see what a completed scan looks like before signing in. Every place they are
 * rendered is marked with a prominent "SAMPLE DATA" badge, so a guest can never
 * mistake them for tradeable, real-time figures. Real scans always come from
 * the live pipeline (Yahoo + Finnhub) after authentication.
 *
 * Values are plausible large-cap numbers chosen to look like a realistic
 * unusual-volume scan, sorted by volume ratio the way a real scan is.
 */
export const DEMO_RESULTS = [
  { symbol: 'NVDA', name: 'NVIDIA Corporation',   marketCap: 3120e9, price: 128.44, change: 4.82,  volumeRatio: 5.31, rvol: 5.31, avgVolume: 245_000_000, volume: 1_301_000_000, sector: 'Semiconductors' },
  { symbol: 'AMD',  name: 'Advanced Micro Devices', marketCap: 268e9, price: 165.90, change: 3.14,  volumeRatio: 4.12, rvol: 4.12, avgVolume: 52_000_000,  volume: 214_000_000,   sector: 'Semiconductors' },
  { symbol: 'TSLA', name: 'Tesla, Inc.',          marketCap: 795e9,  price: 248.50, change: -2.41, volumeRatio: 3.68, rvol: 3.68, avgVolume: 98_000_000,  volume: 360_000_000,   sector: 'Consumer Discretionary' },
  { symbol: 'PLTR', name: 'Palantir Technologies', marketCap: 92e9,  price: 41.28,  change: 6.75,  volumeRatio: 3.22, rvol: 3.22, avgVolume: 61_000_000,  volume: 196_000_000,   sector: 'Technology' },
  { symbol: 'META', name: 'Meta Platforms, Inc.', marketCap: 1290e9, price: 508.30, change: 1.93,  volumeRatio: 2.87, rvol: 2.87, avgVolume: 15_000_000,  volume: 43_000_000,    sector: 'Communication Services' },
  { symbol: 'COIN', name: 'Coinbase Global, Inc.', marketCap: 58e9,  price: 232.10, change: 5.46,  volumeRatio: 2.64, rvol: 2.64, avgVolume: 11_000_000,  volume: 29_000_000,    sector: 'Financials' },
  { symbol: 'AAPL', name: 'Apple Inc.',           marketCap: 3380e9, price: 224.72, change: 0.88,  volumeRatio: 2.31, rvol: 2.31, avgVolume: 54_000_000,  volume: 125_000_000,   sector: 'Technology' },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.',     marketCap: 1940e9, price: 186.55, change: 2.07,  volumeRatio: 2.09, rvol: 2.09, avgVolume: 38_000_000,  volume: 79_000_000,    sector: 'Consumer Discretionary' },
];
