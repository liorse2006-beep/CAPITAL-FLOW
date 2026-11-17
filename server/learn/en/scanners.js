// English copy for the scanner/tool pages.
module.exports = {
  'unusual-volume-scanner': {
    short: 'Unusual volume scanner',
    h1: 'Unusual volume stock scanner',
    title: 'Unusual Volume Stock Scanner — Stocks Trading Above Normal | Capital Flow',
    description:
      'Finds U.S. stocks trading above their normal volume. Filter by volume ratio, market cap and volume across the S&P 500, Nasdaq-100 and sectors.',
    lead: 'In seconds: which stocks are trading far above their normal volume today.',
    diagram: { type: 'funnel', caption: 'How a scan narrows the list' },
    points: [
      ['Choose where to scan', 'The S&P 500, the Nasdaq-100, or only selected sectors.'],
      ['Set a volume ratio', '2x is a good starting point. Want fewer results? Raise it to 3x.'],
      ['Add a minimum market cap', '$2 billion and up removes most of the noise from small stocks.'],
      ['The first hour is jumpy', 'Run it again later in the session and see what stays on the list.'],
      [
        'Missing data is marked as missing',
        'When the data source does not answer, the scanner says so instead of filling in numbers.',
      ],
    ],
    right: 'Open each stock on the list and look for why it has volume.',
    wrong: 'Treating the list as buy recommendations.',
    faq: [
      [
        'Is the data real time?',
        'It comes from external data providers and may be delayed or partial. Data status is shown on every scan.',
      ],
      ['How much does it cost?', 'There is a 7-day free trial, followed by paid plans.'],
    ],
  },
  'moving-average-scanner': {
    short: 'Moving average scanner',
    h1: 'Moving average stock scanner',
    title: 'Moving Average Scanner — Stocks Near the 9, 20, 50 and 150-Day | Capital Flow',
    description:
      'Finds stocks close to their 9, 20, 50 or 150-day moving average, on daily or weekly charts, above or below it.',
    lead: 'Instead of opening dozens of charts, the scanner checks the whole list at once.',
    diagram: { type: 'priceWithMa', caption: 'A stock returning to its 50-day average', label: 'SMA 50' },
    points: [
      ['Four averages', '9, 20, 50 or 150. All are simple moving averages.'],
      ['Daily or weekly', 'Weekly suits long trends. A 150-week average covers almost three years.'],
      ['Direction and distance', 'Above the average, below it or both, and within how many percent.'],
      ['A common use', 'Uptrending stocks that pulled back near the 50-day, to see whether they hold there.'],
    ],
    right: 'Cross-check the results with the volume scanner.',
    wrong: 'Assuming every stock near an average is about to "bounce" off it.',
    faq: [
      [
        'Why no 200-day?',
        'The scanner supports 9, 20, 50 and 150. The 150-day is very close to the 200-day and serves the same purpose.',
      ],
    ],
  },
  'ma-150-scanner': {
    short: '150-day MA scanner',
    h1: 'Stock scanner for the 150-day moving average',
    title: '150-Day Moving Average Scanner — Stocks in Long Uptrends | Capital Flow',
    description:
      'How to find stocks trading above or near their 150-day (30-week) moving average, the core long-trend average.',
    lead: 'Stocks whose long trend is positive, or trying to get back to it.',
    diagram: { type: 'stages', caption: 'Stage 2: price above a rising average' },
    points: [
      ['Above the 150, within 5%', 'Stocks in a positive long trend that have not stretched far yet.'],
      ['Below the 150 and close to it', 'Stocks trying to get back above the long trend.'],
      ['After the scan: the slope', 'A rising average is stage 2. A flat one is a sideways market.'],
      ['Then: the 50-day and volume', 'Is price above the 50-day too, and what did volume do recently?'],
      ['And earnings', 'An upcoming report can change the whole picture.'],
    ],
    right: 'Check the slope of the average before drawing any conclusion.',
    wrong: 'Assuming every stock above its 150-day is a good buy.',
    faq: [
      [
        'Why 150 and not 200?',
        'Both measure the long trend. The 150 equals 30 weeks and is common in weekly-chart approaches.',
      ],
    ],
  },
  'sp500-stock-scanner': {
    short: 'S&P 500 scanner',
    h1: 'S&P 500 stock scanner',
    title: 'S&P 500 Stock Scanner — Unusual Volume and Moving Averages | Capital Flow',
    description:
      'Scan every S&P 500 stock by unusual volume, moving averages and market cap. See which large U.S. companies are moving today.',
    lead: "America's largest companies in one scan.",
    diagram: { type: 'indexBlocks', caption: 'S&P 500 by weight' },
    points: [
      ['Why the S&P 500', 'Large, liquid companies. Unusual volume in them takes a lot of money, so it means more.'],
      ['Less noise', 'Fewer random jumps than small stocks, and more financial data available.'],
      ['Look for clusters', "Several stocks from one sector on the list = a broad move, not one stock's story."],
      ['Available in both scanners', 'In the volume scanner and in the moving average scanner.'],
    ],
    right: 'Sort by volume ratio and start from the top.',
    wrong: 'Ignoring the sector of the stocks that show up.',
    faq: [
      ['How long does a scan take?', 'It depends on load and data providers. Progress is shown while the scan runs.'],
    ],
  },
  'nasdaq-100-stock-scanner': {
    short: 'Nasdaq-100 scanner',
    h1: 'Nasdaq-100 stock scanner',
    title: 'Nasdaq-100 Stock Scanner — Unusual Volume in Growth Stocks | Capital Flow',
    description:
      'Scan the 100 largest Nasdaq stocks by unusual volume and moving averages. Suited to following technology and growth names.',
    lead: '100 stocks, mostly technology. A fast, focused scan.',
    diagram: { type: 'indexBlocks', caption: 'Nasdaq-100 by weight' },
    points: [
      ['Only 100 stocks', 'The scan is fast and the list is short.'],
      ['Heavy in tech and chips', 'And no banks or insurers.'],
      ['Many names on the list = a sector move', 'When half the list is tech, the move is probably broad.'],
      ['Compare with QQQ', 'Check whether the stock is moving with the index or against it.'],
    ],
    right: 'Check the semiconductor group when many tech stocks move together.',
    wrong: 'Drawing conclusions about the whole market from the Nasdaq-100.',
    faq: [['Can I scan it by moving averages?', 'Yes, the list is available in the moving average scanner too.']],
  },
  'sector-flow': {
    short: 'Sector money flow',
    h1: 'Money flow between sectors: how to follow it',
    title: 'Sector Money Flow — Tracking Sector ETFs | Capital Flow',
    description:
      'Which sector is money moving into today? Compare price and volume across 15 sector and industry ETFs in the U.S. market.',
    lead: 'One picture of every part of the market, before you check a single stock.',
    diagram: { type: 'sectorBars', caption: 'Example daily move', highlight: 'XLK' },
    points: [
      [
        '15 funds',
        'The 11 sector ETFs (XLK, XLF, XLE and more), plus semiconductors, oil and gas, telecom and software.',
      ],
      ['Price + volume', 'For each fund: how much it moved today, and on how much volume versus normal.'],
      ['Rising on unusual volume', 'Broad participation. Rising on normal volume is a quieter move.'],
      ['Who leads says something', 'Cyclicals leading = risk appetite. Defensives leading = caution.'],
      ['Not proof of institutional money', 'A move in a fund can also come from hedging or fund rebalancing.'],
    ],
    right: 'Start from the sector, then scan the stocks in it.',
    wrong: 'Reading every move in a sector fund as "smart money coming in".',
    faq: [
      ['Why funds and not stocks?', 'A fund sums up the whole group in one number, so you can compare groups quickly.'],
    ],
  },
  'fundamental-analysis-tool': {
    short: 'Fundamentals check',
    h1: "A stock's fundamentals on one screen",
    title: 'Stock Fundamentals — P/E, PEG, Debt, Short Interest | Capital Flow',
    description:
      'P/E, forward P/E, PEG, debt-to-equity, growth, float, short interest and the next earnings date, for any stock.',
    lead: 'Found a stock in the scanner? This is where you check what the company itself looks like.',
    diagram: {
      type: 'equation',
      caption: 'One of the numbers on screen: P/E',
      label: 'Price 100 divided by EPS 5 equals a P/E of 20',
      parts: [['$100', 'Share price'], '÷', ['$5', 'EPS']],
      result: ['20', 'P/E'],
    },
    points: [
      ['Market cap first', 'To know what kind of company it is.'],
      ['Ratios vs. peers', 'P/E and forward P/E, compared with same-industry companies.'],
      ['Growth and PEG', 'Whether the P/E is justified by the growth rate.'],
      ['Debt, float and short interest', 'How leveraged the company is, and how much volatility is possible.'],
      ['Next earnings date', 'With a report coming up, the picture can change within a day.'],
    ],
    right: "Verify important numbers in the company's own filings.",
    wrong: 'Filling in a number that is marked as unavailable.',
    faq: [
      [
        'What happens when data is missing?',
        'It is marked unavailable. The tool does not invent values or compute them from mismatched data.',
      ],
    ],
  },
  'stock-watchlist-alerts': {
    short: 'Watchlist and alerts',
    h1: 'A watchlist with price and volume alerts',
    title: 'Stock Watchlist and Alerts | Capital Flow',
    description:
      'How to build a useful watchlist and set an alert when a stock reaches a price or trades on unusual volume.',
    lead: 'You cannot watch the screen all day. The alert does it for you.',
    diagram: { type: 'alerts', caption: 'A watchlist with one triggered alert' },
    points: [
      ['Few stocks, well known', '10 stocks you understand beat 50 you have no time to check.'],
      ['Price alerts', 'When price crosses a level you chose.'],
      ['Volume alerts', 'When the volume ratio passes a threshold you chose.'],
      ['Each alert fires once', 'So you do not get the same message again and again.'],
    ],
    right: 'Remove stocks whose reason to watch no longer applies.',
    wrong: 'Adding every stock that shows up in the scanner.',
    faq: [['How many stocks can I save?', 'Up to 50 stocks.']],
  },
};
