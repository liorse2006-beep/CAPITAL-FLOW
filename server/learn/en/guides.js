// English copy for the concept guides. Keys are the shared slugs.
module.exports = {
  'unusual-volume': {
    short: 'Unusual trading volume',
    h1: 'Unusual volume: what it is and how to spot it',
    title: 'Unusual Volume in Stocks — What It Is and How to Spot It | Capital Flow',
    description:
      "What counts as unusual trading volume, how to compare it with a stock's normal volume, what it can hint at, and when it misleads.",
    lead: 'When a stock trades far more than it usually does, something changed. That is the moment to stop and check what.',
    diagram: { type: 'volumeSpike', caption: 'Daily volume vs. the average', label: '3x' },
    points: [
      [
        'Compare the stock with itself',
        'Apple trades tens of millions of shares a day; a small stock trades a few hundred thousand. The question is not how much, but how much versus its own normal.',
      ],
      [
        '2x is interest, 3x is unusual',
        'A day with three times the average volume almost always has a reason: earnings, news, an index change.',
      ],
      [
        'Volume does not tell you direction',
        'Unusual volume shows up before sharp rallies and before sharp drops. It tells you there is activity, not where it goes.',
      ],
      [
        'Find the reason before you interpret',
        'Volume with a known cause explains itself. Volume with no known cause is the interesting one, and the risky one to guess about.',
      ],
      [
        'Some days inflate volume',
        'Options expiration, index rebalancing and shortened sessions distort the numbers. On those days high volume is almost built in.',
      ],
    ],
    right: 'Check what price did that day and look for the reason in the news.',
    wrong: 'Buying only because a stock showed up with unusual volume.',
    faq: [
      [
        'What volume ratio counts as unusual?',
        'A common starting point is 2x the average volume. 3x and above is clearly unusual.',
      ],
      ['Which average do you compare with?', 'Usually the average of the last 20 to 30 trading days.'],
    ],
  },
  'relative-volume-rvol': {
    short: 'RVOL — relative volume',
    h1: 'RVOL — relative volume',
    title: 'RVOL (Relative Volume) Explained | Capital Flow',
    description:
      'What RVOL is, how relative volume is calculated, why it misleads early in the session, and how to use it to filter stocks.',
    lead: 'One number that tells you whether something unusual is happening in a stock today.',
    diagram: { type: 'volumeSpike', caption: 'Daily volume vs. the average', label: 'RVOL 3×' },
    points: [
      ['RVOL 3 = three times normal', 'A stock that usually trades 2 million shares a day traded 6 million today.'],
      [
        'It does not tell you direction',
        'A stock can trade three times its normal volume and fall 10%. RVOL shows activity, not direction.',
      ],
      [
        'Early in the day it lies',
        'Half an hour into the session every stock looks quiet. If the tool does not adjust for time of day, do not trust the number.',
      ],
      [
        'Check how much actually traded',
        'RVOL of 5 on a stock that barely trades is a handful of trades. On a large stock it is serious money.',
      ],
    ],
    right: 'Find out why there is volume first, then interpret it.',
    wrong: 'Buying only because RVOL is high.',
    faq: [
      [
        'How is RVOL calculated?',
        'Current volume divided by average volume. During the session it is compared with the share of the day that has passed.',
      ],
      [
        'Does Capital Flow adjust for time of day?',
        'Yes. The volume ratio is calculated against the progress of the trading session, including U.S. clock changes.',
      ],
    ],
  },
  'average-volume': {
    short: 'Average trading volume',
    h1: "Average volume: every stock's baseline",
    title: 'Average Trading Volume — How to Calculate It | Capital Flow',
    description:
      'How average volume is calculated, which period to choose, and why it matters for liquidity and risk. With an example.',
    lead: 'Without knowing what is normal for a stock, you cannot tell what is unusual.',
    diagram: {
      type: 'equation',
      caption: 'Worked example',
      label: 'Total volume over 20 days divided by 20 equals an average of 2 million',
      parts: [['40M', 'Volume, 20 days'], '÷', ['20', 'Trading days']],
      result: ['2M', 'Daily average'],
    },
    points: [
      ['Simple math', 'Add up the volume of every day in the period and divide by the number of days.'],
      ['20 to 30 days is standard', '10 days reacts fast to change. 90 days is steadier but slower.'],
      [
        'Low volume = more risk',
        'In a thin stock it is hard to buy or sell without moving the price, and moves are sharper.',
      ],
      [
        'Look at dollar volume too',
        'A million shares at $5 is not a million shares at $500. Volume times price shows how much money really changes hands.',
      ],
    ],
    right: 'Set a minimum volume in the scanner to filter out thin stocks.',
    wrong: "Comparing a small stock's volume with a large stock's volume.",
    faq: [
      [
        'What counts as low volume?',
        'There is no official line. Under half a million shares a day is relatively thin.',
      ],
      [
        'Why is the short average different from the long one?',
        'If the 10-day average is far above the 90-day, interest in the stock rose recently.',
      ],
    ],
  },
  'volume-and-price': {
    short: 'Volume and price together',
    h1: 'Volume and price together: reading the combination',
    title: 'Volume and Price — How to Read Them Together | Capital Flow',
    description:
      'Four combinations of volume and price, what each one suggests, and why a breakout on low volume is suspect.',
    lead: 'Price tells you where a stock is moving. Volume tells you how much force is behind the move.',
    diagram: { type: 'volumePrice', caption: 'Breakout above resistance on a high-volume day' },
    points: [
      [
        'Rising on high volume',
        'A lot of money took part in the move. This is the move usually seen as the healthiest.',
      ],
      ['Rising on falling volume', 'Price keeps climbing but fewer people are buying. Some read it as fatigue.'],
      [
        'Falling on high volume',
        'Broad selling pressure. Sometimes it is also the end of a selling wave, and you cannot know in advance.',
      ],
      [
        'Low-volume breakouts are suspect',
        'When a stock clears a high or resistance on little volume, few buyers moved it. Those breakouts fail more often.',
      ],
      [
        'High volume, no movement',
        'Large buyers and sellers met at the same price. It can be accumulation, and it can be distribution.',
      ],
    ],
    right: 'Check volume every time a stock crosses an important level.',
    wrong: 'Treating one pattern as if it were a law.',
    faq: [
      [
        'Is high volume on a down day always bad?',
        'Not always. Sometimes it is the last sellers getting out. Volume alone cannot tell you.',
      ],
    ],
  },
  'moving-average': {
    short: 'Moving averages — the guide',
    h1: 'Moving averages: what they are and how to use them',
    title: 'Moving Average Explained — How to Use It | Capital Flow',
    description:
      "What a moving average is, how it is calculated, the difference between 9, 20, 50 and 150, and what it can't tell you.",
    lead: 'The average of recent closing prices. It smooths out the noise and shows the direction.',
    diagram: { type: 'priceWithMa', caption: 'Price vs. a moving average', label: 'SMA 50' },
    points: [
      [
        'How it is calculated',
        '20-day average = sum of the last 20 closes divided by 20. Each day a new close comes in and the oldest drops out. That is why it "moves".',
      ],
      [
        'Short reacts fast, long filters noise',
        '9 and 20 for close tracking. 50 for the medium trend. 150 and 200 for the long trend.',
      ],
      [
        'Above a rising average = positive trend',
        'When price is above a rising average, the trend on that timeframe favors buyers. Below a falling one, the opposite.',
      ],
      ['Many people watch the same lines', 'That is why stocks sometimes react right at the 50 or 150-day average.'],
      [
        'It always lags',
        'A moving average is built from the past. In a market with no direction it gives many false signals.',
      ],
    ],
    right: 'Use the average to understand the trend, not to guess tomorrow.',
    wrong: 'Hunting for the one "right" average that always works.',
    faq: [
      ['Which moving average is best?', 'There is no such thing. Most people combine one short and one long average.'],
      ['Daily vs. weekly?', 'A weekly average uses weekly closes. 30 weeks is roughly 150 days.'],
    ],
  },
  'sma-vs-ema': {
    short: 'SMA vs. EMA',
    h1: 'SMA vs. EMA: what is the difference',
    title: 'SMA vs. EMA — Simple or Exponential Moving Average | Capital Flow',
    description:
      'The difference between a simple and an exponential moving average, which reacts faster, and when to use each.',
    lead: 'Both are moving averages. The difference is how much weight the most recent days get.',
    diagram: { type: 'crossover', caption: 'A fast average vs. a slow average', fast: 'EMA 20', slow: 'SMA 20' },
    points: [
      [
        'SMA: every day counts the same',
        "In a 20-day SMA, yesterday's close counts exactly as much as the close from 20 days ago.",
      ],
      [
        'EMA: recent days count more',
        'In a 20-day EMA the latest close gets about 9.5% of the weight, so it hugs price more tightly.',
      ],
      ['Faster = more false signals', 'EMA reacts to change sooner, but also to noise.'],
      ['Long as SMA, short as EMA', 'For 50 and 150 most people use SMA. For 9 and 20 many prefer EMA.'],
    ],
    right: 'Pick one type and stick with it so comparisons stay consistent.',
    wrong: 'Comparing a 50 SMA in one tool with a 50 EMA in another.',
    faq: [['Which does Capital Flow use?', 'The moving average scanner uses simple moving averages (SMA).']],
  },
  'moving-average-9': {
    short: '9-day moving average',
    h1: 'The 9-day moving average: the shortest view',
    title: '9-Day Moving Average — What It Shows | Capital Flow',
    description:
      'What the 9-day moving average shows, who it suits, how to pair it with the 20-day, and when it is just noise.',
    lead: 'Less than two weeks of trading. It hugs price and shows the direction of the last few days.',
    diagram: { type: 'priceWithMa', caption: 'Price vs. the 9-day average', label: 'SMA 9', wave: 4, trend: 40 },
    points: [
      [
        'Strong stocks stay above it',
        'In a sharp trend, price tends to ride the 9-day and return to it on small pullbacks.',
      ],
      [
        'The common pair: 9 and 20',
        'When 9 is above 20 and both rise, the short trend is positive. When 9 drops below 20, it is weakening.',
      ],
      ['Noisy in a choppy market', 'Price can cross it almost every day. Then it does not say much.'],
      ['Weekly is a different story', 'A 9-period average on a weekly chart covers more than two months.'],
    ],
    right: 'Use it for close tracking of a stock that is already trending.',
    wrong: 'Making long-term decisions based on it.',
    faq: [['Is the 9-day useful for long-term investing?', 'Usually not. For the long term, look at 50, 150 or 200.']],
  },
  'moving-average-20': {
    short: '20-day moving average',
    h1: 'The 20-day moving average: one month of trend',
    title: '20-Day Moving Average — Short-Term Trend | Capital Flow',
    description:
      'What the 20-day moving average shows, why it equals a month of trading, how it relates to Bollinger Bands, and when stocks return to it.',
    lead: "A month has about 20 trading days, so the 20-day average is basically last month's average price.",
    diagram: { type: 'priceWithMa', caption: 'Price vs. the 20-day average', label: 'SMA 20', wave: 7, trend: 42 },
    points: [
      [
        'Pullbacks often stop near it',
        'In a strong uptrend, stocks tend to dip toward the 20-day and continue from there.',
      ],
      [
        'Losing it is the first warning',
        'A close below it after weeks above can hint that the short trend is weakening.',
      ],
      [
        'Big distance = stretched',
        'When price is far from the 20-day, the gap tends to shrink, sometimes by falling, sometimes by moving sideways.',
      ],
      ['It is the core of Bollinger Bands', 'Bollinger Bands are a 20-day average with a band above and below it.'],
    ],
    right: 'Check whether a trending stock came back to the 20-day on low volume.',
    wrong: 'Panicking at every brief break below it.',
    faq: [
      [
        '20-day vs. 50-day?',
        'The 20-day reacts fast and breaks often. The 50-day reflects a quarter of trend and breaks far less.',
      ],
    ],
  },
  'moving-average-50': {
    short: '50-day moving average',
    h1: 'The 50-day moving average: the line the whole market watches',
    title: '50-Day Moving Average — Why It Matters | Capital Flow',
    description:
      'Why the 50-day moving average is one of the most watched lines, how it acts as support, what a golden cross is, and how to find stocks near it.',
    lead: 'About one quarter of trading. Long enough to filter noise, short enough to react within weeks.',
    diagram: { type: 'priceWithMa', caption: 'Price vs. the 50-day average', label: 'SMA 50' },
    points: [
      ['The most watched line', 'It is a default on almost every charting platform, so many investors react to it.'],
      [
        'A return to it is a test',
        'A trending stock that pulls back to the 50-day on low volume and holds shows there is no heavy selling.',
      ],
      [
        'A high-volume break is more serious',
        'A clear close below it on heavy volume is very different from a quiet break.',
      ],
      [
        'The golden cross arrives late',
        'When the 50 crosses above the 200 it is called a golden cross. By then much of the move is already done.',
      ],
    ],
    right: 'Check volume every time price touches the 50-day.',
    wrong: 'Treating a golden cross as an instant buy signal.',
    faq: [
      [
        'How many times can a stock bounce off the 50-day?',
        'There is no limit. The first pullback in a new trend is usually considered the strongest.',
      ],
      ['Does it work on indexes too?', 'Yes, it is widely used to follow the S&P 500 and Nasdaq.'],
    ],
  },
  'moving-average-150': {
    short: '150-day moving average',
    h1: 'The 150-day moving average: the long-trend test',
    title: '150-Day Moving Average (30-Week) — The Guide | Capital Flow',
    description:
      'What the 150-day moving average shows, why it equals 30 weeks, how it ties to stage analysis, and how to find stocks above it.',
    lead: 'About 30 weeks, more than half a year. It answers one question: is the long trend up or down?',
    diagram: { type: 'stages', caption: 'The four stages around the 30-week average' },
    points: [
      [
        '150 days ≈ 30 weeks',
        "A week is 5 trading days. The 30-week average is known from Stan Weinstein's stage analysis.",
      ],
      [
        'Stage 2 is the one people look for',
        'Price above the average, and the average itself rising. That is the advancing stage.',
      ],
      ['A flat average = no trend', 'When price crosses it back and forth, the stock is basing or topping.'],
      [
        'Part of a well-known trend template',
        'Mark Minervini uses the 50, 150 and 200 together: price above the 150 and 200, and the 150 above the 200.',
      ],
      [
        'Above the 150 is not "cheap"',
        'It only says the long trend has been positive so far. It says nothing about value.',
      ],
    ],
    right: 'Check the slope of the average, not just where price is.',
    wrong: 'Seeing every stock above its 150-day as a healthy trend.',
    faq: [
      [
        '150-day vs. 200-day?',
        'They are very close. The 200 is more common for indexes, the 150 in weekly-chart approaches.',
      ],
      [
        'How do I find stocks near the 150-day?',
        'In the moving average scanner, pick 150, set the distance and direction, and choose a stock list.',
      ],
    ],
  },
  'institutional-money': {
    short: 'Institutional money',
    h1: 'Institutional money: what the data can really show',
    title: 'Institutional Money Flow — What You Can Actually See | Capital Flow',
    description:
      'Who institutional investors are, what footprints they leave in volume, and what public data cannot tell you.',
    lead: 'Large funds move the market and leave footprints. But the footprints do not tell you who bought and who sold.',
    diagram: { type: 'volumeSpike', caption: 'Volume above normal', label: 'Unusual activity', spike: 2.6 },
    points: [
      [
        'Who they are',
        'Mutual funds, ETFs, pension funds, insurers and hedge funds. Together they own most large U.S. stocks.',
      ],
      [
        'They do not buy all at once',
        'A fund buying hundreds of millions builds the position over days and weeks so it does not spike the price.',
      ],
      [
        'The footprint: high volume over time',
        'Several days of above-normal volume, sometimes without a big price move.',
      ],
      ['13F filings arrive late', 'Large institutions report holdings once a quarter, up to 45 days after it ends.'],
      [
        'Volume does not reveal who is behind it',
        'The same volume can be a fund buying, a fund selling or an index rebalance. Anyone promising to "identify it for sure" promises too much.',
      ],
    ],
    right: 'Treat unusual volume and sector moves as a starting point for research.',
    wrong: 'Assuming every high-volume day is "institutional buying".',
    faq: [
      [
        'What is a dark pool?',
        'Private trading venues where institutions execute large trades. The trades are reported afterwards and included in volume.',
      ],
    ],
  },
  'market-cap': {
    short: 'Market capitalization',
    h1: 'Market cap: large, mid and small caps explained',
    title: 'Market Cap Explained — Calculation and Categories | Capital Flow',
    description:
      'What market capitalization is, how it is calculated, the difference between large, mid and small caps, and why it matters for risk.',
    lead: 'How much the market values the whole company right now. The first thing to know about any stock.',
    diagram: { type: 'capScale', caption: 'Market cap categories in dollars' },
    points: [
      [
        'Price × shares outstanding',
        'A company with 1 billion shares at $50 is worth $50 billion. A high share price alone does not make a company big.',
      ],
      [
        'Five categories',
        'Mega above $200B, Large from $10B, Mid from $2B, Small from $300M, and Micro below. The boundaries vary by source.',
      ],
      [
        'Smaller = more volatile',
        'Small companies move harder in both directions, and there is less information about them.',
      ],
      [
        'Unusual volume means something different',
        'In a small stock one trade is enough. In a large stock it takes a lot of money.',
      ],
    ],
    right: 'Set a minimum market cap in the scanner to cut noise.',
    wrong: 'Thinking a $5 stock is "cheap" and a $500 stock is "expensive".',
    faq: [
      [
        'What is enterprise value (EV)?',
        'Market cap plus debt minus cash: what it would cost to buy the whole company, debts included.',
      ],
    ],
  },
  'pe-ratio': {
    short: 'P/E ratio',
    h1: 'P/E ratio: what you pay for each dollar of earnings',
    title: 'P/E Ratio Explained — Calculation and Common Mistakes | Capital Flow',
    description:
      'What the price-to-earnings ratio is, how to calculate it, what counts as high or low, and why you cannot compare it across sectors.',
    lead: 'A P/E of 20 means the market pays $20 for every $1 the company earns in a year.',
    diagram: {
      type: 'equation',
      caption: 'Worked example',
      label: 'Price 100 divided by earnings per share 5 equals a P/E of 20',
      parts: [['$100', 'Share price'], '÷', ['$5', 'Annual EPS']],
      result: ['20', 'P/E ratio'],
    },
    points: [
      [
        'Price divided by earnings per share',
        'Earnings are for the last 12 months. A $100 stock earning $5 a share = P/E of 20.',
      ],
      ['High P/E = growth expected', 'Or the stock is simply expensive. The ratio alone does not tell you which.'],
      [
        'Compare only with peers',
        "Software companies trade at far higher P/Es than banks. Compare with the same industry and the company's own history.",
      ],
      ['One-off profits distort it', 'An asset sale or tax benefit inflates earnings and lowers the P/E artificially.'],
      ['Losses = no P/E', 'Without earnings there is no meaningful P/E.'],
    ],
    right: 'Compare the P/E with same-sector companies and with its own history.',
    wrong: 'Buying because "the P/E is low".',
    faq: [
      [
        'What is a reasonable P/E?',
        'Over the years the S&P 500 P/E has mostly ranged around 15 to 20, but it varies a lot by period.',
      ],
      ['P/E vs. forward P/E?', 'Regular P/E uses reported earnings. Forward P/E uses the forecast for next year.'],
    ],
  },
  'forward-pe': {
    short: 'Forward P/E',
    h1: 'Forward P/E: the P/E based on the forecast',
    title: 'Forward P/E Explained | Capital Flow',
    description: 'What forward P/E is, how it differs from trailing P/E, and why to be careful with analyst forecasts.',
    lead: 'The same ratio, only with the earnings expected next year instead of the earnings already reported.',
    diagram: {
      type: 'equation',
      caption: 'Worked example',
      label: 'Price 100 divided by forecast earnings 6.25 equals a forward P/E of 16',
      parts: [['$100', 'Share price'], '÷', ['$6.25', 'Forecast EPS']],
      result: ['16', 'Forward P/E'],
    },
    points: [
      [
        'The forecast is the analyst average',
        'Expected earnings come from the estimates of analysts who cover the company.',
      ],
      [
        'Below the P/E = growth expected',
        'If the forward P/E is lower than the trailing one, analysts expect earnings to rise.',
      ],
      [
        'Forecasts change all the time',
        "Especially around earnings. Today's forward P/E can look completely different next month.",
      ],
      ['Weak for small companies', 'Few analysts = a less reliable forecast, and sometimes no forecast at all.'],
    ],
    right: 'Look at P/E and forward P/E together, and at the gap between them.',
    wrong: 'Treating a forecast as a fact.',
    faq: [
      [
        'Why is forward P/E sometimes missing?',
        'When no earnings forecast is available. Capital Flow shows it only when it exists and does not estimate it.',
      ],
    ],
  },
  'peg-ratio': {
    short: 'PEG ratio',
    h1: 'PEG ratio: a P/E that accounts for growth',
    title: 'PEG Ratio Explained — P/E Relative to Growth | Capital Flow',
    description:
      'What the PEG ratio is, how to calculate it, why a PEG of 1 is called "fair", and when the calculation is unreliable.',
    lead: 'A P/E of 30 can be cheap if earnings grow fast. PEG checks exactly that.',
    diagram: {
      type: 'equation',
      caption: 'Worked example',
      label: 'P/E of 30 divided by growth of 30 percent equals a PEG of 1',
      parts: [['30', 'P/E ratio'], '÷', ['30%', 'Annual EPS growth']],
      result: ['1.0', 'PEG'],
    },
    points: [
      [
        'P/E divided by growth',
        'A P/E of 30 with 30% annual growth = PEG of 1. A P/E of 15 with 5% growth = PEG of 3.',
      ],
      [
        'Below 1: low price for the growth',
        'Around 1 is considered balanced. Above 2 you pay a lot for each unit of growth.',
      ],
      ["Peter Lynch's rule", 'The rule "a PEG of 1 is fair" is a famous rule of thumb, not a law.'],
      ['It all depends on the forecast', 'If the growth forecast is too optimistic, PEG looks misleadingly low.'],
      ['No earnings or growth = no PEG', 'For a loss-making company or negative growth the number is meaningless.'],
    ],
    right: 'Check where the growth forecast comes from before relying on PEG.',
    wrong: "Computing PEG from one year's P/E and another period's growth.",
    faq: [
      [
        'Why is PEG sometimes missing?',
        'Capital Flow shows PEG only when matching data exists, and never computes it from missing data.',
      ],
    ],
  },
  'debt-to-equity': {
    short: 'Debt-to-equity ratio',
    h1: 'Debt-to-equity: how leveraged a company is',
    title: 'Debt-to-Equity Ratio Explained | Capital Flow',
    description:
      'What the debt-to-equity ratio is, how to calculate it, what counts as high in each industry, and why it matters when rates rise.',
    lead: "How much of the company is funded by debt versus shareholders' money.",
    diagram: {
      type: 'equation',
      caption: 'Worked example',
      label: 'Debt of 50 divided by equity of 100 equals a ratio of 0.5',
      parts: [['$50B', 'Debt'], '÷', ['$100B', 'Equity']],
      result: ['0.5', 'Debt/Equity'],
    },
    points: [
      ['0.5 = 50 cents of debt per dollar of equity', 'A ratio of 2 means twice as much debt as equity.'],
      [
        'Each industry has its norm',
        'Banks, real estate and utilities run with a lot of debt by design. Software companies usually carry little.',
      ],
      ['Rising rates = expensive debt', 'Companies with lots of debt to refinance pay more when rates rise.'],
      [
        'Different definitions',
        'Some sources count only financial debt, others all liabilities. Compare only within one definition.',
      ],
    ],
    right: 'Compare the ratio with companies in the same industry.',
    wrong: 'Ruling out a company just because it has debt.',
    faq: [
      [
        'Is debt always bad?',
        'No. Cheap debt that funds profitable growth can be a good decision. The question is whether the company can carry it in a hard period.',
      ],
    ],
  },
  float: {
    short: 'Float',
    h1: 'Float: how many shares actually trade',
    title: 'Stock Float Explained | Capital Flow',
    description:
      'What float is, how it differs from shares outstanding, why a small float raises volatility, and how it ties to short interest.',
    lead: "Not all of a company's shares are available to trade. The float is the part that actually is.",
    diagram: {
      type: 'split',
      caption: 'Tradable shares out of all shares',
      label: 'Seventy percent of shares are available to trade',
      partPct: 70,
      partLabel: 'Float — tradable',
      restLabel: 'Insiders and restricted',
    },
    points: [
      [
        'Float = shares not held in fixed hands',
        'Subtract shares held by founders, executives, controlling holders and restricted shares.',
      ],
      [
        'Small float = sharp moves',
        'With few shares available, sudden demand cannot find enough sellers and price jumps. Down too.',
      ],
      ['Volume relative to float', 'A day when a meaningful slice of the float trades is a very unusual day.'],
      ['The float changes', 'New offerings, lock-up expirations and buybacks increase or reduce it.'],
    ],
    right: 'Check the float before interpreting a sharp jump in a small stock.',
    wrong: 'Looking only at total shares outstanding.',
    faq: [
      ['What counts as a small float?', 'Under 20 million shares is usually small, and under 10 million very small.'],
    ],
  },
  'short-interest': {
    short: 'Short interest',
    h1: 'Short interest: how many investors are betting against a stock',
    title: 'Short Interest Explained — Short Selling in Stocks | Capital Flow',
    description:
      'What short interest is, how to calculate percent of float and days to cover, when the data is published, and what a short squeeze is.',
    lead: 'Short selling is a bet on a decline. Short interest shows how many such bets are open right now.',
    diagram: {
      type: 'split',
      caption: 'Shares sold short out of the float',
      label: 'Twenty percent of the float is sold short',
      partPct: 20,
      partLabel: 'Short interest',
      restLabel: 'Rest of the float',
    },
    points: [
      ['How it works', 'The investor borrows shares, sells them, and hopes to buy them back cheaper.'],
      ['Under 5% normal, over 20% high', 'Short percent of float shows how much debate surrounds the company.'],
      [
        'Days to cover',
        'Short interest divided by average daily volume: how many days it would take short sellers to buy back.',
      ],
      [
        'Short squeeze',
        'When a heavily shorted stock rises, short sellers are forced to buy, pushing it higher still. When it ends, the drop can be just as sharp.',
      ],
      [
        'The data always lags',
        'In the U.S. it is published twice a month, a few days late. It is a picture of the recent past.',
      ],
    ],
    right: 'Understand that high short interest means high risk, in both directions.',
    wrong: 'Buying because "there is squeeze potential here".',
    faq: [['Is high short interest a buy signal?', 'No. Sometimes the short sellers are simply right.']],
  },
  eps: {
    short: 'Earnings per share (EPS)',
    h1: 'Earnings per share (EPS) and earnings season',
    title: 'EPS Explained — Earnings per Share and Earnings Season | Capital Flow',
    description:
      'What earnings per share is, reported vs. adjusted EPS, what "beat estimates" means, and why stocks move hard on earnings day.',
    lead: 'The number behind the P/E ratio, the PEG ratio and most forecasts.',
    diagram: {
      type: 'equation',
      caption: 'Worked example',
      label: 'Net income of 2 billion divided by 1 billion shares equals 2 dollars per share',
      parts: [['$2B', 'Net income'], '÷', ['1B', 'Shares']],
      result: ['$2', 'EPS'],
    },
    points: [
      ['Net income divided by shares', 'A company that earned $2 billion with 1 billion shares: EPS of $2.'],
      [
        'Reported or adjusted',
        'Reported (GAAP) follows accounting rules. Adjusted excludes items the company chooses. Check what was excluded.',
      ],
      ['"Beat estimates"', 'The result came in better than the average analyst forecast.'],
      ['Guidance matters more', 'A stock can fall after a good quarter if the company lowered its outlook.'],
      ['Volume jumps on earnings', 'The day after a report is usually one of the highest-volume days of the quarter.'],
    ],
    right: 'Read the guidance too, not just the bottom line.',
    wrong: 'Assuming "beat estimates" = the stock will rise.',
    faq: [
      [
        'How do I know when a company reports?',
        'Companies announce the date in advance. The fundamentals check shows the next earnings date when available.',
      ],
    ],
  },
  sp500: {
    short: 'S&P 500 index',
    h1: 'The S&P 500: what is in it and how it is built',
    title: 'S&P 500 Index Explained — Composition and Weighting | Capital Flow',
    description:
      'What the S&P 500 is, how companies are selected, how the index is weighted, and how it differs from the Nasdaq-100.',
    lead: 'When people say "the market rose today", they usually mean the S&P 500.',
    diagram: { type: 'indexBlocks', caption: 'Weight by market cap' },
    points: [
      [
        'About 500 large companies from every sector',
        'The exact number of securities can differ slightly from 500, since some companies have more than one share class.',
      ],
      [
        'A committee chooses, not a formula',
        'Entry depends on market cap, liquidity, U.S. domicile and profitability. Size alone is not enough.',
      ],
      ['The largest weigh the most', 'The index is weighted by market cap, so a few tech giants can move all of it.'],
      ['Joining the index = unusual volume', 'Funds that track it must buy. A common reason for a volume spike.'],
    ],
    right: 'Remember the index can rise even when most of its stocks fall.',
    wrong: 'Inferring from the index how every stock in it is doing.',
    faq: [['Can I scan only the S&P 500?', 'Yes. In the volume scanner, choose the S&P 500 as the scan list.']],
  },
  'nasdaq-100': {
    short: 'Nasdaq-100 index',
    h1: 'The Nasdaq-100: the growth-company index',
    title: 'Nasdaq-100 Index Explained | Capital Flow',
    description:
      'What the Nasdaq-100 includes, why it has no banks, why it leans toward tech, and how it differs from the Nasdaq Composite.',
    lead: 'The 100 largest companies listed on the Nasdaq, excluding financials. In practice: a lot of technology.',
    diagram: { type: 'indexBlocks', caption: 'Weight by market cap' },
    points: [
      [
        'No banks or insurers',
        'The index excludes financial companies, so it leans toward technology, communications and consumer names.',
      ],
      ['Reconstituted in December', 'Once a year, plus whenever a company leaves during the year.'],
      [
        '"The Nasdaq" on the news is not always it',
        'The Nasdaq Composite holds thousands of companies. They move similarly, not identically.',
      ],
      ['QQQ tracks it', 'The QQQ ETF is one of the most traded funds in the world, and tracks the Nasdaq-100.'],
    ],
    right: 'Remember that a move in the Nasdaq-100 is mostly a move in tech.',
    wrong: 'Treating it as a picture of the whole economy.',
    faq: [['Can I scan the Nasdaq-100?', 'Yes, in both the volume scanner and the moving average scanner.']],
  },
  'pre-market-after-hours': {
    short: 'U.S. market hours',
    h1: 'U.S. market hours, pre-market and after hours',
    title: 'Stock Market Hours, Pre-Market and After Hours | Capital Flow',
    description:
      'When the U.S. stock market opens, what pre-market and after-hours trading are, and why prices in those hours can mislead.',
    lead: 'The regular session runs 9:30 to 16:00 New York time, but trades also happen before and after.',
    diagram: { type: 'timeline', caption: 'A trading day in New York time' },
    points: [
      [
        'Regular session: 9:30 to 16:00 ET',
        'That is when most volume trades and when official open and close prices are set.',
      ],
      [
        'Pre-market and after hours',
        'Extended sessions usually run from 4:00 and until 20:00 ET, depending on the broker.',
      ],
      [
        'Low volume, jumpy prices',
        'A single trade can move the price. A pre-market price does not guarantee the open.',
      ],
      [
        'Earnings land outside the session',
        'Most companies report before the open or after the close, so big moves start there.',
      ],
      [
        "Don't compare pre-market volume with a full day",
        'Averages are based on the regular session. That comparison gives a misleading result.',
      ],
    ],
    right: 'Wait for the open to see whether a pre-market move holds.',
    wrong: 'Drawing conclusions from pre-market volume.',
    faq: [
      [
        'Is the market open on holidays?',
        'It closes on certain U.S. holidays, such as Thanksgiving and Christmas, and some have shortened sessions.',
      ],
    ],
  },
  'market-sectors': {
    short: 'The 11 market sectors',
    h1: 'The 11 sectors of the U.S. stock market',
    title: 'Stock Market Sectors — The 11 GICS Sectors | Capital Flow',
    description:
      'The 11 sectors of the U.S. stock market, what sector rotation is, and how to follow sectors through ETFs.',
    lead: 'Before checking a stock, it helps to know what its sector is doing.',
    diagram: { type: 'sectorBars', caption: 'Example daily move across sector ETFs', highlight: '' },
    points: [
      [
        '11 sectors under GICS',
        'Technology, communication services, consumer discretionary, consumer staples, health care, financials, industrials, energy, materials, real estate and utilities.',
      ],
      [
        'Money does not flow everywhere equally',
        'Sometimes investors favor cyclical sectors, sometimes defensive ones. That shift is called rotation.',
      ],
      [
        'Defensives leading = caution',
        'When consumer staples and utilities lead, investors are usually more cautious.',
      ],
      [
        'Follow them through sector ETFs',
        'XLK for technology, XLE for energy and so on. Unusual volume in a sector ETF means the whole group is moving.',
      ],
    ],
    right: 'Check whether several stocks from the same sector move together.',
    wrong: 'Analyzing a stock without checking what its sector is doing.',
    faq: [
      [
        'Sector vs. industry?',
        'A sector is the broad group, like technology. An industry is part of it, like semiconductors or software.',
      ],
    ],
  },
  'stock-screener': {
    short: 'What a stock screener is',
    h1: 'Stock screeners: what they are and how to use one well',
    title: 'Stock Screener — What It Is and How to Use It | Capital Flow',
    description:
      'What a stock screener is, what kinds of filters exist, how to build a good scan, and how to avoid common mistakes.',
    lead: 'Thousands of stocks trade in the U.S. A screener returns only the ones that meet your conditions.',
    diagram: { type: 'funnel', caption: 'From every stock to a short list' },
    points: [
      ['Start with one question', 'For example: which large stocks are trading at twice their normal volume today?'],
      [
        'Three kinds of filters',
        'Technical (price, volume, averages), fundamental (ratios, debt) and descriptive (sector, index, size).',
      ],
      ['Always filter for liquidity', 'Market cap and minimum volume remove most of the noise.'],
      [
        'Few conditions, then add',
        'Too many conditions = zero results. Too few = hundreds of stocks you have no time to check.',
      ],
    ],
    right: 'Treat the results as a list of candidates to research.',
    wrong: 'Treating the results as a shopping list.',
    faq: [['Are screeners suitable for beginners?', 'Yes, as long as the results are a starting point for research.']],
  },
};
