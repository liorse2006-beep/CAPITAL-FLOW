// Nasdaq-100 constituents effective after the June 22, 2026 quarterly
// rebalance. Keep the UI universe aligned with the server-side scan universe.
export const NASDAQ100 = [
  'ADBE', 'AMD', 'ABNB', 'ALAB', 'ALNY', 'GOOGL', 'GOOG', 'AMZN', 'AEP', 'AMGN',
  'ADI', 'AAPL', 'AMAT', 'APP', 'ARM', 'ASML', 'ADSK', 'ADP', 'AXON', 'BKR',
  'BKNG', 'AVGO', 'CDNS', 'CTAS', 'CSCO', 'CCEP', 'CMCSA', 'CEG', 'CPRT', 'CSGP',
  'COST', 'CRWD', 'CSX', 'DDOG', 'DXCM', 'FANG', 'DASH', 'EXC', 'FAST', 'FER',
  'FTNT', 'GEHC', 'GILD', 'HON', 'IDXX', 'INTC', 'INTU', 'ISRG', 'KDP', 'KLAC',
  'KHC', 'LRCX', 'LIN', 'MAR', 'MRVL', 'MELI', 'META', 'MCHP', 'MU', 'MSFT', 'MDLZ',
  'MPWR', 'MNST', 'NFLX', 'NVDA', 'NXPI', 'ORLY', 'ODFL', 'PCAR', 'PLTR', 'PANW',
  'PAYX', 'PYPL', 'PDD', 'PEP', 'QCOM', 'REGN', 'ROP', 'ROST', 'RKLB', 'CRWV', 'NBIS',
  'SNDK', 'STX', 'SHOP', 'SBUX', 'MSTR', 'SNPS', 'TMUS', 'TTWO', 'TSLA', 'TXN', 'TRI',
  'VRTX', 'WMT', 'WDC', 'WDAY', 'WBD', 'XEL', 'TER',
];

export const SP500_TOP = [
  'AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','BRK.B','AVGO','JPM',
  'LLY','V','UNH','XOM','MA','JNJ','PG','HD','COST','ABBV','MRK','CVX','BAC',
  'KO','PEP','ADBE','WMT','CRM','ACN','MCD','TMO','CSCO','ABT','NFLX','AMD',
  'LIN','DHR','TXN','NEE','INTC','PM','IBM','AMGN','INTU','QCOM','CAT','GE',
  'SPGI','RTX','HON','UNP','BKNG','ISRG','BLK','SYK','SBUX','AXP','GILD',
  'MDLZ','T','CVS','NOW','GS','REGN','VRTX','MRSH','ADI','DE','MO','LRCX',
  'ZTS','CB','CME','ELV','AON','SO','PLD','NOC','CL','DUK','F','MRNA',
  'APH','GM','HCA','ITW','PGR','TJX','PANW','MU','SHW','ETN','EQIX','PSA',
];

export const SECTOR_TICKERS = {
  Technology: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'ADBE'],
  Financials: ['BRK.B', 'JPM', 'V', 'MA', 'BAC'],
  'Health Care': ['LLY', 'UNH', 'JNJ', 'MRK', 'ABT'],
  'Consumer Discretionary': ['AMZN', 'TSLA', 'HD', 'MCD', 'LOW'],
  'Consumer Staples': ['PG', 'PEP', 'KO', 'COST', 'WMT'],
  Energy: ['XOM', 'CVX', 'COP', 'SLB', 'EOG'],
  Industrials: ['GE', 'CAT', 'HON', 'UNP', 'UPS'],
  Materials: ['LIN', 'APD', 'SHW', 'ECL', 'DD'],
  'Real Estate': ['PLD', 'AMT', 'EQIX', 'CCI', 'PSA'],
  Utilities: ['NEE', 'SO', 'DUK', 'AEP', 'D'],
  'Communication Services': ['META', 'GOOGL', 'NFLX', 'DIS', 'T'],
  Semiconductors: ['NVDA', 'AVGO', 'AMD', 'INTC', 'QCOM'],
};
