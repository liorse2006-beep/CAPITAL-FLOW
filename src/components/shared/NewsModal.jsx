import React, { useCallback, useEffect, useRef, useState } from 'react'
import useModalA11y from '../../hooks/useModalA11y'
import useSmoothProgress from '../../hooks/useSmoothProgress'

function timeAgo(unixSeconds) {
  if (!unixSeconds) return ''
  var diffMs = Date.now() - unixSeconds * 1000
  var diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return diffMin + 'm ago'
  var diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return diffH + 'h ago'
  return new Date(unixSeconds * 1000).toLocaleDateString()
}

var ARTICLE_LOADING_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Opening article…</title><style>' +
  'body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
  'background:#141414;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
  '.wrap{text-align:center}' +
  '.ring{width:34px;height:34px;border-radius:50%;border:2.5px solid #2a2a2a;border-top-color:#f59e0b;' +
  'margin:0 auto 14px;animation:spin .8s linear infinite}' +
  '@keyframes spin{to{transform:rotate(360deg)}}' +
  '.txt{font-size:12px;color:#a0a0a8;font-family:ui-monospace,"SF Mono",monospace;letter-spacing:.03em}' +
  '</style></head><body><div class="wrap"><div class="ring"></div><div class="txt">Opening article…</div></div></body></html>'

// Some providers hand back a tracking/redirect link rather than the
// publisher's real URL, so navigating straight to it flashes the
// intermediate domain before landing on the article. Opens a blank tab
// synchronously (required for it to survive popup blockers, since it has to
// happen inside the click's own call stack) showing a small branded loading
// screen, resolves the real destination server-side, then forwards the tab
// there — the user only ever sees our screen, then the article.
function openArticle(symbol, url, getToken) {
  var win = window.open('', '_blank', 'noopener,noreferrer')
  if (win) {
    win.document.write(ARTICLE_LOADING_HTML)
    win.document.close()
  }
  fetch('/api/news/' + encodeURIComponent(symbol) + '/resolve?url=' + encodeURIComponent(url), {
    headers: { Authorization: 'Bearer ' + getToken() },
  })
    .then(function (r) {
      return r.ok ? r.json() : { url: url }
    })
    .then(function (d) {
      var dest = (d && d.url) || url
      if (win && !win.closed) win.location.href = dest
      else window.open(dest, '_blank', 'noopener,noreferrer')
    })
    .catch(function () {
      if (win && !win.closed) win.location.href = url
      else window.open(url, '_blank', 'noopener,noreferrer')
    })
}

// The AI/provider sentiment field is stored as positive/negative/neutral
// (the class names below still key off those raw values for color), but
// traders think in bullish/bearish/flat — this is display-only.
var SENTIMENT_LABEL = { positive: 'Bullish', negative: 'Bearish', neutral: 'Flat' }
var SENTIMENT_ARROW = { positive: '▲', negative: '▼', neutral: '—' }

var SCAN_MESSAGES = [
  '> scanning verified wire sources',
  '> cross-referencing coverage',
  '> reading sentiment signals',
  '> compiling market outlook',
]

// NewsModal fully unmounts every time it's closed (App.jsx only renders it
// while a symbol is set), so a cache inside the component would reset on
// every reopen — this lives at module scope instead, matching the server's
// own 5-minute TTL. Without it, reopening News for the same ticker (e.g.
// after switching tabs and coming back) replayed the whole loading
// animation and re-fetched even when nothing could have changed yet.
var clientNewsCache = new Map()
var CLIENT_CACHE_TTL_MS = 5 * 60 * 1000

var BIAS_LABEL = { positive: 'BULLISH BIAS', negative: 'BEARISH BIAS', neutral: 'FLAT', mixed: 'MIXED SIGNAL' }

// Mirrors the closed taxonomy in server/services/newsSummarizer.js —
// "other" has no label because it isn't worth surfacing as "the reason."
var CATALYST_LABEL = {
  earnings: 'Earnings',
  guidance_change: 'Guidance Change',
  analyst_action: 'Analyst Action',
  ma_deal: 'M&A / Deal',
  insider_activity: 'Insider Activity',
  regulatory_legal: 'Regulatory / Legal',
  product_business: 'Product / Business',
  index_fund_activity: 'Index / Fund Flow',
  macro_sector: 'Macro / Sector',
}

