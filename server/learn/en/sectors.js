// English copy for the sector/industry pages, built from the same template
// as the Hebrew ones (server/learn/sectors.js).
function sector({ etf, short, h1, description, lead, inside, names, drivers, behaviour, right }) {
  return {
    short,
    h1,
    title:
      `${short} (${etf}) — What It Holds and What Moves It | Capital Flow`.length <= 75
        ? `${short} (${etf}) — What It Holds and What Moves It | Capital Flow`
        : `${short} (${etf}) Explained | Capital Flow`,
    description,
    lead,
    diagram: { type: 'sectorBars', caption: `${etf} vs. other sectors, example daily move`, highlight: etf },
    points: [
      ["What's inside", inside],
      ['The big names', `${names}. Holdings and weights in the fund change over time.`],
      ['What moves it', drivers],
      ['How it behaves', behaviour],
      [
        `Follow it through ${etf}`,
        `A move in ${etf} on unusual volume means the activity is broad. Then scan the group's stocks to see who leads.`,
      ],
    ],
    right,
    wrong: `Inferring every stock's move from ${etf}. A few large companies can drive most of the fund.`,
    faq: [
      [
        `What is ${etf}?`,
        'An ETF holding companies from the group, and the common way to follow the group as a whole.',
      ],
      ['Where can I see the daily move?', "In Capital Flow's sector view, together with each fund's volume ratio."],
    ],
  };
}

