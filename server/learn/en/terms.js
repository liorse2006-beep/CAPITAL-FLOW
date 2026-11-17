// English copy for the additional glossary terms.
module.exports = {
  gap: {
    short: 'Price gap',
    h1: "Gaps: when a stock opens far from yesterday's close",
    title: 'Stock Gaps Explained — Why Stocks Gap Up or Down | Capital Flow',
    description:
      'What a price gap is, why stocks open with a gap, gap up vs. gap down, and whether gaps really "fill".',
    lead: 'The stock closed at $100 yesterday and opened at $108 today. The $8 in between is the gap.',
    diagram: { type: 'gap', caption: 'Gap between the close and the open' },
    points: [
      [
        'Why it happens',
        'Something happened while the market was closed: earnings, news, a macro event. Price simply jumped to the new level.',
      ],
      ['Gap up and gap down', 'Opening above the previous close is a gap up. Opening below it is a gap down.'],
      [
        'Volume tells the story',
        'A gap on higher-than-normal volume shows a lot of money reacting. A low-volume gap is less convincing.',
      ],
      [
        '"Gaps always fill"? Not always',
        'Sometimes price comes back to close the gap, sometimes it never does. It is not a rule.',
      ],
    ],
    right: 'Check what caused the gap and how price behaves in the first hour after it.',
    wrong: 'Assuming every gap "has to fill".',
    faq: [['Where do you see gaps?', 'On a daily candlestick chart: an empty space between one candle and the next.']],
  },
  'support-resistance': {
    short: 'Support and resistance',
    h1: 'Support and resistance: the levels price gets stuck at',
    title: 'Support and Resistance Explained | Capital Flow',
    description:
      'What support and resistance are, why price stalls at the same levels again and again, and what happens when a level breaks.',
    lead: 'Support is a level price struggles to fall below. Resistance is a level it struggles to get above.',
    diagram: { type: 'levels', caption: 'Price moving between support and resistance' },
    points: [
      ['Why levels work', 'Many people remember where price turned before, and react when it gets back there.'],
      ['A zone, not an exact line', 'Support is usually a range of a few percent, not one price.'],
      ['A broken level switches roles', 'Resistance that gets cleared often becomes support, and vice versa.'],
      [
        'The more tests, the more it matters',
        'A level price stopped at several times is watched more. But every test also wears it down.',
      ],
      ['Moving averages are dynamic levels', 'A 50 or 150-day average sometimes acts as support that moves over time.'],
    ],
    right: 'Mark zones, and check volume when price reaches them.',
    wrong: 'Treating a level as a wall price cannot pass.',
    faq: [['How do you find levels?', 'Previous highs and lows, long sideways ranges, and round numbers.']],
  },
  breakout: {
    short: 'Breakouts',
    h1: 'Breakouts: when price clears an important level',
    title: 'Stock Breakouts — How to Spot a Real One | Capital Flow',
    description: 'What a breakout is, why volume is its main test, and what a false breakout is.',
    lead: 'A breakout is the moment price clears resistance that held it back. The question is whether it stays there.',
    diagram: { type: 'volumePrice', caption: 'Breakout above resistance on a high-volume day' },
    points: [
      [
        'Volume is the test',
        'A breakout on higher-than-normal volume shows broad participation. A low-volume breakout is suspect.',
      ],
      ['A close, not a touch', 'Briefly trading above the level during the day matters less than closing above it.'],
      ['False breakouts', 'Price clears the level and drops back below within days. It happens a lot.'],
      [
        'Longer base = more meaningful breakout',
        'A breakout after months of sideways trading is considered stronger than one after a week.',
      ],
    ],
    right: 'Check the volume and the close on the breakout day.',
    wrong: 'Chasing a stock that is already far above the level it broke.',
    faq: [
      [
        'How do I find breakouts?',
        'The volume scanner shows stocks with unusual volume. From there, check whether they sit near a high or resistance.',
      ],
    ],
  },
  rsi: {
    short: 'RSI',
    h1: 'RSI: the Relative Strength Index',
    title: 'RSI (Relative Strength Index) Explained | Capital Flow',
    description:
      'What RSI is, what 70 and 30 mean, why a stock can stay "overbought" for weeks, and how not to use it.',
    lead: 'A number from 0 to 100 that compares the strength of recent gains with the strength of recent losses.',
    diagram: { type: 'oscillator', caption: 'RSI with the 70 and 30 zones' },
    points: [
      ['Default: 14 days', 'RSI is usually calculated over the last 14 trading days.'],
      ['Above 70: "overbought"', 'The stock rose a lot, fast. It does not mean it must fall.'],
      ['Below 30: "oversold"', 'The stock fell a lot, fast. It does not mean it must rise.'],
      ['In strong trends it stays extreme', 'A stock in a strong trend can sit above 70 for weeks.'],
      ['Divergence', 'When price makes a new high and RSI does not, some read it as weakening.'],
    ],
    right: 'Use RSI to understand how stretched a move is.',
    wrong: 'Selling automatically because RSI crossed 70.',
    faq: [['Who created RSI?', 'J. Welles Wilder, in a book published in 1978.']],
  },
  macd: {
    short: 'MACD',
    h1: 'MACD: an indicator built from two moving averages',
    title: 'MACD Explained — How to Read It | Capital Flow',
    description:
      'What MACD is, how it is built from two moving averages, what the signal line and histogram are, and its limits.',
    lead: 'The difference between a fast and a slow moving average. It shows whether momentum is building or fading.',
    diagram: { type: 'crossover', caption: 'MACD line crossing the signal line', fast: 'MACD', slow: 'Signal' },
    points: [
      ['The main line', 'The 12-day EMA minus the 26-day EMA.'],
      ['The signal line', 'A 9-day EMA of the MACD line itself.'],
      ['The histogram', 'The gap between the two lines. When it grows, momentum is strengthening.'],
      ['Crossovers', 'MACD crossing above the signal line is read as positive, below as negative.'],
      ['It lags', 'Like any tool built from moving averages, it reacts after price has moved.'],
    ],
    right: 'Combine MACD with trend and volume rather than relying on it alone.',
    wrong: 'Acting on every crossover in a directionless market.',
    faq: [
      [
        'What does the name mean?',
        'Moving Average Convergence Divergence: moving averages coming together and pulling apart.',
      ],
    ],
  },
  'bollinger-bands': {
    short: 'Bollinger Bands',
    h1: 'Bollinger Bands: when price is stretched',
    title: 'Bollinger Bands Explained | Capital Flow',
    description:
      'What Bollinger Bands are, how they are built from a 20-day average and standard deviation, and what a squeeze means.',
    lead: 'A 20-day average plus two bands that widen when volatility rises and narrow when it falls.',
    diagram: { type: 'bands', caption: 'Price inside Bollinger Bands' },
    points: [
      ['How they are built', 'A 20-day moving average, with two bands two standard deviations above and below it.'],
      ['Price is inside most of the time', 'Touching the upper band means price is stretched, not that it must fall.'],
      ['The squeeze', 'When the bands get unusually narrow, volatility is low. It rarely stays low for long.'],
      ['Strong trends "ride" the band', 'A strong stock can tag the upper band again and again.'],
    ],
    right: 'Use the bands to see how volatility has changed.',
    wrong: 'Selling at every touch of the upper band.',
    faq: [['Who developed them?', 'John Bollinger, in the 1980s.']],
  },
  atr: {
    short: 'ATR — volatility',
    h1: 'ATR: how much a stock moves on a normal day',
    title: 'ATR (Average True Range) — A Volatility Measure | Capital Flow',
    description:
      'What ATR is, how it measures volatility in dollars, and why it helps for comparisons and for sizing risk.',
    lead: 'An ATR of $4 means that recently the stock moved about $4 a day between its low and high.',
    diagram: { type: 'bands', caption: 'Volatility widening and narrowing' },
    points: [
      [
        'True range',
        "The largest of: today's high minus low, or the distance from yesterday's close. That way gaps count too.",
      ],
      ['ATR = the average of that range', 'Usually over 14 days.'],
      ['Dollars, not percent', 'A $4 ATR is a lot for a $40 stock and little for a $400 stock. Compare in percent.'],
      ['It does not say which way', 'ATR measures the size of moves, not their direction.'],
    ],
    right: 'Use ATR to understand what a "normal" move is for the stock.',
    wrong: 'Comparing dollar ATR across stocks at very different prices.',
    faq: [['Why is it useful?', "It helps you tell whether today's move is unusual for that stock."]],
  },
  beta: {
    short: 'Beta',
    h1: 'Beta: how much a stock moves relative to the market',
    title: 'Stock Beta Explained | Capital Flow',
    description:
      'What beta is, what a beta of 1.5 or 0.5 means, and why historical beta does not guarantee the future.',
    lead: 'A beta of 1.5 means that historically, when the market moved 10%, the stock moved about 15%.',
    diagram: {
      type: 'equation',
      caption: 'How to read it',
      label: 'A 15 percent stock move divided by a 10 percent market move equals a beta of 1.5',
      parts: [['15%', 'Stock move'], '÷', ['10%', 'Market move']],
      result: ['1.5', 'Beta'],
    },
    points: [
      ['Beta 1 = like the market', 'Above 1 the stock is more volatile than the market, below 1 less.'],
      ['The market = usually the S&P 500', 'Beta is measured against an index, typically over a few years of data.'],
      ['Low beta ≠ safe stock', 'A stock can drop hard for its own reasons, regardless of the market.'],
      ['It is the past, not the future', 'A company that changes its business can behave completely differently.'],
    ],
    right: 'Use beta to understand how sensitive a stock is to market moves.',
    wrong: 'Assuming low beta protects you from declines.',
    faq: [['Can beta be negative?', 'Yes, rarely. It means the asset tended to move opposite the market.']],
  },
  'dividend-yield': {
    short: 'Dividends and dividend yield',
    h1: 'Dividends and dividend yield',
    title: 'Dividend Yield — How to Calculate It and What to Check | Capital Flow',
    description:
      'What a dividend is, how to calculate dividend yield, and why an unusually high yield can be a warning sign.',
    lead: 'A dividend is cash a company pays its shareholders. The yield shows how much that is relative to the price.',
    diagram: {
      type: 'equation',
      caption: 'Worked example',
      label: 'An annual dividend of 3 dollars divided by a price of 100 equals a 3 percent yield',
      parts: [['$3', 'Annual dividend'], '÷', ['$100', 'Share price']],
      result: ['3%', 'Dividend yield'],
    },
    points: [
      ['Annual dividend divided by price', 'A $3 annual dividend on a $100 stock = a 3% yield.'],
      ['Most companies pay quarterly', 'Each quarter, a quarter of the annual amount is paid.'],
      [
        'Very high yield = find out why',
        'Sometimes the yield is high only because the price collapsed. The dividend may be cut.',
      ],
      ['Payout ratio', 'How much of earnings is paid out. A ratio near or above 100% leaves little safety margin.'],
      [
        'Price drops on the ex-date',
        'On the day the stock trades without the dividend, the price drops by roughly the dividend amount.',
      ],
    ],
    right: 'Check whether earnings cover the dividend.',
    wrong: 'Picking stocks by the highest yield alone.',
    faq: [
      ['Which sectors pay the most?', 'Utilities, real estate (REITs), consumer staples and energy tend to pay more.'],
    ],
  },
  'stock-split': {
    short: 'Stock splits',
    h1: 'Stock splits explained',
    title: 'Stock Split Explained — What Changes and What Does Not | Capital Flow',
    description:
      'What a stock split is, what changes and what does not when a company splits its shares, and what a reverse split is.',
    lead: 'In a 4-for-1 split each share becomes four and the price is divided by four. The value of your holding does not change.',
    diagram: {
      type: 'equation',
      caption: '4-for-1 split',
      label: 'One share at 400 dollars becomes four shares at 100 dollars, and the holding is still worth 400 dollars',
      parts: [['1 × $400', 'Before'], '→', ['4 × $100', 'After']],
      result: ['$400', 'Holding value'],
    },
    points: [
      ['Value does not change', 'More shares, each worth less. Market cap stays the same.'],
      ['Why companies do it', 'To make the share price look more accessible, usually after a long rise.'],
      ['Reverse splits', 'For example 1-for-10: ten shares become one. Common for companies whose price fell a lot.'],
      ['Charts are adjusted', 'Past prices are divided so the chart does not show an artificial "crash".'],
    ],
    right: "Remember a split does not change the company's value.",
    wrong: 'Thinking a stock is "cheaper" after a split.',
    faq: [['Does a split affect moving averages?', 'No, as long as historical data is split-adjusted.']],
  },
  etf: {
    short: 'ETFs',
    h1: 'ETFs: a fund that trades like a stock',
    title: 'What Is an ETF and How Does It Work | Capital Flow',
    description:
      'What an ETF is, how it tracks an index or sector, what the expense ratio is, and why volume in an ETF is worth watching.',
    lead: 'A basket of stocks that trades on the exchange as a single security. You buy it exactly like a stock.',
    diagram: { type: 'indexBlocks', caption: 'An ETF: many stocks in one security' },
    points: [
      ['Tracks an index or sector', 'SPY tracks the S&P 500, QQQ the Nasdaq-100, XLK the technology sector.'],
      ['Expense ratio', 'An annual fee taken from the fund. For large index funds it is usually very low.'],
      ['Liquidity', 'Large funds are easy to buy and sell, and the bid-ask spread is tight.'],
      ['A tracking tool', 'Unusual volume in a sector ETF shows that the whole group is moving.'],
    ],
    right: 'Check what the fund tracks and what it charges.',
    wrong: 'Assuming every fund with a similar name holds the same stocks.',
    faq: [
      ['ETF vs. mutual fund?', 'An ETF trades throughout the day like a stock. A mutual fund is priced once a day.'],
    ],
  },
  'week-52-high-low': {
    short: '52-week high and low',
    h1: 'The 52-week high and low',
    title: '52-Week High and Low — What It Tells You | Capital Flow',
    description:
      'What the 52-week high and low are, why stocks near their high are interesting, and what position in the range does and does not mean.',
    lead: "The stock's highest and lowest price of the last year. Where price sits in that range says a lot.",
    diagram: { type: 'range', caption: 'Position of price in the yearly range', positionPct: 82 },
    points: [
      ['Near the high = strong trend', 'Stocks trading close to their yearly high are usually in an uptrend.'],
      [
        'Near the low = find out why',
        'A stock near its yearly low is not necessarily "cheap". Sometimes there is a good reason.',
      ],
      ['A new high on heavy volume', 'Breaking to a yearly high on lots of volume is considered a significant event.'],
      ['Distance from the high', 'A stock 30% below its high is in a meaningful decline, even if it is up today.'],
    ],
    right: 'Look at position in the range together with the trend.',
    wrong: 'Buying a stock only because it is "far from its high".',
    faq: [
      [
        'Where can I see the range?',
        'Every Capital Flow stock page shows the 52-week range and where price sits in it.',
      ],
    ],
  },
  'bid-ask-spread': {
    short: 'Bid-ask spread',
    h1: 'The bid-ask spread: the gap between buy and sell prices',
    title: 'Bid-Ask Spread Explained — Why It Costs Money | Capital Flow',
    description:
      'What the bid and ask are, what the spread is, why it is wide in thinly traded stocks, and why it is a hidden cost.',
    lead: 'The bid is the highest price someone will pay. The ask is the lowest price someone will sell at.',
    diagram: {
      type: 'equation',
      caption: 'Worked example',
      label: 'An ask of 100.05 minus a bid of 100 equals a spread of 5 cents',
      parts: [['$100.05', 'Ask'], '−', ['$100.00', 'Bid']],
      result: ['$0.05', 'Spread'],
    },
    points: [
      ['The spread is a cost', 'Buying and immediately selling loses the gap, before any fees.'],
      ['Tight in large stocks', 'In very liquid stocks the gap is usually a cent or two.'],
      ['Wide in thin stocks', 'The less volume, the wider the gap.'],
      ['Wider outside regular hours', 'Pre-market and after hours have fewer participants and a wider gap.'],
    ],
    right: 'Check the spread before trading a thinly traded stock.',
    wrong: 'Ignoring the spread because "it is just a few cents".',
    faq: [
      ['How do you reduce the cost?', 'A limit order lets you set the price instead of taking whatever is available.'],
    ],
  },
  'limit-order': {
    short: 'Limit vs. market orders',
    h1: 'Limit orders vs. market orders',
    title: 'Limit Order vs. Market Order — The Difference | Capital Flow',
    description: 'The difference between a market order and a limit order, when each executes, and the risk in each.',
    lead: 'A market order guarantees execution but not price. A limit order guarantees price but not execution.',
    diagram: { type: 'levels', caption: 'A limit price below the current price', lineLabel: 'Limit' },
    points: [
      [
        'Market order',
        'Executes immediately at the best price available now. In a fast move that price can differ from what you saw.',
      ],
      [
        'Limit order',
        'You set a maximum to buy or a minimum to sell. If price never gets there, the order does not fill.',
      ],
      [
        'Critical in thin stocks',
        'A market order in a stock with a wide spread can fill far from the price you expected.',
      ],
      ['Order duration', 'An order can expire at the end of the day or stay open until cancelled.'],
    ],
    right: 'Understand what each order type guarantees and what it does not.',
    wrong: 'Sending a market order in a thin stock outside regular hours.',
    faq: [
      [
        'What is slippage?',
        'The difference between the price you expected and the price the order actually filled at.',
      ],
    ],
  },
  'stop-loss': {
    short: 'Stop-loss orders',
    h1: 'Stop-loss: an order that limits a loss',
    title: 'Stop-Loss Orders Explained | Capital Flow',
    description:
      'What a stop-loss is, how it becomes a market order, why a gap can fill it far from the set price, and what a stop-limit is.',
    lead: 'An order that is sent automatically when price drops to a level you set in advance.',
    diagram: { type: 'levels', caption: 'A stop level below price', lineLabel: 'Stop' },
    points: [
      ['How it works', 'When price reaches the stop level, a sell order is sent.'],
      [
        'A regular stop = a market order',
        'Execution is guaranteed, the price is not. In a fast drop it can fill lower.',
      ],
      ['Gaps jump over stops', 'If the stock opens far below the level, the order fills at the opening price.'],
      ['Stop-limit', 'Also sets a minimum fill price. But if price falls through it, the order will not fill.'],
      [
        'Too close = triggered by noise',
        'A stop too tight to price can be hit by a normal swing. ATR helps you see what a normal swing is.',
      ],
    ],
    right: 'Understand what a stop guarantees and what it does not, especially around earnings.',
    wrong: 'Assuming a stop guarantees the price you set.',
    faq: [['What is a trailing stop?', 'A stop that moves up with price, at a fixed distance below it.']],
  },
};