// Most common real catalyst tag across the batch — a quick "why is this
// moving" answer. Zero-cost past the classification Gemini already did per
// article; never invents a reason when the articles don't actually agree.
function computePrimaryCatalyst(articles) {
  var counts = {}
  articles.forEach(function (a) {
    if (a.catalyst && CATALYST_LABEL[a.catalyst]) {
      counts[a.catalyst] = (counts[a.catalyst] || 0) + 1
    }
  })
  var keys = Object.keys(counts)
  if (keys.length === 0) return null
  keys.sort(function (x, y) {
    return counts[y] - counts[x]
  })
  return CATALYST_LABEL[keys[0]]
}

// Deterministic, zero-cost readout computed from whatever real sentiment
// data the articles already carry — no extra AI call, and it stays
// available even if the per-article summarizer partially failed.
function computeOverallBias(articles) {
  var counts = { positive: 0, negative: 0, neutral: 0 }
  var scored = 0
  articles.forEach(function (a) {
    if (a.sentiment && Object.prototype.hasOwnProperty.call(counts, a.sentiment)) {
      counts[a.sentiment]++
      scored++
    }
  })
  if (scored === 0) return null
  var max = Math.max(counts.positive, counts.negative, counts.neutral)
  var leaders = Object.keys(counts).filter(function (k) {
    return counts[k] === max
  })
  var key = leaders.length > 1 ? 'mixed' : leaders[0]
  return { key: key, label: BIAS_LABEL[key], counts: counts }
}

