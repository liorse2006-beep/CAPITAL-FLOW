import React, { useEffect, useRef, useState } from 'react';

// A large, varied pool of real tickers purely for the scanning animation —
// this has nothing to do with which tickers the actual scan is touching, it
// just needs to feel alive and never visibly repeat a symbol during a scan.
const TICKER_POOL = [
  'AAPL',
  'MSFT',
  'GOOGL',
  'AMZN',
  'NVDA',
  'META',
  'TSLA',
  'BRK.B',
  'AVGO',
  'LLY',
  'JPM',
  'V',
  'XOM',
  'UNH',
  'MA',
  'COST',
  'HD',
  'PG',
  'JNJ',
  'MRK',
  'ABBV',
  'CVX',
  'WMT',
  'KO',
  'PEP',
  'BAC',
  'CRM',
  'ADBE',
  'AMD',
  'NFLX',
  'TMO',
  'ORCL',
  'ACN',
  'MCD',
  'LIN',
  'ABT',
  'DIS',
  'WFC',
  'CSCO',
  'DHR',
  'INTC',
  'VZ',
  'TXN',
  'PM',
  'NKE',
  'CMCSA',
  'NEE',
  'QCOM',
  'UPS',
  'RTX',
  'HON',
  'UNP',
  'LOW',
  'AMGN',
  'IBM',
  'SPGI',
  'INTU',
  'CAT',
  'GE',
  'BA',
  'DE',
  'ELV',
  'PLD',
  'AMAT',
  'SBUX',
  'MDT',
  'GS',
  'BLK',
  'ISRG',
  'ADI',
  'BKNG',
  'GILD',
  'MMC',
  'SYK',
  'TJX',
  'LRCX',
  'VRTX',
  'MDLZ',
  'ADP',
  'C',
  'CVS',
  'REGN',
  'CI',
  'ZTS',
  'PGR',
  'SO',
  'MO',
  'BSX',
  'FISV',
  'DUK',
  'CB',
  'SCHW',
  'TGT',
  'SLB',
  'EOG',
  'APD',
  'AON',
  'ITW',
  'BDX',
  'CL',
  'MU',
  'SHW',
  'PANW',
  'SNPS',
  'CDNS',
  'KLAC',
  'MRVL',
  'ORLY',
  'MCK',
  'NOC',
  'HUM',
  'ROP',
  'FCX',
  'PYPL',
  'MPC',
  'PSX',
  'VLO',
  'WM',
  'EMR',
  'ETN',
  'CSX',
  'PXD',
  'AJG',
  'MSI',
  'GD',
  'APH',
  'ADSK',
  'ANET',
  'NSC',
  'PCAR',
  'AZO',
  'TRV',
  'COF',
  'MET',
  'AIG',
  'SPG',
  'O',
  'DOW',
  'CTAS',
  'ECL',
  'CMG',
  'FTNT',
  'ROST',
  'KMB',
  'GIS',
  'HLT',
  'MAR',
  'YUM',
  'DXCM',
  'IDXX',
  'EA',
  'ODFL',
  'CTSH',
  'PAYX',
  'VRSK',
  'FAST',
  'EXC',
  'AEP',
  'XEL',
  'ED',
  'PEG',
  'WEC',
  'ES',
  'FE',
  'AWK',
  'DTE',
  'PPL',
  'CMS',
  'ATO',
  'NI',
  'SQ',
  'SHOP',
  'UBER',
  'ABNB',
  'DASH',
  'SNOW',
  'PLTR',
  'RBLX',
  'COIN',
  'RIVN',
  'LCID',
  'SOFI',
  'HOOD',
  'MRNA',
  'BNTX',
  'ZM',
  'DOCU',
  'TWLO',
  'NET',
  'DDOG',
];

// Fisher-Yates
function shuffled(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

export default function ScanLoader({ label, matches, statusMessages }) {
  var deckRef = useRef(shuffled(TICKER_POOL));
  var deckIdxRef = useRef(0);
  var [visible, setVisible] = useState(function () {
    return deckRef.current.slice(0, 14);
  });
  var [statusIdx, setStatusIdx] = useState(0);
  var [pulse, setPulse] = useState(false);
  var prevMatches = useRef(matches);

  // Stream one new symbol in at a time, in a shuffled order that only
  // repeats once every symbol in the pool has been shown once.
  useEffect(function () {
    var interval = setInterval(function () {
      var deck = deckRef.current;
      var idx = deckIdxRef.current;
      if (idx >= deck.length) {
        deckRef.current = shuffled(TICKER_POOL);
        deckIdxRef.current = 0;
        idx = 0;
        deck = deckRef.current;
      }
      deckIdxRef.current = idx + 1;
      setVisible(function (prev) {
        return prev.slice(1).concat([deck[idx]]);
      });
    }, 450);
    return function () {
      clearInterval(interval);
    };
  }, []);

  var messages =
    statusMessages && statusMessages.length
      ? statusMessages
      : [
          'Scanning the market for unusual activity…',
          'Cross-referencing live price and volume data…',
          'Checking every sector for movement…',
          'Comparing against historical averages…',
        ];

  useEffect(
    function () {
      var interval = setInterval(function () {
        setStatusIdx(function (i) {
          return (i + 1) % messages.length;
        });
      }, 2200);
      return function () {
        clearInterval(interval);
      };
    },
    [messages.length]
  );

  useEffect(
    function () {
      if (matches != null && matches !== prevMatches.current) {
        prevMatches.current = matches;
        setPulse(true);
        var t = setTimeout(function () {
          setPulse(false);
        }, 220);
        return function () {
          clearTimeout(t);
        };
      }
    },
    [matches]
  );

  return React.createElement(
    'div',
    { className: 'scan-loader' },
    React.createElement(
      'div',
      { className: 'scan-loader-top' },
      React.createElement('span', { className: 'scan-loader-label' }, label),
      React.createElement('span', { className: 'scan-loader-dot' })
    ),
    React.createElement(
      'div',
      { className: 'scan-loader-tape' },
      React.createElement(
        'div',
        { className: 'scan-loader-tape-track' },
        visible.map(function (sym, i) {
          return React.createElement('span', { key: sym + i, className: 'scan-loader-sym' }, sym);
        })
      ),
      React.createElement('div', { className: 'scan-loader-sweep' })
    ),
    matches != null &&
      React.createElement(
        'div',
        { className: 'scan-loader-matches' },
        React.createElement('span', { className: 'scan-loader-matches-num' + (pulse ? ' pulse' : '') }, matches),
        React.createElement(
          'span',
          { className: 'scan-loader-matches-label' },
          matches === 1 ? 'match found' : 'matches found'
        )
      ),
    React.createElement('div', { className: 'scan-loader-status' }, messages[statusIdx])
  );
}
