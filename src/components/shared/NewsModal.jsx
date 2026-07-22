import React, { useEffect, useState } from 'react'
import useModalA11y from '../../hooks/useModalA11y'

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

export default function NewsModal({ symbol, onClose, getToken, onRequireUpgrade }) {
  const [status, setStatus] = useState('loading') // loading | found | empty | error
  const [articles, setArticles] = useState([])
  const panelRef = useModalA11y(onClose)

  useEffect(
    function () {
      let cancelled = false
      setStatus('loading')
      fetch('/api/news/' + encodeURIComponent(symbol), { headers: { Authorization: 'Bearer ' + getToken() } })
        .then(function (r) {
          if (r.status === 403) {
            if (!cancelled) {
              onClose()
              onRequireUpgrade()
            }
            return null
          }
          if (!r.ok) throw new Error('request failed')
          return r.json()
        })
        .then(function (d) {
          if (cancelled || !d) return
          if (d.articles && d.articles.length > 0) {
            setArticles(d.articles)
            setStatus('found')
          } else {
            setStatus('empty')
          }
        })
        .catch(function () {
          if (!cancelled) setStatus('error')
        })
      return function () {
        cancelled = true
      }
    },
    [symbol]
  )

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

        <h2 className="upgrade-title" style={{ fontSize: 17 }}>{'News — ' + symbol}</h2>

        {status === 'loading' && (
          <div className="news-status-row">
            <div className="spinner" />
            <span>Scanning verified news sources for {symbol}…</span>
          </div>
        )}

        {status === 'found' && (
          <>
            <p className="upgrade-desc" style={{ marginBottom: 14 }}>
              {articles.length + ' verified article' + (articles.length > 1 ? 's' : '') + ' found for ' + symbol + ' in the last 48 hours'}
            </p>
            <div className="news-article-list">
              {articles.map(function (a, i) {
                return (
                  <a key={i} className="news-article" href={a.url} target="_blank" rel="noopener noreferrer">
                    <div className="news-article-headline">{a.headline}</div>
                    <div className="news-article-meta">
                      <span>{a.source}</span>
                      {a.datetime > 0 && <span>{' · ' + timeAgo(a.datetime)}</span>}
                      {a.sentiment && <span className={'news-sentiment ' + a.sentiment}>{a.sentiment}</span>}
                    </div>
                  </a>
                )
              })}
            </div>
          </>
        )}

        {status === 'empty' && (
          <p className="upgrade-desc">
            No verified news found for {symbol} in the last 48 hours. We only show confirmed articles from real
            sources — no data here means nothing was found, not that nothing happened.
          </p>
        )}

        {status === 'error' && (
          <p className="upgrade-desc">Couldn&apos;t reach any verified news source right now. Try again in a moment.</p>
        )}
      </div>
    </div>
  )
}