export default function NewsModal({ symbol, onClose, getToken, onRequireUpgrade }) {
  const [status, setStatus] = useState('loading') // loading | found | empty | error
  const [articles, setArticles] = useState([])
  const [scanMsgIndex, setScanMsgIndex] = useState(0)
  const panelRef = useModalA11y(onClose)
  // Tracks the most recent request so a stale in-flight response (from the
  // initial load, or an earlier retry click) can never overwrite a newer one.
  const requestIdRef = useRef(0)

  const loadNews = useCallback(
    function () {
      var cached = clientNewsCache.get(symbol)
      if (cached && Date.now() - cached.fetchTime < CLIENT_CACHE_TTL_MS) {
        setArticles(cached.articles)
        setStatus(cached.articles.length > 0 ? 'found' : 'empty')
        return
      }

      var requestId = ++requestIdRef.current
      setStatus('loading')
      setScanMsgIndex(0)
      fetch('/api/news/' + encodeURIComponent(symbol), { headers: { Authorization: 'Bearer ' + getToken() } })
        .then(function (r) {
          if (r.status === 403) {
            if (requestId === requestIdRef.current) {
              onClose()
              onRequireUpgrade()
            }
            return null
          }
          if (!r.ok) throw new Error('request failed')
          return r.json()
        })
        .then(function (d) {
          if (requestId !== requestIdRef.current || !d) return
          var found = d.articles && d.articles.length > 0
          clientNewsCache.set(symbol, { articles: found ? d.articles : [], fetchTime: Date.now() })
          if (found) {
            setArticles(d.articles)
            setStatus('found')
          } else {
            setStatus('empty')
          }
        })
        .catch(function () {
          if (requestId === requestIdRef.current) setStatus('error')
        })
    },
    [symbol, getToken, onClose, onRequireUpgrade]
  )

  useEffect(
    function () {
      if (status !== 'loading') return
      var t = setInterval(function () {
        setScanMsgIndex(function (i) {
          return (i + 1) % SCAN_MESSAGES.length
        })
      }, 1400)
      return function () {
        clearInterval(t)
      }
    },
    [status]
  )

  useEffect(
    function () {
      loadNews()
    },
    [loadNews]
  )

  var overallBias = status === 'found' ? computeOverallBias(articles) : null
  var primaryCatalyst = status === 'found' ? computePrimaryCatalyst(articles) : null
  // No real backend progress signal for a single news fetch (unlike the
  // multi-phase scan) — target climbs a step with each status-message
  // change so the percentage still reads as continuous progress rather
  // than a static number sitting there.
  var loadingTarget = Math.min((scanMsgIndex + 1) * (100 / SCAN_MESSAGES.length), 92)
  var loadingPct = useSmoothProgress(loadingTarget, status === 'loading')

  return (
    <div
      className="upgrade-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="upgrade-modal news-modal"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={'News for ' + symbol}
      >
        <button className="upgrade-close" onClick={onClose} aria-label="Close">×</button>

        <div className="news-terminal-header">
          <span className="news-terminal-dot" />
          <h2 className="news-terminal-title">{'NEWS · ' + symbol}</h2>
        </div>

        {status === 'loading' && (
          <div className="news-loading">
            <div className="news-loading-radar">
              <div className="news-loading-bars">
                {[0, 1, 2, 3, 4].map(function (i) {
                  return <span key={i} style={{ animationDelay: i * 0.12 + 's' }} />
                })}
              </div>
              <div className="news-loading-ring" />
            </div>
            <div className="news-loading-pct">{loadingPct + '%'}</div>
            <div className="news-loading-symbol">{symbol}</div>
            <div className="news-loading-msg" key={scanMsgIndex}>
              {SCAN_MESSAGES[scanMsgIndex]}
              <span className="news-loading-cursor">▌</span>
            </div>
          </div>
        )}

        {status === 'found' && (
          <>
            <div className="news-bias-bar">
              <div className="news-bias-readout">
                <span className="news-bias-label-lead">[</span>
                {overallBias ? (
                  <span className={'news-bias-value ' + overallBias.key}>{overallBias.label}</span>
                ) : (
                  <span className="news-bias-value neutral">NO SIGNAL DATA</span>
                )}
                <span className="news-bias-label-lead">]</span>
              </div>
              <div className="news-bias-counts">
                {overallBias && (
                  <>
                    <span className="news-bias-chip positive">{overallBias.counts.positive} ▲</span>
                    <span className="news-bias-chip negative">{overallBias.counts.negative} ▼</span>
                    <span className="news-bias-chip neutral">{overallBias.counts.neutral} —</span>
                  </>
                )}
              </div>
            </div>
            <p className="news-scan-meta">
              {articles.length + ' article' + (articles.length > 1 ? 's' : '') + ' · ' + symbol + ' · last 7d'}
              {primaryCatalyst && <span className="news-scan-catalyst"> · why: {primaryCatalyst}</span>}
            </p>
            <div className="news-article-list">
              {articles.map(function (a, i) {
                var sentimentKey = a.sentiment && SENTIMENT_LABEL[a.sentiment] ? a.sentiment : null
                return (
                  <div
                    key={i}
                    className={'news-article' + (sentimentKey ? ' sentiment-' + sentimentKey : '')}
                    style={{ animationDelay: i * 0.07 + 's' }}
                  >
                    <div className="news-article-top">
                      <div className="news-article-headline">{a.headline}</div>
                      {sentimentKey && (
                        <span className={'news-sentiment ' + sentimentKey}>
                          {SENTIMENT_ARROW[sentimentKey]} {SENTIMENT_LABEL[sentimentKey]}
                        </span>
                      )}
                    </div>
                    <div className="news-article-meta">
                      <span>{a.source}</span>
                      {a.datetime > 0 && <span>{' · ' + timeAgo(a.datetime)}</span>}
                      {a.catalyst && CATALYST_LABEL[a.catalyst] && (
                        <span className="news-catalyst-tag">{' · ' + CATALYST_LABEL[a.catalyst]}</span>
                      )}
                    </div>

                    <p className="news-article-summary">{a.summary || 'No AI summary available for this article — see the source below.'}</p>

                    {a.impact && <p className="news-article-impact">{a.impact}</p>}

                    {a.url && (
                      <button className="news-article-link" onClick={() => openArticle(symbol, a.url, getToken)}>
                        Full article
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M7 17L17 7" /><path d="M7 7h10v10" />
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {status === 'empty' && (
          <div className="news-status-block">
            <div className="news-status-icon neutral">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <h3 className="news-status-heading">No Recent Coverage</h3>
            <p className="news-status-body">
              No verified news articles were found for {symbol} in the last 7 days. We only display confirmed
              reporting from real sources — no listing here means nothing has been published, not that nothing
              happened.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="news-status-block">
            <div className="news-status-icon warn">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 2.11 18.04A1.5 1.5 0 0 0 3.5 20.5h17a1.5 1.5 0 0 0 1.39-2.46L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
                <path d="M12 9v4" /><path d="M12 17h.01" />
              </svg>
            </div>
            <h3 className="news-status-heading">Unable to Reach News Sources</h3>
            <p className="news-status-body">
              We&apos;re sorry — we weren&apos;t able to retrieve verified news for {symbol} at this time. This is
              usually temporary. Please try again in a moment.
            </p>
            <button className="news-retry-btn" onClick={loadNews}>Try Again</button>
          </div>
        )}
      </div>
    </div>
  )
}
