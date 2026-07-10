import React, { useEffect, useRef, useState, useCallback } from 'react';
import { fmt } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';

const PERIODS = ['1D', '1W', '1M', '3M', '1Y'];

const THEME = {
  bg: '#0F0F0F',
  grid: 'rgba(255,255,255,0.04)',
  axis: 'rgba(255,255,255,0.25)',
  text: '#71717A',
  textBright: '#A0A0A8',
  up: '#22C55E',
  down: '#EF4444',
  accent: '#F59E0B',
  ma20: '#06B6D4',
  ma50: '#A78BFA',
  volUp: 'rgba(34,197,94,0.5)',
  volDown: 'rgba(239,68,68,0.5)',
  crosshair: 'rgba(245,158,11,0.5)',
};

function drawChart(canvas, data, period) {
  if (!canvas || !data?.quotes?.length) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD = { top: 16, right: 70, bottom: 52, left: 12, vol: 0.22 };
  const chartH = H - PAD.top - PAD.bottom;
  const volH = chartH * PAD.vol;
  const priceH = chartH - volH - 8;
  const chartW = W - PAD.left - PAD.right;

  // Background
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, W, H);

  const { quotes, ma20, ma50 } = data;
  const closes = quotes.map((q) => q.close);
  const highs = quotes.map((q) => q.high);
  const lows = quotes.map((q) => q.low);
  const volumes = quotes.map((q) => q.volume);

  const minPrice = Math.min(...lows) * 0.999;
  const maxPrice = Math.max(...highs) * 1.001;
  const maxVol = Math.max(...volumes) || 1;

  const px = (i) => PAD.left + (i / (quotes.length - 1 || 1)) * chartW;
  const py = (v) => PAD.top + priceH - ((v - minPrice) / (maxPrice - minPrice)) * priceH;
  const pvy = (v) => H - PAD.bottom - (v / maxVol) * volH;

  const barW = Math.max(1, chartW / quotes.length - 1);

  // ── Price grid lines ──────────────────────────────────────────────────────
  const priceSteps = 6;
  ctx.strokeStyle = THEME.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= priceSteps; i++) {
    const v = minPrice + (maxPrice - minPrice) * (i / priceSteps);
    const y = py(v);
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(W - PAD.right, y);
    ctx.stroke();
    ctx.fillStyle = THEME.text;
    ctx.font = `10px JetBrains Mono, monospace`;
    ctx.textAlign = 'left';
    ctx.fillText('$' + v.toFixed(2), W - PAD.right + 6, y + 3);
  }

  // ── Volume bars ───────────────────────────────────────────────────────────
  quotes.forEach((q, i) => {
    const up = q.close >= q.open;
    ctx.fillStyle = up ? THEME.volUp : THEME.volDown;
    const bx = px(i) - barW / 2;
    const by = pvy(q.volume);
    ctx.fillRect(bx, by, barW, H - PAD.bottom - by);
  });

  // ── Candlesticks (1D uses line chart for 5-min bars) ─────────────────────
  const useCandles = period !== '1D' && barW >= 3;

  if (useCandles) {
    quotes.forEach((q, i) => {
      const up = q.close >= q.open;
      const col = up ? THEME.up : THEME.down;
      const x = px(i);
      const oy = py(q.open);
      const cy = py(q.close);
      const hy = py(q.high);
      const ly = py(q.low);

      // Wick
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, hy);
      ctx.lineTo(x, ly);
      ctx.stroke();

      // Body
      ctx.fillStyle = up ? THEME.up : THEME.down;
      const bodyY = Math.min(oy, cy);
      const bodyH = Math.max(Math.abs(oy - cy), 1);
      ctx.fillRect(x - barW / 2, bodyY, barW, bodyH);
    });
  } else {
    // Line chart with gradient fill
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + priceH);
    const isUp = closes[closes.length - 1] >= closes[0];
    grad.addColorStop(0, isUp ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.beginPath();
    quotes.forEach((q, i) => {
      i === 0 ? ctx.moveTo(px(i), py(q.close)) : ctx.lineTo(px(i), py(q.close));
    });
    // Fill
    ctx.lineTo(px(quotes.length - 1), H - PAD.bottom);
    ctx.lineTo(px(0), H - PAD.bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    quotes.forEach((q, i) => {
      i === 0 ? ctx.moveTo(px(i), py(q.close)) : ctx.lineTo(px(i), py(q.close));
    });
    ctx.strokeStyle = isUp ? THEME.up : THEME.down;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // ── MA Lines ─────────────────────────────────────────────────────────────
  const drawMA = (maArr, color) => {
    if (!maArr?.length) return;
    ctx.beginPath();
    let started = false;
    maArr.forEach((v, i) => {
      if (v === null) return;
      const x = px(i);
      const y = py(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.stroke();
  };
  drawMA(ma20, THEME.ma20);
  drawMA(ma50, THEME.ma50);

  // ── X-axis time labels ────────────────────────────────────────────────────
  const labelCount = Math.min(6, quotes.length);
  const step = Math.max(1, Math.floor(quotes.length / labelCount));
  ctx.fillStyle = THEME.text;
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  for (let i = 0; i < quotes.length; i += step) {
    const d = new Date(quotes[i].date);
    let label;
    if (period === '1D') label = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    else if (period === '1W') label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    else label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    ctx.fillText(label, px(i), H - PAD.bottom + 16);
  }

  // ── Separator line between price and volume panels ────────────────────────
  const sepY = H - PAD.bottom - volH;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD.left, sepY);
  ctx.lineTo(W - PAD.right, sepY);
  ctx.stroke();

  // Return helpers for crosshair
  return { px, py, pvy, quotes, barW, minPrice, maxPrice, maxVol, priceH, chartW, PAD, W, H };
}

export default function ChartModal({ symbol, name, onClose }) {
  const { getToken } = useAuth();
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const dataRef = useRef(null);
  const helpersRef = useRef(null);
  const [period, setPeriod] = useState('1M');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [quote, setQuote] = useState(null);

  const load = useCallback(
    (p) => {
      setLoading(true);
      setError(null);
      fetch(`/api/chart/${encodeURIComponent(symbol)}?period=${p}`, {
        headers: { Authorization: 'Bearer ' + getToken() },
      })
        .then((r) =>
          r.ok
            ? r.json()
            : r.json().then((d) => {
                throw new Error(d.error || 'Fetch failed');
              })
        )
        .then((d) => {
          dataRef.current = d;
          setQuote(d.currentPrice);
          setLoading(false);
          requestAnimationFrame(() => {
            helpersRef.current = drawChart(canvasRef.current, d, p);
          });
        })
        .catch((e) => {
          setError(e.message);
          setLoading(false);
        });
    },
    [symbol]
  );

  useEffect(() => {
    load(period);
  }, [period, load]);

  // Redraw on resize
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (dataRef.current) helpersRef.current = drawChart(canvasRef.current, dataRef.current, period);
    });
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [period]);

  // Keyboard close
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function handleMouseMove(e) {
    const h = helpersRef.current;
    if (!h) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const { px, quotes, barW, PAD, W } = h;
    const chartW = W - PAD.left - PAD.right;

    // Find nearest bar
    let closestI = 0;
    let closestDist = Infinity;
    quotes.forEach((_, i) => {
      const d = Math.abs(px(i) - mx);
      if (d < closestDist) {
        closestDist = d;
        closestI = i;
      }
    });

    const q = quotes[closestI];
    if (!q) return;

    // Draw crosshair on overlay canvas
    const oc = overlayRef.current;
    const dpr = window.devicePixelRatio || 1;
    oc.width = canvasRef.current.offsetWidth * dpr;
    oc.height = canvasRef.current.offsetHeight * dpr;
    const ctx = oc.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, oc.offsetWidth, oc.offsetHeight);

    const x = px(closestI);
    const y = h.py(q.close);

    ctx.strokeStyle = THEME.crosshair;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, PAD.top);
    ctx.lineTo(x, oc.offsetHeight - PAD.bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(oc.offsetWidth - PAD.right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dot
    ctx.fillStyle = THEME.accent;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    setTooltip({ q, x: e.clientX - rect.left, y: e.clientY - rect.top, i: closestI });
  }

  function handleMouseLeave() {
    setTooltip(null);
    const oc = overlayRef.current;
    if (oc) {
      const ctx = oc.getContext('2d');
      ctx.clearRect(0, 0, oc.width, oc.height);
    }
  }

  const isUp = quote ? quote.change >= 0 : true;
  const chgColor = isUp ? '#22C55E' : '#EF4444';

  return React.createElement(
    'div',
    {
      className: 'chart-modal-backdrop',
      onClick: (e) => {
        if (e.target === e.currentTarget) onClose();
      },
    },
    React.createElement(
      'div',
      { className: 'chart-modal' },

      // ── Header ──────────────────────────────────────────────────────────
      React.createElement(
        'div',
        { className: 'chart-modal-header' },
        React.createElement(
          'div',
          { className: 'chart-modal-title' },
          React.createElement('span', { className: 'chart-modal-symbol' }, symbol),
          React.createElement('span', { className: 'chart-modal-name' }, name)
        ),
        React.createElement(
          'div',
          { className: 'chart-modal-meta' },
          quote &&
            React.createElement(
              React.Fragment,
              null,
              React.createElement('span', { className: 'chart-modal-price' }, `$${quote.price.toFixed(2)}`),
              React.createElement(
                'span',
                { className: 'chart-modal-change', style: { color: chgColor } },
                `${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)}%`
              )
            ),
          // MA legend
          React.createElement(
            'div',
            { className: 'chart-ma-legend' },
            React.createElement('span', { className: 'chart-ma-dot', style: { background: THEME.ma20 } }),
            React.createElement('span', { className: 'chart-ma-label' }, 'MA20'),
            React.createElement('span', { className: 'chart-ma-dot', style: { background: THEME.ma50 } }),
            React.createElement('span', { className: 'chart-ma-label' }, 'MA50')
          )
        ),
        React.createElement('button', { className: 'chart-modal-close', onClick: onClose }, '✕')
      ),

      // ── Period Tabs ──────────────────────────────────────────────────────
      React.createElement(
        'div',
        { className: 'chart-period-tabs' },
        PERIODS.map((p) =>
          React.createElement(
            'button',
            {
              key: p,
              className: `chart-period-tab ${period === p ? 'active' : ''}`,
              onClick: () => setPeriod(p),
            },
            p
          )
        )
      ),

      // ── Canvas ──────────────────────────────────────────────────────────
      React.createElement(
        'div',
        { className: 'chart-canvas-wrap', onMouseMove: handleMouseMove, onMouseLeave: handleMouseLeave },
        React.createElement('canvas', { ref: canvasRef, className: 'chart-canvas' }),
        React.createElement('canvas', { ref: overlayRef, className: 'chart-canvas chart-overlay' }),

        loading &&
          React.createElement(
            'div',
            { className: 'chart-loader' },
            React.createElement('div', { className: 'spinner' }),
            React.createElement('span', null, 'Loading chart...')
          ),
        error && React.createElement('div', { className: 'chart-error' }, error),

        // Tooltip
        tooltip &&
          React.createElement(
            'div',
            {
              className: 'chart-tooltip',
              style: {
                left: Math.min(tooltip.x + 12, (canvasRef.current?.offsetWidth ?? 600) - 140),
                top: Math.max(tooltip.y - 80, 8),
              },
            },
            React.createElement(
              'div',
              { className: 'chart-tt-date' },
              new Date(tooltip.q.date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: '2-digit',
                hour: period === '1D' ? '2-digit' : undefined,
                minute: period === '1D' ? '2-digit' : undefined,
              })
            ),
            React.createElement(
              'div',
              { className: 'chart-tt-row' },
              React.createElement('span', null, 'O'),
              React.createElement('span', null, `$${tooltip.q.open.toFixed(2)}`)
            ),
            React.createElement(
              'div',
              { className: 'chart-tt-row' },
              React.createElement('span', null, 'H'),
              React.createElement('span', { style: { color: '#22C55E' } }, `$${tooltip.q.high.toFixed(2)}`)
            ),
            React.createElement(
              'div',
              { className: 'chart-tt-row' },
              React.createElement('span', null, 'L'),
              React.createElement('span', { style: { color: '#EF4444' } }, `$${tooltip.q.low.toFixed(2)}`)
            ),
            React.createElement(
              'div',
              { className: 'chart-tt-row' },
              React.createElement('span', null, 'C'),
              React.createElement('span', { style: { color: '#F59E0B' } }, `$${tooltip.q.close.toFixed(2)}`)
            ),
            React.createElement(
              'div',
              { className: 'chart-tt-row' },
              React.createElement('span', null, 'VOL'),
              React.createElement('span', null, fmt(tooltip.q.volume))
            )
          )
      )
    )
  );
}