module.exports = {
  'technology-sector': sector({
    etf: 'XLK',
    short: 'Technology sector',
    h1: 'The technology sector (XLK)',
    description:
      'The U.S. technology sector: what it holds, what moves it, why it is rate-sensitive, and how to follow it through XLK.',
    lead: 'The largest sector in the S&P 500. What happens here moves the whole market.',
    inside:
      'Software, hardware, networking equipment and semiconductors. Note: Alphabet, Meta and Amazon are not here; they sit in communications and consumer discretionary.',
    names: 'Apple, Microsoft, Nvidia, Broadcom, Oracle',
    drivers:
      'Earnings from the largest companies, interest rates (growth stocks are sensitive to them), cloud and AI spending, and export limits.',
    behaviour:
      'Rises hard when there is risk appetite and falls hard when there is not. A few reports can move the whole sector.',
    right: 'Check whether tech is leading because of the whole group or because of 2-3 giants.',
  }),
  'financials-sector': sector({
    etf: 'XLF',
    short: 'Financials sector',
    h1: 'The financials sector (XLF): banks, insurance and payments',
    description:
      'The U.S. financials sector: banks, insurers and payment companies, how rates affect them, and how to follow it through XLF.',
    lead: 'The companies that lend, insure and move money. Directly tied to interest rates and the economy.',
    inside: 'Large and regional banks, insurers, investment firms, and payment and card companies.',
    names: 'Berkshire Hathaway, JPMorgan Chase, Visa, Mastercard, Bank of America',
    drivers:
      'The gap between what banks charge and what they pay, bad loans, regulation, and deal and trading activity.',
    behaviour:
      'Cyclical: benefits from growth and suffers in recessions. Regional banks are especially sensitive to deposits and commercial real estate.',
    right: 'Separate big banks, regional banks and payment companies. They behave differently.',
  }),
  'healthcare-sector': sector({
    etf: 'XLV',
    short: 'Health care sector',
    h1: 'The health care sector (XLV): drugs, devices and insurers',
    description:
      'The U.S. health care sector: pharma, biotech, medical devices and insurers, what moves them, and how to follow it through XLV.',
    lead: 'A stable part and a very volatile part in the same sector. It matters which part is moving.',
    inside: 'Drug makers, biotech, medical equipment and devices, and health insurers and services.',
    names: 'Eli Lilly, UnitedHealth Group, Johnson & Johnson, AbbVie, Merck',
    drivers: 'Regulatory approvals, clinical trial results, patent expirations and U.S. drug pricing policy.',
    behaviour:
      'Most of the sector is defensive, since people need care in any economy. Small biotech can move tens of percent in a day.',
    right: 'Check whether the move is in big pharma or in biotech.',
  }),
  'consumer-discretionary-sector': sector({
    etf: 'XLY',
    short: 'Consumer discretionary sector',
    h1: "Consumer discretionary (XLY): the consumer's wallet",
    description:
      'The consumer discretionary sector: retail, autos, restaurants and travel, why it tracks the economy, and how to follow it through XLY.',
    lead: 'What people buy when they have spare money, and put off when they do not.',
    inside: 'Retail and e-commerce, autos, restaurants, hotels and travel, apparel and luxury goods.',
    names: "Amazon, Tesla, Home Depot, McDonald's, Booking Holdings",
    drivers: 'Jobs and wages, interest rates (consumer credit), consumer confidence and the holiday shopping season.',
    behaviour: 'Clearly cyclical: leads when the economy strengthens. XLY is heavily weighted toward Amazon and Tesla.',
    right: 'Check whether the move is sector-wide or just Amazon and Tesla.',
  }),
  'consumer-staples-sector': sector({
    etf: 'XLP',
    short: 'Consumer staples sector',
    h1: 'Consumer staples (XLP): the defensive sector',
    description:
      'The consumer staples sector: food, beverages, household products and grocers, why it is defensive, and how to follow it through XLP.',
    lead: 'What people buy in any economy: food, drinks and cleaning products.',
    inside: 'Food and beverages, household and personal products, grocery retailers and tobacco.',
    names: 'Procter & Gamble, Costco, Walmart, Coca-Cola, PepsiCo',
    drivers: 'Input costs, pricing power, the dollar, and consumers trading down to cheaper brands.',
    behaviour: 'Moves less than the market: rises less on good days and falls less on bad ones.',
    right: 'Notice when this sector leads the market. It is usually a sign of caution.',
  }),
  'energy-sector': sector({
    etf: 'XLE',
    short: 'Energy sector',
    h1: 'The energy sector (XLE): oil, gas and commodity prices',
    description:
      'The U.S. energy sector: oil and gas, refining and drilling, the link to oil prices, and how to follow it through XLE.',
    lead: 'Tied to the price of oil more than to anything else, so it behaves differently from the rest of the market.',
    inside: 'Integrated oil and gas companies, exploration and production, refining, drilling services and pipelines.',
    names: 'Exxon Mobil, Chevron, ConocoPhillips',
    drivers: 'Oil and gas prices, OPEC+ decisions, geopolitics, inventories and seasonal demand.',
    behaviour: 'Cyclical and volatile, and often moves opposite tech. The large integrated companies are steadier.',
    right: "Check that day's oil price before interpreting a move in the sector.",
  }),
  'industrials-sector': sector({
    etf: 'XLI',
    short: 'Industrials sector',
    h1: 'The industrials sector (XLI): defense, transport and machinery',
    description:
      'The industrials sector: aerospace and defense, machinery, transportation and business services, what moves it, and how to follow it through XLI.',
    lead: 'From aircraft makers to railroads. All depend on economic activity.',
    inside:
      'Aerospace and defense, machinery and heavy equipment, railroads, trucking and shipping, construction and business services.',
    names: 'GE Aerospace, Caterpillar, RTX, Honeywell, Union Pacific',
    drivers: 'Economic growth and new orders, defense and infrastructure budgets, and energy costs.',
    behaviour: 'Cyclical. In earnings, watch the backlog: orders already signed for the coming years.',
    right: 'Check the backlog and orders in the report, not just the profit.',
  }),
  'materials-sector': sector({
    etf: 'XLB',
    short: 'Materials sector',
    h1: 'The materials sector (XLB): chemicals, metals and building materials',
    description:
      'The materials sector: chemicals, mining, metals, building materials and packaging, the link to commodities, and how to follow it through XLB.',
    lead: 'The raw materials for the rest of the economy. Small in the index, very sensitive to the cycle.',
    inside: 'Chemicals and industrial gases, mining (gold, copper, steel), building materials and packaging.',
    names: 'Linde, Sherwin-Williams, Freeport-McMoRan, Newmont',
    drivers: 'Metal and commodity prices, demand from China and global industry, construction and the dollar.',
    behaviour: 'Very cyclical. Miners usually move with the price of the metal they produce.',
    right: 'Check the relevant metal price when a miner moves.',
  }),
  'real-estate-sector': sector({
    etf: 'XLRE',
    short: 'Real estate sector',
    h1: 'The real estate sector (XLRE): REITs and interest rates',
    description:
      'The U.S. real estate sector: REITs, data centers, logistics and housing, its sensitivity to rates, and how to follow it through XLRE.',
    lead: 'Mostly REITs that pay out most of their earnings, which makes it very sensitive to interest rates.',
    inside: 'REITs for housing, offices, retail and logistics, plus cell towers and data centers.',
    names: 'Prologis, American Tower, Equinix, Welltower',
    drivers: 'Interest rates, occupancy and rents, demand for data centers and logistics, and the office market.',
    behaviour: 'Tends to fall when rates rise. Data centers and offices behave completely differently.',
    right: "Check that day's bond yields. They move the sector.",
  }),
  'utilities-sector': sector({
    etf: 'XLU',
    short: 'Utilities sector',
    h1: 'The utilities sector (XLU): power, water and gas',
    description:
      'The U.S. utilities sector: electric, gas and water companies, why it is defensive, the link to rates, and how to follow it through XLU.',
    lead: 'Stable revenue at regulated rates. The classic defensive sector.',
    inside: 'Electric utilities, gas distribution, water companies, and independent and renewable power producers.',
    names: 'NextEra Energy, Southern Company, Duke Energy, Constellation Energy',
    drivers:
      'Interest rates (lots of debt and a high payout), rate decisions, power demand from data centers, and weather.',
    behaviour:
      'Moves less than the market and tends to hold up better in declines. AI power demand turned some names into a growth story.',
    right: 'Tell traditional utilities apart from producers that benefit from data-center demand.',
  }),
  'communication-services-sector': sector({
    etf: 'XLC',
    short: 'Communication services sector',
    h1: 'Communication services (XLC): search, social, media and telecom',
    description:
      'The communication services sector: internet, social media, streaming, media and telecom, and how to follow it through XLC.',
    lead: 'Created in 2018. Today it is dominated mostly by giant internet companies.',
    inside: 'Search engines and social networks, streaming and media, video games and telecom carriers.',
    names: 'Meta Platforms, Alphabet, Netflix, Verizon, AT&T',
    drivers: 'Advertising revenue, subscriber counts, regulation and antitrust cases, and AI spending.',
    behaviour:
      'With such high concentration it often behaves like a growth sector. The telecom names inside are steadier.',
    right: 'Check whether the move is in Meta and Alphabet or across the sector.',
  }),
  'semiconductors-sector': sector({
    etf: 'SOXX',
    short: 'Semiconductor industry',
    h1: 'The semiconductor industry (SOXX)',
    description:
      'The semiconductor industry: chip designers, manufacturers and equipment makers, why it is volatile, and how to follow it through SOXX.',
    lead: 'Chips are in every product. The group is among the most volatile in the market and moves the whole Nasdaq.',
    inside: 'Chip designers, chip manufacturers, chip-making equipment and memory.',
    names: 'Nvidia, Broadcom, AMD, Qualcomm, Micron',
    drivers: 'Inventory and demand cycles, data-center and AI spending, phone and PC sales, and export limits.',
    behaviour: "Moves harder than the rest of tech, both ways. One leader's report can move the whole group.",
    right: "Follow the leaders' earnings. They affect the whole group.",
  }),
  'oil-gas-exploration-sector': sector({
    etf: 'XOP',
    short: 'Oil and gas exploration industry',
    h1: 'Oil and gas exploration and production (XOP)',
    description:
      'The oil and gas E&P industry: why it is more sensitive to oil prices than the big energy companies, and how to follow it through XOP.',
    lead: 'The volatile part of energy. Profits depend directly on the price of oil.',
    inside:
      'Exploration and production companies of every size, plus refiners and integrated companies. XOP is close to equal-weighted.',
    names: 'EOG Resources, Devon Energy, Diamondback Energy, Marathon Petroleum',
    drivers: 'Oil and gas prices, production costs, OPEC+ decisions and industry mergers.',
    behaviour: 'More volatile than XLE. With near-equal weighting, smaller companies carry a lot of weight.',
    right: 'Compare XOP with XLE: a gap shows whether small or large companies are leading.',
  }),
  'telecom-sector': sector({
    etf: 'XTL',
    short: 'Telecom industry',
    h1: 'The telecom industry (XTL): carriers and network equipment',
    description:
      'The U.S. telecom industry: wireless and wireline carriers and network equipment makers, what moves them, and how to follow it through XTL.',
    lead: 'Both the companies that sell the service and those that build the gear that runs the network.',
    inside:
      'Wireless and wireline carriers, network equipment and wireless infrastructure. XTL is close to equal-weighted.',
    names: 'Verizon, AT&T, T-Mobile US, Cisco, Arista Networks',
    drivers: 'Competition for subscribers, 5G and fiber spending, equipment demand from data centers, and heavy debt.',
    behaviour:
      'Carriers are steady and pay dividends. Equipment makers are more cyclical and depend on customer spending.',
    right: 'Separate the carriers from the equipment companies.',
  }),
  'software-sector': sector({
    etf: 'IGV',
    short: 'Software industry',
    h1: 'The software industry (IGV): cloud, SaaS and enterprise software',
    description:
      'The software industry: cloud, SaaS, cybersecurity and enterprise software, why valuations run high, and how to follow it through IGV.',
    lead: 'Subscription revenue and high margins. Hence high valuations, and sensitivity to every change in expectations.',
    inside: 'Enterprise software and cloud infrastructure, SaaS, cybersecurity, and design and data software.',
    names: 'Microsoft, Oracle, Salesforce, Adobe, Palo Alto Networks',
    drivers:
      'Recurring revenue growth, customer retention, IT budgets, interest rates and the effect of AI on products.',
    behaviour: 'Moves hard around earnings. A small change in growth guidance changes valuation a lot.',
    right: 'Read the recurring-revenue guidance in the report, not just the profit.',
  }),
};
